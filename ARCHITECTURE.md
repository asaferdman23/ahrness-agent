# Ahrness Agent — Architecture

A WhatsApp-first AI marketing agent platform. Clients onboard via a web UI, pick a role, connect their platforms, and get a fully personalized AI agent that knows their business and tools.

---

## Table of Contents

- [Overview](#overview)
- [Onboarding Flow](#onboarding-flow)
- [Messaging Channels](#messaging-channels)
- [Roles](#roles)
- [Skills](#skills)
- [MCP Platform Registry](#mcp-platform-registry)
- [Data Layer](#data-layer)
- [Agent Construction](#agent-construction)
- [Asset Awareness](#asset-awareness)
- [File Structure](#file-structure)
- [Environment Variables](#environment-variables)

---

## Overview

```
Client (WhatsApp) ──► Agent (role-specific tools + skills + business context)
                            │
              ┌─────────────┼─────────────────────┐
              ▼             ▼                      ▼
         Meta Ads     Instagram Graph       Higgsfield / TikTok / Google
         MCP           API tools             MCP / API tools
```

Each client gets one agent instance per conversation, built dynamically from:
1. Their **business profile** (assets, goals, brand voice)
2. Their chosen **role** (defines which tools and skills load)
3. Their **connected platforms** (OAuth tokens per service)

---

## Onboarding Flow

Served at `/onboarding` from the existing Node.js process. The production flow is
a six-step Vite/TypeScript client backed by tenant-scoped JSON endpoints. Legacy
server-rendered views remain in `src/onboarding/server.ts` as a fallback, but
`frontend/onboarding/` is the current product surface.

The customer sees three phases while the six existing routes remain compatible:

1. **Brief** (step 1): business name, concise description, optional website and
   collapsed enrichment fields. A tool-free model creates a cached first-value
   preview; invalid output, timeout, or missing model configuration falls back
   to an honest deterministic starter plan.
2. **Configure** (steps 2–4): specialist, explicit routine choice, and progressive
   platform connections. Missing integrations identify unavailable capabilities
   but do not block the activation-v2 cohort from continuing.
3. **Launch** (steps 5–6): verified managed or linked WhatsApp setup, followed by
   three role-aware starter briefs and a prefilled WhatsApp action.

`ONBOARDING_ACTIVATION_V2_PERCENT` assigns sessions deterministically to the new
experience. The legacy cohort retains the six-step rail and hard integration gate.

### Onboarding readiness contract

The client never trusts the URL or an optimistic local step counter. The
bootstrap and status APIs return `progress`, derived by
`src/onboarding/progress.ts` from persisted state:

1. profile saved;
2. valid role saved;
3. automation decision saved (`scheduleTemplates` may intentionally be empty);
4. role-required platforms are reported as capability readiness, but are not a
   core launch gate for activation v2;
5. WhatsApp binding is verified, including the current Baileys socket state.

`progress.allowedStep` is the furthest trustworthy screen and
`progress.readiness` is one of `needs_profile`, `needs_role`,
`needs_automations`, `needs_connections`, `needs_whatsapp`, or `live`. POST
endpoints validate their own prerequisites; disabled client controls are not a
security boundary. The complete product and release plan is in
`docs/superpowers/plans/2026-07-18-production-onboarding.md`.

## Messaging Channels

WhatsApp is the primary channel; a client can additionally connect a personal
Telegram bot so the *same* agent (same profile, role, connections, memory) is
reachable there too.

- **Identity**: `runAndDeliver`/`buildClientAgent` resolve a client from a
  "jid" string via `clientIdForJid` (`src/tenant-store.ts`). For WhatsApp that
  is a real JID looked up in the tenant table (or hashed, pre-auth). Telegram
  (and, later, Slack) instead pass a synthetic address encoded by
  `src/channel-address.ts` — `agent-client:<clientId>:<channel>:<channelAddress>`
  — which `clientIdForJid` decodes directly, short-circuiting the WhatsApp
  lookup. This is what lets a Telegram conversation share the client's
  existing profile/role/connections/session memory without a schema change.
- **Transport**: `src/whatsapp-transport.ts`'s `WhatsAppTransport` interface
  (`sendText`/`sendImage`/`sendVideo`/`sendAudio`/`sendDocument`) is
  channel-agnostic in shape; `src/telegram-transport.ts` implements it against
  the raw Telegram Bot HTTPS API (`src/telegram-client.ts` — no SDK
  dependency, plain `fetch`/`FormData`).
- **Connecting a bot — two supported models**:
  1. **Shared platform bot (self-serve, recommended)**: set `TELEGRAM_BOT_TOKEN`
     to one bot you own; the dashboard (`src/dashboard.ts`, wired in
     `callback-server.ts`) shows a "Connect Telegram" button that opens
     `t.me/<bot>?start=<signed clientId>` (`src/telegram-shared-bot.ts`). The
     signature reuses the same HMAC helper as onboarding links
     (`signClientToken`/`verifyClientToken` in `onboarding/client-link.ts`).
     Tapping Start sends `/start <token>` as the chat's first message; the bot
     verifies it and binds that chat to the client (`bindSharedTelegramChat` in
     `telegram-store.ts` — a global chatId→clientId index at
     `store/telegram-shared-chats.json`, plus `ClientMeta.telegramChatId` as a
     forward pointer for the dashboard's connected/not status).
  2. **BYO per-client bot**: each client brings their own bot (BotFather
     token). There's no self-serve UI for this path — an operator runs
     `npm run connect:telegram -- <clientId> <botToken>`
     (`scripts/connect-telegram.ts`), which validates the token and stores it
     encrypted at `store/clients/<clientId>/telegram.json`
     (`src/telegram-store.ts`, same vault as OAuth tokens). The bot locks
     itself to whichever chat messages it first (`ownerChatId`) — a
     personal-assistant lockdown mirroring Baileys' "home group" binding.

  Both models funnel into the same `deliverTelegramMessage` (`telegram.ts`)
  once a chat is bound to a clientId, so the reply/media/scheduler behavior is
  identical either way.
- **Runtime**: `src/telegram.ts` exports `runTelegramPollLoop`, a shared
  `getUpdates` long-poller. `src/telegram-manager.ts`'s
  `TelegramSessionManager` (mirrors `BaileysSessionManager`) runs one poller
  per BYO-connected client at boot; `src/telegram-shared-bot.ts` runs a single
  poller for the shared bot, if configured. Both are started from
  `src/index.ts`, and errors in one client's/bot's loop don't affect another's.
- **Caveat**: the connect link never expires (same as the existing
  `onboardingUrlFor` links) — a leaked link binds whoever taps it. Fine for
  now given it mirrors an already-accepted pattern in this codebase; revisit
  if Telegram connect links start getting shared outside a 1:1 context.
- **Slack**: multi-tenant — each client installs your Slack App into their own
  workspace via a "Connect Slack" dashboard button (OAuth v2,
  `src/slack-oauth.ts`). `state` reuses the same `signClientToken` HMAC helper
  as the Telegram deep link. `src/slack-client.ts` is a minimal Web API client
  (fetch-based, same no-SDK rationale as Telegram) including Slack's 3-step
  external file upload flow. Inbound DMs arrive at a single
  `POST /webhooks/slack/events` (`src/slack.ts`), signature-verified per
  Slack's request-signing spec, deduped by `event_id` (Slack retries
  deliveries), and resolved to a clientId via `team_id` →
  `slack-store.ts`'s reverse index (`store/slack-team-index.json`) —
  mirroring the Telegram shared-bot's chat index. Only 1:1 DMs are handled
  (`channel_type === 'im'`), matching Telegram's owner-only lockdown; bot's
  own messages are filtered via `event.bot_id` to avoid reply loops. Requires
  a Slack App you create at api.slack.com/apps — see `.env.example` for the
  exact Redirect URL / Event Subscriptions URL to configure there.

## Scheduler

The Strands SDK is request-driven and has no time-based scheduler, so cadence is an
app-layer concern (`src/scheduler/`).

```
ScheduledJob (store/clients/<clientId>/schedules.json)
  └─ { jid, title, prompt, schedule: cron|once, templateId?, enabled, lastRunAt, runCount }

runner.ts   — ticks every 30s, finds due jobs (timezone-aware cron, no deps),
              and runs each through the shared delivery path → proactive WhatsApp message.
cron.ts     — minimal 5-field cron evaluator (ranges, lists, *​/n steps, Vixie OR-semantics),
              matched against wall-clock minute in the client's timezone (AGENT_TIMEZONE).
templates.ts— per-role use cases (weekly digest, daily ROAS, content calendar, …).
tools.ts    — schedule_task / list / cancel / pause tools the agent uses live in chat.
```

Two ways jobs are created:
- **In chat** — the agent calls `schedule_task` ("remind me every Monday at 9"). The live
  WhatsApp JID is known, so delivery always targets the right chat.
- **In onboarding** — selected templates are stored on `role.json.scheduleTemplates` and
  materialized into live jobs (idempotently) the next time that client's agent is built.

### Onboarding Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/onboarding/bootstrap[?c=<token>]` | Typed client bootstrap, saved choices, and server-derived readiness |
| GET | `/api/onboarding/status` | Current connections, WhatsApp verification, and readiness for live updates |
| POST | `/api/onboarding/profile` | Validate and save the business brief |
| POST | `/api/onboarding/preview` | Return a cached AI/fallback first-value preview for the saved profile |
| POST | `/api/onboarding/events` | Accept an allowlisted, privacy-safe activation event and forward best-effort to PostHog |
| POST | `/api/onboarding/role` | Save the specialist; changing it resets the routine decision |
| POST | `/api/onboarding/automations` | Save the explicit recurring-job selection, including an empty selection |
| POST | `/api/onboarding/whatsapp-provider` | Save the WhatsApp setup after prerequisite validation |
| POST | `/api/onboarding/whatsapp-disconnect` | Disconnect a linked client-owned device and return to recovery |
| GET | `/onboarding[?c=<token>]` | Adopt signed client link, then redirect to current step |
| GET | `/onboarding/step/:n` | Render step N (1 Profile, 2 Role, 3 Automations, 4 Connect, 5 Link, 6 Ready) |
| POST | `/onboarding/step/1` | Save business profile |
| POST | `/onboarding/step/2` | Save role choice |
| POST | `/onboarding/step/3` | Save chosen automations to `role.json.scheduleTemplates` |
| GET | `/oauth/:platform/callback` | Handle OAuth redirect, save token, return to step 4 |
| GET | `/onboarding/qr-stream` | SSE stream of QR updates |
| GET | `/onboarding/status` | JSON: `{ step, connections, whatsappLinked }` |

Activation events are also retained as a bounded atomic record under each client
directory. Properties are fixed to low-cardinality phase, step, platform, outcome,
duration, and preview-source values; profile text, URLs, prompts, phone numbers,
credentials, and OAuth data are never accepted. Successful message delivery marks
`first_agent_output_delivered` from the server-side delivery path.

### Client key (web ↔ runtime)

The runtime keys every client by `clientIdFromJid(jid)` (sha256 of the WhatsApp JID),
but a web onboarding session has no JID of its own. To bridge them, the agent sends each
un-onboarded client an onboarding link carrying their **HMAC-signed JID** (`?c=<token>`,
signed with `MEDIA_SIGNING_SECRET`; see `onboarding/client-link.ts`). On first load the
session adopts `clientId = clientIdFromJid(jid)`, so the profile, role, automations, and
platform tokens all save under the same key the agent reads at message time. Without a
signing secret the link falls back to a session-keyed flow (web setup won't reach the
runtime — fine for local demos).

The same signed token is passed as the OAuth `state` on every platform connect. The
callback verifies it (`verifyClientToken`) and keys the saved token by the client it
encodes — binding the token exchange to that client and protecting against CSRF. A state
that is neither a valid signed token nor the current session id is rejected.

---

## Roles

One role per client. Chosen during onboarding. Determines which skills, MCPs, and system prompt additions the agent receives.

### 📣 Marketing Manager
- **Skills:** `meta-ads-expert`, `ad-performance-analysis`, `higgsfield-creative`, `business-context`
- **Required MCPs:** `meta-ads`
- **Optional MCPs:** `instagram-graph`, `tiktok`, `google`, `higgsfield`
- **Focus:** Cross-channel strategy, campaign planning, referencing the client's full asset inventory.

### 🎨 Creative Director
- **Skills:** `higgsfield-creative`, `whatsapp-personal-assistant`, `business-context`
- **Required MCPs:** `higgsfield`
- **Optional MCPs:** `instagram-graph`, `tiktok`
- **Focus:** On-brand visual asset generation, creative copywriting, brand voice enforcement.

### 📊 Ads Analyst
- **Skills:** `ad-performance-analysis`, `meta-ads-expert`, `business-context`
- **Required MCPs:** `meta-ads`
- **Optional MCPs:** `google`
- **Focus:** Data-driven campaign performance, ROAS optimization, anomaly detection.

### 📱 Social Media Manager
- **Skills:** `social-media-manager`, `higgsfield-creative`, `whatsapp-personal-assistant`, `business-context`
- **Required MCPs:** `instagram-graph`
- **Optional MCPs:** `tiktok`, `higgsfield`
- **Focus:** Organic content strategy, post drafting, scheduling, engagement tracking.

### 🤖 Personal Assistant / Developer
- **Skills:** `whatsapp-personal-assistant`, `software-developer`, `business-context`
- **Required MCPs:** _(none)_
- **Optional MCPs:** `higgsfield`
- **Focus:** Day-to-day tasks, research, drafting, sandbox-driven code execution and file processing.

---

## Skills

Skills live in `src/skills/<skill-name>/SKILL.md`. Each file has YAML frontmatter (`name`, `description`, `allowed-tools`) and a markdown body with full instructions.

The `AgentSkills` plugin (from `@strands-agents/sdk`) handles progressive disclosure: skill metadata is injected into the system prompt on every invocation; full instructions are loaded on demand when the agent calls the `skills` tool.

| Skill | Description |
|-------|-------------|
| `meta-ads-expert` | Campaign hierarchy, budget rules, audience targeting, creative specs, reporting workflow |
| `ad-performance-analysis` | Metrics reference (ROAS, CPA, CTR, CPM), diagnosis patterns, sandbox-based data export |
| `higgsfield-creative` | Model selection, image/video prompt craft, media handling, delivery workflow |
| `whatsapp-personal-assistant` | Scheduling, drafting, summarizing, general knowledge, tone guardrails |
| `social-media-manager` | Content strategy, caption formula, posting cadence, platform-specific best practices |
| `software-developer` | Sandbox-driven code execution, file processing, scripting, technical problem solving |
| `business-context` | Teaches the agent *how to use* the client's assets: fetch landing page copy, read Instagram posts, cross-reference organic vs paid |

---

## MCP Platform Registry

Each platform is defined in `src/mcps/<platform>.ts` and registered in `src/mcps/registry.ts`.

### meta-ads
- **Auth:** OAuth redirect → `/oauth/meta/callback`
- **Tools:** Full Meta Ads MCP via `meta-ads-mcp-server` (stdio)
- **Roles:** Marketing Manager, Ads Analyst

### instagram-graph
- **Auth:** OAuth redirect → `/oauth/instagram/callback`
- **Scopes:** `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`
- **Tools:** `get_instagram_profile`, `get_recent_media`, `get_media_insights`, `create_post`
- **Roles:** Marketing Manager, Creative Director, Social Media Manager

### tiktok
- **Auth:** OAuth redirect → `/oauth/tiktok/callback`
- **Scopes:** `user.info.basic`, `video.list`, `video.publish`, `ads.read`
- **Tools:** `get_tiktok_profile`, `list_videos`, `upload_video`
- **Roles:** Marketing Manager, Social Media Manager

### google
- **Auth:** OAuth2 PKCE → `/oauth/google/callback`
- **Scopes:** `analytics.readonly`, `searchconsole.readonly`
- **Tools:** `get_analytics_report` (GA4), `get_search_console_performance`
- **Roles:** Marketing Manager, Ads Analyst

### higgsfield
- **Auth:** OAuth redirect (shared server token) → `/oauth/higgsfield/callback`
- **Tools:** Full Higgsfield MCP (image, video, audio, 3D, upscale, remove-bg, etc.)
- **Roles:** Marketing Manager, Creative Director, Social Media Manager, Personal Assistant/Dev

---

## Data Layer

All client data lives under `store/clients/<clientId>/`. `clientId` is SHA-256 of the WhatsApp JID.

### `profile.json`

```json
{
  "clientId": "abc123...",
  "whatsappJid": "972501234567@s.whatsapp.net",
  "createdAt": "2026-06-21T10:00:00Z",
  "business": {
    "name": "Bloom Skincare",
    "industry": "e-commerce",
    "description": "Natural skincare products for women 25-45",
    "goals": ["generate_leads", "increase_roas", "grow_instagram"],
    "targetAudience": "Women 25-45, health-conscious, mid-to-high income",
    "brandVoice": "Warm, trustworthy, educational. Never pushy.",
    "brandColors": ["#F5E6D3", "#8B4513"]
  },
  "assets": {
    "website": "https://example.com",
    "landingPages": ["https://example.com/offer"],
    "instagram": { "handle": "@example", "profileUrl": "https://instagram.com/example" },
    "tiktok": { "handle": "@example", "profileUrl": "https://tiktok.com/@example" },
    "facebook": { "pageId": "123456789", "pageUrl": "https://facebook.com/example" },
    "youtube": null,
    "linkedin": null
  }
}
```

### `role.json`

```json
{
  "roleId": "social-media-manager",
  "assignedAt": "2026-06-21T10:05:00Z",
  "skillOverrides": { "disabled": [], "extra": [] },
  "mcpOverrides": { "disabled": [], "extra": [] }
}
```

### `connections.json`

```json
{
  "meta-ads": {
    "status": "connected",
    "accessToken": "EAAxxxxx",
    "tokenExpiresAt": "2026-09-01T00:00:00Z",
    "connectedAt": "2026-06-21T10:10:00Z"
  },
  "instagram-graph": {
    "status": "connected",
    "accessToken": "IGQVxxxxx",
    "userId": "17841400000000",
    "tokenExpiresAt": "2026-12-01T00:00:00Z",
    "connectedAt": "2026-06-21T10:12:00Z"
  },
  "tiktok": { "status": "pending", "accessToken": null },
  "google": {
    "status": "connected",
    "accessToken": "ya29.xxx",
    "refreshToken": "1//xxx",
    "tokenExpiresAt": "2026-06-21T11:00:00Z",
    "scopes": ["analytics.readonly"],
    "connectedAt": "2026-06-21T10:15:00Z"
  },
  "higgsfield": {
    "status": "connected",
    "accessToken": "hf_xxx",
    "connectedAt": "2026-06-21T10:08:00Z"
  }
}
```

### `store/sessions/<sessionId>.json`

Onboarding session state, kept until WhatsApp is linked.

```json
{
  "sessionId": "uuid-v4",
  "step": 3,
  "clientId": "abc123...",
  "profile": {},
  "roleId": "social-media-manager",
  "connections": { "meta-ads": "connected", "instagram-graph": "pending" },
  "whatsappLinked": false,
  "createdAt": "2026-06-21T10:00:00Z"
}
```

---

## Agent Construction

`buildClientAgent(jid: string)` in `src/agent.ts`:

```
1. Derive clientId from JID (SHA-256)
2. Load profile.json → build <business_context> XML block
3. Load role.json → look up RoleDefinition in registry
4. Load connections.json → filter to role's MCPs where status === 'connected'
5. For each connected MCP: createClient() → connect() → listTools()
6. Apply limitHiggsfieldTools wrapper if higgsfield is in the tool list
7. Compose system prompt:
     BASE_PROMPT
     + role.systemPromptAddition
     + <business_context> block (also re-injected by BusinessContextPlugin hook)
8. Create AgentSkills plugin with role.skills paths
9. Create BusinessContextPlugin (re-injects context before each invocation)
10. Instantiate Agent({ systemPrompt, sandbox, tools, plugins })
```

---

## Asset Awareness

The agent knows about the client's internet assets through three layers:

### Layer 1 — Static injection (every invocation)
`BusinessContextPlugin` injects a `<business_context>` XML block into the system prompt via `BeforeInvocationEvent`. Always fresh — if the profile is updated mid-session, the next message picks it up.

```xml
<business_context>
  <name>Bloom Skincare</name>
  <industry>e-commerce</industry>
  <target_audience>Women 25-45, health-conscious, mid-to-high income</target_audience>
  <brand_voice>Warm, trustworthy, educational. Never pushy.</brand_voice>
  <goals>generate_leads, increase_roas, grow_instagram</goals>
  <assets>
    <website>https://bloomskincare.com</website>
    <landing_pages>https://bloomskincare.com/offer</landing_pages>
    <instagram handle="@bloomskincare">https://instagram.com/bloomskincare</instagram>
    <tiktok handle="@bloomskincare.official">https://tiktok.com/@bloomskincare.official</tiktok>
  </assets>
</business_context>
```

### Layer 2 — `business-context` skill
Attached to all roles. Teaches the agent *how to act on* the assets:
- Fetch and analyze landing page copy from the stored URL
- Read recent Instagram posts via the Graph API tools
- Cross-reference organic content performance with paid ad creative performance
- Suggest profile updates when the client mentions new assets

### Layer 3 — `get_business_context` tool
A lightweight inline tool created in `buildClientAgent`. Returns the full profile JSON on demand. Lets the agent re-read it mid-conversation and surface suggestions like "I notice your TikTok handle isn't saved — want me to add it?"

---

## File Structure

```
src/
├── index.ts                          # Entry point
├── agent.ts                          # buildClientAgent() — assembles agent from store + registries
├── whatsapp.ts                       # Baileys connection, routes inbound messages
├── channel-address.ts                # Synthetic clientId-bearing address for non-WhatsApp channels
├── telegram.ts                       # Poll loop + inbound routing/delivery, shared by both bot models
├── telegram-manager.ts               # TelegramSessionManager — one poller per BYO-connected client
├── telegram-shared-bot.ts            # Single platform bot + /start deep-link connect flow
├── telegram-store.ts                 # Encrypted bot token + owner-chat binding + shared-chat index
├── telegram-transport.ts             # WhatsAppTransport-shaped send API over the Telegram Bot HTTP API
├── telegram-client.ts                # Minimal Telegram Bot API client (fetch/FormData, no SDK)
├── mime-utils.ts                     # extensionForMime — shared by Telegram/Slack transports
├── slack.ts                          # Events API webhook: verify, dedup, route, deliver
├── slack-oauth.ts                    # Slack OAuth v2 install URL + signed state
├── slack-store.ts                    # Encrypted bot token + team_id -> clientId index
├── slack-transport.ts                # WhatsAppTransport-shaped send API over the Slack Web API
├── slack-client.ts                   # Minimal Slack Web API client (fetch, no SDK)
├── callback-server.ts                # Express server, mounts onboarding + oauth routes
├── token-store.ts                    # Legacy shim → delegates to client-store
├── mcp.ts                            # Legacy shim → re-exports from src/mcps/
├── sandbox.ts                        # Docker sandbox per client
├── higgsfield-auth.ts                # Higgsfield OAuth provider
├── higgsfield-usage.ts               # Daily generation limit enforcement
├── input-sharing.ts                  # share_input_with_higgsfield tool
├── outputs.ts                        # publish_output + deliver_higgsfield_output tools
├── oauth.ts                          # OAuth URL generation helpers
│
├── store/
│   ├── types.ts                      # ClientProfile, RoleRecord, ConnectionsRecord, OnboardingSession
│   ├── client-store.ts               # read/write profile, role, connections + legacy migration
│   └── session-store.ts             # read/write onboarding session state
│
├── roles/
│   ├── types.ts                      # RoleDefinition interface
│   ├── registry.ts                   # Map of roleId → RoleDefinition for all 5 roles
│   └── index.ts                      # re-exports
│
├── mcps/
│   ├── types.ts                      # McpDefinition interface
│   ├── registry.ts                   # Map of platformId → McpDefinition
│   ├── meta-ads.ts                   # Meta Ads MCP (refactored from mcp.ts)
│   ├── higgsfield.ts                 # Higgsfield MCP (refactored from mcp.ts)
│   ├── instagram-graph.ts            # Instagram Graph API tool wrapper
│   ├── tiktok.ts                     # TikTok API tool wrapper
│   ├── google.ts                     # Google Analytics + Search Console tool wrapper
│   └── index.ts                      # re-exports
│
├── plugins/
│   └── business-context-plugin.ts   # Injects <business_context> XML before each invocation
│
├── skills/
│   ├── meta-ads-expert/
│   │   └── SKILL.md
│   ├── ad-performance-analysis/
│   │   └── SKILL.md
│   ├── higgsfield-creative/
│   │   └── SKILL.md
│   ├── whatsapp-personal-assistant/
│   │   └── SKILL.md
│   ├── social-media-manager/
│   │   └── SKILL.md
│   ├── software-developer/
│   │   └── SKILL.md
│   └── business-context/
│       └── SKILL.md
│
└── onboarding/
    ├── server.ts                     # Express router: /onboarding/* routes
    ├── session.ts                    # Session middleware + helpers
    ├── oauth-handlers.ts             # Per-platform OAuth start + callback handlers
    └── views/
        ├── layout.html               # Base HTML shell with nav + styles
        ├── step1-profile.html        # Business profile form
        ├── step2-role.html           # Role picker cards
        ├── step3-platforms.html      # Platform OAuth buttons + live status
        ├── step4-qr.html             # QR code + SSE stream
        └── step5-ready.html          # Confirmation + WhatsApp deep link

store/                                # Runtime data (gitignored)
├── clients/
│   └── <clientId>/
│       ├── profile.json
│       ├── role.json
│       └── connections.json
├── sessions/
│   └── <sessionId>.json
├── workspaces/                       # Docker sandbox filesystems
└── higgsfield-usage.json             # Daily generation counters
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENT_NAME` | No | Display name (default: `Ahrness`) |
| `META_APP_ID` | Yes | Meta OAuth app ID |
| `META_APP_SECRET` | Yes | Meta OAuth app secret |
| `META_ADS_ENABLE_WRITE_TOOLS` | No | Set `true` to enable write operations |
| `HIGGSFIELD_MCP_URL` | Yes | Higgsfield MCP endpoint URL |
| `HIGGSFIELD_MCP_ACCESS_TOKEN` | No | Static token (skips OAuth if set) |
| `HIGGSFIELD_JOB_TIMEOUT_MS` | No | Generation poll timeout (default: 10 min) |
| `HIGGSFIELD_DAILY_GENERATION_LIMIT` | No | Per-client daily limit (default: 10) |
| `TIKTOK_CLIENT_KEY` | Yes* | TikTok OAuth app key |
| `TIKTOK_CLIENT_SECRET` | Yes* | TikTok OAuth app secret |
| `GOOGLE_CLIENT_ID` | Yes* | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes* | Google OAuth client secret |
| `CALLBACK_BASE_URL` | Yes | Public base URL for OAuth redirects |
| `AGENT_MAX_OUTPUT_BYTES` | No | Max file size to deliver (default: 25 MB) |
| `HIGGSFIELD_USAGE_STORE` | No | Path to usage JSON (default: `./store/higgsfield-usage.json`) |

\* Required only if the corresponding platform is enabled.
