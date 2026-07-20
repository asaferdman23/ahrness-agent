/**
 * HTTP server for OAuth callbacks, media serving, web onboarding, Twilio webhooks,
 * and the better-auth Google login / dashboard.
 */
import { createServer, type IncomingMessage } from 'node:http'
import { exchangeCodeForToken, decodeState } from './oauth.js'
import { saveToken } from './token-store.js'
import { serveSharedInput } from './input-sharing.js'
import { serveSharedOutput } from './output-sharing.js'
import {
  completeHiggsfieldAuthorization,
  isHiggsfieldAuthorized,
  startHiggsfieldAuthorization,
  verifyHiggsfieldSetupSecret,
} from './higgsfield-auth.js'
import { createOnboardingHandler } from './onboarding/server.js'
import { handleTwilioWebhook } from './twilio-whatsapp.js'
import { isTwilioProvider } from './whatsapp-providers.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'
import { auth } from './auth.js'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { renderLoginPage, renderDashboardPage } from './dashboard.js'
import { openDb, createSqliteStore } from '@agent-live/sdk'
import { mountAgentLiveDashboard } from '@agent-live/dashboard'
import path from 'node:path'
import { ensureTenant } from './tenant-store.js'
import { getClientMeta, getConnections, getProfile, getRole as getStoredRole } from './store/client-store.js'
import { listJobs } from './scheduler/store.js'
import { sharedTelegramBotUsername, telegramConnectUrl } from './telegram-shared-bot.js'
import { exchangeOAuthCode as exchangeSlackOAuthCode } from './slack-client.js'
import { slackInstallUrl, slackRedirectUri, verifySlackState } from './slack-oauth.js'
import { saveSlackConnection } from './slack-store.js'
import { handleSlackEventsRequest } from './slack.js'
import { fileConfirmationStore } from './confirmations.js'
import { getRole as getRoleDefinition } from './roles/registry.js'
import { getAllMcps } from './mcps/index.js'
import type { PlatformId } from './store/types.js'
import { getCrmStore } from './crm/store.js'
import { handleCrmApi } from './crm/http.js'
import { renderCrmPage } from './crm/views.js'
import { handleAgentPermissionsApi } from './agent-permissions-http.js'
import { handleSiteLoginRoute } from './site-login-http.js'
import { getAllSiteProfiles } from './browser-sites/registry.js'
import { siteLoginConnectUrlFor } from './browser/site-login-link.js'

const authHandler = toNodeHandler(auth)

const PORT = Number(process.env.CALLBACK_PORT ?? 3456)
const confirmationStore = fileConfirmationStore()

const agentLiveDbPath = process.env.AGENT_LIVE_DB ?? path.join(process.env.AGENT_STORE_DIR ?? './store', 'agent-live.sqlite')
const agentLiveStore = createSqliteStore(openDb(agentLiveDbPath))

const handleAgentLiveDashboard = mountAgentLiveDashboard({
  store: agentLiveStore,
  resolveTenant: async (req) => {
    const session = await getSession(req)
    return session?.user?.id ?? null
  },
  sseHeartbeatMs: Number.parseInt(process.env.AGENT_ACTIVITY_SSE_HEARTBEAT_MS ?? '15000', 10),
  title: `${process.env.AGENT_NAME ?? 'BizzClaw'} Activity`,
})

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function parseFormBody(raw: Buffer): Record<string, string> {
  const params = new URLSearchParams(raw.toString('utf-8'))
  const body: Record<string, string> = {}
  for (const [key, value] of params.entries()) body[key] = value
  return body
}

/** Get the better-auth session from an incoming Node request. */
async function getSession(req: IncomingMessage) {
  try {
    return await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  } catch {
    return null
  }
}

function computeOnboardingStep(input: {
  hasProfile: boolean
  hasRole: boolean
  hasAutomationDecision: boolean
  whatsappLinked: boolean
}): number {
  if (!input.hasProfile) return 1
  if (!input.hasRole) return 2
  if (!input.hasAutomationDecision) return 3
  if (!input.whatsappLinked) return 5
  return 6
}

function isExpired(iso: string | null): boolean {
  return !!iso && Number.isFinite(Date.parse(iso)) && Date.parse(iso) <= Date.now()
}

