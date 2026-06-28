# BizzClaw Agent

A WhatsApp-first AI marketing agent platform. Each client onboards through a web
UI, picks a role, connects their platforms (Meta Ads, Instagram, TikTok, Google,
Higgsfield), and gets a personalized AI agent that knows their business, runs
tools, remembers the conversation, and works on a schedule — all over WhatsApp.

> Deep architecture lives in [`ARCHITECTURE.md`](ARCHITECTURE.md). This README is
> the practical "how to run and use it" guide.

---

## What it can do

- **Brain** — an LLM tool loop (via `@strands-agents/sdk`) with a role-specific
  system prompt, skills, and the client's live business context.
- **Hands** — per-platform tools (Meta Ads MCP, Instagram Graph, TikTok, Google
  Analytics/Search Console, Higgsfield creative) plus a locked-down Docker
  sandbox for code/file work.
- **Memory** — a SQLite-backed conversation transcript per client, with context
  compaction and failover so long-running chats survive. See
  [Memory layer](#memory-layer).
- **Continuous** — a cron scheduler runs pre-built automations (digests, reports,
  watchdogs) that message the client on their own. See [Automations](#automations).
- **Control** — fail-closed Docker sandbox, per-client generation limits, and the
  memory layer's run queue + compaction guards.

---

## Quickstart

### Prerequisites

- **Node.js 20+**
- **Docker** (for the per-client execution sandbox)
- A **Meta Developer App** with the Marketing API product (for client OAuth)
- A public HTTPS URL for OAuth callbacks (use [ngrok](https://ngrok.com) in dev)
- The `@strands-agents/sdk` dependency available (see [SDK note](#sdk-note))

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Build the sandbox image (required — the agent is fail-closed without it)
docker build -f Dockerfile.sandbox -t ahrness-sandbox:latest .

# 3. Configure environment
cp .env.example .env
#    then fill in the values (see Configuration below)

# 4. Start the agent + onboarding/OAuth server
npm start
```

For development with auto-reload:

```bash
npm run dev
```

### One-time operator setup: Higgsfield

Higgsfield uses a single shared, server-owned account — clients never log in.
After the server is running, visit once:

```text
https://your-domain.com/auth/higgsfield/start?key=<HIGGSFIELD_SETUP_SECRET>
```

---

## How a client uses it

1. **Onboard** — the client opens `/onboarding` (served by the same process) and
   completes five steps: business profile → role → connect platforms (OAuth) →
   link WhatsApp (scan QR) → ready.
2. **Chat** — from then on they just message the agent on WhatsApp. The agent
   knows their business, has their role's tools and skills, and remembers prior
   messages.
3. **Receive automations** — any scheduled automations they enabled fire on their
   own and arrive as WhatsApp messages or delivered files.

Clients install nothing and never touch a terminal — everything runs server-side.

---

## Roles

One role per client, chosen at onboarding. It determines which skills, tools, and
prompt the agent loads.

| Role | Focus |
|------|-------|
| 📣 Marketing Manager | Cross-channel strategy, campaign planning, full asset inventory |
| 🎨 Creative Director | On-brand visual generation, copywriting, brand voice |
| 📊 Ads Analyst | ROAS optimization, performance diagnosis, anomaly detection |
| 📱 Social Media Manager | Organic content strategy, drafting, scheduling |
| 🤖 Personal Assistant / Dev | Day-to-day tasks, research, sandbox code/file work |

---

## Automations

Pre-built recurring jobs offered per role (`src/scheduler/templates.ts`). When a
client enables one, it becomes a cron job that invokes their agent and delivers
the result over WhatsApp — exactly as if they'd asked. Cron is evaluated in
`AGENT_TIMEZONE`.

Examples: weekly performance digest, daily ROAS report, spend watchdog, weekly
content calendar, morning briefing — and the **Weekly Client Report**, which
compiles a polished cross-channel report, renders it to PDF in the sandbox, and
auto-delivers it as a downloadable file (the agency-reporting wedge).

---

## Memory layer

Each client has one persistent conversation thread keyed `whatsapp:<clientId>`,
stored in SQLite (`store/agent.sqlite` by default; override with `AGENT_STATE_DB`).

- The **`messages` table is append-only** — the source of truth, never truncated.
- The agent only ever receives a **working view**: a rolling summary plus recent
  turns. When the view approaches the model's context window it is **compacted**
  (old turns summarized), with a guard against infinite compaction loops.
- A **per-session run queue** serializes concurrent messages so two rapid texts
  can't corrupt the transcript.
- A **failover loop** retries on rate limits (backoff), context overflow
  (compact + retry), and model outages (fallback model). The transcript is only
  appended **after a turn succeeds**.

Implementation: `src/sessions/`. Design + rationale:
[`docs/superpowers/specs/2026-06-22-agent-memory-layer-design.md`](docs/superpowers/specs/2026-06-22-agent-memory-layer-design.md).

---

## Configuration

Copy `.env.example` to `.env`. Key variables:

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` *or* AWS Bedrock creds | Model provider |
| `AGENT_MODEL` | Model id (default `claude-opus-4-8`) |
| `AGENT_FALLBACK_MODEL` | Optional model used if the primary is unavailable |
| `AGENT_STATE_DB` | Path to the memory SQLite DB (default `./store/agent.sqlite`) |
| `META_APP_ID` / `META_APP_SECRET` | Meta OAuth app (client platform connect) |
| `META_ADS_ENABLE_WRITE_TOOLS` | `false` = read-only (safe default) |
| `CALLBACK_BASE_URL` / `CALLBACK_PORT` | Public URL + port for OAuth + onboarding |
| `HIGGSFIELD_MCP_URL` / `HIGGSFIELD_SETUP_SECRET` | Higgsfield shared account |
| `HIGGSFIELD_DAILY_GENERATION_LIMIT` | Per-client daily safety cap (0 disables) |
| `WHATSAPP_PHONE_NUMBER` | Pairing-code auth; blank = QR code |
| `AGENT_NAME` | Display name (default `BizzClaw`) |
| `AGENT_TIMEZONE` | IANA tz for scheduled automations (default `UTC`) |
| `AGENT_SANDBOX_*` | Docker sandbox image, limits, network, workspace dir |

See `.env.example` for the full annotated list.

---

## Development

```bash
npm run dev          # start with auto-reload
npm test             # run the test suite
npm run type-check   # tsc --noEmit
npm run build        # compile to dist/
```

### Project layout

```
src/
  index.ts              # entry point
  agent.ts              # buildClientAgent() — assembles the agent per client
  delivery.ts           # memory-aware run + WhatsApp delivery path
  whatsapp.ts           # Baileys connection + inbound routing
  sessions/             # memory layer (store, compaction, run queue, failover)
  scheduler/            # cron automations + per-role templates
  roles/                # role definitions
  mcps/                 # per-platform tool/MCP registry
  skills/               # role skills (SKILL.md progressive disclosure)
  onboarding/           # web onboarding + OAuth
  store/                # per-client profile/role/connections (JSON)
store/                  # runtime data (gitignored): agent.sqlite, workspaces, ...
```

---

## Security model

- **Sandbox** — client shell/file ops run in Docker with a read-only root, no
  capabilities, no privilege escalation, resource limits, and no network by
  default. Only `/workspace` is writable. Failures are fail-closed: the agent
  never falls back to host execution.
- **Secrets** — model keys, Meta secrets, and the Higgsfield token stay on the
  host process and are never mounted into client containers.
- **Encrypted at rest** — every client's OAuth access/refresh tokens are sealed
  with AES-256-GCM (`AGENT_MASTER_KEY` + scrypt) before they touch disk; the
  Higgsfield token store is encrypted the same way. Plaintext tokens from older
  installs are migrated and re-encrypted automatically on first read.
- **Brokered apps** — the model never holds a token. It expresses intent and the
  host makes the authenticated API call, so a prompt injection can't exfiltrate
  credentials.
- **Sender allowlist** — set `AGENT_ALLOWED_SENDERS` so the agent only engages
  known numbers; unset = open (a warning is logged at startup).
- **Final files** must be written to `/workspace/outputs` and published with the
  `publish_output` tool before delivery.

### Autonomous web access

The agent can search and read the web without weakening the sandbox:

- **`web_search`** is a host-side broker. `WEB_SEARCH_API_KEY` stays on the host
  and is never exposed to the sandbox or the model; the model gets back titles,
  URLs, and snippets framed as *untrusted* data.
- **Sandbox egress** (`AGENT_SANDBOX_EGRESS=true`) lets in-sandbox code
  (`curl`/scrape) reach the web — but only through a filtering forward proxy on an
  internal Docker network. The sandbox has no internet of its own; the proxy
  allows only `AGENT_WEB_ALLOWLIST` domains, blocks private/loopback addresses,
  and rate-limits per source. Left off, the sandbox stays fully isolated.
- Fetched web content is treated as data, never instructions, and the agent is
  told never to send secrets to web tools or take irreversible/spending actions
  without confirmation.

---

## SDK note

This project depends on `@strands-agents/sdk`, pinned to a published npm version
in `package.json`. Upgrades are done manually. The SDK-free modules (memory layer,
vault, access control, egress proxy, scheduler) build and test independently of it.

---

## Process notes

See [`docs/process-log.md`](docs/process-log.md) for the audit trail of the
sandbox, Higgsfield, and campaign-agent investigation performed on this codebase.
