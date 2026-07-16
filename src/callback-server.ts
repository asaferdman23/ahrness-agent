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

const authHandler = toNodeHandler(auth)

const PORT = Number(process.env.CALLBACK_PORT ?? 3456)
const confirmationStore = fileConfirmationStore()

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
  requiredPlatforms: PlatformId[]
  connectedPlatforms: Set<PlatformId>
  whatsappLinked: boolean
}): number {
  if (!input.hasProfile) return 1
  if (!input.hasRole) return 2
  if (input.requiredPlatforms.some((platform) => !input.connectedPlatforms.has(platform))) return 4
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

      const connectedPlatforms = new Set(
        Object.entries(connections)
          .filter(([, record]) => record?.status === 'connected')
          .map(([platform]) => platform as PlatformId),
      )

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
      if (!profile?.business?.name) {
        alerts.push({
          title: 'Business context is still thin',
          detail: 'Add your business name and a few public links so the agent can reason from real context.',
          level: 'info' as const,
        })
      }
      if (requiredPlatforms.some((platformId) => !connectedPlatforms.has(platformId))) {
        alerts.push({
          title: 'Required connections are missing',
          detail: 'Your current role has at least one required platform that is not connected yet.',
          level: 'warn' as const,
        })
      }
      if (!tenantRow?.whatsappJid) {
        alerts.push({
          title: 'WhatsApp is not linked',
          detail: 'The dashboard exists, but the agent cannot talk to you until a WhatsApp transport is connected.',
          level: 'warn' as const,
        })
      }
      if (!jobs.length) {
        alerts.push({
          title: 'No automations are active',
          detail: 'The agent will still respond in chat, but nothing is scheduled to run on its own yet.',
          level: 'info' as const,
        })
      }
      if (pendingApproval) {
        alerts.push({
          title: pendingApproval.approved ? 'Approved action is waiting to run' : 'Action is waiting for your approval',
          detail: pendingApproval.summary,
          level: 'warn' as const,
        })
      }
      for (const platform of platforms) {
        if (isExpired(platform.tokenExpiresAt)) {
          alerts.push({
            title: `${platform.displayName} token expired`,
            detail: `Reconnect ${platform.displayName} so the agent can continue using it.`,
            level: 'warn' as const,
          })
        }
      }

      const lastActivityAt = [pendingApproval?.createdAt ?? null, ...jobs.map((job) => job.lastRunAt), ...platforms.map((platform) => platform.connectedAt)]
        .filter((value): value is string => !!value)
        .sort()
        .at(-1) ?? null

      const onboardingStep = computeOnboardingStep({
        hasProfile: !!profile,
        hasRole: !!roleRecord,
        requiredPlatforms,
        connectedPlatforms,
        whatsappLinked: !!tenantRow?.whatsappJid,
      })

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(renderDashboardPage(session.user, {
          whatsappLinked: !!tenantRow?.whatsappJid,
          whatsappJid: tenantRow?.whatsappJid ?? null,
          whatsappProvider: tenantRow?.whatsappProvider ?? null,
          telegramLinked: !!clientMeta.telegramChatId,
          telegramConnectUrl: botUsername ? telegramConnectUrl(botUsername, tenantId) : null,
          slackLinked: !!clientMeta.slackTeamId,
          slackConnectUrl: slackInstallUrl(tenantId),
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
        }))
      return
    }

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
