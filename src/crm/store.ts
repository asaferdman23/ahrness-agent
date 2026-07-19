import Database from 'better-sqlite3'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { decryptSecret, encryptSecret } from '../vault.js'
import {
  ACTIVE_CRM_STAGES,
  CRM_STAGES,
  type AttributionState,
  type ConsentState,
  type Contact,
  type ContactView,
  type CrmActivity,
  type CrmActor,
  type CrmStage,
  type CrmSummary,
  type FollowUp,
  type Opportunity,
  type OpportunityView,
  type Relationship,
} from './types.js'

type Sqlite = InstanceType<typeof Database>

interface ContactRow {
  id: string; tenant_id: string; name: string; company: string | null
  email_cipher: string | null; email_hash: string | null; phone_cipher: string | null; phone_hash: string | null
  relationship: Relationship; consent: ConsentState; source: string | null
  created_at: string; updated_at: string; last_activity_at: string
}
interface OpportunityRow {
  id: string; tenant_id: string; contact_id: string; title: string; stage: CrmStage
  value_minor: number | null; currency: string | null; expected_close_at: string | null
  won_at: string | null; lost_at: string | null; loss_reason: string | null; source: string | null
  attribution_state: AttributionState; attribution_evidence_cipher: string | null; attribution_activity_id: string | null
  created_at: string; updated_at: string
}
interface FollowUpRow {
  id: string; tenant_id: string; contact_id: string; opportunity_id: string | null; action: string
  due_at: string; completed_at: string | null; created_at: string; updated_at: string
}
interface ActivityRow {
  id: string; tenant_id: string; contact_id: string | null; opportunity_id: string | null
  type: CrmActivity['type']; actor: CrmActor; summary_cipher: string; source_run_id: string | null; created_at: string
}

function assertTenantId(clientId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(clientId)) throw new Error('Invalid client id')
}

