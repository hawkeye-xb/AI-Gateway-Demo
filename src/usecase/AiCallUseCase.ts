import type { IAuthProvider } from '../domain/IAuthProvider';
import type { IAiProviderClient, ProviderCallError } from '../domain/IAiProviderClient';
import { PartialFailureError } from '../domain/IAiProviderClient';
import type { ICreditLedger } from '../domain/ICreditLedger';
import type { IAuditSink } from '../domain/IAuditSink';
import type { ITransportAdapter } from '../domain/ITransportAdapter';
import type { IUsageExtractor } from '../domain/IUsageExtractor';
import type { IRatePlan, IPriceBook } from '../domain/IRatePlan';
import { rawCostUsd } from '../infra/rateplan/TokenBasedRatePlan';
import { CONFIG, lookupModelPrice } from '../config';
import type { NormalizedRequest } from '../domain/types';

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

      // Resolve the price. Fail loud if the model isn't priced — silently billing
      // a wrong flat rate is worse than a clear error (this is money).
      const price = await this.priceBook.getEntry(req.providerKey, req.model, req.modality, Date.now());
      if (!price) throw new Error(`no price configured for ${req.providerKey}/${req.model}/${req.modality}`);

      const cost = this.ratePlan.toCredit(usage, price);   // input + output at their own rates
      const realCostUsd = rawCostUsd(usage, price);        // upstream COGS, for margin monitoring

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
        // Bill the partial usage at the real rate (not a flat 1/unit) so a
        // truncated call still charges accurately.
        const price = await this.priceBook.getEntry(req.providerKey, req.model, req.modality, Date.now());
        const cost = price ? this.ratePlan.toCredit(e.partialUsage, price) : 0;
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
  // not yet known. Only an upper-ish bound: big enough that a near-empty account
  // can't run an expensive call, small enough not to lock up the balance. settle()
  // later trues this up to the exact metered cost. Rates come from CONFIG (via
  // lookupModelPrice) so a fork that changes prices also scales the hold — no
  // second place to edit.
  private estimate(req: NormalizedRequest): number {
    const price = lookupModelPrice(req.providerKey, req.model, req.modality);
    const ex = CONFIG.creditExchangeRateUsd;
    const markup = price?.markupMultiplier ?? CONFIG.pricing.defaultMarkup;
    const toCredits = (usd: number) => Math.max(50, Math.ceil((usd * markup) / ex));

    switch (req.modality) {
      case 'asr': {
        // Hold from audio payload size using a conservative (over-estimating) byte
        // rate so the hold covers the true duration regardless of codec.
        const audio = (req.payload as { audio?: string })?.audio ?? '';
        const b64 = audio.includes(',') ? audio.slice(audio.indexOf(',') + 1) : audio;
        const bytes = Math.floor((b64.length * 3) / 4);
        const estSeconds = Math.min(3600, Math.max(1, Math.ceil(bytes / 4000))); // ~32 kbps floor, cap 1h
        return toCredits(estSeconds * (price?.rates.audioSecond ?? 0));
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
        return toCredits(
          inputTokens * (price?.rates.inputToken ?? 0) + outputTokens * (price?.rates.outputToken ?? 0),
        );
      }
    }
  }
}
