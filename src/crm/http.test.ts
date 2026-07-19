import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resetVaultForTests } from '../vault.js'
import { closeCrmStores } from './store.js'
import { handleCrmApi, isSameOriginRequest } from './http.js'

interface ResponseCapture { status: number; body: string; headers: Record<string, string> }

function request(method: string, pathname: string, body?: Record<string, unknown>, origin = 'https://agent.example.test'): { req: IncomingMessage; res: ServerResponse; url: URL; capture: ResponseCapture } {
  const raw = body ? JSON.stringify(body) : ''
  const stream = Readable.from(raw ? [Buffer.from(raw)] : []) as unknown as IncomingMessage
  stream.method = method
  stream.url = pathname
  stream.headers = { host: 'agent.example.test', origin, 'content-type': 'application/json' }
  const capture: ResponseCapture = { status: 0, body: '', headers: {} }
  const response = {
    writeHead(status: number, headers?: Record<string, string>) { capture.status = status; capture.headers = headers ?? {}; return this },
    end(value?: string) { capture.body = value ?? ''; return this },
  } as unknown as ServerResponse
  return { req: stream, res: response, url: new URL(pathname, 'https://agent.example.test'), capture }
}

test('same-origin guard respects the configured production origin', () => {
  const previous = process.env.CALLBACK_BASE_URL
  process.env.CALLBACK_BASE_URL = 'https://agent.example.test'
  try {
    assert.equal(isSameOriginRequest(request('POST', '/api/crm/contacts').req), true)
    assert.equal(isSameOriginRequest(request('POST', '/api/crm/contacts', undefined, 'https://evil.example').req), false)
    assert.equal(isSameOriginRequest(request('POST', '/api/crm/contacts', undefined, 'http://agent.example.test').req), false)
  } finally { if (previous === undefined) delete process.env.CALLBACK_BASE_URL; else process.env.CALLBACK_BASE_URL = previous }
})

test('CRM API creates and lists records only inside the authenticated tenant', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bizzclaw-crm-http-'))
  const previousStore = process.env.AGENT_STORE_DIR
  const previousBase = process.env.CALLBACK_BASE_URL
  process.env.AGENT_STORE_DIR = directory
  process.env.AGENT_MASTER_KEY = 'http-test-key-that-is-at-least-thirty-two-characters'
  process.env.AGENT_VAULT_SALT_PATH = path.join(directory, 'vault.salt')
  process.env.CALLBACK_BASE_URL = 'https://agent.example.test'
  resetVaultForTests()
  try {
    const create = request('POST', '/api/crm/contacts', { name: 'Private Lead', email: 'lead@example.test' })
    assert.equal(await handleCrmApi(create.req, create.res, create.url, 'tenant_a'), true)
    assert.equal(create.capture.status, 201)
    const created = JSON.parse(create.capture.body) as { id: string }
    assert.ok(created.id)

    const own = request('GET', '/api/crm/contacts')
    await handleCrmApi(own.req, own.res, own.url, 'tenant_a')
    assert.equal((JSON.parse(own.capture.body) as { people: unknown[] }).people.length, 1)

    const other = request('GET', '/api/crm/contacts')
    await handleCrmApi(other.req, other.res, other.url, 'tenant_b')
    assert.equal((JSON.parse(other.capture.body) as { people: unknown[] }).people.length, 0)

    const blocked = request('POST', '/api/crm/contacts', { name: 'CSRF' }, 'https://evil.example')
    await handleCrmApi(blocked.req, blocked.res, blocked.url, 'tenant_a')
    assert.equal(blocked.capture.status, 403)
  } finally {
    closeCrmStores(); resetVaultForTests(); rmSync(directory, { recursive: true, force: true })
    if (previousStore === undefined) delete process.env.AGENT_STORE_DIR; else process.env.AGENT_STORE_DIR = previousStore
    if (previousBase === undefined) delete process.env.CALLBACK_BASE_URL; else process.env.CALLBACK_BASE_URL = previousBase
  }
})

test('CRM API requires explicit confirmation for Won and money changes', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bizzclaw-crm-confirm-'))
  process.env.AGENT_STORE_DIR = directory
  process.env.AGENT_MASTER_KEY = 'confirm-test-key-that-is-at-least-thirty-two-chars'
  process.env.AGENT_VAULT_SALT_PATH = path.join(directory, 'vault.salt')
  process.env.CALLBACK_BASE_URL = 'https://agent.example.test'
  resetVaultForTests()
  try {
    const personRequest = request('POST', '/api/crm/contacts', { name: 'Buyer' })
    await handleCrmApi(personRequest.req, personRequest.res, personRequest.url, 'tenant_confirm')
    const person = JSON.parse(personRequest.capture.body) as { id: string }
    const opportunityRequest = request('POST', '/api/crm/opportunities', { contactId: person.id, title: 'Expansion' })
    await handleCrmApi(opportunityRequest.req, opportunityRequest.res, opportunityRequest.url, 'tenant_confirm')
    const opportunity = JSON.parse(opportunityRequest.capture.body) as { id: string }

    const won = request('PATCH', `/api/crm/opportunities/${opportunity.id}`, { stage: 'won' })
    await handleCrmApi(won.req, won.res, won.url, 'tenant_confirm')
    assert.equal(won.capture.status, 409)

    const value = request('PATCH', `/api/crm/opportunities/${opportunity.id}`, { valueMajor: '1200.00', currency: 'USD' })
    await handleCrmApi(value.req, value.res, value.url, 'tenant_confirm')
    assert.equal(value.capture.status, 409)

    const confirmed = request('PATCH', `/api/crm/opportunities/${opportunity.id}`, { stage: 'won', confirmed: true })
    await handleCrmApi(confirmed.req, confirmed.res, confirmed.url, 'tenant_confirm')
    assert.equal(confirmed.capture.status, 200)
    assert.equal((JSON.parse(confirmed.capture.body) as { stage: string }).stage, 'won')
  } finally { closeCrmStores(); resetVaultForTests(); rmSync(directory, { recursive: true, force: true }) }
})
