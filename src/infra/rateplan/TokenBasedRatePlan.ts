import type { PriceBookEntry, IRatePlan } from '../../domain/IRatePlan';
import type { RawUsage } from '../../domain/types';

// CREDIT_EXCHANGE_RATE: 1 credit = $0.0001 USD
const CREDIT_EXCHANGE_RATE = 0.0001;

export class TokenBasedRatePlan implements IRatePlan {
  toCredit(usage: RawUsage, entry: PriceBookEntry): number {
    const rawCostUsd = usage.amount * entry.rawCostPerUnit;
    const chargedUsd = Math.max(rawCostUsd * entry.markupMultiplier, entry.minChargePerCall * CREDIT_EXCHANGE_RATE);
    return Math.ceil(chargedUsd / CREDIT_EXCHANGE_RATE); // integer credits
  }
}

export class DurationBasedRatePlan implements IRatePlan {
  toCredit(usage: RawUsage, entry: PriceBookEntry): number {
    const rawCostUsd = usage.amount * entry.rawCostPerUnit;
    const chargedUsd = Math.max(rawCostUsd * entry.markupMultiplier, entry.minChargePerCall * CREDIT_EXCHANGE_RATE);
    return Math.ceil(chargedUsd / CREDIT_EXCHANGE_RATE);
  }
}
