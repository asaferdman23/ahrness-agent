# Agent Memory Layer — Design Spec

**Date:** 2026-06-22
**Status:** Approved, in implementation
**Branch:** `feat/agent-memory-layer`

---

## Problem

Every WhatsApp message builds a fresh agent and throws away its conversation state:

```
whatsapp.ts → runAndDeliver(jid, prompt) → buildClientAgent(jid) → agent.invoke(prompt)
                                                                        └─ messages[] discarded
```

`src/delivery.ts:26-29`. The scheduler runner shares this path, so scheduled jobs are amnesiac too. The agent cannot remember anything a client said a message ago. The static `<business_context>` block is injection, not memory.

This is the single biggest gap between "command responder" and "agent that knows your business over time."

## The invariant

> **The persisted transcript is the source of truth. The Agent only ever receives a *working view* of it. We append to the store only after a turn succeeds.**

This one rule makes the rest safe:
- **Failover** is safe because each retry rebuilds the working view from the store; a failed attempt never corrupts persisted state.
- **Compaction** is safe because we compress the *view* sent to the model, never the append-only record.

## Scope

In scope (this spec): session persistence, working-context windowing, compaction with loop guard, per-session run queue, failover loop. Wiring into `delivery.ts` and `agent.ts`.

Out of scope (noted as follow-ons): browser-with-login capability, multi-channel transport, API-key rotation/multi-profile auth, multi-agent spawning.

---

## Pre-implementation spike (REQUIRED FIRST)

The `@strands-agents/sdk` source is not available in this environment (`node_modules` not installed, `../harness-sdk` file-dependency absent). Before implementing the wiring, confirm against the real SDK:

1. **Seeding** — how to construct an `Agent` with prior `messages`/history (constructor option, `agent.messages = …`, or a conversation/session manager).
2. **Read-back** — how to obtain the *full* set of messages produced in a turn (user + assistant + tool-use + tool-result blocks), not just `result.lastMessage`.
3. **Built-in managers** — does Strands already ship a `ConversationManager` / `SessionManager`? If yes, wire the SQLite store in as its backend instead of reimplementing seeding/read-back.

**Fallbacks if the API is thin:**
- (a) If Strands has a session/conversation manager, implement a SQLite-backed adapter for it; keep our store schema as-is.
- (b) Worst case, `extractTurnMessages` persists user-prompt + assistant-text only (loses tool-call replay fidelity, still delivers real memory).

The spike's outcome is recorded in the implementation plan and may adjust §"Integration".

---

## Components

New module `src/sessions/`, mirroring the existing `src/scheduler/` and `src/store/` layout.

| File | Responsibility | Depends on |
|------|---------------|-----------|
| `sessions/db.ts` | Open `store/agent.sqlite` (WAL mode), run schema migrations | `better-sqlite3` |
| `sessions/store.ts` | `loadSession`, `appendTurn`, `getWorkingContext`, `saveCompaction` | db.ts |
| `sessions/tokens.ts` | Cheap token estimate (`chars/4`) + model→context-window map | — |
| `sessions/compaction.ts` | Summarize old turns, advance pointer, post-compaction loop guard | store.ts, injected summarizer fn |
| `sessions/run-queue.ts` | Per-session serial mutex (in-memory `Map<key, Promise>`) | — |
| `sessions/run-with-failover.ts` | Wrap `invoke` with retry/compact/backoff/fallback | store, compaction |
| `sessions/types.ts` | `SessionRecord`, `StoredMessage`, `WorkingContext` | — |
| `sessions/index.ts` | re-exports | all |

**Session key:** `whatsapp:<clientId>`, where `clientId` is the existing `clientIdFromJid(jid)`. Channel-namespaced so a future channel for the same person is a separate thread.

**Existing files touched (small):**
- `src/delivery.ts` — route through run-queue → failover instead of bare `invoke`; extract + append the turn on success.
- `src/agent.ts` — `buildClientAgent(jid, workingContext?)` seeds the Agent with prior context.

