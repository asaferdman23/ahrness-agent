# Web Browser Agent Tool — Plan B: Credential Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent log into a client's own accounts on specific websites (LinkedIn, Instagram, Facebook, Reddit to start, plus any ad-hoc site) using credentials the client entered on a dashboard web form — never via chat, never visible to the model — with a transparency screenshot sent before typing anything and vision disabled during the exact credential-entry window.

**Architecture:** Builds directly on Plan A's browser tool (`src/browser/tools.ts`, `src/browser/client.ts`, `src/browser-runtime/server.ts`, all already merged into this branch). A new encrypted vault namespace stores one credential per client per domain, written only from a signed-link web form (`/connect-site`) — the same signed-link mechanism onboarding already uses. A new `browser_login` tool resolves the credential (or returns a connect-link if none exists), navigates to the site's login page, screenshots the empty form and publishes it to WhatsApp through the *existing* code-sandbox delivery pipeline (not a new delivery path), disables the browser tool's screenshot capability for the duration of credential entry, fills the fields (found via the same auto-indexed-element list Plan A already builds, matched by a small heuristic), submits, and re-enables screenshots.

**Tech Stack:** Same as Plan A (Puppeteer inside the existing browser-runtime sidecar, `node:test`, existing `src/vault.ts` AES-256-GCM primitive, existing `DockerSandbox`/`PublishedOutput` delivery pipeline).

## Global Constraints

- ESM with `.js` import specifiers on every local import (NodeNext), even for `.ts` files — never `.ts`, never extensionless.
- TypeScript strict mode; no implicit `any`.
- Tests are colocated `*.test.ts` using `node:test`, dependency-free and deterministic where practical.
- Client data is keyed by `clientIdFromJid(jid)`; `store/` and `.env` stay gitignored; store writes are atomic (tmp file + rename).
- Secrets come from env only; **a password must never appear in a tool result, a chat message, or the model's context — vault writes happen only from the `/connect-site` web form, never from the agent or a WhatsApp message.**
- Non-critical paths fail soft.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. This plan continues on the already-checked-out branch (do not create a new one, do not push without being asked).

---

### Task 1: Site-credentials vault store

**Files:**
- Create: `src/store/site-credentials-store.ts`
- Test: `src/store/site-credentials-store.test.ts`

**Interfaces:**
- Produces: `SiteCredential = { domain: string; username: string; connectedAt: string }`, `getSiteCredential(clientId: string, domain: string): Promise<SiteCredential | null>`, `saveSiteCredential(clientId: string, domain: string, username: string, password: string): Promise<void>` — consumed by Task 6's `browser_login` tool and Task 7's `/connect-site` route. Note: `getSiteCredential`'s return type deliberately has **no password field** — callers that need to actually type the password call a separate function, `getSiteCredentialSecret`, kept distinct so a caller can't accidentally log/serialize a credential object containing the plaintext password.
- Also produces: `getSiteCredentialSecret(clientId: string, domain: string): Promise<string | null>` — returns the decrypted password only, for the one caller (Task 6) that types it into a page.

- [ ] **Step 1: Write the failing test**

Create `src/store/site-credentials-store.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  getSiteCredential,
  getSiteCredentialSecret,
  saveSiteCredential,
} from './site-credentials-store.js'

async function withTempStore<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ahrness-site-creds-'))
  const prevStore = process.env.AGENT_STORE_DIR
  const prevKey = process.env.AGENT_MASTER_KEY
  process.env.AGENT_STORE_DIR = dir
  process.env.AGENT_MASTER_KEY = 'a'.repeat(32)
  try {
    return await fn()
  } finally {
    if (prevStore === undefined) delete process.env.AGENT_STORE_DIR
    else process.env.AGENT_STORE_DIR = prevStore
    if (prevKey === undefined) delete process.env.AGENT_MASTER_KEY
    else process.env.AGENT_MASTER_KEY = prevKey
  }
}

test('returns null for a domain with no saved credential', async () => {
  await withTempStore(async () => {
    const result = await getSiteCredential('client-1', 'linkedin.com')
    assert.equal(result, null)
  })
})

test('saveSiteCredential then getSiteCredential round-trips username without the password', async () => {
  await withTempStore(async () => {
    await saveSiteCredential('client-2', 'linkedin.com', 'alice@example.com', 's3cret-pw')
    const result = await getSiteCredential('client-2', 'linkedin.com')
    assert.ok(result)
    assert.equal(result.domain, 'linkedin.com')
    assert.equal(result.username, 'alice@example.com')
    assert.ok(result.connectedAt)
    assert.ok(!('password' in result), 'must never expose the password on the general read path')
  })
})

test('getSiteCredentialSecret returns the decrypted password', async () => {
  await withTempStore(async () => {
    await saveSiteCredential('client-3', 'reddit.com', 'bob', 'hunter2')
    const secret = await getSiteCredentialSecret('client-3', 'reddit.com')
    assert.equal(secret, 'hunter2')
  })
})

test('credentials for different domains on the same client do not collide', async () => {
  await withTempStore(async () => {
    await saveSiteCredential('client-4', 'linkedin.com', 'a', 'pw-a')
    await saveSiteCredential('client-4', 'reddit.com', 'b', 'pw-b')
    assert.equal(await getSiteCredentialSecret('client-4', 'linkedin.com'), 'pw-a')
    assert.equal(await getSiteCredentialSecret('client-4', 'reddit.com'), 'pw-b')
  })
})

test('saving again for the same domain overwrites the previous credential', async () => {
  await withTempStore(async () => {
    await saveSiteCredential('client-5', 'linkedin.com', 'old-user', 'old-pw')
    await saveSiteCredential('client-5', 'linkedin.com', 'new-user', 'new-pw')
    const result = await getSiteCredential('client-5', 'linkedin.com')
    assert.equal(result?.username, 'new-user')
    assert.equal(await getSiteCredentialSecret('client-5', 'linkedin.com'), 'new-pw')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/store/site-credentials-store.test.ts`
Expected: FAIL with "Cannot find module './site-credentials-store.js'"

- [ ] **Step 3: Write the implementation**

