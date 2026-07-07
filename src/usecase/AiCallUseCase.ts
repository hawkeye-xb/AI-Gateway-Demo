import type { IAuthProvider } from '../domain/IAuthProvider';
import type { IAiProviderClient, ProviderCallError } from '../domain/IAiProviderClient';
import { PartialFailureError } from '../domain/IAiProviderClient';
import type { ICreditLedger } from '../domain/ICreditLedger';
import type { IAuditSink } from '../domain/IAuditSink';
import type { ITransportAdapter } from '../domain/ITransportAdapter';
import type { IUsageExtractor } from '../domain/IUsageExtractor';
import type { IRatePlan, IPriceBook, PriceBookEntry } from '../domain/IRatePlan';
import type { NormalizedRequest, Modality } from '../domain/types';

export class AiCallUseCase {
  constructor(
    private auth: IAuthProvider,
    private ledger: ICreditLedger,
    private providers: Map<string, IAiProviderClient>,
    private usageExtractors: Map<string, IUsageExtractor>,
    private priceBook: IPriceBook,
    private ratePlan: IRatePlan,
    private audit: IAuditSink,
  ) {}

  async handle(transport: ITransportAdapter, raw: unknown): Promise<Response | void> {
    const req = await transport.parse(raw as Request);
    let identity;
    try {
      identity = await this.auth.verify(req.token);
    } catch {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    const accountId = identity.userId;

    // Estimate and reserve
    const estimated = this.estimate(req);
    const reservationId = await this.ledger.reserve(accountId, estimated, req.requestId);

    try {
      const provider = this.providers.get(req.providerKey);
      if (!provider) throw new Error(`unknown provider: ${req.providerKey}`);

      const resp = await provider.invoke({
        model: req.model,
        modality: req.modality,
        input: req.payload,
      });

      const usage = this.usageExtractors.get(req.modality)?.extract(resp) ?? resp.usage;

      // Look up real price from D1
      const entry = await this.priceBook.getEntry(req.providerKey, req.model, req.modality, Date.now());
      const cost = entry
        ? this.ratePlan.toCredit(usage, entry)
        : Math.ceil(usage.amount * 1); // fallback: 1 credit per unit

      // Calculate real cost in USD
      const realCostUsd = entry
        ? usage.amount * entry.rawCostPerUnit
        : 0;

      await this.ledger.settle(reservationId, cost);
      await this.audit.record({
        requestId: req.requestId,
        accountId,
        modality: req.modality,
        model: req.model,
        provider: req.providerKey,
        usage,
        cost,
        realCostUsd,
        timestamp: Date.now(),
      });

      return transport.respond({ raw: resp.raw, cost });
    } catch (e) {
      if (e instanceof PartialFailureError) {
        const cost = Math.ceil(e.partialUsage.amount * 1);
        await this.ledger.settle(reservationId, cost);
      } else if (e instanceof Error && 'releaseReservation' in e) {
        const pe = e as unknown as ProviderCallError;
        if (pe.releaseReservation) await this.ledger.release(reservationId);
      } else {
        await this.ledger.release(reservationId);
      }
      throw e;
    }
  }

  // Pre-authorization hold placed BEFORE the provider call, when the real cost is
  // not yet known. It only needs to be a reasonable upper-ish bound: big enough that
  // a near-empty account can't run an expensive call, small enough not to lock up the
  // balance. settle() later trues this up to the exact metered cost. Constants mirror
  // the demo price_book (raw USD/unit × 100 markup ÷ $0.0001/credit); they don't have
  // to be exact because they never bill — they only gate affordability.
  private estimate(req: NormalizedRequest): number {
    switch (req.modality) {
      case 'asr': {
        // Hold from audio payload size using a conservative (over-estimating) byte
        // rate so the hold covers the true duration regardless of codec.
        const audio = (req.payload as { audio?: string })?.audio ?? '';
        const b64 = audio.includes(',') ? audio.slice(audio.indexOf(',') + 1) : audio;
        const bytes = Math.floor((b64.length * 3) / 4);
        const estSeconds = Math.min(3600, Math.max(1, Math.ceil(bytes / 4000))); // ~32 kbps floor, cap 1h
        return estSeconds * 5; // ≈ 5 credits/sec at current pricing
      }
      case 'vision': {
        // Image-token count is unknown pre-call; reserve a generous flat buffer.
        return 5000;
      }
      case 'llm':
      default: {
        const payload = (req.payload ?? {}) as { messages?: Array<{ content?: unknown }>; max_tokens?: number };
        let chars = 0;
        for (const m of payload.messages ?? []) {
          if (typeof m.content === 'string') chars += m.content.length;
        }
        const inputTokens = Math.ceil(chars / 4); // ~4 chars/token
        const outputTokens = payload.max_tokens ?? 512;
        // deepseek-chat demo pricing: input $0.00000027/tok, output $0.0000011/tok.
        const credits = Math.ceil((inputTokens * 0.00000027 + outputTokens * 0.0000011) * 100 / 0.0001);
        return Math.max(50, credits);
      }
    }
  }
}
