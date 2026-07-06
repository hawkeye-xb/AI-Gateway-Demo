import type { Modality, RawUsage } from './types';

export interface ProviderRequest {
  model: string;
  modality: Modality;
  input: unknown;
}

export interface ProviderResponse {
  raw: unknown;
  usage: RawUsage;
}

export interface ProviderStreamChunk {
  raw: unknown;
  isFinal: boolean;
  usage?: RawUsage;
}

// ── Error hierarchy ──

export abstract class ProviderCallError extends Error {
  abstract readonly retryable: boolean;
  abstract readonly releaseReservation: boolean;
}

export class ClientInputError extends ProviderCallError {
  readonly retryable = false;
  readonly releaseReservation = true;
}

export class ProviderUnavailableError extends ProviderCallError {
  readonly retryable = true;
  readonly releaseReservation = true;
}

export class UpstreamRateLimitedError extends ProviderCallError {
  readonly retryable = true;
  readonly releaseReservation = true;
}

export class PartialFailureError extends ProviderCallError {
  readonly retryable = false;
  readonly releaseReservation = false;
  constructor(
    message: string,
    public partialUsage: RawUsage,
  ) {
    super(message);
    this.name = 'PartialFailureError';
  }
}

// ── File input types ──

export interface FileRef {
  fileId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
}

export type ProviderFileInput =
  | { kind: 'provider_file_id'; value: string }
  | { kind: 'url'; value: string }
  | { kind: 'inline_base64'; value: string };

// ── Interface ──

export interface IAiProviderClient {
  invoke(req: ProviderRequest): Promise<ProviderResponse>;
  invokeStream?(req: ProviderRequest): Promise<ReadableStream<ProviderStreamChunk>>;
  prepareFileInput?(fileRef: FileRef): Promise<ProviderFileInput>;
}
