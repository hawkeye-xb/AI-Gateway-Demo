export const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Gateway Demo</title>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #08090a; --panel: #0f1011; --surface: #191a1b; --surface-2: #202124;
  --text: #f7f8f8; --text-2: #d0d6e0; --muted: #8a8f98; --subtle: #62666d;
  --accent: #5e6ad2; --accent-2: #7170ff; --accent-hover: #828fff;
  --green: #3fb950; --amber: #f0883e; --red: #f85149;
  --border: rgba(255,255,255,0.08); --border-subtle: rgba(255,255,255,0.05);
  --r-sm: 6px; --r: 8px; --r-lg: 12px; --r-pill: 9999px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-feature-settings: 'cv01', 'ss03';
  background: var(--bg); color: var(--text); min-height: 100vh;
  font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased;
}
code, .mono { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
a { color: var(--accent-2); text-decoration: none; }
a:hover { color: var(--accent-hover); }
.container { max-width: 860px; margin: 0 auto; padding: 24px 20px 56px; }

/* Header */
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border-subtle); gap: 12px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 600; letter-spacing: -0.2px; }
.brand .pill { font-size: 10px; font-weight: 500; letter-spacing: 0.5px; color: var(--accent-2); border: 1px solid var(--border); background: rgba(94,106,210,0.08); padding: 2px 7px; border-radius: var(--r-pill); text-transform: uppercase; }
.header-right { display: flex; align-items: center; gap: 12px; }
.header-right .email { color: var(--muted); font-size: 13px; }

/* Buttons */
.btn { font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; border-radius: var(--r-sm); padding: 8px 14px; border: 1px solid var(--border); background: rgba(255,255,255,0.02); color: var(--text-2); transition: background .15s, border-color .15s, color .15s; }
.btn:hover { background: rgba(255,255,255,0.06); color: var(--text); }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: #fff; }
.btn-ghost { background: transparent; color: var(--muted); }
.btn-block { width: 100%; padding: 12px; font-size: 14px; }

/* Balance card */
.balance-card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 20px 22px; margin-bottom: 22px; display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.balance-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px; }
.balance-value { font-size: 34px; font-weight: 600; letter-spacing: -1px; color: var(--text); font-family: 'JetBrains Mono', monospace; line-height: 1.1; margin-top: 2px; }
.balance-value.empty { color: var(--red); }
.balance-usd { font-size: 12px; color: var(--subtle); margin-top: 4px; }
.balance-quota { font-size: 12px; color: var(--muted); margin-top: 6px; font-family: 'JetBrains Mono', monospace; }
.balance-quota.warn { color: var(--amber); }
.balance-actions { display: flex; gap: 8px; align-items: center; }
.select { font: inherit; font-size: 12px; padding: 8px 10px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text-2); }

/* Tabs */
.tabs { display: flex; gap: 6px; margin-bottom: 16px; overflow-x: auto; padding-bottom: 2px; }
.tab { white-space: nowrap; padding: 8px 16px; border-radius: var(--r-sm); border: 1px solid var(--border-subtle); background: rgba(255,255,255,0.02); color: var(--muted); cursor: pointer; font: inherit; font-size: 13px; font-weight: 500; transition: all .15s; }
.tab:hover { color: var(--text-2); }
.tab.active { background: rgba(94,106,210,0.12); border-color: var(--accent); color: var(--accent-2); }
.panel { display: none; }
.panel.active { display: block; }

/* Card / meta */
.card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 16px; }
.meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; font-size: 12px; color: var(--muted); }
.badge { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-2); background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-sm); padding: 2px 8px; }
.badge.price { color: var(--amber); border-color: rgba(240,136,62,0.25); background: rgba(240,136,62,0.06); }

/* Chat */
.chat-box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 16px; min-height: 280px; max-height: 400px; overflow-y: auto; margin-bottom: 12px; }
.chat-box:empty::before { content: 'Chat with deepseek-chat. Billed per input/output token.'; color: var(--subtle); font-size: 13px; }
.msg { margin-bottom: 10px; padding: 10px 12px; border-radius: var(--r); font-size: 14px; line-height: 1.55; }
.msg.user { background: rgba(94,106,210,0.10); border: 1px solid rgba(94,106,210,0.22); }
.msg.assistant { background: var(--surface); border: 1px solid var(--border-subtle); color: var(--text-2); }
.msg .cost { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--amber); margin-top: 6px; }

