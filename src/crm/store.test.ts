import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { resetVaultForTests } from '../vault.js'
import { createCrmStore, type CrmStore } from './store.js'

function fixture(): { directory: string; file: string; store: CrmStore; cleanup: () => void } {
  const directory = mkdtempSync(path.join(tmpdir(), 'bizzclaw-crm-'))
  process.env.AGENT_MASTER_KEY = 'test-master-key-that-is-at-least-thirty-two-characters'
  process.env.AGENT_VAULT_SALT_PATH = path.join(directory, 'vault.salt')
  resetVaultForTests()
  const file = path.join(directory, 'crm.sqlite')
  const store = createCrmStore('tenant_a', file)
  return { directory, file, store, cleanup: () => { store.close(); resetVaultForTests(); rmSync(directory, { recursive: true, force: true }) } }
}

test('stores contact identity encrypted and keeps immutable activity history', () => {
  const { file, store, cleanup } = fixture()
  try {
    const contact = store.createContact({ name: 'Ada Lovelace', email: 'ada@example.com', phone: '+44 7700 900123' })
    assert.equal(contact.email, 'ada@example.com')
    assert.equal(contact.phone, '+44 7700 900123')
    store.updateContact(contact.id, { company: 'Analytical Engines' })
    store.addNote({ contactId: contact.id, summary: 'Private pricing discussion' })
    const raw = readFileSync(file)
    assert.equal(raw.includes(Buffer.from('ada@example.com')), false)
    assert.equal(raw.includes(Buffer.from('+44 7700 900123')), false)
    assert.equal(raw.includes(Buffer.from('Private pricing discussion')), false)
    assert.deepEqual(new Set(store.listActivities({ contactId: contact.id }).map((item) => item.type)), new Set(['note', 'contact_updated', 'contact_created']))
  } finally { cleanup() }
})

test('prevents duplicate identity within a tenant while allowing it across tenants', () => {
  const { file, store, cleanup } = fixture()
  const second = createCrmStore('tenant_b', file)
  try {
    store.createContact({ name: 'Ada', email: 'Ada@Example.com' })
    assert.throws(() => store.createContact({ name: 'Duplicate', email: 'ada@example.com' }), /already exists/)
    assert.equal(store.listActivities().filter((item) => item.type === 'contact_created').length, 1)
    assert.doesNotThrow(() => second.createContact({ name: 'Ada elsewhere', email: 'ada@example.com' }))
  } finally { second.close(); cleanup() }
})

test('binds every lookup and relationship to the authenticated tenant', () => {
  const { file, store, cleanup } = fixture()
  const second = createCrmStore('tenant_b', file)
  try {
    const secret = store.createContact({ name: 'Tenant A person', email: 'private@example.com' })
    assert.equal(second.getContact(secret.id), null)
    assert.equal(second.listContacts('private@example.com').length, 0)
    assert.throws(() => second.createOpportunity({ contactId: secret.id, title: 'Cross-tenant deal' }), /Person not found/)
    assert.throws(() => second.addNote({ opportunityId: 'unknown', summary: 'Nope' }), /Opportunity not found/)
  } finally { second.close(); cleanup() }
})

test('requires confirmation for money changes and closing outcomes', () => {
  const { store, cleanup } = fixture()
  try {
    const contact = store.createContact({ name: 'Grace Hopper' })
    const opportunity = store.createOpportunity({ contactId: contact.id, title: 'Compiler rollout', valueMinor: 500_000, currency: 'usd' })
    assert.throws(() => store.updateOpportunityValue(opportunity.id, 700_000, 'USD', false), /confirmation/)
    assert.throws(() => store.moveOpportunity(opportunity.id, 'won'), /confirmation/)
    assert.equal(store.updateOpportunityValue(opportunity.id, 700_000, 'usd', true).valueMinor, 700_000)
    const won = store.moveOpportunity(opportunity.id, 'won', { confirmed: true, now: '2026-07-19T09:00:00.000Z' })
    assert.equal(won.stage, 'won')
    assert.equal(won.wonAt, '2026-07-19T09:00:00.000Z')
    assert.equal(store.listActivities({ opportunityId: opportunity.id }).some((item) => item.type === 'stage_changed'), true)
  } finally { cleanup() }
})

test('separates verified, influenced, and unknown won revenue', () => {
  const { store, cleanup } = fixture()
  try {
    const person = store.createContact({ name: 'Katherine Johnson' })
    const verified = store.createOpportunity({ contactId: person.id, title: 'Verified', valueMinor: 100_00, currency: 'USD' })
    const influenced = store.createOpportunity({ contactId: person.id, title: 'Influenced', valueMinor: 200_00, currency: 'USD' })
    const unknown = store.createOpportunity({ contactId: person.id, title: 'Unknown', valueMinor: 300_00, currency: 'USD' })
    assert.throws(() => store.recordAttribution({ opportunityId: verified.id, state: 'verified' }), /requires evidence/)
    store.recordAttribution({ opportunityId: verified.id, state: 'verified', evidence: 'Customer selected campaign code BC-42 at checkout' })
    store.recordAttribution({ opportunityId: influenced.id, state: 'influenced', evidence: 'Customer replied after BizzClaw follow-up' })
    for (const item of [verified, influenced, unknown]) store.moveOpportunity(item.id, 'won', { confirmed: true, now: '2026-07-19T10:00:00.000Z' })
    const summary = store.summary(new Date('2026-07-20T10:00:00.000Z'))
    assert.deepEqual(summary.wonThisMonthByCurrency, { USD: 600_00 })
    assert.deepEqual(summary.verifiedWonThisMonthByCurrency, { USD: 100_00 })
    assert.deepEqual(summary.influencedWonThisMonthByCurrency, { USD: 200_00 })
  } finally { cleanup() }
})

test('tracks due follow-ups, rescheduling, and completion without deletion', () => {
  const { file, store, cleanup } = fixture()
  try {
    const person = store.createContact({ name: 'Dorothy Vaughan' })
    const followUp = store.createFollowUp({ contactId: person.id, action: 'Send proposal', dueAt: '2026-07-18T09:00:00Z' })
    assert.equal(store.summary(new Date('2026-07-19T09:00:00Z')).followUpsDue, 1)
    assert.equal(store.rescheduleFollowUp(followUp.id, '2026-07-21T09:00:00Z').dueAt, '2026-07-21T09:00:00.000Z')
    assert.equal(store.completeFollowUp(followUp.id, 'customer', '2026-07-20T09:00:00.000Z').completedAt, '2026-07-20T09:00:00.000Z')
    assert.throws(() => store.rescheduleFollowUp(followUp.id, '2026-07-22T09:00:00Z'), /cannot be rescheduled/)
    const db = new Database(file, { readonly: true })
    const count = (db.prepare('SELECT COUNT(*) AS count FROM crm_follow_ups').get() as { count: number }).count
    db.close()
    assert.equal(count, 1)
  } finally { cleanup() }
})

test('does not treat arbitrary text as an empty phone match', () => {
  const { store, cleanup } = fixture()
  try {
    store.createContact({ name: 'No phone' })
    assert.throws(() => store.createContact({ name: 'Bad email', email: 'not-an-email' }), /email must be valid/)
    assert.throws(() => store.createContact({ name: 'Bad phone', phone: 'call me' }), /phone must contain digits/)
    assert.throws(() => store.addNote({ summary: 'Orphan note' }), /person or opportunity/i)
    assert.equal(store.listContacts('not-a-phone').length, 0)
  } finally { cleanup() }
})
