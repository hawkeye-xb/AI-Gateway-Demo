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
