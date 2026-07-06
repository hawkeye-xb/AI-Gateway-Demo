import { DurableObject } from 'cloudflare:workers';
import type { ICreditLedger } from '../../domain/ICreditLedger';

interface Reservation {
  amount: number;
  createdAt: number;
}

export class CreditLedger extends DurableObject implements ICreditLedger {
  private balance = 0;
  private reservations = new Map<string, Reservation>();
  private processedTopUps = new Set<string>();

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
    if (this.reservations.has(idempotencyKey)) {
      return idempotencyKey;
    }
    if (this.balance + estimatedCredit < 0) {
      throw new Error(`insufficient balance: ${this.balance} < ${estimatedCredit}`);
    }
    this.reservations.set(idempotencyKey, { amount: estimatedCredit, createdAt: Date.now() });
    return idempotencyKey;
  }

  async settle(reservationId: string, actualCredit: number): Promise<void> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new Error(`reservation ${reservationId} not found`);
    this.balance -= actualCredit;
    this.reservations.delete(reservationId);
  }

  async release(reservationId: string): Promise<void> {
    this.reservations.delete(reservationId);
  }

  async getBalance(accountId: string): Promise<number> {
    return this.balance;
  }

  async topUp(accountId: string, amount: number, idempotencyKey: string): Promise<void> {
    if (this.processedTopUps.has(idempotencyKey)) return;
    this.balance += amount;
    this.processedTopUps.add(idempotencyKey);
  }
}
