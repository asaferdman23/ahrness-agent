import './styles.css'

type Provider = 'twilio' | 'baileys'
type Step = 1 | 2 | 3 | 4 | 5 | 6
type Readiness =
  | 'needs_profile'
  | 'needs_role'
  | 'needs_automations'
  | 'needs_connections'
  | 'needs_whatsapp'
  | 'live'

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
  required: boolean
  status: string
  authUrl: string | null
}

interface BaileysGroup {
  jid: string
  subject: string
  size: number
}

interface BusinessProfile {
  business?: {
    name?: string
    industry?: string
    description?: string
    targetAudience?: string
    brandVoice?: string
    goals?: string[]
  }
  assets?: {
    website?: string
    instagram?: { handle?: string }
    tiktok?: { handle?: string }
  }
}

interface OnboardingProgress {
  allowedStep: Step
  readiness: Readiness
  checks: {
    profile: boolean
    role: boolean
    automations: boolean
    requiredConnections: boolean
    whatsapp: boolean
  }
  missingRequiredPlatforms: string[]
}

interface OnboardingPreview {
  headline: string
  insight: string
  opportunities: [string, string, string]
  suggestedFirstBrief: string
  generatedAt: string
  source: 'ai' | 'fallback'
}

interface Bootstrap {
  agentName: string
  activationV2: boolean
  preview: OnboardingPreview | null
  progress: OnboardingProgress
  session: {
    sessionId: string
    step: number
    whatsappJid: string | null
    whatsappLinked: boolean
    whatsappProvider: Provider | null
    profile: BusinessProfile | null
    roleId: string | null
    scheduleTemplates: string[] | null
    connections: Record<string, string>
  }
  roles: Role[]
  templates: Template[]
  platforms: Platform[]
  whatsapp: {
    providers: Provider[]
    selectedProvider: Provider | null
    twilio: { enabled: boolean; digits: string; connectCode: string | null; waLink: string | null }
    baileys: {
      enabled: boolean
      latestQr: string | null
      homeGroupJid: string | null
      homeGroupSubject: string | null
    }
  }
}

interface StatusResponse {
  step: number
  progress: OnboardingProgress
  connections: Record<string, string>
  whatsappLinked: boolean
  whatsappProvider: Provider | null
}

const STEP_LABELS = ['Business', 'Business goal', 'Recurring tasks', 'Connected apps', 'WhatsApp', 'Launch']
const PHASES = [
  { id: 'brief', label: 'Brief', firstStep: 1 as Step },
  { id: 'configure', label: 'Configure', firstStep: 2 as Step },
  { id: 'launch', label: 'Launch', firstStep: 5 as Step },
] as const
const app = document.querySelector<HTMLDivElement>('#app')!
let data: Bootstrap
let currentStep: Step = stepFromPath()
let qrEvents: EventSource | null = null
let statusTimer: number | null = null
let errorMessage = ''
let whatsappConnectionState: 'waiting' | 'reconnecting' | 'error' = 'waiting'
let baileysGroupsState: { groups: BaileysGroup[]; selected: string | null } | null = null
let baileysGroupsLoading = false
let baileysGroupsError = ''
let baileysGroupMode: 'existing' | 'create' = 'existing'
let manageBaileysGroup = new URLSearchParams(location.search).get('manage') === 'group'
let previewLoading = false
let lastTrackedPhase = ''

function stepFromPath(): Step {
  const match = location.pathname.match(/\/onboarding\/step\/(\d+)/)
  return clampStep(match ? Number(match[1]) : 1)
}

function clampStep(step: number): Step {
  if (step < 1) return 1
  if (step > 6) return 6
  return step as Step
}

async function api(path: string, body?: Record<string, unknown>): Promise<Bootstrap> {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json() as Bootstrap | { error?: string }
  if (!res.ok) throw new Error('error' in json && json.error ? json.error : 'Request failed. Try again.')
  return json as Bootstrap
}

async function postJson<T>(path: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const json = await res.json() as T & { error?: string }
  if (!res.ok) throw new Error(json.error || 'Request failed. Try again.')
  return json
}

function trackActivation(event: string, properties: Record<string, unknown> = {}): void {
  if (!data?.activationV2) return
  void fetch('/api/onboarding/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, properties }),
    keepalive: true,
  }).catch(() => {})
}

async function fetchStatus(): Promise<StatusResponse | null> {
  const res = await fetch('/api/onboarding/status')
  if (!res.ok) return null
  return res.json() as Promise<StatusResponse>
}

async function load(): Promise<void> {
  data = await api(`/api/onboarding/bootstrap${location.search}`)
  document.title = `${data.agentName} · Get started`
  const requested = location.pathname.includes('/step/') ? stepFromPath() : data.progress.allowedStep
  currentStep = requested > data.progress.allowedStep ? data.progress.allowedStep : requested
  replaceUrl(currentStep)
  updateHeaderStatus()
  render()
  if (currentStep === 5 && data.session.whatsappProvider === 'baileys' && data.session.whatsappLinked && (!data.progress.checks.whatsapp || manageBaileysGroup)) {
    void ensureBaileysGroupsLoaded()
  }
}

function replaceUrl(step: Step): void {
  history.replaceState({ step }, '', `/onboarding/step/${step}${location.search}`)
}

