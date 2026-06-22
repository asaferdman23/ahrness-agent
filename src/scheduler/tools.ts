import { tool } from '@strands-agents/sdk'
import type { JSONValue } from '@strands-agents/sdk'
import { isValidCron } from './cron.js'
import { addJob, listJobs, removeJob, updateJob } from './store.js'
import type { ScheduleSpec } from './types.js'

export function defaultTimezone(): string {
  return process.env.AGENT_TIMEZONE || process.env.TZ || 'UTC'
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new Error('Invalid tool input')
  return input as Record<string, unknown>
}

function jobSummary(job: {
  id: string
  title: string
  enabled: boolean
  schedule: ScheduleSpec
  lastRunAt: string | null
}): Record<string, JSONValue> {
  return {
    id: job.id,
    title: job.title,
    enabled: job.enabled,
    schedule: job.schedule.kind === 'cron' ? `${job.schedule.expr} (${job.schedule.timezone})` : `once @ ${job.schedule.at}`,
    lastRunAt: job.lastRunAt,
  }
}

/**
 * Tools that let the agent create and manage the client's scheduled automations
 * in conversation. `jid` is the live WhatsApp target, so jobs created here always
 * deliver to the right place.
 */
export function createSchedulerTools(clientId: string, jid: string): ReturnType<typeof tool>[] {
  const schedule = tool({
    name: 'schedule_task',
    description:
      'Schedule a recurring or one-off task that you will run automatically at the given time and deliver to this chat. ' +
      'Use this when the client asks to be reminded, to receive a recurring report, or to automate something on a cadence. ' +
      'Provide a cron expression for recurring tasks, or an ISO timestamp for a one-time task.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short human label, e.g. "Daily ROAS report".' },
        prompt: {
          type: 'string',
          description: 'The exact instruction you should follow when this fires, written as if the client asked it.',
        },
        cron: {
          type: 'string',
          description: '5-field cron expression (minute hour day-of-month month day-of-week), e.g. "0 9 * * 1" for Mondays 9am. Omit for a one-time task.',
        },
        at: {
          type: 'string',
          description: 'ISO 8601 timestamp for a one-time task, e.g. "2026-06-23T14:00:00Z". Omit for recurring tasks.',
        },
        timezone: {
          type: 'string',
          description: `IANA timezone for the cron expression. Defaults to ${defaultTimezone()}.`,
        },
      },
      required: ['title', 'prompt'],
      additionalProperties: false,
    },
    callback: async (rawInput) => {
      const input = asRecord(rawInput)
      const title = String(input.title ?? '').trim()
      const prompt = String(input.prompt ?? '').trim()
      if (!title || !prompt) throw new Error('title and prompt are required')

      const cron = typeof input.cron === 'string' ? input.cron.trim() : ''
      const at = typeof input.at === 'string' ? input.at.trim() : ''
      if (!!cron === !!at) throw new Error('Provide exactly one of cron (recurring) or at (one-time)')

      let spec: ScheduleSpec
      if (cron) {
        if (!isValidCron(cron)) throw new Error(`Invalid cron expression: "${cron}"`)
        const timezone = typeof input.timezone === 'string' && input.timezone ? input.timezone : defaultTimezone()
        spec = { kind: 'cron', expr: cron, timezone }
      } else {
        const at_ms = Date.parse(at)
        if (Number.isNaN(at_ms)) throw new Error(`Invalid ISO timestamp: "${at}"`)
        if (at_ms < Date.now()) throw new Error('One-time task must be in the future')
        spec = { kind: 'once', at: new Date(at_ms).toISOString() }
      }

      const job = await addJob({ clientId, jid, title, prompt, schedule: spec, enabled: true })
      return { scheduled: true, ...jobSummary(job) }
    },
  })

  const list = tool({
    name: 'list_scheduled_tasks',
    description: 'List the recurring and one-off tasks currently scheduled for this client.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    callback: async () => {
      const jobs = await listJobs(clientId)
      return { count: jobs.length, tasks: jobs.map(jobSummary) }
    },
  })

  const cancel = tool({
    name: 'cancel_scheduled_task',
    description: 'Cancel (delete) a scheduled task by its id. Get the id from list_scheduled_tasks first.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The task id to cancel.' } },
      required: ['id'],
      additionalProperties: false,
    },
    callback: async (rawInput) => {
      const id = String(asRecord(rawInput).id ?? '').trim()
      if (!id) throw new Error('id is required')
      const removed = await removeJob(clientId, id)
      return { cancelled: removed }
    },
  })

  const toggle = tool({
    name: 'set_scheduled_task_enabled',
    description: 'Pause or resume a scheduled task without deleting it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id.' },
        enabled: { type: 'boolean', description: 'true to resume, false to pause.' },
      },
      required: ['id', 'enabled'],
      additionalProperties: false,
    },
    callback: async (rawInput) => {
      const input = asRecord(rawInput)
      const id = String(input.id ?? '').trim()
      if (!id) throw new Error('id is required')
      const updated = await updateJob(clientId, id, { enabled: Boolean(input.enabled) })
      if (!updated) throw new Error(`No scheduled task with id ${id}`)
      return jobSummary(updated)
    },
  })

  return [schedule, list, cancel, toggle]
}