export function startCallbackServer(transport: WhatsAppTransport | null): void {
  const onboardingHandler = createOnboardingHandler()
  const agentName = process.env.AGENT_NAME ?? 'BizzClaw'

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

    // ── better-auth routes (/api/auth/*) ─────────────────────────────────────
    if (url.pathname.startsWith('/api/auth/')) {
      return authHandler(req, res)
    }

    // ── Login page ────────────────────────────────────────────────────────────
    if (url.pathname === '/login' || url.pathname === '/') {
      const session = await getSession(req)
      if (session?.user) {
        res.writeHead(302, { Location: '/dashboard' }).end()
        return
      }
      const error = url.searchParams.get('error') ?? undefined
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(renderLoginPage(agentName, error))
      return
    }

    // ── Dashboard (protected) ─────────────────────────────────────────────────
    if (url.pathname.startsWith('/dashboard/pipeline')) {
      const session = await getSession(req)
      if (!session?.user) {
        res.writeHead(302, { Location: '/login' }).end()
        return
      }
      await ensureTenant(session.user.id)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        .end(renderCrmPage(session.user, getCrmStore(session.user.id), url))
      return
    }

    if (url.pathname === '/dashboard') {
      const session = await getSession(req)
      if (!session?.user) {
        res.writeHead(302, { Location: '/login' }).end()
        return
      }
      const tenantId = session.user.id
      await ensureTenant(tenantId)

      const tenantRow = await (async () => {
        // Find the JID linked to this tenant
        const { db: database } = await import('./db/index.js')
        const { tenant: tenantTable } = await import('./db/schema.js')
        const { eq } = await import('drizzle-orm')
        const row = await database.select().from(tenantTable).where(eq(tenantTable.userId, tenantId)).get()
        return row ?? null
      })()

      const [profile, roleRecord, connections, jobs, pendingApproval, clientMeta] = await Promise.all([
        getProfile(tenantId),
        getStoredRole(tenantId),
        getConnections(tenantId),
        listJobs(tenantId),
        confirmationStore.get(tenantId),
        getClientMeta(tenantId),
      ])
      const recentRuns = agentLiveStore.listRuns(tenantId, { limit: 3 })
      const latestRun = recentRuns[0] ?? null

      const botUsername = sharedTelegramBotUsername()

      let role = null
      let requiredPlatforms: PlatformId[] = []
      let optionalPlatforms: PlatformId[] = []
      if (roleRecord) {
        try {
          const definition = getRoleDefinition(roleRecord.roleId)
          role = {
            id: definition.id,
            displayName: definition.displayName,
            description: definition.description,
            emoji: definition.emoji,
          }
          requiredPlatforms = definition.requiredMcps
          optionalPlatforms = definition.optionalMcps
        } catch {
          role = null
        }
      }

      const platformDefs = new Map(getAllMcps().map((platform) => [platform.id, platform]))
      const visiblePlatforms = role
        ? [...requiredPlatforms, ...optionalPlatforms]
        : (Array.from(new Set(Object.keys(connections))) as PlatformId[])
      const platforms = visiblePlatforms.map((platformId) => {
        const definition = platformDefs.get(platformId)
        const record = connections[platformId]
        const status: 'connected' | 'pending' | 'error' | 'not-configured' = record?.status ?? 'not-configured'
        return {
          id: platformId,
          displayName: definition?.displayName ?? platformId,
          required: requiredPlatforms.includes(platformId),
          status,
          connectedAt: record?.connectedAt ?? null,
          tokenExpiresAt: record?.tokenExpiresAt ?? null,
        }
      })

      const alerts = []
      if (pendingApproval) {
        alerts.push({
          title: pendingApproval.approved ? 'Your approved action is ready to continue' : 'A prepared action needs your OK',
          detail: pendingApproval.summary,
          level: 'warn' as const,
          actionHref: '/dashboard/activity',
          actionLabel: 'Review',
        })
      }
      if (latestRun?.status === 'failed' || latestRun?.status === 'stale') {
        alerts.push({
          title: latestRun.status === 'failed' ? 'Your latest request could not finish' : 'Your latest request stopped before finishing',
          detail: 'Open recent work to review what happened and decide whether to try again.',
          level: 'warn' as const,
          actionHref: '/dashboard/activity',
          actionLabel: 'Review work',
        })
      }
      if (!tenantRow?.whatsappJid) {
        alerts.push({
          title: 'Connect WhatsApp to receive results',
          detail: 'Finish the launch step so BizzClaw has a verified place to send your work.',
          level: 'warn' as const,
          actionHref: '/onboarding/step/5',
          actionLabel: 'Connect WhatsApp',
        })
      }
      for (const platform of platforms) {
        if (isExpired(platform.tokenExpiresAt) || platform.status === 'error') {
          alerts.push({
            title: `Reconnect ${platform.displayName}`,
            detail: `The connection needs renewing before BizzClaw can use live ${platform.displayName} data.`,
            level: 'warn' as const,
            actionHref: '/onboarding/step/4',
            actionLabel: 'Renew connection',
          })
        }
      }
      if (!profile?.business?.name) {
        alerts.push({
          title: 'Improve your business brief',
          detail: 'Add your business name and a short description to make the next result more specific.',
          level: 'info' as const,
          actionHref: '/onboarding/step/1',
          actionLabel: 'Improve brief',
        })
      }

      const lastActivityAt = [latestRun?.startedAt ?? null, pendingApproval?.createdAt ?? null, ...jobs.map((job) => job.lastRunAt), ...platforms.map((platform) => platform.connectedAt)]
        .filter((value): value is string => !!value)
        .sort()
        .at(-1) ?? null

      const onboardingStep = computeOnboardingStep({
        hasProfile: !!profile,
        hasRole: !!roleRecord,
        hasAutomationDecision: roleRecord?.scheduleTemplates !== undefined,
        whatsappLinked: !!tenantRow?.whatsappJid,
      })

      const siteLoginLinks = tenantRow?.whatsappJid
        ? getAllSiteProfiles().map((profile) => ({
            displayName: profile.displayName,
            url: siteLoginConnectUrlFor(process.env.CALLBACK_BASE_URL ?? 'http://localhost:3000', tenantRow.whatsappJid!, profile.domain),
          }))
        : []

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(renderDashboardPage(session.user, {
          whatsappLinked: !!tenantRow?.whatsappJid,
          whatsappJid: tenantRow?.whatsappJid ?? null,
          whatsappProvider: tenantRow?.whatsappProvider ?? null,
          telegramLinked: !!clientMeta.telegramChatId,
          telegramConnectUrl: botUsername ? telegramConnectUrl(botUsername, tenantId) : null,
          slackLinked: !!clientMeta.slackTeamId,
          slackConnectUrl: slackInstallUrl(tenantId),
          webBrowsingEnabled: !!clientMeta.webBrowsingEnabled,
          siteLoginLinks,
          onboardingStep,
          role,
          profile: profile ? {
            businessName: profile.business.name || null,
            website: profile.assets.website ?? null,
            instagram: profile.assets.instagram?.handle ?? null,
            tiktok: profile.assets.tiktok?.handle ?? null,
            targetAudience: profile.business.targetAudience ?? null,
            brandVoice: profile.business.brandVoice ?? null,
            goals: profile.business.goals ?? [],
          } : null,
          platforms,
          automations: jobs
            .sort((a, b) => {
              const aTime = a.lastRunAt ? Date.parse(a.lastRunAt) : 0
              const bTime = b.lastRunAt ? Date.parse(b.lastRunAt) : 0
              return bTime - aTime
            })
            .map((job) => ({
              id: job.id,
              title: job.title,
              enabled: job.enabled,
              runCount: job.runCount,
              lastRunAt: job.lastRunAt,
              lastRunStatus: job.lastRunStatus ?? null,
            })),
          pendingApproval: pendingApproval ? {
            summary: pendingApproval.summary,
            createdAt: new Date(pendingApproval.createdAt).toISOString(),
            approved: pendingApproval.approved,
          } : null,
          alerts,
          lastActivityAt,
          recentRuns: recentRuns.map((run) => ({
            id: run.id,
            status: run.status,
            channel: run.channel,
            startedAt: run.startedAt,
            outputPreview: run.outputPreview,
          })),
          crmSummary: getCrmStore(tenantId).summary(),
        }))
      return
    }

    // ── Agent permissions (protected, tenant-bound capability toggles) ──────
    if (url.pathname === '/api/agent-permissions') {
      const session = await getSession(req)
      if (!session?.user) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Sign in required' }))
        return
      }
      await handleAgentPermissionsApi(req, res, url, session.user.id)
      return
    }

    // ── Native CRM API (protected and tenant-bound) ──────────────────────────
    if (url.pathname.startsWith('/api/crm')) {
      const session = await getSession(req)
      if (!session?.user) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Sign in required' }))
        return
      }
      await ensureTenant(session.user.id)
      await handleCrmApi(req, res, url, session.user.id)
      return
    }

    // ── Site login connect (signed-link, no dashboard session required) ─────
    if (await handleSiteLoginRoute(req, res, url)) return

    // ── Agent Live dashboard (mounted from @agent-live/dashboard) ────────────
    if (await handleAgentLiveDashboard(req, res, url)) return

    // ── Twilio WhatsApp webhook ───────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/webhooks/twilio/whatsapp') {
      const raw = await readBody(req)
      const body = parseFormBody(raw)
      if (transport) {
        await handleTwilioWebhook(req, res, body, transport)
      } else {
        res.writeHead(503).end('WhatsApp transport not ready')
      }
      return
    }

    // ── Slack Events API webhook ──────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/webhooks/slack/events') {
      const signingSecret = process.env.SLACK_SIGNING_SECRET
      if (!signingSecret) {
        res.writeHead(503).end('Slack is not configured on this server.')
        return
      }
      const raw = await readBody(req)
      const result = await handleSlackEventsRequest(raw, req.headers, signingSecret)
      res.writeHead(result.status, result.contentType ? { 'Content-Type': result.contentType } : undefined).end(result.body)
      return
    }

    // ── Onboarding API (protected — requires Google sign-in) ─────────────────
    if (url.pathname.startsWith('/api/onboarding')) {
      const session = await getSession(req)
      if (!session?.user) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Sign in required' }))
        return
      }
      ;(req as any).__tenantId = session.user.id
      await onboardingHandler(req, res)
      return
    }

    // ── Onboarding (protected — requires Google sign-in) ─────────────────────
    if (url.pathname.startsWith('/onboarding') || url.pathname.startsWith('/oauth/')) {
      const session = await getSession(req)
      if (!session?.user) {
        res.writeHead(302, { Location: '/login' }).end()
        return
      }
      // Inject the tenantId into the request so onboarding can use it as clientId
      ;(req as any).__tenantId = session.user.id
      await onboardingHandler(req, res)
      return
    }

    if (url.pathname.startsWith('/media/out/')) {
      await serveSharedOutput(url.pathname, url.searchParams, res)
      return
    }

    if (url.pathname.startsWith('/media/')) {
      await serveSharedInput(url.pathname, url.searchParams, res)
      return
    }

    if (url.pathname === '/auth/higgsfield/start') {
      if (!verifyHiggsfieldSetupSecret(url.searchParams.get('key'))) {
        res.writeHead(403).end('Forbidden')
        return
      }
      try {
        const authorizationUrl = await startHiggsfieldAuthorization()
        if (!authorizationUrl) {
          res.writeHead(200, { 'Content-Type': 'text/html' }).end(successPage('Higgsfield is already connected.'))
          return
        }
        res.writeHead(302, { Location: authorizationUrl }).end()
      } catch (err) {
        console.error('[higgsfield-oauth] start failed:', err)
        res.writeHead(500).end('Could not start Higgsfield authorization.')
      }
      return
    }

    if (url.pathname === '/auth/higgsfield/status') {
      if (!verifyHiggsfieldSetupSecret(url.searchParams.get('key'))) {
        res.writeHead(403).end('Forbidden')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ connected: await isHiggsfieldAuthorized() }),
      )
      return
    }

    if (url.pathname === '/auth/higgsfield/callback') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')
      if (error || !code || !state) {
        res.writeHead(400).end(`Higgsfield authorization failed: ${error ?? 'missing parameters'}`)
        return
      }
      try {
        await completeHiggsfieldAuthorization(code, state)
        console.log('[higgsfield-oauth] shared account connected')
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(
          successPage('Higgsfield is connected. Clients can now generate creatives through WhatsApp.'),
        )
      } catch (err) {
        console.error('[higgsfield-oauth] callback failed:', err)
        res.writeHead(500).end('Higgsfield token exchange failed. Please try again.')
      }
      return
    }

    if (url.pathname === '/auth/meta/callback') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error_description')

      if (error || !code || !state) {
        console.error('[oauth] callback error:', error ?? 'missing code/state')
        res.writeHead(400).end(`Authorization failed: ${error ?? 'missing parameters'}`)
        return
      }

      let jid: string
      try {
        jid = decodeState(state)
      } catch {
        res.writeHead(400).end('Invalid state parameter')
        return
      }

      try {
        const { accessToken, expiresIn } = await exchangeCodeForToken(code)
        await saveToken(jid, accessToken, expiresIn)
        console.log(`[oauth] token saved for ${jid}`)

        if (transport) {
          await transport.sendText(
            jid,
            '✅ Your Meta Ads account is connected! Ask me anything about your campaigns, insights, or budgets.',
          )
        }

        res.writeHead(200, { 'Content-Type': 'text/html' }).end(
          successPage('Your Meta Ads account is linked. You can close this tab and return to WhatsApp.'),
        )
      } catch (err) {
        console.error('[oauth] token exchange failed:', err)
        res.writeHead(500).end('Token exchange failed. Please try again.')
      }
      return
    }

    // ── Slack OAuth v2 install callback ───────────────────────────────────────
    if (url.pathname === '/auth/slack/callback') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')

      if (error || !code || !state) {
        console.error('[slack-oauth] callback error:', error ?? 'missing code/state')
        res.writeHead(400).end(`Slack authorization failed: ${error ?? 'missing parameters'}`)
        return
      }

      const oauthClientId = verifySlackState(state)
      if (!oauthClientId) {
        res.writeHead(400).end('Invalid or expired state parameter')
        return
      }

      const slackClientId = process.env.SLACK_CLIENT_ID
      const slackClientSecret = process.env.SLACK_CLIENT_SECRET
      if (!slackClientId || !slackClientSecret) {
        res.writeHead(500).end('Slack is not configured on this server.')
        return
      }

      try {
        const exchange = await exchangeSlackOAuthCode(code, slackClientId, slackClientSecret, slackRedirectUri())
        await saveSlackConnection(oauthClientId, {
          botToken: exchange.accessToken,
          teamId: exchange.teamId,
          teamName: exchange.teamName,
          installerUserId: exchange.installerUserId,
        })
        console.log(`[slack-oauth] workspace ${exchange.teamId} connected for client ${oauthClientId}`)
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(
          successPage('Slack is connected. You can close this tab and return to your dashboard.'),
        )
      } catch (err) {
        console.error('[slack-oauth] token exchange failed:', err)
        res.writeHead(500).end('Slack authorization failed. Please try again.')
      }
      return
    }

    res.writeHead(404).end('Not found')
  })

  server.listen(PORT, () => {
    const base = process.env.CALLBACK_BASE_URL ?? `http://localhost:${PORT}`
    console.log(`✓ Server listening on http://localhost:${PORT}`)
    console.log(`  Onboarding: ${base}/onboarding`)
    console.log(`  Meta OAuth callback: ${base}/auth/meta/callback`)
    if (isTwilioProvider()) {
      console.log(`  Twilio webhook: ${base}/webhooks/twilio/whatsapp`)
    }
    if (process.env.SLACK_CLIENT_ID) {
      console.log(`  Slack OAuth callback: ${base}/auth/slack/callback`)
      console.log(`  Slack Events request URL: ${base}/webhooks/slack/events`)
    }
    if (process.env.HIGGSFIELD_SETUP_SECRET) {
      console.log('  Higgsfield setup: /auth/higgsfield/start?key=...')
    }
  })
}

function successPage(message: string): string {
  return '<html><body style="font-family:sans-serif;text-align:center;padding:60px">' +
    `<h2>✅ Connected!</h2><p>${message}</p>` +
    '</body></html>'
}
