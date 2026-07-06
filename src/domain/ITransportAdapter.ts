import type { NormalizedRequest, NormalizedResponse, ResponseChunk } from './types';

export interface ITransportAdapter {
  parse(raw: unknown): Promise<NormalizedRequest>;
  respond(result: NormalizedResponse): Promise<Response | void>;
  pushChunk?(chunk: ResponseChunk): Promise<void>;
}
