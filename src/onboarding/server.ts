import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { parse as parseUrl } from 'node:url'
import { parse as parseQs } from 'node:querystring'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { ensureWhatsAppConnectCode, getOrCreateSession, loadSession, saveSession } from './session.js'
import { getAllRoles } from '../roles/index.js'
import { getAllMcps } from '../mcps/index.js'
import type { McpDefinition } from '../mcps/types.js'
import { oauthStateFor, verifyClientToken } from './client-link.js'
import { getTemplatesForRole } from '../scheduler/index.js'
import {
  saveProfile,
  saveRole,
  getRole as getClientRole,
  upsertConnection,
  clientIdFromJid,
  updateClientMeta,
  getClientMeta,
} from '../store/client-store.js'
import type { ClientProfile, GoalType, PlatformId, RoleId, OnboardingSession } from '../store/types.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTwilioProvider, twilioBusinessNumberDigits } from '../twilio-whatsapp.js'
import { clientIdForJid } from '../tenant-store.js'
import {
  defaultWhatsAppProvider,
  configuredWhatsAppProviders,
  isBaileysProvider,
  isWhatsAppProvider,
  type WhatsAppProvider,
} from '../whatsapp-providers.js'
import { baileysSessionManager } from '../baileys-manager.js'
import { deriveOnboardingProgress, type OnboardingProgress } from './progress.js'
import { currentPreview, generatePreview, profileFingerprint, registerPreviewAttempt } from './preview.js'
import {
  isActivationEventName,
  recordActivationEvent,
  sanitizeActivationProperties,
} from './activation-events.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIEWS_DIR = path.join(__dirname, 'views')
const FRONTEND_DIST_DIR = path.resolve('dist/onboarding')

function activationV2Enabled(sessionId: string): boolean {
  if (process.env.ONBOARDING_ACTIVATION_V2 !== 'true') return false
  const configured = Number.parseInt(process.env.ONBOARDING_ACTIVATION_V2_PERCENT ?? '0', 10)
  const percentage = Number.isFinite(configured) ? Math.max(0, Math.min(configured, 100)) : 0
  const bucket = Number.parseInt(createHash('sha256').update(sessionId).digest('hex').slice(0, 8), 16) % 100
  return bucket < percentage
}

// SSE clients waiting for QR updates
const qrSseClients = new Map<string, ServerResponse>()
// QR data per session
const qrData = new Map<string, string>()
let latestQrDataUri: string | null = null
// Sessions that have completed WhatsApp linking
const linkedSessions = new Set<string>()

// ── Called by whatsapp.ts when QR changes ─────────────────────────────────────

export async function broadcastQr(sessionId: string, qrText: string): Promise<void> {
  // Encode the raw Baileys QR string into a scannable PNG data URI.
  // 464px source renders crisply at the 232px display size on retina screens.
  const dataUri = await qrDataUri(qrText)
  if (!dataUri) return
  latestQrDataUri = dataUri
  qrData.set(sessionId, dataUri)
  const client = qrSseClients.get(sessionId)
  if (client && !client.destroyed) {
    client.write(`data: ${JSON.stringify({ type: 'qr', qr: dataUri })}\n\n`)
  }
}

export async function broadcastQrToAll(qrText: string): Promise<void> {
  const dataUri = await qrDataUri(qrText)
  if (!dataUri) return
  latestQrDataUri = dataUri
  for (const [sessionId, client] of qrSseClients.entries()) {
    qrData.set(sessionId, dataUri)
    if (!client.destroyed) client.write(`data: ${JSON.stringify({ type: 'qr', qr: dataUri })}\n\n`)
  }
}

async function qrDataUri(qrText: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(qrText, { margin: 1, width: 464, errorCorrectionLevel: 'M' })
  } catch (err) {
    console.error('[onboarding] QR encode failed:', err)
    return null
  }
}

export function broadcastLinked(jid: string, sessionId: string): void {
  linkedSessions.add(sessionId)
  const client = qrSseClients.get(sessionId)
  if (client && !client.destroyed) {
    client.write(`data: ${JSON.stringify({ type: 'linked', jid })}\n\n`)
    client.end()
    qrSseClients.delete(sessionId)
  }
}

export function broadcastLinkedToAll(jid: string): void {
  for (const [sessionId, client] of qrSseClients.entries()) {
    linkedSessions.add(sessionId)
    if (!client.destroyed) {
      client.write(`data: ${JSON.stringify({ type: 'linked', jid })}\n\n`)
      client.end()
    }
  }
  qrSseClients.clear()
}

/**
 * Push a "logged out / scan again" event so the QR screen flips back to a
 * re-link state. The linked session marker is cleared so this client can link
 * again; the next socket start (fresh auth dir) will emit a new QR which the
 * existing qr-stream connection then delivers.
 */
export function broadcastLoggedOut(sessionId: string): void {
  linkedSessions.delete(sessionId)
  qrData.delete(sessionId)
  latestQrDataUri = null
  const client = qrSseClients.get(sessionId)
  if (client && !client.destroyed) {
    client.write(`data: ${JSON.stringify({ type: 'loggedOut' })}\n\n`)
  }
}

export function broadcastLoggedOutToAll(): void {
  linkedSessions.clear()
  qrData.clear()
  latestQrDataUri = null
  for (const [, client] of qrSseClients.entries()) {
    if (!client.destroyed) client.write(`data: ${JSON.stringify({ type: 'loggedOut' })}\n\n`)
  }
}

// ── HTML rendering ─────────────────────────────────────────────────────────────

async function layout(title: string, content: string): Promise<string> {
  const template = await readFile(path.join(VIEWS_DIR, 'layout.html'), 'utf-8')
  const agentName = process.env.AGENT_NAME ?? 'BizzClaw'
  return template
    .replace(/{{TITLE}}/g, title)
    .replace(/{{AGENT_NAME}}/g, agentName)
    .replace('{{CONTENT}}', content)
}

const STEP_LABELS = ['Profile', 'Role', 'Automations', 'Connect', 'Link', 'Live']

function stepDots(current: number): string {
  const items = STEP_LABELS.map((label, i) => {
    const n = i + 1
    const state = n < current ? 'done' : n === current ? 'active' : ''
    const num = String(n).padStart(2, '0')
    const aria = n === current ? ' aria-current="step"' : ''
    return `<li class="${state}"${aria}><span class="sr-num">${state === 'done' ? '✓' : num}</span><span class="sr-label">${label}</span></li>`
  }).join('')
  return `<nav class="steprail" aria-label="Onboarding progress"><ol>${items}</ol></nav>`
}

function eyebrow(step: number, label: string): string {
  return `<div class="eyebrow">Step ${String(step).padStart(2, '0')} / ${label}</div>`
}

function html(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(body)
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function redirect(res: ServerResponse, url: string): void {
  res.writeHead(302, { Location: url })
  res.end()
}

function notFound(res: ServerResponse): void {
  res.writeHead(404).end('Not found')
}

// ── Body parsing ───────────────────────────────────────────────────────────────

function parseBody(req: IncomingMessage): Promise<Record<string, string | string[]>> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(parseQs(body) as Record<string, string | string[]>))
  })
}

function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      if (!body.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body) as Record<string, unknown>)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? ''
}

function arr(v: string | string[] | undefined): string[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

function jsonString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function jsonStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((item): item is string => typeof item === 'string')
}

// ── Session cookie helper ──────────────────────────────────────────────────────

function getSessionId(req: IncomingMessage): string | undefined {
  const cookie = req.headers.cookie ?? ''
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/)
  return match?.[1]
}

