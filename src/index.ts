import { AiCallUseCase } from './usecase/AiCallUseCase';
import { SupabaseJwtAuthProvider } from './infra/auth/SupabaseJwtAuthProvider';
import { DeepSeekClient } from './infra/provider/DeepSeekClient';
import { BailianClient } from './infra/provider/BailianClient';
import { HttpTransportAdapter } from './infra/transport/HttpTransportAdapter';
import { D1AuditSink } from './infra/audit/D1AuditSink';
import { TokenBasedRatePlan, DurationBasedRatePlan } from './infra/rateplan/TokenBasedRatePlan';
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
}

function buildUseCase(env: Env): AiCallUseCase {
  const auth = new SupabaseJwtAuthProvider(env.SUPABASE_JWKS_URL);
  const ledger = new CreditLedgerStub(env.CREDIT_LEDGER);
  const providers = new Map<string, IAiProviderClient>([
    ['deepseek', new DeepSeekClient(env.DEEPSEEK_API_KEY)],
    ['bailian', new BailianClient(env.BAILIAN_API_KEY)],
  ]);
  const usageExtractors = new Map([
    ['llm', new TokenUsageExtractor()],
    ['vision', new TokenUsageExtractor()],
    ['asr', new AudioDurationExtractor()],
  ]);
  const ratePlans = new Map([
    ['deepseek-chat', new TokenBasedRatePlan()],
    ['qwen-vl-max', new TokenBasedRatePlan()],
    ['paraformer-v2', new DurationBasedRatePlan()],
  ]);
  const audit = new D1AuditSink(env.DB);
  return new AiCallUseCase(auth, ledger, providers, usageExtractors, ratePlans, audit);
}

// Stub that uses DO fetch for HTTP-based calls
class CreditLedgerStub {
  private stub: DurableObjectStub;
  private accountId = 'demo-user';

