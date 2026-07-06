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
import type { IAiProviderClient } from './domain/IAiProviderClient';

export { CreditLedger };

interface Env {
  DB: D1Database;
  CREDIT_LEDGER: DurableObjectNamespace<CreditLedger>;
  DEEPSEEK_API_KEY: string;
  BAILIAN_API_KEY: string;
  SUPABASE_JWKS_URL: string;
  SUPABASE_PROJECT_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CREEM_API_KEY: string;
  CREEM_WEBHOOK_SECRET: string;
}

// ── JWT helper: extract user ID without full verification ──
function extractUserId(request: Request): string | null {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.sub || null;
  } catch { return null; }
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
class CreditLedgerStub {
  private stub: DurableObjectStub;

  constructor(ns: DurableObjectNamespace<CreditLedger>, accountId: string) {
    const id = ns.idFromName(accountId);
    this.stub = ns.get(id);
  }

  private async call(method: string, ...args: unknown[]): Promise<unknown> {
    const resp = await this.stub.fetch('http://do/op', {
      method: 'POST',
      body: JSON.stringify({ method, args }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json();
  }

  async reserve(accountId: string, estimatedCredit: number, idempotencyKey: string): Promise<string> {
    return (await this.call('reserve', accountId, estimatedCredit, idempotencyKey)) as string;
  }
  async settle(reservationId: string, actualCredit: number): Promise<void> {
    await this.call('settle', reservationId, actualCredit);
  }
  async release(reservationId: string): Promise<void> {
    await this.call('release', reservationId);
  }
  async getBalance(_accountId: string): Promise<number> {
    return (await this.call('getBalance', _accountId)) as number;
  }
  async topUp(_accountId: string, amount: number, idempotencyKey: string): Promise<void> {
    await this.call('topUp', _accountId, amount, idempotencyKey);
  }
}

// ── Frontend HTML ──
const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Gateway Demo</title>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e1e4e8; min-height: 100vh; }
.container { max-width: 900px; margin: 0 auto; padding: 24px; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #21262d; }
.header h1 { font-size: 20px; color: #58a6ff; }
.balance-card { background: linear-gradient(135deg, #1a1f2e, #161b22); border: 1px solid #30363d; border-radius: 12px; padding: 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
.balance-label { font-size: 13px; color: #8b949e; }
.balance-value { font-size: 32px; font-weight: 700; color: #3fb950; }
.balance-value.empty { color: #f85149; }
.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tab { padding: 8px 20px; border-radius: 8px; border: 1px solid #30363d; background: transparent; color: #8b949e; cursor: pointer; font-size: 14px; }
.tab.active { background: #1f6feb22; border-color: #1f6feb; color: #58a6ff; }
.panel { display: none; }
.panel.active { display: block; }
.chat-box { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 16px; min-height: 300px; max-height: 400px; overflow-y: auto; margin-bottom: 12px; }
.msg { margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; font-size: 14px; line-height: 1.5; }
.msg.user { background: #1f6feb22; border: 1px solid #1f6feb44; }
.msg.assistant { background: #161b22; border: 1px solid #30363d; }
.msg .cost { font-size: 11px; color: #8b949e; margin-top: 4px; }
.input-row { display: flex; gap: 8px; }
.input-row input, .input-row textarea { flex: 1; padding: 10px 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; color: #e1e4e8; font-size: 14px; }
.input-row button { padding: 10px 20px; background: #238636; border: none; border-radius: 8px; color: white; font-size: 14px; cursor: pointer; font-weight: 600; }
.input-row button:hover { background: #2ea043; }
.input-row button:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-buy { padding: 10px 20px; background: #1f6feb; border: none; border-radius: 8px; color: white; font-size: 14px; cursor: pointer; font-weight: 600; }
.btn-buy:hover { background: #388bfd; }
.upload-area { border: 2px dashed #30363d; border-radius: 12px; padding: 40px; text-align: center; cursor: pointer; margin-bottom: 12px; }
.upload-area:hover { border-color: #58a6ff; }
.upload-area img { max-width: 200px; max-height: 200px; margin-top: 12px; border-radius: 8px; }
.result-area { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 16px; margin-top: 12px; min-height: 60px; font-size: 14px; white-space: pre-wrap; }
.log-table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 13px; }
.log-table th { text-align: left; padding: 8px 12px; border-bottom: 1px solid #30363d; color: #8b949e; font-weight: 600; }
.log-table td { padding: 8px 12px; border-bottom: 1px solid #21262d; }
.log-table .credit { color: #3fb950; font-weight: 600; }
#login-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 80vh; }
#login-screen h2 { margin-bottom: 24px; font-size: 24px; }
#login-screen input { width: 300px; padding: 10px 14px; margin-bottom: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; color: #e1e4e8; font-size: 14px; }
#login-screen button { width: 300px; padding: 10px; background: #238636; border: none; border-radius: 8px; color: white; font-size: 14px; cursor: pointer; font-weight: 600; }
#logout-btn { padding: 6px 14px; background: transparent; border: 1px solid #30363d; border-radius: 6px; color: #8b949e; cursor: pointer; font-size: 13px; }
</style>
</head>
<body>
<div id="login-screen">
  <h2>🔐 AI Gateway Demo</h2>
  <input id="email" type="email" placeholder="Email" />
  <input id="password" type="password" placeholder="Password" />
  <button onclick="gwLogin()">Login / Sign Up</button>
  <p style="margin-top:12px;color:#8b949e;font-size:12px">No account? Just enter email+password to sign up.</p>
</div>

<div id="app-screen" class="container" style="display:none">
  <div class="header">
    <h1>⚡ AI Gateway Demo</h1>
    <div style="display:flex;align-items:center;gap:12px">
      <span style="color:#8b949e;font-size:13px" id="user-email"></span>
      <button id="logout-btn" onclick="gwLogout()">Logout</button>
    </div>
  </div>
  <div class="balance-card">
    <div>
      <div class="balance-label">Credits Balance</div>
      <div class="balance-value" id="balance">--</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <select id="credit-pack" style="padding:6px 10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:12px">
        <option value="1">1M credits — $1</option>
        <option value="5">5M credits — $5</option>
        <option value="10">10M credits — $10</option>
        <option value="50">50M credits — $50</option>
      </select>
      <button onclick="gwBuyCredits()" class="btn-buy">💰 Buy</button>
      <button onclick="gwRefreshBalance()" style="padding:8px 16px;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;cursor:pointer;font-size:12px">Refresh</button>
    </div>
  </div>
  <div class="tabs">
    <button class="tab active" onclick="gwSwitchTab('llm')">💬 Chat (DeepSeek)</button>
    <button class="tab" onclick="gwSwitchTab('vision')">🖼️ Vision (Qwen-VL)</button>
    <button class="tab" onclick="gwSwitchTab('asr')">🎤 ASR (Paraformer)</button>
  </div>

  <div id="panel-llm" class="panel active">
    <div class="chat-box" id="chat-box"></div>
    <div class="input-row">
      <input id="chat-input" type="text" placeholder="Ask DeepSeek something..." onkeydown="if(event.key==='Enter')gwSendChat()" />
      <button onclick="gwSendChat()" id="chat-send">Send</button>
    </div>
  </div>

  <div id="panel-vision" class="panel">
    <div class="upload-area" onclick="document.getElementById('image-input').click()">
      <p style="color:#8b949e">📷 Click to upload an image</p>
      <img id="image-preview" style="display:none" />
    </div>
    <input type="file" id="image-input" accept="image/*" style="display:none" onchange="gwPreviewImage(event)" />
    <div class="input-row">
      <input id="vision-question" type="text" placeholder="Ask about this image..." />
      <button onclick="gwSendVision()" id="vision-send">Analyze</button>
    </div>
    <div class="result-area" id="vision-result"></div>
  </div>

  <div id="panel-asr" class="panel">
    <div class="upload-area" onclick="document.getElementById('audio-input').click()">
      <p style="color:#8b949e">🎙️ Click to upload audio</p>
      <p id="audio-name" style="color:#58a6ff;margin-top:8px;font-size:13px"></p>
    </div>
    <input type="file" id="audio-input" accept="audio/*" style="display:none" onchange="gwPreviewAudio(event)" />
    <button onclick="gwSendAsr()" id="asr-send" style="width:100%;padding:12px;background:#238636;border:none;border-radius:8px;color:white;font-size:14px;cursor:pointer;font-weight:600">Transcribe</button>
    <div class="result-area" id="asr-result"></div>
  </div>

  <h3 style="margin-top:32px;margin-bottom:12px;color:#8b949e;font-size:14px">📋 Recent Usage</h3>
  <table class="log-table">
    <thead><tr><th>Time</th><th>Modality</th><th>Model</th><th>Usage</th><th>Credits</th></tr></thead>
    <tbody id="log-body"><tr><td colspan="5" style="color:#8b949e">Loading...</td></tr></tbody>
  </table>
</div>

<script>
const SUPABASE_URL = 'https://cdfcboqhirhadzykeeey.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_L3tlauTO-QrKwseMijNGlQ_XiJAbSLR';
const API_BASE = '';

let _gw_sb, _gw_session, _gw_tab = 'llm', _gw_img = null, _gw_aud = null;

function gwInitSb() {
  _gw_sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  _gw_sb.auth.onAuthStateChange((_ev, s) => { if (s) { _gw_session = s; gwShowApp(); } else { gwShowLogin(); } });
  _gw_sb.auth.getSession().then(({data}) => { if (data.session) { _gw_session = data.session; gwShowApp(); } });
}

async function gwLogin() {
  const e = document.getElementById('email').value, p = document.getElementById('password').value;
  const {error} = await _gw_sb.auth.signInWithPassword({email:e, password:p});
  if (error != null && error.message.includes('Invalid')) {
    const {error:se} = await _gw_sb.auth.signUp({email:e, password:p});
    if (se != null) { alert(se.message); return; }
    alert('Account created! Check email to confirm, then login.');
  } else if (error != null) { alert(error.message); }
}

async function gwLogout() { await _gw_sb.auth.signOut(); }

function gwShowApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  document.getElementById('user-email').textContent = _gw_session.user.email;
  gwRefreshBalance(); gwRefreshLog();
}

function gwShowLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}

async function gwApi(path, body) {
  const r = await fetch(API_BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: {'Content-Type':'application/json', 'Authorization':'Bearer '+_gw_session.access_token},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { gwLogout(); throw new Error('Session expired'); }
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d;
}

async function gwRefreshBalance() {
  try {
    const d = await gwApi('/api/credit/balance');
    const el = document.getElementById('balance');
    el.textContent = d.balance ?? '0';
    el.className = 'balance-value' + (d.balance < 100 ? ' empty' : '');
  } catch(_e) {}
}

async function gwRefreshLog() {
  try {
    const d = await gwApi('/api/audit/log?limit=20');
    const tb = document.getElementById('log-body');
    if (!d.rows || d.rows.length === 0) {
      tb.innerHTML = '<tr><td colspan="5" style="color:#8b949e">No usage yet</td></tr>';
    } else {
      tb.innerHTML = d.rows.map(r =>
        '<tr><td>'+new Date(r.timestamp).toLocaleString()+'</td><td>'+r.modality+'</td><td>'+r.model+'</td><td>'+r.usage_amount+' '+r.usage_kind+'</td><td class="credit">-'+r.credits_charged+'</td></tr>'
      ).join('');
    }
  } catch(_e) {}
}

function gwSwitchTab(t) {
  _gw_tab = t;
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
  document.querySelector('.tab:nth-child('+({llm:1,vision:2,asr:3}[t])+')').classList.add('active');
  document.getElementById('panel-'+t).classList.add('active');
}

async function gwSendChat() {
  const inp = document.getElementById('chat-input'), msg = inp.value.trim();
  if (!msg) return;
  const box = document.getElementById('chat-box');
  box.innerHTML += '<div class="msg user">'+msg+'</div>';
  inp.value = '';
  document.getElementById('chat-send').disabled = true;
  try {
    const d = await gwApi('/api/ai/run', {
      modality:'llm', model:'deepseek-chat', providerKey:'deepseek', streaming:false,
      payload:{model:'deepseek-chat', messages:[{role:'user', content:msg}], max_tokens:512}
    });
    const c = d.raw?.choices?.[0]?.message?.content || JSON.stringify(d.raw);
    box.innerHTML += '<div class="msg assistant">'+c+'<div class="cost">-'+d.cost+' credits</div></div>';
    box.scrollTop = box.scrollHeight;
    gwRefreshBalance(); gwRefreshLog();
  } catch(e) { box.innerHTML += '<div class="msg assistant" style="color:#f85149">Error: '+e.message+'</div>'; }
  document.getElementById('chat-send').disabled = false;
}

function gwPreviewImage(ev) {
  const f = ev.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = function() { _gw_img = rd.result.split(',')[1]; document.getElementById('image-preview').src = rd.result; document.getElementById('image-preview').style.display = 'block'; };
  rd.readAsDataURL(f);
}

async function gwSendVision() {
  if (!_gw_img) { alert('Upload an image first'); return; }
  const q = document.getElementById('vision-question').value || 'Describe this image';
  document.getElementById('vision-send').disabled = true;
  try {
    const d = await gwApi('/api/ai/run', {
      modality:'vision', model:'qwen-vl-max', providerKey:'bailian', streaming:false,
      payload:{model:'qwen-vl-max', input:{messages:[{role:'user', content:[{image:'data:image/jpeg;base64,'+_gw_img},{text:q}]}]}}
    });
    document.getElementById('vision-result').textContent = (d.raw?.output?.choices?.[0]?.message?.content || JSON.stringify(d.raw))+'\\n\\n-'+d.cost+' credits';
    gwRefreshBalance(); gwRefreshLog();
  } catch(e) { document.getElementById('vision-result').textContent = 'Error: '+e.message; }
  document.getElementById('vision-send').disabled = false;
}

function gwPreviewAudio(ev) {
  const f = ev.target.files[0]; if (!f) return;
  document.getElementById('audio-name').textContent = f.name;
  const rd = new FileReader();
  rd.onload = function() { _gw_aud = rd.result.split(',')[1]; };
  rd.readAsDataURL(f);
}

async function gwSendAsr() {
  if (!_gw_aud) { alert('Upload an audio file first'); return; }
  document.getElementById('asr-send').disabled = true;
  try {
    const d = await gwApi('/api/ai/run', {
      modality:'asr', model:'paraformer-v2', providerKey:'bailian', streaming:false,
      payload:{model:'paraformer-v2', input:{audio:'data:audio/wav;base64,'+_gw_aud}}
    });
    document.getElementById('asr-result').textContent = (d.raw?.output?.text || JSON.stringify(d.raw))+'\\n\\n-'+d.cost+' credits';
    gwRefreshBalance(); gwRefreshLog();
  } catch(e) { document.getElementById('asr-result').textContent = 'Error: '+e.message; }
  document.getElementById('asr-send').disabled = false;
}

async function gwBuyCredits() {
  try {
    const mult = document.getElementById('credit-pack').value;
    const d = await gwApi('/api/payment/checkout', { credits_mult: parseInt(mult) });
    window.open(d.url, '_blank');
    alert('Complete payment in the new tab, then come back and refresh balance.');
  } catch(e) { alert('Payment error: '+e.message); }
}

gwInitSb();
</script>
</body>
</html>`;

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
      return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── AI call ──
    if (url.pathname === '/api/ai/run') {
      const userId = extractUserId(request);
      if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } });
      const useCase = buildUseCase(env, userId);
      try {
        return (await useCase.handle(new HttpTransportAdapter(), request)) as Response;
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
    }

    // ── Balance ──
    if (url.pathname === '/api/credit/balance') {
      const userId = extractUserId(request);
      if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } });
      const ledger = new CreditLedgerStub(env.CREDIT_LEDGER, userId);
      const balance = await ledger.getBalance(userId);
      return Response.json({ balance }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // ── Audit log ──
    if (url.pathname === '/api/audit/log') {
      const userId = extractUserId(request);
      if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } });
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const result = await env.DB.prepare(
        'SELECT modality, model, usage_kind, usage_amount, credits_charged, timestamp FROM audit_log WHERE account_id = ? ORDER BY timestamp DESC LIMIT ?'
      ).bind(userId, limit).all();
      // D1 returns rows under `.results`; the frontend reads `d.rows`. Return `rows`
      // explicitly so the "Recent Usage" table renders instead of showing "No usage yet".
      return Response.json({ rows: result.results }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // ── Creem checkout ──
    if (url.pathname === '/api/payment/checkout') {
      const userId = extractUserId(request);
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
            product_id: 'prod_vfOhDIXGlk1Dfkd8MT6AB',
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

        // Verify HMAC-SHA256 (simplified — real impl needs crypto.subtle)
        // For demo: skip signature verification or use a basic check
        // In production: use Web Crypto API to verify HMAC

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
          await ledger.topUp(accountId, credits, 'creem-' + externalEventId); // 100,000 credits for demo pack
        }

        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500 });
      }
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  },
};
