# BizzClaw Agent — Architecture & Deployment

## Where the agent runs

A single **DigitalOcean Droplet** (London, `lon1`):

| Detail | Value |
|--------|-------|
| IP | `138.68.165.109` |
| SSH port | `2222` |
| Size | 2 vCPU / 4 GB RAM / 80 GB SSD |
| Cost | ~$24/mo |
| OS | Ubuntu 24.04 |
| Domain | `agent.bizz-claw.com` |
| DNS | Cloudflare A record → IP (DNS only, not proxied) |
| TLS | Caddy auto-provisions Let's Encrypt cert |

The Node.js process runs as a **systemd service** (`ahrness.service`) under a dedicated `ahrness` user, started via:
```
/usr/bin/node --import tsx/esm src/index.ts
```
It restarts automatically on crash (`Restart=always`).

---

## Request flow

```
User browser / WhatsApp
        │
        ▼
  agent.bizz-claw.com:443
        │  (Cloudflare DNS → DigitalOcean IP)
        ▼
   Caddy (HTTPS reverse proxy)
        │  terminates TLS, forwards to localhost:3456
        ▼
   Node.js callback server (src/callback-server.ts)
        │
        ├── /api/auth/*          → better-auth (Google OAuth)
        ├── /login               → login page (HTML, server-rendered)
        ├── /dashboard           → dashboard page (protected)
        ├── /onboarding/*        → WhatsApp linking wizard (protected)
        ├── /webhooks/twilio/whatsapp → incoming WhatsApp messages from Twilio
        └── /media/*             → shared input/output media serving
```

---

## Multi-tenancy

Yes — the system is fully multi-tenant. Each user who signs in with Google gets their own isolated tenant.

### Identity model

| Concept | Value |
|---------|-------|
| **Tenant ID** | The better-auth user UUID (e.g. `abc123-...`) |
| **Assigned at** | First Google sign-in |
| **Stored in** | SQLite DB (`/opt/ahrness/store/ahrness.db`) |

The `tenant` table links each Google user to their WhatsApp number:

```sql
tenant (
  user_id       TEXT PRIMARY KEY  -- better-auth user UUID
  whatsapp_jid  TEXT UNIQUE       -- e.g. "972501234567@s.whatsapp.net"
  whatsapp_provider TEXT          -- "twilio" or "baileys"
  created_at    INTEGER
)
```

### Auth tables (better-auth / drizzle)

```
user         — Google profile (id, name, email, image)
session      — active browser sessions (JWT cookie)
account      — OAuth account link (Google tokens)
verification — email verification tokens (unused for now)
```

### Lookup flow when a WhatsApp message arrives

```
Twilio webhook POST /webhooks/twilio/whatsapp
    │
    ▼
  src/twilio-whatsapp.ts → extracts sender JID
    │
    ▼
  src/whatsapp-router.ts → clientIdForJid(jid)
    │
    ├── DB lookup: tenant WHERE whatsapp_jid = jid  → returns user_id (tenantId)
    └── fallback: sha256(jid)  ← backward compat for pre-auth users
    │
    ▼
  clientId used to:
    • load agent memory from  store/clients/<clientId>/memory/
    • run Docker sandbox at   store/clients/<clientId>/workspace/
    • send reply back to jid
```

---

## User isolation

Each tenant's data lives in its own directory on disk:

```
/opt/ahrness/store/
  clients/
    <tenantId-1>/
      memory/          ← agent memory (facts, preferences)
      workspace/       ← files the agent creates/reads
      sessions/        ← onboarding session state
    <tenantId-2>/
      ...
  ahrness.db           ← shared SQLite (auth + tenant registry)
```

Docker sandbox per agent run: when the agent needs to execute code or browse the web, it spawns an `ahrness-sandbox:latest` container with:
- `--network none` — no internet access from inside the sandbox
- `--memory 512m` — capped RAM
- `--cpus 1` — capped CPU
- `--pids-limit 128` — prevents fork bombs
- The tenant's workspace bind-mounted read-write; nothing else

