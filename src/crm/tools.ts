import { tool } from '@strands-agents/sdk'
import { fileConfirmationStore, stageOrExecute } from '../confirmations.js'
import { getCrmStore } from './store.js'
import { isCrmStage, stageLabel, type AttributionState, type ConsentState, type CrmStage, type Relationship } from './types.js'

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid tool input')
  return input as Record<string, unknown>
}

function text(input: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = typeof input[key] === 'string' ? input[key].trim() : ''
  if (required && !value) throw new Error(`${key} is required`)
  return value || undefined
}

function nullableText(input: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in input)) return undefined
  if (input[key] === null || input[key] === '') return null
  return text(input, key)
}

function json(value: unknown): string { return JSON.stringify(value) }

export function createCrmTools(clientId: string): ReturnType<typeof tool>[] {
  const store = () => getCrmStore(clientId)

  return [
    tool({
      name: 'crm_search_people',
      description: 'Find people in the client CRM by name, company, exact email, or exact phone. Use an empty search to list recent people.',
      inputSchema: { type: 'object', properties: { search: { type: 'string' } }, required: [], additionalProperties: false },
      callback: async (raw) => json({ people: store().listContacts(text(record(raw), 'search') ?? '').slice(0, 50) }),
    }),
    tool({
      name: 'crm_list_opportunities',
      description: 'List real sales opportunities. Optionally filter by one fixed pipeline stage.',
      inputSchema: { type: 'object', properties: { stage: { type: 'string', enum: ['new_lead', 'contacted', 'replied', 'qualified', 'proposal_sent', 'won', 'lost'] } }, required: [], additionalProperties: false },
      callback: async (raw) => {
        const value = text(record(raw), 'stage')
        if (value && !isCrmStage(value)) throw new Error('Invalid stage')
        return json({ opportunities: store().listOpportunities(value as CrmStage | undefined).slice(0, 100) })
      },
    }),
    tool({
      name: 'crm_pipeline_summary',
      description: 'Return evidence-based CRM totals: people, active opportunities, due follow-ups, won value, verified-source won value, and influenced won value.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      callback: async () => json(store().summary()),
    }),
    tool({
      name: 'crm_list_follow_ups',
      description: 'List the client’s pending CRM follow-ups in due-date order.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      callback: async () => json({ followUps: store().listFollowUps().slice(0, 100) }),
    }),
    tool({
      name: 'crm_add_person',
      description: 'Add a real person to the client CRM. Never invent contact details or consent.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, company: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, relationship: { type: 'string', enum: ['lead', 'customer'] }, consent: { type: 'string', enum: ['unknown', 'granted', 'denied'] }, source: { type: 'string' } }, required: ['name'], additionalProperties: false },
      callback: async (raw) => {
        const input = record(raw)
        return json(store().createContact({ name: text(input, 'name', true)!, company: nullableText(input, 'company'), email: nullableText(input, 'email'), phone: nullableText(input, 'phone'), relationship: text(input, 'relationship') as Relationship | undefined, consent: text(input, 'consent') as ConsentState | undefined, source: nullableText(input, 'source'), actor: 'bizzclaw' }))
      },
    }),
    tool({
      name: 'crm_update_person',
      description: 'Edit a CRM person by id. Only fields explicitly provided are changed.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, company: { type: ['string', 'null'] }, email: { type: ['string', 'null'] }, phone: { type: ['string', 'null'] }, relationship: { type: 'string', enum: ['lead', 'customer'] }, consent: { type: 'string', enum: ['unknown', 'granted', 'denied'] }, source: { type: ['string', 'null'] } }, required: ['id'], additionalProperties: false },
      callback: async (raw) => {
        const input = record(raw)
        return json(store().updateContact(text(input, 'id', true)!, { name: text(input, 'name'), company: nullableText(input, 'company'), email: nullableText(input, 'email'), phone: nullableText(input, 'phone'), relationship: text(input, 'relationship') as Relationship | undefined, consent: text(input, 'consent') as ConsentState | undefined, source: nullableText(input, 'source'), actor: 'bizzclaw' }))
      },
    }),
    tool({
      name: 'crm_add_opportunity',
      description: 'Add an active sales opportunity for an existing CRM person. Won and Lost cannot be used at creation.',
      inputSchema: { type: 'object', properties: { contactId: { type: 'string' }, title: { type: 'string' }, stage: { type: 'string', enum: ['new_lead', 'contacted', 'replied', 'qualified', 'proposal_sent'] }, valueMinor: { type: 'integer', minimum: 0 }, currency: { type: 'string' }, expectedCloseAt: { type: 'string' }, source: { type: 'string' } }, required: ['contactId', 'title'], additionalProperties: false },
      callback: async (raw) => {
        const input = record(raw)
        const valueMinor = typeof input.valueMinor === 'number' ? input.valueMinor : undefined
        const execute = async () => json(store().createOpportunity({ contactId: text(input, 'contactId', true)!, title: text(input, 'title', true)!, stage: text(input, 'stage') as CrmStage | undefined, valueMinor, currency: nullableText(input, 'currency'), expectedCloseAt: nullableText(input, 'expectedCloseAt'), source: nullableText(input, 'source'), actor: 'bizzclaw' }))
        if (valueMinor === undefined) return execute()
        return stageOrExecute({ store: fileConfirmationStore(), clientId, toolName: 'crm_add_opportunity', input: raw, summarize: () => `add this opportunity with a value of ${valueMinor} minor units in ${nullableText(input, 'currency') ?? 'the selected currency'}` }, execute)
      },
    }),
    tool({
      name: 'crm_move_opportunity',
      description: 'Move an opportunity to a fixed pipeline stage. Moving to Won or Lost always asks the client for explicit confirmation first.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, stage: { type: 'string', enum: ['new_lead', 'contacted', 'replied', 'qualified', 'proposal_sent', 'won', 'lost'] }, lossReason: { type: 'string' } }, required: ['id', 'stage'], additionalProperties: false },
      callback: async (raw) => {
        const input = record(raw)
        const id = text(input, 'id', true)!
        const stage = text(input, 'stage', true)!
        if (!isCrmStage(stage)) throw new Error('Invalid stage')
        const execute = async () => json(store().moveOpportunity(id, stage, { confirmed: stage === 'won' || stage === 'lost', lossReason: nullableText(input, 'lossReason'), actor: 'bizzclaw' }))
        if (stage !== 'won' && stage !== 'lost') return execute()
        return stageOrExecute({ store: fileConfirmationStore(), clientId, toolName: 'crm_move_opportunity', input: raw, summarize: () => `mark this opportunity as ${stageLabel(stage)}` }, execute)
      },
    }),
    tool({
      name: 'crm_set_opportunity_value',
      description: 'Set or clear an opportunity value. This always asks the client for explicit confirmation before changing money.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, valueMinor: { type: ['integer', 'null'], minimum: 0 }, currency: { type: ['string', 'null'] } }, required: ['id', 'valueMinor'], additionalProperties: false },
      callback: async (raw) => {
        const input = record(raw)
        const id = text(input, 'id', true)!
        const valueMinor = input.valueMinor === null ? null : Number(input.valueMinor)
        const currency = nullableText(input, 'currency') ?? null
        return stageOrExecute({ store: fileConfirmationStore(), clientId, toolName: 'crm_set_opportunity_value', input: raw, summarize: () => valueMinor === null ? 'remove the opportunity value' : `set the opportunity value to ${valueMinor} minor units in ${currency ?? 'the selected currency'}` }, async () => json(store().updateOpportunityValue(id, valueMinor, currency, true, 'bizzclaw')))
      },
    }),
    tool({
      name: 'crm_add_follow_up',
      description: 'Add a next action for a CRM person, optionally linked to an opportunity.',
      inputSchema: { type: 'object', properties: { contactId: { type: 'string' }, opportunityId: { type: 'string' }, action: { type: 'string' }, dueAt: { type: 'string' } }, required: ['contactId', 'action', 'dueAt'], additionalProperties: false },
      callback: async (raw) => { const input = record(raw); return json(store().createFollowUp({ contactId: text(input, 'contactId', true)!, opportunityId: nullableText(input, 'opportunityId'), action: text(input, 'action', true)!, dueAt: text(input, 'dueAt', true)!, actor: 'bizzclaw' })) },
    }),
    tool({
      name: 'crm_complete_follow_up',
      description: 'Mark a CRM follow-up complete. The record and its history are retained.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      callback: async (raw) => json(store().completeFollowUp(text(record(raw), 'id', true)!, 'bizzclaw')),
    }),
    tool({
      name: 'crm_add_note',
      description: 'Add an immutable CRM note to a person or opportunity.',
      inputSchema: { type: 'object', properties: { contactId: { type: 'string' }, opportunityId: { type: 'string' }, summary: { type: 'string' } }, required: ['summary'], additionalProperties: false },
      callback: async (raw) => { const input = record(raw); return json(store().addNote({ contactId: nullableText(input, 'contactId'), opportunityId: nullableText(input, 'opportunityId'), summary: text(input, 'summary', true)!, actor: 'bizzclaw' })) },
    }),
    tool({
      name: 'crm_record_attribution',
      description: 'Record whether a won opportunity has a verified source, was influenced by BizzClaw, or has an unknown source. Verified requires concrete evidence; never claim causation.',
      inputSchema: { type: 'object', properties: { opportunityId: { type: 'string' }, state: { type: 'string', enum: ['verified', 'influenced', 'unknown'] }, evidence: { type: 'string' } }, required: ['opportunityId', 'state'], additionalProperties: false },
      callback: async (raw) => { const input = record(raw); return json(store().recordAttribution({ opportunityId: text(input, 'opportunityId', true)!, state: text(input, 'state', true)! as AttributionState, evidence: nullableText(input, 'evidence'), actor: 'bizzclaw' })) },
    }),
  ]
}
