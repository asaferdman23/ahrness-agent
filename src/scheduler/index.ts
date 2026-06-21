import { addJob, hasTemplateJob } from './store.js'
import { getTemplate } from './templates.js'
import { defaultTimezone } from './tools.js'

export type { ScheduledJob, ScheduleSpec, SchedulerTemplate } from './types.js'
export { SCHEDULER_TEMPLATES, getTemplate, getTemplatesForRole } from './templates.js'
export { createSchedulerTools, defaultTimezone } from './tools.js'
export { listJobs, listAllJobs, addJob, removeJob, updateJob, getJob } from './store.js'
export { startScheduler } from './runner.js'

/**
 * Turn a client's chosen template ids into live scheduled jobs for the given JID.
 * Idempotent: a template already materialised for this client is skipped, so this
 * is safe to call on every agent build. Returns the number of new jobs created.
 */
export async function materializeTemplates(
  clientId: string,
  jid: string,
  templateIds: string[],
): Promise<number> {
  let created = 0
  for (const templateId of templateIds) {
    const template = getTemplate(templateId)
    if (!template) continue
    if (await hasTemplateJob(clientId, templateId)) continue
    await addJob({
      clientId,
      jid,
      title: template.title,
      prompt: template.prompt,
      schedule: { kind: 'cron', expr: template.cron, timezone: defaultTimezone() },
      templateId,
      enabled: true,
    })
    created++
  }
  return created
}
