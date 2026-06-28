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
import { ensureTenant, tenantIdForJid } from './tenant-store.js'
import { loadSession } from './onboarding/session.js'

const authHandler = toNodeHandler(auth)

const PORT = Number(process.env.CALLBACK_PORT ?? 3456)

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
      await ensureTenant(session.user.id)

      // Look up WhatsApp link state from the tenant table + onboarding sessions
      const jid = await (async () => {
        // Find the JID linked to this tenant
        const { db: database } = await import('./db/index.js')
        const { tenant: tenantTable } = await import('./db/schema.js')
        const { eq } = await import('drizzle-orm')
        const row = await database.select().from(tenantTable).where(eq(tenantTable.userId, session.user.id)).get()
        return row ?? null
      })()

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(renderDashboardPage(session.user, {
          whatsappLinked: !!jid?.whatsappJid,
          whatsappJid: jid?.whatsappJid ?? null,
          whatsappProvider: jid?.whatsappProvider ?? null,
          onboardingStep: 1,
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
