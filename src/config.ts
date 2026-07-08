import type { Modality } from './domain/types';
import type { ModelPrice, ModelRates } from './domain/IRatePlan';

// ─────────────────────────────────────────────────────────────────────────────
// THE single source of truth for all credit RULES.
//
// Fork editors: this is the ONLY file you touch to customize billing behavior.
// Everything below — the free grant, caps, rate limits, ASR bounds, per-model
// pricing, and purchase packages — lives here, not scattered across the code.
//
// What is NOT here (by design): infrastructure identity — Cloudflare account,
// D1 database id, Supabase project, and provider/Creem API keys. Those stay in
// `wrangler.toml` [vars] + `wrangler secret put`, per the README Setup section,
// because they're per-deployment secrets, not billing policy.
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelPricing {
  provider: string;
  model: string;
  modality: Modality;
  rates: ModelRates;   // raw upstream USD cost per unit
  markup?: number;     // optional per-model override of pricing.defaultMarkup
}

export interface CreditPackage {
  priceUsd: number;    // what the buyer pays
  credits: number;     // what lands in their balance
}

export interface Config {
  creditExchangeRateUsd: number;
  ledger: {
    initialCredits: number;
    maxBalanceCredits: number;
    rateLimit: { perMinute: number; perDay: number };
  };
  asr: { holdSeconds: number; maxSeconds: number };
  pricing: {
    defaultMarkup: number;
    minChargeCredits: number;
    models: ModelPricing[];
  };
  packages: Record<string, CreditPackage>;
}

export const CONFIG: Config = {
  // 1 credit = this many USD.  0.0001 → 1,000,000 credits = $1.
  creditExchangeRateUsd: 0.0001,

  ledger: {
    initialCredits: 1_000_000,       // signup grant; set 0 to disable free credits
    maxBalanceCredits: 100_000_000,  // hard balance cap ($100) — anti-farming
    rateLimit: { perMinute: 20, perDay: 500 }, // per-user, enforced in the ledger DO
  },

  // Realtime ASR session bounds (pre-authorization hold + hard cap).
  asr: { holdSeconds: 180, maxSeconds: 180 },

  pricing: {
    defaultMarkup: 100,     // demo 100x makes credit movement visible; set your real margin (e.g. 1.3)
    minChargeCredits: 1,
    // One entry per (provider, model, modality). This IS the price book.
    // deepseek output is ~4x input — billed separately, not blended.
    models: [
      { provider: 'deepseek', model: 'deepseek-chat', modality: 'llm',
        rates: { inputToken: 0.00000027, outputToken: 0.00000110 } },
      { provider: 'bailian', model: 'qwen-vl-max', modality: 'vision',
        rates: { inputToken: 0.00000050, outputToken: 0.00000200 } },
      { provider: 'bailian', model: 'qwen3-asr-flash', modality: 'asr',
        rates: { audioSecond: 0.000005 } },
      { provider: 'bailian', model: 'paraformer-realtime-v2', modality: 'asr',
        rates: { audioSecond: 0.000005 } },
    ],
  },

  // Server-side purchase packages. The client sends only a package id; the price
  // and credited amount are decided HERE, never by the browser.
  packages: {
    starter: { priceUsd: 1,  credits: 1_000_000 },
    plus:    { priceUsd: 5,  credits: 5_000_000 },
    pro:     { priceUsd: 10, credits: 10_000_000 },
    max:     { priceUsd: 50, credits: 50_000_000 },
  },
};

// Synchronous price lookup — the shared primitive behind both ConfigPriceBook
// (async wrapper for IPriceBook) and AiCallUseCase.estimate() (pre-call hold),
// so a single config drives billing AND the reservation estimate.
export function lookupModelPrice(provider: string, model: string, modality: Modality): ModelPrice | null {
  const m = CONFIG.pricing.models.find(
    (x) => x.provider === provider && x.model === model && x.modality === modality,
  );
  if (!m) return null;
  return {
    provider: m.provider,
    model: m.model,
    modality: m.modality,
    rates: m.rates,
    markupMultiplier: m.markup ?? CONFIG.pricing.defaultMarkup,
    minChargeCredits: CONFIG.pricing.minChargeCredits,
  };
}
