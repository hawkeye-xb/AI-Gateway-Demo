import type { IUsageExtractor } from '../../domain/IUsageExtractor';
import type { ProviderResponse, ProviderStreamChunk } from '../../domain/IAiProviderClient';
import type { RawUsage } from '../../domain/types';

export class TokenUsageExtractor implements IUsageExtractor {
  extract(resp: ProviderResponse | ProviderStreamChunk): RawUsage {
    if (!resp.usage) return { kind: 'tokens', amount: 0 };
    return resp.usage;
  }
}

export class AudioDurationExtractor implements IUsageExtractor {
  extract(resp: ProviderResponse | ProviderStreamChunk): RawUsage {
    if (!resp.usage) return { kind: 'audio_seconds', amount: 0 };
    return resp.usage;
  }
}