/* Inputs */
.input-row { display: flex; gap: 8px; }
.input { flex: 1; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text); font: inherit; font-size: 14px; }
.input::placeholder { color: var(--subtle); }
.input:focus { outline: none; border-color: var(--accent); }

/* Upload / result */
.upload-area { border: 1.5px dashed var(--border); border-radius: var(--r-lg); padding: 32px; text-align: center; cursor: pointer; margin-bottom: 12px; transition: border-color .15s, background .15s; color: var(--muted); font-size: 13px; }
.upload-area:hover { border-color: var(--accent); background: rgba(94,106,210,0.04); }
.upload-area img { max-width: 200px; max-height: 200px; margin-top: 12px; border-radius: var(--r); }
.result-area { background: var(--surface); border: 1px solid var(--border-subtle); border-radius: var(--r); padding: 14px; margin-top: 12px; min-height: 56px; font-size: 14px; line-height: 1.55; white-space: pre-wrap; color: var(--text-2); }
.hint { color: var(--subtle); font-size: 12px; margin-top: 8px; }

/* Meter (realtime) */
.meter { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); padding: 12px 14px; font-size: 13px; color: var(--muted); text-align: center; margin-bottom: 12px; font-family: 'JetBrains Mono', monospace; }

/* Log table */
.section-title { margin: 30px 0 12px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }
.log-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.log-table th { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); color: var(--subtle); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
.log-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-subtle); color: var(--text-2); }
.log-table td.num { font-family: 'JetBrains Mono', monospace; font-weight: 500; }

/* Info card */
.info { margin-top: 26px; background: var(--panel); border: 1px solid var(--border-subtle); border-radius: var(--r-lg); padding: 16px 18px; font-size: 13px; color: var(--muted); line-height: 1.7; }
.info b { color: var(--text-2); font-weight: 500; }
.info .mono { color: var(--accent-2); }

/* Footer */
.footer { margin-top: 30px; padding-top: 18px; border-top: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--subtle); }
.stack { display: flex; gap: 6px; flex-wrap: wrap; }
.stack span { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--muted); border: 1px solid var(--border-subtle); border-radius: var(--r-pill); padding: 2px 8px; }

