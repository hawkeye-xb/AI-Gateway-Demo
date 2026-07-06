import { CreditLedgerStub } from '../infra/ledger/CreditLedgerStub';
import { D1PriceBook } from '../infra/pricebook/D1PriceBook';
import { DurationBasedRatePlan } from '../infra/rateplan/TokenBasedRatePlan';
import { D1AuditSink } from '../infra/audit/D1AuditSink';
import type { CreditLedger } from '../infra/ledger/DurableObjectLedger';
import type { PriceBookEntry } from '../domain/IRatePlan';

// ─────────────────────────────────────────────────────────────────────────────
// Realtime ASR relay: browser mic ⇄ our Worker ⇄ DashScope Paraformer WebSocket.
//
// This is the streaming counterpart to the offline (qwen3-asr-flash) path. It
// exists to demonstrate the *reserve → settle* billing lifecycle that a gateway
// needs but that the instant LLM/vision calls never really exercise:
//
//   1. On connect  → RESERVE an upfront hold (预扣). Guarantees the user can pay
//                     for at least MAX_SECONDS of audio before a single byte flows.
//   2. While live  → forward PCM frames up, forward transcripts down, and meter
//                     used-seconds/used-credits back to the client in real time.
//   3. On stop     → SETTLE the *actual* streamed duration, release the unused
//                     part of the hold, and write an audit_log row so the session
//                     shows up in "Recent Usage" like every other spend.
//
// Protocol (confirmed against Alibaba Model Studio docs, 2026-06):
//   WS URL : wss://dashscope.aliyuncs.com/api-ws/v1/inference
//   Header : Authorization: bearer <BAILIAN_API_KEY>
//   Client → run-task {task_group:audio, task:asr, function:recognition,
//                       model:paraformer-realtime-v2, parameters:{format:pcm, sample_rate:16000}}
//          → binary PCM16 frames
//          → finish-task
//   Server → task-started → result-generated (payload.output.sentence.{text,sentence_end})
//          → task-finished
// ─────────────────────────────────────────────────────────────────────────────

interface RelayEnv {
  DB: D1Database;
  CREDIT_LEDGER: DurableObjectNamespace<CreditLedger>;
  BAILIAN_API_KEY: string;
}

// Outbound WebSocket from a Cloudflare Worker uses fetch() with an https:// URL
// (NOT wss://) plus the Upgrade header; CF returns the socket on resp.webSocket.
const DASHSCOPE_WS = 'https://dashscope.aliyuncs.com/api-ws/v1/inference';
const MODEL = 'paraformer-realtime-v2';
const PROVIDER = 'bailian';
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // PCM16 mono
const BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE; // 32000

// Billing knobs. HOLD_SECONDS is the pre-authorization; MAX_SECONDS is the hard
// server-side cap so we can never deliver more audio than we reserved credits for.
const HOLD_SECONDS = 180;
const MAX_SECONDS = 180;
const MAX_BILLED_BYTES = MAX_SECONDS * BYTES_PER_SECOND;

const DEFAULT_CREDITS_PER_SECOND = 5; // fallback if price_book row is missing

function creditsForSeconds(seconds: number, entry: PriceBookEntry | null, plan: DurationBasedRatePlan): number {
  if (!entry) return Math.max(1, Math.ceil(seconds * DEFAULT_CREDITS_PER_SECOND));
  return plan.toCredit({ kind: 'audio_seconds', amount: seconds }, entry);
}

/**
 * Handle a GET /api/asr/stream WebSocket upgrade. Returns a 101 response whose
 * client socket is handed back to the browser; the server socket is driven by
 * runSession(). Auth is by ?token=<supabase jwt> (browsers can't set WS headers);
 * userId is decoded upstream in index.ts, same posture as /api/credit/balance.
 */
