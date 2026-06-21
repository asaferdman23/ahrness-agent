import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import path from 'node:path'
import { tool } from '@strands-agents/sdk'
import { clientSandboxKey, getClientSandboxByKey } from './sandbox.js'

const CONTAINER_INBOX = '/workspace/inbox'

function signingSecret(): string {
  const secret = process.env.MEDIA_SIGNING_SECRET ?? process.env.HIGGSFIELD_SETUP_SECRET
  if (!secret || secret.length < 24) throw new Error('MEDIA_SIGNING_SECRET must contain at least 24 characters')
  return secret
}

function signature(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function inboxFileName(requestedPath: string): string {
  const resolved = path.posix.resolve('/workspace', requestedPath)
  if (!resolved.startsWith(`${CONTAINER_INBOX}/`)) throw new Error(`Only files in ${CONTAINER_INBOX} can be shared`)
  const relative = path.posix.relative(CONTAINER_INBOX, resolved)
  if (!relative || relative.includes('/')) throw new Error('Shared input files must be directly inside /workspace/inbox')
  return relative
}

export function createShareInputTool(clientId: string): ReturnType<typeof tool> {
  return tool({
    name: 'share_input_with_higgsfield',
    description:
      'Creates a short-lived HTTPS URL for one WhatsApp attachment in /workspace/inbox. ' +
      'Call this before passing an attached image, video, or audio file to a remote Higgsfield tool.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Exact /workspace/inbox path from the user message' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    callback: (rawInput) => {
      if (!rawInput || typeof rawInput !== 'object' || typeof (rawInput as Record<string, unknown>).path !== 'string') {
        throw new Error('path is required')
      }
      const fileName = inboxFileName((rawInput as { path: string }).path)
      const clientKey = clientSandboxKey(clientId)
      const expires = Date.now() + 15 * 60_000
      const payload = `${clientKey}\n${fileName}\n${expires}`
      const base = process.env.CALLBACK_BASE_URL?.replace(/\/$/, '')
      if (!base?.startsWith('https://')) throw new Error('CALLBACK_BASE_URL must be a public HTTPS URL')
      const url = `${base}/media/${clientKey}/${encodeURIComponent(fileName)}?expires=${expires}&sig=${signature(payload)}`
      return { url, expiresAt: new Date(expires).toISOString() }
    },
  })
}

export async function serveSharedInput(pathname: string, searchParams: URLSearchParams, res: ServerResponse): Promise<void> {
  const match = /^\/media\/([a-f0-9]{24})\/([^/]+)$/.exec(pathname)
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
  const suppliedSignature = searchParams.get('sig') ?? ''
  const payload = `${clientKey}\n${fileName}\n${expires}`
  if (!Number.isSafeInteger(expires) || expires < Date.now() || expires > Date.now() + 20 * 60_000) {
    res.writeHead(403).end('Link expired')
    return
  }
  if (!safeEqual(signature(payload), suppliedSignature)) {
    res.writeHead(403).end('Invalid signature')
    return
  }

  try {
    const maxBytes = positiveInteger(process.env.AGENT_MAX_INPUT_BYTES, 26_214_400)
    const { sandbox } = await getClientSandboxByKey(clientKey)
    const containerPath = `${CONTAINER_INBOX}/${fileName}`
    const quoted = shellQuote(containerPath)
    const result = await sandbox.execute(
      `test -f ${quoted} || exit 41; size=$(stat -c %s -- ${quoted}) || exit 41; ` +
      `[ "$size" -le ${maxBytes} ] || exit 42; base64 < ${quoted}`,
      { timeout: 30 },
    )
    if (result.exitCode !== 0) throw new Error('Invalid shared input file')
    const bytes = Buffer.from(result.stdout.replace(/\s/g, ''), 'base64')
    if (bytes.length > maxBytes) throw new Error('Invalid shared input file')
    res.writeHead(200, {
      'Content-Type': mimeTypeFor(fileName),
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    }).end(bytes)
  } catch (error) {
    console.error('[media-share] read failed:', error)
    if (!res.headersSent) res.writeHead(404).end('Not found')
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function mimeTypeFor(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase()
  const types: Record<string, string> = {
    '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
    '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.webm': 'video/webm',
  }
  return types[extension] ?? 'application/octet-stream'
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
