import type { IRatePlan, ModelPrice } from '../../domain/IRatePlan';
import type { RawUsage } from '../../domain/types';
import { CONFIG } from '../../config';

// Guard against float noise (e.g. 180*0.000005*100 = 0.09000000000000001) tipping
// Math.ceil up by a whole credit. Subtract a sub-credit epsilon before ceiling so
// only a genuine fractional overage rounds up.
const CEIL_EPSILON = 1e-9;

// Raw upstream cost in USD for this usage under this price (BEFORE markup).
// Tokens are billed per-unit: input at inputToken, output at outputToken. This is
// the fix for the old "sum(input+output) × input-rate" approximation that under-
// charged output (deepseek output ≈ 4× input). Audio/images use their single rate.
export function rawCostUsd(usage: RawUsage, price: ModelPrice): number {
  const r = price.rates;
  if (usage.kind === 'audio_seconds') return usage.amount * (r.audioSecond ?? 0);
  if (usage.kind === 'images') return usage.amount * (r.image ?? 0);
  // tokens
  const inRate = r.inputToken ?? 0;
  const outRate = r.outputToken ?? inRate; // single-rate models: bill output at input rate
  const inTok = usage.inputTokens ?? usage.amount; // pre-split callers pass total as input
  const outTok = usage.outputTokens ?? 0;
  return inTok * inRate + outTok * outRate;
}

// Unit-aware rate plan: one implementation covers tokens, audio, and images. The
// former TokenBasedRatePlan / DurationBasedRatePlan are aliases of this now.
export class RatePlan implements IRatePlan {
  toCredit(usage: RawUsage, price: ModelPrice): number {
    const ex = CONFIG.creditExchangeRateUsd;
    const chargedUsd = Math.max(
      rawCostUsd(usage, price) * price.markupMultiplier,
      price.minChargeCredits * ex,
    );
    return Math.ceil(chargedUsd / ex - CEIL_EPSILON);
  }
}

// Back-compat aliases (both modalities now share one unit-aware plan).
export { RatePlan as TokenBasedRatePlan, RatePlan as DurationBasedRatePlan };
