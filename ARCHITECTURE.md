# Ahrness Agent — Architecture

A WhatsApp-first AI marketing agent platform. Clients onboard via a web UI, pick a role, connect their platforms, and get a fully personalized AI agent that knows their business and tools.

---

## Table of Contents

- [Overview](#overview)
- [Onboarding Flow](#onboarding-flow)
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

Served at `/onboarding` from the existing Node.js process. Five steps, server-rendered HTML.

```
Step 1 — Business Profile
  └─ Name, industry, website, social handles (Instagram, TikTok, Facebook, YouTube, LinkedIn)
     landing pages, target audience, brand voice, goals (leads / ROAS / grow social / sales)

Step 2 — Role Picker
  └─ Five role cards (see Roles section). One selectable. Role determines which platforms appear next.

Step 3 — Connect Platforms
  └─ OAuth buttons for each platform the role requires/supports.
     Required platforms must be connected before continuing.
     Status updated live via polling /onboarding/status.

Step 4 — Link WhatsApp
  └─ QR code rendered via SSE stream from Baileys.
     Page auto-advances on scan.
     (Slack / Google Chat — coming soon)

Step 5 — Ready
  └─ Summary of role + connected platforms + WhatsApp deep link.
```

### Onboarding Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/onboarding` | Redirect to step 1 or resume session |
| GET | `/onboarding/step/:n` | Render step N |
| POST | `/onboarding/step/1` | Save business profile |
| POST | `/onboarding/step/2` | Save role choice |
| GET | `/onboarding/step/3` | Show platform OAuth buttons |
| GET | `/oauth/:platform/start` | Begin OAuth for a platform |
| GET | `/oauth/:platform/callback` | Handle OAuth redirect, save token |
| GET | `/onboarding/step/4` | QR code page |
| GET | `/onboarding/qr-stream` | SSE stream of QR updates |
| GET | `/onboarding/step/5` | Confirmation page |
| GET | `/onboarding/status` | JSON: `{ step, connections, whatsappLinked }` |

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
