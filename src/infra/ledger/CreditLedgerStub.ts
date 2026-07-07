import type { CreditLedger } from './DurableObjectLedger';

// Thin RPC wrapper around the per-user CreditLedger Durable Object.
//
// One DO instance per account (idFromName(accountId)). All ledger mutations
// (reserve / settle / release / topUp) and reads (getBalance) go through the
// DO's fetch handler so balance stays consistent under concurrency.
//
// Extracted from index.ts so the realtime ASR relay (AsrRelay) can reserve a
// hold when a streaming session opens and settle the real cost when it closes,
// using the exact same ledger path as the synchronous /api/ai/run flow.
export class CreditLedgerStub {
  private stub: DurableObjectStub;

  constructor(ns: DurableObjectNamespace<CreditLedger>, accountId: string) {
    const id = ns.idFromName(accountId);
    this.stub = ns.get(id);
  }

  private async call(method: string, ...args: unknown[]): Promise<unknown> {
    const resp = await this.stub.fetch('http://do/op', {
      method: 'POST',
      body: JSON.stringify({ method, args }),
    });
    if (!resp.ok) {
      // The DO serializes thrown errors as {"error": message}. Unwrap so callers
      // (and the HTTP layer's 429/402 mapping) see the clean message, not the JSON.
      const text = await resp.text();
      let msg = text;
      try { const j = JSON.parse(text) as { error?: string }; if (j && j.error) msg = j.error; } catch { /* not JSON */ }
      throw new Error(msg);
    }
    return resp.json();
  }

  async reserve(accountId: string, estimatedCredit: number, idempotencyKey: string): Promise<string> {
    return (await this.call('reserve', accountId, estimatedCredit, idempotencyKey)) as string;
  }
  async settle(reservationId: string, actualCredit: number): Promise<void> {
    await this.call('settle', reservationId, actualCredit);
  }
  async release(reservationId: string): Promise<void> {
    await this.call('release', reservationId);
  }
  async getBalance(accountId: string): Promise<number> {
    return (await this.call('getBalance', accountId)) as number;
  }
  // Read-only view of balance + current rate-limit window usage, for the UI to
  // surface "N / limit today" without burning a request slot.
  async snapshot(accountId: string): Promise<{ balance: number; dayUsed: number; dayLimit: number; minLimit: number; maxBalance: number }> {
    return (await this.call('snapshot', accountId)) as { balance: number; dayUsed: number; dayLimit: number; minLimit: number; maxBalance: number };
  }
  async topUp(accountId: string, amount: number, idempotencyKey: string): Promise<void> {
    await this.call('topUp', accountId, amount, idempotencyKey);
  }
}
