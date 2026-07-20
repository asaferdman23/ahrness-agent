/**
 * Customer dashboard and login pages — protected by better-auth Google session.
 * The dashboard deliberately translates runtime truth into business language.
 */
import type { User } from './auth.js'
import type { PlatformId } from './store/types.js'
import type { CrmSummary } from './crm/types.js'

export const STYLES = `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root{--canvas:#f5f5f5;--paper:#fff;--ink:#0c0a09;--body:#4e4e4e;--muted:#777169;--line:#e7e5e4;--line-strong:#d6d3d1;--mint:#a7e5d3;--green:#0f8f38;--green-soft:#eefbf4;--amber:#8a5a00;--amber-soft:#fff8e8;--red:#a72a20;--red-soft:#fff1ef;--shadow:0 1px 2px rgba(12,10,9,.04),0 18px 55px rgba(12,10,9,.08);--display:'EB Garamond',Georgia,serif;--sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--ease:cubic-bezier(.22,1,.36,1)}
    *,*::before,*::after{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}a{color:inherit}button{font:inherit}.skip-link{position:fixed;z-index:20;left:1rem;top:-5rem;background:var(--ink);color:#fff;padding:.7rem 1rem;border-radius:999px}.skip-link:focus{top:1rem}
    .atmosphere{position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(circle at 8% 4%,rgba(244,197,168,.42),transparent 30%),radial-gradient(circle at 88% 8%,rgba(167,229,211,.5),transparent 30%),radial-gradient(circle at 72% 92%,rgba(200,184,224,.25),transparent 28%)}
    .topbar{max-width:1180px;height:72px;margin:0 auto;padding:0 24px;display:flex;align-items:center;gap:28px}.brand{display:flex;align-items:center;gap:10px;text-decoration:none;white-space:nowrap}.brand img{width:34px;height:34px;border-radius:50%;background:#fff;box-shadow:0 1px 8px rgba(12,10,9,.08)}.brand-name{font-family:var(--display);font-size:24px;font-weight:500;letter-spacing:-.025em}.primary-nav{display:flex;align-items:center;gap:4px;margin-right:auto}.nav-link{display:inline-flex;min-height:42px;align-items:center;padding:0 14px;border-radius:999px;text-decoration:none;color:var(--body);font-size:13px;font-weight:600}.nav-link:hover,.nav-link:focus-visible{background:rgba(255,255,255,.68);color:var(--ink)}.nav-link.active{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(12,10,9,.08)}
    .status{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:12px;white-space:nowrap}.status-dot{width:8px;height:8px;border-radius:50%;background:var(--line-strong)}.status.ready .status-dot{background:var(--green);box-shadow:0 0 0 4px rgba(15,143,56,.12)}.status.working .status-dot{background:var(--green)}.user-menu{position:relative}.user-menu summary{list-style:none;cursor:pointer}.user-menu summary::-webkit-details-marker{display:none}.user-chip{width:40px;height:40px;display:grid;place-items:center;border-radius:50%;background:#fff;border:1px solid var(--line);font-size:12px;font-weight:700;overflow:hidden}.user-chip img{width:100%;height:100%;object-fit:cover}.menu-card{position:absolute;right:0;top:48px;z-index:10;width:230px;background:#fff;border:1px solid var(--line);border-radius:16px;padding:10px;box-shadow:var(--shadow)}.menu-identity{padding:8px 10px 12px;border-bottom:1px solid var(--line);overflow:hidden}.menu-identity strong,.menu-identity span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.menu-identity span{font-size:12px;color:var(--muted)}.menu-card a{display:flex;min-height:42px;align-items:center;padding:0 10px;border-radius:10px;text-decoration:none;font-size:13px}.menu-card a:hover,.menu-card a:focus-visible{background:var(--canvas)}
    .container{max-width:1180px;margin:0 auto;padding:32px 24px 72px}.hero{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:30px;padding:42px 48px;border:1px solid rgba(255,255,255,.75);border-radius:24px;background:rgba(255,255,255,.86);box-shadow:var(--shadow);backdrop-filter:blur(16px)}.eyebrow{margin:0 0 10px;color:var(--green);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.hero h1{max-width:780px;margin:0;font-family:var(--display);font-size:clamp(42px,5.4vw,70px);font-weight:400;letter-spacing:-.045em;line-height:.95}.hero-copy{max-width:700px;margin:16px 0 0;color:var(--body);font-size:16px}.btn{display:inline-flex;min-height:46px;align-items:center;justify-content:center;gap:8px;padding:0 20px;border:1px solid transparent;border-radius:999px;background:none;text-decoration:none;font-size:13px;font-weight:700;transition:transform .15s var(--ease),box-shadow .15s var(--ease),background .15s var(--ease)}.btn:hover{transform:translateY(-1px)}.btn:focus-visible,.nav-link:focus-visible,.user-menu summary:focus-visible,.row-link:focus-visible{outline:3px solid rgba(15,143,56,.28);outline-offset:3px}.btn-primary{background:var(--mint);color:var(--ink);box-shadow:0 10px 24px rgba(36,151,119,.17)}.btn-primary:hover{background:#97dcc8}.btn-secondary{border-color:var(--line-strong);background:#fff}.arrow{font-size:18px;line-height:1}
    .attention{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px;margin-top:18px;padding:18px 20px;border:1px solid #efdab0;border-radius:16px;background:var(--amber-soft)}.attention-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:#fff;color:var(--amber);font-weight:700}.attention p{margin:0}.attention strong{display:block;font-size:14px}.attention span{display:block;color:#6e5832;font-size:13px}.more-count{margin-left:6px;color:var(--muted);font-size:12px}
    .dashboard-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(300px,.75fr);gap:18px;margin-top:18px}.panel{background:rgba(255,255,255,.9);border:1px solid var(--line);border-radius:20px;padding:26px;box-shadow:0 8px 32px rgba(12,10,9,.05)}.panel-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}.panel h2{margin:0;font-family:var(--display);font-size:29px;font-weight:500;letter-spacing:-.025em;line-height:1}.panel-kicker{margin:6px 0 0;color:var(--muted);font-size:13px}.text-link{font-size:12px;font-weight:700;text-decoration:none;white-space:nowrap}.text-link:hover{text-decoration:underline}
    .result-list,.connection-list{display:grid;gap:0}.result-row{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:12px;align-items:start;padding:16px 0;border-top:1px solid var(--line);text-decoration:none}.result-row:first-child{border-top:0;padding-top:2px}.result-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:var(--green-soft);color:var(--green);font-weight:700}.result-icon.failed{background:var(--red-soft);color:var(--red)}.result-icon.working{background:var(--amber-soft);color:var(--amber)}.result-title{font-size:14px;font-weight:650}.result-preview{display:-webkit-box;margin-top:3px;overflow:hidden;color:var(--body);font-size:12px;-webkit-box-orient:vertical;-webkit-line-clamp:2}.result-meta{color:var(--muted);font-size:11px;white-space:nowrap}.empty-state{padding:28px;border:1px dashed var(--line-strong);border-radius:16px;background:rgba(245,245,245,.62)}.empty-state h3{margin:0;font-family:var(--display);font-size:24px;font-weight:500}.empty-state p{margin:7px 0 17px;color:var(--body);font-size:13px}.empty-state.compact{padding:22px}.empty-state.compact p{margin-bottom:0}
    .pipeline-panel{position:relative;overflow:hidden}.pipeline-panel::after{content:'';position:absolute;width:180px;height:180px;right:-70px;bottom:-90px;border-radius:50%;background:rgba(167,229,211,.28);pointer-events:none}.pipeline-stats{position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:9px}.pipeline-stat{padding:14px;border:1px solid var(--line);border-radius:13px;background:rgba(245,245,245,.66)}.pipeline-stat span{display:block;color:var(--muted);font-size:10px;font-weight:650}.pipeline-stat strong{display:block;margin-top:4px;font-family:var(--display);font-size:22px;font-weight:500}.truth-note{position:relative;z-index:1;margin-top:16px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}
    .connections-panel{grid-column:1/-1}.connection-list{grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.connection-card{min-width:0;padding:16px;border:1px solid var(--line);border-radius:14px;background:rgba(245,245,245,.65)}.connection-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.connection-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:650}.connection-copy{margin:6px 0 0;color:var(--muted);font-size:11px}.state-label{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;white-space:nowrap}.state-label::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--line-strong)}.state-label.connected{color:var(--green)}.state-label.connected::before{background:var(--green)}.state-label.attention-state{color:var(--amber)}.state-label.attention-state::before{background:#c68300}
    .teammate{grid-column:1/-1;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:16px;padding:20px 24px}.teammate img{width:46px;height:46px;border-radius:50%;background:#fff}.teammate h2{font-family:var(--sans);font-size:14px;font-weight:700}.teammate p{margin:3px 0 0;color:var(--body);font-size:12px}.teammate-facts{display:flex;gap:8px;flex-wrap:wrap}.fact{padding:6px 9px;border:1px solid var(--line);border-radius:999px;background:var(--canvas);color:var(--body);font-size:10px;font-weight:600}
    .mobile-nav{display:none}.login-wrap{min-height:100vh;display:grid;place-items:center;padding:24px}.login-card{width:min(100%,420px);padding:38px;background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:24px;box-shadow:var(--shadow);text-align:center}.login-logo{width:58px;height:58px;margin:0 auto 16px;border-radius:50%;background:#fff;box-shadow:0 3px 15px rgba(12,10,9,.1)}.login-card h1{margin:0;font-family:var(--display);font-size:38px;font-weight:500}.login-card .subtitle{margin:8px 0 24px;color:var(--body)}.google-logo{width:18px;height:18px}.error{margin:0 0 14px;padding:10px;border:1px solid #efc3bd;border-radius:12px;background:var(--red-soft);color:var(--red);font-size:12px}.legal{margin:18px 0 0;color:var(--muted);font-size:11px}
    @media(max-width:899px){.primary-nav{display:none}.topbar{padding:0 18px}.container{padding:20px 18px 90px}.hero{grid-template-columns:1fr;align-items:start;padding:34px}.hero-action{justify-self:start}.dashboard-grid{grid-template-columns:1fr 1fr}.connections-panel,.teammate{grid-column:1/-1}.connection-list{grid-template-columns:repeat(2,minmax(0,1fr))}.mobile-nav{position:fixed;z-index:8;left:14px;right:14px;bottom:12px;display:grid;grid-template-columns:repeat(4,1fr);padding:7px;border:1px solid rgba(214,211,209,.8);border-radius:18px;background:rgba(255,255,255,.94);box-shadow:var(--shadow);backdrop-filter:blur(16px)}.mobile-nav a{display:grid;place-items:center;min-height:48px;border-radius:12px;text-decoration:none;color:var(--muted);font-size:10px;font-weight:650}.mobile-nav a.active{background:var(--canvas);color:var(--ink)}}
    @media(max-width:599px){.topbar{height:64px}.brand-name{font-size:21px}.status{margin-left:auto}.status span:last-child{display:none}.user-chip{width:36px;height:36px}.container{padding:14px 12px 92px}.hero{padding:28px 20px;border-radius:20px}.hero h1{font-size:42px}.hero-copy{font-size:14px}.hero-action,.hero-action .btn{width:100%}.attention{grid-template-columns:auto 1fr;padding:15px}.attention .btn{grid-column:1/-1;width:100%}.dashboard-grid{grid-template-columns:1fr}.panel{padding:21px;border-radius:18px}.pipeline-panel{order:-1}.connections-panel,.teammate{grid-column:auto}.connection-list{grid-template-columns:1fr}.teammate{grid-template-columns:auto 1fr}.teammate-facts{grid-column:1/-1}.result-row{grid-template-columns:32px minmax(0,1fr)}.result-meta{grid-column:2}.login-card{padding:30px 22px}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.btn{transition:none}}
  </style>`

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function layout(title: string, body: string, agentName = process.env.AGENT_NAME ?? 'BizzClaw'): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="theme-color" content="#f5f5f5"/><title>${escapeHtml(title)} — ${escapeHtml(agentName)}</title>${STYLES}</head><body><div class="atmosphere" aria-hidden="true"></div>${body}</body></html>`
}

const GOOGLE_SVG = `<svg class="google-logo" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M17.64 9.2a10 10 0 0 0-.16-1.7H9v3.22h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.5z" fill="#4285F4"/><path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26a5.4 5.4 0 0 1-8.07-2.83H.97v2.33A9 9 0 0 0 9 18z" fill="#34A853"/><path d="M3.98 10.73a5.41 5.41 0 0 1 0-3.46V4.94H.97a9 9 0 0 0 0 8.12l3.01-2.33z" fill="#FBBC05"/><path d="M9 3.58a4.86 4.86 0 0 1 3.44 1.35l2.58-2.58A8.64 8.64 0 0 0 9 0 9 9 0 0 0 .97 4.94L4 7.27A5.37 5.37 0 0 1 9 3.58z" fill="#EA4335"/></svg>`