function navigate(step: Step): void {
  const allowed = step > data.progress.allowedStep ? data.progress.allowedStep : step
  if (allowed === currentStep) return
  currentStep = allowed
  errorMessage = ''
  history.pushState({ step: allowed }, '', `/onboarding/step/${allowed}${location.search}`)
  render()
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function updateHeaderStatus(): void {
  const status = document.querySelector<HTMLElement>('#setupStatus')
  const label = document.querySelector<HTMLElement>('#statusText')
  if (!status || !label) return
  const isLive = data.progress.readiness === 'live'
  status.dataset.state = isLive ? 'live' : 'setup'
  label.textContent = isLive ? 'Ready on WhatsApp' : data.activationV2 ? `Phase ${phaseNumber(currentStep)} of 3` : `Setup ${data.progress.allowedStep} of 6`
  status.title = isLive ? 'BizzClaw is connected and ready on WhatsApp' : 'Your setup is saved automatically'
}

function stepRail(): string {
  if (data.activationV2) return phaseRail()
  return `<nav class="steprail" aria-label="Onboarding progress"><ol>${STEP_LABELS.map((label, index) => {
    const step = (index + 1) as Step
    const complete = step < data.progress.allowedStep || (step === 6 && data.progress.readiness === 'live')
    const active = step === currentStep
    const reachable = step <= data.progress.allowedStep
    const marker = complete ? checkIcon() : String(step).padStart(2, '0')
    return `<li class="${complete ? 'done' : ''} ${active ? 'active' : ''}">
      ${reachable && !active
        ? `<button type="button" data-step="${step}" aria-label="Go to ${escapeHtml(label)}">`
        : '<span>'}
        <span class="step-marker" aria-hidden="true">${marker}</span>
        <span class="step-label">${escapeHtml(label)}</span>
      ${reachable && !active ? '</button>' : '</span>'}
    </li>`
  }).join('')}</ol></nav>`
}

function phaseNumber(step: Step): number {
  return step === 1 ? 1 : step <= 4 ? 2 : 3
}

function phaseId(step: Step): 'brief' | 'configure' | 'launch' {
  return step === 1 ? 'brief' : step <= 4 ? 'configure' : 'launch'
}

function phaseRail(): string {
  const current = phaseNumber(currentStep)
  const reachablePhase = phaseNumber(data.progress.allowedStep)
  return `<nav class="steprail phase-rail" aria-label="Onboarding phases"><ol>${PHASES.map((phase, index) => {
    const number = index + 1
    const complete = number < current || (number === 3 && data.progress.readiness === 'live')
    const active = number === current
    const reachable = number <= reachablePhase
    return `<li class="${complete ? 'done' : ''} ${active ? 'active' : ''}">
      ${reachable && !active ? `<button type="button" data-step="${phase.firstStep}" aria-label="Go to ${phase.label}">` : '<span>'}
      <span class="step-marker" aria-hidden="true">${complete ? checkIcon() : `0${number}`}</span>
      <span class="step-label">${phase.label}</span>
      ${reachable && !active ? '</button>' : '</span>'}
    </li>`
  }).join('')}</ol></nav>`
}

function shell(title: string, subtitle: string, content: string, options: { launch?: boolean } = {}): string {
  const alert = errorMessage
    ? `<div class="alert alert-error" role="alert" tabindex="-1" id="pageError">${escapeHtml(errorMessage)}</div>`
    : ''
  return `${stepRail()}<div class="experience-grid ${options.launch ? 'launch-grid' : ''}">
    <section class="card primary-panel">
      <div class="eyebrow"><span>${data.activationV2 ? `0${phaseNumber(currentStep)}` : `0${currentStep}`}</span> ${escapeHtml(data.activationV2 ? PHASES[phaseNumber(currentStep) - 1]!.label : (STEP_LABELS[currentStep - 1] ?? ''))}</div>
      <h1>${title}</h1>
      <p class="subtitle">${subtitle}</p>
      ${alert}
      ${content}
    </section>
    ${options.launch ? launchSummary() : agentBrief()}
  </div>`
}

function agentBrief(): string {
  const business = data.session.profile?.business
  const role = data.roles.find((candidate) => candidate.id === data.session.roleId)
  const selectedAutomations = data.session.scheduleTemplates?.length ?? 0
  const connected = data.platforms.filter((platform) => isConnected(platform)).length
  const agentStatus = data.progress.readiness === 'live' ? 'Ready on WhatsApp' : 'Getting BizzClaw ready'

  return `<aside class="brief-panel" aria-label="Your BizzClaw setup summary">
    <div class="brief-header">
      <div class="agent-orb" aria-hidden="true"><img src="/onboarding/bizzclaw-mascot.png" alt="" width="48" height="48" /></div>
      <div><p class="overline">Your BizzClaw teammate</p><h2>${escapeHtml(data.agentName)}</h2></div>
      <span class="brief-status">${escapeHtml(agentStatus)}</span>
    </div>
    <div class="brief-quote">${business?.description
      ? `“${escapeHtml(shorten(business.description, 150))}”`
      : 'Your business brief will appear here as you build it.'}</div>
    <dl class="brief-facts">
      <div><dt>Business</dt><dd>${escapeHtml(business?.name || 'Not added yet')}</dd></div>
      <div><dt>Business goal</dt><dd>${escapeHtml(role?.displayName || 'Not selected yet')}</dd></div>
      <div><dt>Recurring tasks</dt><dd>${data.session.scheduleTemplates === null ? 'Not reviewed yet' : `${selectedAutomations} selected`}</dd></div>
      <div><dt>Connected apps</dt><dd>${connected} connected</dd></div>
    </dl>
    <div class="privacy-note">${shieldIcon()}<p><strong>Your account access stays private.</strong> BizzClaw stores connections securely and never asks for an app password.</p></div>
  </aside>`
}

function launchSummary(): string {
  const checkRows: Array<[boolean, string, string]> = [
    [data.progress.checks.profile, 'Business brief', 'Context saved'],
    [data.progress.checks.role, 'Business goal', roleName()],
    [data.progress.checks.automations, 'Recurring tasks', automationSummary()],
    [data.progress.checks.requiredConnections, 'Connected apps', data.progress.checks.requiredConnections ? connectionSummary() : `${data.progress.missingRequiredPlatforms.length} available later`],
    [data.progress.checks.whatsapp, 'WhatsApp', data.progress.checks.whatsapp ? 'Connected' : 'Action needed'],
  ]
  return `<aside class="brief-panel launch-summary" aria-label="Launch readiness">
    <p class="overline">Launch Readiness</p>
    <h2>Everything in one place</h2>
    <ul class="readiness-list">${checkRows.map(([complete, label, detail]) => `<li class="${complete ? 'complete' : ''}">
      <span class="readiness-icon" aria-hidden="true">${complete ? checkIcon() : '—'}</span>
      <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></span>
    </li>`).join('')}</ul>
    <p class="launch-footnote">You can change your business goal, recurring tasks, and connected apps later from your account.</p>
  </aside>`
}

function renderProfile(): string {
  const profile = data.session.profile
  const business = profile?.business ?? {}
  const assets = profile?.assets ?? {}
  const preview = data.preview
  const previewRecovery = !preview && errorMessage && data.progress.checks.profile && data.activationV2
    ? `<div class="actions preview-recovery"><button class="btn btn-secondary" type="submit">Try preview again</button><button class="btn btn-primary" type="button" data-step="2" data-complete-phase="brief">Continue setup ${arrowIcon()}</button></div>`
    : ''
  const previewPanel = previewLoading
    ? `<section class="preview-card preview-loading" aria-live="polite"><span class="status-spinner" aria-hidden="true"></span><div><p class="overline">Creating your first advantage</p><h2>BizzClaw is turning your brief into an action plan…</h2><p>This normally takes less than 20 seconds.</p></div></section>`
    : preview
      ? `<section class="preview-card" aria-labelledby="previewTitle">
          <div class="preview-heading"><div><p class="overline">Your first BizzClaw insight</p><h2 id="previewTitle" tabindex="-1">${escapeHtml(preview.headline)}</h2></div><span class="tag">${preview.source === 'ai' ? 'Personalized' : 'Starter plan'}</span></div>
          <p class="preview-insight">${escapeHtml(preview.insight)}</p>
          <ol class="opportunity-list">${preview.opportunities.map((opportunity) => `<li>${escapeHtml(opportunity)}</li>`).join('')}</ol>
          <div class="suggested-brief"><p class="overline">Suggested first brief</p><p>“${escapeHtml(preview.suggestedFirstBrief)}”</p></div>
          <div class="actions preview-actions"><button class="btn btn-primary" type="button" data-step="2" data-complete-phase="brief">Choose your business goal ${arrowIcon()}</button><button class="btn btn-secondary" type="submit">Refresh preview</button></div>
        </section>`
      : ''
  return shell(
    preview ? 'Your first advantage is ready' : 'Get useful direction in under 90 seconds',
    preview ? 'This is a starting point built from the brief you provided—not from live account data.' : 'Tell BizzClaw what you do. You will see a personalized opportunity brief before connecting any account.',
    `<form id="profileForm">
      <div class="form-section">
        ${input('Business or project name', 'name', business.name ?? '', 'Northstar Studio…', true, 'text', 'organization', 'This is how BizzClaw will refer to the business.')}
        <div class="field">
          <div class="label-row"><label for="description">What does the business do?</label><span>Required</span></div>
          <textarea id="description" name="description" required minlength="10" autocomplete="off" placeholder="We help independent retailers turn customer conversations into repeat revenue…">${escapeHtml(business.description ?? '')}</textarea>
          <p class="field-hint">One sentence is enough: what you sell and the result customers get.</p>
        </div>
        ${input('Website', 'website', assets.website ?? '', 'https://yourcompany.com…', false, 'url', 'url', 'Saved as a reference only. BizzClaw does not claim to have visited it.')}
      </div>
      <details class="personalization-details" ${business.targetAudience || assets.instagram?.handle || assets.tiktok?.handle ? 'open' : ''}>
        <summary>Improve personalization <span>Optional</span></summary>
        <div class="personalization-fields">
          ${input('Who is it for?', 'targetAudience', business.targetAudience ?? '', 'Ambitious founders at growing service businesses…', false, 'text', 'off')}
          <div class="field-row">
            ${input('Instagram', 'instagram', assets.instagram?.handle ?? '', '@yourcompany…', false, 'text', 'off')}
            ${input('TikTok', 'tiktok', assets.tiktok?.handle ?? '', '@yourcompany…', false, 'text', 'off')}
          </div>
        </div>
      </details>
      <input type="hidden" name="industry" value="${escapeHtml(business.industry ?? 'other')}" />
      <input type="hidden" name="brandVoice" value="${escapeHtml(business.brandVoice ?? '')}" />
      <input type="hidden" name="goals" value="${escapeHtml(business.goals?.[0] ?? 'brand_awareness')}" />
      ${preview ? '' : previewRecovery || formActions('', data.activationV2 ? 'Create My Preview' : 'Save Business Brief')}
      ${previewPanel}
    </form>`,
  )
}

function renderRole(): string {
  return shell(
    'Choose the result you want most',
    'Start with one business goal. BizzClaw will shape its plans, recommendations, and first tasks around that outcome.',
    `<form id="roleForm">
      <fieldset class="option-list"><legend class="sr-only">Available business goals</legend>
        ${data.roles.map((role) => optionCard({
          name: 'roleId',
          value: role.id,
          checked: data.session.roleId === role.id,
          icon: roleIcon(role.id),
          title: role.displayName,
          tag: data.session.roleId === role.id ? 'Selected' : '',
          description: role.description,
          chips: role.tools.map((tool) => ({
            label: data.activationV2 && tool.required ? `${tool.displayName} · live data` : tool.displayName,
            core: tool.required && !data.activationV2,
          })),
          required: true,
        })).join('')}
      </fieldset>
      ${formActions('1', 'Choose business goal')}
    </form>`,
  )
}

function renderAutomations(): string {
  const selected = new Set(data.session.scheduleTemplates ?? [])
  return shell(
    'Choose what should happen automatically',
    'Select the useful work you want BizzClaw to prepare and deliver on a schedule. Starting with none is completely fine.',
    `<form id="automationForm">
      <fieldset class="option-list"><legend class="sr-only">Available recurring tasks</legend>
        ${data.templates.length ? data.templates.map((template) => optionCard({
          type: 'checkbox',
          name: 'templates',
          value: template.id,
          checked: selected.has(template.id),
          icon: routineIcon(),
          title: template.title,
          tag: template.cadence,
          description: template.description,
        })).join('') : '<div class="empty-state"><strong>No suggested recurring tasks for this goal yet.</strong><p>You can still ask BizzClaw to schedule reports and reminders in WhatsApp.</p></div>'}
      </fieldset>
      <p class="selection-note">Nothing runs automatically unless you select it. You can change these tasks later.</p>
      ${formActions('2', 'Save recurring tasks')}
    </form>`,
  )
}

function renderPlatforms(): string {
  const missing = new Set(data.progress.missingRequiredPlatforms)
  const canContinue = data.activationV2 || data.progress.checks.requiredConnections
  return shell(
    data.activationV2 ? 'Connect apps when they add value' : 'Grant only the access it needs',
    data.activationV2 ? 'Connected apps let BizzClaw work from live business data. You can continue now and connect them later when a task needs them.' : 'Connect the services that power this business goal. BizzClaw never asks for your app password.',
    `<div class="platform-list" id="platformList" aria-live="polite">
      ${data.platforms.length ? data.platforms.map((platform) => {
        const connected = isConnected(platform)
        const unavailable = !platform.authUrl || platform.authUrl === '#'
        return `<article class="platform-row ${connected ? 'connected' : ''} ${unavailable && !connected ? 'unavailable' : ''}">
          <span class="platform-icon" aria-hidden="true">${platformIcon(platform.id)}</span>
          <div class="platform-copy">
            <div class="platform-heading"><h2>${escapeHtml(platform.displayName)}</h2><span class="badge ${platform.required ? 'badge-required' : 'badge-optional'}">${platform.required ? (data.activationV2 ? 'Unlocks live results' : 'Required') : 'Adds more context'}</span></div>
            <p>${escapeHtml(platformOutcome(platform.id))}</p>
            ${connected ? '<span class="connection-state">' + checkIcon() + ' Connected</span>' : ''}
            ${unavailable && !connected ? '<span class="connection-state error-state">Connection unavailable. Contact BizzClaw support.</span>' : ''}
          </div>
          ${connected && platform.authUrl
            ? `<a class="btn btn-tertiary" href="${escapeHtml(platform.authUrl)}">Reconnect</a>`
            : platform.authUrl && platform.authUrl !== '#'
              ? `<a class="btn btn-secondary" data-integration="${escapeHtml(platform.id)}" href="${escapeHtml(platform.authUrl)}">Connect ${escapeHtml(platform.displayName)}</a>`
              : ''}
        </article>`
      }).join('') : '<div class="empty-state"><strong>No connected apps are needed to begin.</strong><p>BizzClaw can start with your business brief and WhatsApp.</p></div>'}
    </div>
    ${missing.size ? `<div class="attention-note">${attentionIcon()}<p>${data.activationV2 ? `<strong>You can connect later.</strong> ${escapeHtml(missingPlatformNames().join(' and '))} will unlock live account insights when you need them.` : `<strong>${missing.size} required connection${missing.size === 1 ? '' : 's'} remaining.</strong> Connect ${escapeHtml(missingPlatformNames().join(' and '))} to continue.`}</p></div>` : ''}
    <div class="actions"><button class="btn btn-secondary" type="button" data-step="3">Back</button><button class="btn btn-primary" type="button" data-step="5" data-complete-phase="configure" ${data.activationV2 && missing.size ? 'data-skip-integrations="true"' : ''} ${canContinue ? '' : 'disabled'}>${canContinue ? 'Continue to WhatsApp' : 'Connect required apps'} ${arrowIcon()}</button></div>`,
  )
}

function renderWhatsApp(): string {
  const selected = data.session.whatsappProvider
  const deviceLinked = data.session.whatsappLinked
  const needsGroupPicker = selected === 'baileys' && deviceLinked && (!data.progress.checks.whatsapp || manageBaileysGroup)
  const linked = deviceLinked && data.progress.checks.whatsapp
  const twilioAvailable = data.whatsapp.twilio.enabled
  const providerPicker = `<form id="providerForm">
    <fieldset class="option-list provider-list"><legend class="sr-only">Choose a WhatsApp setup</legend>
      ${optionCard({ name: 'whatsappProvider', value: 'twilio', checked: selected === 'twilio', icon: managedIcon(), title: 'Use the BizzClaw WhatsApp number', tag: 'Recommended', description: twilioAvailable ? 'The fastest route. Send one message to the managed business number and start working immediately.' : 'The managed number is not available in this environment.', disabled: !twilioAvailable, required: true })}
      ${optionCard({ name: 'whatsappProvider', value: 'baileys', checked: selected === 'baileys', icon: linkedDeviceIcon(), title: 'Link your own WhatsApp number', tag: 'Advanced', description: 'Use Linked Devices so BizzClaw can work from a number you control.', required: true })}
    </fieldset>
    ${!deviceLinked ? `<div class="provider-submit"><button class="btn btn-secondary" type="submit">Use Selected Setup</button></div>` : ''}
  </form>`

  const panel = !selected
    ? `<div class="connect-stage empty-connect">${whatsappIcon()}<h2>Choose where the conversation starts</h2><p>Select one setup above. We will verify the connection before launch.</p></div>`
    : needsGroupPicker
      ? renderBaileysGroupPicker()
      : linked
        ? `<div class="connect-stage connected-stage">${successSeal()}<p class="overline">Connection verified</p><h2>WhatsApp is ready</h2><p>${selected === 'baileys' ? `BizzClaw can work only in <strong>${escapeHtml(data.whatsapp.baileys.homeGroupSubject || 'your selected group')}</strong>. In that group, begin a request with <strong>@bizzclaw</strong>.` : 'BizzClaw can now receive your requests and deliver results in the conversation.'}</p><div class="inline-actions">${selected === 'baileys' ? '<button class="btn btn-secondary" type="button" id="manageGroupBtn">Change or create group</button>' : ''}<button class="btn btn-tertiary danger-action" type="button" id="disconnectBtn">Disconnect WhatsApp</button><button class="btn btn-primary" type="button" data-step="6">Choose first result</button></div></div>`
        : selected === 'twilio'
          ? renderManagedWhatsApp()
          : renderLinkedWhatsApp()

  return shell(
    'Choose where BizzClaw should reach you',
    'WhatsApp is where you send requests, approve important actions, and receive finished work.',
    `${deviceLinked ? '' : providerPicker}${panel}<div class="actions compact-actions"><button class="btn btn-secondary" type="button" data-step="4">Back</button><span></span></div>`,
  )
}

function renderManagedWhatsApp(): string {
  const digits = data.whatsapp.twilio.digits
  const code = data.whatsapp.twilio.connectCode
  if (!data.whatsapp.twilio.enabled || !digits || !data.whatsapp.twilio.waLink) {
    return `<div class="connect-stage error-connect">${attentionIcon()}<h2>The managed number is unavailable</h2><p>Choose your own linked number or contact BizzClaw support.</p></div>`
  }
  return `<div class="connect-stage managed-connect">
    <div class="connect-number"><span>Managed business number</span><strong translate="no">+${escapeHtml(digits)}</strong></div>
    <ol class="connect-steps"><li><span>1</span><p>Open the prefilled WhatsApp conversation.</p></li><li><span>2</span><p>Send the message${code ? ` containing <strong translate="no">${escapeHtml(code)}</strong>` : ''}.</p></li><li><span>3</span><p>Keep this page open while BizzClaw verifies the connection.</p></li></ol>
    <a href="${escapeHtml(data.whatsapp.twilio.waLink)}" class="btn btn-whatsapp">${whatsappIcon()} Open WhatsApp</a>
    <div class="live-status" id="linkStatus" role="status" aria-live="polite"><span class="status-spinner" aria-hidden="true"></span><span>Waiting for your message…</span></div>
  </div>`
}

function renderLinkedWhatsApp(): string {
  const stateCopy = whatsappConnectionState === 'error'
    ? 'The QR service disconnected. Refresh this setup or choose the managed number.'
    : whatsappConnectionState === 'reconnecting'
      ? 'Reconnecting to the secure QR service…'
      : 'Preparing a secure QR code…'
  return `<div class="connect-stage linked-connect">
    <div><p class="overline">On your phone</p><h2>WhatsApp → Linked Devices → Link a Device</h2><p>Scan the code below. It refreshes automatically and is used only to connect BizzClaw.</p></div>
    <div class="qr-frame" id="qrBox">
      ${data.whatsapp.baileys.latestQr ? `<img src="${escapeHtml(data.whatsapp.baileys.latestQr)}" alt="WhatsApp linking QR code" width="232" height="232" />` : '<span class="qr-placeholder" aria-hidden="true"><span class="status-spinner"></span></span>'}
      <p id="qrHint" role="status" aria-live="polite">${escapeHtml(data.whatsapp.baileys.latestQr ? 'Scan this code with WhatsApp.' : stateCopy)}</p>
    </div>
  </div>`
}

function renderBaileysGroupPicker(): string {
  const state = baileysGroupsState
  if (baileysGroupsLoading || !state) {
    return `<div class="connect-stage linked-connect">
      <div><p class="overline">WhatsApp verified</p><h2>Choose your BizzClaw group</h2><p>Choose the one group where BizzClaw should respond.</p></div>
      <div class="status-panel">${baileysGroupsLoading ? 'Loading your groups…' : 'Preparing the group picker…'}</div>
      <div class="actions"><button class="btn btn-secondary" type="button" id="refreshGroups">Refresh groups</button></div>
    </div>`
  }

  return `<div class="connect-stage linked-connect">
    <div><p class="overline">WhatsApp verified</p><h2>Choose your BizzClaw workspace</h2><p>Use a group you already have, or create a fresh one. BizzClaw responds only in the workspace you confirm.</p></div>
    <div class="group-mode-switch" role="group" aria-label="Choose group setup">
      <button class="group-mode ${baileysGroupMode === 'existing' ? 'active' : ''}" type="button" id="useExistingGroup" aria-pressed="${baileysGroupMode === 'existing'}">Use existing group</button>
      <button class="group-mode ${baileysGroupMode === 'create' ? 'active' : ''}" type="button" id="createNewGroup" aria-pressed="${baileysGroupMode === 'create'}">Create new group</button>
    </div>
    ${baileysGroupMode === 'existing' ? `<form id="groupForm" class="group-workspace-form">
      <div class="field"><label for="groupJid">Your WhatsApp groups</label><select id="groupJid" name="groupJid" required>
        <option value="">Select a group…</option>
        ${state.groups.map((group) => `<option value="${escapeHtml(group.jid)}" ${state.selected === group.jid ? 'selected' : ''}>${escapeHtml(group.subject || 'Unnamed group')} · ${group.size} members</option>`).join('')}
      </select></div>
      ${state.groups.length ? '<p class="field-hint">Only this group will be able to talk with BizzClaw.</p>' : '<div class="empty-state compact-empty"><strong>No groups found yet.</strong><p>Create a new workspace here, or create a group in WhatsApp and refresh this list.</p></div>'}
      ${baileysGroupsError ? `<p class="field-hint error">${escapeHtml(baileysGroupsError)}</p>` : ''}
      <div class="actions">
        <button class="btn btn-secondary" type="button" id="refreshGroups">Refresh</button>
        <button class="btn btn-primary" type="submit" ${state.groups.length ? '' : 'disabled'}>Use this group</button>
      </div>
    </form>` : `<form id="createGroupForm" class="group-workspace-form">
      <div class="field"><label for="groupName">Group name</label><input id="groupName" name="groupName" type="text" maxlength="100" value="${escapeHtml(`BizzClaw — ${data.session.profile?.business?.name || 'My business'}`)}" required /></div>
      <div class="field"><label for="participantPhone">Invite one trusted person</label><input id="participantPhone" name="participantPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+972 50 123 4567" required /><p class="field-hint">WhatsApp requires one other person when a group is created. Include their country code; this onboarding form does not save the number.</p></div>
      ${baileysGroupsError ? `<p class="field-hint error">${escapeHtml(baileysGroupsError)}</p>` : ''}
      <div class="actions"><button class="btn btn-secondary" type="button" id="cancelCreateGroup">Use existing group</button><button class="btn btn-primary" type="submit">Create workspace</button></div>
    </form>`}
  </div>`
}

async function ensureBaileysGroupsLoaded(): Promise<void> {
  if (baileysGroupsLoading) return
  if (baileysGroupsState) return

  baileysGroupsLoading = true
  baileysGroupsError = ''
  render()
  try {
    const res = await fetch('/api/onboarding/baileys-groups')
    const json = await res.json() as { groups?: BaileysGroup[]; selected?: string | null; error?: string }
    if (!res.ok) throw new Error(json.error || 'Could not load groups')
    baileysGroupsState = { groups: json.groups ?? [], selected: json.selected ?? null }
    if (!baileysGroupsState.groups.length) baileysGroupMode = 'create'
  } catch (error) {
    baileysGroupsError = error instanceof Error ? error.message : 'Could not load groups'
  } finally {
    baileysGroupsLoading = false
    render()
  }
}

async function submitBaileysGroup(groupJid: string): Promise<void> {
  const payload = { groupJid }
  try {
    errorMessage = ''
    const res = await fetch('/api/onboarding/baileys-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json() as { ok?: boolean; error?: string }
    if (!res.ok) throw new Error(json.error || 'Could not save group')
    data = await api(`/api/onboarding/bootstrap${location.search}`)
    updateHeaderStatus()
    manageBaileysGroup = false
    const nextStep = data.progress.allowedStep
    currentStep = nextStep
    const url = new URL(location.href)
    url.searchParams.delete('manage')
    history.pushState({ step: currentStep }, '', `/onboarding/step/${currentStep}${url.search}`)
    render()
  } catch (error) {
    showError(error instanceof Error ? error : new Error('Could not save group. Try again.'), 'Could not save group. Try again.')
  }
}

async function createBaileysGroup(form: HTMLFormElement): Promise<void> {
  const groupName = formValue(form, 'groupName')
  const participantPhone = formValue(form, 'participantPhone')
  if (!confirm(`Create “${groupName}” and invite ${participantPhone}?`)) return
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')
  setSubmitting(button, true)
  try {
    errorMessage = ''
    await postJson('/api/onboarding/baileys-group-create', { groupName, participantPhone })
    data = await api(`/api/onboarding/bootstrap${location.search}`)
    baileysGroupsState = null
    manageBaileysGroup = false
    updateHeaderStatus()
    currentStep = data.progress.allowedStep
    const url = new URL(location.href)
    url.searchParams.delete('manage')
    history.pushState({ step: currentStep }, '', `/onboarding/step/${currentStep}${url.search}`)
    render()
  } catch (error) {
    showError(error instanceof Error ? error : new Error('Could not create the group. Try again.'), 'Could not create the group. Try again.')
  } finally {
    setSubmitting(button, false)
  }
}

function renderDone(): string {
  if (data.progress.readiness !== 'live') {
    return shell(
      'Your setup needs one more step',
      'BizzClaw checked the saved setup and found one item that still needs attention.',
      `<div class="attention-note">${attentionIcon()}<p><strong>${escapeHtml(readinessTitle(data.progress.readiness))}</strong> Return to the highlighted stage to finish safely.</p></div><div class="actions"><span></span><button class="btn btn-primary" type="button" data-step="${data.progress.allowedStep}">Finish Setup</button></div>`,
    )
  }

  const role = data.roles.find((candidate) => candidate.id === data.session.roleId)
  const tasks = starterTasksForRole(data.session.roleId)
  const usesLinkedNumber = data.session.whatsappProvider === 'baileys'

  return shell(
    'BizzClaw is ready on WhatsApp',
    `${escapeHtml(role?.displayName ?? 'Your business goal')} is set. Choose one useful result to start with.`,
    `<div class="launch-hero">${successSeal()}<div><p class="overline">Ready to start</p><h2>Begin with one real business result.</h2><p>${usesLinkedNumber ? `Choose a useful brief, then send it to ${escapeHtml(data.whatsapp.baileys.homeGroupSubject || 'your selected BizzClaw group')}. The @bizzclaw prompt is included.` : 'Choose meaningful work, not a test prompt. BizzClaw already has the context you saved.'}</p></div></div>
    <fieldset class="starter-list"><legend>Choose your first result</legend>${tasks.map((task, index) => `<label class="starter-task"><input type="radio" name="starterTask" value="${index}" ${index === 0 ? 'checked' : ''} /><span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.prompt)}</small></span><span class="selection-control" aria-hidden="true">${checkIcon()}</span></label>`).join('')}</fieldset>
    <div class="launch-actions"><a id="firstBriefAction" href="${escapeHtml(firstBriefUrl(tasks[0]!.prompt))}" target="_blank" rel="noopener" class="btn btn-primary btn-large">${usesLinkedNumber ? 'Open brief in WhatsApp' : 'Send to BizzClaw in WhatsApp'} ${arrowIcon()}</a><a href="/dashboard" class="btn btn-secondary btn-large">Go to BizzClaw home</a></div>`,
    { launch: true },
  )
}

