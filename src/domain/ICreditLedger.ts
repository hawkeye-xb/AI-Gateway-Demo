export interface ICreditLedger {
  reserve(accountId: string, estimatedCredit: number, idempotencyKey: string): Promise<string>;
  settle(reservationId: string, actualCredit: number): Promise<void>;
  release(reservationId: string): Promise<void>;
  getBalance(accountId: string): Promise<number>;
  topUp(accountId: string, amount: number, idempotencyKey: string): Promise<void>;
}
