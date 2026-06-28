# AGENTS.md — Ahrness Agent

Instructions for AI coding agents working in this repository. Read this before
writing any code here. Deep design lives in [`ARCHITECTURE.md`](ARCHITECTURE.md);
this file is the working contract.

> **There is a skill for this.** `.claude/skills/ahrness-engineer/SKILL.md`
> (`ahrness-engineer`) is the entry point — it routes you here and into
> `ARCHITECTURE.md` with a pre-flight checklist. Invoke it when you start work.

---

## What this is

A **WhatsApp-first AI marketing agent platform**. A client onboards via a web UI,
picks a role, connects their platforms (Meta Ads, Instagram, TikTok, Google,
Higgsfield), and gets one personalized AI agent — built fresh per conversation —
that knows their business, runs tools in a Docker sandbox, remembers the chat
(SQLite), and runs scheduled automations.

The runtime brain is `@strands-agents/sdk` (a request-driven tool loop). It has
**no scheduler and no built-in memory** — both are app-layer subsystems we own
(`src/scheduler/`, `src/sessions/`).

---

## Build, run, test

```bash
npm install
docker build -f Dockerfile.sandbox -t ahrness-sandbox:latest .  # required: agent is fail-closed without it
cp .env.example .env        # then fill values

npm start            # tsx src/index.ts — agent + onboarding/OAuth server
npm run dev          # tsx watch (auto-reload)
npm run build        # tsc → dist/
npm run type-check   # tsc --noEmit — run this before claiming a change compiles
npm test             # node --test over src/**/*.test.ts
npm run test:memory  # memory end-to-end harness (needs ANTHROPIC_API_KEY, real network)
```

**Always run `npm run type-check` and `npm test` before saying a change is done.**
If you cannot run them, say so explicitly — do not imply verification you didn't do.

---

## Non-negotiable conventions

These are the things that silently break if you ignore them.

1. **ESM with `.js` import specifiers.** `"type": "module"` + NodeNext. Import
   local `.ts` files using the `.js` extension:
   `import { getProfile } from './store/client-store.js'` — **not** `.ts`, **not**
   extensionless. Wrong extension = runtime/`tsc` failure.

2. **TypeScript strict mode is on.** No implicit `any`. Where an `any` is
   genuinely unavoidable (SDK shapes), match the existing pattern: a localized
   `// eslint-disable-next-line @typescript-eslint/no-explicit-any` rather than
   loosening `tsconfig`.

3. **Two distinct kinds of "skill" — do not confuse them:**
   - **Runtime agent skills** → `src/skills/<name>/SKILL.md`. These are loaded by
     the `AgentSkills` plugin into the *client-facing* agent at runtime. Editing
     these changes how the deployed product behaves.
     - **Dev skills** → `.claude/skills/<name>/SKILL.md`. These guide *you*, the
     coding agent. `ahrness-engineer` lives here.

4. **Client data is keyed by `clientIdFromJid(jid)`** (SHA-256 of the WhatsApp
   JID) and lives under `store/clients/<clientId>/`. `store/` and `.env` are
   **gitignored** — never commit client data, tokens, or secrets. Stores write
   atomically (tmp file + rename); follow that pattern for new persisted state.

5. **Secrets come from env only.** `MEDIA_SIGNING_SECRET` signs onboarding/OAuth
   tokens; OAuth `state` carries the signed JID for CSRF + client binding. Never
   hardcode or log secrets/tokens.

6. **Non-critical paths fail soft.** Scheduler template materialization, MCP
   connection, and similar best-effort work are wrapped in `try/catch` that warns
   and continues — a failure there must never block building or running the
   agent. Preserve that.

7. **Git discipline (from global rules):** commit or push *only when asked*. If on
   `main`, branch first. End commit messages with the
   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

## Where things live (and where to make a change)

| You want to… | Touch |
|---|---|
| Change how the agent is assembled | `src/agent.ts` → `buildClientAgent(jid, seedMessages?, modelOverride?)` |
| Add a connectable platform | `src/mcps/<platform>.ts` + register in `src/mcps/registry.ts` |
| Add or edit a role | `src/roles/registry.ts` (+ `roles/types.ts`) |
| Change agent capabilities/instructions (runtime) | `src/skills/<skill>/SKILL.md` |
| Add an agent tool | a `createXTools(...)` factory using `tool({ name, description, inputSchema, callback })`, then push it in `buildClientAgent` |
| Onboarding web flow / OAuth | `src/onboarding/`, `src/oauth.ts`, `src/mcps/*` `authUrl` |
| Scheduled automations | `src/scheduler/` (`templates.ts`, `cron.ts`, `runner.ts`, `tools.ts`) |
| Conversation memory / compaction | `src/sessions/` |
| WhatsApp transport / inbound routing | `src/whatsapp.ts` (+ `whatsapp-transport.ts`) |
| Persisted client data shape | `src/store/types.ts` + `store/client-store.ts` |

**Registry pattern:** roles, MCPs, and skills are each a registry mapping an id →
definition. Adding one = create the definition file **and** register it; nothing
is auto-discovered. Check that both the required/optional MCP lists and the skill
list on the role line up with the new capability.

---

## Patterns to mirror

- **Tools** are factory functions returning `tool({...})` objects, given the
  per-client state they need (`createSchedulerTools(clientId, jid)`,
  `createInstagramTools(conn)`). Validate input inside the `callback`; throw
  `Error` with a clear message on bad input.
- **Tests** are colocated `*.test.ts` using `node:test` (`import { test } from
  'node:test'`). Prefer dependency-free, deterministic tests — see
  `src/scheduler/cron.ts` + `scheduler-cron.test.ts` for the bar (timezone logic
  verified with explicit cases).
- **Models:** a bare string model id routes to **Bedrock** in Strands. To use the
  Anthropic API, construct `AnthropicModel` via `createModel(...)` in `agent.ts`.
  `AGENT_MODEL` (default `claude-opus-4-8`) is the id used for budgeting too.

---

## Known constraints & gotchas

- **SDK shapes are partly unverified.** Some `@strands-agents/sdk` usages
  (`messages` seeding, `model` field on `Agent`) are noted in-code as the
  documented-but-unverified shape (see the `NOTE:` comments in `agent.ts` and
  `docs/superpowers/specs/2026-06-22-agent-memory-layer-design.md`). If you change
  agent construction, confirm against the installed `@strands-agents/sdk@1.6.0`,
  don't assume.
- **Docker is mandatory** for anything exercising the sandbox; the agent is
  fail-closed without the `ahrness-sandbox:latest` image.
- **Onboarding ↔ runtime bridge:** a web session has no JID. The signed `?c=<token>`
  link adopts `clientId = clientIdFromJid(jid)` so web-saved profile/role/
  connections land under the key the runtime reads. Don't reintroduce a
  session-id-keyed write path for client data.

---

## Definition of done

- [ ] `npm run type-check` passes (or you stated you couldn't run it and why).
- [ ] `npm test` passes; new behavior has a colocated `*.test.ts` where practical.
- [ ] `.js` import extensions used throughout new/edited imports.
- [ ] New persisted state is under `store/clients/<clientId>/`, atomic, gitignored.
- [ ] No secrets/tokens committed or logged; `store/` and `.env` untouched in git.
- [ ] New role/MCP/skill is registered, not just created.
- [ ] Committed/pushed only if asked; branched off `main`; co-author trailer present.