function starterTasksForRole(roleId: string | null): Array<{ title: string; prompt: string }> {
  const shared = [
    { title: 'Find this week’s highest-leverage move', prompt: 'Review my current marketing position and tell me the three actions that would create the most momentum this week.' },
    { title: 'Sharpen the message', prompt: 'Turn my business brief into one clear positioning statement, three supporting messages, and a practical way to test them.' },
  ]
  const specialist: Record<string, { title: string; prompt: string }> = {
    'marketing-manager': { title: 'Build a 30-day campaign plan', prompt: 'Create a focused 30-day marketing plan for my business with one campaign idea, weekly priorities, and the first task to complete today.' },
    'creative-director': { title: 'Develop a campaign concept', prompt: 'Create one distinctive campaign concept for my business, including the central idea, visual direction, and three executions.' },
    'ads-analyst': { title: 'Create a measurement plan', prompt: 'Create a paid-growth measurement plan for my business. Tell me what to measure first, the decisions each metric supports, and what data you need from me.' },
    'social-media-manager': { title: 'Plan the next two weeks of content', prompt: 'Create a two-week social content plan for my business with clear themes, post ideas, and the first three posts drafted.' },
    'gtm-operator': { title: 'Find the first path to sales conversations', prompt: 'Use my business brief to choose the audience and channels most likely to create qualified sales conversations, then give me a seven-day action plan.' },
    'personal-assistant-dev': { title: 'Build my operating priorities', prompt: 'Turn my business brief into a prioritized operating plan for this week, including the three tasks you can help me complete first.' },
  }
  const candidates = [
    ...(data.preview?.suggestedFirstBrief
      ? [{ title: 'Use BizzClaw’s suggested brief', prompt: data.preview.suggestedFirstBrief }]
      : []),
    specialist[roleId ?? ''] ?? shared[0]!,
    ...shared,
  ]
  return candidates.filter((task, index) => (
    candidates.findIndex((candidate) => candidate.prompt === task.prompt) === index
  )).slice(0, 3)
}