export function renderLoginPage(agentName: string, error?: string): string {
  const name = agentName || 'BizzClaw'
  return layout('Sign in', `<main class="login-wrap"><section class="login-card" aria-labelledby="loginTitle"><img class="login-logo" src="/onboarding/bizzclaw-mascot.png" alt=""/><p class="eyebrow">Welcome back</p><h1 id="loginTitle">${escapeHtml(name)}</h1><p class="subtitle">See what needs attention, what was delivered, and what to do next.</p>${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}<button id="google-btn" onclick="signInWithGoogle()" class="btn btn-secondary" style="width:100%">${GOOGLE_SVG} Sign in with Google</button><script>async function signInWithGoogle(){const b=document.getElementById('google-btn');b.disabled=true;b.textContent='Opening Google…';try{const r=await fetch('/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'google',callbackURL:'/dashboard'})});const d=await r.json();if(d.url)location.href=d.url;else throw new Error()}catch{b.disabled=false;b.textContent='Sign in with Google';alert('Sign-in failed. Please try again.')}}</script><p class="legal">Your account is used only to protect your BizzClaw workspace.</p></section></main>`, name)
}

interface DashboardRole { id: string; displayName: string; description: string; emoji: string }
interface DashboardProfileSummary { businessName: string | null; website: string | null; instagram: string | null; tiktok: string | null; targetAudience: string | null; brandVoice: string | null; goals: string[] }
interface DashboardPlatformSummary { id: PlatformId; displayName: string; required: boolean; status: 'connected' | 'pending' | 'error' | 'not-configured'; connectedAt: string | null; tokenExpiresAt: string | null }
interface DashboardAutomationSummary { id: string; title: string; enabled: boolean; runCount: number; lastRunAt: string | null; lastRunStatus: 'ok' | 'error' | null }
interface DashboardPendingApproval { summary: string; createdAt: string; approved: boolean }
interface DashboardAlert { title: string; detail: string; level: 'info' | 'warn'; actionHref?: string; actionLabel?: string }
interface DashboardRunSummary { id: string; status: 'running' | 'completed' | 'failed' | 'stale'; channel: string; startedAt: string; outputPreview: string | null }