/* Login */
#login-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
.login-card { width: 100%; max-width: 340px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 28px 24px; text-align: center; }
.login-card .brand { justify-content: center; font-size: 18px; margin-bottom: 6px; }
.login-card .sub { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
.login-card input { width: 100%; padding: 11px 14px; margin-bottom: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text); font: inherit; font-size: 14px; }
.login-card input:focus { outline: none; border-color: var(--accent); }
.login-card .btn-primary { width: 100%; padding: 11px; margin-top: 4px; }
.login-card .note { color: var(--subtle); font-size: 12px; margin-top: 14px; line-height: 1.5; }
.btn-google { width: 100%; padding: 11px; display: flex; align-items: center; justify-content: center; gap: 10px; background: #fff; color: #1f1f1f; border: 1px solid var(--border); font-weight: 500; }
.btn-google:hover { background: #f2f2f2; color: #1f1f1f; }
.or-divider { display: flex; align-items: center; gap: 12px; margin: 16px 0; color: var(--subtle); font-size: 12px; }
.or-divider::before, .or-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }

@media (max-width: 560px) {
  .balance-card { flex-direction: column; align-items: flex-start; }
  .balance-actions { width: 100%; }
  .balance-actions .select { flex: 1; }
}
</style>
</head>
<body>
<div id="login-screen">
  <div class="login-card">
    <div class="brand">⚡ AI Gateway</div>
    <div class="sub">Credit-metered multi-modal AI gateway</div>
    <button class="btn btn-google" onclick="gwGoogleLogin()"><svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>Continue with Google</button>
    <div class="or-divider"><span>or</span></div>
    <input id="email" type="email" placeholder="Email" />
    <input id="password" type="password" placeholder="Password" />
    <button class="btn btn-primary" onclick="gwLogin()">Login / Sign up</button>
    <div class="note">No account? Enter an email + password to sign up.<br>New accounts start with demo credits.</div>
  </div>
</div>

<div id="app-screen" class="container" style="display:none">
  <div class="header">
    <div class="brand">⚡ AI Gateway <span class="pill">demo</span></div>
    <div class="header-right">
      <span class="email" id="user-email"></span>
      <a class="btn btn-ghost" href="https://github.com/hawkeye-xb/AI-Gateway-Demo" target="_blank" rel="noopener">GitHub</a>
      <button class="btn btn-ghost" id="logout-btn" onclick="gwLogout()">Logout</button>
    </div>
  </div>

  <div class="balance-card">
    <div>
      <div class="balance-label">Credits Balance</div>
      <div class="balance-value" id="balance">--</div>
      <div class="balance-usd" id="balance-usd">1,000,000 credits = $1</div>
      <div class="balance-quota" id="balance-quota"></div>
    </div>
    <div class="balance-actions">
      <select id="credit-pack" class="select">
        <option value="starter">1M credits — $1</option>
        <option value="plus">5M credits — $5</option>
        <option value="pro">10M credits — $10</option>
        <option value="max">50M credits — $50</option>
      </select>
      <button onclick="gwBuyCredits()" class="btn btn-primary">Buy</button>
      <button onclick="gwRefreshBalance()" class="btn">Refresh</button>
    </div>
  </div>

  <div class="tabs">
    <button id="tab-llm" class="tab active" onclick="gwSwitchTab('llm')">Chat</button>
    <button id="tab-vision" class="tab" onclick="gwSwitchTab('vision')">Vision</button>
    <button id="tab-asr" class="tab" onclick="gwSwitchTab('asr')">Speech · ASR</button>
  </div>

  <div id="panel-llm" class="panel active">
    <div class="meta"><span class="badge">deepseek-chat</span><span class="badge price">≈0.27 credits/input token · 1.1/output token</span></div>
    <div class="chat-box" id="chat-box"></div>
    <div class="input-row">
      <input id="chat-input" class="input" type="text" placeholder="Ask DeepSeek something..." onkeydown="if(event.key==='Enter')gwSendChat()" />
      <button class="btn btn-primary" onclick="gwSendChat()" id="chat-send">Send</button>
    </div>
  </div>

  <div id="panel-vision" class="panel">
    <div class="meta"><span class="badge">qwen-vl-max</span><span class="badge price">≈0.5 credits/token</span></div>
    <div class="upload-area" onclick="document.getElementById('image-input').click()">
      <div>📷 Click to upload an image</div>
      <img id="image-preview" style="display:none" />
    </div>
    <input type="file" id="image-input" accept="image/*" style="display:none" onchange="gwPreviewImage(event)" />
    <div class="input-row">
      <input id="vision-question" class="input" type="text" placeholder="Ask about this image..." />
      <button class="btn btn-primary" onclick="gwSendVision()" id="vision-send">Analyze</button>
    </div>
    <div class="result-area" id="vision-result"></div>
  </div>

  <div id="panel-asr" class="panel">
    <div class="tabs">
      <button id="asr-tab-offline" class="tab active" onclick="gwAsrMode('offline')">📁 Offline · qwen3-asr-flash</button>
      <button id="asr-tab-realtime" class="tab" onclick="gwAsrMode('realtime')">🔴 Realtime · paraformer</button>
    </div>

    <!-- Offline: upload a file, back end transcribes, single post-hoc settle -->
    <div id="asr-sub-offline">
      <div class="upload-area" onclick="document.getElementById('audio-input').click()">
        <div>🎙️ Click to upload an audio file (wav / mp3 / m4a…)</div>
        <p id="audio-name" style="color:var(--accent-2);margin-top:8px;font-size:13px"></p>
      </div>
      <input type="file" id="audio-input" accept="audio/*" style="display:none" onchange="gwPreviewAudio(event)" />
      <button onclick="gwSendAsr()" id="asr-send" class="btn btn-primary btn-block">Transcribe</button>
      <div class="result-area" id="asr-result"></div>
      <p class="hint">Billing: once the clip is fully transcribed, credits are settled in one shot based on the returned audio duration (<b>5 credits/sec</b>).</p>
    </div>

    <!-- Realtime: mic streaming over WebSocket, reserve hold then settle on stop -->
    <div id="asr-sub-realtime" style="display:none">
      <div style="text-align:center;padding:6px 0 14px">
        <button id="asr-rec-btn" onclick="gwAsrToggle()" class="btn btn-primary" style="padding:13px 30px;font-size:15px;border-radius:10px">🔴 Start Recording</button>
      </div>
      <div id="asr-meter" class="meter">Tap “Start Recording” and grant mic access to transcribe instantly. A hold is reserved on connect and settled by the actual duration on stop.</div>
      <div class="result-area" id="asr-live-transcript" style="min-height:110px">(Live transcript will appear here…)</div>
      <p class="hint">Billing: a <b>900-credit hold</b> is reserved on connect (180s cap); on stop you are charged for the <b>actual streamed seconds</b> and the unused portion is released.</p>
    </div>
  </div>

  <div class="section-title">Recent Usage</div>
  <table class="log-table">
    <thead><tr><th>Time</th><th>Modality</th><th>Model</th><th>Usage</th><th>Credits</th></tr></thead>
    <tbody id="log-body"><tr><td colspan="5" style="color:var(--subtle)">Loading…</td></tr></tbody>
  </table>

  <div class="info">
    <b>Billing model</b> · 1 credit = <span class="mono">$0.0001</span> (1,000,000 credits = $1). Price = provider cost × markup (this demo uses <b>100×</b> so credit movement is easy to see) → rounded up to credits.
    Every call is first <b>reserved</b>, then <b>settled</b> by actual usage; realtime ASR settles on stop and releases the unused hold. All spending and top-ups are recorded in Recent Usage.
  </div>

  <div class="footer">
    <div>Open source · <a href="https://github.com/hawkeye-xb/AI-Gateway-Demo" target="_blank" rel="noopener">MIT</a> · Cloudflare Workers</div>
    <div class="stack">
      <span>Workers</span><span>D1</span><span>Durable Objects</span><span>Supabase</span><span>DeepSeek</span><span>Qwen</span>
    </div>
  </div>
</div>

<script>
const SUPABASE_URL = '__SUPABASE_URL__';
const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';
const API_BASE = '';

let _gw_sb, _gw_session, _gw_tab = 'llm', _gw_img = null, _gw_aud = null, _gw_audUri = null;
// Realtime ASR state
let _gw_asrWs = null, _gw_asrCtx = null, _gw_asrProc = null, _gw_asrStream = null, _gw_asrRec = false, _gw_asrFinal = '';

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

async function gwGoogleLogin() {
  const {error} = await _gw_sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error != null) alert(error.message);
}

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
    const bal = d.balance ?? 0;
    const el = document.getElementById('balance');
    el.textContent = Number(bal).toLocaleString();
    el.className = 'balance-value' + (bal < 100 ? ' empty' : '');
    const usd = document.getElementById('balance-usd');
    if (usd) usd.textContent = '≈ $' + (bal * 0.0001).toFixed(2) + '  ·  1,000,000 credits = $1';
    const q = document.getElementById('balance-quota');
    if (q && d.dayLimit) {
      const used = d.dayUsed ?? 0, lim = d.dayLimit, rem = Math.max(0, lim - used);
      q.textContent = 'today ' + used + ' / ' + lim + ' · ' + d.minLimit + '/min · cap $' + Math.round(d.maxBalance * 0.0001);
      q.className = 'balance-quota' + (rem <= lim * 0.1 ? ' warn' : '');
    }
  } catch(_e) {}
}