function firstBriefUrl(prompt: string): string {
  const digits = data.session.whatsappProvider === 'twilio' ? data.whatsapp.twilio.digits : ''
  const message = data.session.whatsappProvider === 'baileys' ? `@bizzclaw ${prompt}` : prompt
  return digits ? `https://wa.me/${encodeURIComponent(digits)}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`
}

function input(
  label: string,
  name: string,
  value: string,
  placeholder: string,
  required = false,
  type = 'text',
  autocomplete = 'off',
  hint = '',
): string {
  return `<div class="field"><div class="label-row"><label for="${escapeHtml(name)}">${escapeHtml(label)}</label>${required ? '<span>Required</span>' : ''}</div><input type="${escapeHtml(type)}" id="${escapeHtml(name)}" name="${escapeHtml(name)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="${escapeHtml(autocomplete)}" ${type === 'text' && autocomplete === 'off' ? 'spellcheck="false"' : ''} ${required ? 'required' : ''} />${hint ? `<p class="field-hint">${escapeHtml(hint)}</p>` : ''}</div>`
}

function optionCard(options: {
  type?: 'radio' | 'checkbox'
  name: string
  value: string
  checked: boolean
  icon: string
  title: string
  tag?: string
  description: string
  chips?: { label: string; core: boolean }[]
  disabled?: boolean
  required?: boolean
}): string {
  return `<label class="option-card ${options.disabled ? 'disabled' : ''}">
    <input type="${options.type ?? 'radio'}" name="${escapeHtml(options.name)}" value="${escapeHtml(options.value)}" ${options.checked ? 'checked' : ''} ${options.disabled ? 'disabled' : ''} ${options.required ? 'required' : ''} />
    <span class="option-icon" aria-hidden="true">${options.icon}</span>
    <span class="option-info"><span class="option-top"><strong>${escapeHtml(options.title)}</strong>${options.tag ? `<span class="tag">${escapeHtml(options.tag)}</span>` : ''}</span><span class="option-description">${escapeHtml(options.description)}</span>${options.chips?.length ? `<span class="chips">${options.chips.map((chip) => `<span class="chip ${chip.core ? 'core' : ''}">${escapeHtml(chip.label)}${chip.core ? '<span class="sr-only"> required</span>' : ''}</span>`).join('')}</span>` : ''}</span>
    <span class="selection-control" aria-hidden="true">${checkIcon()}</span>
  </label>`
}

