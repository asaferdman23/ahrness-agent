import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { AddressInfo } from 'node:net'
import { handleAgentPermissionsApi } from './agent-permissions-http.js'
import { getClientMeta } from './store/client-store.js'

async function withServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler)
  server.listen(0)
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

test('GET returns the current flag, defaulting to false', async () => {
  const clientId = `perm-test-${Date.now()}-a`
  const { url, close } = await withServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://internal')
    const handled = await handleAgentPermissionsApi(req, res, parsed, clientId)
    if (!handled) res.writeHead(404).end()
  })
  const res = await fetch(`${url}/api/agent-permissions`)
  const body = await res.json()
  assert.equal(body.webBrowsingEnabled, false)
  await close()
})

test('POST enables the flag and persists it via ClientMeta', async () => {
  const clientId = `perm-test-${Date.now()}-b`
  const { url, close } = await withServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://internal')
    const handled = await handleAgentPermissionsApi(req, res, parsed, clientId)
    if (!handled) res.writeHead(404).end()
  })
  const res = await fetch(`${url}/api/agent-permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webBrowsingEnabled: true }),
  })
  const body = await res.json()
  assert.equal(body.webBrowsingEnabled, true)
  const meta = await getClientMeta(clientId)
  assert.equal(meta.webBrowsingEnabled, true)
  await close()
})

test('returns false (unhandled) for paths outside /api/agent-permissions', async () => {
  const clientId = `perm-test-${Date.now()}-c`
  const { url, close } = await withServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://internal')
    const handled = await handleAgentPermissionsApi(req, res, parsed, clientId)
    res.writeHead(handled ? 200 : 404).end()
  })
  const res = await fetch(`${url}/api/something-else`)
  assert.equal(res.status, 404)
  await close()
})