async function gwRefreshLog() {
  try {
    const d = await gwApi('/api/audit/log?limit=20');
    const tb = document.getElementById('log-body');
    if (!d.rows || d.rows.length === 0) {
      tb.innerHTML = '<tr><td colspan="5" style="color:var(--subtle)">No usage yet</td></tr>';
    } else {
      tb.innerHTML = d.rows.map(function(r) {
        var creds = Number(r.credits);
        var neg = creds < 0;                       // refund/chargeback: topup row w/ negative credits
        var isTop = r.kind === 'topup' && !neg;
        var sign = isTop ? '+' : '-';
        var col = isTop ? '#3fb950' : '#f0883e';
        var amt = Math.abs(creds);
        return '<tr><td>'+new Date(r.timestamp).toLocaleString()+'</td><td>'+r.modality+'</td><td>'+r.model+'</td><td>'+Math.abs(Number(r.usage_amount))+' '+r.usage_kind+'</td><td class="num" style="color:'+col+'">'+sign+amt+'</td></tr>';
      }).join('');
    }
  } catch(_e) {}
}

function gwSwitchTab(t) {
  _gw_tab = t;
  ['llm','vision','asr'].forEach(function(k){
    document.getElementById('tab-'+k).classList.toggle('active', k === t);
    document.getElementById('panel-'+k).classList.toggle('active', k === t);
  });
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
    var _vc = d.raw && d.raw.output && d.raw.output.choices && d.raw.output.choices[0] && d.raw.output.choices[0].message ? d.raw.output.choices[0].message.content : null;
    var _vt = Array.isArray(_vc) ? _vc.map(function(x){ return (x && x.text) ? x.text : ''; }).join('') : (typeof _vc === 'string' ? _vc : JSON.stringify(d.raw));
    document.getElementById('vision-result').textContent = _vt+'\\n\\n-'+d.cost+' credits';
    gwRefreshBalance(); gwRefreshLog();
  } catch(e) { document.getElementById('vision-result').textContent = 'Error: '+e.message; }
  document.getElementById('vision-send').disabled = false;
}