function formActions(backStep: string, submitLabel: string): string {
  return `<div class="actions">${backStep ? `<button class="btn btn-secondary" type="button" data-step="${backStep}">Back</button>` : '<span></span>'}<button class="btn btn-primary" type="submit" data-submit-label="${escapeHtml(submitLabel)}">${escapeHtml(submitLabel)} ${arrowIcon()}</button></div>`
}

function render(): void {
  stopLiveWork()
  updateHeaderStatus()
  app.innerHTML = currentStep === 1 ? renderProfile()
    : currentStep === 2 ? renderRole()
      : currentStep === 3 ? renderAutomations()
        : currentStep === 4 ? renderPlatforms()
          : currentStep === 5 ? renderWhatsApp()
            : renderDone()
  bindEvents()
  if (currentStep === 4) startPlatformPolling()
  if (currentStep === 5) startWhatsAppLiveUpdates()
  if (errorMessage) window.requestAnimationFrame(() => document.querySelector<HTMLElement>('#pageError')?.focus())
  const phase = phaseId(currentStep)
  if (data.activationV2 && phase !== lastTrackedPhase) {
    lastTrackedPhase = phase
    trackActivation('onboarding_phase_viewed', { phase, step: currentStep })
  }
  if (currentStep === 6 && data.progress.readiness === 'live') trackActivation('launch_completed', { phase: 'launch', step: 6 })
}