Create `src/store/site-credentials-store.ts`, mirroring the atomic-write pattern already used by `src/confirmations.ts`'s `fileConfirmationStore()` (this repo's convention: each store file owns its own tiny atomic-write helper rather than importing one from `client-store.ts`, since those helpers aren't exported there):

```ts
/**
 * Encrypted per-client, per-domain site login credentials — the vault a client
 * fills in on the /connect-site web form, never via chat. The password is
 * encrypted at rest through the same AES-256-GCM primitive (src/vault.ts)
 * already protecting OAuth tokens and CRM PII.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { decryptSecret, encryptSecret } from '../vault.js'

export interface SiteCredential {
  domain: string
  username: string
  connectedAt: string
}

interface StoredSiteCredential extends SiteCredential {
  encryptedPassword: string
}

type SiteCredentialsFile = Record<string, StoredSiteCredential>

function clientsDir(): string {
  return path.resolve(process.env.AGENT_STORE_DIR ?? './store', 'clients')
}

function filePathFor(clientId: string): string {
  return path.join(clientsDir(), clientId, 'site-credentials.json')
}

async function readAll(clientId: string): Promise<SiteCredentialsFile> {
  try {
    return JSON.parse(await readFile(filePathFor(clientId), 'utf-8')) as SiteCredentialsFile
  } catch {
    return {}
  }
}

async function writeAll(clientId: string, data: SiteCredentialsFile): Promise<void> {
  const filePath = filePathFor(clientId)
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  await rename(tmp, filePath)
}

/** Domain-only lookup: username + connectedAt, never the password. */
export async function getSiteCredential(clientId: string, domain: string): Promise<SiteCredential | null> {
  const all = await readAll(clientId)
  const stored = all[domain]
  if (!stored) return null
  return { domain: stored.domain, username: stored.username, connectedAt: stored.connectedAt }
}

/** The one caller (browser_login) that needs the actual password, to type it into a page. */
export async function getSiteCredentialSecret(clientId: string, domain: string): Promise<string | null> {
  const all = await readAll(clientId)
  const stored = all[domain]
  if (!stored) return null
  return decryptSecret(stored.encryptedPassword)
}

/** Called only from the /connect-site web form handler — never from agent/chat code. */
export async function saveSiteCredential(
  clientId: string,
  domain: string,
  username: string,
  password: string,
): Promise<void> {
  const all = await readAll(clientId)
  all[domain] = {
    domain,
    username,
    encryptedPassword: encryptSecret(password),
    connectedAt: new Date().toISOString(),
  }
  await writeAll(clientId, all)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/store/site-credentials-store.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/store/site-credentials-store.ts src/store/site-credentials-store.test.ts
git commit -m "feat(browser): add encrypted per-domain site-credentials vault store"
```

---

### Task 2: Curated site registry

**Files:**
- Create: `src/browser-sites/registry.ts`
- Test: `src/browser-sites/registry.test.ts`

**Interfaces:**
- Produces: `SiteProfile = { domain: string; displayName: string; loginUrl: string }`, `getSiteProfile(domain: string): SiteProfile | null`, `getAllSiteProfiles(): SiteProfile[]` — consumed by Task 6's `browser_login` (to find the right login URL for a curated site) and Task 8's dashboard quick-connect links.

- [ ] **Step 1: Write the failing test**

Create `src/browser-sites/registry.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAllSiteProfiles, getSiteProfile } from './registry.js'

test('getSiteProfile returns a curated profile for a known domain', () => {
  const profile = getSiteProfile('linkedin.com')
  assert.ok(profile)
  assert.equal(profile.domain, 'linkedin.com')
  assert.match(profile.loginUrl, /^https:\/\//)
})

test('getSiteProfile returns null for an uncurated domain', () => {
  assert.equal(getSiteProfile('some-random-saas.example'), null)
})

test('getAllSiteProfiles returns all four curated sites', () => {
  const profiles = getAllSiteProfiles()
  const domains = profiles.map((p) => p.domain).sort()
  assert.deepEqual(domains, ['facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/browser-sites/registry.test.ts`
Expected: FAIL with "Cannot find module './registry.js'"

- [ ] **Step 3: Write the implementation**

Create `src/browser-sites/registry.ts`, mirroring `src/mcps/registry.ts`'s Map-based shape:

```ts
export interface SiteProfile {
  domain: string
  displayName: string
  loginUrl: string
}

const profiles: SiteProfile[] = [
  { domain: 'linkedin.com', displayName: 'LinkedIn', loginUrl: 'https://www.linkedin.com/login' },
  { domain: 'instagram.com', displayName: 'Instagram', loginUrl: 'https://www.instagram.com/accounts/login/' },
  { domain: 'facebook.com', displayName: 'Facebook', loginUrl: 'https://www.facebook.com/login' },
  { domain: 'reddit.com', displayName: 'Reddit', loginUrl: 'https://www.reddit.com/login' },
]

const profileMap = new Map<string, SiteProfile>(profiles.map((p) => [p.domain, p]))

export function getSiteProfile(domain: string): SiteProfile | null {
  return profileMap.get(domain) ?? null
}

export function getAllSiteProfiles(): SiteProfile[] {
  return profiles
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/browser-sites/registry.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/browser-sites/registry.ts src/browser-sites/registry.test.ts
git commit -m "feat(browser): add curated site registry for quick-connect logins"
```

---

### Task 3: Login-field heuristic matcher

**Files:**
- Create: `src/browser/login-field-finder.ts`
- Test: `src/browser/login-field-finder.test.ts`

**Interfaces:**
- Consumes: `BrowserElement` from Task 6 (Plan A) `src/browser/client.ts` (`{ index: number; tag: string; type: string | null; label: string }`).
- Produces: `findLoginFormFields(elements: BrowserElement[]): { usernameIndex: number | null; passwordIndex: number | null; submitIndex: number | null }` — consumed by Task 6's `browser_login`. Operates on the same numbered-element list `browser_view_elements` already builds (Plan A), rather than raw CSS selectors — no DOM access of its own, pure function over the element list.

