import { readFile } from 'node:fs/promises'
import { parse as parseUrl } from 'node:url'
import { parse as parseQs } from 'node:querystring'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { getOrCreateSession, loadSession, saveSession } from './session.js'
import { getAllRoles } from '../roles/index.js'
import { getAllMcps } from '../mcps/index.js'
import { oauthStateFor, verifyClientToken } from './client-link.js'
import { getTemplatesForRole } from '../scheduler/index.js'
import {
  saveProfile,
  saveRole,
  getRole as getClientRole,
  upsertConnection,
  clientIdFromJid,
} from '../store/client-store.js'
import type { ClientProfile, GoalType, PlatformId, RoleId, OnboardingSession } from '../store/types.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIEWS_DIR = path.join(__dirname, 'views')

// SSE clients waiting for QR updates
const qrSseClients = new Map<string, ServerResponse>()
// QR data per session
const qrData = new Map<string, string>()
// Sessions that have completed WhatsApp linking
const linkedSessions = new Set<string>()

// ── Called by whatsapp.ts when QR changes ─────────────────────────────────────

export async function broadcastQr(sessionId: string, qrText: string): Promise<void> {
  // Encode the raw Baileys QR string into a scannable PNG data URI.
  // 464px source renders crisply at the 232px display size on retina screens.
  let dataUri: string
  try {
    dataUri = await QRCode.toDataURL(qrText, { margin: 1, width: 464, errorCorrectionLevel: 'M' })
  } catch (err) {
    console.error('[onboarding] QR encode failed:', err)
    return
  }
  qrData.set(sessionId, dataUri)
  const client = qrSseClients.get(sessionId)
  if (client && !client.destroyed) {
    client.write(`data: ${JSON.stringify({ type: 'qr', qr: dataUri })}\n\n`)
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

// ── HTML rendering ─────────────────────────────────────────────────────────────

async function layout(title: string, content: string): Promise<string> {
  const template = await readFile(path.join(VIEWS_DIR, 'layout.html'), 'utf-8')
  const agentName = process.env.AGENT_NAME ?? 'Ahrness'
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

// ── Body parsing ───────────────────────────────────────────────────────────────

function parseBody(req: IncomingMessage): Promise<Record<string, string | string[]>> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(parseQs(body) as Record<string, string | string[]>))
  })
}

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? ''
}