function bindEvents(): void {
  app.querySelectorAll<HTMLElement>('[data-step]').forEach((element) => {
    element.addEventListener('click', () => {
      const completedPhase = element.dataset.completePhase
      if (completedPhase) trackActivation('onboarding_phase_completed', { phase: completedPhase, step: currentStep })
      if (element.dataset.skipIntegrations) trackActivation('integration_skipped', { phase: 'configure', step: 4 })
      navigate(clampStep(Number(element.dataset.step)))
    })
  })
  app.querySelectorAll<HTMLAnchorElement>('[data-integration]').forEach((link) => {
    link.addEventListener('click', () => trackActivation('integration_started', { phase: 'configure', step: 4, platform: link.dataset.integration }))
  })
  app.querySelector<HTMLFormElement>('#profileForm')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    await submitProfile(event.currentTarget)
  })
  app.querySelector<HTMLFormElement>('#roleForm')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    if (await submit(() => api('/api/onboarding/role', { roleId: formValue(form, 'roleId') }), 3, form)) {
      trackActivation('specialist_selected', { phase: 'configure', step: 2 })
    }
  })
  app.querySelector<HTMLFormElement>('#automationForm')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const templates = checkedValues(form, 'templates')
    if (await submit(() => api('/api/onboarding/automations', { templates }), 4, form)) {
      trackActivation(templates.length ? 'routine_configured' : 'routine_skipped', { phase: 'configure', step: 3 })
    }
  })
  app.querySelector<HTMLFormElement>('#providerForm')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const provider = formValue(form, 'whatsappProvider')
    if (await submit(() => api('/api/onboarding/whatsapp-provider', { whatsappProvider: provider }), 5, form)) {
      trackActivation('whatsapp_connection_started', { phase: 'launch', step: 5, outcome: provider })
    }
  })
  app.querySelectorAll<HTMLInputElement>('input[name="starterTask"]').forEach((input) => {
    input.addEventListener('change', () => {
      const task = starterTasksForRole(data.session.roleId)[Number(input.value)]
      const action = app.querySelector<HTMLAnchorElement>('#firstBriefAction')
      if (task && action) action.href = firstBriefUrl(task.prompt)
    })
  })
  app.querySelector<HTMLAnchorElement>('#firstBriefAction')?.addEventListener('click', () => {
    trackActivation('first_brief_opened', { phase: 'launch', step: 6 })
  })
  app.querySelector<HTMLFormElement>('#groupForm')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const groupJid = formValue(form, 'groupJid')
    if (!groupJid) {
      showError(new Error('Choose a group to continue'), 'Choose a group to continue')
      return
    }
    await submitBaileysGroup(groupJid)
  })
  app.querySelector<HTMLFormElement>('#groupForm')?.addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement | null
    if (!target || target.name !== 'groupJid') return
    if (!baileysGroupsState) return
    baileysGroupsState = { ...baileysGroupsState, selected: target.value }
    render()
  })
  app.querySelector<HTMLButtonElement>('#refreshGroups')?.addEventListener('click', () => {
    baileysGroupsState = null
    void ensureBaileysGroupsLoaded()
  })
  app.querySelector<HTMLButtonElement>('#useExistingGroup')?.addEventListener('click', () => {
    baileysGroupMode = 'existing'
    render()
  })
  app.querySelector<HTMLButtonElement>('#createNewGroup')?.addEventListener('click', () => {
    baileysGroupMode = 'create'
    render()
  })
  app.querySelector<HTMLButtonElement>('#cancelCreateGroup')?.addEventListener('click', () => {
    baileysGroupMode = 'existing'
    render()
  })
  app.querySelector<HTMLFormElement>('#createGroupForm')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    await createBaileysGroup(event.currentTarget)
  })
  app.querySelector<HTMLButtonElement>('#manageGroupBtn')?.addEventListener('click', () => {
    manageBaileysGroup = true
    baileysGroupsState = null
    render()
    void ensureBaileysGroupsLoaded()
  })
  app.querySelector<HTMLButtonElement>('#disconnectBtn')?.addEventListener('click', async () => {
    if (!confirm('Disconnect WhatsApp? BizzClaw will stop responding until you link it again.')) return
    try {
      data = await api('/api/onboarding/whatsapp-disconnect', {})
      updateHeaderStatus()
      currentStep = 5
      replaceUrl(5)
      render()
    } catch (error) {
      showError(error, 'Could not disconnect WhatsApp. Try again.')
    }
  })
}