function setSessionCookie(res: ServerResponse, sessionId: string): void {
  res.setHeader('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`)
}

// ── Step renderers ─────────────────────────────────────────────────────────────

async function renderStep1(_session: OnboardingSession): Promise<string> {
  const s = _session
  const biz = (s.profile as ClientProfile | undefined)?.business
  const assets = (s.profile as ClientProfile | undefined)?.assets
  return layout('Business Profile', `
    ${stepDots(1)}
    <div class="card">
      ${eyebrow(1, 'Business Profile')}
      <h1>Give BizzClaw a little context</h1>
      <p class="subtitle">A few words and public links are enough. Your agent will use them to understand your business, audience, and content style.</p>
      <form method="POST" action="/onboarding/step/1">
        <div class="field">
          <label for="name">Business or project name</label>
          <input type="text" id="name" name="name" value="${biz?.name ?? ''}" placeholder="BizzClaw" />
        </div>
        <input type="hidden" name="industry" value="${biz?.industry ?? 'other'}" />
        <div class="field">
          <label for="description">What should your agent know?</label>
          <textarea id="description" name="description" required placeholder="We help small business owners get more customers from WhatsApp, ads, and social content. Our audience is non-technical founders who want an AI employee.">${biz?.description ?? ''}</textarea>
        </div>
        <div class="field">
          <label for="targetAudience">Audience or content area</label>
          <input type="text" id="targetAudience" name="targetAudience" value="${biz?.targetAudience ?? ''}" placeholder="Startup founders, local business owners, agency clients" />
        </div>
        <div class="field">
          <label>Public links the agent can learn from</label>
          <div class="field-row">
            <div class="field">
              <label for="website">Website</label>
              <input type="url" id="website" name="website" value="${assets?.website ?? ''}" placeholder="https://yoursite.com" />
            </div>
            <div class="field">
              <label for="instagram">Instagram</label>
              <input type="text" id="instagram" name="instagram" value="${assets?.instagram?.handle ?? ''}" placeholder="@yourhandle" />
            </div>
          </div>
          <div class="field">
            <label for="tiktok">TikTok</label>
            <input type="text" id="tiktok" name="tiktok" value="${assets?.tiktok?.handle ?? ''}" placeholder="@yourhandle" />
          </div>
        </div>
        <input type="hidden" name="brandVoice" value="${biz?.brandVoice ?? ''}" />
        <input type="hidden" name="goals" value="${biz?.goals?.[0] ?? 'brand_awareness'}" />
        <div class="actions">
          <span></span>
          <button type="submit" class="btn btn-primary">Continue →</button>
        </div>
      </form>
    </div>
  `)
}

async function renderStep2(session: OnboardingSession): Promise<string> {
  const roles = getAllRoles()
  const mcpName = new Map(getAllMcps().map((m) => [m.id, m.displayName]))
  return layout('Choose Your Role', `
    ${stepDots(2)}
    <div class="card">
      ${eyebrow(2, 'Role')}
      <h1>Commission your specialist</h1>
      <p class="subtitle">One specialist runs your WhatsApp number. Pick the focus that fits — you can reassign anytime.</p>
      <form method="POST" action="/onboarding/step/2">
        <div class="role-cards">
          ${roles.map((r) => {
            const tools = [
              ...r.requiredMcps.map((id) => ({ id, core: true })),
              ...r.optionalMcps.map((id) => ({ id, core: false })),
            ]
            const chips = tools
              .map((t) => `<span class="chip ${t.core ? 'chip-core' : ''}">${mcpName.get(t.id) ?? t.id}</span>`)
              .join('')
            return `
            <label class="role-card">
              <input type="radio" name="roleId" value="${r.id}" ${session.roleId === r.id ? 'checked' : ''} required />
              <span class="role-mono" aria-hidden="true">${r.emoji}</span>
              <div class="role-info">
                <div class="role-top">
                  <h3>${r.displayName}</h3>
                  <span class="role-tag">Assigned</span>
                </div>
                <p>${r.description}</p>
                ${chips ? `<div class="role-chips">${chips}</div>` : ''}
              </div>
            </label>
          `}).join('')}
        </div>
        <div class="actions">
          <a href="/onboarding/step/1" class="btn btn-secondary">← Back</a>
          <button type="submit" class="btn btn-primary">Continue →</button>
        </div>
      </form>
    </div>
  `)
}

async function renderStep3(session: OnboardingSession): Promise<string> {
  const role = getAllRoles().find((r) => r.id === session.roleId)
  if (!role) return redirect_str('/onboarding/step/2')

  const templates = session.roleId ? getTemplatesForRole(session.roleId) : []
  // Pre-check: reflect a prior selection, otherwise default every automation ON.
  const clientId = session.clientId ?? session.sessionId
  const saved = await getClientRole(clientId)
  const selected = new Set(saved?.scheduleTemplates ?? templates.map((t) => t.id))

  const cards = templates.length
    ? templates
        .map(
          (t) => `
          <label class="role-card">
            <input type="checkbox" name="templates" value="${t.id}" ${selected.has(t.id) ? 'checked' : ''} />
            <span class="role-mono" aria-hidden="true">${t.emoji}</span>
            <div class="role-info">
              <div class="role-top">
                <h3>${t.title}</h3>
                <span class="role-tag">${t.cadence}</span>
              </div>
              <p>${t.description}</p>
            </div>
          </label>`,
        )
        .join('')
    : `<p class="subtitle">No prebuilt automations for this role yet — you can still ask your agent to schedule reminders and reports anytime on WhatsApp.</p>`

  return layout('Automations', `
    ${stepDots(3)}
    <div class="card">
      ${eyebrow(3, 'Automations')}
      <h1>Put ${role.displayName} on a schedule</h1>
      <p class="subtitle">Your agent can run these on its own and message you the results — no need to ask. Switch on what's useful; you can change these anytime in chat.</p>
      <form method="POST" action="/onboarding/step/3">
        <div class="role-cards">
          ${cards}
        </div>
        <div class="actions">
          <a href="/onboarding/step/2" class="btn btn-secondary">← Back</a>
          <button type="submit" class="btn btn-primary">Continue →</button>
        </div>
      </form>
    </div>
  `)
}

async function renderStep4(session: OnboardingSession): Promise<string> {
  const roles = getAllRoles()
  const role = roles.find((r) => r.id === session.roleId)
  if (!role) return redirect_str('/onboarding/step/2')

  const allPlatforms = getAllMcps()
  const relevantPlatforms = allPlatforms.filter(
    (p) => role.requiredMcps.includes(p.id) || role.optionalMcps.includes(p.id),
  )

  const callbackBase = process.env.CALLBACK_BASE_URL ?? 'http://localhost:3000'
  // OAuth state binds the token exchange to this client: a signed JID when we have
  // one (verified in the callback), else the session id as a CSRF token.
  const oauthState = oauthStateFor(session)

  return layout('Connect Platforms', `
    ${stepDots(4)}
    <div class="card">
      ${eyebrow(4, 'Connect')}
      <h1>Connect your platforms</h1>
      <p class="subtitle">Link the services your ${role.displayName} needs. Required platforms must be connected to continue.</p>
      <div class="platform-list" id="platformList">
        ${relevantPlatforms.map((p) => {
          const status = session.connections[p.id] ?? 'pending'
          const isConnected = status === 'connected'
          const isRequired = role.requiredMcps.includes(p.id)
          const iconMap: Record<string, string> = {
            'meta-ads': '📘', 'instagram-graph': '📸', 'tiktok': '🎵', 'google': '📊', 'higgsfield': '🎨',
          }
          const authUrl = p.authUrl ? safeAuthUrl(p, oauthState, callbackBase) : '#'
          return `
            <div class="platform-row ${isConnected ? 'connected' : ''}" id="platform-${p.id}">
              <div class="platform-info">
                <span class="platform-icon">${iconMap[p.id] ?? '🔌'}</span>
                <div>
                  <div class="platform-name">${p.displayName}
                    <span class="badge ${isRequired ? 'badge-required' : 'badge-optional'}">${isRequired ? 'Required' : 'Optional'}</span>
                    ${isConnected ? '<span class="badge badge-connected">Connected ✓</span>' : ''}
                  </div>
                  <div class="platform-desc">${p.scopes.join(', ')}</div>
                </div>
              </div>
              ${p.oauthFlow !== 'none'
                ? `<a href="${authUrl}" class="btn btn-outline ${isConnected ? 'connected' : ''}" id="connect-${p.id}">${isConnected ? 'Reconnect' : 'Connect'}</a>`
                : '<span class="badge badge-connected">Auto</span>'}
            </div>`
        }).join('')}
      </div>
      <div class="actions">
        <a href="/onboarding/step/3" class="btn btn-secondary">← Back</a>
        <a href="/onboarding/step/5" class="btn btn-primary" id="continueBtn">Continue →</a>
      </div>
    </div>
    <script>
      // Poll for connection status updates
      const poll = () => fetch('/onboarding/status?session=${session.sessionId}')
        .then(r => r.json())
        .then(data => {
          for (const [pid, status] of Object.entries(data.connections || {})) {
            const row = document.getElementById('platform-' + pid)
            const btn = document.getElementById('connect-' + pid)
            if (status === 'connected' && row && !row.classList.contains('connected')) {
              row.classList.add('connected')
              if (btn) { btn.textContent = 'Reconnect'; btn.classList.add('connected'); }
              // add connected badge
              const nameEl = row.querySelector('.platform-name')
              if (nameEl && !nameEl.querySelector('.badge-connected')) {
                nameEl.insertAdjacentHTML('beforeend', '<span class="badge badge-connected">Connected ✓</span>')
              }
            }
          }
        })
        .catch(() => {})
      setInterval(poll, 3000)
    </script>
  `)
}

function redirect_str(url: string): string {
  return `<script>location.href='${url}'</script>`
}

async function renderStep5(session: OnboardingSession): Promise<string> {
  const providers = configuredWhatsAppProviders()
  // No default — the user picks a method. Don't auto-jump to Twilio.
  const selectedProvider = session.whatsappProvider ?? null
  // Always offer both providers so a client on a Twilio-mode server can still
  // choose Baileys (BYO number / QR). The per-client Baileys socket works
  // regardless of the global WHATSAPP_PROVIDER env.
  const twilioAvailable = isTwilioProvider()
  const providerPicker = `
    <form method="POST" action="/onboarding/step/5" class="provider-picker">
      <div class="role-cards">
        <label class="role-card">
          <input type="radio" name="whatsappProvider" value="twilio" ${selectedProvider === 'twilio' ? 'checked' : ''} ${!twilioAvailable ? 'disabled' : ''} />
          <span class="role-mono" aria-hidden="true">✓</span>
          <div class="role-info">
            <div class="role-top">
              <h3>Verified API</h3>
              <span class="role-tag">Twilio</span>
            </div>
            <p>${twilioAvailable ? 'Use the WhatsApp Business API through our verified Twilio number.' : 'Twilio is not configured on this server.'}</p>
          </div>
        </label>
        <label class="role-card">
          <input type="radio" name="whatsappProvider" value="baileys" ${selectedProvider === 'baileys' ? 'checked' : ''} />
          <span class="role-mono" aria-hidden="true">⌁</span>
          <div class="role-info">
            <div class="role-top">
              <h3>Linked device</h3>
              <span class="role-tag">Baileys</span>
            </div>
            <p>Connect your own WhatsApp number as a linked device (scan a QR code or use a pairing code).</p>
          </div>
        </label>
      </div>
      <div class="actions provider-actions">
        <span></span>
        <button type="submit" class="btn btn-secondary">Use selected method</button>
      </div>
    </form>
  `

  if (selectedProvider === 'twilio' && isTwilioProvider()) {
    const digits = twilioBusinessNumberDigits()
    const code = session.whatsappJid ? null : await ensureWhatsAppConnectCode(session)
    const text = code ? `connect ${code}` : 'Hi'
    const waLink = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : '#'
    return layout('Connect on WhatsApp', `
      ${stepDots(5)}
      <div class="card">
        ${eyebrow(5, 'WhatsApp')}
        <h1>Choose how WhatsApp connects</h1>
        <p class="subtitle">Use our number, or host the agent in a 1:1 group with your own number.</p>
        ${providerPicker}
        <div class="connect-panel">
          <h2>Use our number</h2>
          <p class="subtitle">Your agent runs on our WhatsApp Business number: <strong>+${digits || 'not configured'}</strong>.</p>
        ${digits ? `
          <a href="${waLink}" class="whatsapp-cta" style="justify-content:center;margin:1.5rem 0;">
            <span aria-hidden="true">↗</span>
            <span>Open WhatsApp</span>
          </a>
          ${code ? `
            <p class="qr-hint">Send this prefilled message to link setup: <strong>${code}</strong></p>
            <p class="qr-hint" id="linkStatus">Waiting for your WhatsApp message…</p>
          ` : '<p class="qr-hint">You opened setup from WhatsApp, so this session is already linked.</p>'}
        ` : '<p class="qr-hint">TWILIO_WHATSAPP_NUMBER is not configured on the server.</p>'}
        </div>
        <div class="actions" style="margin-top:1.5rem;justify-content:center;">
          <a href="/onboarding/step/4" class="btn btn-secondary">← Back</a>
          <a href="/onboarding/step/6" class="btn btn-primary">Continue →</a>
        </div>
      </div>
      ${code ? `
      <script>
        const pollLink = () => fetch('/onboarding/status?session=${session.sessionId}')
          .then(r => r.json())
          .then(data => {
            if (data.whatsappLinked) {
              const el = document.getElementById('linkStatus')
              if (el) el.textContent = 'Connected. Redirecting…'
              setTimeout(() => { location.href = '/onboarding/step/6' }, 800)
            }
          })
          .catch(() => {})
        setInterval(pollLink, 2500)
      </script>` : ''}
    `)
  }

  // No provider selected yet — prompt the user to pick. Don't auto-jump.
  if (!selectedProvider) {
    return layout('Connect on WhatsApp', `
      ${stepDots(5)}
      <div class="card">
        ${eyebrow(5, 'WhatsApp')}
        <h1>Choose how WhatsApp connects</h1>
        <p class="subtitle">Use our number, or host the agent in a 1:1 group with your own number.</p>
        ${providerPicker}
        <div class="connect-panel">
          <p class="qr-hint" style="text-align:center;">Pick a method above to continue.</p>
        </div>
        <div class="actions" style="margin-top:1.5rem;justify-content:center;">
          <a href="/onboarding/step/4" class="btn btn-secondary">← Back</a>
        </div>
      </div>
    `)
  }

  // Baileys (BYO number) is always available per-client, regardless of the
  // global WHATSAPP_PROVIDER env. The QR-stream endpoint starts this client's
  // own socket on demand. No auto-redirect to Twilio.

  return layout('Link WhatsApp', `
    ${stepDots(5)}
    <div class="card">
      ${eyebrow(5, 'Link WhatsApp')}
      <h1>Choose how WhatsApp connects</h1>
      <p class="subtitle">Use our number, or host the agent in a 1:1 group with your own number.</p>
      ${providerPicker}
      <div class="connect-panel">
      <h2>Host in your 1:1 group</h2>
      <p class="subtitle">On your phone, open WhatsApp → Linked Devices → Link a Device → scan this code.</p>
      <div class="qr-box">
        <div id="qrDisplay">
          <div class="spinner" id="qrSpinner"></div>
        </div>
        <p class="qr-hint" id="qrHint">Waiting for QR code…</p>
      </div>
      </div>
      <div class="connect-panel" id="groupPanel" style="display:none;">
        <h2>Pick the agent's group</h2>
        <p class="subtitle">The agent will only listen and reply in the one group you choose. Add your number to the group first, then it appears below.</p>
        <div id="groupList" style="margin:1rem 0;text-align:left;"></div>
        <p class="qr-hint" id="groupStatus"></p>
        <div class="actions" style="margin-top:1rem;">
          <button type="button" class="btn btn-secondary" id="refreshGroups">↻ Refresh groups</button>
          <button type="button" class="btn btn-primary" id="confirmGroup" disabled>Confirm group →</button>
        </div>
      </div>
      <div class="actions" style="margin-top:1.5rem;">
        <a href="/onboarding/step/4" class="btn btn-secondary">← Back</a>
        <span id="linkStatus"></span>
      </div>
    </div>
    <script>
      const sessionId = '${session.sessionId}'
      let selectedGroup = null
      const es = new EventSource('/onboarding/qr-stream?session=' + sessionId)

      async function loadGroups() {
        const status = document.getElementById('groupStatus')
        const list = document.getElementById('groupList')
        const confirmBtn = document.getElementById('confirmGroup')
        status.textContent = 'Loading your groups…'
        list.innerHTML = ''
        confirmBtn.disabled = true
        try {
          const r = await fetch('/api/onboarding/baileys-groups')
          const data = await r.json()
          if (!r.ok) { status.textContent = data.error || 'Could not load groups'; return }
          const groups = data.groups || []
          if (!groups.length) {
            status.textContent = 'No groups found. Add your WhatsApp number to a group, then tap Refresh.'
            return
          }
          status.textContent = 'Choose the one group the agent is allowed in.'
          list.innerHTML = groups.map(g =>
            '<label style="display:flex;align-items:center;gap:.6rem;padding:.55rem .75rem;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:.5rem;cursor:pointer;">' +
              '<input type="radio" name="homeGroup" value="' + g.jid + '">' +
              '<span style="font-weight:600;flex:1;">' + (g.subject || g.jid) + '</span>' +
              '<span style="color:#718096;font-size:.85rem;">' + g.size + ' members</span>' +
            '</label>').join('')
          list.querySelectorAll('input[name="homeGroup"]').forEach(inp => {
            inp.addEventListener('change', () => { selectedGroup = inp.value; confirmBtn.disabled = false })
          })
        } catch (err) {
          status.textContent = 'Could not load groups — tap Refresh to try again.'
        }
      }

      document.getElementById('refreshGroups').addEventListener('click', loadGroups)
      document.getElementById('confirmGroup').addEventListener('click', async () => {
        if (!selectedGroup) return
        const status = document.getElementById('groupStatus')
        status.textContent = 'Saving…'
        try {
          const r = await fetch('/api/onboarding/baileys-group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupJid: selectedGroup }),
          })
          const data = await r.json()
          if (!r.ok) { status.textContent = data.error || 'Could not save group'; return }
          status.innerHTML = '<span style="color:#276749;font-weight:700">✓ Group set! Redirecting…</span>'
          setTimeout(() => { location.href = '/onboarding/step/6' }, 1000)
        } catch (err) {
          status.textContent = 'Could not save group — try again.'
        }
      })

      es.onmessage = (e) => {
        const data = JSON.parse(e.data)
        if (data.type === 'qr') {
          document.getElementById('qrSpinner')?.remove()
          document.getElementById('qrHint').textContent = 'Scan with WhatsApp — the code refreshes automatically'
          const d = document.getElementById('qrDisplay')
          const img = d.querySelector('img') || document.createElement('img')
          img.src = data.qr
          img.alt = 'WhatsApp linking QR code'
          img.width = 232
          img.height = 232
          if (!img.parentNode) { d.innerHTML = ''; d.appendChild(img) }
        }
        if (data.type === 'linked') {
          es.close()
          document.getElementById('linkStatus').innerHTML = '<span style="color:#276749;font-weight:700">✓ Linked!</span>'
          // Reveal the required group picker instead of auto-advancing.
          document.getElementById('groupPanel').style.display = 'block'
          document.getElementById('groupPanel').scrollIntoView({ behavior: 'smooth', block: 'start' })
          loadGroups()
        }
        if (data.type === 'loggedOut') {
          // The linked device was removed from the phone. Flip back to a
          // waiting state; the cleared auth dir makes the next socket emit a
          // fresh QR, which arrives on this same stream as a 'qr' event.
          document.getElementById('qrHint').textContent = 'WhatsApp was logged out on your phone — waiting for a new code…'
          document.getElementById('linkStatus').innerHTML = '<span style="color:#c53030;font-weight:600">Logged out — scan the new code to re-link</span>'
          document.getElementById('groupPanel').style.display = 'none'
          const d = document.getElementById('qrDisplay')
          d.innerHTML = '<div class="spinner" id="qrSpinner"></div>'
        }
      }
    </script>
  `)
}

async function renderStep6(session: OnboardingSession): Promise<string> {
  const roles = getAllRoles()
  const role = roles.find((r) => r.id === session.roleId)
  const connectedPlatforms = Object.entries(session.connections)
    .filter(([, s]) => s === 'connected')
    .map(([id]) => getAllMcps().find((m) => m.id === id)?.displayName ?? id)

  const waNumber = isTwilioProvider()
    ? twilioBusinessNumberDigits()
    : (process.env.WHATSAPP_NUMBER ?? process.env.WHATSAPP_PHONE_NUMBER ?? '')
  const waLink = waNumber ? `https://wa.me/${waNumber.replace(/\D/g, '')}` : '#'

  return layout('You\'re All Set!', `
    ${stepDots(6)}
    <div class="card" style="text-align:center;">
      ${eyebrow(6, 'Live')}
      <div class="success-icon">🎉</div>
      <h1>Your agent is live</h1>
      <p class="subtitle">
        ${role ? `${role.emoji} <strong>${role.displayName}</strong> is set up and knows your business.` : 'Your agent is configured.'}
      </p>
      ${connectedPlatforms.length ? `
        <ul class="connected-list" style="text-align:left;margin:1.5rem auto;max-width:320px;">
          ${connectedPlatforms.map((p) => `<li>${p}</li>`).join('')}
        </ul>` : ''}
      ${waNumber ? `
        <a href="${waLink}" class="whatsapp-cta" style="justify-content:center;">
          <span>💬</span>
          <span>Start chatting on WhatsApp</span>
        </a>` : '<p style="margin-top:1rem;color:#718096;">Message your agent on WhatsApp to get started.</p>'}
    </div>
  `)
}

// ── Vite frontend + JSON API ─────────────────────────────────────────────────

/**
 * Build a platform's OAuth URL, degrading gracefully if the platform's required
 * env vars aren't configured. An optional platform with missing env (e.g. Meta
 * Ads without META_APP_ID) returns '#' instead of throwing, so onboarding can
 * continue and the client can connect the platforms they do have configured.
 */
function safeAuthUrl(
  p: McpDefinition,
  state: string,
  redirectBase: string,
): string {
  if (!p.authUrl) return '#'
  try {
    return p.authUrl(state, redirectBase)
  } catch (err) {
    console.warn(`[onboarding] authUrl for platform ${p.id} failed (likely missing env):`, err instanceof Error ? err.message : err)
    return '#'
  }
}

function mimeTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.svg')) return 'image/svg+xml'
  if (filePath.endsWith('.png')) return 'image/png'
  if (filePath.endsWith('.ico')) return 'image/x-icon'
  if (filePath.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}

async function serveOnboardingFrontend(pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname.startsWith('/onboarding/assets/')
    ? pathname.replace('/onboarding/', '')
    : pathname === '/onboarding/bizzclaw-mascot.png'
      ? 'bizzclaw-mascot.png'
    : 'index.html'
  const filePath = path.resolve(FRONTEND_DIST_DIR, relative)
  if (!filePath.startsWith(FRONTEND_DIST_DIR)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  try {
    const body = await readFile(filePath)
    res.writeHead(200, {
      'Content-Type': mimeTypeFor(filePath),
      'Cache-Control': relative === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    res.end(body)
  } catch {
    const devUrl = process.env.ONBOARDING_VITE_DEV_URL ?? 'http://localhost:5173/onboarding'
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
      '<html><body style="font-family:sans-serif;padding:40px;line-height:1.5">' +
        '<h1>Onboarding frontend is not built</h1>' +
        '<p>Run <code>npm run dev:frontend</code> for Vite dev, or <code>npm run build:frontend</code> before serving from this process.</p>' +
        `<p><a href="${devUrl}">Open Vite frontend</a></p>` +
      '</body></html>',
    )
  }
}

function rolePayload(session: OnboardingSession): Record<string, unknown>[] {
  const mcpName = new Map(getAllMcps().map((m) => [m.id, m.displayName]))
  return getAllRoles().map((r) => ({
    id: r.id,
    displayName: r.displayName,
    description: r.description,
    emoji: r.emoji,
    requiredMcps: r.requiredMcps,
    optionalMcps: r.optionalMcps,
    selected: session.roleId === r.id,
    tools: [
      ...r.requiredMcps.map((id) => ({ id, displayName: mcpName.get(id) ?? id, required: true })),
      ...r.optionalMcps.map((id) => ({ id, displayName: mcpName.get(id) ?? id, required: false })),
    ],
  }))
}

function effectiveWhatsAppLinked(session: OnboardingSession): boolean {
  if (!session.whatsappLinked) return false
  if (session.whatsappProvider !== 'baileys') return true
  return baileysSessionManager().isConnected(session.clientId ?? session.sessionId)
}

/**
 * For Baileys, WhatsApp setup is only complete once the user has also picked
 * their home group — the agent is group-scoped, so "linked" alone isn't enough.
 * This keeps step 6 unreachable until the group is confirmed.
 */
async function effectiveWhatsAppReady(session: OnboardingSession): Promise<boolean> {
  if (!effectiveWhatsAppLinked(session)) return false
  if (session.whatsappProvider !== 'baileys') return true
  const clientId = session.clientId ?? session.sessionId
  const meta = await getClientMeta(clientId)
  return Boolean(meta.baileysHomeGroupJid)
}

async function progressForSession(
  session: OnboardingSession,
  whatsappLinked?: boolean,
): Promise<{ progress: OnboardingProgress; scheduleTemplates: string[] | null }> {
  const role = getAllRoles().find((candidate) => candidate.id === session.roleId)
  const clientId = session.clientId ?? session.sessionId
  const savedRole = role ? await getClientRole(clientId) : null
  let scheduleTemplates: string[] | null = null
  if (savedRole && savedRole.roleId === role?.id && savedRole.scheduleTemplates !== undefined) {
    scheduleTemplates = savedRole.scheduleTemplates
  }

  const linked = whatsappLinked ?? (await effectiveWhatsAppReady(session))

  return {
    progress: deriveOnboardingProgress({
      hasProfile: Boolean(session.profile),
      hasRole: Boolean(role),
      automationsConfigured: scheduleTemplates !== null,
      requiredPlatformIds: role?.requiredMcps ?? [],
      connections: session.connections,
      whatsappLinked: linked,
      requireConnectionsForLaunch: !activationV2Enabled(session.sessionId),
    }),
    scheduleTemplates,
  }
}

async function onboardingBootstrap(session: OnboardingSession): Promise<Record<string, unknown>> {
  const role = getAllRoles().find((r) => r.id === session.roleId)
  const callbackBase = process.env.CALLBACK_BASE_URL ?? 'http://localhost:3000'
  const oauthState = oauthStateFor(session)
  const mcps = getAllMcps()
  const relevantPlatforms = role
    ? mcps.filter((p) => role.requiredMcps.includes(p.id) || role.optionalMcps.includes(p.id))
    : []
  const providers = configuredWhatsAppProviders()
  // No default — the user picks. Don't auto-jump to Twilio.
  const selectedProvider = session.whatsappProvider ?? null
  const twilioDigits = twilioBusinessNumberDigits()
  const connectCode = selectedProvider === 'twilio' && isTwilioProvider() && !session.whatsappJid
    ? await ensureWhatsAppConnectCode(session)
    : null
  const twilioText = connectCode ? `connect ${connectCode}` : 'Hi'

  // If the session thinks WhatsApp is linked but the Baileys socket for this
  // client isn't actually connected (e.g. the user removed the linked device,
  // or WhatsApp invalidated the session), treat it as not linked so the user
  // can re-link from step 5 instead of being stuck on step 6. For Baileys we
  // also require the home group to be chosen before step 6 unlocks.
  const effectiveLinked = effectiveWhatsAppLinked(session)
  const effectiveReady = await effectiveWhatsAppReady(session)
  const { progress, scheduleTemplates } = await progressForSession(session, effectiveReady)
  const clientMeta = selectedProvider === 'baileys'
    ? await getClientMeta(session.clientId ?? session.sessionId)
    : null

  return {
    agentName: process.env.AGENT_NAME ?? 'BizzClaw',
    activationV2: activationV2Enabled(session.sessionId),
    preview: currentPreview(session),
    progress,
    session: {
      sessionId: session.sessionId,
      step: progress.allowedStep,
      clientId: session.clientId ?? null,
      whatsappJid: session.whatsappJid ?? null,
      whatsappLinked: effectiveLinked,
      whatsappProvider: selectedProvider,
      profile: session.profile ?? null,
      roleId: session.roleId ?? null,
      scheduleTemplates,
      connections: session.connections,
    },
    roles: rolePayload(session),
    templates: session.roleId ? getTemplatesForRole(session.roleId) : [],
    platforms: relevantPlatforms.map((p) => {
      const status = session.connections[p.id] ?? 'pending'
      const required = role?.requiredMcps.includes(p.id) ?? false
      return {
        id: p.id,
        displayName: p.displayName,
        required,
        status,
        authUrl: p.oauthFlow !== 'none' && p.authUrl ? safeAuthUrl(p, oauthState, callbackBase) : null,
      }
    }),
    whatsapp: {
      providers,
      selectedProvider,
      twilio: {
        enabled: isTwilioProvider(),
        digits: twilioDigits,
        connectCode,
        waLink: twilioDigits ? `https://wa.me/${twilioDigits}?text=${encodeURIComponent(twilioText)}` : null,
      },
      baileys: {
        // Baileys (BYO number) is always available per-client, regardless of
        // the global WHATSAPP_PROVIDER env.
        enabled: true,
        latestQr: latestQrDataUri,
        homeGroupJid: clientMeta?.baileysHomeGroupJid ?? null,
        homeGroupSubject: clientMeta?.baileysHomeGroupSubject ?? null,
      },
    },
  }
}

async function saveProfileFromJson(session: OnboardingSession, body: Record<string, unknown>): Promise<void> {
  const clientId = session.clientId ?? session.sessionId
  const instagramHandle = jsonString(body.instagram)
  const tiktokHandle = jsonString(body.tiktok)
  const description = jsonString(body.description)
  const name = jsonString(body.name).trim()
  if (!name) throw new Error('Enter your business or project name')
  if (!description.trim()) throw new Error('Add a short description of your business')
  const website = jsonString(body.website).trim()
  if (website) {
    try {
      const parsed = new URL(website)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
    } catch {
      throw new Error('Enter a complete website URL, such as https://example.com')
    }
  }
  const fallbackName = description.split(/[.\n]/)[0]?.slice(0, 64).trim()
  const goals = jsonStringArray(body.goals) as GoalType[]
  const profile: ClientProfile = {
    clientId,
    whatsappJid: session.whatsappJid ?? '',
    createdAt: session.createdAt,
    business: {
      name: name || fallbackName || 'My business',
      industry: jsonString(body.industry) || 'other',
      description,
      goals: goals.length ? goals : ['brand_awareness', 'generate_leads'],
      targetAudience: jsonString(body.targetAudience),
      brandVoice: jsonString(body.brandVoice),
      brandColors: [],
    },
    assets: {
      website: website || undefined,
      instagram: instagramHandle
        ? { handle: instagramHandle, profileUrl: `https://instagram.com/${instagramHandle.replace('@', '')}` }
        : undefined,
      tiktok: tiktokHandle
        ? { handle: tiktokHandle, profileUrl: `https://tiktok.com/@${tiktokHandle.replace('@', '')}` }
        : undefined,
    },
  }
  await saveProfile(profile)
  session.profile = profile
  session.step = Math.max(session.step, 2)
  await saveSession(session)
}

async function saveRoleFromJson(session: OnboardingSession, body: Record<string, unknown>): Promise<void> {
  if (!session.profile) throw new Error('Save the business brief before choosing a specialist')
  const roleId = jsonString(body.roleId) as RoleId
  if (!getAllRoles().some((role) => role.id === roleId)) throw new Error('Unsupported role')
  const clientId = session.clientId ?? session.sessionId
  const existing = await getClientRole(clientId)
  const roleChanged = existing?.roleId !== roleId
  await saveRole(clientId, {
    roleId,
    assignedAt: roleChanged ? new Date().toISOString() : (existing?.assignedAt ?? new Date().toISOString()),
    skillOverrides: roleChanged ? { disabled: [], extra: [] } : (existing?.skillOverrides ?? { disabled: [], extra: [] }),
    mcpOverrides: roleChanged ? { disabled: [], extra: [] } : (existing?.mcpOverrides ?? { disabled: [], extra: [] }),
    scheduleTemplates: roleChanged ? undefined : existing?.scheduleTemplates,
  })
  session.roleId = roleId
  session.step = roleChanged ? 3 : Math.max(session.step, 3)
  await saveSession(session)
}

async function saveAutomationsFromJson(session: OnboardingSession, body: Record<string, unknown>): Promise<void> {
  if (!session.roleId) throw new Error('Choose a specialist before setting its routine')
  const clientId = session.clientId ?? session.sessionId
  const validIds = new Set((session.roleId ? getTemplatesForRole(session.roleId) : []).map((t) => t.id))
  const chosen = jsonStringArray(body.templates).filter((id) => validIds.has(id))
  const existing = await getClientRole(clientId)
  await saveRole(clientId, {
    roleId: existing?.roleId ?? (session.roleId as RoleId),
    assignedAt: existing?.assignedAt ?? new Date().toISOString(),
    skillOverrides: existing?.skillOverrides ?? { disabled: [], extra: [] },
    mcpOverrides: existing?.mcpOverrides ?? { disabled: [], extra: [] },
    scheduleTemplates: chosen,
  })
  session.step = Math.max(session.step, 4)
  await saveSession(session)
}

async function saveProviderFromJson(session: OnboardingSession, body: Record<string, unknown>): Promise<void> {
  const provider = jsonString(body.whatsappProvider)
  // Accept any valid provider. Baileys is always available per-client even when
  // the global WHATSAPP_PROVIDER env is twilio-only, so don't restrict to the
  // server's configured list.
  if (!isWhatsAppProvider(provider)) throw new Error('Unsupported provider')
  const { progress } = await progressForSession(session)
  if (!progress.checks.profile || !progress.checks.role || !progress.checks.automations) {
    throw new Error('Finish the earlier setup stages before choosing WhatsApp')
  }
  if (!progress.checks.requiredConnections && !activationV2Enabled(session.sessionId)) {
    throw new Error('Connect the required platforms before choosing WhatsApp')
  }
  if (provider === 'twilio' && !isTwilioProvider()) {
    throw new Error('The managed WhatsApp number is not available right now')
  }
  if (session.whatsappProvider && session.whatsappProvider !== provider) {
    session.whatsappLinked = false
  }
  session.whatsappProvider = provider as WhatsAppProvider
  session.step = Math.max(session.step, 5)
  if (session.clientId) await updateClientMeta(session.clientId, { whatsappProvider: provider as WhatsAppProvider })
  await saveSession(session)
}

// ── Route handler ─────────────────────────────────────────────────────────────

export type OnboardingHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export function createOnboardingHandler(): OnboardingHandler {
  return async (req, res) => {
    const { pathname, query } = parseUrl(req.url ?? '/', true)
    const cookieSessionId = getSessionId(req)
    const querySessionId = typeof query.session === 'string' ? query.session : undefined
    const sessionId = querySessionId ?? cookieSessionId
    const session = await getOrCreateSession(sessionId)

    // A query-provided session is commonly used by local/device testing and
    // signed-link adoption. Persist it into the HttpOnly cookie so subsequent
    // browser fetches (which intentionally omit tenant/session identifiers)
    // remain on the same onboarding session.
    if (cookieSessionId !== session.sessionId) {
      setSessionCookie(res, session.sessionId)
    }

    // ── If the request came through the auth middleware, use tenantId as clientId
    const tenantId = (req as any).__tenantId as string | undefined
    let sessionChanged = false
    if (tenantId && !session.clientId) {
      session.clientId = tenantId
      sessionChanged = true
    }

    // ── Adopt the signed client link (?c=) so onboarding writes under the ──────
    //    runtime key (sha256 of the JID) instead of the random session id.
    const linkToken = typeof query.c === 'string' ? query.c : undefined
    if (linkToken && !session.clientId) {
      const jid = verifyClientToken(linkToken)
      if (jid) {
        session.clientId = clientIdFromJid(jid)
        session.whatsappJid = jid
        sessionChanged = true
      }
    }
    const requestedProvider = typeof query.platform === 'string' && isWhatsAppProvider(query.platform)
      ? query.platform
      : undefined
    if (requestedProvider && configuredWhatsAppProviders().includes(requestedProvider) && session.whatsappProvider !== requestedProvider) {
      session.whatsappProvider = requestedProvider
      sessionChanged = true
    }
    if (sessionChanged) await saveSession(session)

    // ── Vite SPA + JSON API ─────────────────────────────────────────────────
    if (pathname?.startsWith('/api/onboarding')) {
      try {
        if (req.method === 'GET' && pathname === '/api/onboarding/bootstrap') {
          return json(res, await onboardingBootstrap(session))
        }
        if (req.method === 'GET' && pathname === '/api/onboarding/status') {
          const fresh = await loadSession(session.sessionId)
          const current = fresh ?? session
          const whatsappLinked = effectiveWhatsAppLinked(current)
          const whatsappReady = await effectiveWhatsAppReady(current)
          const { progress } = await progressForSession(current, whatsappReady)
          return json(res, {
            step: progress.allowedStep,
            progress,
            connections: current.connections,
            whatsappLinked,
            whatsappProvider: current.whatsappProvider ?? defaultWhatsAppProvider(),
          })
        }
        if (req.method === 'POST' && pathname === '/api/onboarding/profile') {
          await saveProfileFromJson(session, await parseJsonBody(req))
          return json(res, await onboardingBootstrap(session))
        }
        if (req.method === 'POST' && pathname === '/api/onboarding/preview') {
          if (!activationV2Enabled(session.sessionId)) return json(res, { error: 'Activation preview is not enabled' }, 404)
          if (!session.profile) throw new Error('Save the business brief before creating a preview')
          const cached = currentPreview(session)
          if (cached) return json(res, { preview: cached })
          const clientId = session.clientId ?? session.sessionId
          registerPreviewAttempt(session)
          await saveSession(session)
          await recordActivationEvent(clientId, 'preview_requested', { phase: 'brief' })
          const preview = await generatePreview(session.profile)
          session.preview = preview
          session.previewProfileFingerprint = profileFingerprint(session.profile)
          await saveSession(session)
          await recordActivationEvent(clientId, preview.source === 'ai' ? 'preview_generated' : 'preview_fallback', {
            phase: 'brief',
            source: preview.source,
          })
          return json(res, { preview })
        }
        if (req.method === 'POST' && pathname === '/api/onboarding/events') {
          const body = await parseJsonBody(req)
          if (!isActivationEventName(body.event)) return json(res, { error: 'Unsupported activation event' }, 400)
          const clientId = session.clientId ?? session.sessionId
          await recordActivationEvent(clientId, body.event, sanitizeActivationProperties(body.properties))
          return json(res, { ok: true })
        }
        if (req.method === 'POST' && pathname === '/api/onboarding/role') {
          await saveRoleFromJson(session, await parseJsonBody(req))
          return json(res, await onboardingBootstrap(session))
        }
        if (req.method === 'POST' && pathname === '/api/onboarding/automations') {
          await saveAutomationsFromJson(session, await parseJsonBody(req))
          return json(res, await onboardingBootstrap(session))
        }
        if (req.method === 'POST' && pathname === '/api/onboarding/whatsapp-provider') {
          await saveProviderFromJson(session, await parseJsonBody(req))
          return json(res, await onboardingBootstrap(session))
        }
        if (req.method === 'POST' && pathname === '/api/onboarding/whatsapp-disconnect') {
          // Log out the linked WhatsApp device (Baileys) and clear the session's
          // link state so the user can re-link or switch providers.
          if (session.whatsappProvider === 'baileys') {
            const clientId = session.clientId ?? session.sessionId
            await baileysSessionManager().disconnect(clientId).catch((err) => {
              console.error(`[onboarding] baileys disconnect failed for ${clientId}:`, err)
            })
            await updateClientMeta(clientId, {
              baileysHomeGroupJid: undefined,
              baileysHomeGroupSubject: undefined,
              baileysHomeGroupBoundAt: undefined,
            })
          }
          session.whatsappLinked = false
          session.whatsappJid = undefined
          if (session.step > 5) session.step = 5
          await saveSession(session)
          return json(res, await onboardingBootstrap(session))
        }
        if (req.method === 'GET' && pathname === '/api/onboarding/baileys-groups') {
          // List the WhatsApp groups the linked account participates in, so the
          // user can pick the ONE group the agent is allowed to sit in.
          const clientId = session.clientId ?? session.sessionId
          const groups = await baileysSessionManager().listGroups(clientId)
          if (groups === null) {
            return json(res, { error: 'WhatsApp is not linked yet' }, 409)
          }
          const existing = await getClientMeta(clientId)
          return json(res, { groups, selected: existing.baileysHomeGroupJid ?? null })
        }
        if (req.method === 'POST' && pathname === '/api/onboarding/baileys-group') {
          // Save the user's chosen home group. The picked jid must be one of the
          // groups the linked account actually participates in (no arbitrary jids).
          const clientId = session.clientId ?? session.sessionId
          const body = await parseJsonBody(req)
          const groupJid = typeof body.groupJid === 'string' ? body.groupJid.trim() : ''
          if (!groupJid) throw new Error('Missing groupJid')
          const groups = await baileysSessionManager().listGroups(clientId)
          if (groups === null) throw new Error('WhatsApp is not linked yet')
          const match = groups.find((g) => g.jid === groupJid)
          if (!match) throw new Error('That group is not available on the linked account')
          await updateClientMeta(clientId, {
            baileysHomeGroupJid: match.jid,
            baileysHomeGroupSubject: match.subject,
            baileysHomeGroupBoundAt: new Date().toISOString(),
          })
          return json(res, { ok: true, group: match })
        }
        if (req.method === 'POST' && pathname === '/api/onboarding/baileys-group-create') {
          // Creating a group is an explicit external side effect. Require a
          // human-supplied participant and never infer or auto-retry it.
          const clientId = session.clientId ?? session.sessionId
          const body = await parseJsonBody(req)
          const requestedName = typeof body.groupName === 'string' ? body.groupName.trim() : ''
          const phoneDigits = typeof body.participantPhone === 'string'
            ? body.participantPhone.replace(/\D/g, '')
            : ''
          if (!requestedName || requestedName.length > 100) {
            throw new Error('Choose a group name up to 100 characters')
          }
          if (phoneDigits.length < 8 || phoneDigits.length > 15) {
            throw new Error('Enter a WhatsApp number including country code')
          }
          const linkedPhone = session.whatsappJid?.split('@')[0]?.split(':')[0]
          if (linkedPhone === phoneDigits) throw new Error('Invite someone other than the linked WhatsApp number')
          let created
          try {
            created = await baileysSessionManager().createGroup(clientId, {
              subject: requestedName,
              participantJid: `${phoneDigits}@s.whatsapp.net`,
            })
          } catch {
            throw new Error('Could not create the group. Check that the invited number uses WhatsApp and try again.')
          }
          if (!created) throw new Error('WhatsApp is not linked yet')
          await updateClientMeta(clientId, {
            baileysHomeGroupJid: created.jid,
            baileysHomeGroupSubject: created.subject,
            baileysHomeGroupBoundAt: new Date().toISOString(),
          })
          return json(res, { ok: true, group: created })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown onboarding API error'
        return json(res, { error: message }, 400)
      }
      return notFound(res)
    }

    if (req.method === 'GET' && (pathname?.startsWith('/onboarding/assets/') || pathname === '/onboarding/bizzclaw-mascot.png')) {
      await serveOnboardingFrontend(pathname, res)
      return
    }

    if (req.method === 'GET' && (pathname === '/onboarding' || pathname?.startsWith('/onboarding/step/'))) {
      await serveOnboardingFrontend(pathname, res)
      return
    }

    // ── GET /onboarding ──────────────────────────────────────────────────────
    if (req.method === 'GET' && pathname === '/onboarding') {
      return redirect(res, `/onboarding/step/${session.step}`)
    }

    // ── GET /onboarding/step/:n ──────────────────────────────────────────────
    if (req.method === 'GET' && pathname?.startsWith('/onboarding/step/')) {
      const n = parseInt(pathname.split('/').pop() ?? '1', 10)
      let body: string
      if (n === 1) body = await renderStep1(session)
      else if (n === 2) body = await renderStep2(session)
      else if (n === 3) body = await renderStep3(session)
      else if (n === 4) body = await renderStep4(session)
      else if (n === 5) body = await renderStep5(session)
      else if (n === 6) body = await renderStep6(session)
      else return redirect(res, '/onboarding')
      return html(res, body)
    }

    // ── POST /onboarding/step/1 — business profile ───────────────────────────
    if (req.method === 'POST' && pathname === '/onboarding/step/1') {
      const body = await parseBody(req)
      const clientId = session.clientId ?? session.sessionId
      const instagramHandle = str(body.instagram)
      const tiktokHandle = str(body.tiktok)
      const description = str(body.description)
      const fallbackName = description.split(/[.\n]/)[0]?.slice(0, 64).trim()
      const goals = arr(body.goals) as GoalType[]
      const profile: ClientProfile = {
        clientId,
        whatsappJid: session.whatsappJid ?? '',
        createdAt: session.createdAt,
        business: {
          name: str(body.name) || fallbackName || 'My business',
          industry: str(body.industry) || 'other',
          description,
          goals: goals.length ? goals : ['brand_awareness', 'generate_leads'],
          targetAudience: str(body.targetAudience),
          brandVoice: str(body.brandVoice),
          brandColors: [],
        },
        assets: {
          website: str(body.website) || undefined,
          instagram: instagramHandle
            ? { handle: instagramHandle, profileUrl: `https://instagram.com/${instagramHandle.replace('@', '')}` }
            : undefined,
          tiktok: tiktokHandle
            ? { handle: tiktokHandle, profileUrl: `https://tiktok.com/@${tiktokHandle.replace('@', '')}` }
            : undefined,
        },
      }
      await saveProfile(profile)
      session.profile = profile
      session.step = 2
      await saveSession(session)
      return redirect(res, '/onboarding/step/2')
    }

    // ── POST /onboarding/step/2 — role selection ─────────────────────────────
    if (req.method === 'POST' && pathname === '/onboarding/step/2') {
      const body = await parseBody(req)
      const roleId = str(body.roleId) as RoleId
      const clientId = session.clientId ?? session.sessionId
      await saveRole(clientId, {
        roleId,
        assignedAt: new Date().toISOString(),
        skillOverrides: { disabled: [], extra: [] },
        mcpOverrides: { disabled: [], extra: [] },
      })
      session.roleId = roleId
      session.step = 3
      await saveSession(session)
      return redirect(res, '/onboarding/step/3')
    }

    // ── POST /onboarding/step/3 — automations / scheduler templates ──────────
    if (req.method === 'POST' && pathname === '/onboarding/step/3') {
      const body = await parseBody(req)
      const clientId = session.clientId ?? session.sessionId
      const validIds = new Set((session.roleId ? getTemplatesForRole(session.roleId) : []).map((t) => t.id))
      const chosen = arr(body.templates).filter((id) => validIds.has(id))

      // Preserve the existing role record, just attach the chosen automations.
      const existing = await getClientRole(clientId)
      await saveRole(clientId, {
        roleId: existing?.roleId ?? (session.roleId as RoleId),
        assignedAt: existing?.assignedAt ?? new Date().toISOString(),
        skillOverrides: existing?.skillOverrides ?? { disabled: [], extra: [] },
        mcpOverrides: existing?.mcpOverrides ?? { disabled: [], extra: [] },
        scheduleTemplates: chosen,
      })
      session.step = 4
      await saveSession(session)
      return redirect(res, '/onboarding/step/4')
    }

    // ── POST /onboarding/step/5 — WhatsApp transport preference ─────────────
    if (req.method === 'POST' && pathname === '/onboarding/step/5') {
      const body = await parseBody(req)
      const provider = str(body.whatsappProvider)
      // Accept any valid provider — Baileys is always available per-client even
      // when the global WHATSAPP_PROVIDER env is twilio-only.
      if (!isWhatsAppProvider(provider)) {
        return html(res, '<p>Unsupported WhatsApp provider.</p>', 400)
      }
      session.whatsappProvider = provider as WhatsAppProvider
      // Reset link state so the user can re-link (e.g. after a disconnect or
      // removing the linked device from their phone).
      session.whatsappLinked = false
      session.whatsappJid = undefined
      if (session.step > 5) session.step = 5
      if (session.clientId) await updateClientMeta(session.clientId, { whatsappProvider: provider as WhatsAppProvider })
      await saveSession(session)
      return redirect(res, '/onboarding/step/5')
    }

    // ── GET /onboarding/qr-stream — SSE for QR codes ─────────────────────────
    if (req.method === 'GET' && pathname === '/onboarding/qr-stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      qrSseClients.set(session.sessionId, res)

      // Send current QR if already available
      const current = qrData.get(session.sessionId)
      if (current) res.write(`data: ${JSON.stringify({ type: 'qr', qr: current })}\n\n`)

      // Only treat as linked if the Baileys socket is actually connected right
      // now. The in-memory linkedSessions set is populated on connect but never
      // cleared on disconnect, so check the live socket state instead.
      const clientId = session.clientId ?? session.sessionId
      const isLiveLinked = session.whatsappProvider === 'baileys'
        ? baileysSessionManager().isConnected(clientId)
        : linkedSessions.has(session.sessionId)
      if (isLiveLinked) {
        res.write(`data: ${JSON.stringify({ type: 'linked' })}\n\n`)
        res.end()
        return
      }

      // Start this client's Baileys socket when they've chosen Baileys (BYO
      // number), regardless of the global WHATSAPP_PROVIDER env. Each client
      // gets their own socket + auth state at store/clients/<clientId>/auth/.
      const wantsBaileys = (session.whatsappProvider ?? defaultWhatsAppProvider()) === 'baileys'
      if (wantsBaileys) {
        const manager = baileysSessionManager()
        // If already linked, tell the SSE client immediately. Otherwise force a
        // fresh QR (Baileys only emits QR on initial connect, so if a socket is
        // already running but not linked we restart it to trigger a new QR).
        if (manager.isConnected(clientId)) {
          res.write(`data: ${JSON.stringify({ type: 'linked' })}\n\n`)
          res.end()
          return
        }
        manager
          .refreshQr(clientId, { onboardingSessionId: session.sessionId })
          .catch((err) => console.error(`[onboarding] baileys refreshQr failed for ${clientId}:`, err))
      }

      req.on('close', () => { qrSseClients.delete(session.sessionId) })
      return
    }

    // ── GET /onboarding/status — JSON polling ─────────────────────────────────
    if (req.method === 'GET' && pathname === '/onboarding/status') {
      const fresh = await loadSession(session.sessionId)
      return json(res, {
        step: fresh?.step ?? session.step,
        connections: fresh?.connections ?? session.connections,
        whatsappLinked: fresh?.whatsappLinked ?? session.whatsappLinked,
      })
    }

    // ── OAuth callbacks ───────────────────────────────────────────────────────
    if (req.method === 'GET' && pathname?.startsWith('/oauth/')) {
      const parts = pathname.split('/')  // ['', 'oauth', 'platform', 'callback']
      const platform = parts[2] as PlatformId
      const action = parts[3]

      if (action === 'callback') {
        const code = query.code as string | undefined
        const state = query.state as string | undefined

        if (!code) return html(res, '<p>OAuth error: no code received.</p>', 400)

        // Verify the OAuth state: a signed JID binds the exchange to a specific
        // client; otherwise it must match this session (CSRF protection).
        let stateClientId: string | undefined
        if (state) {
          const jid = verifyClientToken(state)
          if (jid) {
            stateClientId = await clientIdForJid(jid)
            if (!session.clientId) {
              session.clientId = stateClientId
              session.whatsappJid = jid
              await saveSession(session)
            }
          } else if (state !== session.sessionId) {
            return html(res, '<p>OAuth state mismatch. <a href="/onboarding/step/4">Try again</a></p>', 400)
          }
        }

        const callbackBase = process.env.CALLBACK_BASE_URL ?? 'http://localhost:3000'
        const tokenEndpoints: Partial<Record<PlatformId, string>> = {
          'meta-ads': 'https://graph.facebook.com/v21.0/oauth/access_token',
          'instagram-graph': 'https://graph.facebook.com/v21.0/oauth/access_token',
          'tiktok': 'https://open.tiktokapis.com/v2/oauth/token/',
          'google': 'https://oauth2.googleapis.com/token',
        }

        try {
          const tokenUrl = tokenEndpoints[platform]
          if (!tokenUrl) throw new Error(`No token endpoint for platform: ${platform}`)

          const redirectUri = `${callbackBase}/oauth/${platform}/callback`
          const params: Record<string, string> = {
            code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }

          if (platform === 'tiktok') {
            params['client_key'] = process.env.TIKTOK_CLIENT_KEY ?? ''
            params['client_secret'] = process.env.TIKTOK_CLIENT_SECRET ?? ''
          } else if (platform === 'google') {
            params['client_id'] = process.env.GOOGLE_CLIENT_ID ?? ''
            params['client_secret'] = process.env.GOOGLE_CLIENT_SECRET ?? ''
          } else {
            // Meta / Instagram
            params['client_id'] = process.env.META_APP_ID ?? ''
            params['client_secret'] = process.env.META_APP_SECRET ?? ''
          }

          const tokenRes = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(params),
            signal: AbortSignal.timeout(15_000),
          })
          const tokenData = (await tokenRes.json()) as Record<string, unknown>
          if (!tokenRes.ok) throw new Error(JSON.stringify(tokenData))

          const clientId = stateClientId ?? session.clientId ?? session.sessionId
          await upsertConnection(clientId, platform, {
            status: 'connected',
            accessToken: (tokenData['access_token'] as string | undefined) ?? ((tokenData['data'] as Record<string, unknown> | undefined)?.['access_token'] as string | undefined) ?? null,
            refreshToken: tokenData['refresh_token'] as string | undefined,
            tokenExpiresAt: tokenData['expires_in']
              ? new Date(Date.now() + (tokenData['expires_in'] as number) * 1000).toISOString()
              : null,
            connectedAt: new Date().toISOString(),
            scopes: typeof tokenData['scope'] === 'string' ? tokenData['scope'].split(' ') : undefined,
          })

          session.connections[platform] = 'connected'
          await saveSession(session)

          return redirect(res, '/onboarding/step/4')
        } catch (err) {
          console.error(`[oauth/${platform}] token exchange failed:`, err)
          return html(res, `<p>Connection failed: ${err instanceof Error ? err.message : 'unknown error'}. <a href="/onboarding/step/4">Try again</a></p>`, 500)
        }
      }

      // Higgsfield uses its own OAuth flow in higgsfield-auth.ts — redirect to existing handler
      if (platform === 'higgsfield' && action === 'start') {
        return redirect(res, '/auth/higgsfield/start')
      }
    }

    // ── 404 ───────────────────────────────────────────────────────────────────
    if (pathname?.startsWith('/onboarding') || pathname?.startsWith('/oauth')) {
      return html(res, '<p>Not found.</p>', 404)
    }
  }
}
