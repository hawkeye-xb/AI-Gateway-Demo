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

  private estimate(_req: NormalizedRequest): number {
    return 100; // reasonable buffer for LLM calls
  }
}
