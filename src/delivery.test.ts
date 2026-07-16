import { after, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const root = mkdtempSync(join(tmpdir(), 'ahrness-delivery-'))
process.env.AGENT_STORE_DIR = root
process.env.AGENT_STATE_DB = join(root, 'agent.sqlite')
process.env.AGENT_LIVE_DB = join(root, 'agent-live.sqlite')

after(() => {
  delete process.env.AGENT_STORE_DIR
  delete process.env.AGENT_STATE_DB
  delete process.env.AGENT_LIVE_DB
  rmSync(root, { force: true, recursive: true })
})

interface FakeInvokeResult {
  lastMessage: { content: Array<{ type: string; text?: string }> }
  metrics?: { accumulatedUsage: { inputTokens: number; outputTokens: number } }
}

let agentBehavior: 'succeed' | 'throw' = 'succeed'

const fakeSession = {
  agent: {
    messages: [],
    invoke: async (): Promise<FakeInvokeResult> => {
      if (agentBehavior === 'throw') throw new Error('boom mid-invocation')
      return {
        lastMessage: { content: [{ type: 'textBlock', text: 'ok' }] },
        metrics: { accumulatedUsage: { inputTokens: 10, outputTokens: 5 } },
      }
    },
  },
  model: 'claude-opus-4-8',
  seededMessageCount: 0,
  publishedOutputs: [] as any[],
  readOutput: async () => new Uint8Array(),
  writeInput: async () => {},
}

mock.module('./agent.js', {
  namedExports: {
    AGENT_MODEL: 'claude-opus-4-8',
    buildClientAgent: async () => fakeSession,
    createSummarizer: () => async () => 'summary',
  },
})

const { runAndDeliver } = await import('./delivery.js')
const { openDb, createSqliteStore } = await import('@agent-live/sdk')
const observabilityStore = () => createSqliteStore(openDb(process.env.AGENT_LIVE_DB!))

function fakeTransport() {
  const sent: { text: string }[] = []
  return {
    transport: {
      sendText: async (_jid: string, text: string) => {
        sent.push({ text })
      },
      sendImage: async () => {},
      sendVideo: async () => {},
      sendAudio: async () => {},
      sendDocument: async () => {},
    },
    sent,
  }
}

let counter = 0
function freshJid(): string {
  counter += 1
  return `1555000${counter}@s.whatsapp.net`
}

/** Unlinked WhatsApp JIDs resolve to sha256(jid) — see tenant-store.ts. */
function tenantIdFor(jid: string): string {
  return createHash('sha256').update(jid).digest('hex')
}

test('a successful run records exactly one run.completed event and delivers the reply', async () => {
  agentBehavior = 'succeed'
  const { transport, sent } = fakeTransport()
  const jid = freshJid()

  await runAndDeliver(transport as any, jid, 'hello')

  assert.equal(sent.length, 1)
  assert.equal(sent[0].text, 'ok')

  const store = observabilityStore()
  const runs = store.listRuns(tenantIdFor(jid), { limit: 10 })
  assert.equal(runs.length, 1)
  assert.equal(runs[0].status, 'completed')
  assert.equal(runs[0].inputTokens, 10)
  assert.equal(runs[0].outputTokens, 5)

  const events = store.listEvents(runs[0].id)
  const completedEvents = events.filter((e) => e.type === 'run.completed')
  assert.equal(completedEvents.length, 1)
  const failedEvents = events.filter((e) => e.type === 'run.failed')
  assert.equal(failedEvents.length, 0)
})

test('a thrown error mid-invocation still records exactly one run.failed via the finally path, and rethrows', async () => {
  agentBehavior = 'throw'
  const { transport, sent } = fakeTransport()
  const jid = freshJid()

  await assert.rejects(() => runAndDeliver(transport as any, jid, 'hello'), /boom mid-invocation/)
  assert.equal(sent.length, 0)

  const store = observabilityStore()
  const runs = store.listRuns(tenantIdFor(jid), { limit: 10 })
  assert.equal(runs.length, 1)
  assert.equal(runs[0].status, 'failed')

  const events = store.listEvents(runs[0].id)
  assert.equal(events.filter((e) => e.type === 'run.failed').length, 1)
  assert.equal(events.filter((e) => e.type === 'run.completed').length, 0)

  agentBehavior = 'succeed'
})

test('a throwing observability store never blocks message delivery', async () => {
  agentBehavior = 'succeed'
  const { transport, sent } = fakeTransport()
  const jid = freshJid()

  const store = observabilityStore()
  const originalAppendEvent = store.appendEvent
  store.appendEvent = () => {
    throw new Error('observability store write failed')
  }

  try {
    await runAndDeliver(transport as any, jid, 'hello')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].text, 'ok')
  } finally {
    store.appendEvent = originalAppendEvent
  }
})
