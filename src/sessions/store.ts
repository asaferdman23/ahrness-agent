/**
 * Session transcript store — the source of truth for agent memory.
 *
 * Responsibilities: persist the append-only message log, read back working
 * context (rolling summary + verbatim tail), and record compaction. It performs
 * no LLM calls and no token-budget decisions beyond per-message estimation —
 * those live in `compaction.ts` / `tokens.ts`.
 */
import type { Db } from './db.js'
import { estimateTokens } from './tokens.js'
import type { SessionRecord, StoredMessage, TurnMessage, WorkingContext } from './types.js'

export interface EnsureSessionInput {
  clientId: string
  channel: string
  model: string | null
}

export interface SaveCompactionInput {
  summary: string
  throughSeq: number
}

interface SessionRow {
  session_key: string
  client_id: string
  channel: string
  created_at: string
  updated_at: string
  model: string | null
  summary: string | null
  summary_through_seq: number
}

interface MessageRow {
  seq: number
  role: string
  content: string
  token_estimate: number
  created_at: string
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    sessionKey: row.session_key,
    clientId: row.client_id,
    channel: row.channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    model: row.model,
    summary: row.summary,
    summaryThroughSeq: row.summary_through_seq,
  }
}

function toStoredMessage(row: MessageRow): StoredMessage {
  return {
    seq: row.seq,
    role: row.role as StoredMessage['role'],
    content: JSON.parse(row.content),
    tokenEstimate: row.token_estimate,
    createdAt: row.created_at,
  }
}

export interface SessionStore {
  ensureSession(key: string, input: EnsureSessionInput): SessionRecord
  loadSession(key: string): SessionRecord | null
  appendTurn(key: string, messages: TurnMessage[]): void
  loadMessages(key: string): StoredMessage[]
  getWorkingContext(key: string): WorkingContext
  saveCompaction(key: string, input: SaveCompactionInput): void
  countMessages(key: string): number
  countCheckpoints(key: string): number
}

export function createSessionStore(db: Db): SessionStore {
  const now = () => new Date().toISOString()

  const stmts = {
    getSession: db.prepare('SELECT * FROM sessions WHERE session_key = ?'),
    insertSession: db.prepare(
      `INSERT INTO sessions (session_key, client_id, channel, created_at, updated_at, model, summary, summary_through_seq)
       VALUES (@session_key, @client_id, @channel, @created_at, @updated_at, @model, NULL, 0)`,
    ),
    touchSession: db.prepare('UPDATE sessions SET updated_at = ? WHERE session_key = ?'),
    maxSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM messages WHERE session_key = ?'),
    insertMessage: db.prepare(
      `INSERT INTO messages (session_key, seq, role, content, token_estimate, created_at)
       VALUES (@session_key, @seq, @role, @content, @token_estimate, @created_at)`,
    ),
    allMessages: db.prepare('SELECT seq, role, content, token_estimate, created_at FROM messages WHERE session_key = ? ORDER BY seq'),
    messagesAfter: db.prepare(
      'SELECT seq, role, content, token_estimate, created_at FROM messages WHERE session_key = ? AND seq > ? ORDER BY seq',
    ),
    countMessages: db.prepare('SELECT COUNT(*) AS c FROM messages WHERE session_key = ?'),
    countCheckpoints: db.prepare('SELECT COUNT(*) AS c FROM compaction_checkpoints WHERE session_key = ?'),
    applyCompaction: db.prepare('UPDATE sessions SET summary = ?, summary_through_seq = ?, updated_at = ? WHERE session_key = ?'),
    insertCheckpoint: db.prepare(
      `INSERT INTO compaction_checkpoints (session_key, at_seq, summary, created_at) VALUES (?, ?, ?, ?)`,
    ),
  }

  function loadSession(key: string): SessionRecord | null {
    const row = stmts.getSession.get(key) as SessionRow | undefined
    return row ? toSessionRecord(row) : null
  }

  function ensureSession(key: string, input: EnsureSessionInput): SessionRecord {
    const existing = loadSession(key)
    if (existing) return existing
    const ts = now()
    stmts.insertSession.run({
      session_key: key,
      client_id: input.clientId,
      channel: input.channel,
      created_at: ts,
      updated_at: ts,
      model: input.model,
    })
    return loadSession(key)!
  }

  const appendTurn = db.transaction((key: string, messages: TurnMessage[]) => {
    let seq = (stmts.maxSeq.get(key) as { m: number }).m
    const ts = now()
    for (const m of messages) {
      seq += 1
      const content = JSON.stringify(m.content)
      stmts.insertMessage.run({
        session_key: key,
        seq,
        role: m.role,
        content,
        token_estimate: estimateTokens(content),
        created_at: ts,
      })
    }
    stmts.touchSession.run(ts, key)
  })

  function loadMessages(key: string): StoredMessage[] {
    return (stmts.allMessages.all(key) as MessageRow[]).map(toStoredMessage)
  }

  function getWorkingContext(key: string): WorkingContext {
    const session = loadSession(key)
    const through = session?.summaryThroughSeq ?? 0
    const summary = session?.summary ?? null
    const messages = (stmts.messagesAfter.all(key, through) as MessageRow[]).map(toStoredMessage)
    const estimatedTokens =
      (summary ? estimateTokens(summary) : 0) + messages.reduce((sum, m) => sum + m.tokenEstimate, 0)
    return { summary, messages, estimatedTokens }
  }

  const saveCompaction = db.transaction((key: string, input: SaveCompactionInput) => {
    const ts = now()
    stmts.applyCompaction.run(input.summary, input.throughSeq, ts, key)
    stmts.insertCheckpoint.run(key, input.throughSeq, input.summary, ts)
  })

  return {
    ensureSession,
    loadSession,
    appendTurn,
    loadMessages,
    getWorkingContext,
    saveCompaction,
    countMessages: (key) => (stmts.countMessages.get(key) as { c: number }).c,
    countCheckpoints: (key) => (stmts.countCheckpoints.get(key) as { c: number }).c,
  }
}
