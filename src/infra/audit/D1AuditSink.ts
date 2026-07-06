import type { IAuditSink, BillingEvent } from '../../domain/IAuditSink';

export class D1AuditSink implements IAuditSink {
  constructor(private db: D1Database) {}

  async record(event: BillingEvent): Promise<void> {
    await this.db.prepare(
      `INSERT INTO audit_log (request_id, account_id, modality, model, provider, usage_kind, usage_amount, real_cost_usd, credits_charged, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      event.requestId,
      event.accountId,
      event.modality,
      event.model,
      event.provider,
      event.usage.kind,
      event.usage.amount,
      event.realCostUsd,
      event.cost,
      event.timestamp,
    ).run();
  }

  async claimEvent(externalEventId: string, source: string): Promise<boolean> {
    const result = await this.db.prepare(
      `INSERT INTO processed_events (source, external_event_id, processed_at)
       VALUES (?, ?, ?)
       ON CONFLICT (source, external_event_id) DO NOTHING`
    ).bind(source, externalEventId, Date.now()).run();
    return result.meta.changes === 1;
  }
}