export interface DashboardState {
  whatsappLinked: boolean; whatsappJid: string | null; whatsappProvider: string | null
  telegramLinked: boolean; telegramConnectUrl: string | null; slackLinked: boolean; slackConnectUrl: string | null
  webBrowsingEnabled: boolean
  onboardingStep: number; role: DashboardRole | null; profile: DashboardProfileSummary | null
  platforms: DashboardPlatformSummary[]; automations: DashboardAutomationSummary[]
  pendingApproval: DashboardPendingApproval | null; alerts: DashboardAlert[]; lastActivityAt: string | null
  recentRuns: DashboardRunSummary[]
  crmSummary: CrmSummary
}

function formatTime(value: string | null): string {
  if (!value) return 'Not yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

function runPresentation(run: DashboardRunSummary): { title: string; icon: string; iconClass: string; support: string } {
  if (run.status === 'completed') return { title: 'Result delivered', icon: '✓', iconClass: '', support: run.outputPreview || 'Delivered successfully in your conversation.' }
  if (run.status === 'running') return { title: 'Working on your latest request', icon: '…', iconClass: 'working', support: 'BizzClaw is preparing the result now.' }
  if (run.status === 'stale') return { title: 'Stopped before finishing', icon: '!', iconClass: 'failed', support: 'The task stopped unexpectedly and can be reviewed.' }
  return { title: 'Could not finish', icon: '!', iconClass: 'failed', support: 'Review what happened and try the request again.' }
}

function connectionCard(name: string, connected: boolean, detail: string, needsAttention = false): string {
  const stateClass = connected ? 'connected' : needsAttention ? 'attention-state' : ''
  const label = connected ? 'Connected' : needsAttention ? 'Reconnect' : 'Available later'
  return `<article class="connection-card"><div class="connection-head"><span class="connection-name">${escapeHtml(name)}</span><span class="state-label ${stateClass}">${label}</span></div><p class="connection-copy">${escapeHtml(detail)}</p></article>`
}

function crmMoney(groups: Record<string, number>): string {
  const values = Object.entries(groups).map(([currency, minor]) => {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100) } catch { return `${(minor / 100).toFixed(2)} ${currency}` }
  })
  return values.length ? values.join(' + ') : 'No value yet'
}