- [ ] **Step 1: Write the failing test**

Create `src/browser/login-field-finder.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findLoginFormFields } from './login-field-finder.js'
import type { BrowserElement } from './client.js'

test('finds username, password, and submit on a typical login form', () => {
  const elements: BrowserElement[] = [
    { index: 0, tag: 'a', type: null, label: 'Learn more' },
    { index: 1, tag: 'input', type: 'email', label: 'Email or phone' },
    { index: 2, tag: 'input', type: 'password', label: 'Password' },
    { index: 3, tag: 'button', type: null, label: 'Log in' },
  ]
  const result = findLoginFormFields(elements)
  assert.equal(result.usernameIndex, 1)
  assert.equal(result.passwordIndex, 2)
  assert.equal(result.submitIndex, 3)
})

test('matches a username field by label text when type is generic text', () => {
  const elements: BrowserElement[] = [
    { index: 0, tag: 'input', type: 'text', label: 'Username' },
    { index: 1, tag: 'input', type: 'password', label: '' },
    { index: 2, tag: 'input', type: 'submit', label: 'Sign in' },
  ]
  const result = findLoginFormFields(elements)
  assert.equal(result.usernameIndex, 0)
  assert.equal(result.passwordIndex, 1)
  assert.equal(result.submitIndex, 2)
})

test('returns nulls for a page with no recognizable login form', () => {
  const elements: BrowserElement[] = [
    { index: 0, tag: 'a', type: null, label: 'Home' },
    { index: 1, tag: 'a', type: null, label: 'About' },
  ]
  const result = findLoginFormFields(elements)
  assert.equal(result.usernameIndex, null)
  assert.equal(result.passwordIndex, null)
  assert.equal(result.submitIndex, null)
})

test('prefers a button/input with login-like label text for submit over an unrelated button', () => {
  const elements: BrowserElement[] = [
    { index: 0, tag: 'input', type: 'email', label: 'Email' },
    { index: 1, tag: 'input', type: 'password', label: 'Password' },
    { index: 2, tag: 'button', type: null, label: 'Forgot password?' },
    { index: 3, tag: 'button', type: null, label: 'Sign in' },
  ]
  const result = findLoginFormFields(elements)
  assert.equal(result.submitIndex, 3)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/browser/login-field-finder.test.ts`
Expected: FAIL with "Cannot find module './login-field-finder.js'"

- [ ] **Step 3: Write the implementation**

Create `src/browser/login-field-finder.ts`:

```ts
import type { BrowserElement } from './client.js'

const USERNAME_LABEL_PATTERN = /email|username|user name|phone|login|account/i
const SUBMIT_LABEL_PATTERN = /log\s?in|sign\s?in|submit|continue/i
const SUBMIT_EXCLUDE_PATTERN = /forgot|help|create|sign\s?up|register/i

export interface LoginFormFields {
  usernameIndex: number | null
  passwordIndex: number | null
  submitIndex: number | null
}

/**
 * Pure heuristic over the same numbered element list browser_view_elements
 * already builds — no raw DOM/CSS-selector guessing needed, since Plan A's
 * auto-indexing already gives every visible input/button a tag/type/label.
 */
export function findLoginFormFields(elements: BrowserElement[]): LoginFormFields {
  const password = elements.find((el) => el.tag === 'input' && el.type === 'password')

  const username = elements.find(
    (el) =>
      el.tag === 'input' &&
      el.type !== 'password' &&
      (el.type === 'email' || el.type === 'text' || el.type === 'tel' || USERNAME_LABEL_PATTERN.test(el.label)),
  )

  const submit = elements.find(
    (el) =>
      (el.tag === 'button' || (el.tag === 'input' && el.type === 'submit')) &&
      SUBMIT_LABEL_PATTERN.test(el.label) &&
      !SUBMIT_EXCLUDE_PATTERN.test(el.label),
  )

  return {
    usernameIndex: username?.index ?? null,
    passwordIndex: password?.index ?? null,
    submitIndex: submit?.index ?? null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/browser/login-field-finder.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/browser/login-field-finder.ts src/browser/login-field-finder.test.ts
git commit -m "feat(browser): add login-field heuristic matcher over the indexed element list"
```

---

### Task 4: Vision-gate state machine + wire into `browser_screenshot`