async function submitProfile(form: HTMLFormElement): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')
  setSubmitting(button, true)
  try {
    errorMessage = ''
    data = await api('/api/onboarding/profile', {
      name: formValue(form, 'name'),
      industry: formValue(form, 'industry'),
      description: formValue(form, 'description'),
      goals: checkedValues(form, 'goals'),
      targetAudience: formValue(form, 'targetAudience'),
      brandVoice: formValue(form, 'brandVoice'),
      website: formValue(form, 'website'),
      instagram: formValue(form, 'instagram'),
      tiktok: formValue(form, 'tiktok'),
    })
    updateHeaderStatus()
    if (!data.activationV2) {
      navigate(2)
      return
    }
    previewLoading = true
    render()
    const response = await postJson<{ preview: OnboardingPreview }>(
      '/api/onboarding/preview',
      {},
      AbortSignal.timeout(30_000),
    )
    data.preview = response.preview
    previewLoading = false
    render()
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('#previewTitle')?.focus())
  } catch (error) {
    previewLoading = false
    trackActivation('preview_failed', { phase: 'brief', step: 1 })
    const timedOut = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
    showError(
      new Error(timedOut
        ? 'Your preview is taking longer than expected. Your business brief is saved—try again or continue setup.'
        : 'We couldn’t create your preview right now. Your business brief is saved—try again or continue setup.'),
      'Your business brief is saved—try again or continue setup.',
    )
  } finally {
    setSubmitting(button, false)
  }
}

async function submit(request: () => Promise<Bootstrap>, nextStep: Step, form: HTMLFormElement): Promise<boolean> {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')
  setSubmitting(button, true)
  try {
    errorMessage = ''
    data = await request()
    updateHeaderStatus()
    const allowedNext = nextStep > data.progress.allowedStep ? data.progress.allowedStep : nextStep
    currentStep = allowedNext
    history.pushState({ step: allowedNext }, '', `/onboarding/step/${allowedNext}${location.search}`)
    render()
    return true
  } catch (error) {
    showError(error, 'Something went wrong. Try again.')
    return false
  } finally {
    setSubmitting(button, false)
  }
}

function setSubmitting(button: HTMLButtonElement | null, submitting: boolean): void {
  if (!button) return
  button.disabled = submitting
  if (submitting) {
    button.dataset.originalLabel = button.textContent ?? ''
    button.textContent = 'Saving…'
  } else if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel
  }
}

function showError(error: unknown, fallback: string): void {
  errorMessage = error instanceof Error ? error.message : fallback
  render()
}

function startPlatformPolling(): void {
  statusTimer = window.setInterval(async () => {
    const status = await fetchStatus()
    if (!status || currentStep !== 4) return
    const changed = JSON.stringify(status.connections) !== JSON.stringify(data.session.connections)
      || status.progress.allowedStep !== data.progress.allowedStep
    if (!changed) return
    const previousConnections = { ...data.session.connections }
    data.session.connections = status.connections
    data.progress = status.progress
    for (const platform of data.platforms) platform.status = status.connections[platform.id] ?? platform.status
    for (const platform of data.platforms) {
      const before = previousConnections[platform.id]
      const after = status.connections[platform.id]
      if (before !== 'connected' && after === 'connected') trackActivation('integration_connected', { phase: 'configure', step: 4, platform: platform.id })
      if (before !== 'error' && after === 'error') trackActivation('integration_failed', { phase: 'configure', step: 4, platform: platform.id })
    }
    updateHeaderStatus()
    render()
  }, 3000)
}

function startWhatsAppLiveUpdates(): void {
  if (data.session.whatsappLinked) return
  if (data.session.whatsappProvider === 'baileys') {
    qrEvents = new EventSource(`/onboarding/qr-stream?session=${encodeURIComponent(data.session.sessionId)}`)
    qrEvents.onopen = () => {
      whatsappConnectionState = 'waiting'
      setQrHint('Preparing a secure QR code…')
    }
    qrEvents.onmessage = (event) => {
      let payload: { type?: string; qr?: string }
      try {
        payload = JSON.parse(event.data) as { type?: string; qr?: string }
      } catch {
        return
      }
      if (payload.type === 'qr' && payload.qr) updateQr(payload.qr)
      if (payload.type === 'linked') void completeWhatsAppLink()
      if (payload.type === 'loggedOut') {
        whatsappConnectionState = 'reconnecting'
        setQrHint('WhatsApp disconnected. Waiting for a fresh code…')
      }
    }
    qrEvents.onerror = () => {
      whatsappConnectionState = 'error'
      setQrHint('The QR service disconnected. Refresh this setup or choose the managed number.')
    }
  }
  if (data.session.whatsappProvider === 'twilio') {
    statusTimer = window.setInterval(async () => {
      const status = await fetchStatus()
      if (status?.whatsappLinked) await completeWhatsAppLink(status)
    }, 2500)
  }
}

