/**
 * Scheduler runner — the time-based engine the Strands SDK doesn't provide.
 *
 * Ticks on a fixed interval, finds jobs whose schedule matches the current
 * minute, and runs each one through the shared delivery path so the client
 * receives a proactive WhatsApp message. One-off jobs are deleted after firing.
 */
import type { WhatsAppTransport } from '../whatsapp-transport.js'
import { runAndDeliver } from '../delivery.js'
import { cronMatches } from './cron.js'
import { listAllJobs, removeJob, updateJob } from './store.js'
import type { ScheduledJob } from './types.js'

// Tick twice a minute so every wall-clock minute is observed even with drift.
const TICK_MS = 30_000

function minuteBucket(ms: number): number {
  return Math.floor(ms / 60_000)
}

function isDue(job: ScheduledJob, now: Date): boolean {
  if (!job.enabled) return false
  if (job.schedule.kind === 'once') {
    if (job.lastRunAt) return false
    return Date.parse(job.schedule.at) <= now.getTime()
  }
  // Recurring: match the cron, but only once per wall-clock minute.
  if (job.lastRunAt && minuteBucket(Date.parse(job.lastRunAt)) === minuteBucket(now.getTime())) return false
  try {
    return cronMatches(job.schedule.expr, now, job.schedule.timezone)
  } catch (err) {
    console.error(`[scheduler] bad cron on job ${job.id}:`, err instanceof Error ? err.message : err)
    return false
  }
}

export function startScheduler(transport: WhatsAppTransport): () => void {
  const running = new Set<string>()

  const tick = async (): Promise<void> => {
    const now = new Date()
    let jobs: ScheduledJob[]
    try {
      jobs = await listAllJobs()
    } catch (err) {
      console.error('[scheduler] failed to list jobs:', err)
      return
    }

    for (const job of jobs) {
      if (running.has(job.id)) continue
      if (!isDue(job, now)) continue
      running.add(job.id)
      // Claim the run immediately so a second tick can't double-fire it.
      void fire(transport, job).finally(() => running.delete(job.id))
    }
  }

  const timer = setInterval(() => void tick(), TICK_MS)
  // Don't let the scheduler keep the process alive on its own.
  timer.unref?.()
  console.log(`✓ Scheduler started (tick ${TICK_MS / 1000}s)`)

  return () => clearInterval(timer)
}

async function fire(transport: WhatsAppTransport, job: ScheduledJob): Promise<void> {
  // Mark as run up-front to claim this minute across ticks/restarts.
  await updateJob(job.clientId, job.id, { lastRunAt: new Date().toISOString() })
  console.log(`[scheduler] firing "${job.title}" for ${job.jid}`)
  try {
    await runAndDeliver(transport, job.jid, job.prompt)
    if (job.schedule.kind === 'once') {
      await removeJob(job.clientId, job.id)
    } else {
      await updateJob(job.clientId, job.id, { lastRunStatus: 'ok', lastError: undefined, runCount: job.runCount + 1 })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[scheduler] job ${job.id} failed:`, message)
    await updateJob(job.clientId, job.id, { lastRunStatus: 'error', lastError: message, runCount: job.runCount + 1 })
  }
}
