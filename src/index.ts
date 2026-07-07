import { HTML } from './ui';
import { AiCallUseCase } from './usecase/AiCallUseCase';
import { SupabaseJwtAuthProvider } from './infra/auth/SupabaseJwtAuthProvider';
import { DeepSeekClient } from './infra/provider/DeepSeekClient';
import { BailianClient } from './infra/provider/BailianClient';
import { HttpTransportAdapter } from './infra/transport/HttpTransportAdapter';
import { D1AuditSink } from './infra/audit/D1AuditSink';
import { D1PriceBook } from './infra/pricebook/D1PriceBook';
import { TokenBasedRatePlan } from './infra/rateplan/TokenBasedRatePlan';
import { TokenUsageExtractor, AudioDurationExtractor } from './infra/usage/TokenUsageExtractor';
import { CreditLedger } from './infra/ledger/DurableObjectLedger';
import { CreditLedgerStub } from './infra/ledger/CreditLedgerStub';
import { handleAsrStream } from './realtime/AsrRelay';
import type { IAiProviderClient } from './domain/IAiProviderClient';

export { CreditLedger };

interface Env {
  DB: D1Database;
  CREDIT_LEDGER: DurableObjectNamespace<CreditLedger>;
  DEEPSEEK_API_KEY: string;
  BAILIAN_API_KEY: string;
  SUPABASE_JWKS_URL: string;
  SUPABASE_PROJECT_URL: string;
  SUPABASE_ANON_KEY: string;
  CREEM_API_KEY: string;
  CREEM_WEBHOOK_SECRET: string;
  CREEM_PRODUCT_ID: string;
}

// ── Verified auth ──
// A single module-scoped JWKS verifier. jose caches keys per instance, so we must
// NOT recreate it per request (that refetches the JWKS every time and risks rate
// limiting). Every authenticated route verifies the Supabase JWT signature — a
// decoded-but-unverified `sub` is NOT trusted, otherwise anyone could forge a token
// to read another user's data or bill AI calls to someone else's account.
let _authProvider: SupabaseJwtAuthProvider | undefined;
function getAuth(env: Env): SupabaseJwtAuthProvider {
  if (!_authProvider) _authProvider = new SupabaseJwtAuthProvider(env.SUPABASE_JWKS_URL);
  return _authProvider;
}

function bearer(request: Request): string {
  return (request.headers.get('Authorization') || '').replace('Bearer ', '');
}

// Verify a Supabase JWT (signature + sub) and return the authenticated userId, or null.
async function verifyUserId(token: string, env: Env): Promise<string | null> {
  if (!token) return null;
  try {
    return (await getAuth(env).verify(token)).userId;
  } catch {
    return null;
  }
}

// Verify Creem's webhook signature: an HMAC-SHA256 hex digest of the raw request
// body, keyed by the webhook secret, delivered in the `creem-signature` header.
// Without this, anyone who knows the URL could POST a fake checkout.completed and
// credit any account for free.
async function verifyCreemSignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Constant-time compare to avoid timing side-channels.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// ── DI ──
function buildUseCase(env: Env, userId: string): AiCallUseCase {
  const auth = new SupabaseJwtAuthProvider(env.SUPABASE_JWKS_URL);
  const ledger = new CreditLedgerStub(env.CREDIT_LEDGER, userId);
  const providers = new Map<string, IAiProviderClient>([
    ['deepseek', new DeepSeekClient(env.DEEPSEEK_API_KEY)],
    ['bailian', new BailianClient(env.BAILIAN_API_KEY)],
  ]);
  const usageExtractors = new Map([
    ['llm', new TokenUsageExtractor()],
    ['vision', new TokenUsageExtractor()],
    ['asr', new AudioDurationExtractor()],
  ]);
  const priceBook = new D1PriceBook(env.DB);
  const ratePlan = new TokenBasedRatePlan();
  const audit = new D1AuditSink(env.DB);
  return new AiCallUseCase(auth, ledger, providers, usageExtractors, priceBook, ratePlan, audit);
}

