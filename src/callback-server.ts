/**
 * HTTP server for OAuth callbacks, media serving, and web onboarding.
 * All routes are handled in a single server on CALLBACK_PORT (default 3456).
 */
import { createServer } from 'node:http'
import type { WASocket } from '@whiskeysockets/baileys'
import { exchangeCodeForToken, decodeState } from './oauth.js'
import { saveToken } from './token-store.js'
import { serveSharedInput } from './input-sharing.js'
import {
  completeHiggsfieldAuthorization,
  isHiggsfieldAuthorized,
  startHiggsfieldAuthorization,
  verifyHiggsfieldSetupSecret,
} from './higgsfield-auth.js'
import { createOnboardingHandler } from './onboarding/server.js'

const PORT = Number(process.env.CALLBACK_PORT ?? 3456)

export function startCallbackServer(socket: WASocket | null): void {
  const onboardingHandler = createOnboardingHandler()

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

    // ── Onboarding + platform OAuth (new) ────────────────────────────────────
    if (url.pathname.startsWith('/onboarding') || url.pathname.startsWith('/oauth/')) {
      await onboardingHandler(req, res)
      return
    }

    // ── Shared media serving ──────────────────────────────────────────────────
    if (url.pathname.startsWith('/media/')) {
      await serveSharedInput(url.pathname, url.searchParams, res)
      return
    }

    // ── Higgsfield OAuth ──────────────────────────────────────────────────────
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

    // ── Legacy Meta OAuth callback ────────────────────────────────────────────
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

        if (socket) {
          await socket.sendMessage(jid, {
            text: '✅ Your Meta Ads account is connected! Ask me anything about your campaigns, insights, or budgets.',
          })
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
