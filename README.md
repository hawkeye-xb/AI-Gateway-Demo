# ⚡ AI Gateway Demo

A credit-metered, multi-modal **AI gateway** running entirely on Cloudflare Workers.
It sits in front of several AI providers, meters usage, applies markup, and bills a
prepaid **credit** balance per user — the core of what a commercial "AI API platform"
does, in one small, readable, hexagonal-architecture codebase.

> **Live demo:** https://ai-gateway-demo.lizhaowen0722.workers.dev
>
> This is a reference/learning project, not a production service. See
> [Security & production notes](#security--production-notes).

---

## What it does

| Modality | Provider / model | Billing unit |
|----------|------------------|--------------|
| 💬 **Chat** | DeepSeek — `deepseek-chat` | input + output tokens |
| 🖼️ **Vision** | Bailian — `qwen-vl-max` | input + output tokens |
| 📁 **ASR (offline)** | Bailian — `qwen3-asr-flash` (sync) | audio seconds |
| 🔴 **ASR (realtime)** | Bailian — `paraformer-realtime-v2` (WebSocket) | audio seconds |

Every call flows through one pipeline: **authenticate → reserve → invoke provider →
meter usage → settle → audit**.

### Highlights

- **Prepaid credit ledger** on a per-user Durable Object with a real
  **reserve → settle** lifecycle (hold funds up front, charge the exact metered cost
  after). New accounts are seeded with demo credits.
- **Realtime streaming ASR** over WebSocket: the browser streams mic PCM to the
  Worker, which relays to the provider and streams transcripts back live. Credits are
  **pre-authorized on connect** and **settled by actual streamed duration on stop**.
- **Transparent pricing** — a D1 `price_book` stores each provider's raw cost; the
  gateway applies a markup (100× in this demo, to make credit movement visible) and
  converts to integer credits.
- **Payments** via [Creem](https://creem.io): checkout + signature-verified webhook
  that tops up the ledger idempotently.
- **Usage audit** — every spend and top-up is recorded in D1 and shown in the UI.

---

## Credits & billing model

- **1 credit = $0.0001 USD**, so **1,000,000 credits = $1**. Credits are stored as integers.
- Charged price = `raw_provider_cost × markup_multiplier`, converted to credits and
  rounded up. This demo uses a **100× markup** purely so balance changes are easy to
  see; change `markup_multiplier` in the `price_book` for realistic pricing.
- Formula (see `src/infra/rateplan/TokenBasedRatePlan.ts`):

  ```
  credits = ceil( usage × raw_cost_per_unit × markup / 0.0001 )
  ```

Everything metered is authoritative at **settle** time; the pre-call **reserve** is
only an affordability gate (an upper-ish estimate), never the final charge.

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
    ledger/       #   CreditLedger (Durable Object) + CreditLedgerStub
    pricebook/    #   D1PriceBook
    rateplan/     #   TokenBasedRatePlan / DurationBasedRatePlan
    audit/        #   D1AuditSink
    usage/        #   TokenUsageExtractor / AudioDurationExtractor
    transport/    #   HttpTransportAdapter
  realtime/
    AsrRelay.ts   # WebSocket relay: browser ⇄ Worker ⇄ provider, reserve/settle
  index.ts        # Worker entry: routing, auth, payments, config injection, and
                  #   the served single-page dashboard (HTML)
migrations/       # D1 schema + seed price_book
```

**Stack:** Cloudflare Workers · D1 (SQLite) · Durable Objects · Supabase Auth
(JWT/JWKS) · DeepSeek · Alibaba Bailian/DashScope · Creem · TypeScript.

### HTTP surface

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /` | — | Dashboard (Supabase config injected from env) |
| `POST /api/ai/run` | JWT | Chat / Vision / offline ASR |
| `GET /api/asr/stream` (WS) | JWT (`?token=`) | Realtime ASR |
| `GET /api/credit/balance` | JWT | Current balance |
| `GET /api/audit/log` | JWT | Recent spend + top-ups |
| `POST /api/payment/checkout` | JWT | Create a Creem checkout |
| `POST /api/payment/webhook` | HMAC | Creem webhook → top up |

---

## Setup

### Prerequisites

- Node ≥ 18, a Cloudflare account (`npx wrangler login`)
- A [Supabase](https://supabase.com) project (email/password auth)
- API keys: [DeepSeek](https://platform.deepseek.com),
  [Alibaba Bailian/DashScope](https://bailian.console.aliyun.com)
- (Optional, for payments) a [Creem](https://creem.io) account + product

### 1. Install

```bash
npm install
```

### 2. Create the D1 database

```bash
npx wrangler d1 create ai-gateway-demo-db
# put the printed database_id into wrangler.toml
npx wrangler d1 migrations apply ai-gateway-demo-db --remote
```

### 3. Configure public vars (`wrangler.toml [vars]`)

Replace **all** of these with your own project's values — otherwise the app
authenticates against, and creates users in, the demo's Supabase project:

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
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put CREEM_API_KEY
npx wrangler secret put CREEM_WEBHOOK_SECRET
```

For local dev, copy `.dev.vars.example` → `.dev.vars` and fill it in.

### 5. Run / deploy

```bash
npm run dev      # local (wrangler dev)
npm run deploy   # to Cloudflare  (runs a build-time HTML/JS syntax check first)
```

Point your Creem webhook at `https://<your-worker>/api/payment/webhook`.

---

## Security & production notes

This repo is a **learning reference**. It does verify Supabase JWT signatures on every
authenticated route and the Creem webhook HMAC signature, but before running anything
resembling production you should also consider:

- **Rate limiting / abuse protection** on the AI routes (none here).
- **Reservation durability** — realtime holds are persisted, but review the TTL/prune
  logic (`CreditLedger`) for your workload.
- **Markup / pricing** — the 100× markup is a demo aid; set real prices in `price_book`.
- **CORS** is wide open (`*`) for demo convenience; restrict it.
- Rotate any key that has ever been shared.

No secrets are committed to this repo (`.dev.vars` is gitignored; secrets live in
`wrangler secret`).

## License

[MIT](./LICENSE)
