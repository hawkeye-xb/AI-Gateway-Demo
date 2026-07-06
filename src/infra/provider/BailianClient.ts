import type {
  IAiProviderClient,
  ProviderRequest,
  ProviderResponse,
  FileRef,
  ProviderFileInput,
} from '../../domain/IAiProviderClient';
import {
  ClientInputError,
  ProviderUnavailableError,
} from '../../domain/IAiProviderClient';
import type { RawUsage, Modality } from '../../domain/types';

// Bailian (DashScope) supports multiple modalities under one API key.
// LLM: text-generation, Vision: multimodal-generation, ASR: speech recognition.
export class BailianClient implements IAiProviderClient {
  private baseUrl = 'https://dashscope.aliyuncs.com/api/v1';

  constructor(private apiKey: string) {}

  async invoke(req: ProviderRequest): Promise<ProviderResponse> {
    switch (req.modality) {
      case 'llm':
        return this.invokeLlm(req);
      case 'vision':
        return this.invokeVision(req);
      case 'asr':
        return this.invokeAsr(req);
      default:
        throw new ClientInputError(`Bailian: unsupported modality ${req.modality}`);
    }
  }

  private async invokeLlm(req: ProviderRequest): Promise<ProviderResponse> {
    const body = req.input as Record<string, unknown>;
    const resp = await fetch(`${this.baseUrl}/services/aigc/text-generation/generation`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'unknown');
      if (resp.status >= 500) throw new ProviderUnavailableError(`Bailian LLM error ${resp.status}: ${errText}`);
      throw new ClientInputError(`Bailian LLM error ${resp.status}: ${errText}`);
    }
    const data = await resp.json() as Record<string, unknown>;
    const output = data.output as Record<string, unknown> | undefined;
    const usageData = data.usage as Record<string, number> | undefined;
    const usage: RawUsage = {
      kind: 'tokens',
      amount: usageData ? (usageData.input_tokens || 0) + (usageData.output_tokens || 0) : 0,
      meta: usageData,
    };
    return { raw: { output, usage: usageData }, usage };
  }

  private async invokeVision(req: ProviderRequest): Promise<ProviderResponse> {
    const body = req.input as Record<string, unknown>;
    const resp = await fetch(`${this.baseUrl}/services/aigc/multimodal-generation/generation`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'unknown');
      if (resp.status >= 500) throw new ProviderUnavailableError(`Bailian Vision error ${resp.status}: ${errText}`);
      throw new ClientInputError(`Bailian Vision error ${resp.status}: ${errText}`);
    }
    const data = await resp.json() as Record<string, unknown>;
    const output = data.output as Record<string, unknown> | undefined;
    const usageData = data.usage as Record<string, number> | undefined;
    const usage: RawUsage = {
      kind: 'tokens',
      amount: usageData ? (usageData.input_tokens || 0) + (usageData.output_tokens || 0) : 0,
      meta: usageData,
    };
    return { raw: { output, usage: usageData }, usage };
  }

  private async invokeAsr(req: ProviderRequest): Promise<ProviderResponse> {
    const body = req.input as Record<string, unknown>;
    const resp = await fetch(`${this.baseUrl}/services/audio/asr/transcription`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'unknown');
      if (resp.status >= 500) throw new ProviderUnavailableError(`Bailian ASR error ${resp.status}: ${errText}`);
      throw new ClientInputError(`Bailian ASR error ${resp.status}: ${errText}`);
    }
    const data = await resp.json() as Record<string, unknown>;
    const output = data.output as Record<string, unknown> | undefined;
    // ASR models report duration, not tokens
    const durationSec = ((output?.duration_ms as number) || 0) / 1000;
    const usage: RawUsage = {
      kind: 'audio_seconds',
      amount: durationSec,
      meta: data.usage || {},
    };
    return { raw: { output, text: output?.text }, usage };
  }

  async prepareFileInput(fileRef: FileRef): Promise<ProviderFileInput> {
    // For demo: use inline base64 for small files, URL for larger ones
    if (fileRef.sizeBytes < 5 * 1024 * 1024 && fileRef.mimeType.startsWith('image/')) {
      // For demo simplicity, assume the caller passes base64 in the payload directly
      // Real implementation would read from R2
      return { kind: 'inline_base64', value: '' };
    }
    return { kind: 'url', value: '' };
  }
}
