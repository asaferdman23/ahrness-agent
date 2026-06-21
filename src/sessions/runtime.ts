/**
 * Process-wide singletons for the memory layer: one SQLite-backed store and one
 * run queue, shared by the inbound message handler and the scheduler runner so a
 * scheduled job and a live message hit the same session.
 */
import { openDb } from './db.js'
import { createSessionStore, type SessionStore } from './store.js'
import { createRunQueue, type RunQueue } from './run-queue.js'

export const SESSION_CHANNEL = 'whatsapp'

const DB_PATH = process.env.AGENT_STATE_DB ?? './store/agent.sqlite'

let _store: SessionStore | null = null
let _queue: RunQueue | null = null

export function sessionStore(): SessionStore {
  return (_store ??= createSessionStore(openDb(DB_PATH)))
}

export function runQueue(): RunQueue {
  return (_queue ??= createRunQueue())
}

/** Stable session key for a client on WhatsApp. */
export function sessionKeyFor(clientId: string): string {
  return `${SESSION_CHANNEL}:${clientId}`
}