**Files:**
- Create: `src/browser/vision-gate.ts`
- Test: `src/browser/vision-gate.test.ts`
- Modify: `src/browser/tools.ts` (the `browser_screenshot` tool's callback)
- Modify: `src/browser/tools.test.ts` (one new test)

**Interfaces:**
- Produces: `disableVision(clientId: string): void`, `enableVision(clientId: string): void`, `isVisionDisabled(clientId: string): boolean` — a simple per-clientId in-memory flag. Consumed by Task 6's `browser_login` (disables before typing credentials, re-enables in a `finally`) and by `browser_screenshot`'s callback (checks before calling the client).

- [ ] **Step 1: Write the failing test for the gate**

Create `src/browser/vision-gate.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { disableVision, enableVision, isVisionDisabled } from './vision-gate.js'

test('vision is enabled by default for a client with no prior state', () => {
  assert.equal(isVisionDisabled('client-fresh'), false)
})

test('disableVision then isVisionDisabled reports true', () => {
  disableVision('client-a')
  assert.equal(isVisionDisabled('client-a'), true)
  enableVision('client-a')
})

test('enableVision clears the disabled state', () => {
  disableVision('client-b')
  enableVision('client-b')
  assert.equal(isVisionDisabled('client-b'), false)
})

test('the gate is scoped per client, not global', () => {
  disableVision('client-c')
  assert.equal(isVisionDisabled('client-d'), false)
  enableVision('client-c')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/browser/vision-gate.test.ts`
Expected: FAIL with "Cannot find module './vision-gate.js'"

- [ ] **Step 3: Write the implementation**

Create `src/browser/vision-gate.ts`:

```ts
/**
 * Per-client flag that disables browser_screenshot for the narrow window
 * during which browser_login is actively typing a real password into a page
 * — closes the (small but real) chance a screenshot/vision-analysis call
 * mid-login could expose a password character or a "show password" toggle.
 */
const disabledClients = new Set<string>()

export function disableVision(clientId: string): void {
  disabledClients.add(clientId)
}

export function enableVision(clientId: string): void {
  disabledClients.delete(clientId)
}

export function isVisionDisabled(clientId: string): boolean {
  return disabledClients.has(clientId)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/browser/vision-gate.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Wire the gate into `browser_screenshot`**

In `src/browser/tools.ts`, add the import:

```ts
import { isVisionDisabled } from './vision-gate.js'
```

Find the `browser_screenshot` tool's callback (currently just `const result = await client.screenshot(clientId); return JSON.stringify(result)`) and change it to:

```ts
callback: async (_input: unknown) => {
  if (isVisionDisabled(clientId)) {
    return JSON.stringify({ error: 'Screenshots are temporarily unavailable while a login is in progress for this client.' })
  }
  const result = await client.screenshot(clientId)
  return JSON.stringify(result)
},
```

- [ ] **Step 6: Add a test for the wired behavior**

Add to `src/browser/tools.test.ts`:

```ts
import { disableVision, enableVision } from './vision-gate.js'

test('browser_screenshot refuses while vision is disabled for this client', async () => {
  const tools = createBrowserTools('client-8', fakeClient())
  disableVision('client-8')
  try {
    const screenshotTool = findTool(tools, 'browser_screenshot')
    const result = await screenshotTool.invoke({})
    assert.match(result, /temporarily unavailable/i)
  } finally {
    enableVision('client-8')
  }
})
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node --import tsx --test src/browser/tools.test.ts`
Expected: PASS (all 10 tests — the 8 from Plan A plus this one plus the finding-4 fix's test)

- [ ] **Step 8: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/browser/vision-gate.ts src/browser/vision-gate.test.ts src/browser/tools.ts src/browser/tools.test.ts
git commit -m "feat(browser): add vision-gate state machine and wire into browser_screenshot"
```

---

### Task 5: Site-login connect-link builder

**Files:**
- Create: `src/browser/site-login-link.ts`
- Test: `src/browser/site-login-link.test.ts`

**Interfaces:**
- Consumes: `signClientToken`/`verifyClientToken` from the existing `src/onboarding/client-link.ts` (already exported, no changes needed there).
- Produces: `siteLoginConnectUrlFor(base: string, jid: string, domain: string): string`, `verifySiteLoginToken(token: string): string | null` (thin re-export/alias of `verifyClientToken`, kept as its own named function in this file so Task 7's route reads clearly about what it's verifying) — consumed by Task 6's `browser_login` (to build the link when no credential exists) and Task 7's `/connect-site` route (to verify it).

- [ ] **Step 1: Write the failing test**

Create `src/browser/site-login-link.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { siteLoginConnectUrlFor, verifySiteLoginToken } from './site-login-link.js'

test('siteLoginConnectUrlFor builds a link carrying a signed token and the domain', () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  const url = siteLoginConnectUrlFor('https://example.com', '972501234567@s.whatsapp.net', 'linkedin.com')
  assert.match(url, /^https:\/\/example\.com\/connect-site\?c=/)
  assert.match(url, /domain=linkedin\.com/)
})

test('the token embedded in the link verifies back to the original jid', () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  const url = siteLoginConnectUrlFor('https://example.com', '972501234567@s.whatsapp.net', 'reddit.com')
  const token = new URL(url).searchParams.get('c')
  assert.ok(token)
  assert.equal(verifySiteLoginToken(token), '972501234567@s.whatsapp.net')
})

test('verifySiteLoginToken rejects a tampered token', () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  const url = siteLoginConnectUrlFor('https://example.com', '972501234567@s.whatsapp.net', 'reddit.com')
  const token = new URL(url).searchParams.get('c')!
  assert.equal(verifySiteLoginToken(`${token}x`), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/browser/site-login-link.test.ts`
Expected: FAIL with "Cannot find module './site-login-link.js'"

- [ ] **Step 3: Write the implementation**

Create `src/browser/site-login-link.ts`:

```ts
import { signClientToken, verifyClientToken } from '../onboarding/client-link.js'

/** Builds the signed link a client taps to enter a website login on the /connect-site form. */
export function siteLoginConnectUrlFor(base: string, jid: string, domain: string): string {
  const token = signClientToken(jid)
  return `${base.replace(/\/$/, '')}/connect-site?c=${token}&domain=${encodeURIComponent(domain)}`
}

/** Verifies a /connect-site token, returning the jid it was signed for, or null if invalid. */
export function verifySiteLoginToken(token: string): string | null {
  return verifyClientToken(token)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/browser/site-login-link.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/browser/site-login-link.ts src/browser/site-login-link.test.ts
git commit -m "feat(browser): add signed connect-site link builder for site logins"
```

---

### Task 6: `browser_login` tool

**Files:**
- Create: `src/browser/login-tools.ts`
- Test: `src/browser/login-tools.test.ts`

**Interfaces:**
- Consumes: `getSiteCredential`/`getSiteCredentialSecret` from Task 1 (`src/store/site-credentials-store.js`), `getSiteProfile` from Task 2 (`src/browser-sites/registry.js`), `findLoginFormFields` from Task 3 (`src/browser/login-field-finder.js`), `disableVision`/`enableVision` from Task 4 (`src/browser/vision-gate.js`), `siteLoginConnectUrlFor` from Task 5 (`src/browser/site-login-link.js`), `BrowserRuntimeClient`/`createBrowserRuntimeClient` from Plan A's `src/browser/client.js`, and `PublishedOutput`/`resolvePublishedOutputPath`/`OUTPUTS_DIR` from the existing `src/outputs.js`/`src/sandbox.js` (the same delivery pipeline `publish_output`/`deliver_higgsfield_output` already use — see `createImportRemoteOutputTool` in `src/outputs.ts` for the exact `sandbox.writeFile(path, bytes)` + `published.push(item)` pattern to mirror).
- Produces: `createBrowserLoginTools(clientId: string, jid: string, sandbox: DockerSandbox, published: PublishedOutput[], client?: BrowserRuntimeClient): ReturnType<typeof tool>[]` — a one-tool array (`browser_login`), consumed by Task 9's `agent.ts` wiring. Deliberately a **separate factory function** from Plan A's `createBrowserTools` (which doesn't need `jid`/`sandbox`/`published`) rather than folding into it, keeping each factory's dependencies to what it actually needs.

- [ ] **Step 1: Write the failing test**

Create `src/browser/login-tools.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserLoginTools } from './login-tools.js'
import type { BrowserRuntimeClient } from './client.js'
import { isVisionDisabled } from './vision-gate.js'

function fakeSandbox() {
  const writes: Array<{ path: string; bytes: Uint8Array }> = []
  return {
    writes,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sandbox: { writeFile: async (path: string, bytes: Uint8Array) => { writes.push({ path, bytes }) } } as any,
  }
}

function fakeClient(overrides: Partial<BrowserRuntimeClient> = {}): BrowserRuntimeClient {
  return {
    navigate: async () => ({ httpStatus: 200, title: 'Login' }),
    read: async () => ({ title: 'Login', url: 'https://example.com/login', content: '' }),
    elements: async () => ({
      elements: [
        { index: 0, tag: 'input', type: 'email', label: 'Email' },
        { index: 1, tag: 'input', type: 'password', label: 'Password' },
        { index: 2, tag: 'button', type: null, label: 'Log in' },
      ],
    }),
    click: async () => ({ ok: true, url: 'https://example.com/home' }),
    type: async () => ({ ok: true }),
    screenshot: async () => ({ imageBase64: 'ZmFrZQ==' }),
    close: async () => undefined,
    ...overrides,
  }
}

function findTool(tools: ReturnType<typeof createBrowserLoginTools>, name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = (tools as any[]).find((t) => t.name === name)
  assert.ok(found, `expected a tool named ${name}`)
  return found
}

test('browser_login returns a connect-link when no credential exists for the domain', async () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  process.env.CALLBACK_BASE_URL = 'https://example.com'
  process.env.AGENT_STORE_DIR = '/tmp/ahrness-login-tools-test-nocred'
  const { sandbox } = fakeSandbox()
  const published: import('../outputs.js').PublishedOutput[] = []
  const tools = createBrowserLoginTools('client-nocred', '972501234567@s.whatsapp.net', sandbox, published, fakeClient())
  const loginTool = findTool(tools, 'browser_login')
  const result = await loginTool.invoke({ domain: 'some-uncurated-site.example' })
  assert.match(result, /connect-site/)
  assert.match(result, /domain=some-uncurated-site\.example/)
})

test('browser_login with a saved credential publishes a before-screenshot, disables vision during entry, and re-enables it after', async () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  process.env.AGENT_STORE_DIR = '/tmp/ahrness-login-tools-test-withcred'
  process.env.AGENT_MASTER_KEY = 'b'.repeat(32)
  const { saveSiteCredential } = await import('../store/site-credentials-store.js')
  await saveSiteCredential('client-withcred', 'reddit.com', 'alice', 'hunter2')

  const { sandbox, writes } = fakeSandbox()
  const published: import('../outputs.js').PublishedOutput[] = []
  let visionDuringType = true
  const client = fakeClient({
    type: async (id, target) => {
      visionDuringType = isVisionDisabled(id)
      return { ok: true }
    },
  })
  const tools = createBrowserLoginTools('client-withcred', '972501234567@s.whatsapp.net', sandbox, published, client)
  const loginTool = findTool(tools, 'browser_login')
  await loginTool.invoke({ domain: 'reddit.com' })

  assert.ok(writes.length >= 1, 'must write at least the before-screenshot into the sandbox')
  assert.ok(published.length >= 1, 'must publish at least the before-screenshot for delivery')
  assert.equal(visionDuringType, true, 'vision must be disabled while credentials are being typed')
  assert.equal(isVisionDisabled('client-withcred'), false, 'vision must be re-enabled after the login sequence finishes')
})

test('browser_login re-enables vision even if the login sequence throws', async () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  process.env.AGENT_STORE_DIR = '/tmp/ahrness-login-tools-test-throws'
  process.env.AGENT_MASTER_KEY = 'c'.repeat(32)
  const { saveSiteCredential } = await import('../store/site-credentials-store.js')
  await saveSiteCredential('client-throws', 'reddit.com', 'alice', 'hunter2')

  const { sandbox } = fakeSandbox()
  const published: import('../outputs.js').PublishedOutput[] = []
  const client = fakeClient({
    type: async () => {
      throw new Error('boom')
    },
  })
  const tools = createBrowserLoginTools('client-throws', '972501234567@s.whatsapp.net', sandbox, published, client)
  const loginTool = findTool(tools, 'browser_login')
  await assert.rejects(() => loginTool.invoke({ domain: 'reddit.com' }))
  assert.equal(isVisionDisabled('client-throws'), false, 'must re-enable vision even when the login flow fails partway through')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/browser/login-tools.test.ts`
Expected: FAIL with "Cannot find module './login-tools.js'"

- [ ] **Step 3: Write the implementation**

Create `src/browser/login-tools.ts`:

```ts
import { tool } from '@strands-agents/sdk'
import type { DockerSandbox } from '@strands-agents/sdk/sandbox/docker'
import { createBrowserRuntimeClient, type BrowserRuntimeClient } from './client.js'
import { findLoginFormFields } from './login-field-finder.js'
import { disableVision, enableVision } from './vision-gate.js'
import { siteLoginConnectUrlFor } from './site-login-link.js'
import { getSiteProfile } from '../browser-sites/registry.js'
import { getSiteCredential, getSiteCredentialSecret } from '../store/site-credentials-store.js'
import { resolvePublishedOutputPath } from '../sandbox.js'
import type { PublishedOutput } from '../outputs.js'

function loginUrlFor(domain: string): string {
  return getSiteProfile(domain)?.loginUrl ?? `https://${domain}/login`
}

async function publishScreenshot(
  sandbox: DockerSandbox,
  published: PublishedOutput[],
  client: BrowserRuntimeClient,
  clientId: string,
  fileName: string,
  caption: string,
): Promise<void> {
  const { imageBase64 } = await client.screenshot(clientId)
  const bytes = Buffer.from(imageBase64, 'base64')
  const outputPath = resolvePublishedOutputPath(`outputs/${fileName}`)
  await sandbox.writeFile(outputPath, bytes)
  const item: PublishedOutput = { path: outputPath, fileName, mimeType: 'image/png', caption, size: bytes.length }
  const existing = published.findIndex((candidate) => candidate.path === outputPath)
  if (existing >= 0) published[existing] = item
  else published.push(item)
}

export function createBrowserLoginTools(
  clientId: string,
  jid: string,
  sandbox: DockerSandbox,
  published: PublishedOutput[],
  client: BrowserRuntimeClient = createBrowserRuntimeClient(),
): ReturnType<typeof tool>[] {
  return [
    tool({
      name: 'browser_login',
      description:
        "Logs into the client's own account on a website (e.g. LinkedIn, Instagram, Reddit) using credentials " +
        'the client already saved on the dashboard. If none are saved yet, returns a one-tap link for the client ' +
        'to add one. Never pass a username or password as arguments — this tool reads them from the vault directly.',
      inputSchema: {
        type: 'object',
        properties: { domain: { type: 'string', description: 'The site to log into, e.g. "linkedin.com"' } },
        required: ['domain'],
        additionalProperties: false,
      },
      callback: async (rawInput: unknown) => {
        const input = rawInput as { domain: string }
        const domain = input.domain.trim().toLowerCase()

        const credential = await getSiteCredential(clientId, domain)
        if (!credential) {
          const link = siteLoginConnectUrlFor(process.env.CALLBACK_BASE_URL ?? 'http://localhost:3000', jid, domain)
          return `I don't have a saved login for ${domain} yet. Tap this link to add one (about 20 seconds): ${link}`
        }

        await client.navigate(clientId, loginUrlFor(domain))
        await publishScreenshot(
          sandbox,
          published,
          client,
          clientId,
          `login-${domain.replace(/[^a-z0-9.-]/g, '-')}-before.png`,
          `Logging into ${domain} on your behalf — here's the page I'm connecting to.`,
        )

        disableVision(clientId)
        try {
          const { elements } = await client.elements(clientId)
          const fields = findLoginFormFields(elements)
          if (fields.usernameIndex === null || fields.passwordIndex === null) {
            throw new Error(`Could not find a recognizable login form on ${domain}'s login page.`)
          }
          const password = await getSiteCredentialSecret(clientId, domain)
          if (!password) throw new Error(`No saved password found for ${domain} — the credential may have been removed.`)

          await client.type(clientId, { index: fields.usernameIndex, text: credential.username })
          await client.type(clientId, { index: fields.passwordIndex, text: password })
          if (fields.submitIndex !== null) {
            await client.click(clientId, { index: fields.submitIndex })
          }
        } finally {
          enableVision(clientId)
        }

        await publishScreenshot(
          sandbox,
          published,
          client,
          clientId,
          `login-${domain.replace(/[^a-z0-9.-]/g, '-')}-after.png`,
          `You're in on ${domain}.`,
        )

        return `Logged into ${domain} as ${credential.username}.`
      },
    }),
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/browser/login-tools.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/browser/login-tools.ts src/browser/login-tools.test.ts
git commit -m "feat(browser): add browser_login tool with before/after screenshots and vision-gated credential entry"
```

---

### Task 7: `/connect-site` route (GET form, POST save)

**Files:**
- Create: `src/site-login-http.ts`
- Test: `src/site-login-http.test.ts`
- Modify: `src/callback-server.ts` (route dispatch)

**Interfaces:**
- Consumes: `verifySiteLoginToken` from Task 5 (`src/browser/site-login-link.js`), `saveSiteCredential` from Task 1 (`src/store/site-credentials-store.js`), `clientIdFromJid` from the existing `src/store/client-store.js`.
- Produces: `handleSiteLoginRoute(req, res, url): Promise<boolean>` — same `(req, res, url) => Promise<boolean>` shape as `handleAgentPermissionsApi`/`handleCrmApi`, but **not session-gated** — this route is reached via the signed `?c=` token from a WhatsApp-delivered link (same trust model as the onboarding link itself), not a logged-in dashboard session.

- [ ] **Step 1: Write the failing test**

Create `src/site-login-http.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { handleSiteLoginRoute } from './site-login-http.js'
import { siteLoginConnectUrlFor } from './browser/site-login-link.js'
import { getSiteCredential } from './store/site-credentials-store.js'

async function withServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler)
  server.listen(0)
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

test('GET renders a form when the token is valid', async () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  const link = siteLoginConnectUrlFor('http://irrelevant', '972501234567@s.whatsapp.net', 'linkedin.com')
  const path = link.replace(/^https?:\/\/[^/]+/, '')
  const { url, close } = await withServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://internal')
    const handled = await handleSiteLoginRoute(req, res, parsed)
    if (!handled) res.writeHead(404).end()
  })
  const res = await fetch(`${url}${path}`)
  const body = await res.text()
  assert.equal(res.status, 200)
  assert.match(body, /linkedin\.com/)
  assert.match(body, /form/i)
  await close()
})