export function handleAsrStream(request: Request, env: RelayEnv, userId: string): Response {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('expected websocket', { status: 426 });
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  // Drive the session without blocking the 101 handshake. Any thrown error is
  // reported to the client as an error frame before closing.
  runSession(server, env, userId).catch((e) => {
    try { server.send(JSON.stringify({ type: 'error', message: (e as Error).message })); } catch { /* ignore */ }
    try { server.close(1011, 'relay error'); } catch { /* ignore */ }
  });

  return new Response(null, { status: 101, webSocket: client });
}

async function runSession(server: WebSocket, env: RelayEnv, userId: string): Promise<void> {
  const ledger = new CreditLedgerStub(env.CREDIT_LEDGER, userId);
  const priceBook = new D1PriceBook(env.DB);
  const ratePlan = new DurationBasedRatePlan();
  const audit = new D1AuditSink(env.DB);

  const entry = await priceBook.getEntry(PROVIDER, MODEL, 'asr', Date.now());
  const holdCredits = creditsForSeconds(HOLD_SECONDS, entry, ratePlan);
  const requestId = crypto.randomUUID();
  const taskId = crypto.randomUUID();

  // ── 1. Pre-authorization hold (预扣) ──────────────────────────────────────
  let reserved = false;
  try {
    await ledger.reserve(userId, holdCredits, requestId);
    reserved = true;
  } catch (e) {
    server.send(JSON.stringify({ type: 'error', code: 'insufficient_balance', message: (e as Error).message }));
    server.close(1008, 'insufficient balance');
    return;
  }

  // Session state
  let started = false;
  let finishSent = false;
  let settled = false;
  let billedBytes = 0;
  const preStartBuffer: ArrayBuffer[] = [];

  // ── Open the upstream DashScope socket ────────────────────────────────────
  let upstream: WebSocket;
  try {
    upstream = await connectUpstream(env.BAILIAN_API_KEY);
  } catch (e) {
    if (reserved) await ledger.release(requestId).catch(() => {});
    server.send(JSON.stringify({ type: 'error', message: 'upstream connect failed: ' + (e as Error).message }));
    server.close(1011, 'upstream connect failed');
    return;
  }

  const usedSeconds = () => billedBytes / BYTES_PER_SECOND;

  const settleOnce = async (reason: string): Promise<void> => {
    if (settled) return;
    settled = true;
    const seconds = usedSeconds();
    const credits = reserved ? creditsForSeconds(seconds, entry, ratePlan) : 0;
    const realCostUsd = entry ? seconds * entry.rawCostPerUnit : 0;
    try {
      if (reserved) {
        // settle deducts the real amount and frees the whole hold (releases the rest).
        await ledger.settle(requestId, credits);
        await audit.record({
          requestId,
          accountId: userId,
          modality: 'asr',
          model: MODEL,
          provider: PROVIDER,
          usage: { kind: 'audio_seconds', amount: Math.round(seconds * 100) / 100 },
          cost: credits,
          realCostUsd,
          timestamp: Date.now(),
        });
      }
      const balance = await ledger.getBalance(userId);
      safeSend(server, {
        type: 'settled',
        reason,
        seconds: Math.round(seconds * 100) / 100,
        heldCredits: holdCredits,
        credits,
        releasedCredits: Math.max(0, holdCredits - credits),
        balance,
      });
    } catch { /* best-effort */ }
    try { upstream.close(); } catch { /* ignore */ }
    try { server.close(1000, 'done'); } catch { /* ignore */ }
  };

  const sendFinish = (): void => {
    if (finishSent) return;
    finishSent = true;
    try {
      upstream.send(JSON.stringify({
        header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
        payload: { input: {} },
      }));
    } catch { /* ignore */ }
  };

  // Forward one PCM frame upstream, respecting the hard duration cap.
  const forwardAudio = (buf: ArrayBuffer): void => {
    if (finishSent) return;
    if (billedBytes + buf.byteLength > MAX_BILLED_BYTES) {
      // Send only what remains of the cap, then auto-finish.
      const remaining = MAX_BILLED_BYTES - billedBytes;
      if (remaining > 0) {
        const slice = buf.slice(0, remaining);
        upstream.send(slice);
        billedBytes += slice.byteLength;
      }
      safeSend(server, { type: 'limit', message: `reached ${MAX_SECONDS}s cap`, usedSeconds: usedSeconds() });
      sendFinish();
      return;
    }
    upstream.send(buf);
    billedBytes += buf.byteLength;
    safeSend(server, {
      type: 'meter',
      usedSeconds: Math.round(usedSeconds() * 100) / 100,
      usedCredits: creditsForSeconds(usedSeconds(), entry, ratePlan),
      heldCredits: holdCredits,
    });
  };

  // ── 2. Wire upstream (DashScope) → client ─────────────────────────────────
  upstream.addEventListener('message', (ev: MessageEvent) => {
    if (typeof ev.data !== 'string') return; // DashScope events are JSON text
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const header = (msg.header ?? {}) as Record<string, unknown>;
    const event = header.event as string | undefined;

    if (event === 'task-started') {
      started = true;
      safeSend(server, { type: 'ready', heldCredits: holdCredits });
      // Flush anything the client sent before the task was ready.
      for (const b of preStartBuffer) forwardAudio(b);
      preStartBuffer.length = 0;
      return;
    }
    if (event === 'result-generated') {
      const payload = (msg.payload ?? {}) as Record<string, unknown>;
      const output = (payload.output ?? {}) as Record<string, unknown>;
      const sentence = (output.sentence ?? {}) as Record<string, unknown>;
      const text = typeof sentence.text === 'string' ? sentence.text : '';
      const isFinal = sentence.sentence_end === true;
      if (text) safeSend(server, { type: isFinal ? 'final' : 'partial', text });
      return;
    }
    if (event === 'task-finished') {
      void settleOnce('task-finished');
      return;
    }
    if (event === 'task-failed') {
      const errMsg = (header.error_message as string) || 'task failed';
      safeSend(server, { type: 'error', message: errMsg });
      void settleOnce('task-failed');
      return;
    }
  });

  upstream.addEventListener('close', () => { void settleOnce('upstream-close'); });
  upstream.addEventListener('error', () => { void settleOnce('upstream-error'); });

  // ── 3. Wire client (browser) → upstream ───────────────────────────────────
  server.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data;
    if (typeof data === 'string') {
      // Control frames from the client.
      let ctl: Record<string, unknown>;
      try { ctl = JSON.parse(data); } catch { return; }
      if (ctl.type === 'stop') sendFinish();
      return;
    }
    // Binary = raw PCM16 audio.
    const buf = data as ArrayBuffer;
    if (!started) { preStartBuffer.push(buf); return; }
    forwardAudio(buf);
  });

  server.addEventListener('close', () => {
    // Client hung up. Finish the upstream task AND settle now from the bytes we've
    // already billed — don't wait for task-finished, because on an abrupt tab close
    // the isolate may be torn down before it arrives. settleOnce is idempotent, so a
    // normal stop (which settles via task-finished first) makes this a no-op.
    sendFinish();
    void settleOnce('client-close');
  });
  server.addEventListener('error', () => { sendFinish(); void settleOnce('client-error'); });

  // ── 4. Kick off the recognition task ──────────────────────────────────────
  upstream.send(JSON.stringify({
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model: MODEL,
      parameters: { format: 'pcm', sample_rate: SAMPLE_RATE },
      input: {},
    },
  }));
}

// Open an outbound WebSocket from the Worker to DashScope. Cloudflare returns the
// socket on the fetch Response when the Upgrade header is set; we must accept() it.
async function connectUpstream(apiKey: string): Promise<WebSocket> {
  const resp = await fetch(DASHSCOPE_WS, {
    headers: {
      'Authorization': `bearer ${apiKey}`,
      'Upgrade': 'websocket',
    },
  });
  const ws = resp.webSocket;
  if (!ws) throw new Error(`no webSocket on handshake (status ${resp.status})`);
  ws.accept();
  return ws;
}

function safeSend(ws: WebSocket, obj: unknown): void {
  try { ws.send(JSON.stringify(obj)); } catch { /* socket may be closing */ }
}
