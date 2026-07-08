// ── Shared domain types ──

export type Modality = 'llm' | 'vision' | 'asr' | 'tts';

export interface RawUsage {
  kind: 'tokens' | 'audio_seconds' | 'images';
  amount: number;          // total billable units (kept for audit + single-rate paths)
  inputTokens?: number;    // tokens kind: prompt/input tokens (billed at input rate)
  outputTokens?: number;   // tokens kind: completion/output tokens (billed at output rate)
  meta?: unknown;
}

export interface NormalizedRequest {
  requestId: string;
  token: string;
  modality: Modality;
  model: string;
  providerKey: string;
  streaming: boolean;
  payload: unknown;
}

export interface NormalizedResponse {
  raw: unknown;
  cost: number; // credits charged
}

export interface ResponseChunk {
  raw: unknown;
  isFinal: boolean;
}

export interface Identity {
  userId: string;
  tier: string;
  raw: Record<string, unknown>;
}

export interface BillingAccount {
  accountId: string;
  type: 'personal' | 'team';
  planMode: 'prepaid' | 'subscription' | 'hybrid';
}
