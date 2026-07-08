import type { Modality, RawUsage } from './types';

// Raw upstream USD cost per billable unit. A model only sets the units it uses:
// LLM/vision set inputToken + outputToken; ASR sets audioSecond; images set image.
export interface ModelRates {
  inputToken?: number;   // USD per input/prompt token
  outputToken?: number;  // USD per output/completion token
  audioSecond?: number;  // USD per second of audio
  image?: number;        // USD per image
}

// Resolved price for one (provider, model, modality). Replaces the old per-row
// PriceBookEntry: one object now carries every unit rate for the model so the
// rate plan can bill input and output at their own rates in a single pass.
export interface ModelPrice {
  provider: string;
  model: string;
  modality: Modality;
  rates: ModelRates;
  markupMultiplier: number;  // applied on top of raw upstream cost
  minChargeCredits: number;  // floor per call, in credits
}

export interface IPriceBook {
  getEntry(provider: string, model: string, modality: Modality, at: number): Promise<ModelPrice | null>;
}

export interface IRatePlan {
  toCredit(usage: RawUsage, price: ModelPrice): number;
}
