import type { ITransportAdapter } from '../../domain/ITransportAdapter';
import type { NormalizedRequest, NormalizedResponse } from '../../domain/types';

export class HttpTransportAdapter implements ITransportAdapter {
  async parse(raw: unknown): Promise<NormalizedRequest> {
    const req = raw as Request;
    const body = await req.json() as Record<string, unknown>;
    return {
      requestId: crypto.randomUUID(),
      token: (req.headers.get('Authorization') || '').replace('Bearer ', ''),
      modality: body.modality as NormalizedRequest['modality'],
      model: body.model as string,
      providerKey: body.providerKey as string,
      streaming: (body.streaming as boolean) || false,
      payload: body.payload,
    };
  }

  async respond(result: NormalizedResponse): Promise<Response> {
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  errorResponse(message: string, status: number): Response {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
