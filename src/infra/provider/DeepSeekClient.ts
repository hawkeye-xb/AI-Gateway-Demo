import type {
  IAiProviderClient,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
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

  async invokeStream(req: ProviderRequest): Promise<ReadableStream<ProviderStreamChunk>> {
    const body = { ...(req.input as Record<string, unknown>), stream: true };
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
      if (resp.status >= 500) throw new ProviderUnavailableError(`DeepSeek SSE error ${resp.status}: ${errText}`);
      throw new ClientInputError(`DeepSeek SSE error ${resp.status}: ${errText}`);
    }

    if (!resp.body) throw new ProviderUnavailableError('DeepSeek: no response body');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalTokens = 0;

    return new ReadableStream<ProviderStreamChunk>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.enqueue({
              raw: null,
              isFinal: true,
              usage: { kind: 'tokens', amount: totalTokens },
            });
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              controller.enqueue({
                raw: null,
                isFinal: true,
                usage: { kind: 'tokens', amount: totalTokens },
              });
              controller.close();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const choice = parsed.choices?.[0];
              if (choice?.delta?.content) totalTokens++;
              controller.enqueue({ raw: parsed, isFinal: false });
            } catch { /* skip malformed SSE */ }
          }
        } catch (e) {
          controller.error(e);
        }
      },
    });
  }
}
