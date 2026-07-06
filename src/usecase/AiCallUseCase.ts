import type { IAuthProvider } from '../domain/IAuthProvider';
import type { IAiProviderClient, ProviderCallError } from '../domain/IAiProviderClient';
import { PartialFailureError } from '../domain/IAiProviderClient';
import type { ICreditLedger } from '../domain/ICreditLedger';
import type { IAuditSink } from '../domain/IAuditSink';
import type { ITransportAdapter } from '../domain/ITransportAdapter';
import type { IUsageExtractor } from '../domain/IUsageExtractor';
import type { IRatePlan } from '../domain/IRatePlan';
import type { NormalizedRequest } from '../domain/types';

export class AiCallUseCase {
  constructor(
    private auth: IAuthProvider,
    private ledger: ICreditLedger,
    private providers: Map<string, IAiProviderClient>,
    private usageExtractors: Map<string, IUsageExtractor>, // key: modality
    private ratePlans: Map<string, IRatePlan>,             // key: model
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

    const accountId = identity.userId; // personal account = userId

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

      const usage = this.usageExtractors.get(req.modality)?.extract(resp)
        ?? resp.usage;

      const ratePlan = this.ratePlans.get(req.model);
      // Fallback: simple token-based rate
      const cost = ratePlan
        ? ratePlan.toCredit(usage, { rawCostPerUnit: 0, markupMultiplier: 1, minChargePerCall: 1 } as any)
        : Math.ceil(usage.amount * 1);

      await this.ledger.settle(reservationId, cost);
      await this.audit.record({
        requestId: req.requestId,
        accountId,
        modality: req.modality,
        model: req.model,
        provider: req.providerKey,
        usage,
        cost,
        realCostUsd: 0, // simplified for demo
        timestamp: Date.now(),
      });

      return transport.respond({ raw: resp.raw, cost });
    } catch (e) {
      if (e instanceof PartialFailureError) {
        const cost = Math.ceil(e.partialUsage.amount * 1);
        await this.ledger.settle(reservationId, cost);
        await this.audit.record({
          requestId: req.requestId,
          accountId,
          modality: req.modality,
          model: req.model,
          provider: req.providerKey,
          usage: e.partialUsage,
          cost,
          realCostUsd: 0,
          timestamp: Date.now(),
        });
      } else if (e instanceof Error && 'releaseReservation' in e) {
        const pe = e as unknown as ProviderCallError;
        if (pe.releaseReservation) await this.ledger.release(reservationId);
      } else {
        await this.ledger.release(reservationId);
      }
      throw e;
    }
  }

  private estimate(req: NormalizedRequest): number {
    // Simple estimation: 10 credits per call minimum
    return 10;
  }
}
