import type { Modality } from '../../domain/types';
import type { IPriceBook, PriceBookEntry } from '../../domain/IRatePlan';

export class D1PriceBook implements IPriceBook {
  constructor(private db: D1Database) {}

  async getEntry(
    provider: string,
    model: string,
    modality: Modality,
    at: number,
  ): Promise<PriceBookEntry | null> {
    const result = await this.db.prepare(
      `SELECT provider, model, modality, unit, raw_cost_per_unit, markup_multiplier, min_charge_per_call, effective_from
       FROM price_book
       WHERE provider = ? AND model = ? AND modality = ? AND effective_from <= ?
       ORDER BY effective_from DESC,
         CASE unit
           WHEN 'input_token'  THEN 0
           WHEN 'audio_second' THEN 0
           WHEN 'output_token' THEN 1
           WHEN 'image'        THEN 3
           ELSE 2
         END
       LIMIT 1`
    ).bind(provider, model, modality, at).first<Record<string, unknown>>();

    if (!result) return null;
    return {
      provider: result.provider as string,
      model: result.model as string,
      modality: result.modality as Modality,
      unit: result.unit as PriceBookEntry['unit'],
      rawCostPerUnit: result.raw_cost_per_unit as number,
      markupMultiplier: result.markup_multiplier as number,
      minChargePerCall: result.min_charge_per_call as number,
      effectiveFrom: result.effective_from as number,
    };
  }
}
