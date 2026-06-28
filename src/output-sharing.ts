import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import path from 'node:path'
import { clientSandboxKey, getClientSandboxByKey } from './sandbox.js'

function signingSecret(): string {
  const secret = process.env.MEDIA_SIGNING_SECRET ?? process.env.HIGGSFIELD_SETUP_SECRET
  if (!secret || secret.length < 24) throw new Error('MEDIA_SIGNING_SECRET must contain at least 24 characters')
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Short-lived HTTPS URL for outbound media (Twilio mediaUrl). */
export function signedOutputUrl(clientId: string, fileName: string, mimeType: string): string {
  const clientKey = clientSandboxKey(clientId)
  const expires = Date.now() + 15 * 60_000
  const payload = `${clientKey}\nout\n${fileName}\n${mimeType}\n${expires}`
  const base = process.env.CALLBACK_BASE_URL?.replace(/\/$/, '')
  if (!base?.startsWith('https://')) throw new Error('CALLBACK_BASE_URL must be a public HTTPS URL for Twilio media')
  return `${base}/media/out/${clientKey}/${encodeURIComponent(fileName)}?expires=${expires}&mime=${encodeURIComponent(mimeType)}&sig=${sign(payload)}`
}

export async function serveSharedOutput(
  pathname: string,
  searchParams: URLSearchParams,
  res: ServerResponse,
): Promise<void> {
  const match = /^\/media\/out\/([a-f0-9]{24})\/([^/]+)$/.exec(pathname)
  if (!match) {
    res.writeHead(404).end('Not found')
    return
  }
  const clientKey = match[1]!
  let fileName: string
  try {
    fileName = decodeURIComponent(match[2]!)
  } catch {
    res.writeHead(400).end('Invalid file name')
    return
  }
  if (path.basename(fileName) !== fileName || !fileName) {
    res.writeHead(400).end('Invalid file name')
    return
  }

  const expires = Number(searchParams.get('expires'))
  const sig = searchParams.get('sig') ?? ''
  const mimeType = searchParams.get('mime') ?? 'application/octet-stream'
  if (!Number.isSafeInteger(expires) || expires < Date.now() || expires > Date.now() + 20 * 60_000) {
    res.writeHead(403).end('Link expired')
    return
  }

  const verifyPayload = `${clientKey}\nout\n${fileName}\n${mimeType}\n${expires}`
  if (!safeEqual(sign(verifyPayload), sig)) {
    res.writeHead(403).end('Forbidden')
    return
  }

  let workspaceDir: string
  try {
    ;({ workspaceDir } = await getClientSandboxByKey(clientKey))
  } catch {
    res.writeHead(404).end('Not found')
    return
  }

  const filePath = path.join(workspaceDir, 'outputs', fileName)
  const maxBytes = positiveInteger(process.env.AGENT_MAX_OUTPUT_BYTES, 26_214_400)
  let bytes: Buffer
  try {
    bytes = await readFile(filePath)
    if (bytes.length > maxBytes) throw new Error('too large')
  } catch {
    res.writeHead(404).end('Not found')
    return
  }

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Length': String(bytes.length),
    'Cache-Control': 'private, max-age=300',
  })
  res.end(bytes)
}
