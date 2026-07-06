import type { PriceBookEntry, IRatePlan } from '../../domain/IRatePlan';
import type { RawUsage } from '../../domain/types';

// CREDIT_EXCHANGE_RATE: 1 credit = $0.0001 USD
const CREDIT_EXCHANGE_RATE = 0.0001;
// Guard against float noise (e.g. 180*0.000005*100 = 0.09000000000000001) tipping
// Math.ceil up by a whole credit. Subtract a sub-credit epsilon before ceiling so
// only a genuine fractional overage rounds up.
const CEIL_EPSILON = 1e-9;

function toCreditFromUsd(rawCostUsd: number, entry: PriceBookEntry): number {
  const chargedUsd = Math.max(rawCostUsd * entry.markupMultiplier, entry.minChargePerCall * CREDIT_EXCHANGE_RATE);
  return Math.ceil(chargedUsd / CREDIT_EXCHANGE_RATE - CEIL_EPSILON);
}

export class TokenBasedRatePlan implements IRatePlan {
  toCredit(usage: RawUsage, entry: PriceBookEntry): number {
    return toCreditFromUsd(usage.amount * entry.rawCostPerUnit, entry);
  }
}

export class DurationBasedRatePlan implements IRatePlan {
  toCredit(usage: RawUsage, entry: PriceBookEntry): number {
    return toCreditFromUsd(usage.amount * entry.rawCostPerUnit, entry);
  }
}
