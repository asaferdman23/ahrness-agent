import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCHEDULER_TEMPLATES, getTemplate, getTemplatesForRole } from './templates.js'
import { isValidCron } from './cron.js'

const REPORT_ID = 'client-weekly-report'

test('the weekly client report template exists', () => {
  const t = getTemplate(REPORT_ID)
  assert.ok(t, 'expected a client-weekly-report template')
})

test('it is offered to both marketing manager and ads analyst', () => {
  const t = getTemplate(REPORT_ID)!
  assert.deepEqual([...t.roles].sort(), ['ads-analyst', 'marketing-manager'])
  assert.ok(getTemplatesForRole('marketing-manager').some((x) => x.id === REPORT_ID))
  assert.ok(getTemplatesForRole('ads-analyst').some((x) => x.id === REPORT_ID))
})

test('it runs on a valid weekly cron', () => {
  const t = getTemplate(REPORT_ID)!
  assert.ok(isValidCron(t.cron), `invalid cron: ${t.cron}`)
})

test('its prompt instructs producing a deliverable document (not just a chat digest)', () => {
  const t = getTemplate(REPORT_ID)!
  assert.match(t.prompt, /publish_output|report|document|PDF/i)
})

test('all template ids remain unique after adding it', () => {
  const ids = SCHEDULER_TEMPLATES.map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length)
})