test('GET rejects an invalid token', async () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  const { url, close } = await withServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://internal')
    const handled = await handleSiteLoginRoute(req, res, parsed)
    if (!handled) res.writeHead(404).end()
  })
  const res = await fetch(`${url}/connect-site?c=not-a-real-token&domain=linkedin.com`)
  assert.equal(res.status, 400)
  await close()
})

test('POST saves the credential and returns success', async () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  process.env.AGENT_MASTER_KEY = 'd'.repeat(32)
  process.env.AGENT_STORE_DIR = '/tmp/ahrness-site-login-http-test'
  const link = siteLoginConnectUrlFor('http://irrelevant', '972501234568@s.whatsapp.net', 'reddit.com')
  const path = link.replace(/^https?:\/\/[^/]+/, '')
  const { url, close } = await withServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://internal')
    const handled = await handleSiteLoginRoute(req, res, parsed)
    if (!handled) res.writeHead(404).end()
  })
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'hunter2' }),
  })
  assert.equal(res.status, 200)

  const { clientIdFromJid } = await import('./store/client-store.js')
  const clientId = clientIdFromJid('972501234568@s.whatsapp.net')
  const saved = await getSiteCredential(clientId, 'reddit.com')
  assert.equal(saved?.username, 'alice')
  await close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/site-login-http.test.ts`
Expected: FAIL with "Cannot find module './site-login-http.js'"

- [ ] **Step 3: Write the implementation**

Create `src/site-login-http.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import { verifySiteLoginToken } from './browser/site-login-link.js'
import { saveSiteCredential } from './store/site-credentials-store.js'
import { clientIdFromJid } from './store/client-store.js'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string)
}

