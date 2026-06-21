import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from './db.js'
import { createSessionStore } from './store.js'

function freshStore() {
  return createSessionStore(openDb(':memory:'))
}

const KEY = 'whatsapp:client-abc'

test('ensureSession creates a row and is idempotent', () => {
  const store = freshStore()
  const a = store.ensureSession(KEY, { clientId: 'abc', channel: 'whatsapp', model: 'claude-opus-4-8' })
  assert.equal(a.sessionKey, KEY)
  assert.equal(a.summaryThroughSeq, 0)
  assert.equal(a.summary, null)

  const b = store.ensureSession(KEY, { clientId: 'abc', channel: 'whatsapp', model: 'claude-opus-4-8' })
  assert.equal(b.createdAt, a.createdAt) // not recreated
})

test('appendTurn assigns monotonic seq and loadMessages reads them back in order', () => {
  const store = freshStore()
  store.ensureSession(KEY, { clientId: 'abc', channel: 'whatsapp', model: null })
  store.appendTurn(KEY, [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: [{ type: 'textBlock', text: 'hi there' }] },
  ])
  store.appendTurn(KEY, [{ role: 'user', content: 'again' }])

  const msgs = store.loadMessages(KEY)
  assert.deepEqual(msgs.map((m) => m.seq), [1, 2, 3])
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user'])
  assert.deepEqual(msgs[1].content, [{ type: 'textBlock', text: 'hi there' }]) // JSON round-trips
})

test('appendTurn computes a token estimate per message', () => {
  const store = freshStore()
  store.ensureSession(KEY, { clientId: 'abc', channel: 'whatsapp', model: null })
  store.appendTurn(KEY, [{ role: 'user', content: 'abcd' }]) // "abcd" → JSON '"abcd"' = 6 chars → 2 tokens
  const [m] = store.loadMessages(KEY)
  assert.ok(m.tokenEstimate >= 1)
})

test('getWorkingContext returns only messages after the summary pointer plus the summary', () => {
  const store = freshStore()
  store.ensureSession(KEY, { clientId: 'abc', channel: 'whatsapp', model: 'claude-opus-4-8' })
  store.appendTurn(KEY, [{ role: 'user', content: 'one' }]) // seq 1
  store.appendTurn(KEY, [{ role: 'user', content: 'two' }]) // seq 2
  store.appendTurn(KEY, [{ role: 'user', content: 'three' }]) // seq 3

  store.saveCompaction(KEY, { summary: 'covered 1-2', throughSeq: 2 })

  const ctx = store.getWorkingContext(KEY)
  assert.equal(ctx.summary, 'covered 1-2')
  assert.deepEqual(ctx.messages.map((m) => m.seq), [3])
  assert.ok(ctx.estimatedTokens > 0)
})

test('saveCompaction advances the pointer, sets the summary, and writes a checkpoint', () => {
  const store = freshStore()
  store.ensureSession(KEY, { clientId: 'abc', channel: 'whatsapp', model: null })
  store.appendTurn(KEY, [{ role: 'user', content: 'one' }])
  store.appendTurn(KEY, [{ role: 'user', content: 'two' }])

  store.saveCompaction(KEY, { summary: 'sum', throughSeq: 2 })
  const s = store.loadSession(KEY)!
  assert.equal(s.summary, 'sum')
  assert.equal(s.summaryThroughSeq, 2)
  assert.equal(store.countCheckpoints(KEY), 1)
})

test('appendTurn never deletes prior messages (source of truth is append-only)', () => {
  const store = freshStore()
  store.ensureSession(KEY, { clientId: 'abc', channel: 'whatsapp', model: null })
  store.appendTurn(KEY, [{ role: 'user', content: 'one' }])
  store.saveCompaction(KEY, { summary: 'sum', throughSeq: 1 })
  store.appendTurn(KEY, [{ role: 'user', content: 'two' }])

  // Even after compaction, the full log is intact.
  assert.equal(store.countMessages(KEY), 2)
})

test('loadSession returns null for an unknown key', () => {
  const store = freshStore()
  assert.equal(store.loadSession('whatsapp:nobody'), null)
})