---

## Data model (SQLite)

```sql
CREATE TABLE sessions (
  session_key          TEXT PRIMARY KEY,
  client_id            TEXT NOT NULL,
  channel              TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  model                TEXT,
  summary              TEXT,              -- rolling compaction summary (nullable)
  summary_through_seq  INTEGER NOT NULL DEFAULT 0  -- messages with seq <= this are folded into summary
);

CREATE TABLE messages (                   -- APPEND-ONLY. never updated or deleted.
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key     TEXT NOT NULL,
  seq             INTEGER NOT NULL,        -- monotonic per session
  role            TEXT NOT NULL,           -- 'user' | 'assistant' | 'tool'
  content         TEXT NOT NULL,           -- JSON: full block array
  token_estimate  INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE(session_key, seq)
);

CREATE TABLE compaction_checkpoints (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key  TEXT NOT NULL,
  at_seq       INTEGER NOT NULL,
  summary      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_messages_session_seq ON messages(session_key, seq);
```

`messages` is the append-only log (doc 04: never truncate the source of truth). `summary` + `summary_through_seq` is the compressed head. The full transcript is always recoverable for a future `/export`.

DB opened once, `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=NORMAL`. `better-sqlite3` is synchronous and single-writer-safe; combined with the run-queue, writes never interleave.

---

## Data flow (per message)

```
inbound (jid, prompt)
  │
  └─ runQueue.enqueue(sessionKey, async () => {            // serialize per client
        const ctx   = store.getWorkingContext(key, model)  // summary + recent turns within budget
        const agent = buildClientAgent(jid, ctx)           // seed prior context
        const result= await runWithFailover(agent, prompt, key, ctx)
        const turn  = extractTurnMessages(result, prompt)  // user + assistant + tool blocks
        store.appendTurn(key, turn)                         // ONLY on success
        deliver(reply, publishedOutputs)                   // unchanged
     })
```