function formPage(domain: string): string {
  return (
    '<html><body style="font-family:sans-serif;max-width:420px;margin:60px auto;padding:0 16px">' +
    `<h2>Connect your ${escapeHtml(domain)} login</h2>` +
    '<p>Your agent will use this only to log into this one site on your behalf. It is stored encrypted and never shown in your WhatsApp chat.</p>' +
    '<form method="POST">' +
    '<p><label>Username or email<br><input name="username" type="text" required style="width:100%;padding:8px"></label></p>' +
    '<p><label>Password<br><input name="password" type="password" required style="width:100%;padding:8px"></label></p>' +
    '<button type="submit" style="padding:10px 20px">Save</button>' +
    '</form></body></html>'
  )
}

function successPage(domain: string): string {
  return (
    '<html><body style="font-family:sans-serif;text-align:center;padding:60px">' +
    `<h2>✅ Connected!</h2><p>Your ${escapeHtml(domain)} login was saved. You can close this tab.</p>` +
    '</body></html>'
  )
}

/**
 * GET/POST /connect-site?c=<signed-jid-token>&domain=<domain> — reached via a
 * WhatsApp-delivered link (same trust model as the onboarding link), never a
 * logged-in dashboard session. Only place a site-login credential is ever written.
 */
export async function handleSiteLoginRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/connect-site') return false

  const token = url.searchParams.get('c') ?? ''
  const domain = (url.searchParams.get('domain') ?? '').trim().toLowerCase()
  const jid = verifySiteLoginToken(token)

  if (!jid || !domain) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end('<p>This link is invalid or has expired.</p>')
    return true
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(formPage(domain))
    return true
  }

  if (req.method === 'POST') {
    const raw = await readBody(req)
    let parsed: { username?: unknown; password?: unknown }
    const contentType = req.headers['content-type'] ?? ''
    if (contentType.includes('application/json')) {
      try {
        parsed = JSON.parse(raw || '{}')
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end('<p>Invalid submission.</p>')
        return true
      }
    } else {
      const form = new URLSearchParams(raw)
      parsed = { username: form.get('username') ?? undefined, password: form.get('password') ?? undefined }
    }
    if (typeof parsed.username !== 'string' || !parsed.username.trim() || typeof parsed.password !== 'string' || !parsed.password) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end('<p>Username and password are both required.</p>')
      return true
    }
    const clientId = clientIdFromJid(jid)
    await saveSiteCredential(clientId, domain, parsed.username.trim(), parsed.password)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(successPage(domain))
    return true
  }

  res.writeHead(405, { 'Content-Type': 'text/html; charset=utf-8' }).end('<p>Method not allowed.</p>')
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/site-login-http.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Wire the route into `callback-server.ts`**

