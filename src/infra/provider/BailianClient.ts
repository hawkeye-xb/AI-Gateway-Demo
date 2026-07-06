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

  // Offline / non-realtime ASR: synchronous recognition of an uploaded file.
  //
  // Model: qwen3-asr-flash. Unlike paraformer-v2 recorded transcription (async +
  // requires a public file URL), qwen3-asr-flash accepts inline Base64 audio and
  // returns the transcript in one synchronous multimodal-generation call — same
  // shape as the vision path. That keeps the demo free of R2/public-bucket infra.
  //
  // Input contract (from the frontend, via req.input):
  //   { audio: "data:audio/wav;base64,...."   // OR a public https URL
  //     language?: "zh" | "en" | ... }         // optional hint
  //
  // Billing: usage.seconds is the audio duration reported by DashScope. We bill
  // per audio_second, so we surface it as kind:'audio_seconds'. Falls back to
  // audio_tokens/25 (DashScope: 25 tokens per second, min 1s) if seconds is absent.
  private async invokeAsr(req: ProviderRequest): Promise<ProviderResponse> {
    const input = (req.input ?? {}) as { audio?: string; language?: string };
    const audio = input.audio;
    if (!audio) throw new ClientInputError('Bailian ASR: missing audio (expected input.audio = data URI or URL)');

    const asrOptions: Record<string, unknown> = { enable_itn: false };
    if (input.language) asrOptions.language = input.language;

    const body = {
      model: req.model, // 'qwen3-asr-flash'
      input: {
        messages: [
          { role: 'system', content: [{ text: '' }] },
          { role: 'user', content: [{ audio }] },
        ],
      },
      parameters: { asr_options: asrOptions },
    };

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
      if (resp.status >= 500) throw new ProviderUnavailableError(`Bailian ASR error ${resp.status}: ${errText}`);
      throw new ClientInputError(`Bailian ASR error ${resp.status}: ${errText}`);
    }
    const data = await resp.json() as Record<string, unknown>;
    const output = data.output as Record<string, unknown> | undefined;
    const usageData = (data.usage ?? {}) as Record<string, unknown>;

    // Duration for billing: prefer usage.seconds; else derive from audio_tokens.
    let seconds = typeof usageData.seconds === 'number' ? usageData.seconds : 0;
    if (!seconds) {
      const details = usageData.prompt_tokens_details as Record<string, unknown> | undefined;
      const audioTokens = details && typeof details.audio_tokens === 'number' ? details.audio_tokens : 0;
      if (audioTokens) seconds = Math.ceil(audioTokens / 25);
    }

    // Qwen-ASR returns the transcript as an array: choices[0].message.content = [{ text: "..." }]
    const choices = output?.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const content = message?.content;
    const text = Array.isArray(content)
      ? content.map((c) => (c && typeof (c as Record<string, unknown>).text === 'string' ? (c as Record<string, unknown>).text : '')).join('')
      : (typeof content === 'string' ? content : '');

    const usage: RawUsage = { kind: 'audio_seconds', amount: seconds, meta: usageData };
    return { raw: { output, text }, usage };
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
