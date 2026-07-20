# Web Browser Agent Tool — Design

Status: approved (design), not yet implemented
Branch: `feature/web-browser-agent-tool`

## Why

Ahrness agents today can only reach the web through `web_search` (Tavily
snippets) and the API-shaped platform tools (Meta Ads, Instagram Graph,
TikTok, Google). None of that lets an agent actually *open a page, read what's
there, click something, fill a form, or act inside a client's logged-in
account on a site that has no official API*. The client wants the agent to be
able to go into essentially any website and get real work done there —
research, form-filling, data extraction, and (with explicit permission)
logging into a client's own accounts — with the highest practical bot-evasion
and prompt-injection defenses this repo's existing security patterns support.

## Reference material scanned

- `~/Desktop/github-projects/onbuzz-community/src/tools/webTool.js` (+
  `browserStealth.js`, `humanBehavior.js`, `stealthConstants.js`) — Node.js
  Puppeteer + `puppeteer-extra-plugin-stealth`, per-agent tab pooling,
  search/fetch/interactive command set, credential-based site login, idle
  cleanup. **Primary source we're porting from** — same language, same "tool
  factory" shape ahrness already uses.
- `~/Desktop/github-projects/browser-use` (Python) — autonomous LLM-driven
  browsing loop with DOM/AX-tree element indexing. **Concept borrowed**
  (auto-indexed clickable elements), not the code (wrong language, wrong
  shape — it's a nested agent, not a single tool).
- `~/Desktop/github-projects/browser-harness` (Python) — thin CDP harness
  that attaches to a user's real local Chrome, with self-writing per-site
  "domain-skills". **Concept noted for later** (durable site-specific
  learning via the skill registry); not applicable now since ahrness is
  headless/server-side with no local browser to attach to.

## Non-goals (v1)

- Paid residential-proxy / CAPTCHA-solving tiers. Self-hosted stealth only
  for now; revisit if specific sites prove unreachable.
- A general "domain-skills" self-improving knowledge base (browser-harness's
  idea). Worth a follow-up once the core tool is proven.
- Any UI beyond what's described below (no new dashboard sections besides the
  two called out in Credential storage).

## Architecture

### Execution: a dedicated `browser-runtime` sidecar container

A new container, provisioned the same way `ahrness-egress-proxy` already is
(internal Docker network, never publicly exposed). It runs:

- One shared headless Chromium process (Puppeteer +
  `puppeteer-extra-plugin-stealth`, evasions ported from
  `browserStealth.js`).
- One isolated **browser context** per active client conversation (Chrome's
  native per-context cookie/storage isolation — not full separate processes,
  but strong enough isolation for this use case and far cheaper than N
  processes).
- Idle-context cleanup after a configurable timeout (ports
  `cleanupIdleTabs`/`cleanupAgent` from onbuzz).
- A concurrency cap (`BROWSER_MAX_CONTEXTS`) — a client hitting the cap gets
  a clear "still busy on another browsing task, try again shortly" tool
  result instead of the container degrading.

