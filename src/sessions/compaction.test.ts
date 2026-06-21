import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from './db.js'
import { createSessionStore } from './store.js'
import { compactIfNeeded, PostCompactionGuardError } from './compaction.js'
import type { SummarizeInput } from './compaction.js'

const KEY = 'whatsapp:c'
const MODEL = 'claude-opus-4-8'
const big = 'x'.repeat(400) // ~100 token message

function seed(messageCount: number) {
  const store = createSessionStore(openDb(':memory:'))
  store.ensureSession(KEY, { clientId: 'c', channel: 'whatsapp', model: MODEL })
  for (let i = 0; i < messageCount; i++) store.appendTurn(KEY, [{ role: 'user', content: `${big}-${i}` }])
  return store
}

test('does not compact when under the threshold and never calls summarize', async () => {
  const store = seed(2)
  let called = false
  const res = await compactIfNeeded({
    store,
    key: KEY,
    model: MODEL,
    summarize: async () => {
      called = true
      return 's'
    },
    // default fraction 0.7 of 200k = 140k; two ~100-token msgs are nowhere near
  })
  assert.equal(res.compacted, false)
  assert.equal(called, false)
})

test('compacts foldable messages, advances the pointer, and shrinks working context', async () => {
  const store = seed(3)
  let received: SummarizeInput | null = null
  const res = await compactIfNeeded({
    store,
    key: KEY,
    model: MODEL,
    fraction: 0.00001, // force trigger
    keepRecentTurns: 1,
    summarize: async (input) => {
      received = input
      return 'SUMMARY'
    },
  })

  assert.equal(res.compacted, true)
  assert.deepEqual(received!.messages.map((m) => m.seq), [1, 2]) // folded all but last
  assert.equal(received!.previousSummary, null)

  const ctx = store.getWorkingContext(KEY)
  assert.equal(ctx.summary, 'SUMMARY')
  assert.deepEqual(ctx.messages.map((m) => m.seq), [3]) // only the kept tail remains in view
  assert.equal(store.countMessages(KEY), 3) // append-only log intact
})

test('passes the previous summary into the summarizer', async () => {
  const store = seed(2)
  store.saveCompaction(KEY, { summary: 'PRIOR', throughSeq: 1 })
  store.appendTurn(KEY, [{ role: 'user', content: big }]) // seq 3

  let received: SummarizeInput | null = null
  await compactIfNeeded({
    store,
    key: KEY,
    model: MODEL,
    fraction: 0.00001,
    keepRecentTurns: 1,
    summarize: async (input) => {
      received = input
      return 'NEW'
    },
  })
  assert.equal(received!.previousSummary, 'PRIOR')
})

test('throws PostCompactionGuardError when over threshold but nothing is foldable', async () => {
  const store = seed(1) // one message, keepRecentTurns 1 → nothing to fold
  await assert.rejects(
    compactIfNeeded({
      store,
      key: KEY,
      model: MODEL,
      fraction: 0.00001,
      keepRecentTurns: 1,
      summarize: async () => 'unused',
    }),
    PostCompactionGuardError,
  )
})
