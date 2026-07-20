import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { handleSiteLoginRoute } from './site-login-http.js'
import { siteLoginConnectUrlFor } from './browser/site-login-link.js'
import { getSiteCredential } from './store/site-credentials-store.js'

async function withServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler)
  server.listen(0)
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

test('GET renders a form when the token is valid', async () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  const link = siteLoginConnectUrlFor('http://irrelevant', '972501234567@s.whatsapp.net', 'linkedin.com')
  const path = link.replace(/^https?:\/\/[^/]+/, '')
  const { url, close } = await withServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://internal')
    const handled = await handleSiteLoginRoute(req, res, parsed)
    if (!handled) res.writeHead(404).end()
  })
  const res = await fetch(`${url}${path}`)
  const body = await res.text()
  assert.equal(res.status, 200)
  assert.match(body, /linkedin\.com/)
  assert.match(body, /form/i)
  await close()
})

test('GET rejects an invalid token', async () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  const { url, close } = await withServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://internal')
    const handled = await handleSiteLoginRoute(req, res, parsed)
    if (!handled) res.writeHead(404).end()
  })
  const res = await fetch(`${url}/connect-site?c=not-a-real-token&domain=linkedin.com`)
  assert.equal(res.status, 400)
  await close()
})

test('POST saves the credential and returns success', async () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  process.env.AGENT_MASTER_KEY = 'd'.repeat(32)
  process.env.AGENT_STORE_DIR = '/tmp/ahrness-site-login-http-test'
  const link = siteLoginConnectUrlFor('http://irrelevant', '972501234568@s.whatsapp.net', 'reddit.com')
  const path = link.replace(/^https?:\/\/[^/]+/, '')
  const { url, close } = await withServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://internal')
    const handled = await handleSiteLoginRoute(req, res, parsed)
    if (!handled) res.writeHead(404).end()
  })
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'hunter2' }),
  })
  assert.equal(res.status, 200)

  const { clientIdFromJid } = await import('./store/client-store.js')
  const clientId = clientIdFromJid('972501234568@s.whatsapp.net')
  const saved = await getSiteCredential(clientId, 'reddit.com')
  assert.equal(saved?.username, 'alice')
  await close()
})
