/**
 * Memory end-to-end harness.
 *
 * Proves the memory loop with real components — SQLite store, the live Anthropic
 * model, and the real seed/extract bridge — without Docker, MCP, or WhatsApp
 * (those are orthogonal to memory). It mirrors the memory path in delivery.ts:
 *
 *   getWorkingContext → toSeedMessages → new Agent({ messages }) → invoke
 *     → extractTurnMessages → appendTurn
 *
 * Each turn builds a FRESH agent, so the only way turn 2 can answer is if the
 * persisted transcript was loaded and seeded back in. Run:
 *
 *   npm run test:memory
 *
 * Requires ANTHROPIC_API_KEY (makes real API calls — a few cents).
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { Agent } from '@strands-agents/sdk'
import { createModel } from '../agent.js'
import { openDb } from './db.js'
import { createSessionStore } from './store.js'
import { toSeedMessages, extractTurnMessages } from './agent-bridge.js'
import { compactIfNeeded } from './compaction.js'

const KEY = 'whatsapp:memory-e2e'
const SYSTEM = 'You are a concise assistant. Answer in one short sentence.'

function replyText(result: any): string {
  return result.lastMessage.content
    .filter((b: any) => b.type === 'textBlock')
    .map((b: any) => b.text as string)
    .join('')
    .trim()
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('✗ ANTHROPIC_API_KEY is not set — copy a key into .env first.')
    process.exit(1)
  }

  const dbPath = join(tmpdir(), `ahrness-memory-e2e-${process.pid}.sqlite`)
  rmSync(dbPath, { force: true })
  const store = createSessionStore(openDb(dbPath))
  store.ensureSession(KEY, { clientId: 'memory-e2e', channel: 'whatsapp', model: 'claude-opus-4-8' })

  // One turn = exactly what delivery.ts does, minus sandbox/tools/WhatsApp.
  async function runTurn(prompt: string): Promise<{ reply: string; seeded: number }> {
    await compactIfNeeded({ store, key: KEY, model: 'claude-opus-4-8', summarize: async () => '' })
    const ctx = store.getWorkingContext(KEY)
    const seed = toSeedMessages(ctx)
    const agent = new Agent({ systemPrompt: SYSTEM, model: createModel(), messages: seed } as any)
    const result = await agent.invoke(prompt)
    store.appendTurn(KEY, extractTurnMessages(result, { prompt, priorMessageCount: seed.length }))
    return { reply: replyText(result), seeded: seed.length }
  }

  try {
    console.log('\n── Turn 1 (teach the agent two facts) ──')
    const t1 = await runTurn(
      'My monthly ad budget is exactly $4,250 and my brand color is teal. Just acknowledge.',
    )
    console.log(`  seeded with ${t1.seeded} prior messages (expect 0)`)
    console.log(`  agent: ${t1.reply}`)
    assert.equal(t1.seeded, 0, 'first turn should have no prior context')

    console.log('\n── Turn 2 (FRESH agent — only memory carries the facts) ──')
    const t2 = await runTurn('What is my exact monthly ad budget, and what is my brand color?')
    console.log(`  seeded with ${t2.seeded} prior messages (expect > 0)`)
    console.log(`  agent: ${t2.reply}`)

    assert.ok(t2.seeded > 0, 'second turn must be seeded with prior conversation')
    assert.match(t2.reply, /4[,.]?250/, 'agent must recall the budget $4,250 from memory')
    assert.match(t2.reply, /teal/i, 'agent must recall the brand color teal from memory')

    const persisted = store.countMessages(KEY)
    console.log(`\n  transcript rows persisted: ${persisted} (2 turns × user+assistant)`)
    assert.ok(persisted >= 4, 'transcript should hold both turns')

    console.log('\n✓ PASS — the agent remembered across a fresh build. Memory loop works end-to-end.\n')
  } finally {
    rmSync(dbPath, { force: true })
  }
}

main().catch((err) => {
  console.error('\n✗ FAIL —', err.message, '\n')
  process.exit(1)
})
