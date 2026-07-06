import type { RawUsage } from './types';
import type { ProviderResponse, ProviderStreamChunk } from './IAiProviderClient';

export interface IUsageExtractor {
  extract(resp: ProviderResponse | ProviderStreamChunk): RawUsage;
}
