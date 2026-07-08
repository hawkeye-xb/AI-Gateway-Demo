# ⚡ AI Gateway Demo

[English](./README.md) · **简体中文**

一个完全运行在 Cloudflare Workers 上的、按 **credit 计费**的多模态 **AI 网关**。
它挡在多个 AI 服务商前面，计量用量、加价、执行每用户限流，并从每个用户的预付
**credit** 余额里扣费——用一份小而可读、六边形架构的代码，实现了商业化"AI API 平台"
的核心。

> **在线 Demo：** https://ai-gateway-demo.hawkeye-xb.com
>
> 这是一个参考/学习项目，不是生产级服务。见
> [安全与生产注意事项](#安全与生产注意事项)。

---

## 这个项目的目的

商业化的 AI API 平台（比如 OpenRouter 那类代理，或任何"转售 LLM 调用 + credit 计费"
的产品）本质上都在解决同一批难题：给用户鉴权、计量 token/秒用量、加价、原子地从预付
余额扣费、收款、防刷。这些问题通常埋在一个跑在服务器上的庞大 SaaS 后端里。

**这个项目想证明：这整套核心能力可以完全建在 serverless 免费额度上——不用服务器、零
固定成本——而且代码小到一个下午能读完。** 它的目标：

1. **一份可运行的 reserve → settle（预扣 → 结算）参考实现**——同时正确地为即时调用和
   长连接流式会话计费，不多扣也不少扣。
2. **验证"零固定成本"架构**——Cloudflare Workers + D1 + Durable Objects + Supabase Auth，
   全部走免费额度。你只需要付上游模型服务商的钱。
3. **一个干净的 SOLID / 六边形架构范例**——用例只依赖领域接口；每个外部系统（鉴权、
   服务商、账本、价目表、支付）都是可替换的适配器。
4. **把坑记录下来**——JWT 验签、webhook HMAC、定价的浮点取整、Durable Object 持久化、
   每用户限流。每一个都曾是真实的 bug；每一个都已解决并写清楚。

它**不是**开箱即用的生产服务——它是一份供你 fork、读懂、改造的教学实现。

---

## 它能做什么

| 模态 | 服务商 / 模型 | 计费单位 |
|------|---------------|----------|
| 💬 **对话** | DeepSeek — `deepseek-chat` | 输入 + 输出 token |
| 🖼️ **视觉** | 百炼 — `qwen-vl-max` | 输入 + 输出 token |
| 📁 **语音识别（离线）** | 百炼 — `qwen3-asr-flash`（同步） | 音频秒数 |
| 🔴 **语音识别（实时）** | 百炼 — `paraformer-realtime-v2`（WebSocket） | 音频秒数 |

每次调用都走同一条流水线：**鉴权 → 限流 → 预扣 → 调用服务商 → 计量 → 结算 → 审计**。

### 亮点

- **预付 credit 账本**，跑在每用户一个的 Durable Object 上，带真实的 **reserve → settle**
  生命周期（先冻结额度，事后按实际计量精确扣费）。新账号会发放 demo credits。
- **实时流式语音识别**（WebSocket）：浏览器把麦克风 PCM 流传给 Worker，Worker 中继到
  服务商，再把字幕实时流回来。credits 在**连接时预扣**、**停止时按实际流过的音频秒数
  结算**。
- **每用户限流与防刷**——挂在账本收口处（见[下文](#限流与防刷)）。
- **透明定价**——每个 model 的原始成本 + 加价都在 `src/config.ts` 一个文件里；网关按 input/
  output 各自单价计费（本 demo 用 100× 加价，让 credit 变化肉眼可见）后换算成整数 credits。
- **支付**走 [Creem](https://creem.io)：checkout + 验签的 webhook，幂等地给账本充值。
- **用量审计**——每一笔消费和充值都记进 D1，并显示在界面上。
- **社交 + 邮箱登录**——Supabase 邮箱/密码，以及 Google OAuth。

---

## Credit 与计费模型

- **1 credit = $0.0001 美元**，所以 **1,000,000 credits = $1**。credits 以整数存储。
- 收费 = `服务商原始成本 × 加价`，换算成 credits 后向上取整。本 demo 用 **100× 加价**纯粹
  是为了让余额变化容易看清；在 `src/config.ts` 里设你的真实毛利。
- **input 和 output 按各自单价计费**（不是加总后按 input 价收）。deepseek 的 output 单价
  约为 input 的 4 倍，所以 output 多的调用成本按比例更高。
- 公式（见 `src/infra/rateplan/TokenBasedRatePlan.ts`）：

  ```
  credits = ceil( (inputTokens × input单价 + outputTokens × output单价) × 加价 / 0.0001 )
  ```

所有计量以**结算（settle）**为准；调用前的**预扣（reserve）**只是一道额度够不够的闸门
（一个偏高的估算），从来不是最终扣费。

---

## 配置——一个文件（`src/config.ts`）

所有**计费规则**都在一个带类型的文件 `src/config.ts` 里——这是你定制计费唯一要改的文件。
基础设施身份（CF 账号、D1 id、Supabase、API keys）仍在 `wrangler.toml` + `wrangler secret`，
不在这里。

| 项 | 字段 | 控制什么 |
|----|------|----------|
| 注册赠额 | `ledger.initialCredits` | 首次使用赠送的 credits（填 `0` 关闭） |
| 余额上限 | `ledger.maxBalanceCredits` | 每用户余额上限（防薅） |
| 限流 | `ledger.rateLimit.{perMinute,perDay}` | 每用户请求频率 |
| 汇率 | `creditExchangeRateUsd` | 每 credit 多少美元 |
| 定价 | `pricing.models[]` | 每 model 的 `rates`（input/output/audio）+ 可选 per-model `markup` |
| 默认加价 | `pricing.defaultMarkup` | model 没写 `markup` 时用它 |
| ASR 上限 | `asr.{holdSeconds,maxSeconds}` | 实时会话预扣 + 硬上限 |
| 充值套餐 | `packages` | 服务端 价格↔credits 表（客户端只传套餐 id） |

**价目真源（fork 者必看）：** 默认价目表读的是 `config.ts`（`ConfigPriceBook`）。D1 的
`price_book` 表仍然存在（migration 会创建），但**默认不被使用**——直接改那张 SQL 表**不会
生效**，除非你切换价目源。如果想让价格能运行时改（SQL `UPDATE`，不用重新部署）而不是代码
常量，在 `buildUseCase()`（`index.ts`）里改一行：`new ConfigPriceBook()` →
`new D1PriceBook(env.DB)`（`AsrRelay.ts` 里同理）。这一行切换正是 hexagonal 架构兑现价值的
地方——价目是通过 `IPriceBook` 接口注入的适配器。

### 生产化清单（fork → 上线）

因为规则都收敛了，fork 到生产是配置/常量级的，不用动领域逻辑：

1. **`config.ts`** —— 设 `initialCredits`（通常 `0`）、真实 `pricing.models` 单价 +
   `defaultMarkup`（去掉 demo 的 100×）、`packages`、按容量设 `rateLimit`。
2. **密钥** —— 真实 provider key + 正式（非 test）Creem key，走 `wrangler secret`。
3. **`wrangler.toml [vars]`** —— 你的 Supabase 项目 + Creem product id；收紧 CORS（现在是 `*`）。
4. **Cloudflare WAF** —— 加全局限流规则（每用户限流挡不住多账号农场，见下文）。
5. **验证退款** —— webhook 已处理 `refund.created` / `dispute.created`（扣回 credits，
   幂等，clamp 到 0）。收真钱前用你 Creem 账号的真实退款事件确认 metadata 路径。

---

## 限流与防刷

因为本 demo 的 Creem 跑在 **test mode**，充值实际上是免费的——所以光靠 credit 余额根本
挡不住刷。因此限流是网关的**一等功能**，挂在每用户 Durable Object 的 `reserve()` 收口处
（所有计费调用都必经此处）：

| 层 | 限制 | 默认值 | 拦什么 |
|----|------|--------|--------|
| **频率 — 突发** | 每用户每分钟请求数 | `20` | 脚本狂刷 |
| **频率 — 每日** | 每用户每天请求数（UTC 零点重置） | `500` | 慢速刷量 |
| **余额上限** | 每用户余额上限 | `$100`（100M credits） | test mode 无限免费充值 |

- 超频返回 **HTTP 429**，带 `Retry-After` 头。
- 余额不足返回 **HTTP 402**。
- 被拦的请求**不消耗**配额（计数器在过闸之后才递增）；同一 request id 的重试是幂等的，
  永远不烧配额。
- 当前用量通过 `GET /api/credit/balance` 只读透出，并显示在界面上
  （`今日 N / 500 · 20/分 · 上限 $100`）。
- 默认值是 `src/infra/ledger/DurableObjectLedger.ts` 里的常量
  （`MAX_REQ_PER_MIN`、`MAX_REQ_PER_DAY`、`MAX_BALANCE_CREDITS`）。

> **全局**（全租户）每日熔断——用来挡每用户限流拦不住的大规模多账号农场——本 demo 有意
> 没做。生产环境加一个 singleton Durable Object 计数器即可。

---

## 架构

端口与适配器（六边形）。用例只依赖领域接口；每个外部系统都是一个适配器。

```
src/
  domain/         # 接口 + 类型（端口）：IAuthProvider, ICreditLedger,
                  #   IRatePlan, IAuditSink, IAiProviderClient, ...
  usecase/
    AiCallUseCase.ts        # 预扣 → 调用 → 计量 → 结算 → 审计
  infra/          # 适配器（实现）：
    auth/         #   SupabaseJwtAuthProvider（用 jose 做 JWKS 验签）
    provider/     #   DeepSeekClient, BailianClient（LLM / 视觉 / 语音）
    ledger/       #   CreditLedger（Durable Object） + CreditLedgerStub（含限流）
    pricebook/    #   ConfigPriceBook（默认，读 config.ts） + D1PriceBook（替代）
    rateplan/     #   RatePlan（按单位区分 input/output/audio） + rawCostUsd()
    audit/        #   D1AuditSink
    usage/        #   TokenUsageExtractor / AudioDurationExtractor
    transport/    #   HttpTransportAdapter
  realtime/
    AsrRelay.ts   # WebSocket 中继：浏览器 ⇄ Worker ⇄ 服务商，预扣/结算
  config.ts       # ← 所有计费规则的唯一真源（见「配置」章节）
  ui.ts           # 内置的单页仪表盘（HTML/CSS/JS）
  index.ts        # Worker 入口：路由、鉴权、支付、配置注入
migrations/       # D1 表结构 + price_book 种子数据
```

**技术栈：** Cloudflare Workers · D1 (SQLite) · Durable Objects · Supabase Auth (JWT/JWKS)
· DeepSeek · 阿里百炼/DashScope · Creem · TypeScript。

### HTTP 接口

| 路由 | 鉴权 | 用途 |
|------|------|------|
| `GET /` | — | 仪表盘（Supabase 配置从 env 注入） |
| `POST /api/ai/run` | JWT | 对话 / 视觉 / 离线语音 |
| `GET /api/asr/stream` (WS) | JWT（`?token=`） | 实时语音 |
| `GET /api/credit/balance` | JWT | 余额 + 限流快照 |
| `GET /api/audit/log` | JWT | 近期消费 + 充值 |
| `POST /api/payment/checkout` | JWT | 创建 Creem checkout |
| `POST /api/payment/webhook` | HMAC | Creem webhook → 充值 |

---

## 部署

### 前置条件

- Node ≥ 18，一个 Cloudflare 账号（`npx wrangler login`）
- 一个 [Supabase](https://supabase.com) 项目（邮箱/密码登录；可选 Google OAuth）
- API keys：[DeepSeek](https://platform.deepseek.com)、
  [阿里百炼/DashScope](https://bailian.console.aliyun.com)
- （可选，用于支付）一个 [Creem](https://creem.io) 账号 + 产品

### 1. 安装

```bash
npm install
```

### 2. 创建你的配置 + D1 数据库

```bash
cp wrangler.toml.example wrangler.toml            # 已 gitignore——存你自己的真实 id
npx wrangler d1 create ai-gateway-demo-db
# 把打印出来的 database_id 填进 wrangler.toml
npx wrangler d1 migrations apply ai-gateway-demo-db --remote
```

### 3. 配置公开变量（`wrangler.toml [vars]`）

把下面这些**全部**换成你自己项目的值——否则你的应用会去原 demo 的 Supabase 项目里
鉴权、并在里面创建用户：

```toml
SUPABASE_JWKS_URL    = "https://YOUR-PROJECT.supabase.co/auth/v1/.well-known/jwks.json"
SUPABASE_PROJECT_URL = "https://YOUR-PROJECT.supabase.co"
SUPABASE_ANON_KEY    = "sb_publishable_xxx"   # 公开（会发到浏览器）
CREEM_PRODUCT_ID     = "prod_xxx"
```

### 4. 设置密钥

```bash
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put BAILIAN_API_KEY
npx wrangler secret put CREEM_API_KEY          # 可选（支付）
npx wrangler secret put CREEM_WEBHOOK_SECRET   # 可选（支付）
```

本地开发：复制 `.dev.vars.example` → `.dev.vars` 并填好。

### 5. 登录回跳地址（Supabase）

在 **Supabase → Authentication → URL Configuration** 里，把 **Site URL** 设为你部署的
域名，并在 **Redirect URLs** 加上 `https://<你的域名>/**`（本地开发再加
`http://localhost:8787/**`）。用 Google OAuth 的话还要配 Google Cloud 的 OAuth client——
授权回跳 URI 永远是 `https://<project-ref>.supabase.co/auth/v1/callback`。

### 6. 运行 / 部署

```bash
npm run dev      # 本地（wrangler dev）
npm run deploy   # 部署到 Cloudflare（部署前会先跑一次 HTML/JS 语法检查）
```

把你的 Creem webhook 指向 `https://<你的-worker>/api/payment/webhook`。

---

## 安全与生产注意事项

这个仓库是**学习参考**。它已经做好了这些基本功：

- ✅ 在**每一个**需鉴权的路由上验 Supabase JWT 签名（JWKS/ES256）。
- ✅ 充值前验 Creem webhook 的 **HMAC** 签名（fail-closed，验不过就拒）。
- ✅ 持久化 credit 余额、预扣记录、充值幂等 key。
- ✅ 每用户限流 + 余额上限。

在跑任何接近生产的东西之前，还要考虑：

- **全局 / 全租户限制**——每用户限流挡不住大规模多账号农场。
- **加价 / 定价**——100× 加价只是 demo 辅助；在 `src/config.ts` 设真实单价。
- **CORS** 为了 demo 方便开成了全放（`*`）；生产要收紧。
- **预扣的 TTL / 清理**逻辑（`CreditLedger`）——按你的负载 review。
- 任何曾经共享过的 key 都要轮换。

仓库里不含任何密钥（`.dev.vars` 已 gitignore；密钥都在 `wrangler secret`）。

## 许可证

[MIT](./LICENSE)
