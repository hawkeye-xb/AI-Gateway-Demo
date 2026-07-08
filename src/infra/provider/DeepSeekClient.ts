import type {
  IAiProviderClient,
  ProviderRequest,
  ProviderResponse,
} from '../../domain/IAiProviderClient';
import {
  ClientInputError,
  ProviderUnavailableError,
  UpstreamRateLimitedError,
  PartialFailureError,
} from '../../domain/IAiProviderClient';
import type { RawUsage } from '../../domain/types';

export class DeepSeekClient implements IAiProviderClient {
  private baseUrl = 'https://api.deepseek.com/v1';

  constructor(private apiKey: string) {}

  async invoke(req: ProviderRequest): Promise<ProviderResponse> {
    const body = req.input as Record<string, unknown>;
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'unknown');
      if (resp.status === 429) throw new UpstreamRateLimitedError(`DeepSeek rate limited: ${errText}`);
      if (resp.status >= 500) throw new ProviderUnavailableError(`DeepSeek server error ${resp.status}: ${errText}`);
      throw new ClientInputError(`DeepSeek error ${resp.status}: ${errText}`);
    }

    const data = await resp.json() as Record<string, unknown>;
    const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
    const finishReason = choice?.finish_reason as string;
    const usageData = data.usage as Record<string, number> | undefined;

    // Handle partial completion
    if (finishReason === 'length' && usageData) {
      throw new PartialFailureError(
        'response truncated by max_tokens',
        {
          kind: 'tokens',
          amount: (usageData.prompt_tokens || 0) + (usageData.completion_tokens || 0),
          inputTokens: usageData.prompt_tokens || 0,
          outputTokens: usageData.completion_tokens || 0,
          meta: usageData,
        },
      );
    }

    const usage: RawUsage = {
      kind: 'tokens',
      amount: usageData ? (usageData.prompt_tokens || 0) + (usageData.completion_tokens || 0) : 0,
      inputTokens: usageData?.prompt_tokens || 0,
      outputTokens: usageData?.completion_tokens || 0,
      meta: usageData,
    };

    return { raw: data, usage };
  }

  // NOTE: streaming LLM was intentionally removed. The previous invokeStream had
  // no caller (dead code) AND its usage lacked the input/output token split, so it
  // would have billed a stream at the input rate — the exact approximation the
  // synchronous path was fixed to avoid. If you wire streaming, populate
  // RawUsage.inputTokens/outputTokens from the final chunk before billing.
}
