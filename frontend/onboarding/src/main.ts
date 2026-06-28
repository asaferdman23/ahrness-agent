import './styles.css'

type Provider = 'twilio' | 'baileys'
type Step = 1 | 2 | 3 | 4 | 5 | 6

interface Role {
  id: string
  displayName: string
  description: string
  emoji: string
  tools: { id: string; displayName: string; required: boolean }[]
}

interface Template {
  id: string
  title: string
  description: string
  cadence: string
  emoji: string
}

interface Platform {
  id: string
  displayName: string
  scopes: string[]
  required: boolean
  status: string
  authUrl: string | null
}

interface Bootstrap {
  agentName: string
  session: {
    sessionId: string
    step: number
    whatsappJid: string | null
    whatsappLinked: boolean
    whatsappProvider: Provider
    profile: any | null
    roleId: string | null
    connections: Record<string, string>
  }
  roles: Role[]
  templates: Template[]
  platforms: Platform[]
  whatsapp: {
    providers: Provider[]
    selectedProvider: Provider
    twilio: { enabled: boolean; digits: string; connectCode: string | null; waLink: string | null }
    baileys: { enabled: boolean; latestQr: string | null }
  }
}

const app = document.querySelector<HTMLDivElement>('#app')!
let data: Bootstrap
let currentStep: Step = stepFromPath()
let qrEvents: EventSource | null = null
let statusTimer: number | null = null
let errorMessage = ''

function stepFromPath(): Step {
  const match = location.pathname.match(/\/onboarding\/step\/(\d+)/)
  const n = match ? Number(match[1]) : 0
  return n >= 1 && n <= 6 ? n as Step : 1
}

async function api(path: string, body?: Record<string, unknown>): Promise<Bootstrap> {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Request failed')
  return json as Bootstrap
}

async function load(): Promise<void> {
  data = await api(`/api/onboarding/bootstrap${location.search}`)
  document.title = `${data.agentName} onboarding`
  const brand = document.querySelector('#brandName')
  if (brand) brand.textContent = data.agentName
  if (!location.pathname.includes('/step/')) currentStep = clampStep(data.session.step)
  render()
}

function clampStep(step: number): Step {
  if (step < 1) return 1
  if (step > 6) return 6
  return step as Step
}

function setStep(step: Step): void {
  currentStep = step
  history.replaceState(null, '', `/onboarding/step/${step}${location.search}`)
  errorMessage = ''
  render()
}

function stepDots(): string {
  const labels = ['Profile', 'Role', 'Automations', 'Connect', 'Link', 'Live']
  return `<nav class="steprail" aria-label="Onboarding progress"><ol>${labels.map((label, i) => {
    const n = i + 1
    const state = n < currentStep ? 'done' : n === currentStep ? 'active' : ''
    return `<li class="${state}"${n === currentStep ? ' aria-current="step"' : ''}>
      <span class="sr-num">${state === 'done' ? '✓' : String(n).padStart(2, '0')}</span>
      <span class="sr-label">${label}</span>
    </li>`
  }).join('')}</ol></nav>`
}

function shell(title: string, subtitle: string, content: string): string {
  return `${stepDots()}<section class="card">
    <div class="eyebrow">Step ${String(currentStep).padStart(2, '0')}</div>
    <h1>${title}</h1>
    <p class="subtitle">${subtitle}</p>
    ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ''}
    ${content}
  </section>`
}

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? '')
}

function checkedValues(form: HTMLFormElement, name: string): string[] {
  return new FormData(form).getAll(name).map(String)
}