function gwPreviewAudio(ev) {
  const f = ev.target.files[0]; if (!f) return;
  document.getElementById('audio-name').textContent = f.name;
  const rd = new FileReader();
  rd.onload = function() { _gw_audUri = rd.result; _gw_aud = rd.result.split(',')[1]; };
  rd.readAsDataURL(f);
}

// ── Offline ASR: qwen3-asr-flash, base64 in → text out, single post-hoc settle ──
async function gwSendAsr() {
  if (!_gw_audUri) { alert('Upload an audio file first'); return; }
  document.getElementById('asr-send').disabled = true;
  document.getElementById('asr-result').textContent = 'Transcribing…';
  try {
    const d = await gwApi('/api/ai/run', {
      modality:'asr', model:'qwen3-asr-flash', providerKey:'bailian', streaming:false,
      payload:{ audio: _gw_audUri }
    });
    var _at = (d.raw && d.raw.text) ? d.raw.text
      : (d.raw && d.raw.output && d.raw.output.choices && d.raw.output.choices[0] && d.raw.output.choices[0].message
          && Array.isArray(d.raw.output.choices[0].message.content)
            ? d.raw.output.choices[0].message.content.map(function(x){ return (x && x.text) ? x.text : ''; }).join('')
            : JSON.stringify(d.raw));
    document.getElementById('asr-result').textContent = _at + '\\n\\n-' + d.cost + ' credits';
    gwRefreshBalance(); gwRefreshLog();
  } catch(e) { document.getElementById('asr-result').textContent = 'Error: '+e.message; }
  document.getElementById('asr-send').disabled = false;
}

// ── ASR sub-mode switch (offline vs realtime) ──
function gwAsrMode(mode) {
  document.getElementById('asr-sub-offline').style.display = mode === 'offline' ? 'block' : 'none';
  document.getElementById('asr-sub-realtime').style.display = mode === 'realtime' ? 'block' : 'none';
  document.getElementById('asr-tab-offline').classList.toggle('active', mode === 'offline');
  document.getElementById('asr-tab-realtime').classList.toggle('active', mode === 'realtime');
  if (mode !== 'realtime' && _gw_asrRec) gwAsrStop();
}

// ── Realtime ASR: mic → PCM16@16k → WebSocket → paraformer, reserve→settle ──
function gwAsrToggle() { if (_gw_asrRec) gwAsrStop(); else gwAsrStart(); }

