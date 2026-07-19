import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { User } from '../auth.js'
import { resetVaultForTests } from '../vault.js'
import { createCrmStore } from './store.js'
import { renderCrmPage } from './views.js'

const user = { id: 'customer', name: 'Sarah', email: 'sarah@example.test', emailVerified: true, image: null, createdAt: new Date(), updatedAt: new Date() } satisfies User

test('renders truthful responsive CRM pages without internal identifiers or fabricated revenue', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bizzclaw-crm-view-'))
  process.env.AGENT_MASTER_KEY = 'view-test-key-that-is-at-least-thirty-two-characters'
  process.env.AGENT_VAULT_SALT_PATH = path.join(directory, 'vault.salt')
  resetVaultForTests()
  const store = createCrmStore('tenant_view', path.join(directory, 'crm.sqlite'))
  try {
    const empty = renderCrmPage(user, store, new URL('https://agent.example.test/dashboard/pipeline'))
    assert.match(empty, /Add a person first/)
    assert.match(empty, /No recorded value/)
    assert.doesNotMatch(empty, /generated revenue|ROI|tenant_view|email_hash|cipher/i)

    const person = store.createContact({ name: '<script>Buyer</script>', company: 'Example Co' })
    const opportunity = store.createOpportunity({ contactId: person.id, title: 'Annual plan', valueMinor: 250_000, currency: 'USD' })
    store.addNote({ opportunityId: opportunity.id, summary: '<img src=x onerror=alert(1)>' })
    const detail = renderCrmPage(user, store, new URL(`https://agent.example.test/dashboard/pipeline/opportunities/${opportunity.id}`))
    assert.match(detail, /Annual plan/)
    assert.match(detail, /\$2,500\.00/)
    assert.match(detail, /I confirm this outcome/)
    assert.match(detail, /I confirm this monetary value/)
    assert.match(detail, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.doesNotMatch(detail, /<img src=x onerror=alert\(1\)>/)
  } finally { store.close(); resetVaultForTests(); rmSync(directory, { recursive: true, force: true }) }
})
