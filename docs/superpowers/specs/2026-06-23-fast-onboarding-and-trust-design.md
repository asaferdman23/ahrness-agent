# Fast Onboarding & Trust: Value-Before-Integration, Deferred OAuth, Approve-Before-Act

> Status: draft for review, 2026-06-23. Strategy basis: pre-mortem + blue-ocean analysis —
> the two axes that decide whether we win the non-tech ICP are **time-to-first-value (TTFV)**
> and **visible, reversible trust**. This spec turns three moves into code.

## Context

NanoClaw/OpenClaw are self-hosted developer harnesses; they are structurally incapable of fast
non-tech onboarding because self-hosting *is* their product. Our edge is that we host — the user
installs nothing. But our own onboarding gate currently undercuts that edge in three ways:

1. **Blank box.** An un-onboarded sender gets *only* a setup link (`whatsapp.ts:137-149`) — the
   agent refuses to engage until a role/connection exists. Non-tech users need value in the first
   message or they leave.
2. **All-or-nothing OAuth.** Onboarding pushes platform connections up front. Connecting Meta/Google
   means business verification + scary scopes — the highest-friction step, demanded before any value.
3. **Invisible, irreversible autonomy.** Write actions (post, upload, ad-spend) can fire without an
   explicit user OK. One wrong autonomous action on a non-tech user's account = churn + bad
   word-of-mouth (pre-mortem failure #2).

This spec addresses all three. It builds on the just-shipped secure core (encrypted vault, brokered
credentials, allowlist) — the trust *substrate* exists; this makes it *felt*.

Grounding facts from the code:
- Guests already default to the `personal-assistant-dev` role (`agent.ts:126`), and `buildClientAgent`
  already tolerates a missing profile/role (adds an onboarding note to the system prompt). So the
  agent *can* run for an un-onboarded sender today — only the inbound gate stops it.
- Per-platform OAuth URLs already exist as `authUrl(state, redirectBase)` on each MCP definition
  (e.g. `src/mcps/google.ts`); signed client links exist via `onboardingUrlFor`/`signClientToken`
  (`src/onboarding/client-link.ts`).
- Native write tools we own: `instagram_create_post` (`src/mcps/instagram-graph.ts`),
  `tiktok_upload_video` (`src/mcps/tiktok.ts`). Paid generation flows through our
  `limitHiggsfieldTools` wrapper (`src/higgsfield-usage.ts`). Meta-Ads writes are MCP tools, default
  off (`META_ADS_ENABLE_WRITE_TOOLS`).

## Design

Three independent features, smallest-blast-radius first.

### 1. Value before integration (the gate)
Change the inbound gate so an un-onboarded sender is **served by the agent**, not bounced to a link.

- In `src/whatsapp.ts` and `src/twilio-whatsapp.ts`: replace the hard `continue` for
  `!hasAnyConnection && !hasRole` with: run `runAndDeliver` normally **and** append a one-time
  onboarding nudge. Track "nudge already sent" with a tiny per-client flag
  (`store/clients/<id>/meta.json` `{ onboardingNudgedAt }`, atomic write) so we invite setup once,
  not every message.
- The default `personal-assistant-dev` agent already works from conversation alone (research, advice,
  sandbox compute) — that is the day-one value, before any OAuth.
- Abuse/cost is bounded by the existing **sender allowlist** — guests still must pass `isSenderAllowed`.

### 2. Deferred, justified OAuth (connect-on-demand tool)
Let the agent ask for an app connection **only when a task needs it**, with a one-tap signed link.

- New tool factory `createConnectTools(jid)` in `src/mcps/connect.ts`, pushed in `buildClientAgent`:
  - `request_app_connection({ platform })` → validates `platform` against the role's
    `requiredMcps ∪ optionalMcps` (from `src/roles/registry.ts`), and returns a **signed deep link**
    to start that platform's OAuth. Implementation: extend `onboardingUrlFor` to accept an optional
    `?platform=<id>` (deep-links the onboarding UI straight to that connect step) — the signed `c=`
    token already binds the client. No new secret surface.
  - Returns user-facing copy: *"To pull this automatically, connect <Platform> — about 30 seconds: <link>."*
- Skill/prompt nudge: a short rule so the agent fetches what it can from the conversation first and
  only calls `request_app_connection` when automation genuinely requires the live account.

### 3. Approve-before-act (human-in-the-loop confirmation)
Irreversible/spending actions are **staged**, summarized to the user, and executed only after an
explicit "YES" — enforced, not prompt-only.

- New module `src/confirmations.ts`:
  - State: `store/clients/<id>/pending-action.json` = `{ id, toolName, argsFingerprint, summary,
    createdAt, approved }` (one pending at a time; atomic tmp+rename; 10-min expiry). Keyed by
    `clientIdFromJid`.
  - `guardWrite(clientId, toolObj, summarize)` — wraps a Strands tool, returning a tool with the same
    name/description/inputSchema whose callback:
    - computes `argsFingerprint = sha256(toolName + stableStringify(input))`;
    - if a **non-expired, approved** pending matches `(toolName, fingerprint)` → clear it and run the
      real callback (execute);
    - else → write the pending record (unapproved) and return, without executing:
      *"⚠️ This needs your OK. <summary>. Reply YES to confirm or NO to cancel."*
  - `resolvePendingApproval(clientId, text)` — called from the inbound path: if `text` is affirmative
    (`^(yes|y|confirm|approve|go ahead|do it)\b`) and an unapproved pending exists → mark approved and
    return a nudge prompt `"The user approved the pending action — execute it now."`; if negative,
    clear it and short-circuit with "Cancelled."; else return null (normal flow).
- Wire-up:
  - In `src/delivery.ts` (shared by both transports + scheduler), before invoking: call
    `resolvePendingApproval`. On approval, prepend the nudge to the prompt so the agent re-calls the
    guarded tool with the same args → fingerprint matches the approved pending → executes. On
    cancel, reply and skip the agent. **Safety property:** execution happens only when an *approved*
    fingerprint matches the *exact* args; different args re-trigger confirmation.
  - Guarded set (phase 1, as built): `instagram_create_post`, `tiktok_upload_video` — our native
    callback tools. Reads and `publish_output`/`deliver_*` (which only send to the requesting user)
    are **not** guarded.
  - Deferred to phase 2: paid Higgsfield generation (uses the `Tool.stream` protocol, not the
    `tool()` callback shape, and is already daily spend-limited) and Meta-Ads MCP write tools
    (MCP-sourced, default-off). Guard both by name once tackled.
- Felt-trust copy: the no-profile onboarding note gains one line — *"I never see or store your
  passwords (they're encrypted), and I'll always ask before posting or spending."*

## Files

- **New:** `src/confirmations.ts` (+`.test.ts`), `src/mcps/connect.ts` (+`.test.ts`).
- **Modify:** `src/whatsapp.ts`, `src/twilio-whatsapp.ts` (gate + nudge-once + approval hook via
  delivery), `src/delivery.ts` (approval resolution), `src/agent.ts` (push connect tool; wrap guarded
  tools with `guardWrite`; trust copy), `src/onboarding/client-link.ts` (`platform` deep-link param),
  `src/mcps/instagram-graph.ts` + `tiktok.ts` (mark guarded) , `src/higgsfield-usage.ts` (confirm paid
  gens), `src/store/types.ts` (pending-action + client-meta shapes).
- **Reuse:** `onboardingUrlFor`/`signClientToken`, role registry `requiredMcps`/`optionalMcps`, the
  atomic-write store pattern, `isSenderAllowed`, `clientIdFromJid`.

## Testing (test-first, `node:test`, deterministic)

- `confirmations.test.ts` — first call stages + does not execute; affirmative approval then matching
  re-call executes once; mismatched args re-stage (no execution); expired pending is ignored;
  negative reply clears. Use a fake tool callback (a counter) — no SDK/network.
- `connect.test.ts` — `request_app_connection` rejects a platform outside the role's allowed set;
  returns a signed link containing the `platform` param for an allowed one.
- `client-link.test.ts` — `onboardingUrlFor(base, jid, platform)` round-trips the signed token and
  carries `&platform=`.
- Gate behavior: a unit around the extracted "should serve guest?" decision (pure function) so the
  un-onboarded path is covered without a live socket.
- `npm run type-check` + `npm test` green; the metric to watch in manual E2E is **TTFV**: an
  un-onboarded sender should get a useful reply to their first message, and a connect prompt only when
  a task needs the live account.

## Out of scope (named, not silently dropped)

- Meta-Ads write confirmation (phase 2). Undo/rollback beyond "don't do it without YES." Onboarding
  web-UI deep-link rendering (server accepts `platform`; the UI change is a separate front-end task).
  WhatsApp/Baileys platform-ban risk and unit-economics — tracked separately, not code here.
