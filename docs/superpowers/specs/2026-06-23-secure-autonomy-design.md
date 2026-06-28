# Secure Autonomy: Encrypted Vault + Filtered Web Egress + Sender Allowlist

> Status: approved 2026-06-23. Implementation plan: this spec drives a single hardening branch.

## Context

The agent stores real client OAuth tokens (Meta Ads, Instagram, TikTok, Google) and acts on those
apps, including unattended scheduled jobs. We want it to **search/scrape the web autonomously and
interact with specific apps while keeping client tokens secure**, and stay controlled so it
"won't go crazy."

The architecture is already ~80% there. Three gaps:

1. **Tokens are plaintext at rest** — `store/clients/{id}/connections.json` and the Higgsfield OAuth
   store are unencrypted JSON (mode 0600). The one critical hole.
2. **No sender allowlist** — `whatsapp.ts` answers any inbound JID (only `fromMe` is skipped).
3. **No web access** — sandbox is correctly `--network none`; no web tool exists.

Preserved as-is:
- Sandbox is hardened/fail-closed (`--network none`, `--read-only`, `--cap-drop ALL`,
  `no-new-privileges`, non-root, no host fallback).
- **App tokens never enter the sandbox** — platform tools run host-side; the model passes intent.
  This is the brokered-credentials pattern; we keep it for apps.
- Reusable SSRF guard exists: `isPrivateAddress()` / `assertPublicHttpsUrl()` in `src/outputs.ts`.

## Security model (spine)

Sandbox = untrusted zone (model + arbitrary code). Host = trusted broker. Secrets live only
host-side, **encrypted at rest**, exercised only through narrow tools.
- **Apps:** brokered host-side; tokens never enter the sandbox (unchanged).
- **Web:** sandbox gets **filtered egress** through a forward proxy that is its only route out
  (domain allowlist + private-IP block). Keyed search stays a host broker tool so the search key is
  never exposed.
- **Control:** fetched web content is untrusted data; irreversible/write actions stay gated +
  rate-limited.

## Design (built test-first)

1. **`src/vault.ts`** — AES-256-GCM, key = `scryptSync(AGENT_MASTER_KEY, vaultSalt, 32)` derived
   once; `vaultSalt` random 16B at `store/vault.salt` (0600). `encryptSecret`/`decryptSecret`/
   `isEncrypted`. Fail fast if `AGENT_MASTER_KEY` missing or <32 chars. Blob form
   `v1:<ivB64url>:<tagB64url>:<ctB64url>`.
2. **`src/store/client-store.ts`** — encrypt `accessToken`/`refreshToken` in `upsertConnection`,
   decrypt in `getConnections`; auto-migrate plaintext on read (`!isEncrypted` → re-encrypt+rewrite).
   Same treatment for the Higgsfield `tokens` field in `src/higgsfield-auth.ts`.
3. **`src/access.ts`** — `isSenderAllowed(jid)` against `AGENT_ALLOWED_SENDERS`. If set, deny others
   silently; if unset, loud startup warning + allow. Wired into `whatsapp.ts` + `twilio-whatsapp.ts`.
4. **`src/egress-proxy.ts`** — host-side forward proxy: CONNECT only to `AGENT_WEB_ALLOWLIST`
   domains (+ optional per-client extras), reject private IPs via `isPrivateAddress()`, HTTPS:443,
   size cap, per-client rate limit (mirrors `higgsfield-usage.ts`), audit log. **`src/sandbox.ts`**:
   internal Docker network `ahrness-egress` (no NAT) + proxy bridged to the internet; sandbox joins
   the internal net with `HTTPS_PROXY` env. Gated by `AGENT_SANDBOX_EGRESS` (default off → today's
   `--network none`).
5. **`src/mcps/web-search.ts`** — host broker `web_search` tool using `WEB_SEARCH_API_KEY`
   (host-side; never in sandbox/model). Returns snippets+URLs; model fetches chosen pages via the
   in-sandbox proxy.
6. **Edge hardening** — persist refreshed Google tokens (`src/mcps/google.ts`); enforce HTTPS on
   `CALLBACK_BASE_URL` unless `ALLOW_INSECURE_CALLBACK=true`; document Meta-Ads subprocess-env token
   residual risk.
7. **Won't-go-crazy** — untrusted-content framing in the role system prompt (`src/agent.ts`); keep
   write-tool gating (`META_ADS_ENABLE_WRITE_TOOLS` off by default); per-client egress/spend caps.

## Positioning (informs product, not code)

Competitors sell a layer below a finished product: **OpenClaw** (self-hosted monolith),
**NanoClaw** (lean self-hosted harness + "Agent Vault", $12M seed — effectively our architecture),
**Monday.com agents** (enterprise suite, consumption pricing), **LangChain Agent Builder** (no-code
*builder*). None target a non-tech solo over WhatsApp with done-for-you setup.

**Wedge:** a done-for-you, **multi-role** AI operator over WhatsApp, sold as outcomes. The platform
ships ready-made roles (marketing-manager, creative-director, ads-analyst, social-media-manager,
personal-assistant-dev), each with skills + required connections + prompt. Pick a role, connect
apps once, get work done. New verticals = new role presets. We ship *configured employees you can
hire by role*, with one secure core under every role.

**Security as trust feature:** "Your passwords never touch the AI's brain — they're encrypted on our
side and the AI only asks us to act." This spec makes that literally true.

## Verification

- Unit (test-first): `vault.test.ts` (round-trip, tamper-fails, missing-key-throws);
  `client-store.test.ts` (on-disk `v1:`-prefixed, get returns plaintext, legacy migrated);
  `access.test.ts` (allow/deny/open-warn); `egress-proxy.test.ts` (allowlist pass/block, private-IP
  block, rate cap).
- `npm run type-check` (0 errors) + `npm test` (existing + new green).
- Egress E2E: `AGENT_SANDBOX_EGRESS=true`, `AGENT_WEB_ALLOWLIST=example.com` → in-sandbox curl to
  allowlisted host works, others refused.
- Web-search E2E: `web_search` works with host-side key; key absent from transcript/sandbox env.
- At-rest: grep saved `connections.json` shows no readable token; `npm run test:memory` still green.
