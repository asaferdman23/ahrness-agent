/**
 * SQLite connection + schema for the agent memory layer.
 *
 * `better-sqlite3` is synchronous and single-writer safe; combined with the
 * per-session run queue, transcript writes never interleave. The `messages`
 * table is append-only — it is the source of truth and is never mutated.
 */
import Database from 'better-sqlite3'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'

export type Db = Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_key          TEXT PRIMARY KEY,
  client_id            TEXT NOT NULL,
  channel              TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  model                TEXT,
  summary              TEXT,
  summary_through_seq  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key     TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  token_estimate  INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE(session_key, seq)
);

CREATE TABLE IF NOT EXISTS compaction_checkpoints (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key  TEXT NOT NULL,
  at_seq       INTEGER NOT NULL,
  summary      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_key, seq);
`

/** Open (or create) the agent state DB at `path` and ensure the schema exists. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  if (path !== ':memory:') {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
  }
  db.exec(SCHEMA)
  return db
}
