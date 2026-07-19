import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const ACTIVATION_EVENTS = [
  'onboarding_phase_viewed',
  'onboarding_phase_completed',
  'preview_requested',
  'preview_generated',
  'preview_fallback',
  'preview_failed',
  'specialist_selected',
  'routine_configured',
  'routine_skipped',
  'integration_started',
  'integration_connected',
  'integration_failed',
  'integration_skipped',
  'whatsapp_connection_started',
  'whatsapp_connection_verified',
  'launch_completed',
  'first_brief_opened',
  'first_agent_output_delivered',
] as const

export type ActivationEventName = typeof ACTIVATION_EVENTS[number]

export interface ActivationEventProperties {
  phase?: 'brief' | 'configure' | 'launch'
  step?: number
  outcome?: string
  durationMs?: number
  platform?: string
  source?: 'ai' | 'fallback'
}

export interface ActivationEventRecord {
  event: ActivationEventName
  occurredAt: string
  properties: ActivationEventProperties
}

const EVENT_SET = new Set<string>(ACTIVATION_EVENTS)
const OUTCOME_SET = new Set(['twilio', 'baileys', 'connected', 'skipped', 'success', 'error'])
const PLATFORM_SET = new Set(['meta-ads', 'instagram-graph', 'tiktok', 'google', 'higgsfield'])
const MAX_RECORDS = 200
const UNIQUE_MILESTONES = new Set<ActivationEventName>(['launch_completed', 'first_agent_output_delivered'])
const persistQueues = new Map<string, Promise<boolean>>()

export function isActivationEventName(value: unknown): value is ActivationEventName {
  return typeof value === 'string' && EVENT_SET.has(value)
}

export function sanitizeActivationProperties(value: unknown): ActivationEventProperties {
  if (!value || typeof value !== 'object') return {}
  const input = value as Record<string, unknown>
  const result: ActivationEventProperties = {}
  if (input.phase === 'brief' || input.phase === 'configure' || input.phase === 'launch') result.phase = input.phase
  if (typeof input.step === 'number' && Number.isInteger(input.step) && input.step >= 1 && input.step <= 6) result.step = input.step
  if (typeof input.outcome === 'string' && OUTCOME_SET.has(input.outcome)) result.outcome = input.outcome
  if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)) result.durationMs = Math.max(0, Math.min(input.durationMs, 3_600_000))
  if (typeof input.platform === 'string' && PLATFORM_SET.has(input.platform)) result.platform = input.platform
  if (input.source === 'ai' || input.source === 'fallback') result.source = input.source
  return result
}

function eventFile(clientId: string): string {
  return path.resolve(process.env.AGENT_STORE_DIR ?? './store', 'clients', clientId, 'activation-events.json')
}

async function readRecords(clientId: string): Promise<ActivationEventRecord[]> {
  try {
    return JSON.parse(await readFile(eventFile(clientId), 'utf8')) as ActivationEventRecord[]
  } catch {
    return []
  }
}

async function persistRecord(clientId: string, record: ActivationEventRecord): Promise<boolean> {
  const file = eventFile(clientId)
  await mkdir(path.dirname(file), { recursive: true })
  const existing = await readRecords(clientId)
  if (UNIQUE_MILESTONES.has(record.event) && existing.some((candidate) => candidate.event === record.event)) return false
  const next = [...existing, record].slice(-MAX_RECORDS)
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
  await rename(tmp, file)
  return true
}

async function queuePersistRecord(clientId: string, record: ActivationEventRecord): Promise<boolean> {
  const previous = persistQueues.get(clientId) ?? Promise.resolve(true)
  const current = previous.catch(() => false).then(() => persistRecord(clientId, record))
  persistQueues.set(clientId, current)
  try {
    return await current
  } finally {
    if (persistQueues.get(clientId) === current) persistQueues.delete(clientId)
  }
}

async function sendPostHog(clientId: string, record: ActivationEventRecord, fetchImpl: typeof fetch): Promise<void> {
  const apiKey = process.env.POSTHOG_API_KEY
  if (!apiKey) return
  const host = (process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com').replace(/\/$/, '')
  await fetchImpl(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      event: record.event,
      properties: { distinct_id: clientId, ...record.properties },
      timestamp: record.occurredAt,
    }),
    signal: AbortSignal.timeout(2_500),
  })
}

export async function recordActivationEvent(
  clientId: string,
  event: ActivationEventName,
  properties: ActivationEventProperties = {},
  options: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const record: ActivationEventRecord = {
    event,
    occurredAt: (options.now ?? new Date()).toISOString(),
    properties: sanitizeActivationProperties(properties),
  }
  try {
    const stored = await queuePersistRecord(clientId, record)
    if (!stored) return
  } catch (error) {
    console.warn('[activation] local event persistence failed:', error instanceof Error ? error.message : error)
  }
  try {
    await sendPostHog(clientId, record, options.fetchImpl ?? fetch)
  } catch (error) {
    console.warn('[activation] PostHog delivery failed:', error instanceof Error ? error.message : error)
  }
}
