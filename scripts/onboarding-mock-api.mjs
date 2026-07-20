/**
 * Stub onboarding API for reviewing the onboarding UI locally.
 *
 * The real API (`npm run dev:onboarding:api`) sits behind Google sign-in, so it
 * needs GOOGLE_CLIENT_ID/SECRET to serve a single page. This server answers the
 * same endpoints with canned data and no auth, which makes every visual state
 * reachable by URL — including ones that are awkward to reach for real, such as
 * a generated AI preview or a half-connected set of apps.
 *
 * Usage (replaces dev:onboarding:api, alongside dev:frontend):
 *
 *   npm run dev:onboarding:mock
 *   npm run dev:frontend
 *   open 'http://127.0.0.1:5173/onboarding/step/2?mock=step2'
 *
 * Scenarios: step1-empty, step1-filled, step1-preview, step2, step3, step4,
 * step5-choose, step5-managed, step5-qr, step6.
 *
 * Always include the /step/N path segment — the app redirects to
 * progress.allowedStep when the URL has no explicit step.
 *
 * Limits: buttons do not advance between steps (state is fixed per scenario),
 * and the QR path renders its layout but cannot complete a real link. This is a
 * tool for reviewing layout, type, and colour — not flow logic.
 */
import { createServer } from 'node:http'

// Mutable mock state, driven by ?mock=<scenario> on the bootstrap call.
const roles = [
  { id: 'marketing-manager', displayName: 'Grow predictable demand', description: 'Plan and run campaigns that create steady demand across the month.', emoji: '', tools: [{ id: 'meta-ads', displayName: 'Meta Ads', required: true }, { id: 'google', displayName: 'Google', required: false }] },
  { id: 'creative-director', displayName: 'Create campaign-ready work', description: 'Develop campaign concepts, visual direction, and executions that stand apart.', emoji: '', tools: [{ id: 'higgsfield', displayName: 'Higgsfield', required: false }] },
  { id: 'ads-analyst', displayName: 'Get more from ad spend', description: 'Review paid performance, cut waste, and decide where the next dollar goes.', emoji: '', tools: [{ id: 'meta-ads', displayName: 'Meta Ads', required: true }, { id: 'google', displayName: 'Google', required: true }] },
  { id: 'social-media-manager', displayName: 'Build an audience on social', description: 'Plan, draft, and schedule content that compounds attention over time.', emoji: '', tools: [{ id: 'instagram-graph', displayName: 'Instagram', required: true }, { id: 'tiktok', displayName: 'TikTok', required: false }] },
  { id: 'gtm-operator', displayName: 'Start more sales conversations', description: 'Choose audiences and channels most likely to produce qualified conversations.', emoji: '', tools: [{ id: 'google', displayName: 'Google', required: false }] },
  { id: 'personal-assistant-dev', displayName: 'Stay on top of the work', description: 'Turn scattered priorities into a weekly operating plan you actually follow.', emoji: '', tools: [] },
]

const templates = [
  { id: 'weekly-report', title: 'Weekly performance recap', description: 'Every Monday, a short summary of what moved and what needs a decision.', cadence: 'Weekly', emoji: '' },
  { id: 'content-plan', title: 'Content plan refresh', description: 'A rolling two-week content plan with drafted openers.', cadence: 'Biweekly', emoji: '' },
  { id: 'spend-check', title: 'Ad spend check', description: 'A daily flag when spend or cost per result drifts outside your range.', cadence: 'Daily', emoji: '' },
]

const platforms = [
  { id: 'meta-ads', displayName: 'Meta Ads', required: true, status: 'disconnected', authUrl: '/oauth/meta' },
  { id: 'instagram-graph', displayName: 'Instagram', required: false, status: 'disconnected', authUrl: '/oauth/instagram' },
  { id: 'google', displayName: 'Google', required: false, status: 'connected', authUrl: '/oauth/google' },
  { id: 'tiktok', displayName: 'TikTok', required: false, status: 'disconnected', authUrl: '#' },
  { id: 'higgsfield', displayName: 'Higgsfield', required: false, status: 'disconnected', authUrl: '/oauth/higgsfield' },
]

const preview = {
  headline: 'Your repeat customers are your cheapest growth channel',
  insight: 'Independent retailers like Northstar Studio usually have more revenue sitting in past customers than in new traffic. Because you already talk to customers directly, a light reactivation motion tends to beat any new acquisition spend in the first 30 days.',
  opportunities: [
    'Segment past customers by last purchase date and write one reactivation message for each of the three groups.',
    'Turn your three most common pre-purchase questions into a short buying guide you can send in a single message.',
    'Set one weekly checkpoint that reviews conversations-to-orders so you can see whether messaging is actually converting.',
  ],
  suggestedFirstBrief: 'Review my customer conversations and tell me the three highest-value follow-ups I should send this week.',
  generatedAt: new Date().toISOString(),
  source: 'ai',
}

const profile = {
  business: { name: 'Northstar Studio', industry: 'retail', description: 'We help independent retailers turn customer conversations into repeat revenue through better follow-up.', targetAudience: 'Independent retail owners doing $200k-2M a year', brandVoice: '', goals: ['brand_awareness'] },
  assets: { website: 'https://northstar.studio', instagram: { handle: '@northstarstudio' }, tiktok: {} },
}

