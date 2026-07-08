# ⚡ AI Gateway Demo

**English** · [简体中文](./README.zh-CN.md)

A credit-metered, multi-modal **AI gateway** running entirely on Cloudflare Workers.
It sits in front of several AI providers, meters usage, applies a markup, enforces
per-user rate limits, and bills a prepaid **credit** balance per user — the core of what
a commercial "AI API platform" does, in one small, readable, hexagonal-architecture
codebase.

> **Live demo:** https://ai-gateway-demo.hawkeye-xb.com
>
> This is a reference/learning project, not a production service. See
> [Security & production notes](#security--production-notes).

---

## Why this exists (purpose)

Commercial AI API platforms (think OpenRouter-style proxies, or any product that resells
LLM calls with credits and billing) all solve the same handful of hard problems:
authenticate users, meter token/second usage, mark it up, charge a prepaid balance
atomically, take payments, and stop abuse. Those problems are usually buried inside a
large SaaS backend running on servers.

**This project shows you can build that whole core on a serverless free tier — no server,
zero fixed cost — and keeps the code small enough to read in an afternoon.** Its goals:

1. **A working reference** for the **reserve → settle** credit-ledger pattern — the right
   way to bill both instant calls and long-lived streaming sessions without over- or
   under-charging.
2. **Prove the "zero fixed cost" architecture** — Cloudflare Workers + D1 + Durable
   Objects + Supabase Auth, all on free tiers. You pay only the upstream model providers.
3. **A clean, SOLID / hexagonal example** — the use case depends only on domain
   interfaces; every external system (auth, providers, ledger, price book, payments) is a
   swappable adapter.
4. **Document the traps** — JWT verification, webhook HMAC, float rounding in pricing,
   Durable Object persistence, per-user rate limiting. Each was a real bug; each is solved
   and explained.

It is **not** a turnkey production service — it's a teaching implementation you fork,
understand, and adapt.

---

## What it does

| Modality | Provider / model | Billing unit |
|----------|------------------|--------------|
| 💬 **Chat** | DeepSeek — `deepseek-chat` | input + output tokens |
| 🖼️ **Vision** | Bailian — `qwen-vl-max` | input + output tokens |
| 📁 **ASR (offline)** | Bailian — `qwen3-asr-flash` (sync) | audio seconds |
| 🔴 **ASR (realtime)** | Bailian — `paraformer-realtime-v2` (WebSocket) | audio seconds |

Every call flows through one pipeline: **authenticate → rate-limit → reserve → invoke
provider → meter usage → settle → audit**.

### Highlights

- **Prepaid credit ledger** on a per-user Durable Object with a real **reserve → settle**
  lifecycle (hold funds up front, charge the exact metered cost after). New accounts are
  seeded with demo credits.
- **Realtime streaming ASR** over WebSocket: the browser streams mic PCM to the Worker,
  which relays to the provider and streams transcripts back live. Credits are
  **pre-authorized on connect** and **settled by actual streamed duration on stop**.
- **Per-user rate limiting & abuse control** — enforced at the ledger chokepoint (see
  [below](#rate-limiting--abuse-control)).
- **Transparent pricing** — a D1 `price_book` stores each provider's raw cost; the gateway
  applies a markup (100× in this demo, to make credit movement visible) and converts to
  integer credits.
- **Payments** via [Creem](https://creem.io): checkout + signature-verified webhook that
  tops up the ledger idempotently.
- **Usage audit** — every spend and top-up is recorded in D1 and shown in the UI.
- **Social + email auth** — Supabase email/password and Google OAuth.

---

## Credits & billing model

- **1 credit = $0.0001 USD**, so **1,000,000 credits = $1**. Credits are stored as integers.
- Charged price = `raw_provider_cost × markup`, converted to credits and rounded up. This
  demo uses a **100× markup** purely so balance changes are easy to see; set your real
  margin in `src/config.ts`.
- **Input and output are billed at their own rates** (not summed and charged at the input
  rate). deepseek output ≈ 4× input, so an output-heavy call costs proportionally more.
- Formula (see `src/infra/rateplan/TokenBasedRatePlan.ts`):

  ```
  credits = ceil( (inputTokens × inputRate + outputTokens × outputRate) × markup / 0.0001 )
  ```

Everything metered is authoritative at **settle** time; the pre-call **reserve** is only an
affordability gate (an upper-ish estimate), never the final charge.

---

## Configuration — one file (`src/config.ts`)

Every **credit rule** lives in one typed file, `src/config.ts` — the only file you edit to
customize billing. Infrastructure identity (CF account, D1 id, Supabase, API keys) stays in
`wrangler.toml` + `wrangler secret`, not here.

| Setting | Field | What it controls |
|---------|-------|------------------|
| Signup grant | `ledger.initialCredits` | Free credits on first use (`0` to disable) |
| Balance cap | `ledger.maxBalanceCredits` | Max balance per user (anti-farming) |
| Rate limits | `ledger.rateLimit.{perMinute,perDay}` | Per-user request throttle |
| Exchange rate | `creditExchangeRateUsd` | USD per credit |
| Pricing | `pricing.models[]` | Per-model `rates` (input/output/audio) + optional per-model `markup` |
| Default markup | `pricing.defaultMarkup` | Applied when a model has no `markup` |
| ASR bounds | `asr.{holdSeconds,maxSeconds}` | Realtime session pre-auth hold + hard cap |
| Purchase packages | `packages` | Server-side price↔credits table (client sends only a package id) |

**Price source (important for forkers):** by default the price book reads from `config.ts`
(`ConfigPriceBook`). The D1 `price_book` table still exists (migrations create it) but is
**not used** by default — editing that SQL will have **no effect** unless you switch the
price source. To make prices runtime-editable (SQL `UPDATE`, no redeploy) instead of a code
constant, swap one line in `buildUseCase()` (`index.ts`): `new ConfigPriceBook()` →
`new D1PriceBook(env.DB)` (and the same in `AsrRelay.ts`). This one-line swap is the
hexagonal architecture paying off — pricing is an injected `IPriceBook` adapter.

### Productionization checklist (fork → live)

Because the rules are consolidated, forking to a production deployment is config/constant
level — no domain logic changes:

1. **`config.ts`** — set `initialCredits` (often `0`), real `pricing.models` rates +
   `defaultMarkup` (drop the demo 100×), `packages`, and `rateLimit` for your capacity.
2. **Secrets** — real provider keys + a live (non-test) Creem key via `wrangler secret`.
3. **`wrangler.toml [vars]`** — your Supabase project + Creem product id; restrict CORS
   (currently `*`).
4. **Cloudflare WAF** — add a global rate rule (per-user limits don't stop multi-account
   farming; see below).
5. **Handle refunds** — the webhook only processes `checkout.completed` today; add a
   `refund`/`chargeback` branch before taking real money.

---

## Rate limiting & abuse control

Because the demo runs Creem in **test mode**, top-ups are effectively free — so the credit
balance alone can't cap abuse. Limiting is therefore a **first-class gateway feature**,
enforced at the `reserve()` chokepoint in the per-user Durable Object (every billable call
funnels through it):

| Layer | Limit | Default | Guards against |
|-------|-------|---------|----------------|
| **Rate — burst** | requests / minute / user | `20` | scripted floods |
| **Rate — daily** | requests / day / user (resets UTC midnight) | `500` | slow-drip grinding |
| **Balance cap** | max balance / user | `$100` (100M credits) | unlimited free test-mode top-ups |

- Exceeding a rate limit returns **HTTP 429** with a `Retry-After` header.
- Insufficient balance returns **HTTP 402**.
- Blocked requests **do not** consume quota (the counter increments only after the gate
  passes); retries of the same request id are idempotent and never burn a slot.
- Current usage is exposed read-only via `GET /api/credit/balance` and shown on the
  dashboard (`today N / 500 · 20/min · cap $100`).
- Defaults are constants in `src/infra/ledger/DurableObjectLedger.ts`
  (`MAX_REQ_PER_MIN`, `MAX_REQ_PER_DAY`, `MAX_BALANCE_CREDITS`).

> A **global** (tenant-wide) daily kill-switch — to stop large-scale multi-account farming
> that per-user limits can't catch — is intentionally left out of the demo. Add a singleton
> Durable Object counter for production.

---

## Architecture

Ports-and-adapters (hexagonal). The use case depends only on domain interfaces; every
external system is an adapter.

```
src/
  domain/         # interfaces + types (ports): IAuthProvider, ICreditLedger,
                  #   IRatePlan, IAuditSink, IAiProviderClient, ...
  usecase/
    AiCallUseCase.ts        # reserve → invoke → meter → settle → audit
  infra/          # adapters (implementations):
    auth/         #   SupabaseJwtAuthProvider  (JWKS verification via jose)
    provider/     #   DeepSeekClient, BailianClient  (LLM / vision / ASR)
    ledger/       #   CreditLedger (Durable Object) + CreditLedgerStub  (+ rate limiting)
    pricebook/    #   ConfigPriceBook (default, reads config.ts) + D1PriceBook (alt)
    rateplan/     #   RatePlan (unit-aware: input/output/audio) + rawCostUsd()
    audit/        #   D1AuditSink
    usage/        #   TokenUsageExtractor / AudioDurationExtractor
    transport/    #   HttpTransportAdapter
  realtime/
    AsrRelay.ts   # WebSocket relay: browser ⇄ Worker ⇄ provider, reserve/settle
  config.ts       # ← single source of truth for ALL credit rules (see Configuration)
  ui.ts           # served single-page dashboard (HTML/CSS/JS)
  index.ts        # Worker entry: routing, auth, payments, config injection
migrations/       # D1 schema + seed price_book
```

**Stack:** Cloudflare Workers · D1 (SQLite) · Durable Objects · Supabase Auth (JWT/JWKS) ·
DeepSeek · Alibaba Bailian/DashScope · Creem · TypeScript.

### HTTP surface

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /` | — | Dashboard (Supabase config injected from env) |
| `POST /api/ai/run` | JWT | Chat / Vision / offline ASR |
| `GET /api/asr/stream` (WS) | JWT (`?token=`) | Realtime ASR |
| `GET /api/credit/balance` | JWT | Balance + rate-limit snapshot |
| `GET /api/audit/log` | JWT | Recent spend + top-ups |
| `POST /api/payment/checkout` | JWT | Create a Creem checkout |
| `POST /api/payment/webhook` | HMAC | Creem webhook → top up |

---

## Setup

### Prerequisites

- Node ≥ 18, a Cloudflare account (`npx wrangler login`)
- A [Supabase](https://supabase.com) project (email/password auth; optionally Google OAuth)
- API keys: [DeepSeek](https://platform.deepseek.com),
  [Alibaba Bailian/DashScope](https://bailian.console.aliyun.com)
- (Optional, for payments) a [Creem](https://creem.io) account + product

### 1. Install

```bash
npm install
```

### 2. Create your config + D1 database

```bash
cp wrangler.toml.example wrangler.toml            # gitignored — holds your real ids
npx wrangler d1 create ai-gateway-demo-db
# paste the printed database_id into wrangler.toml
npx wrangler d1 migrations apply ai-gateway-demo-db --remote
```

### 3. Configure public vars (`wrangler.toml [vars]`)

Replace **all** of these with your own project's values — otherwise the app authenticates
against, and creates users in, the demo's Supabase project:

```toml
SUPABASE_JWKS_URL    = "https://YOUR-PROJECT.supabase.co/auth/v1/.well-known/jwks.json"
SUPABASE_PROJECT_URL = "https://YOUR-PROJECT.supabase.co"
SUPABASE_ANON_KEY    = "sb_publishable_xxx"   # public (shipped to the browser)
CREEM_PRODUCT_ID     = "prod_xxx"
```

### 4. Set secrets

```bash
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put BAILIAN_API_KEY
npx wrangler secret put CREEM_API_KEY          # optional (payments)
npx wrangler secret put CREEM_WEBHOOK_SECRET   # optional (payments)
```

For local dev, copy `.dev.vars.example` → `.dev.vars` and fill it in.

### 5. Auth redirect URLs (Supabase)

In **Supabase → Authentication → URL Configuration**, set **Site URL** to your deployed
domain and add `https://<your-domain>/**` to **Redirect URLs** (and `http://localhost:8787/**`
for local dev). For Google OAuth, also configure the Google Cloud OAuth client — the
authorized redirect URI is always `https://<project-ref>.supabase.co/auth/v1/callback`.

### 6. Run / deploy

```bash
npm run dev      # local (wrangler dev)
npm run deploy   # to Cloudflare  (runs a build-time HTML/JS syntax check first)
```

Point your Creem webhook at `https://<your-worker>/api/payment/webhook`.

---

## Security & production notes

This repo is a **learning reference**. It already does the essentials:

- ✅ Verifies the Supabase JWT signature (JWKS/ES256) on **every** authenticated route.
- ✅ Verifies the Creem webhook **HMAC** signature (fail-closed) before crediting.
- ✅ Persists the credit balance, reservations, and top-up idempotency keys durably.
- ✅ Per-user rate limiting + balance cap.

Before running anything resembling production, also consider:

- **Global / tenant-wide limits** — per-user limits don't stop mass multi-account farming.
- **Markup / pricing** — the 100× markup is a demo aid; set real rates in `src/config.ts`.
- **CORS** is wide open (`*`) for demo convenience; restrict it.
- **Reservation TTL/prune** logic (`CreditLedger`) — review for your workload.
- Rotate any key that has ever been shared.

No secrets are committed to this repo (`.dev.vars` is gitignored; secrets live in
`wrangler secret`).

## License

[MIT](./LICENSE)
