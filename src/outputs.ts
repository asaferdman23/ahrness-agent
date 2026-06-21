import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import path from 'node:path'
import { tool } from '@strands-agents/sdk'
import type { DockerSandbox } from '@strands-agents/sdk/sandbox/docker'
import { OUTPUTS_DIR, resolvePublishedOutputPath } from './sandbox.js'

export type PublishedOutput = {
  path: string
  fileName: string
  mimeType: string
  caption?: string
  size: number
}

const MIME_TYPES: Record<string, string> = {
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function inferMimeType(filePath: string): string {
  return MIME_TYPES[path.posix.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function maxOutputBytes(): number {
  const configured = Number.parseInt(process.env.AGENT_MAX_OUTPUT_BYTES ?? '', 10)
  return Number.isFinite(configured) && configured > 0 ? configured : 26_214_400
}

function parseInput(input: unknown): { path: string; mimeType?: string; caption?: string } {
  if (!input || typeof input !== 'object') throw new Error('publish_output input must be an object')
  const record = input as Record<string, unknown>
  if (typeof record.path !== 'string') throw new Error('path must be a string')
  if (record.mimeType !== undefined && typeof record.mimeType !== 'string') {
    throw new Error('mimeType must be a string')
  }
  if (record.caption !== undefined && typeof record.caption !== 'string') {
    throw new Error('caption must be a string')
  }
  if (typeof record.mimeType === 'string' && !/^[\w.+-]+\/[\w.+-]+$/.test(record.mimeType)) {
    throw new Error('mimeType is invalid')
  }
  return {
    path: record.path,
    mimeType: record.mimeType as string | undefined,
    caption: record.caption as string | undefined,
  }
}

export function createPublishOutputTool(
  sandbox: DockerSandbox,
  published: PublishedOutput[],
): ReturnType<typeof tool> {
  return tool({
    name: 'publish_output',
    description:
      `Publishes one completed file from ${OUTPUTS_DIR} to the WhatsApp client. ` +
      'Call this once for every file the client should receive.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: `File path inside ${OUTPUTS_DIR}` },
        mimeType: { type: 'string', description: 'Optional MIME type' },
        caption: { type: 'string', description: 'Optional short WhatsApp caption' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    callback: async (rawInput) => {
      const input = parseInput(rawInput)
      const outputPath = resolvePublishedOutputPath(input.path)
      const stat = await sandbox.execute(`test -f ${shellQuote(outputPath)} && stat -c %s -- ${shellQuote(outputPath)}`, {
        timeout: 10,
      })
      if (stat.exitCode !== 0) throw new Error(stat.stderr.trim() || 'Output file does not exist')

      const size = Number.parseInt(stat.stdout.trim(), 10)
      const maxBytes = maxOutputBytes()
      if (!Number.isFinite(size) || size < 0) throw new Error('Could not determine output file size')
      if (size > maxBytes) throw new Error(`Output is too large (${size} bytes; maximum ${maxBytes})`)

      const item: PublishedOutput = {
        path: outputPath,
        fileName: path.posix.basename(outputPath),
        mimeType: input.mimeType ?? inferMimeType(outputPath),
        caption: input.caption,
        size,
      }
      const existing = published.findIndex((candidate) => candidate.path === outputPath)
      if (existing >= 0) published[existing] = item
      else published.push(item)

      return { published: item.fileName, size: item.size, mimeType: item.mimeType }
    },
  })
}

export function createImportRemoteOutputTool(
  sandbox: DockerSandbox,
  published: PublishedOutput[],
): ReturnType<typeof tool> {
  return tool({
    name: 'deliver_higgsfield_output',
    description:
      'Downloads a completed public HTTPS result URL returned by Higgsfield, saves it in /workspace/outputs, ' +
      'and delivers it to the WhatsApp client. Use once for every completed Higgsfield image, video, or audio file.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Completed media URL returned by a Higgsfield tool' },
        fileName: { type: 'string', description: 'Safe output filename including its extension' },
        caption: { type: 'string', description: 'Optional short WhatsApp caption' },
      },
      required: ['url', 'fileName'],
      additionalProperties: false,
    },
    callback: async (rawInput) => {
      if (!rawInput || typeof rawInput !== 'object') throw new Error('Input must be an object')
      const input = rawInput as Record<string, unknown>
      if (typeof input.url !== 'string' || typeof input.fileName !== 'string') {
        throw new Error('url and fileName are required')
      }
      if (input.caption !== undefined && typeof input.caption !== 'string') throw new Error('caption must be a string')

      const fileName = sanitizeFileName(input.fileName)
      const response = await fetchPublicMedia(input.url, maxOutputBytes())
      const outputPath = resolvePublishedOutputPath(`outputs/${fileName}`)
      await sandbox.writeFile(outputPath, response.bytes)

      const item: PublishedOutput = {
        path: outputPath,
        fileName,
        mimeType: response.mimeType ?? inferMimeType(fileName),
        caption: typeof input.caption === 'string' ? input.caption.slice(0, 1024) : undefined,
        size: response.bytes.length,
      }
      const existing = published.findIndex((candidate) => candidate.path === outputPath)
      if (existing >= 0) published[existing] = item
      else published.push(item)
      return { delivered: fileName, size: item.size, mimeType: item.mimeType }
    },
  })
}

function sanitizeFileName(value: string): string {
  const base = path.posix.basename(value.trim()).replace(/[^a-zA-Z0-9._-]+/g, '-')
  if (!base || base === '.' || base === '..') throw new Error('fileName is invalid')
  return base.slice(0, 120)
}

async function fetchPublicMedia(
  rawUrl: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  let url = new URL(rawUrl)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await assertPublicHttpsUrl(url)
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
      headers: { 'User-Agent': 'ahrness-agent/0.1' },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirects === 3) throw new Error('Too many or invalid media redirects')
      url = new URL(location, url)
      continue
    }
    if (!response.ok || !response.body) throw new Error(`Could not download media: HTTP ${response.status}`)

    const declaredSize = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      throw new Error(`Remote output is larger than ${maxBytes} bytes`)
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`Remote output is larger than ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
    if (contentType === 'text/html' || contentType === 'application/json') {
      throw new Error(`Higgsfield result URL returned ${contentType} instead of a media file`)
    }
    return { bytes, mimeType: contentType || undefined }
  }
  throw new Error('Could not download media')
}

async function assertPublicHttpsUrl(url: URL): Promise<void> {
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only public HTTPS URLs are allowed')
  if (url.port && url.port !== '443') throw new Error('Only HTTPS port 443 is allowed')

  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Private or local media URLs are not allowed')
  }
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true
  }
  if (/^fe[89ab]/.test(normalized)) return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1]
  const ipv4 = mapped ?? (isIP(normalized) === 4 ? normalized : null)
  if (!ipv4) return false
  const [a, b] = ipv4.split('.').map(Number)
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

export async function readPublishedOutput(sandbox: DockerSandbox, output: PublishedOutput): Promise<Uint8Array> {
  const outputPath = resolvePublishedOutputPath(output.path)
  const maxBytes = maxOutputBytes()
  const quoted = shellQuote(outputPath)
  const command =
    `test -f ${quoted} || exit 41; ` +
    `size=$(stat -c %s -- ${quoted}) || exit 41; ` +
    `[ "$size" -le ${maxBytes} ] || exit 42; ` +
    `base64 < ${quoted}`
  const result = await sandbox.execute(command, { timeout: 30 })
  if (result.exitCode === 41) throw new Error(`Published output no longer exists: ${output.fileName}`)
  if (result.exitCode === 42) throw new Error(`Published output became larger than ${maxBytes} bytes`)
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `Could not read ${output.fileName}`)

  const bytes = Buffer.from(result.stdout.replace(/\s/g, ''), 'base64')
  if (bytes.length > maxBytes) throw new Error(`Published output is larger than ${maxBytes} bytes`)
  return bytes
}
