import type { Modality, RawUsage } from './types';

export interface PriceBookEntry {
  provider: string;
  model: string;
  modality: Modality;
  unit: 'input_token' | 'output_token' | 'audio_second' | 'image';
  rawCostPerUnit: number;
  markupMultiplier: number;
  minChargePerCall: number;
  effectiveFrom: number;
}

export interface IPriceBook {
  getEntry(provider: string, model: string, modality: Modality, at: number): Promise<PriceBookEntry | null>;
}

export interface IRatePlan {
  toCredit(usage: RawUsage, entry: PriceBookEntry): number;
}