function scenarioState(mock) {
  const base = {
    agentName: 'BizzClaw',
    activationV2: true,
    preview: null,
    progress: { allowedStep: 1, readiness: 'needs_profile', checks: { profile: false, role: false, automations: false, requiredConnections: false, whatsapp: false }, missingRequiredPlatforms: [] },
    session: { sessionId: 'mock-session', step: 1, whatsappJid: null, whatsappLinked: false, whatsappProvider: null, profile: null, roleId: null, scheduleTemplates: null, connections: {} },
    roles, templates,
    platforms: platforms.map((p) => ({ ...p, status: 'disconnected' })),
    whatsapp: {
      providers: ['twilio', 'baileys'], selectedProvider: null,
      twilio: { enabled: true, digits: '14155238886', connectCode: 'JOIN-4821', waLink: 'https://wa.me/14155238886?text=JOIN-4821' },
      baileys: { enabled: true, latestQr: null, homeGroupJid: null, homeGroupSubject: null },
    },
  }

  const full = { profile: true, role: true, automations: true, requiredConnections: true, whatsapp: true }

  switch (mock) {
    case 'step1-empty':
      return base
    case 'step1-filled':
      return { ...base, session: { ...base.session, profile }, progress: { ...base.progress, allowedStep: 2, readiness: 'needs_role', checks: { ...base.progress.checks, profile: true } } }
    case 'step1-preview':
      return { ...base, preview, session: { ...base.session, profile }, progress: { ...base.progress, allowedStep: 2, readiness: 'needs_role', checks: { ...base.progress.checks, profile: true } } }
    case 'step2':
      return { ...base, preview, session: { ...base.session, profile, roleId: 'ads-analyst' }, progress: { ...base.progress, allowedStep: 2, readiness: 'needs_role', checks: { ...base.progress.checks, profile: true } } }
    case 'step3':
      return { ...base, preview, session: { ...base.session, profile, roleId: 'ads-analyst', scheduleTemplates: ['weekly-report'] }, progress: { ...base.progress, allowedStep: 3, readiness: 'needs_automations', checks: { ...base.progress.checks, profile: true, role: true } } }
    case 'step4':
      return { ...base, preview, platforms, session: { ...base.session, profile, roleId: 'ads-analyst', scheduleTemplates: ['weekly-report'], connections: { google: 'connected' } }, progress: { allowedStep: 4, readiness: 'needs_connections', checks: { profile: true, role: true, automations: true, requiredConnections: false, whatsapp: false }, missingRequiredPlatforms: ['meta-ads'] } }
    case 'step5-choose':
      return { ...base, preview, platforms, session: { ...base.session, profile, roleId: 'ads-analyst', scheduleTemplates: ['weekly-report'], connections: { google: 'connected' } }, progress: { allowedStep: 5, readiness: 'needs_whatsapp', checks: { profile: true, role: true, automations: true, requiredConnections: true, whatsapp: false }, missingRequiredPlatforms: [] } }
    case 'step5-managed':
      return { ...base, preview, platforms, session: { ...base.session, profile, roleId: 'ads-analyst', scheduleTemplates: ['weekly-report'], whatsappProvider: 'twilio', connections: { google: 'connected' } }, progress: { allowedStep: 5, readiness: 'needs_whatsapp', checks: { profile: true, role: true, automations: true, requiredConnections: true, whatsapp: false }, missingRequiredPlatforms: [] } }
    case 'step5-qr':
      return { ...base, preview, platforms, session: { ...base.session, profile, roleId: 'ads-analyst', scheduleTemplates: ['weekly-report'], whatsappProvider: 'baileys', connections: { google: 'connected' } }, progress: { allowedStep: 5, readiness: 'needs_whatsapp', checks: { profile: true, role: true, automations: true, requiredConnections: true, whatsapp: false }, missingRequiredPlatforms: [] } }
    case 'step5-group':
      return { ...base, preview, platforms, session: { ...base.session, profile, roleId: 'ads-analyst', scheduleTemplates: ['weekly-report'], whatsappProvider: 'baileys', whatsappLinked: true, connections: { google: 'connected' } }, progress: { allowedStep: 5, readiness: 'needs_whatsapp', checks: { profile: true, role: true, automations: true, requiredConnections: true, whatsapp: false }, missingRequiredPlatforms: [] } }
    case 'step6':
      return { ...base, preview, platforms, session: { ...base.session, profile, roleId: 'ads-analyst', scheduleTemplates: ['weekly-report'], whatsappProvider: 'twilio', whatsappLinked: true, connections: { google: 'connected' } }, progress: { allowedStep: 6, readiness: 'live', checks: full, missingRequiredPlatforms: [] } }
    default:
      return base
  }
}

let current = scenarioState('step1-empty')

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(body)) }

  if (url.pathname === '/api/onboarding/bootstrap') {
    const mock = url.searchParams.get('mock')
    if (mock) current = scenarioState(mock)
    return send(200, current)
  }
  if (url.pathname === '/api/onboarding/status') {
    return send(200, { step: current.session.step, progress: current.progress, connections: current.session.connections, whatsappLinked: current.session.whatsappLinked, whatsappProvider: current.session.whatsappProvider })
  }
  if (url.pathname === '/api/onboarding/preview') {
    return setTimeout(() => send(200, { preview }), 1200)
  }
  if (url.pathname === '/api/onboarding/baileys-groups') {
    return send(200, { groups: [{ jid: '1@g.us', subject: 'Northstar Studio — Team', size: 8 }, { jid: '2@g.us', subject: 'Marketing war room', size: 4 }], selected: null })
  }
  if (url.pathname.startsWith('/api/onboarding/')) {
    return send(200, current)
  }
  send(404, { error: 'not found' })
})

server.listen(3456, () => console.log('mock api on 3456'))
