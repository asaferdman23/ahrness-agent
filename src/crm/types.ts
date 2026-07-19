export const CRM_STAGES = ['new_lead', 'contacted', 'replied', 'qualified', 'proposal_sent', 'won', 'lost'] as const
export type CrmStage = typeof CRM_STAGES[number]

export const ACTIVE_CRM_STAGES = CRM_STAGES.filter((stage): stage is Exclude<CrmStage, 'won' | 'lost'> => stage !== 'won' && stage !== 'lost')

export type Relationship = 'lead' | 'customer'
export type ConsentState = 'unknown' | 'granted' | 'denied'
export type AttributionState = 'verified' | 'influenced' | 'unknown'
export type CrmActor = 'customer' | 'bizzclaw' | 'import' | 'system'

export interface Contact {
  id: string
  tenantId: string
  name: string
  company: string | null
  email: string | null
  phone: string | null
  relationship: Relationship
  consent: ConsentState
  source: string | null
  createdAt: string
  updatedAt: string
  lastActivityAt: string
}

export interface Opportunity {
  id: string
  tenantId: string
  contactId: string
  title: string
  stage: CrmStage
  valueMinor: number | null
  currency: string | null
  expectedCloseAt: string | null
  wonAt: string | null
  lostAt: string | null
  lossReason: string | null
  source: string | null
  attributionState: AttributionState
  attributionEvidence: string | null
  attributionActivityId: string | null
  createdAt: string
  updatedAt: string
}

export interface FollowUp {
  id: string
  tenantId: string
  contactId: string
  opportunityId: string | null
  action: string
  dueAt: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CrmActivity {
  id: string
  tenantId: string
  contactId: string | null
  opportunityId: string | null
  type: 'contact_created' | 'contact_updated' | 'opportunity_created' | 'opportunity_updated' | 'stage_changed' | 'note' | 'follow_up_created' | 'follow_up_rescheduled' | 'follow_up_completed' | 'attribution_recorded' | 'value_changed'
  actor: CrmActor
  summary: string
  sourceRunId: string | null
  createdAt: string
}

export interface OpportunityView extends Opportunity {
  contactName: string
  company: string | null
  nextFollowUp: FollowUp | null
}

export interface ContactView extends Contact {
  openOpportunityCount: number
  openOpportunityValueMinor: number | null
  openOpportunityCurrency: string | null
  nextFollowUp: FollowUp | null
}

export interface CrmSummary {
  peopleCount: number
  activeOpportunityCount: number
  activeValueByCurrency: Record<string, number>
  followUpsDue: number
  wonThisMonthByCurrency: Record<string, number>
  verifiedWonThisMonthByCurrency: Record<string, number>
  influencedWonThisMonthByCurrency: Record<string, number>
  lastUpdatedAt: string | null
}

export function isCrmStage(value: unknown): value is CrmStage {
  return typeof value === 'string' && CRM_STAGES.includes(value as CrmStage)
}

export function stageLabel(stage: CrmStage): string {
  return ({
    new_lead: 'New lead',
    contacted: 'Contacted',
    replied: 'Replied',
    qualified: 'Qualified',
    proposal_sent: 'Proposal sent',
    won: 'Won',
    lost: 'Lost',
  } as const)[stage]
}

export function attributionLabel(state: AttributionState): string {
  return ({ verified: 'Verified source', influenced: 'Influenced by BizzClaw', unknown: 'Source unknown' } as const)[state]
}