async function gwAsrStart() {
  if (_gw_asrRec) return;
  const meter = document.getElementById('asr-meter');
  const tr = document.getElementById('asr-live-transcript');
  tr.textContent = ''; _gw_asrFinal = '';
  meter.textContent = 'Connecting…';

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(proto + '://' + location.host + '/api/asr/stream?token=' + encodeURIComponent(_gw_session.access_token));
  ws.binaryType = 'arraybuffer';
  _gw_asrWs = ws;

  ws.onmessage = function(ev) {
    var m; try { m = JSON.parse(ev.data); } catch(_e) { return; }
    if (m.type === 'ready') {
      meter.innerHTML = '🎙️ Recording… (held <b>' + m.heldCredits + '</b> credits)';
    } else if (m.type === 'partial') {
      tr.textContent = _gw_asrFinal + m.text;
    } else if (m.type === 'final') {
      _gw_asrFinal += m.text; tr.textContent = _gw_asrFinal;
    } else if (m.type === 'meter') {
      meter.innerHTML = '🎙️ held: <b>' + m.heldCredits + '</b> · used: <b style="color:#f0883e">' + m.usedCredits + '</b> credits · ' + m.usedSeconds + 's';
    } else if (m.type === 'limit') {
      meter.innerHTML = '⏱ Reached the 180s cap, stopping automatically…';
    } else if (m.type === 'settled') {
      meter.innerHTML = '✅ settled: <b style="color:#f0883e">' + m.credits + '</b> credits (held ' + m.heldCredits + ' → released ' + m.releasedCredits + ', duration ' + m.seconds + 's)';
      gwRefreshBalance(); gwRefreshLog();
      gwAsrCleanup();
    } else if (m.type === 'error') {
      meter.textContent = 'Error: ' + (m.message || m.code || 'unknown');
      gwAsrCleanup();
    }
  };
  ws.onclose = function() { gwAsrCleanup(); };
  ws.onerror = function() { meter.textContent = 'Connection error (WebSocket)'; };

  try {
    _gw_asrStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch(e) {
    meter.textContent = 'Microphone access denied: ' + e.message;
    try { ws.close(); } catch(_e) {}
    return;
  }

  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  _gw_asrCtx = ctx;
  const inRate = ctx.sampleRate;
  const src = ctx.createMediaStreamSource(_gw_asrStream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  _gw_asrProc = proc;
  proc.onaudioprocess = function(e) {
    if (!_gw_asrWs || _gw_asrWs.readyState !== 1) return;
    const input = e.inputBuffer.getChannelData(0);
    const pcm = gwDownsampleTo16kPCM(input, inRate);
    if (pcm && pcm.byteLength) { try { _gw_asrWs.send(pcm); } catch(_e) {} }
  };
  // Route through a zero-gain node so the processor keeps firing without echoing mic to speakers.
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);

  _gw_asrRec = true;
  const btn = document.getElementById('asr-rec-btn');
  btn.textContent = '⏹ Stop'; btn.style.background = '#da3633';
}

function gwDownsampleTo16kPCM(input, inRate) {
  const outRate = 16000;
  var data = input;
  if (inRate !== outRate) {
    const ratio = inRate / outRate;
    const newLen = Math.floor(input.length / ratio);
    const out = new Float32Array(newLen);
    for (var i = 0; i < newLen; i++) {
      const idx = i * ratio; const i0 = Math.floor(idx); const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = idx - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    data = out;
  }
  const buf = new ArrayBuffer(data.length * 2);
  const view = new DataView(buf);
  for (var j = 0; j < data.length; j++) {
    var s = Math.max(-1, Math.min(1, data[j]));
    view.setInt16(j * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buf;
}

function gwAsrStop() {
  // Tell the server to finish the task; keep the WS open to receive final text + settlement.
  if (_gw_asrWs && _gw_asrWs.readyState === 1) { try { _gw_asrWs.send(JSON.stringify({ type: 'stop' })); } catch(_e) {} }
  if (_gw_asrProc) { try { _gw_asrProc.disconnect(); } catch(_e) {} }
  if (_gw_asrCtx) { try { _gw_asrCtx.close(); } catch(_e) {} }
  if (_gw_asrStream) { try { _gw_asrStream.getTracks().forEach(function(t){ t.stop(); }); } catch(_e) {} }
  _gw_asrRec = false;
  const btn = document.getElementById('asr-rec-btn');
  btn.textContent = '🔴 Start Recording'; btn.style.background = '';
}

function gwAsrCleanup() {
  _gw_asrRec = false;
  if (_gw_asrProc) { try { _gw_asrProc.disconnect(); } catch(_e) {} _gw_asrProc = null; }
  if (_gw_asrCtx) { try { _gw_asrCtx.close(); } catch(_e) {} _gw_asrCtx = null; }
  if (_gw_asrStream) { try { _gw_asrStream.getTracks().forEach(function(t){ t.stop(); }); } catch(_e) {} _gw_asrStream = null; }
  const btn = document.getElementById('asr-rec-btn');
  if (btn) { btn.textContent = '🔴 Start Recording'; btn.style.background = ''; }
}

async function gwBuyCredits() {
  try {
    const pkg = document.getElementById('credit-pack').value;
    const d = await gwApi('/api/payment/checkout', { packageId: pkg });
    window.open(d.url, '_blank');
    alert('Complete payment in the new tab, then come back and refresh balance.');
  } catch(e) { alert('Payment error: '+e.message); }
}

gwInitSb();
</script>
</body>
</html>`;
