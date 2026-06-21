import type { RoleId } from '../store/types.js'

/**
 * When a job should fire.
 * - `cron`: classic 5-field cron expression evaluated in `timezone` (IANA name).
 * - `once`: a single absolute moment (ISO 8601). Removed after it runs.
 */
export type ScheduleSpec =
  | { kind: 'cron'; expr: string; timezone: string }
  | { kind: 'once'; at: string }

/**
 * A persisted, recurring (or one-shot) instruction the agent runs on its own.
 * At fire time the runner invokes the client's agent with `prompt` and delivers
 * the result to `jid` over WhatsApp — exactly as if the client had sent it.
 */
export interface ScheduledJob {
  id: string
  clientId: string
  /** WhatsApp JID the result is delivered to. */
  jid: string
  title: string
  /** Instruction handed to the agent when the job fires. */
  prompt: string
  schedule: ScheduleSpec
  /** Set when the job was created from a template (for de-duplication). */
  templateId?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastRunAt: string | null
  lastRunStatus?: 'ok' | 'error'
  lastError?: string
  runCount: number
}

/**
 * A pre-built automation a client can switch on per role during onboarding,
 * or that the agent can offer in conversation.
 */
export interface SchedulerTemplate {
  id: string
  /** Roles this template is offered to. */
  roles: RoleId[]
  emoji: string
  title: string
  /** One-line, human-facing description of the use case. */
  description: string
  /** Cron expression, evaluated in the client's timezone. */
  cron: string
  /** Human label for the cadence, e.g. "Every Monday, 9:00". */
  cadence: string
  /** Instruction handed to the agent when the job fires. */
  prompt: string
}
