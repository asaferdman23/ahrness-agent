import type { IncomingMessage, ServerResponse } from 'node:http'
import { getCrmStore } from './store.js'
import { isCrmStage, type AttributionState, type ConsentState, type CrmStage, type Relationship } from './types.js'

const MAX_BODY_BYTES = 64 * 1024

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(value))
}

export function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  if (!origin || !host) return false
  try {
    const parsed = new URL(origin)
    const configured = process.env.CALLBACK_BASE_URL
    if (configured) return parsed.origin === new URL(configured).origin
    return parsed.host === host && (parsed.protocol === 'https:' || parsed.protocol === 'http:')
  } catch { return false }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new Error('Content-Type must be application/json')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large')
    chunks.push(buffer)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object required')
  return parsed as Record<string, unknown>
}

function stringValue(body: Record<string, unknown>, key: string): string | undefined {
  return typeof body[key] === 'string' ? body[key].trim() || undefined : undefined
}

function nullableString(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined
  if (body[key] === null || body[key] === '') return null
  return stringValue(body, key)
}

function majorToMinor(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const text = String(value).trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Value must be a positive amount with at most two decimals')
  const [whole, fraction = ''] = text.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(minor)) throw new Error('Value is too large')
  return minor
}

export async function handleCrmApi(req: IncomingMessage, res: ServerResponse, url: URL, tenantId: string): Promise<boolean> {
  if (!url.pathname.startsWith('/api/crm')) return false
  const store = getCrmStore(tenantId)
  try {
    if (req.method === 'GET') {
      if (url.pathname === '/api/crm/summary') return send(res, 200, store.summary()), true
      if (url.pathname === '/api/crm/contacts') return send(res, 200, { people: store.listContacts(url.searchParams.get('search') ?? '') }), true
      if (url.pathname === '/api/crm/opportunities') {
        const stage = url.searchParams.get('stage')
        if (stage && !isCrmStage(stage)) throw new Error('Invalid stage')
        return send(res, 200, { opportunities: store.listOpportunities(stage as CrmStage | undefined) }), true
      }
      if (url.pathname === '/api/crm/follow-ups') return send(res, 200, { followUps: store.listFollowUps(url.searchParams.get('completed') === 'true') }), true
      const contact = url.pathname.match(/^\/api\/crm\/contacts\/([^/]+)$/)
      if (contact) { const value = store.getContact(contact[1]!); return send(res, value ? 200 : 404, value ?? { error: 'Person not found' }), true }
      const opportunity = url.pathname.match(/^\/api\/crm\/opportunities\/([^/]+)$/)
      if (opportunity) { const value = store.getOpportunity(opportunity[1]!); return send(res, value ? 200 : 404, value ? { ...value, activities: store.listActivities({ opportunityId: value.id }) } : { error: 'Opportunity not found' }), true }
      return send(res, 404, { error: 'CRM route not found' }), true
    }

    if (req.method !== 'POST' && req.method !== 'PATCH') return send(res, 405, { error: 'Method not allowed' }), true
    if (!isSameOriginRequest(req)) return send(res, 403, { error: 'Same-origin request required' }), true
    const body = await readJson(req)

    if (req.method === 'POST' && url.pathname === '/api/crm/contacts') {
      const name = stringValue(body, 'name'); if (!name) throw new Error('Name is required')
      return send(res, 201, store.createContact({ name, company: nullableString(body, 'company'), email: nullableString(body, 'email'), phone: nullableString(body, 'phone'), relationship: stringValue(body, 'relationship') as Relationship | undefined, consent: stringValue(body, 'consent') as ConsentState | undefined, source: nullableString(body, 'source'), actor: 'customer' })), true
    }
    if (req.method === 'POST' && url.pathname === '/api/crm/opportunities') {
      const contactId = stringValue(body, 'contactId'); const title = stringValue(body, 'title')
      if (!contactId || !title) throw new Error('Person and opportunity name are required')
      const stage = stringValue(body, 'stage'); if (stage && !isCrmStage(stage)) throw new Error('Invalid stage')
      return send(res, 201, store.createOpportunity({ contactId, title, stage: stage as CrmStage | undefined, valueMinor: majorToMinor(body.valueMajor), currency: nullableString(body, 'currency'), expectedCloseAt: nullableString(body, 'expectedCloseAt'), source: nullableString(body, 'source'), actor: 'customer' })), true
    }
    if (req.method === 'POST' && url.pathname === '/api/crm/follow-ups') {
      const contactId = stringValue(body, 'contactId'); const action = stringValue(body, 'action'); const dueAt = stringValue(body, 'dueAt')
      if (!contactId || !action || !dueAt) throw new Error('Person, next action, and due date are required')
      return send(res, 201, store.createFollowUp({ contactId, opportunityId: nullableString(body, 'opportunityId'), action, dueAt, actor: 'customer' })), true
    }

    const contactPatch = url.pathname.match(/^\/api\/crm\/contacts\/([^/]+)$/)
    if (req.method === 'PATCH' && contactPatch) {
      return send(res, 200, store.updateContact(contactPatch[1]!, { name: stringValue(body, 'name'), company: nullableString(body, 'company'), email: nullableString(body, 'email'), phone: nullableString(body, 'phone'), relationship: stringValue(body, 'relationship') as Relationship | undefined, consent: stringValue(body, 'consent') as ConsentState | undefined, source: nullableString(body, 'source'), actor: 'customer' })), true
    }
    const opportunityPatch = url.pathname.match(/^\/api\/crm\/opportunities\/([^/]+)$/)
    if (req.method === 'PATCH' && opportunityPatch) {
      const id = opportunityPatch[1]!
      const existing = store.getOpportunity(id)
      if (!existing) throw new Error('Opportunity not found')
      let result = existing
      if ('title' in body || 'expectedCloseAt' in body || 'source' in body) {
        result = store.updateOpportunity(id, { title: stringValue(body, 'title'), expectedCloseAt: nullableString(body, 'expectedCloseAt'), source: nullableString(body, 'source'), actor: 'customer' })
      }
      const stage = stringValue(body, 'stage')
      if (stage) {
        if (!isCrmStage(stage)) throw new Error('Invalid stage')
        result = store.moveOpportunity(id, stage, { confirmed: body.confirmed === true, lossReason: nullableString(body, 'lossReason'), actor: 'customer' })
      }
      if ('valueMajor' in body) result = store.updateOpportunityValue(id, majorToMinor(body.valueMajor) ?? null, nullableString(body, 'currency') ?? null, body.confirmed === true, 'customer')
      return send(res, 200, result), true
    }
    const complete = url.pathname.match(/^\/api\/crm\/follow-ups\/([^/]+)\/complete$/)
    if (req.method === 'POST' && complete) return send(res, 200, store.completeFollowUp(complete[1]!, 'customer')), true
    const reschedule = url.pathname.match(/^\/api\/crm\/follow-ups\/([^/]+)$/)
    if (req.method === 'PATCH' && reschedule) {
      const dueAt = stringValue(body, 'dueAt'); if (!dueAt) throw new Error('Due date is required')
      return send(res, 200, store.rescheduleFollowUp(reschedule[1]!, dueAt, 'customer')), true
    }
    const note = url.pathname.match(/^\/api\/crm\/opportunities\/([^/]+)\/notes$/)
    if (req.method === 'POST' && note) {
      const summary = stringValue(body, 'summary'); if (!summary) throw new Error('Note is required')
      return send(res, 201, store.addNote({ opportunityId: note[1]!, summary, actor: 'customer' })), true
    }
    const attribution = url.pathname.match(/^\/api\/crm\/opportunities\/([^/]+)\/attribution$/)
    if (req.method === 'POST' && attribution) {
      const state = stringValue(body, 'state') as AttributionState | undefined
      if (!state) throw new Error('Attribution state is required')
      return send(res, 200, store.recordAttribution({ opportunityId: attribution[1]!, state, evidence: nullableString(body, 'evidence'), actor: 'customer' })), true
    }
    return send(res, 404, { error: 'CRM route not found' }), true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CRM request failed'
    const status = /confirmation/.test(message) ? 409 : /not found/i.test(message) ? 404 : 400
    send(res, status, { error: message })
    return true
  }
}