function dbPathFor(clientId: string): string {
  assertTenantId(clientId)
  return path.resolve(process.env.AGENT_STORE_DIR ?? './store', 'clients', clientId, 'crm.sqlite')
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function normalizePhone(value: string): string {
  const prefix = value.trim().startsWith('+') ? '+' : ''
  return `${prefix}${value.replace(/\D/g, '')}`
}

function identityHash(kind: 'email' | 'phone', normalized: string): string {
  const key = process.env.AGENT_MASTER_KEY
  if (!key || key.length < 32) throw new Error('AGENT_MASTER_KEY is required to protect CRM contact data')
  return createHmac('sha256', key).update(`crm:${kind}:${normalized}`).digest('hex')
}

function cleanText(value: unknown, field: string, max: number, required = false): string | null {
  if (value === null || value === undefined) {
    if (required) throw new Error(`${field} is required`)
    return null
  }
  const result = String(value).trim()
  if (!result) {
    if (required) throw new Error(`${field} is required`)
    return null
  }
  if (result.length > max) throw new Error(`${field} is too long`)
  return result
}

function isoDate(value: unknown, field: string, required = false): string | null {
  const text = cleanText(value, field, 80, required)
  if (!text) return null
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid date`)
  return new Date(parsed).toISOString()
}

function currencyCode(value: unknown, valueMinor: number | null): string | null {
  const code = cleanText(value, 'currency', 3)
  if (valueMinor !== null && !code) throw new Error('currency is required when a value is added')
  if (valueMinor === null && code) throw new Error('currency cannot be set without a value')
  if (!code) return null
  const upper = code.toUpperCase()
  if (!/^[A-Z]{3}$/.test(upper)) throw new Error('currency must be a 3-letter ISO code')
  return upper
}

function moneyMinor(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('valueMinor must be a non-negative integer')
  return number
}

function toContact(row: ContactRow): Contact {
  return {
    id: row.id, tenantId: row.tenant_id, name: row.name, company: row.company,
    email: row.email_cipher ? decryptSecret(row.email_cipher) : null,
    phone: row.phone_cipher ? decryptSecret(row.phone_cipher) : null,
    relationship: row.relationship, consent: row.consent, source: row.source,
    createdAt: row.created_at, updatedAt: row.updated_at, lastActivityAt: row.last_activity_at,
  }
}

function toOpportunity(row: OpportunityRow): Opportunity {
  return {
    id: row.id, tenantId: row.tenant_id, contactId: row.contact_id, title: row.title, stage: row.stage,
    valueMinor: row.value_minor, currency: row.currency, expectedCloseAt: row.expected_close_at,
    wonAt: row.won_at, lostAt: row.lost_at, lossReason: row.loss_reason, source: row.source,
    attributionState: row.attribution_state, attributionEvidence: row.attribution_evidence_cipher ? decryptSecret(row.attribution_evidence_cipher) : null,
    attributionActivityId: row.attribution_activity_id, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function toFollowUp(row: FollowUpRow): FollowUp {
  return { id: row.id, tenantId: row.tenant_id, contactId: row.contact_id, opportunityId: row.opportunity_id, action: row.action, dueAt: row.due_at, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at }
}

function toActivity(row: ActivityRow): CrmActivity {
  return { id: row.id, tenantId: row.tenant_id, contactId: row.contact_id, opportunityId: row.opportunity_id, type: row.type, actor: row.actor, summary: decryptSecret(row.summary_cipher), sourceRunId: row.source_run_id, createdAt: row.created_at }
}

function initialize(db: Sqlite): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const currentVersion = db.pragma('user_version', { simple: true }) as number
  if (currentVersion > 1) throw new Error(`CRM database version ${currentVersion} is newer than this application supports`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_contacts (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, company TEXT,
      email_cipher TEXT, email_hash TEXT, phone_cipher TEXT, phone_hash TEXT,
      relationship TEXT NOT NULL CHECK (relationship IN ('lead','customer')),
      consent TEXT NOT NULL CHECK (consent IN ('unknown','granted','denied')),
      source TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_activity_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_tenant_email ON crm_contacts(tenant_id,email_hash) WHERE email_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_tenant_phone ON crm_contacts(tenant_id,phone_hash) WHERE phone_hash IS NOT NULL;
    CREATE INDEX IF NOT EXISTS crm_contacts_tenant_activity ON crm_contacts(tenant_id,last_activity_at DESC);
    CREATE TABLE IF NOT EXISTS crm_opportunities (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, contact_id TEXT NOT NULL, title TEXT NOT NULL,
      stage TEXT NOT NULL CHECK (stage IN ('new_lead','contacted','replied','qualified','proposal_sent','won','lost')),
      value_minor INTEGER, currency TEXT, expected_close_at TEXT, won_at TEXT, lost_at TEXT, loss_reason TEXT, source TEXT,
      attribution_state TEXT NOT NULL DEFAULT 'unknown' CHECK (attribution_state IN ('verified','influenced','unknown')),
      attribution_evidence_cipher TEXT, attribution_activity_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(contact_id) REFERENCES crm_contacts(id)
    );
    CREATE INDEX IF NOT EXISTS crm_opportunities_tenant_stage ON crm_opportunities(tenant_id,stage,updated_at DESC);
    CREATE TABLE IF NOT EXISTS crm_follow_ups (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, contact_id TEXT NOT NULL, opportunity_id TEXT,
      action TEXT NOT NULL, due_at TEXT NOT NULL, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(contact_id) REFERENCES crm_contacts(id), FOREIGN KEY(opportunity_id) REFERENCES crm_opportunities(id)
    );
    CREATE INDEX IF NOT EXISTS crm_follow_ups_tenant_due ON crm_follow_ups(tenant_id,completed_at,due_at);
    CREATE TABLE IF NOT EXISTS crm_activities (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, contact_id TEXT, opportunity_id TEXT,
      type TEXT NOT NULL, actor TEXT NOT NULL, summary_cipher TEXT NOT NULL, source_run_id TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_activities_tenant_created ON crm_activities(tenant_id,created_at DESC);
  `)
  if (currentVersion < 1) db.pragma('user_version = 1')
}

