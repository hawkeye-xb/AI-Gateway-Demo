import type { Modality } from '../../domain/types';
import type { IPriceBook, ModelPrice, ModelRates } from '../../domain/IRatePlan';

const UNIT_TO_RATE: Record<string, keyof ModelRates> = {
  input_token: 'inputToken',
  output_token: 'outputToken',
  audio_second: 'audioSecond',
  image: 'image',
};

// Alternative price source: reads rates from the D1 `price_book` table so an
// operator can change prices with a SQL UPDATE (no redeploy). ConfigPriceBook is
// the default (fork-friendly, single file); this is the runtime-editable option —
// swap it in one line in buildUseCase(). Assembles all unit rows for a model into
// one ModelPrice so input/output are billed at their own rates (same as config).
export class D1PriceBook implements IPriceBook {
  constructor(private db: D1Database) {}

  async getEntry(
    provider: string,
    model: string,
    modality: Modality,
    at: number,
  ): Promise<ModelPrice | null> {
    const res = await this.db.prepare(
      `SELECT unit, raw_cost_per_unit, markup_multiplier, min_charge_per_call, effective_from
       FROM price_book
       WHERE provider = ? AND model = ? AND modality = ? AND effective_from <= ?
       ORDER BY effective_from DESC`
    ).bind(provider, model, modality, at).all<Record<string, unknown>>();

    const rows = res.results ?? [];
    if (rows.length === 0) return null;

    const rates: ModelRates = {};
    const seen = new Set<string>();
    let markupMultiplier = 1;
    let minChargeCredits = 1;
    let primaryChosen = false;

    // Rows are DESC by effective_from → first occurrence of each unit is newest.
    for (const row of rows) {
      const unit = row.unit as string;
      const key = UNIT_TO_RATE[unit];
      if (!key || seen.has(unit)) continue;
      seen.add(unit);
      rates[key] = row.raw_cost_per_unit as number;
      // Take markup/min-charge from the base unit (input_token / audio_second) so
      // a stray per-image row can't set the model's markup.
      if (!primaryChosen || unit === 'input_token' || unit === 'audio_second') {
        markupMultiplier = row.markup_multiplier as number;
        minChargeCredits = row.min_charge_per_call as number;
        primaryChosen = true;
      }
    }

    return { provider, model, modality, rates, markupMultiplier, minChargeCredits };
  }
}