No tenant can read another tenant's memory, files, or sessions — paths are derived from the tenantId which is a UUID only the DB knows.

---

## Authentication flow (Google OAuth)

```
1. User visits agent.bizz-claw.com
      └── redirected to /login

2. Clicks "Sign in with Google"
      └── JS POSTs to /api/auth/sign-in/social {provider:"google", callbackURL:"/dashboard"}
      └── better-auth returns Google OAuth URL

3. Browser redirects to accounts.google.com
      └── user approves → Google redirects to /api/auth/callback/google

4. better-auth exchanges code for tokens, creates/upserts user in DB
      └── sets a signed HTTP-only session cookie (7 day TTL)

5. Browser lands on /dashboard
      └── server reads session cookie → identifies user → shows their state
```

**Google OAuth client:** `142326546382-f1hq4874qd688ekhbhbcevjs0n3r9jkm.apps.googleusercontent.com`
Authorized redirect URI: `https://agent.bizz-claw.com/api/auth/callback/google`

---

## WhatsApp integration

**Provider:** Twilio WhatsApp Business API (sandbox for now)

| Setting | Value |
|---------|-------|
| Twilio number | `+972539627986` |
| Webhook | `https://agent.bizz-claw.com/webhooks/twilio/whatsapp` |
| Method | HTTP POST |

Message flow:
1. Someone messages the Twilio WhatsApp number
2. Twilio POSTs to the webhook
3. Server looks up which tenant owns that JID
4. Runs the AI agent for that tenant
5. Agent reply sent back via Twilio API

---

## Key files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entrypoint — init DB, start scheduler, start server |
| `src/auth.ts` | better-auth config (Google OAuth + drizzle adapter) |
| `src/db/schema.ts` | Drizzle schema (auth tables + tenant table) |
| `src/db/index.ts` | SQLite singleton + `initDb()` |
| `src/tenant-store.ts` | JID↔tenantId mapping helpers |
| `src/callback-server.ts` | HTTP server — all routes |
| `src/dashboard.ts` | Login + dashboard HTML (server-rendered) |
| `src/agent.ts` | AI agent logic (Claude via Anthropic API) |
| `src/twilio-whatsapp.ts` | Twilio webhook handler + send API |
| `src/sandbox.ts` | Docker sandbox execution |
| `deploy/ahrness.service` | systemd unit file |
| `deploy/Caddyfile` | Caddy HTTPS config |
| `deploy/setup.sh` | One-time server bootstrap |

---

## Environment variables (server `/opt/ahrness/.env`)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API access |
| `BETTER_AUTH_SECRET` | Session signing key |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth credentials |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio API |
| `TWILIO_WHATSAPP_NUMBER` | `whatsapp:+972539627986` |
| `CALLBACK_BASE_URL` | `https://agent.bizz-claw.com` |
| `AGENT_NAME` | `BizzClaw` |
| `WHATSAPP_PROVIDER` | `twilio` |
| `AGENT_MASTER_KEY` | Encrypts vault secrets |
| `AGENT_SANDBOX_ENABLED` | `true` — enable Docker sandbox |

---

## How to deploy an update

```bash
# From local machine — sync changed files and restart
rsync -avz --exclude node_modules --exclude .git \
  -e 'ssh -p 2222' \
  /Users/user/Desktop/ahrness-agent/ root@138.68.165.109:/opt/ahrness/

ssh -p 2222 root@138.68.165.109 'cd /opt/ahrness && npm ci && systemctl restart ahrness'
```

Or for a single file:
```bash
rsync -avz -e 'ssh -p 2222' src/dashboard.ts root@138.68.165.109:/opt/ahrness/src/
ssh -p 2222 root@138.68.165.109 'systemctl restart ahrness'
```
