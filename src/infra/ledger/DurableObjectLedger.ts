import { DurableObject } from 'cloudflare:workers';
import type { ICreditLedger } from '../../domain/ICreditLedger';
import { CONFIG } from '../../config';

interface Reservation {
  amount: number;
  createdAt: number;
}

// New DO instances (and demo users) start with this balance so the demo works
// out of the box. Granted exactly once per user, guarded by the 'initialized' flag.
const DEMO_INITIAL_CREDITS = CONFIG.ledger.initialCredits;

export class CreditLedger extends DurableObject implements ICreditLedger {
  // In-memory cache of the persisted balance. NEVER trust this before ensureLoaded().
  private balance = 0;
  // Reservations are now PERSISTED (see below). This map is a loaded cache of the
  // 'reservations' storage key. It must survive DO eviction because a realtime ASR
  // session reserves at connect and settles many seconds later, with NO ledger-DO
  // activity in between — long enough for the DO to be evicted mid-session.
  private reservations = new Map<string, Reservation>();
  private loaded = false;

  // Abandoned reservations (session died before settle) would otherwise hold balance
  // forever. Ignore + prune any older than this when reserving.
  private static readonly RESERVATION_TTL_MS = 60 * 60 * 1000; // 1 hour

  // ── Per-user rate limiting ───────────────────────────────────
  // In test mode Creem top-ups are effectively free, so credit balance ALONE can
  // never cap abuse: a farmer can mint unlimited credits (or unlimited accounts,
  // each seeded with DEMO_INITIAL_CREDITS). Every billable call — chat, vision,
  // offline ASR, one hold per realtime ASR session — funnels through reserve(),
  // so throttling here bounds REAL upstream $ spend per user regardless of how
  // many free credits they farm. Two windows: a per-minute burst guard (blocks
  // scripted floods) and a per-day ceiling (blocks slow-drip grinding).
  private static readonly MAX_REQ_PER_MIN = CONFIG.ledger.rateLimit.perMinute;
  private static readonly MAX_REQ_PER_DAY = CONFIG.ledger.rateLimit.perDay;
  // Balance ceiling: test-mode Creem lets anyone complete unlimited free "test"
  // checkouts, each firing a top-up webhook. Clamping the balance makes farming
  // pointless (you can't mint a billion credits) while staying idempotent-safe —
  // we clamp the stored balance rather than rejecting, so a webhook is never
  // errored into an infinite Creem retry loop.
  private static readonly MAX_BALANCE_CREDITS = CONFIG.ledger.maxBalanceCredits;

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const minuteKey = Math.floor(now / 60_000);   // current epoch-minute
    const dayKey = Math.floor(now / 86_400_000);  // current epoch-day (UTC)
    const rl = (await this.ctx.storage.get<{ minKey: number; minCount: number; dayKey: number; dayCount: number }>('ratelimit'))
      ?? { minKey: minuteKey, minCount: 0, dayKey, dayCount: 0 };
    if (rl.minKey !== minuteKey) { rl.minKey = minuteKey; rl.minCount = 0; }
    if (rl.dayKey !== dayKey) { rl.dayKey = dayKey; rl.dayCount = 0; }
    if (rl.minCount >= CreditLedger.MAX_REQ_PER_MIN) {
      throw new Error(`rate limit: max ${CreditLedger.MAX_REQ_PER_MIN} requests/minute — slow down`);
    }
    if (rl.dayCount >= CreditLedger.MAX_REQ_PER_DAY) {
      throw new Error(`rate limit: daily quota of ${CreditLedger.MAX_REQ_PER_DAY} requests reached — resets at UTC midnight`);
    }
    rl.minCount++;
    rl.dayCount++;
    await this.ctx.storage.put('ratelimit', rl);
  }

  // ── Persistence ──────────────────────────────────────────────
  // The previous version kept `balance` in a plain instance field that reset to 0
  // every time the DO was evicted from memory (routine, after seconds/minutes of
  // inactivity) or on every `wrangler deploy`. That silently wiped top-ups and let
  // the balance drift negative. Balance now lives in this.ctx.storage (durable).
  //
  // Reservations were ALSO memory-only, which broke reserve→settle across an
  // eviction (realtime streaming sessions): settle couldn't find the reservation
  // and threw, so the charge + audit row were silently dropped. They're persisted
  // under the 'reservations' key now.
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
    const storedRes = await this.ctx.storage.get<Record<string, Reservation>>('reservations');
    if (storedRes) this.reservations = new Map(Object.entries(storedRes));
    this.loaded = true;
  }

  private async persistBalance(): Promise<void> {
    await this.ctx.storage.put('balance', this.balance);
  }

  private async persistReservations(): Promise<void> {
    await this.ctx.storage.put('reservations', Object.fromEntries(this.reservations));
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
        case 'snapshot':
          result = await this.snapshot();
          break;
        case 'topUp':
          await this.topUp(args[0] as string, args[1] as number, args[2] as string);
          break;
        case 'deduct':
          await this.deduct(args[0] as string, args[1] as number, args[2] as string);
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
    // Throttle AFTER the idempotency short-circuit so a client retry of the SAME
    // request never burns a rate-limit slot — only genuinely new calls count.
    await this.enforceRateLimit();
    // Prune abandoned reservations so a died-mid-session hold can't lock balance forever.
    const now = Date.now();
    let pruned = false;
    for (const [k, r] of this.reservations) {
      if (now - r.createdAt > CreditLedger.RESERVATION_TTL_MS) { this.reservations.delete(k); pruned = true; }
    }
    // Available = persisted balance minus everything currently held by open reservations.
    // Previous guard `balance + estimatedCredit < 0` never triggered (estimatedCredit is
    // positive), so it provided no protection and the balance could go negative freely.
    const outstanding = [...this.reservations.values()].reduce((s, r) => s + r.amount, 0);
    const available = this.balance - outstanding;
    if (available - estimatedCredit < 0) {
      if (pruned) await this.persistReservations();
      throw new Error(`insufficient balance: available ${available} < required ${estimatedCredit}`);
    }
    this.reservations.set(idempotencyKey, { amount: estimatedCredit, createdAt: now });
    await this.persistReservations();
    return idempotencyKey;
  }

  async settle(reservationId: string, actualCredit: number): Promise<void> {
    await this.ensureLoaded();
    // Tolerant by design: even if the reservation is somehow missing (expired/pruned),
    // still apply the real charge so billing + the audit row are never silently dropped.
    // The caller (relay / use case) guarantees settle runs at most once per reservation.
    const had = this.reservations.delete(reservationId);
    this.balance = Math.max(0, this.balance - actualCredit);
    await this.persistBalance();
    if (had) await this.persistReservations();
  }

  async release(reservationId: string): Promise<void> {
    await this.ensureLoaded();
    if (this.reservations.delete(reservationId)) {
      await this.persistReservations();
    }
  }

  async getBalance(_accountId: string): Promise<number> {
    await this.ensureLoaded();
    return this.balance;
  }

  // Read-only snapshot for the UI: balance plus how much of today's request quota
  // is used. Never mutates — reading it does NOT consume a rate-limit slot.
  async snapshot(): Promise<{ balance: number; dayUsed: number; dayLimit: number; minLimit: number; maxBalance: number }> {
    await this.ensureLoaded();
    const dayKey = Math.floor(Date.now() / 86_400_000);
    const rl = await this.ctx.storage.get<{ minKey: number; minCount: number; dayKey: number; dayCount: number }>('ratelimit');
    const dayUsed = rl && rl.dayKey === dayKey ? rl.dayCount : 0;
    return {
      balance: this.balance,
      dayUsed,
      dayLimit: CreditLedger.MAX_REQ_PER_DAY,
      minLimit: CreditLedger.MAX_REQ_PER_MIN,
      maxBalance: CreditLedger.MAX_BALANCE_CREDITS,
    };
  }

  async topUp(_accountId: string, amount: number, idempotencyKey: string): Promise<void> {
    await this.ensureLoaded();
    // Idempotency guard is now persisted too, so a webhook retry after a DO eviction
    // can't double-credit.
    const dedupKey = 'topup:' + idempotencyKey;
    if (await this.ctx.storage.get(dedupKey)) return;
    // Clamp at the ceiling so unlimited free test-mode checkouts can't mint an
    // absurd balance. Idempotency-safe: we always mark the event processed, so
    // Creem never retries a clamped top-up into a loop.
    this.balance = Math.min(this.balance + amount, CreditLedger.MAX_BALANCE_CREDITS);
    await this.ctx.storage.put(dedupKey, true);
    await this.persistBalance();
  }

  // Reverse a top-up (refund / chargeback). Mirror of topUp: idempotent via a
  // persisted 'deduct:' key so a webhook retry can't double-deduct, and clamped
  // at 0 because the user may already have spent some of the refunded credits —
  // a refund must never drive the balance negative.
  async deduct(_accountId: string, amount: number, idempotencyKey: string): Promise<void> {
    await this.ensureLoaded();
    const dedupKey = 'deduct:' + idempotencyKey;
    if (await this.ctx.storage.get(dedupKey)) return;
    this.balance = Math.max(0, this.balance - amount);
    await this.ctx.storage.put(dedupKey, true);
    await this.persistBalance();
  }
}