`getWorkingContext` returns `{ summary, messages }` where `messages` are the verbatim turns after `summary_through_seq`, capped so `summary + messages` fits the working budget (default: compact when estimated tokens exceed ~70% of the model's context window).

---

## Compaction

`compaction.ts` exposes `compactIfNeeded(key, model, summarize)`:

1. Estimate tokens of `getWorkingContext`. If under threshold, return unchanged.
2. Otherwise take messages from `summary_through_seq + 1` up to `(latest seq − KEEP_RECENT_TURNS)`, plus the existing `summary`, and call the injected `summarize(text)` LLM function.
3. Store new `summary`, advance `summary_through_seq`, write a `compaction_checkpoint`.
4. Working context after = `summary` + last `KEEP_RECENT_TURNS` verbatim turns.

The `messages` table is never modified.

**Post-compaction loop guard:** track `lastCompactionThroughSeq` per session in memory. If `compactIfNeeded` would compact again with no new messages appended since the last compaction (i.e., the summary itself is the thing overflowing), throw `PostCompactionGuardError`; the caller hard-trims to the last `KEEP_RECENT_TURNS` and surfaces a warning to the user instead of looping forever.

Constants: `KEEP_RECENT_TURNS = 8`, `COMPACT_AT_FRACTION = 0.70` (tunable).

---

## Run queue

`run-queue.ts`: `enqueue<T>(key, fn): Promise<T>`. An in-memory `Map<sessionKey, Promise<unknown>>` chains each session's runs so only one agent run executes per client at a time. Two rapid WhatsApp messages → the second awaits the first. Prevents interleaved transcript writes and out-of-order context. Per-process (single gateway process — matches deployment model).

---

## Failover loop

`run-with-failover.ts`: `runWithFailover(agent, prompt, key, ctx)` wraps `agent.invoke`. **Each attempt rebuilds the working context from the store** (immutable attempt state — doc 02), so a mid-chain failure never corrupts persisted data:

| Error class | Action | Max retries |
|-------------|--------|-------------|
| Context overflow | force `compactIfNeeded` → rebuild ctx → retry | 1 |
| Rate limit / 429 | exponential backoff → retry | 3 |
| Model 5xx / unavailable | switch to fallback model if configured → retry | 1 |
| Auth error | surface (key rotation is a future hook; one key/provider via env today) | 0 |

Only on success do we `appendTurn`. Errors after exhausting retries propagate to `runAndDeliver`, which already throws to its callers.

---

## The three "don't go crazy" guards

1. **Post-compaction loop guard** — no infinite summarize-of-summary loop.
2. **Run queue** — concurrent messages can't interleave-corrupt the transcript.
3. **Append-only + append-on-success** — a crashed or failed turn leaves the record clean and fully recoverable.

---

## Testing (existing `node:test` setup, `src/sessions/*.test.ts`)

- **store**: append/load round-trip; `seq` monotonic; `getWorkingContext` respects budget.
- **compaction**: advances `summary_through_seq`; shrinks working context; checkpoint written; `messages` table row count never decreases.
- **guard**: `PostCompactionGuardError` thrown when no new messages since last compaction.
- **run-queue**: two concurrent `enqueue` calls for one key run strictly serially; different keys run in parallel.
- **failover**: simulated context-overflow triggers compaction-then-retry; simulated 429 backs off and retries; transcript only appended on success.

The pure-logic units (store, tokens, run-queue, compaction with an injected fake summarizer) are testable without the Strands SDK. The wiring tests depend on the SDK and run after the spike resolves.

---

## Money use-cases — leverage strategy (marketing-adjacent)

**The strategic link to memory:** scheduler (built) + connected marketing APIs (built) already let the agent *run* automations. A stateless automation is a commodity. An agent that remembers last week's numbers, what it recommended, and whether the client acted — *"ROAS is up 12% after we shifted budget like I suggested"* — is a relationship the client can't easily churn out of. **Memory turns each money use-case from a cron job into a compounding account.**

Each use-case ships as a **scheduler-template + skill bundle attached to a role**, reusing `materializeTemplates` / `SCHEDULER_TEMPLATES` / the roles registry — so productizing is mostly config, not new infra.

Ranked by how much is already buildable:

1. **Client Reporting on Autopilot** (uc #11) — **the wedge**, ~90% built. Meta Ads + IG + TikTok + GA/Search Console tools + sandbox (md→PDF) + WhatsApp delivery + scheduler all exist. Weekly cron → pull metrics → trend vs prior period → report → deliver. Memory makes each week build on the last. Template on Marketing Manager / Ads Analyst.
2. **Content Production at Scale** (uc #8) — strong fit. `higgsfield-creative` + `social-media-manager` skill + IG/TikTok publish tools. Cron → trend scrape → draft → generate creative → schedule → track engagement → double down on winners. Memory holds "what worked." Template on Social Media Manager.
3. **Competitor Intelligence** (uc #1) — v1 today with public data (client IG/TikTok tokens for public profiles, `WebFetch`/sandbox curl for pricing/changelog pages) → weekly digest. Deep version gated on browser-with-login.
4. **Influencer / Partnership Scout** (uc #15) — medium fit; partial scraping now, fuller with browser.

**Second capability bet (separate, later spec): browser-with-login.** Per the usecases doc this is *the* unlock — it operates inside any SaaS without an API, turning the 11 non-marketing use-cases (CFO, support tier-1, recruiting, deal scanners) from impossible into shippable. Recommended follow-on; out of scope here.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Strands SDK message seed/read-back API unknown | Spike first; fallbacks (a) adapt to built-in manager, (b) degrade to user+assistant-text |
| Build/test blocked: `node_modules` absent, `../harness-sdk` missing | Restore SDK dependency before verification; pure units testable in isolation |
| Token estimate too crude → premature/late compaction | `chars/4` v1; swap for real tokenizer if drift observed |
| `better-sqlite3` native build on deploy target | Standard prebuilt binaries; verify in Docker image |