async function completeWhatsAppLink(existingStatus?: StatusResponse): Promise<void> {
  const status = existingStatus ?? await fetchStatus()
  if (!status?.whatsappLinked) return
  data.session.whatsappLinked = true
  data.progress = status.progress
  trackActivation('whatsapp_connection_verified', { phase: 'launch', step: 5, outcome: data.session.whatsappProvider ?? '' })
  updateHeaderStatus()
  if (data.session.whatsappProvider === 'baileys' && !data.progress.checks.whatsapp) {
    void ensureBaileysGroupsLoaded()
    render()
    return
  }
  const label = document.querySelector<HTMLElement>('#linkStatus span:last-child')
  if (label) label.textContent = 'Connection verified. Opening launch review…'
  window.setTimeout(() => {
    currentStep = 6
    history.pushState({ step: 6 }, '', `/onboarding/step/6${location.search}`)
    render()
  }, prefersReducedMotion() ? 0 : 500)
}

function updateQr(src: string): void {
  const box = document.querySelector<HTMLElement>('#qrBox')
  if (!box) return
  let image = box.querySelector<HTMLImageElement>('img')
  if (!image) {
    image = document.createElement('img')
    image.alt = 'WhatsApp linking QR code'
    image.width = 232
    image.height = 232
    box.querySelector('.qr-placeholder')?.replaceWith(image)
  }
  image.src = src
  setQrHint('Scan this code with WhatsApp. It refreshes automatically.')
}

function setQrHint(message: string): void {
  const hint = document.querySelector<HTMLElement>('#qrHint')
  if (hint) hint.textContent = message
}

function stopLiveWork(): void {
  qrEvents?.close()
  qrEvents = null
  if (statusTimer !== null) window.clearInterval(statusTimer)
  statusTimer = null
}

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? '')
}

function checkedValues(form: HTMLFormElement, name: string): string[] {
  return new FormData(form).getAll(name).map(String)
}

function isConnected(platform: Platform): boolean {
  return data.session.connections[platform.id] === 'connected' || platform.status === 'connected'
}

function roleName(): string {
  return data.roles.find((role) => role.id === data.session.roleId)?.displayName ?? 'Not selected'
}

function automationSummary(): string {
  const count = data.session.scheduleTemplates?.length ?? 0
  return `${count} recurring task${count === 1 ? '' : 's'}`
}

function connectionSummary(): string {
  const count = data.platforms.filter(isConnected).length
  return `${count} app${count === 1 ? '' : 's'} connected`
}

function platformOutcome(id: string): string {
  return ({
    'meta-ads': 'Review campaign performance and spot wasted spend',
    'instagram-graph': 'Understand content performance and prepare social work',
    tiktok: 'Review videos and prepare content for TikTok',
    google: 'Connect search, website, and conversion signals',
    higgsfield: 'Create campaign-ready images and videos',
  } as Record<string, string>)[id] ?? 'Add live business context when a task needs it'
}

function missingPlatformNames(): string[] {
  return data.progress.missingRequiredPlatforms.map((id) => data.platforms.find((platform) => platform.id === id)?.displayName ?? id)
}

function readinessTitle(readiness: Readiness): string {
  return ({ needs_profile: 'Complete the business brief.', needs_role: 'Choose a business goal.', needs_automations: 'Review recurring tasks.', needs_connections: 'Connect the required apps.', needs_whatsapp: 'Verify the WhatsApp connection.', live: 'BizzClaw is ready.' })[readiness]
}

function shorten(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1).trim()}…`
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

function checkIcon(): string { return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.2 8.3 3 3 6.6-6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' }
function arrowIcon(): string { return '<svg class="arrow-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' }
function shieldIcon(): string { return '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.2 16 4.7v4.6c0 3.8-2.5 6.7-6 8.5-3.5-1.8-6-4.7-6-8.5V4.7L10 2.2Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m7.2 9.8 1.8 1.8 3.8-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' }
function attentionIcon(): string { return '<svg class="note-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.3 18 17H2L10 2.3Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10 7v4.5M10 14.4v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' }
function whatsappIcon(): string { return '<svg class="whatsapp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.6a8 8 0 0 1-11.8 7L4 19.8l1.2-4A8 8 0 1 1 20 11.6Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 8.2c.3-.5.6-.5.9-.1l1 1.5c.2.3.1.6-.1.9l-.5.6c.8 1.5 1.8 2.4 3.2 3l.6-.7c.3-.3.6-.3.9-.1l1.5.8c.4.2.4.6.2.9-.5 1-1.4 1.5-2.5 1.3-3.4-.6-6.1-3.2-6.8-6.5-.2-.7.6-1.5 1.6-1.6Z" fill="currentColor"/></svg>' }
function managedIcon(): string { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16v11H4zM8 3.5h8v3H8z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 11h8M8 14h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }
function linkedDeviceIcon(): string { return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.8" width="10" height="18.4" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 17.8h4M18.5 8.3l2 2-2 2M5.5 8.3l-2 2 2 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' }
function routineIcon(): string { return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7.5 3v5M16.5 3v5M3.5 10h17M8 14h3M8 17h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }
function roleIcon(id: string): string { const glyphs: Record<string, string> = { 'marketing-manager': 'GP', 'creative-director': 'CP', 'ads-analyst': 'AO', 'social-media-manager': 'AB', 'gtm-operator': 'PB', 'personal-assistant-dev': 'BA' }; return `<span class="role-glyph">${escapeHtml(glyphs[id] ?? 'BC')}</span>` }
function platformIcon(id: string): string { const glyphs: Record<string, string> = { 'meta-ads': 'M', 'instagram-graph': 'I', tiktok: 'T', google: 'G', higgsfield: 'H' }; return escapeHtml(glyphs[id] ?? '↗') }
function successSeal(): string { return '<div class="success-seal" aria-hidden="true"><span>' + checkIcon() + '</span><i></i><i></i><i></i></div>' }

window.addEventListener('popstate', () => {
  if (!data) return
  const requested = stepFromPath()
  currentStep = requested > data.progress.allowedStep ? data.progress.allowedStep : requested
  if (currentStep !== requested) replaceUrl(currentStep)
  render()
})

load().catch((error) => {
  const message = error instanceof Error ? error.message : 'Could not load onboarding.'
  app.innerHTML = `<section class="load-failure"><p class="overline">Setup unavailable</p><h1>We couldn’t load your onboarding.</h1><p>${escapeHtml(message)}</p><button class="btn btn-primary" type="button" id="retryLoad">Try Again</button></section>`
  document.querySelector('#retryLoad')?.addEventListener('click', () => location.reload())
})