function renderProfile(): string {
  const profile = data.session.profile
  const biz = profile?.business ?? {}
  const assets = profile?.assets ?? {}
  return shell('Give BizzClaw a little context', 'A few words and public links are enough. Your agent will use them to understand your business, audience, and content style.', `
    <form id="profileForm">
      ${input('Business or project name', 'name', biz.name ?? '', 'BizzClaw')}
      <input type="hidden" name="industry" value="${escapeHtml(biz.industry ?? 'other')}" />
      <div class="field">
        <label for="description">What should your agent know?</label>
        <textarea id="description" name="description" required placeholder="We help small business owners get more customers from WhatsApp, ads, and social content. Our audience is non-technical founders who want an AI employee.">${escapeHtml(biz.description ?? '')}</textarea>
      </div>
      ${input('Audience or content area', 'targetAudience', biz.targetAudience ?? '', 'Startup founders, local business owners, agency clients')}
      <div class="field">
        <label>Public links the agent can learn from</label>
        <div class="field-row">
          ${input('Website', 'website', assets.website ?? '', 'https://yoursite.com', false, 'url')}
          ${input('Instagram', 'instagram', assets.instagram?.handle ?? '', '@yourhandle')}
        </div>
        ${input('TikTok', 'tiktok', assets.tiktok?.handle ?? '', '@yourhandle')}
      </div>
      <input type="hidden" name="brandVoice" value="${escapeHtml(biz.brandVoice ?? '')}" />
      <input type="hidden" name="goals" value="${(biz.goals?.[0] ?? 'brand_awareness')}" />
      <div class="actions"><span></span><button class="btn btn-primary" type="submit">Continue</button></div>
    </form>`)
}

function renderRole(): string {
  return shell('Commission your specialist', 'Pick the focus that fits. You can reassign it later.', `
    <form id="roleForm">
      <div class="option-list">
        ${data.roles.map((role) => optionCard({
          name: 'roleId',
          value: role.id,
          checked: data.session.roleId === role.id,
          icon: role.emoji,
          title: role.displayName,
          tag: data.session.roleId === role.id ? 'Assigned' : '',
          description: role.description,
          chips: role.tools.map((tool) => ({ label: tool.displayName, core: tool.required })),
        })).join('')}
      </div>
      <div class="actions"><button class="btn btn-secondary" type="button" data-step="1">Back</button><button class="btn btn-primary" type="submit">Continue</button></div>
    </form>`)
}

function renderAutomations(): string {
  return shell('Put the agent on a schedule', 'Switch on recurring jobs you want your agent to run automatically.', `
    <form id="automationForm">
      <div class="option-list">
        ${data.templates.length ? data.templates.map((template) => optionCard({
          type: 'checkbox',
          name: 'templates',
          value: template.id,
          checked: true,
          icon: template.emoji,
          title: template.title,
          tag: template.cadence,
          description: template.description,
        })).join('') : '<p class="muted">No prebuilt automations for this role yet.</p>'}
      </div>
      <div class="actions"><button class="btn btn-secondary" type="button" data-step="2">Back</button><button class="btn btn-primary" type="submit">Continue</button></div>
    </form>`)
}

function renderPlatforms(): string {
  return shell('Connect your platforms', 'Link the services your selected role needs.', `
    <div class="platform-list">
      ${data.platforms.length ? data.platforms.map((platform) => {
        const connected = data.session.connections[platform.id] === 'connected' || platform.status === 'connected'
        return `<div class="platform-row ${connected ? 'connected' : ''}">
          <div>
            <div class="platform-name">
              ${escapeHtml(platform.displayName)}
              <span class="badge ${platform.required ? 'badge-required' : 'badge-optional'}">${platform.required ? 'Required' : 'Optional'}</span>
              ${connected ? '<span class="badge badge-connected">Connected</span>' : ''}
            </div>
            <div class="platform-desc">${platform.scopes.map(escapeHtml).join(', ')}</div>
          </div>
          ${platform.authUrl ? `<a class="btn btn-outline" href="${platform.authUrl}">${connected ? 'Reconnect' : 'Connect'}</a>` : '<span class="badge badge-connected">Auto</span>'}
        </div>`
      }).join('') : '<p class="muted">This role does not require external platform access.</p>'}
    </div>
    <div class="actions"><button class="btn btn-secondary" type="button" data-step="3">Back</button><button class="btn btn-primary" type="button" data-step="5">Continue</button></div>`)
}

