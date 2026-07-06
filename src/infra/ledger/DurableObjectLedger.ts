import { DurableObject } from 'cloudflare:workers';
import type { ICreditLedger } from '../../domain/ICreditLedger';

interface Reservation {
  amount: number;
  createdAt: number;
}

// New DO instances (and demo users) start with this balance so the demo works
// out of the box. Granted exactly once per user, guarded by the 'initialized' flag.
const DEMO_INITIAL_CREDITS = 1_000_000;

export class CreditLedger extends DurableObject implements ICreditLedger {
  // In-memory cache of the persisted balance. NEVER trust this before ensureLoaded().
  private balance = 0;
  // Reservations are transient per-request (reserve -> settle within one call),
  // so they intentionally live in memory only.
  private reservations = new Map<string, Reservation>();
  private loaded = false;

  // ── Persistence ──────────────────────────────────────────────
  // The previous version kept `balance` in a plain instance field that reset to 0
  // every time the DO was evicted from memory (routine, after seconds/minutes of
  // inactivity) or on every `wrangler deploy`. That silently wiped top-ups and let
  // the balance drift negative. Balance now lives in this.ctx.storage (durable).
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.ctx.storage.get<number>('balance');
    if (stored === undefined) {
      // First-ever access for this account: seed demo credits exactly once.
      this.balance = DEMO_INITIAL_CREDITS;
      await this.ctx.storage.put('balance', this.balance);
      await this.ctx.storage.put('initialized', true);
    } else {
      this.balance = stored;
    }
    this.loaded = true;
  }

  private async persistBalance(): Promise<void> {
    await this.ctx.storage.put('balance', this.balance);
  }

  // HTTP fetch handler for stub-based calls
  async fetch(request: Request): Promise<Response> {
    const { method, args } = await request.json() as { method: string; args: unknown[] };
    try {
      let result: unknown;
      switch (method) {
        case 'reserve':
          result = await this.reserve(args[0] as string, args[1] as number, args[2] as string);
          break;
        case 'settle':
          await this.settle(args[0] as string, args[1] as number);
          break;
        case 'release':
          await this.release(args[0] as string);
          break;
        case 'getBalance':
          result = await this.getBalance(args[0] as string);
          break;
        case 'topUp':
          await this.topUp(args[0] as string, args[1] as number, args[2] as string);
          break;
        default:
          return new Response(JSON.stringify({ error: `unknown method: ${method}` }), { status: 400 });
      }
      return new Response(JSON.stringify(result ?? null));
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
    }
  }

  async reserve(accountId: string, estimatedCredit: number, idempotencyKey: string): Promise<string> {
    await this.ensureLoaded();
    if (this.reservations.has(idempotencyKey)) {
      return idempotencyKey;
    }
    // Available = persisted balance minus everything currently held by open reservations.
    // Previous guard `balance + estimatedCredit < 0` never triggered (estimatedCredit is
    // positive), so it provided no protection and the balance could go negative freely.
    const outstanding = [...this.reservations.values()].reduce((s, r) => s + r.amount, 0);
    const available = this.balance - outstanding;
    if (available - estimatedCredit < 0) {
      throw new Error(`insufficient balance: available ${available} < required ${estimatedCredit}`);
    }
    this.reservations.set(idempotencyKey, { amount: estimatedCredit, createdAt: Date.now() });
    return idempotencyKey;
  }

  async settle(reservationId: string, actualCredit: number): Promise<void> {
    await this.ensureLoaded();
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new Error(`reservation ${reservationId} not found`);
    this.balance -= actualCredit;
    this.reservations.delete(reservationId);
    await this.persistBalance();
  }

  async release(reservationId: string): Promise<void> {
    this.reservations.delete(reservationId);
  }

  async getBalance(_accountId: string): Promise<number> {
    await this.ensureLoaded();
    return this.balance;
  }

  async topUp(_accountId: string, amount: number, idempotencyKey: string): Promise<void> {
    await this.ensureLoaded();
    // Idempotency guard is now persisted too, so a webhook retry after a DO eviction
    // can't double-credit.
    const dedupKey = 'topup:' + idempotencyKey;
    if (await this.ctx.storage.get(dedupKey)) return;
    this.balance += amount;
    await this.ctx.storage.put(dedupKey, true);
    await this.persistBalance();
  }
}
