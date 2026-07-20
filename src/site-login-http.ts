import type { IncomingMessage, ServerResponse } from 'node:http'
import { verifySiteLoginToken } from './browser/site-login-link.js'
import { saveSiteCredential } from './store/site-credentials-store.js'
import { clientIdFromJid } from './store/client-store.js'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string)
}

function formPage(domain: string): string {
  return (
    '<html><body style="font-family:sans-serif;max-width:420px;margin:60px auto;padding:0 16px">' +
    `<h2>Connect your ${escapeHtml(domain)} login</h2>` +
    '<p>Your agent will use this only to log into this one site on your behalf. It is stored encrypted and never shown in your WhatsApp chat.</p>' +
    '<form method="POST">' +
    '<p><label>Username or email<br><input name="username" type="text" required style="width:100%;padding:8px"></label></p>' +
    '<p><label>Password<br><input name="password" type="password" required style="width:100%;padding:8px"></label></p>' +
    '<button type="submit" style="padding:10px 20px">Save</button>' +
    '</form></body></html>'
  )
}

function successPage(domain: string): string {
  return (
    '<html><body style="font-family:sans-serif;text-align:center;padding:60px">' +
    `<h2>✅ Connected!</h2><p>Your ${escapeHtml(domain)} login was saved. You can close this tab.</p>` +
    '</body></html>'
  )
}

/**
 * GET/POST /connect-site?c=<signed-jid-token>&domain=<domain> — reached via a
 * WhatsApp-delivered link (same trust model as the onboarding link), never a
 * logged-in dashboard session. Only place a site-login credential is ever written.
 */
export async function handleSiteLoginRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/connect-site') return false

  const token = url.searchParams.get('c') ?? ''
  const domain = (url.searchParams.get('domain') ?? '').trim().toLowerCase()
  const jid = verifySiteLoginToken(token)

  if (!jid || !domain) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end('<p>This link is invalid or has expired.</p>')
    return true
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(formPage(domain))
    return true
  }

  if (req.method === 'POST') {
    const raw = await readBody(req)
    let parsed: { username?: unknown; password?: unknown }
    const contentType = req.headers['content-type'] ?? ''
    if (contentType.includes('application/json')) {
      try {
        parsed = JSON.parse(raw || '{}')
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end('<p>Invalid submission.</p>')
        return true
      }
    } else {
      const form = new URLSearchParams(raw)
      parsed = { username: form.get('username') ?? undefined, password: form.get('password') ?? undefined }
    }
    if (typeof parsed.username !== 'string' || !parsed.username.trim() || typeof parsed.password !== 'string' || !parsed.password) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end('<p>Username and password are both required.</p>')
      return true
    }
    const clientId = clientIdFromJid(jid)
    await saveSiteCredential(clientId, domain, parsed.username.trim(), parsed.password)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(successPage(domain))
    return true
  }

  res.writeHead(405, { 'Content-Type': 'text/html; charset=utf-8' }).end('<p>Method not allowed.</p>')
  return true
}