function renderWhatsApp(): string {
  const providers = data.whatsapp.providers
  const selected = data.session.whatsappProvider
  const picker = providers.length > 1 ? `<form id="providerForm" class="option-list">
    ${optionCard({ name: 'whatsappProvider', value: 'twilio', checked: selected === 'twilio', icon: '✓', title: 'Verified API', tag: 'Twilio', description: 'Use the WhatsApp Business API through the verified Twilio number.' })}
    ${optionCard({ name: 'whatsappProvider', value: 'baileys', checked: selected === 'baileys', icon: '⌁', title: 'Linked device', tag: 'Baileys', description: 'Connect a WhatsApp account as a linked device for development or private deployments.' })}
    <div class="actions" style="margin-top:.85rem"><span></span><button class="btn btn-secondary" type="submit">Use selected method</button></div>
  </form>` : ''

  const panel = selected === 'twilio'
    ? `<div class="connect-panel">
        <h2>Verified API via Twilio</h2>
        <p class="subtitle">Business number: <strong>+${escapeHtml(data.whatsapp.twilio.digits || 'not configured')}</strong></p>
        ${data.whatsapp.twilio.waLink ? `<a href="${data.whatsapp.twilio.waLink}" class="whatsapp-cta"><span aria-hidden="true">↗</span><span>Open WhatsApp</span></a>` : '<p class="muted">TWILIO_WHATSAPP_NUMBER is not configured.</p>'}
        ${data.whatsapp.twilio.connectCode ? `<p class="muted" id="linkStatus" style="margin-top:1rem">Send the prefilled message to link setup: <strong>${data.whatsapp.twilio.connectCode}</strong></p>` : '<p class="muted" style="margin-top:1rem">This setup was opened from WhatsApp, so the session is already linked.</p>'}
      </div>`
    : `<div class="connect-panel">
        <h2>Linked device via Baileys</h2>
        <div class="qr-box" id="qrBox">
          ${data.whatsapp.baileys.latestQr ? `<img src="${data.whatsapp.baileys.latestQr}" alt="WhatsApp linking QR code" />` : '<span class="spinner" aria-hidden="true"></span>'}
          <p class="muted" id="qrHint">${data.whatsapp.baileys.latestQr ? 'Scan with WhatsApp Linked Devices.' : 'Waiting for a QR code from the server.'}</p>
        </div>
      </div>`

  return shell('Choose how WhatsApp connects', 'Use the verified API, or link a device when this deployment enables it.', `
    ${picker}
    ${panel}
    <div class="actions"><button class="btn btn-secondary" type="button" data-step="4">Back</button><button class="btn btn-primary" type="button" data-step="6">Continue</button></div>`)
}

function renderDone(): string {
  const role = data.roles.find((item) => item.id === data.session.roleId)
  const wa = data.whatsapp.twilio.digits ? `https://wa.me/${data.whatsapp.twilio.digits}` : null
  return `${stepDots()}<section class="card" style="text-align:center">
    <div class="eyebrow">Step 06</div>
    <div class="success-icon">✓</div>
    <h1>Your agent is live</h1>
    <p class="subtitle" style="margin-left:auto;margin-right:auto">${role ? `${role.emoji} <strong>${role.displayName}</strong> is set up and knows your business.` : 'Your agent is configured.'}</p>
    ${wa ? `<a href="${wa}" class="whatsapp-cta"><span aria-hidden="true">↗</span><span>Start chatting on WhatsApp</span></a>` : '<p class="muted">Message your agent on WhatsApp to get started.</p>'}
  </section>`
}

function input(label: string, name: string, value: string, placeholder: string, required = false, type = 'text'): string {
  return `<div class="field">
    <label for="${name}">${label}</label>
    <input type="${type}" id="${name}" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''} />
  </div>`
}

function optionCard(opts: {
  type?: 'radio' | 'checkbox'
  name: string
  value: string
  checked: boolean
  icon: string
  title: string
  tag?: string
  description: string
  chips?: { label: string; core: boolean }[]
}): string {
  return `<label class="option-card">
    <input type="${opts.type ?? 'radio'}" name="${opts.name}" value="${opts.value}" ${opts.checked ? 'checked' : ''} />
    <span class="option-icon" aria-hidden="true">${opts.icon}</span>
    <span class="option-info">
      <span class="option-top"><h3>${escapeHtml(opts.title)}</h3>${opts.tag ? `<span class="tag">${escapeHtml(opts.tag)}</span>` : ''}</span>
      <p>${escapeHtml(opts.description)}</p>
      ${opts.chips?.length ? `<span class="chips">${opts.chips.map((chip) => `<span class="chip ${chip.core ? 'core' : ''}">${escapeHtml(chip.label)}</span>`).join('')}</span>` : ''}
    </span>
  </label>`
}