The main app talks to it over an internal HTTP/WS control API. Rejected
alternatives:
- **In the main Node process** (onbuzz's actual model) — rejected: a
  Chromium crash/hang would degrade the WhatsApp bot for every client, not
  just the one browsing.
- **Inside the per-client Docker sandbox** (`Dockerfile.sandbox`) —
  rejected: that sandbox is exec-per-command, not a fit for a long-lived
  stateful browser session, and would add Chromium's footprint to every
  client container whether they browse or not.

### Egress

Every resolved navigation target gets the SSRF guard already in
`net-guard.ts` (`isPrivateAddress`) — blocks loopback/private/link-local
targets. **No domain allowlist** — unlike the code-sandbox's egress proxy
(which intentionally restricts sandboxed code to a known-domain list), "go to
any site" is the explicit requirement here, so this is a different
egress policy by design, not an oversight.

## Tool surface

New host-side tool factory `createBrowserTools(clientId)`, registered
per-role like the other tool factories:

| Tool | Purpose |
|---|---|
| `browser_navigate({ url })` | Opens the client's persistent context to a URL. |
| `browser_read({ format })` | Page text/title/links. **Always wrapped** in the same `⚠️ UNTRUSTED` header `web-search.ts` already uses. |
| `browser_view_elements()` | Auto-indexer: walks the DOM/accessibility tree, returns a numbered list of visible interactive elements (`[3] button "Sign in"`, `[7] input "Email"`). Primary interaction path — this is what makes "any unfamiliar site" tractable. |
| `browser_click({ index })` / `browser_type({ index, text })` | Act by index from the last `browser_view_elements()` call. |
| `browser_click_selector({ selector })` / `browser_type_selector({ selector, text })` | Raw CSS escape hatch for sites we already have selectors for. |
| `browser_screenshot()` | Screenshot + AI vision description, also wrapped as untrusted. Unavailable during the credential-entry window of `browser_login` (see below). |
| `browser_login({ domain })` | See Credential flow. Takes **no credential arguments** — the model never sees a password. |

**Prompt-injection defenses, concretely:**
- Every value extracted *from a page* (text, element labels, vision
  descriptions) is wrapped in the untrusted-content header before it reaches
  the model — same convention as `web-search.ts`'s `formatResults`.
- The action executor only accepts click/type targets from the **agent's own
  tool-call arguments** — page content is data the agent reads, never a path
  by which a page can trigger an action itself.
- `browser_read`/`browser_view_elements` output gets a lightweight scan for
  injection patterns ("ignore previous instructions", "you are now", etc.)
  and appends an extra explicit warning banner on a match. Doesn't block —
  just raises the model's guard further.
- Anything the agent attempts via click/type that lands on a recognized
  checkout/payment/delete/submit-with-side-effects flow routes through the
  existing `stageOrExecute` confirm-gate (`confirmations.ts`) — same pattern
  `instagram-graph.ts` already uses for write actions.

## Credential storage & connect flow

New vault namespace: `store/clients/<clientId>/site-credentials.json`,
encrypted through the existing `src/vault.ts` (AES-256-GCM) — same primitive
already protecting OAuth tokens and CRM PII. Entry shape: `{ domain,
username, encryptedPassword, connectedAt }`.

**Vault writes only ever happen from a dashboard web form — never from the
agent, never from a WhatsApp message.** This is the load-bearing security
property: it makes it structurally impossible for a password to end up in
chat history, session logs, or the model's context, rather than relying on
the agent being *told* not to expose it.

Two entry points, both landing in the same vault:

1. **Onboarding quick-connect** — a small curated set of named platforms
   (LinkedIn, Instagram, Facebook, Reddit to start; more later) get a
   `src/browser-sites/registry.ts` (mirrors `mcps/registry.ts`'s shape) with
   a per-site login-field profile, offered as one-click connect buttons
   alongside the existing OAuth platform connects.
2. **Ad-hoc mid-conversation** — the agent hits a login wall on a domain with
   no curated profile and no vault entry. Instead of failing, it sends the
   client a signed dashboard link over WhatsApp (reusing
   `signClientToken`/`onboardingUrlFor`, same mechanism as the existing
   onboarding link) to a generic "Add website login" form (domain + username
   + password). Once saved, the agent's next `browser_login({ domain })`
   call succeeds.

Unknown domains without a curated profile fall back to heuristic
username/password field detection — porting onbuzz's `LOGIN_FIELD_PATTERNS`.

### `browser_login` sequence (credibility + safety)

1. Navigate to the login page.
2. **Screenshot the empty login form** (no credentials typed yet — safe by
   construction) and **deliver it to the client over WhatsApp** (reusing the
   existing image-delivery path in `outputs.ts`), e.g. *"Logging into
   `linkedin.com` on your behalf — here's the page I'm connecting to."* This
   is both a transparency/credibility signal and a sanity check: if the
   agent somehow landed on a lookalike/phishing page, the client sees the
   wrong URL right there.
3. **Disable `browser_screenshot`/vision analysis for this session** — the
   window starts here.
4. Host reads the vaulted credential, types username + password directly
   into the page (never surfaced in any tool result), submits.
5. Once navigated away from the login form (window ends), **re-enable
   screenshots** and optionally send a second "you're in" confirmation
   screenshot — safe again, no password field on screen.

## Opt-in gating

Not modeled as a platform connection (the MCP registry's `McpDefinition`
shape implies "the client connects *their* external account" — Instagram/
TikTok/Google all fit that even without real MCP-protocol servers behind
them, but web browsing isn't an account, it's a capability toggle on the
agent itself). Modeled instead as a small dedicated capability flag — e.g.
`capabilities.json` under the client's store directory, or a field on
`role.json` — surfaced in the dashboard as a distinct "Agent Permissions"
toggle, separate from "Connected Platforms". `buildClientAgent` gets a small
new check (a few lines) alongside its existing MCP-filtering step, rather
than free-riding on the platform-connection registry for something that
isn't one.

Default: **off**. Every role can use it once a client opts in — no
role-based restriction beyond that, per the "all roles, opt-in per client"
decision.

## Failure handling & limits

- Per-navigation timeout, ported HTTP-status handling from onbuzz (401/402/
  403 pages returned as useful content — logins/paywalls are informative to
  the agent — hard 4xx/5xx are failures with a clear suggestion).
- If `browser-runtime` is unreachable when `buildClientAgent` assembles
  tools, browser tools are silently omitted for that turn — same fail-soft
  try/catch pattern already used for MCP connection failures (AGENTS.md rule
  6). Never blocks building or running the agent.
- Concurrency cap returns a clear "try again shortly" result rather than
  degrading the shared Chromium process.

## Testing

- Colocated `*.test.ts` per repo convention.
- Deterministic, dependency-free unit tests for: the untrusted-content
  wrapper, the injection-pattern scanner, the login-field heuristic matcher,
  and the vision-disable window logic (state machine, no real browser
  needed).
- The actual Puppeteer/Chromium path is tested against a mocked
  `browser-runtime` HTTP client in unit tests; a manual smoke-test checklist
  covers the real container end-to-end (same posture as `npm run
  test:memory` needing real credentials/network — not part of `npm test`).

## Open items deferred to later specs

- Paid anti-bot tier (residential proxy / CAPTCHA solving) if self-hosted
  stealth proves insufficient for specific high-value targets.
- Self-writing per-site "domain-skills" (browser-harness's idea), layered
  onto the existing `src/skills/<name>/SKILL.md` registry once the core tool
  has real usage to learn from.
- Expanding the curated onboarding quick-connect list beyond LinkedIn/
  Instagram/Facebook/Reddit.