export function renderDashboardPage(user: User, state: DashboardState): string {
  const agentName = process.env.AGENT_NAME ?? 'BizzClaw'
  const displayName = user.name ?? user.email ?? 'there'
  const firstName = displayName.split(/\s+/)[0] || 'there'
  const initials = displayName.slice(0, 2).toUpperCase()
  const avatar = user.image ? `<img src="${escapeHtml(user.image)}" alt=""/>` : escapeHtml(initials)
  const latestRun = state.recentRuns[0] ?? null
  const working = latestRun?.status === 'running'
  const ready = state.whatsappLinked
  const waNumber = state.whatsappJid?.replace(/@.*$/, '') ?? null
  const primaryHref = working ? '/dashboard/activity' : ready && waNumber ? `https://wa.me/${escapeHtml(waNumber)}` : `/onboarding/step/${Math.min(state.onboardingStep, 6)}`
  const primaryLabel = working ? 'See progress' : ready ? 'Open WhatsApp' : 'Continue setup'
  const heroTitle = working
    ? 'BizzClaw is working on your latest request.'
    : ready
      ? `${escapeHtml(firstName)}, your ${escapeHtml(state.role?.displayName ?? 'BizzClaw teammate')} is ready.`
      : 'Finish connecting WhatsApp to start receiving results.'
  const heroCopy = working
    ? `Started ${formatTime(latestRun.startedAt)}. You can follow the verified progress without leaving this page open.`
    : ready
      ? escapeHtml(state.role?.description ?? 'Send a request whenever you are ready and receive the result in WhatsApp.')
      : 'Your saved setup is waiting. Complete the remaining launch step and send your first real business request.'
  const statusClass = working ? 'working' : ready ? 'ready' : ''
  const statusText = working ? 'Working on it' : ready ? 'Ready on WhatsApp' : 'Setup incomplete'

  const attention = state.alerts[0]
  const attentionHtml = attention ? `<section class="attention" aria-labelledby="attentionTitle"><div class="attention-icon" aria-hidden="true">!</div><p><strong id="attentionTitle">${escapeHtml(attention.title)}</strong><span>${escapeHtml(attention.detail)}${state.alerts.length > 1 ? `<span class="more-count">${state.alerts.length - 1} more item${state.alerts.length === 2 ? '' : 's'}</span>` : ''}</span></p>${attention.actionHref && attention.actionLabel ? `<a class="btn btn-secondary" href="${escapeHtml(attention.actionHref)}">${escapeHtml(attention.actionLabel)}</a>` : ''}</section>` : ''

  const results = state.recentRuns.length ? state.recentRuns.slice(0, 3).map((run) => {
    const presentation = runPresentation(run)
    return `<a class="result-row row-link" href="/dashboard/activity"><span class="result-icon ${presentation.iconClass}" aria-hidden="true">${presentation.icon}</span><span><span class="result-title">${escapeHtml(presentation.title)}</span><span class="result-preview">${escapeHtml(presentation.support)}</span></span><span class="result-meta">${escapeHtml(formatTime(run.startedAt))}</span></a>`
  }).join('') : `<div class="empty-state"><h3>Your first result will appear here.</h3><p>Send BizzClaw a request in WhatsApp and the delivered work will be saved here.</p>${ready && waNumber ? `<a class="btn btn-secondary" href="https://wa.me/${escapeHtml(waNumber)}">Send your first request</a>` : `<a class="btn btn-secondary" href="/onboarding/step/${Math.min(state.onboardingStep, 6)}">Finish setup</a>`}</div>`

  const platformCards = state.platforms.slice(0, 3).map((platform) => connectionCard(
    platform.displayName,
    platform.status === 'connected',
    platform.status === 'connected' ? `Live business context added ${formatTime(platform.connectedAt)}.` : platform.required ? 'Connect when a task needs live account data.' : 'Optional context for more informed work.',
    platform.status === 'error' || platform.status === 'pending',
  ))
  const connections = [
    connectionCard('WhatsApp', state.whatsappLinked, state.whatsappLinked ? 'Your primary place to send requests and receive results.' : 'Required to launch BizzClaw.', !state.whatsappLinked),
    ...platformCards,
  ].join('')

  const activeAutomations = state.automations.filter((automation) => automation.enabled).length
  const connectedApps = state.platforms.filter((platform) => platform.status === 'connected').length
  const browsingToggleLabel = state.webBrowsingEnabled ? 'On' : 'Off'

  const crmHasData = state.crmSummary.peopleCount > 0 || state.crmSummary.activeOpportunityCount > 0
  const pipelineBody = crmHasData
    ? `<div class="pipeline-stats"><div class="pipeline-stat"><span>People</span><strong>${state.crmSummary.peopleCount}</strong></div><div class="pipeline-stat"><span>Open opportunities</span><strong>${state.crmSummary.activeOpportunityCount}</strong></div><div class="pipeline-stat"><span>Open value</span><strong>${escapeHtml(crmMoney(state.crmSummary.activeValueByCurrency))}</strong></div><div class="pipeline-stat"><span>Follow-ups due</span><strong>${state.crmSummary.followUpsDue}</strong></div></div>`
    : `<div class="empty-state compact"><h3>Turn conversations into a real pipeline.</h3><p>Add the first person and opportunity. BizzClaw will show only records you or your agent actually saved.</p><a class="btn btn-secondary" href="/dashboard/pipeline/people">Add first person</a></div>`
  return layout('Home', `<a class="skip-link" href="#main">Skip to content</a><header class="topbar"><a class="brand" href="/dashboard" aria-label="BizzClaw home"><img src="/onboarding/bizzclaw-mascot.png" alt=""/><span class="brand-name">BizzClaw</span></a><nav class="primary-nav" aria-label="Primary"><a class="nav-link active" href="/dashboard" aria-current="page">Home</a><a class="nav-link" href="/dashboard/pipeline">Customers</a><a class="nav-link" href="/dashboard/activity">Recent work</a><a class="nav-link" href="#connections">Connections</a></nav><div class="status ${statusClass}" role="status"><span class="status-dot" aria-hidden="true"></span><span>${statusText}</span></div><details class="user-menu"><summary aria-label="Open account menu"><span class="user-chip">${avatar}</span></summary><div class="menu-card"><div class="menu-identity"><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(user.email ?? '')}</span></div><a href="/onboarding/step/1">Account setup</a><a href="/api/auth/sign-out?callbackURL=/login">Sign out</a></div></details></header><main class="container" id="main"><section class="hero" aria-labelledby="pageTitle"><div><p class="eyebrow">${working ? 'In progress' : ready ? 'Ready to work' : 'One step remains'}</p><h1 id="pageTitle">${heroTitle}</h1><p class="hero-copy">${heroCopy}</p></div><div class="hero-action"><a class="btn btn-primary" href="${primaryHref}"${ready && !working ? ' target="_blank" rel="noopener"' : ''}>${primaryLabel}<span class="arrow" aria-hidden="true">→</span></a></div></section>${attentionHtml}<div class="dashboard-grid"><section class="panel" aria-labelledby="resultsTitle"><div class="panel-header"><div><h2 id="resultsTitle">Recent results</h2><p class="panel-kicker">Verified work from your latest requests.</p></div><a class="text-link" href="/dashboard/activity">View all work →</a></div><div class="result-list">${results}</div></section><section class="panel pipeline-panel" id="pipeline" aria-labelledby="pipelineTitle"><div class="panel-header"><div><h2 id="pipelineTitle">Customers</h2><p class="panel-kicker">People, opportunities, and next steps.</p></div><a class="text-link" href="/dashboard/pipeline">Open CRM →</a></div>${pipelineBody}<p class="truth-note">Won value appears only after you explicitly mark an opportunity Won. Verified source requires supporting evidence.</p></section><section class="panel connections-panel" id="connections" aria-labelledby="connectionsTitle"><div class="panel-header"><div><h2 id="connectionsTitle">Connected apps</h2><p class="panel-kicker">The accounts BizzClaw can use when your work needs live context.</p></div><a class="text-link" href="/onboarding/step/4">Manage connections →</a></div><div class="connection-list">${connections}</div></section><section class="panel" aria-labelledby="permissionsTitle"><div class="panel-header"><div><h2 id="permissionsTitle">Agent permissions</h2><p class="panel-kicker">Extra capabilities you can grant your agent beyond connected apps.</p></div></div><article class="connection-card"><div class="connection-head"><span class="connection-name">Web browsing</span><span class="state-label ${state.webBrowsingEnabled ? 'connected' : ''}">${browsingToggleLabel}</span></div><p class="connection-copy">Lets your agent open, read, and click around any website to research or complete a task for you.</p><button class="btn btn-secondary" onclick="toggleWebBrowsing()">${state.webBrowsingEnabled ? 'Turn off' : 'Turn on'}</button></article></section><script>async function toggleWebBrowsing(){const r=await fetch('/api/agent-permissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({webBrowsingEnabled: ${state.webBrowsingEnabled ? 'false' : 'true'}})});if(r.ok)location.reload();else alert('Could not update this setting. Please try again.')}</script><section class="panel teammate" aria-labelledby="teammateTitle"><img src="/onboarding/bizzclaw-mascot.png" alt=""/><div><h2 id="teammateTitle">Your BizzClaw teammate</h2><p>${escapeHtml(state.role?.displayName ?? 'Choose a business goal')} · ${escapeHtml(state.profile?.businessName ?? 'Business brief not finished')}</p></div><div class="teammate-facts"><span class="fact">${connectedApps} connected app${connectedApps === 1 ? '' : 's'}</span><span class="fact">${activeAutomations} recurring task${activeAutomations === 1 ? '' : 's'}</span><span class="fact">Last activity ${escapeHtml(formatTime(state.lastActivityAt))}</span></div></section></div></main><nav class="mobile-nav" aria-label="Mobile primary"><a class="active" href="/dashboard" aria-current="page">Home</a><a href="/dashboard/pipeline">Customers</a><a href="/dashboard/activity">Work</a><a href="#connections">Connections</a></nav>`, agentName)
}
