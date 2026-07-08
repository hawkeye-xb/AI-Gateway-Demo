import type { Modality } from '../../domain/types';
import type { IPriceBook, ModelPrice } from '../../domain/IRatePlan';
import { lookupModelPrice } from '../../config';

// Default price source: reads rates straight from src/config.ts. A fork editor
// customizes pricing by editing ONE typed file — no SQL, no migration. Because it
// implements IPriceBook, swapping between this and D1PriceBook is a one-line change
// in buildUseCase() (and AsrRelay). getEntry returns null only if a model is truly
// absent from config; callers fail loud rather than silently mis-billing.
export class ConfigPriceBook implements IPriceBook {
  async getEntry(
    provider: string,
    model: string,
    modality: Modality,
    _at: number,
  ): Promise<ModelPrice | null> {
    return lookupModelPrice(provider, model, modality);
  }
}