function render(): void {
  stopLiveWork()
  app.innerHTML =
    currentStep === 1 ? renderProfile() :
    currentStep === 2 ? renderRole() :
    currentStep === 3 ? renderAutomations() :
    currentStep === 4 ? renderPlatforms() :
    currentStep === 5 ? renderWhatsApp() :
    renderDone()
  bindEvents()
  if (currentStep === 4) startPlatformPolling()
  if (currentStep === 5) startWhatsAppLiveUpdates()
}

function bindEvents(): void {
  app.querySelectorAll<HTMLElement>('[data-step]').forEach((el) => {
    el.addEventListener('click', () => setStep(clampStep(Number(el.dataset.step))))
  })
  app.querySelector<HTMLFormElement>('#profileForm')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    await submit(async () => api('/api/onboarding/profile', {
      name: formValue(event.currentTarget, 'name'),
      industry: formValue(event.currentTarget, 'industry'),
      description: formValue(event.currentTarget, 'description'),
      goals: checkedValues(event.currentTarget, 'goals'),
      targetAudience: formValue(event.currentTarget, 'targetAudience'),
      brandVoice: formValue(event.currentTarget, 'brandVoice'),
      website: formValue(event.currentTarget, 'website'),
      instagram: formValue(event.currentTarget, 'instagram'),
      tiktok: formValue(event.currentTarget, 'tiktok'),
    }), 2)
  })
  app.querySelector<HTMLFormElement>('#roleForm')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    await submit(async () => api('/api/onboarding/role', { roleId: formValue(event.currentTarget, 'roleId') }), 3)
  })
  app.querySelector<HTMLFormElement>('#automationForm')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    await submit(async () => api('/api/onboarding/automations', { templates: checkedValues(event.currentTarget, 'templates') }), 4)
  })
  app.querySelector<HTMLFormElement>('#providerForm')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    await submit(async () => api('/api/onboarding/whatsapp-provider', { whatsappProvider: formValue(event.currentTarget, 'whatsappProvider') }), 5)
  })
}

async function submit(request: () => Promise<Bootstrap>, nextStep: Step): Promise<void> {
  try {
    errorMessage = ''
    data = await request()
    setStep(nextStep)
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Something went wrong'
    render()
  }
}

function startPlatformPolling(): void {
  statusTimer = window.setInterval(async () => {
    const res = await fetch('/api/onboarding/status')
    if (!res.ok) return
    const status = await res.json() as { connections?: Record<string, string> }
    data.session.connections = status.connections ?? data.session.connections
    for (const platform of data.platforms) platform.status = data.session.connections[platform.id] ?? platform.status
    if (currentStep === 4) render()
  }, 3000)
}

function startWhatsAppLiveUpdates(): void {
  if (data.session.whatsappProvider === 'baileys') {
    qrEvents = new EventSource(`/onboarding/qr-stream?session=${data.session.sessionId}`)
    qrEvents.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type: string; qr?: string }
      if (payload.type === 'qr' && payload.qr) {
        const box = document.querySelector('#qrBox')
        if (box) box.innerHTML = `<img src="${payload.qr}" alt="WhatsApp linking QR code" /><p class="muted" id="qrHint">Scan with WhatsApp Linked Devices.</p>`
      }
      if (payload.type === 'linked') setStep(6)
    }
  }
  if (data.session.whatsappProvider === 'twilio' && data.whatsapp.twilio.connectCode) {
    statusTimer = window.setInterval(async () => {
      const res = await fetch('/api/onboarding/status')
      if (!res.ok) return
      const status = await res.json() as { whatsappLinked?: boolean }
      if (status.whatsappLinked) setStep(6)
    }, 2500)
  }
}

function stopLiveWork(): void {
  if (qrEvents) {
    qrEvents.close()
    qrEvents = null
  }
  if (statusTimer) {
    window.clearInterval(statusTimer)
    statusTimer = null
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch] ?? ch)
}

load().catch((err) => {
  errorMessage = err instanceof Error ? err.message : 'Could not load onboarding'
  app.innerHTML = `<section class="card"><h1>Could not load onboarding</h1><p class="subtitle">${escapeHtml(errorMessage)}</p></section>`
})