function arr(v: string | string[] | undefined): string[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
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
  return layout('Business Profile', `
    ${stepDots(1)}
    <div class="card">
      ${eyebrow(1, 'Business Profile')}
      <h1>Tell us about your business</h1>
      <p class="subtitle">Your agent uses this to give advice grounded in your business — not generic answers.</p>
      <form method="POST" action="/onboarding/step/1">
        <div class="field-row">
          <div class="field">
            <label for="name">Business Name *</label>
            <input type="text" id="name" name="name" required value="${biz?.name ?? ''}" placeholder="Bloom Skincare" />
          </div>
          <div class="field">
            <label for="industry">Industry *</label>
            <select id="industry" name="industry" required>
              ${['e-commerce','SaaS','local business','agency','real estate','health & wellness','education','finance','food & beverage','fashion','tech','other']
                .map((i) => `<option value="${i}" ${biz?.industry === i ? 'selected' : ''}>${i}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label for="description">What do you sell / do?</label>
          <textarea id="description" name="description" placeholder="Natural skincare products for women 25-45">${biz?.description ?? ''}</textarea>
        </div>
        <div class="field">
          <label for="targetAudience">Target Audience</label>
          <input type="text" id="targetAudience" name="targetAudience" value="${biz?.targetAudience ?? ''}" placeholder="Women 25-45, health-conscious, mid-high income" />
        </div>
        <div class="field">
          <label for="brandVoice">Brand Voice</label>
          <input type="text" id="brandVoice" name="brandVoice" value="${biz?.brandVoice ?? ''}" placeholder="Warm, trustworthy, educational. Never pushy." />
        </div>
        <div class="field">
          <label>Goals (pick all that apply)</label>
          <div class="checkbox-group">
            ${(['generate_leads','increase_roas','grow_instagram','grow_tiktok','increase_sales','brand_awareness'] as GoalType[])
              .map((g) => `<label class="checkbox-label"><input type="checkbox" name="goals" value="${g}" ${(biz?.goals ?? []).includes(g) ? 'checked' : ''} />${g.replace(/_/g, ' ')}</label>`)
              .join('')}
          </div>
        </div>
        <div class="field">
          <label for="website">Website URL</label>
          <input type="url" id="website" name="website" value="${(s.profile as ClientProfile | undefined)?.assets?.website ?? ''}" placeholder="https://yoursite.com" />
        </div>
        <div class="field-row">
          <div class="field">
            <label for="instagram">Instagram Handle</label>
            <input type="text" id="instagram" name="instagram" value="${(s.profile as ClientProfile | undefined)?.assets?.instagram?.handle ?? ''}" placeholder="@yourhandle" />
          </div>
          <div class="field">
            <label for="tiktok">TikTok Handle</label>
            <input type="text" id="tiktok" name="tiktok" value="${(s.profile as ClientProfile | undefined)?.assets?.tiktok?.handle ?? ''}" placeholder="@yourhandle" />
          </div>
        </div>
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
          const authUrl = p.authUrl ? `${p.authUrl(oauthState, callbackBase)}` : '#'
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
  return layout('Link WhatsApp', `
    ${stepDots(5)}
    <div class="card">
      ${eyebrow(5, 'Link WhatsApp')}
      <h1>Scan to go live</h1>
      <p class="subtitle">On your phone, open WhatsApp → tap ⋮ → Linked Devices → Link a Device → scan this code.</p>
      <div class="qr-box">
        <div id="qrDisplay">
          <div class="spinner" id="qrSpinner"></div>
        </div>
        <p class="qr-hint" id="qrHint">Waiting for QR code…</p>
      </div>
      <div class="actions" style="margin-top:1.5rem;">
        <a href="/onboarding/step/4" class="btn btn-secondary">← Back</a>
        <span id="linkStatus"></span>
      </div>
    </div>
    <script>
      const sessionId = '${session.sessionId}'
      const es = new EventSource('/onboarding/qr-stream?session=' + sessionId)
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
          document.getElementById('linkStatus').innerHTML = '<span style="color:#276749;font-weight:700">✓ Linked! Redirecting…</span>'
          setTimeout(() => { location.href = '/onboarding/step/6' }, 1200)
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

  const waNumber = process.env.WHATSAPP_NUMBER ?? ''
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

// ── Route handler ─────────────────────────────────────────────────────────────

export type OnboardingHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export function createOnboardingHandler(): OnboardingHandler {
  return async (req, res) => {
    const { pathname, query } = parseUrl(req.url ?? '/', true)
    const sessionId = getSessionId(req) ?? (query.session as string | undefined)
    const session = await getOrCreateSession(sessionId)

    if (!sessionId || sessionId !== session.sessionId) {
      setSessionCookie(res, session.sessionId)
    }

    // ── Adopt the signed client link (?c=) so onboarding writes under the ──────
    //    runtime key (sha256 of the JID) instead of the random session id.
    const linkToken = typeof query.c === 'string' ? query.c : undefined
    if (linkToken && !session.clientId) {
      const jid = verifyClientToken(linkToken)
      if (jid) {
        session.clientId = clientIdFromJid(jid)
        session.whatsappJid = jid
        await saveSession(session)
      }
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
      const profile: ClientProfile = {
        clientId,
        whatsappJid: session.whatsappJid ?? '',
        createdAt: session.createdAt,
        business: {
          name: str(body.name),
          industry: str(body.industry),
          description: str(body.description),
          goals: arr(body.goals) as GoalType[],
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
      if (linkedSessions.has(session.sessionId)) {
        res.write(`data: ${JSON.stringify({ type: 'linked' })}\n\n`)
        res.end()
        return
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
            stateClientId = clientIdFromJid(jid)
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