// ── Per-user DO stub ──
// (extracted to ./infra/ledger/CreditLedgerStub so the realtime ASR relay can
// reuse the exact same reserve/settle path.)


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, creem-signature',
        },
      });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      // Inject public Supabase config from env so the whole app is configured in
      // one place (wrangler.toml [vars]); no project-specific values are baked into
      // the client source.
      const html = HTML
        .replace('__SUPABASE_URL__', env.SUPABASE_PROJECT_URL)
        .replace('__SUPABASE_ANON_KEY__', env.SUPABASE_ANON_KEY);
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── Realtime ASR (WebSocket) ──
    // Browsers can't set Authorization headers on a WebSocket, so the Supabase JWT
    // is passed as ?token=. It is signature-verified here (not merely decoded) — a
    // realtime session bills a real account, so an unverified sub could drain
    // someone else's credits.
    if (url.pathname === '/api/asr/stream') {
      const userId = await verifyUserId(url.searchParams.get('token') || '', env);
      if (!userId) return new Response('unauthorized', { status: 401 });
      return handleAsrStream(request, env, userId);
    }

    // ── AI call ──
    if (url.pathname === '/api/ai/run') {
      const userId = await verifyUserId(bearer(request), env);
      if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } });
      const useCase = buildUseCase(env, userId);
      try {
        return (await useCase.handle(new HttpTransportAdapter(), request)) as Response;
      } catch (e) {
        const msg = (e as Error).message;
        // Map billing/throttle failures to precise HTTP semantics: 429 for rate
        // limits, 402 for insufficient balance, 500 for everything else.
        const status = msg.startsWith('rate limit') ? 429
          : msg.startsWith('insufficient balance') ? 402
          : 500;
        const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*' };
        if (status === 429) {
          // Standard throttle signal so clients can back off: per-minute window
          // resets at the next minute boundary, the daily quota at UTC midnight.
          const now = Date.now();
          headers['Retry-After'] = String(msg.includes('/minute')
            ? Math.ceil((60_000 - (now % 60_000)) / 1000)
            : Math.ceil((86_400_000 - (now % 86_400_000)) / 1000));
        }
        return Response.json({ error: msg }, { status, headers });
      }
    }

    // ── Balance ──
    if (url.pathname === '/api/credit/balance') {
      const userId = await verifyUserId(bearer(request), env);
      if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } });
      const ledger = new CreditLedgerStub(env.CREDIT_LEDGER, userId);
      const snap = await ledger.snapshot(userId);
      return Response.json(snap, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // ── Audit log ──
    if (url.pathname === '/api/audit/log') {
      const userId = await verifyUserId(bearer(request), env);
      if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } });
      const limit = parseInt(url.searchParams.get('limit') || '20');
      // Unified timeline: spend (audit_log) + top-ups (topups), newest first.
      const result = await env.DB.prepare(
        `SELECT kind, modality, model, usage_kind, usage_amount, credits, timestamp FROM (
           SELECT 'spend' AS kind, modality, model, usage_kind, usage_amount, credits_charged AS credits, timestamp
             FROM audit_log WHERE account_id = ?
           UNION ALL
           SELECT 'topup' AS kind, 'topup' AS modality, source AS model, 'credits' AS usage_kind, credits AS usage_amount, credits, timestamp
             FROM topups WHERE account_id = ?
         ) ORDER BY timestamp DESC LIMIT ?`
      ).bind(userId, userId, limit).all();
      // D1 returns rows under `.results`; the frontend reads `d.rows`. Return `rows`
      // explicitly so the "Recent Usage" table renders instead of showing "No usage yet".
      return Response.json({ rows: result.results }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // ── Creem checkout ──
    if (url.pathname === '/api/payment/checkout') {
      const userId = await verifyUserId(bearer(request), env);
      if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } });
      try {
        let creditsMult = 1;
        try { const body = await request.json() as { credits_mult?: number }; if (body.credits_mult) creditsMult = body.credits_mult; } catch {}
        const isTestKey = env.CREEM_API_KEY.startsWith('creem_test_');
        const baseUrl = isTestKey ? 'https://test-api.creem.io/v1' : 'https://api.creem.io/v1';
        const resp = await fetch(baseUrl + '/checkouts', {
          method: 'POST',
          headers: { 'x-api-key': env.CREEM_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: env.CREEM_PRODUCT_ID,
            units: creditsMult,
            custom_price: 100,  // $1.00 per unit in cents — overrides product price
            success_url: url.origin + '/',
            metadata: { accountId: userId, requestId: crypto.randomUUID(), credits: String(creditsMult * 1000000) },
          }),
        });
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json() as { checkout_url: string };
        return Response.json({ url: data.checkout_url }, { headers: { 'Access-Control-Allow-Origin': '*' } });
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
    }

    // ── Creem webhook ──
    if (url.pathname === '/api/payment/webhook') {
      try {
        const rawBody = await request.text();
        const signature = request.headers.get('creem-signature') || '';

        // Fail-closed signature check. Reject anything without a valid HMAC so a
        // forged checkout.completed can't mint free credits.
        const valid = await verifyCreemSignature(rawBody, signature, env.CREEM_WEBHOOK_SECRET);
        if (!valid) return Response.json({ error: 'invalid signature' }, { status: 401 });

        const payload = JSON.parse(rawBody);
        const eventType = payload.eventType as string;
        const accountId = payload.object?.metadata?.accountId as string;
        const externalEventId = payload.id as string;

        if (!accountId) return Response.json({ ok: true });

        // Dedup
        const audit = new D1AuditSink(env.DB);
        const claimed = await audit.claimEvent(externalEventId, 'creem');
        if (!claimed) return Response.json({ ok: true, deduped: true });

        // Top up
        if (eventType === 'checkout.completed') {
          const credits = parseInt(payload.object?.metadata?.credits || '1000000') || 1000000;
          const ledger = new CreditLedgerStub(env.CREDIT_LEDGER, accountId);
          await ledger.topUp(accountId, credits, 'creem-' + externalEventId);
          // Record the top-up so "how much did I top up" is queryable from D1
          // (previously only the event id was stored, with no amount).
          const order = (payload.object?.order || {}) as { amount?: number; amount_paid?: number; currency?: string };
          const amountCents = order.amount ?? order.amount_paid ?? payload.object?.amount;
          await audit.recordTopUp({
            accountId,
            externalEventId,
            source: 'creem',
            credits,
            amountUsd: typeof amountCents === 'number' ? amountCents / 100 : null,
            currency: order.currency ?? null,
            timestamp: Date.now(),
          });
        }

        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500 });
      }
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  },
};