Add the import near the other route-handler imports:

```ts
import { handleSiteLoginRoute } from './site-login-http.js'
```

Add the dispatch, near the other standalone (non-session-gated) routes such as `/onboarding` (read the file first to find its actual current location — it should sit alongside other unauthenticated, token-verified routes, not inside the `getSession(req)`-gated block the CRM/agent-permissions routes use):

```ts
    // ── Site login connect (signed-link, no dashboard session required) ─────
    if (await handleSiteLoginRoute(req, res, url)) return
```

- [ ] **Step 6: Type-check and full test suite**

Run: `npm run type-check`
Expected: no errors.

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/site-login-http.ts src/site-login-http.test.ts src/callback-server.ts
git commit -m "feat(browser): add /connect-site signed-link route for saving site logins"
```

---

### Task 8: Dashboard quick-connect links for curated sites

**Files:**
- Modify: `src/dashboard.ts` (`DashboardState` interface, `renderDashboardPage`)
- Modify: `src/callback-server.ts` (the `renderDashboardPage(session.user, {...})` call)

**Interfaces:**
- Consumes: `getAllSiteProfiles` from Task 2 (`src/browser-sites/registry.js`), `siteLoginConnectUrlFor` from Task 5 (`src/browser/site-login-link.js`).
- Produces: a new `siteLoginLinks: Array<{ displayName: string; url: string }>` field on `DashboardState`, rendered as a small panel of quick-connect links.

- [ ] **Step 1: Add the field to `DashboardState`**

In `src/dashboard.ts`, add to the `DashboardState` interface (in the same block Plan A added `webBrowsingEnabled` to):

```ts
  siteLoginLinks: Array<{ displayName: string; url: string }>
```

- [ ] **Step 2: Compute the links in `callback-server.ts`**

In the same dashboard-rendering handler where `webBrowsingEnabled: !!clientMeta.webBrowsingEnabled` was added in Plan A, add the import:

```ts
import { getAllSiteProfiles } from './browser-sites/registry.js'
import { siteLoginConnectUrlFor } from './browser/site-login-link.js'
```

Then, right before the `renderDashboardPage(session.user, {...})` call, compute the links (only when a WhatsApp JID is known — matches the same precondition the Telegram/Slack connect links already use):

```ts
      const siteLoginLinks = tenantRow?.whatsappJid
        ? getAllSiteProfiles().map((profile) => ({
            displayName: profile.displayName,
            url: siteLoginConnectUrlFor(process.env.CALLBACK_BASE_URL ?? 'http://localhost:3000', tenantRow.whatsappJid!, profile.domain),
          }))
        : []
