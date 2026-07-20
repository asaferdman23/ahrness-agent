import type { IncomingMessage, ServerResponse } from 'node:http'
import { getClientMeta, updateClientMeta } from './store/client-store.js'

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

/**
 * GET/POST /api/agent-permissions — the client's own capability toggles for
 * the agent (currently just web browsing). Deliberately separate from the
 * MCP/platform-connection registry: this isn't an external account to
 * connect, it's a permission the client grants the agent itself.
 */
export async function handleAgentPermissionsApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  clientId: string,
): Promise<boolean> {
  if (url.pathname !== '/api/agent-permissions') return false

  if (req.method === 'GET') {
    const meta = await getClientMeta(clientId)
    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ webBrowsingEnabled: meta.webBrowsingEnabled ?? false }))
    return true
  }

  if (req.method === 'POST') {
    const raw = await readBody(req)
    let parsed: { webBrowsingEnabled?: unknown }
    try {
      parsed = JSON.parse(raw || '{}')
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Invalid JSON body' }))
      return true
    }
    const enabled = parsed.webBrowsingEnabled === true
    await updateClientMeta(clientId, {
      webBrowsingEnabled: enabled,
      ...(enabled ? { webBrowsingEnabledAt: new Date().toISOString() } : {}),
    })
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ webBrowsingEnabled: enabled }))
    return true
  }

  res.writeHead(405, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Method not allowed' }))
  return true
}