export interface CreateContactInput {
  name: string; company?: string | null; email?: string | null; phone?: string | null
  relationship?: Relationship; consent?: ConsentState; source?: string | null; actor?: CrmActor
}
export interface CreateOpportunityInput {
  contactId: string; title: string; stage?: CrmStage; valueMinor?: number | null; currency?: string | null
  expectedCloseAt?: string | null; source?: string | null; actor?: CrmActor
}
export type UpdateContactInput = Partial<Omit<CreateContactInput, 'actor'>> & { actor?: CrmActor }
export interface UpdateOpportunityInput {
  title?: string; expectedCloseAt?: string | null; source?: string | null; actor?: CrmActor
}

export class CrmStore {
  constructor(readonly tenantId: string, private readonly db: Sqlite) {}

  close(): void { this.db.close() }

  private activity(input: Omit<CrmActivity, 'id' | 'tenantId' | 'createdAt'> & { createdAt?: string }): CrmActivity {
    const row: CrmActivity = { id: randomUUID(), tenantId: this.tenantId, createdAt: input.createdAt ?? new Date().toISOString(), ...input }
    this.db.prepare(`INSERT INTO crm_activities (id,tenant_id,contact_id,opportunity_id,type,actor,summary_cipher,source_run_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(row.id, row.tenantId, row.contactId, row.opportunityId, row.type, row.actor, encryptSecret(row.summary), row.sourceRunId, row.createdAt)
    return row
  }

  createContact(input: CreateContactInput): Contact {
    const name = cleanText(input.name, 'name', 160, true)!
    const company = cleanText(input.company, 'company', 160)
    const email = cleanText(input.email, 'email', 320)
    const phone = cleanText(input.phone, 'phone', 40)
    const normalizedEmail = email ? normalizeEmail(email) : null
    const normalizedPhone = phone ? normalizePhone(phone) : null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail!)) throw new Error('email must be valid')
    if (phone && !/\d/.test(normalizedPhone!)) throw new Error('phone must contain digits')
    const relationship = input.relationship ?? 'lead'
    const consent = input.consent ?? 'unknown'
    if (!['lead', 'customer'].includes(relationship)) throw new Error('Invalid relationship')
    if (!['unknown', 'granted', 'denied'].includes(consent)) throw new Error('Invalid consent state')
    const now = new Date().toISOString()
    const id = randomUUID()
    try {
      this.db.transaction(() => {
        this.db.prepare(`INSERT INTO crm_contacts (id,tenant_id,name,company,email_cipher,email_hash,phone_cipher,phone_hash,relationship,consent,source,created_at,updated_at,last_activity_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, this.tenantId, name, company, email ? encryptSecret(email) : null, normalizedEmail ? identityHash('email', normalizedEmail) : null, phone ? encryptSecret(phone) : null, normalizedPhone ? identityHash('phone', normalizedPhone) : null, relationship, consent, cleanText(input.source, 'source', 160), now, now, now)
        this.activity({ contactId: id, opportunityId: null, type: 'contact_created', actor: input.actor ?? 'customer', summary: `Added ${name}`, sourceRunId: null, createdAt: now })
      })()
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new Error('A person with that email or phone already exists')
      throw error
    }
    return this.getContact(id)!
  }

  getContact(id: string): Contact | null {
    const row = this.db.prepare('SELECT * FROM crm_contacts WHERE tenant_id = ? AND id = ?').get(this.tenantId, id) as ContactRow | undefined
    return row ? toContact(row) : null
  }

  updateContact(id: string, input: UpdateContactInput): Contact {
    const existing = this.getContact(id)
    if (!existing) throw new Error('Person not found')
    const name = input.name === undefined ? existing.name : cleanText(input.name, 'name', 160, true)!
    const company = input.company === undefined ? existing.company : cleanText(input.company, 'company', 160)
    const email = input.email === undefined ? existing.email : cleanText(input.email, 'email', 320)
    const phone = input.phone === undefined ? existing.phone : cleanText(input.phone, 'phone', 40)
    const normalizedEmail = email ? normalizeEmail(email) : null
    const normalizedPhone = phone ? normalizePhone(phone) : null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail!)) throw new Error('email must be valid')
    if (phone && !/\d/.test(normalizedPhone!)) throw new Error('phone must contain digits')
    const relationship = input.relationship ?? existing.relationship
    const consent = input.consent ?? existing.consent
    if (!['lead', 'customer'].includes(relationship)) throw new Error('Invalid relationship')
    if (!['unknown', 'granted', 'denied'].includes(consent)) throw new Error('Invalid consent state')
    const source = input.source === undefined ? existing.source : cleanText(input.source, 'source', 160)
    const now = new Date().toISOString()
    try {
      this.db.transaction(() => {
        this.db.prepare(`UPDATE crm_contacts SET name=?,company=?,email_cipher=?,email_hash=?,phone_cipher=?,phone_hash=?,relationship=?,consent=?,source=?,updated_at=?,last_activity_at=? WHERE tenant_id=? AND id=?`)
          .run(name, company, email ? encryptSecret(email) : null, normalizedEmail ? identityHash('email', normalizedEmail) : null, phone ? encryptSecret(phone) : null, normalizedPhone ? identityHash('phone', normalizedPhone) : null, relationship, consent, source, now, now, this.tenantId, id)
        this.activity({ contactId: id, opportunityId: null, type: 'contact_updated', actor: input.actor ?? 'customer', summary: `Updated ${name}`, sourceRunId: null, createdAt: now })
      })()
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new Error('A person with that email or phone already exists')
      throw error
    }
    return this.getContact(id)!
  }

  listContacts(search = ''): ContactView[] {
    const rows = this.db.prepare('SELECT * FROM crm_contacts WHERE tenant_id = ? ORDER BY last_activity_at DESC, name').all(this.tenantId) as ContactRow[]
    const needle = search.trim().toLowerCase()
    const phoneNeedle = normalizePhone(needle)
    const canSearchPhone = /\d/.test(phoneNeedle)
    const allOpportunities = this.listOpportunities()
    const followUps = this.listFollowUps()
    return rows.map(toContact).filter((contact) => !needle || contact.name.toLowerCase().includes(needle) || contact.company?.toLowerCase().includes(needle) || contact.email?.toLowerCase() === needle || (canSearchPhone && !!contact.phone && normalizePhone(contact.phone) === phoneNeedle)).map((contact) => {
      const opportunities = allOpportunities.filter((opportunity) => opportunity.contactId === contact.id && ACTIVE_CRM_STAGES.includes(opportunity.stage as typeof ACTIVE_CRM_STAGES[number]))
      const currencies = new Set(opportunities.filter((item) => item.valueMinor !== null && item.currency).map((item) => item.currency!))
      const total = currencies.size === 1 ? opportunities.reduce((sum, item) => sum + (item.valueMinor ?? 0), 0) : null
      return { ...contact, openOpportunityCount: opportunities.length, openOpportunityValueMinor: total, openOpportunityCurrency: currencies.size === 1 ? [...currencies][0]! : null, nextFollowUp: followUps.find((item) => item.contactId === contact.id) ?? null }
    })
  }

  createOpportunity(input: CreateOpportunityInput): Opportunity {
    if (!this.getContact(input.contactId)) throw new Error('Person not found')
    const title = cleanText(input.title, 'title', 200, true)!
    const stage = input.stage ?? 'new_lead'
    if (!CRM_STAGES.includes(stage)) throw new Error('Invalid stage')
    if (stage === 'won' || stage === 'lost') throw new Error('Create the opportunity in an active stage, then confirm closing it')
    const valueMinor = moneyMinor(input.valueMinor)
    const currency = currencyCode(input.currency, valueMinor)
    const expectedCloseAt = isoDate(input.expectedCloseAt, 'expectedCloseAt')
    const now = new Date().toISOString()
    const id = randomUUID()
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO crm_opportunities (id,tenant_id,contact_id,title,stage,value_minor,currency,expected_close_at,won_at,lost_at,loss_reason,source,attribution_state,attribution_evidence_cipher,attribution_activity_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,'unknown',NULL,NULL,?,?)`)
        .run(id, this.tenantId, input.contactId, title, stage, valueMinor, currency, expectedCloseAt, cleanText(input.source, 'source', 160), now, now)
      this.activity({ contactId: input.contactId, opportunityId: id, type: 'opportunity_created', actor: input.actor ?? 'customer', summary: `Added opportunity: ${title}`, sourceRunId: null, createdAt: now })
      this.db.prepare('UPDATE crm_contacts SET updated_at = ?, last_activity_at = ? WHERE tenant_id = ? AND id = ?').run(now, now, this.tenantId, input.contactId)
    })()
    return this.getOpportunity(id)!
  }

  getOpportunity(id: string): Opportunity | null {
    const row = this.db.prepare('SELECT * FROM crm_opportunities WHERE tenant_id = ? AND id = ?').get(this.tenantId, id) as OpportunityRow | undefined
    return row ? toOpportunity(row) : null
  }

  updateOpportunity(id: string, input: UpdateOpportunityInput): Opportunity {
    const existing = this.getOpportunity(id)
    if (!existing) throw new Error('Opportunity not found')
    const title = input.title === undefined ? existing.title : cleanText(input.title, 'title', 200, true)!
    const expectedCloseAt = input.expectedCloseAt === undefined ? existing.expectedCloseAt : isoDate(input.expectedCloseAt, 'expectedCloseAt')
    const source = input.source === undefined ? existing.source : cleanText(input.source, 'source', 160)
    const now = new Date().toISOString()
    this.db.transaction(() => {
      this.db.prepare('UPDATE crm_opportunities SET title=?,expected_close_at=?,source=?,updated_at=? WHERE tenant_id=? AND id=?').run(title, expectedCloseAt, source, now, this.tenantId, id)
      this.activity({ contactId: existing.contactId, opportunityId: id, type: 'opportunity_updated', actor: input.actor ?? 'customer', summary: `Updated opportunity: ${title}`, sourceRunId: null, createdAt: now })
    })()
    return this.getOpportunity(id)!
  }

  listOpportunities(stage?: CrmStage): OpportunityView[] {
    const rows = stage
      ? this.db.prepare('SELECT * FROM crm_opportunities WHERE tenant_id = ? AND stage = ? ORDER BY updated_at DESC').all(this.tenantId, stage) as OpportunityRow[]
      : this.db.prepare('SELECT * FROM crm_opportunities WHERE tenant_id = ? ORDER BY updated_at DESC').all(this.tenantId) as OpportunityRow[]
    const contacts = new Map((this.db.prepare('SELECT id,name,company FROM crm_contacts WHERE tenant_id=?').all(this.tenantId) as Array<{ id: string; name: string; company: string | null }>).map((row) => [row.id, row]))
    const followUps = this.listFollowUps()
    return rows.map(toOpportunity).flatMap((opportunity) => {
      const contact = contacts.get(opportunity.contactId)
      return contact ? [{ ...opportunity, contactName: contact.name, company: contact.company, nextFollowUp: followUps.find((item) => item.opportunityId === opportunity.id) ?? null }] : []
    })
  }

  moveOpportunity(id: string, stage: CrmStage, options: { confirmed?: boolean; lossReason?: string | null; actor?: CrmActor; now?: string } = {}): Opportunity {
    if (!CRM_STAGES.includes(stage)) throw new Error('Invalid stage')
    const existing = this.getOpportunity(id)
    if (!existing) throw new Error('Opportunity not found')
    if ((stage === 'won' || stage === 'lost') && options.confirmed !== true) throw new Error(`Moving an opportunity to ${stage === 'won' ? 'Won' : 'Lost'} requires explicit confirmation`)
    const now = options.now ?? new Date().toISOString()
    const lossReason = stage === 'lost' ? cleanText(options.lossReason, 'lossReason', 500) : null
    this.db.transaction(() => {
      this.db.prepare(`UPDATE crm_opportunities SET stage=?,won_at=?,lost_at=?,loss_reason=?,updated_at=? WHERE tenant_id=? AND id=?`)
        .run(stage, stage === 'won' ? now : null, stage === 'lost' ? now : null, lossReason, now, this.tenantId, id)
      this.activity({ contactId: existing.contactId, opportunityId: id, type: 'stage_changed', actor: options.actor ?? 'customer', summary: `Moved from ${existing.stage} to ${stage}`, sourceRunId: null, createdAt: now })
      this.db.prepare('UPDATE crm_contacts SET updated_at=?,last_activity_at=? WHERE tenant_id=? AND id=?').run(now, now, this.tenantId, existing.contactId)
    })()
    return this.getOpportunity(id)!
  }

  updateOpportunityValue(id: string, valueMinor: number | null, currency: string | null, confirmed: boolean, actor: CrmActor = 'customer'): Opportunity {
    if (!confirmed) throw new Error('Changing opportunity value requires explicit confirmation')
    const existing = this.getOpportunity(id)
    if (!existing) throw new Error('Opportunity not found')
    const amount = moneyMinor(valueMinor)
    const code = currencyCode(currency, amount)
    const now = new Date().toISOString()
    this.db.transaction(() => {
      this.db.prepare('UPDATE crm_opportunities SET value_minor=?,currency=?,updated_at=? WHERE tenant_id=? AND id=?').run(amount, code, now, this.tenantId, id)
      this.activity({ contactId: existing.contactId, opportunityId: id, type: 'value_changed', actor, summary: amount === null ? 'Removed opportunity value' : `Updated opportunity value to ${amount} ${code}`, sourceRunId: null, createdAt: now })
    })()
    return this.getOpportunity(id)!
  }

  createFollowUp(input: { contactId: string; opportunityId?: string | null; action: string; dueAt: string; actor?: CrmActor }): FollowUp {
    if (!this.getContact(input.contactId)) throw new Error('Person not found')
    if (input.opportunityId) {
      const opportunity = this.getOpportunity(input.opportunityId)
      if (!opportunity || opportunity.contactId !== input.contactId) throw new Error('Opportunity not found for this person')
    }
    const action = cleanText(input.action, 'action', 500, true)!
    const dueAt = isoDate(input.dueAt, 'dueAt', true)!
    const now = new Date().toISOString()
    const id = randomUUID()
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO crm_follow_ups (id,tenant_id,contact_id,opportunity_id,action,due_at,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,NULL,?,?)`).run(id, this.tenantId, input.contactId, input.opportunityId ?? null, action, dueAt, now, now)
      this.activity({ contactId: input.contactId, opportunityId: input.opportunityId ?? null, type: 'follow_up_created', actor: input.actor ?? 'customer', summary: `Follow up: ${action}`, sourceRunId: null, createdAt: now })
      this.db.prepare('UPDATE crm_contacts SET updated_at=?,last_activity_at=? WHERE tenant_id=? AND id=?').run(now, now, this.tenantId, input.contactId)
    })()
    return this.getFollowUp(id)!
  }

  getFollowUp(id: string): FollowUp | null {
    const row = this.db.prepare('SELECT * FROM crm_follow_ups WHERE tenant_id=? AND id=?').get(this.tenantId, id) as FollowUpRow | undefined
    return row ? toFollowUp(row) : null
  }

  listFollowUps(includeCompleted = false): FollowUp[] {
    const sql = includeCompleted ? 'SELECT * FROM crm_follow_ups WHERE tenant_id=? ORDER BY due_at' : 'SELECT * FROM crm_follow_ups WHERE tenant_id=? AND completed_at IS NULL ORDER BY due_at'
    return (this.db.prepare(sql).all(this.tenantId) as FollowUpRow[]).map(toFollowUp)
  }

  completeFollowUp(id: string, actor: CrmActor = 'customer', now = new Date().toISOString()): FollowUp {
    const existing = this.getFollowUp(id)
    if (!existing) throw new Error('Follow-up not found')
    if (existing.completedAt) return existing
    this.db.transaction(() => {
      this.db.prepare('UPDATE crm_follow_ups SET completed_at=?,updated_at=? WHERE tenant_id=? AND id=?').run(now, now, this.tenantId, id)
      this.activity({ contactId: existing.contactId, opportunityId: existing.opportunityId, type: 'follow_up_completed', actor, summary: `Completed follow-up: ${existing.action}`, sourceRunId: null, createdAt: now })
      this.db.prepare('UPDATE crm_contacts SET updated_at=?,last_activity_at=? WHERE tenant_id=? AND id=?').run(now, now, this.tenantId, existing.contactId)
    })()
    return this.getFollowUp(id)!
  }

  rescheduleFollowUp(id: string, dueAt: string, actor: CrmActor = 'customer'): FollowUp {
    const existing = this.getFollowUp(id)
    if (!existing) throw new Error('Follow-up not found')
    if (existing.completedAt) throw new Error('Completed follow-ups cannot be rescheduled')
    const nextDueAt = isoDate(dueAt, 'dueAt', true)!
    const now = new Date().toISOString()
    this.db.transaction(() => {
      this.db.prepare('UPDATE crm_follow_ups SET due_at=?,updated_at=? WHERE tenant_id=? AND id=?').run(nextDueAt, now, this.tenantId, id)
      this.activity({ contactId: existing.contactId, opportunityId: existing.opportunityId, type: 'follow_up_rescheduled', actor, summary: `Rescheduled follow-up: ${existing.action}`, sourceRunId: null, createdAt: now })
      this.db.prepare('UPDATE crm_contacts SET updated_at=?,last_activity_at=? WHERE tenant_id=? AND id=?').run(now, now, this.tenantId, existing.contactId)
    })()
    return this.getFollowUp(id)!
  }

  addNote(input: { contactId?: string | null; opportunityId?: string | null; summary: string; actor?: CrmActor; sourceRunId?: string | null }): CrmActivity {
    const contactId = input.contactId ?? (input.opportunityId ? this.getOpportunity(input.opportunityId)?.contactId : null) ?? null
    if (!contactId && !input.opportunityId) throw new Error('A person or opportunity is required for a note')
    if (contactId && !this.getContact(contactId)) throw new Error('Person not found')
    if (input.opportunityId && !this.getOpportunity(input.opportunityId)) throw new Error('Opportunity not found')
    return this.activity({ contactId, opportunityId: input.opportunityId ?? null, type: 'note', actor: input.actor ?? 'customer', summary: cleanText(input.summary, 'summary', 2000, true)!, sourceRunId: input.sourceRunId ?? null })
  }

  recordAttribution(input: { opportunityId: string; state: AttributionState; evidence?: string | null; actor?: CrmActor; sourceRunId?: string | null }): Opportunity {
    const opportunity = this.getOpportunity(input.opportunityId)
    if (!opportunity) throw new Error('Opportunity not found')
    if (!['verified', 'influenced', 'unknown'].includes(input.state)) throw new Error('Invalid attribution state')
    const evidence = cleanText(input.evidence, 'evidence', 1000)
    if (input.state !== 'unknown' && !evidence) throw new Error(`${input.state === 'verified' ? 'Verified attribution' : 'Influence'} requires evidence`)
    const now = new Date().toISOString()
    this.db.transaction(() => {
      const activity = this.activity({ contactId: opportunity.contactId, opportunityId: opportunity.id, type: 'attribution_recorded', actor: input.actor ?? 'customer', summary: input.state === 'unknown' ? 'Attribution marked unknown' : `${input.state === 'verified' ? 'Verified source' : 'Influence'}: ${evidence}`, sourceRunId: input.sourceRunId ?? null, createdAt: now })
      this.db.prepare('UPDATE crm_opportunities SET attribution_state=?,attribution_evidence_cipher=?,attribution_activity_id=?,updated_at=? WHERE tenant_id=? AND id=?').run(input.state, evidence ? encryptSecret(evidence) : null, activity.id, now, this.tenantId, opportunity.id)
    })()
    return this.getOpportunity(opportunity.id)!
  }

  listActivities(input: { contactId?: string; opportunityId?: string; limit?: number } = {}): CrmActivity[] {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
    if (input.opportunityId) return (this.db.prepare('SELECT * FROM crm_activities WHERE tenant_id=? AND opportunity_id=? ORDER BY created_at DESC LIMIT ?').all(this.tenantId, input.opportunityId, limit) as ActivityRow[]).map(toActivity)
    if (input.contactId) return (this.db.prepare('SELECT * FROM crm_activities WHERE tenant_id=? AND contact_id=? ORDER BY created_at DESC LIMIT ?').all(this.tenantId, input.contactId, limit) as ActivityRow[]).map(toActivity)
    return (this.db.prepare('SELECT * FROM crm_activities WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?').all(this.tenantId, limit) as ActivityRow[]).map(toActivity)
  }

  summary(now = new Date()): CrmSummary {
    const peopleCount = (this.db.prepare('SELECT COUNT(*) AS count FROM crm_contacts WHERE tenant_id=?').get(this.tenantId) as { count: number }).count
    const active = this.listOpportunities().filter((item) => ACTIVE_CRM_STAGES.includes(item.stage as typeof ACTIVE_CRM_STAGES[number]))
    const won = this.listOpportunities('won').filter((item) => item.wonAt && new Date(item.wonAt).getUTCFullYear() === now.getUTCFullYear() && new Date(item.wonAt).getUTCMonth() === now.getUTCMonth())
    const add = (target: Record<string, number>, opportunity: Opportunity) => { if (opportunity.valueMinor !== null && opportunity.currency) target[opportunity.currency] = (target[opportunity.currency] ?? 0) + opportunity.valueMinor }
    const activeValueByCurrency: Record<string, number> = {}
    const wonThisMonthByCurrency: Record<string, number> = {}
    const verifiedWonThisMonthByCurrency: Record<string, number> = {}
    const influencedWonThisMonthByCurrency: Record<string, number> = {}
    active.forEach((item) => add(activeValueByCurrency, item))
    won.forEach((item) => { add(wonThisMonthByCurrency, item); if (item.attributionState === 'verified') add(verifiedWonThisMonthByCurrency, item); if (item.attributionState === 'influenced') add(influencedWonThisMonthByCurrency, item) })
    const due = this.listFollowUps().filter((item) => Date.parse(item.dueAt) <= now.getTime()).length
    const latest = this.db.prepare(`SELECT MAX(at) AS latest FROM (SELECT MAX(updated_at) AS at FROM crm_contacts WHERE tenant_id=? UNION ALL SELECT MAX(updated_at) FROM crm_opportunities WHERE tenant_id=? UNION ALL SELECT MAX(updated_at) FROM crm_follow_ups WHERE tenant_id=?)`).get(this.tenantId, this.tenantId, this.tenantId) as { latest: string | null }
    return { peopleCount, activeOpportunityCount: active.length, activeValueByCurrency, followUpsDue: due, wonThisMonthByCurrency, verifiedWonThisMonthByCurrency, influencedWonThisMonthByCurrency, lastUpdatedAt: latest.latest }
  }
}

export function createCrmStore(tenantId: string, explicitPath?: string): CrmStore {
  assertTenantId(tenantId)
  const file = explicitPath ?? dbPathFor(tenantId)
  mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  initialize(db)
  return new CrmStore(tenantId, db)
}

const stores = new Map<string, CrmStore>()
export function getCrmStore(tenantId: string): CrmStore {
  const existing = stores.get(tenantId)
  if (existing) return existing
  const store = createCrmStore(tenantId)
  stores.set(tenantId, store)
  return store
}

export function closeCrmStores(): void {
  for (const store of stores.values()) store.close()
  stores.clear()
}