```

Add `siteLoginLinks,` to the `renderDashboardPage(session.user, { ... })` object literal.

- [ ] **Step 3: Render the panel**

In `src/dashboard.ts`'s `renderDashboardPage`, immediately after the "Agent permissions" panel Plan A added (the one with `id="permissionsTitle"`), add a sibling section:

```ts
  const siteLoginLinksHtml = state.siteLoginLinks
    .map((link) => `<a class="btn btn-secondary" href="${link.url}" target="_blank" rel="noopener">Connect ${escapeHtml(link.displayName)}</a>`)
    .join(' ')
```

(add this `const` near the other derived values earlier in the function), then the markup:

```html
<section class="panel" aria-labelledby="siteLoginsTitle"><div class="panel-header"><div><h2 id="siteLoginsTitle">Website logins</h2><p class="panel-kicker">Let your agent log into sites you don't have an app connection for.</p></div></div><div style="display:flex;gap:8px;flex-wrap:wrap">${siteLoginLinksHtml || '<p>No WhatsApp number linked yet — connect WhatsApp first.</p>'}</div></section>
```

- [ ] **Step 4: Type-check and full test suite**

Run: `npm run type-check`
Expected: no errors (may need to add `siteLoginLinks: []` to any existing `dashboardState()` test fixture in `src/dashboard.test.ts`, same as Plan A's Task 9 needed for `webBrowsingEnabled` — check that file first).

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.ts src/callback-server.ts src/dashboard.test.ts
git commit -m "feat(browser): add dashboard quick-connect links for curated site logins"
```

---

### Task 9: Wire `createBrowserLoginTools` into `buildClientAgent`

**Files:**
- Modify: `src/agent.ts`

**Interfaces:**
- Consumes: `createBrowserLoginTools` from Task 6 (`./browser/login-tools.js`).

- [ ] **Step 1: Add the import**

Alongside the existing `createBrowserTools` import (added by Plan A), add:

```ts
import { createBrowserLoginTools } from './browser/login-tools.js'
```

- [ ] **Step 2: Push the login tools inside the same opt-in block**

Find the block Plan A added:

```ts
  let browserTools: ReturnType<typeof createBrowserTools> = []
  if (clientMeta.webBrowsingEnabled) {
    try {
      await ensureBrowserRuntime()
      browserTools = createBrowserTools(clientId)
    } catch (err) {
      console.warn('[browser] browser-runtime unavailable:', err instanceof Error ? err.message : err)
    }
  }
```

Change it to also build the login tools (same gate, same try/catch, same fail-soft guarantee — `sandbox` and `publishedOutputs` are already in scope at this point in `buildClientAgent`, from the existing lines `const { sandbox } = await getClientSandbox(clientId)` and `const publishedOutputs: PublishedOutput[] = []`):

```ts
  let browserTools: ReturnType<typeof createBrowserTools> = []
  if (clientMeta.webBrowsingEnabled) {
    try {
      await ensureBrowserRuntime()
      browserTools = [
        ...createBrowserTools(clientId),
        ...createBrowserLoginTools(clientId, jid, sandbox, publishedOutputs),
      ]
    } catch (err) {
      console.warn('[browser] browser-runtime unavailable:', err instanceof Error ? err.message : err)
    }
  }
```

No other change needed — `...browserTools,` is already spread into `allTools.push(...)` by Plan A.

- [ ] **Step 3: Type-check and full test suite**

Run: `npm run type-check`
Expected: no errors.

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/agent.ts
git commit -m "feat(browser): wire browser_login into buildClientAgent alongside the core browser tools"
```

---

### Task 10: Docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `ARCHITECTURE.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add a table row to `AGENTS.md`**

In the "Where things live" table, add:

```markdown
| Add a curated site-login profile | `src/browser-sites/registry.ts` |
```

- [ ] **Step 2: Extend the "Browser Tool" section of `ARCHITECTURE.md`**

Find the "## Browser Tool" section Plan A added (it ends with a paragraph starting "Credential-based login to specific sites is a separate follow-on capability..."). Replace that closing paragraph with:

```markdown
Credential-based login is now built: `browser_login({ domain })` resolves a
per-client, per-domain credential from an encrypted vault
(`store/clients/<clientId>/site-credentials.json`, AES-256-GCM via the
existing `vault.ts`) that is **only ever written from a signed-link web
form** (`/connect-site`, reached the same way onboarding links already work
— never from the agent or a WhatsApp message, making it structurally
impossible for a password to reach the model or chat history). A curated
registry (`src/browser-sites/registry.ts`) gives LinkedIn/Instagram/
Facebook/Reddit a known login URL; other domains fall back to a best-effort
`https://<domain>/login` guess. Login-field detection reuses the same
auto-indexed element list `browser_view_elements` already builds
(`src/browser/login-field-finder.ts`), not raw CSS selectors. The login
sequence screenshots the empty login form and delivers it to the client
before typing anything (transparency/credibility, and a phishing sanity
check), disables `browser_screenshot` for the client for the duration of
credential entry (`src/browser/vision-gate.ts`), and re-enables it
afterward — always, even if the flow throws partway through.
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md ARCHITECTURE.md
git commit -m "docs(browser): register the credential-login subsystem in AGENTS.md and ARCHITECTURE.md"
```

---

## Definition of done for this plan

- [ ] `npm run type-check` passes.
- [ ] `npm test` passes.
- [ ] A client can tap a dashboard quick-connect link (or an agent-sent ad-hoc link) and save a site login without it ever appearing in a WhatsApp message or the agent's context.
- [ ] `browser_login({domain})` with no saved credential returns a connect-link instead of failing.
- [ ] `browser_login({domain})` with a saved credential: navigates, publishes a before-screenshot through the existing sandbox/delivery pipeline, disables `browser_screenshot` for the exact duration of credential entry, and re-enables it afterward — including when the flow throws partway through.
- [ ] The password is never present in any tool result, log line, or test assertion beyond the one function (`getSiteCredentialSecret`) that reads it to type it into a page.