  constructor(ns: DurableObjectNamespace<CreditLedger>) {
    const id = ns.idFromName(this.accountId);
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
  async getBalance(accountId: string): Promise<number> {
    return (await this.call('getBalance', accountId)) as number;
  }
  async topUp(accountId: string, amount: number, idempotencyKey: string): Promise<void> {
    await this.call('topUp', accountId, amount, idempotencyKey);
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
  <button onclick="login()">Login / Sign Up</button>
  <p style="margin-top:12px;color:#8b949e;font-size:12px">No account? Just enter email+password to sign up.</p>
</div>

<div id="app-screen" class="container" style="display:none">
  <div class="header">
    <h1>⚡ AI Gateway Demo</h1>
    <div style="display:flex;align-items:center;gap:12px">
      <span style="color:#8b949e;font-size:13px" id="user-email"></span>
      <button id="logout-btn" onclick="logout()">Logout</button>
    </div>
  </div>
  <div class="balance-card">
    <div>
      <div class="balance-label">Credits Balance</div>
      <div class="balance-value" id="balance">--</div>
    </div>
    <button onclick="refreshBalance()" style="padding:8px 16px;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;cursor:pointer;font-size:12px">Refresh</button>
  </div>
  <div class="tabs">
    <button class="tab active" onclick="switchTab('llm')">💬 Chat (DeepSeek)</button>
    <button class="tab" onclick="switchTab('vision')">🖼️ Vision (Qwen-VL)</button>
    <button class="tab" onclick="switchTab('asr')">🎤 ASR (Paraformer)</button>
  </div>

  <div id="panel-llm" class="panel active">
    <div class="chat-box" id="chat-box"></div>
    <div class="input-row">
      <input id="chat-input" type="text" placeholder="Ask DeepSeek something..." onkeydown="if(event.key==='Enter')sendChat()" />
      <button onclick="sendChat()" id="chat-send">Send</button>
    </div>
  </div>

  <div id="panel-vision" class="panel">
    <div class="upload-area" onclick="document.getElementById('image-input').click()">
      <p style="color:#8b949e">📷 Click to upload an image</p>
      <img id="image-preview" style="display:none" />
    </div>
    <input type="file" id="image-input" accept="image/*" style="display:none" onchange="previewImage(event)" />
    <div class="input-row">
      <input id="vision-question" type="text" placeholder="Ask about this image..." />
      <button onclick="sendVision()" id="vision-send">Analyze</button>
    </div>
    <div class="result-area" id="vision-result"></div>
  </div>

  <div id="panel-asr" class="panel">
    <div class="upload-area" onclick="document.getElementById('audio-input').click()">
      <p style="color:#8b949e">🎙️ Click to upload audio</p>
      <p id="audio-name" style="color:#58a6ff;margin-top:8px;font-size:13px"></p>
    </div>
    <input type="file" id="audio-input" accept="audio/*" style="display:none" onchange="previewAudio(event)" />
    <button onclick="sendAsr()" id="asr-send" style="width:100%;padding:12px;background:#238636;border:none;border-radius:8px;color:white;font-size:14px;cursor:pointer;font-weight:600">Transcribe</button>
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

let mySupabase, mySession, currentTab = 'llm', imageBase64 = null, audioBase64 = null;

function initSupabase() {
  mySupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  mySupabase.auth.onAuthStateChange((_event, sess) => {
    if (sess) { mySession = sess; showApp(); } else { showLogin(); }
  });
  mySupabase.auth.getSession().then(({ data }) => {
    if (data.session) { mySession = data.session; showApp(); }
  });
}

async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const { error } = await mySupabase.auth.signInWithPassword({ email, password });
  if (error != null && error.message.includes('Invalid')) {
    const { error: signUpErr } = await mySupabase.auth.signUp({ email, password });
    if (signUpErr != null) { alert(signUpErr.message); return; }
    alert('Account created! Check your email to confirm, then login.');
  } else if (error != null) { alert(error.message); }
}

async function logout() { await mySupabase.auth.signOut(); }

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  document.getElementById('user-email').textContent = mySession.user.email;
  refreshBalance();
  refreshLog();
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}

async function apiCall(path, body) {
  const resp = await fetch(API_BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + mySession.access_token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 401) { logout(); throw new Error('Session expired'); }
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function refreshBalance() {
  try {
    const data = await apiCall('/api/credit/balance');
    document.getElementById('balance').textContent = data.balance ?? '--';
  } catch(e) {}
}

async function refreshLog() {
  try {
    const data = await apiCall('/api/audit/log?limit=20');
    const tbody = document.getElementById('log-body');
    if (!data.rows || data.rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#8b949e">No usage yet</td></tr>';
      return;
    }
    tbody.innerHTML = data.rows.map(r =>
      '<tr><td>' + new Date(r.timestamp).toLocaleString() + '</td><td>' + r.modality + '</td><td>' + r.model + '</td><td>' + r.usage_amount + ' ' + r.usage_kind + '</td><td class="credit">-' + r.credits_charged + '</td></tr>'
    ).join('');
  } catch(e) {}
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.tab:nth-child(' + ({llm:1,vision:2,asr:3}[tab]) + ')').classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  const box = document.getElementById('chat-box');
  box.innerHTML += '<div class="msg user">' + msg + '</div>';
  input.value = '';
  document.getElementById('chat-send').disabled = true;
  try {
    const data = await apiCall('/api/ai/run', {
      modality: 'llm', model: 'deepseek-chat', providerKey: 'deepseek', streaming: false,
      payload: { model: 'deepseek-chat', messages: [{ role: 'user', content: msg }], max_tokens: 512 }
    });
    const content = data.raw?.choices?.[0]?.message?.content || JSON.stringify(data.raw);
    box.innerHTML += '<div class="msg assistant">' + content + '<div class="cost">-' + data.cost + ' credits</div></div>';
    box.scrollTop = box.scrollHeight;
    refreshBalance(); refreshLog();
  } catch(e) { box.innerHTML += '<div class="msg assistant" style="color:#f85149">Error: ' + e.message + '</div>'; }
  document.getElementById('chat-send').disabled = false;
}

function previewImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function() {
    imageBase64 = reader.result.split(',')[1];
    document.getElementById('image-preview').src = reader.result;
    document.getElementById('image-preview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function sendVision() {
  if (!imageBase64) { alert('Please upload an image first'); return; }
  const question = document.getElementById('vision-question').value || 'Describe this image';
  document.getElementById('vision-send').disabled = true;
  try {
    const data = await apiCall('/api/ai/run', {
      modality: 'vision', model: 'qwen-vl-max', providerKey: 'bailian', streaming: false,
      payload: {
        model: 'qwen-vl-max',
        input: { messages: [{ role: 'user', content: [
          { image: 'data:image/jpeg;base64,' + imageBase64 },
          { text: question }
        ]}]}
      }
    });
    const output = data.raw?.output?.choices?.[0]?.message?.content;
    document.getElementById('vision-result').textContent =
      (typeof output === 'string' ? output : JSON.stringify(output, null, 2)) + '\\n\\n-' + data.cost + ' credits';
    refreshBalance(); refreshLog();
  } catch(e) { document.getElementById('vision-result').textContent = 'Error: ' + e.message; }
  document.getElementById('vision-send').disabled = false;
}

function previewAudio(event) {
  const file = event.target.files[0];
  if (!file) return;
  document.getElementById('audio-name').textContent = file.name;
  const reader = new FileReader();
  reader.onload = function() { audioBase64 = reader.result.split(',')[1]; };
  reader.readAsDataURL(file);
}

async function sendAsr() {
  if (!audioBase64) { alert('Please upload an audio file first'); return; }
  document.getElementById('asr-send').disabled = true;
  try {
    const data = await apiCall('/api/ai/run', {
      modality: 'asr', model: 'paraformer-v2', providerKey: 'bailian', streaming: false,
      payload: { model: 'paraformer-v2', input: { audio: 'data:audio/wav;base64,' + audioBase64 } }
    });
    document.getElementById('asr-result').textContent =
      (data.raw?.output?.text || JSON.stringify(data.raw)) + '\\n\\n-' + data.cost + ' credits';
    refreshBalance(); refreshLog();
  } catch(e) { document.getElementById('asr-result').textContent = 'Error: ' + e.message; }
  document.getElementById('asr-send').disabled = false;
}

initSupabase();
</script>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // Frontend
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // API routes
    if (url.pathname === '/api/ai/run') {
      // Auto-init credits if depleted
      const ledgerInit = new CreditLedgerStub(env.CREDIT_LEDGER);
      const bal = await ledgerInit.getBalance('demo-user');
      if (bal < 100) await ledgerInit.topUp('demo-user', 10000, 'auto-init');

      const useCase = buildUseCase(env);
      const transport = new HttpTransportAdapter();
      try {
        return (await useCase.handle(transport, request)) as Response;
      } catch (e) {
        return Response.json(
          { error: (e as Error).message },
          { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
        );
      }
    }

    if (url.pathname === '/api/credit/balance') {
      const ledger = new CreditLedgerStub(env.CREDIT_LEDGER);
      let balance = await ledger.getBalance('demo-user');
      if (balance < 100) { await ledger.topUp('demo-user', 10000, 'auto-init'); balance = 10000; }
      return Response.json({ balance }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // Admin: init demo credits (one-time)
    if (url.pathname === '/api/admin/init-credits') {
      const ledger = new CreditLedgerStub(env.CREDIT_LEDGER);
      await ledger.topUp('demo-user', 10000, 'init-' + Date.now());
      const balance = await ledger.getBalance('demo-user');
      return Response.json({ balance, message: 'Credits initialized' }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    if (url.pathname === '/api/audit/log') {
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const result = await env.DB.prepare(
        'SELECT modality, model, usage_kind, usage_amount, credits_charged, timestamp FROM audit_log WHERE account_id = ? ORDER BY timestamp DESC LIMIT ?'
      ).bind('demo-user', limit).all();
      return Response.json(result, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  },
};
