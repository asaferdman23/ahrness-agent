/** Message roles stored in a session transcript. */
export type Role = 'user' | 'assistant' | 'tool'

/** A message to append to a session, before it is assigned a sequence number. */
export interface TurnMessage {
  role: Role
  /** Provider block array or plain string — persisted as JSON. */
  content: unknown
}

/** A message as stored in (and read back from) the transcript. */
export interface StoredMessage extends TurnMessage {
  seq: number
  tokenEstimate: number
  createdAt: string
}

/** Row of the `sessions` table. */
export interface SessionRecord {
  sessionKey: string
  clientId: string
  channel: string
  createdAt: string
  updatedAt: string
  model: string | null
  summary: string | null
  summaryThroughSeq: number
}

/** The compressed view sent to the model: rolling summary + verbatim tail. */
export interface WorkingContext {
  summary: string | null
  messages: StoredMessage[]
  estimatedTokens: number
}
