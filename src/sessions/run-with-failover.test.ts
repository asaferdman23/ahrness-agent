import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWithFailover, classifyError } from './run-with-failover.js'
import type { WorkingContext } from './types.js'

const emptyCtx: WorkingContext = { summary: null, messages: [], estimatedTokens: 0 }
const baseDeps = {
  getWorkingContext: () => emptyCtx,
  model: 'claude-opus-4-8',
  forceCompact: async () => {},
  backoff: async () => {}, // no real sleep in tests
}

function err(failoverClass: string): Error {
  return Object.assign(new Error(failoverClass), { failoverClass })
}

test('returns the result on first success without retrying', async () => {
  let calls = 0
  const out = await runWithFailover({
    ...baseDeps,
    buildAndInvoke: async () => {
      calls++
      return 'ok'
    },
  })
  assert.equal(out, 'ok')
  assert.equal(calls, 1)
})

test('on context overflow it compacts once then retries with fresh context', async () => {
  let calls = 0
  let compactions = 0
  const ctxSeen: WorkingContext[] = []
  const out = await runWithFailover({
    ...baseDeps,
    getWorkingContext: () => ({ ...emptyCtx, estimatedTokens: calls * 10 }),
    forceCompact: async () => {
      compactions++
    },
    buildAndInvoke: async (ctx) => {
      ctxSeen.push(ctx)
      calls++
      if (calls === 1) throw err('context_overflow')
      return 'ok'
    },
  })
  assert.equal(out, 'ok')
  assert.equal(calls, 2)
  assert.equal(compactions, 1)
  assert.notEqual(ctxSeen[0].estimatedTokens, ctxSeen[1].estimatedTokens) // re-read fresh
})

test('context overflow that persists after compaction is rethrown', async () => {
  let compactions = 0
  await assert.rejects(
    runWithFailover({
      ...baseDeps,
      forceCompact: async () => {
        compactions++
      },
      buildAndInvoke: async () => {
        throw err('context_overflow')
      },
    }),
    /context_overflow/,
  )
  assert.equal(compactions, 1) // only compacts once, doesn't loop
})

test('rate limit backs off and retries up to the limit', async () => {
  let calls = 0
  let backoffs = 0
  const out = await runWithFailover({
    ...baseDeps,
    backoff: async () => {
      backoffs++
    },
    buildAndInvoke: async () => {
      calls++
      if (calls < 3) throw err('rate_limit')
      return 'ok'
    },
  })
  assert.equal(out, 'ok')
  assert.equal(calls, 3)
  assert.equal(backoffs, 2)
})

test('rate limit beyond max retries is rethrown', async () => {
  let calls = 0
  await assert.rejects(
    runWithFailover({
      ...baseDeps,
      maxRateLimitRetries: 2,
      buildAndInvoke: async () => {
        calls++
        throw err('rate_limit')
      },
    }),
    /rate_limit/,
  )
  assert.equal(calls, 3) // initial + 2 retries
})

test('model unavailable switches to the fallback model then retries', async () => {
  let calls = 0
  const modelsUsed: (string | null)[] = []
  const out = await runWithFailover({
    ...baseDeps,
    fallbackModel: 'claude-haiku-4-5-20251001',
    buildAndInvoke: async (_ctx, model) => {
      modelsUsed.push(model)
      calls++
      if (calls === 1) throw err('model_unavailable')
      return 'ok'
    },
  })
  assert.equal(out, 'ok')
  assert.deepEqual(modelsUsed, ['claude-opus-4-8', 'claude-haiku-4-5-20251001'])
})

test('auth errors are rethrown immediately with no retry', async () => {
  let calls = 0
  await assert.rejects(
    runWithFailover({
      ...baseDeps,
      buildAndInvoke: async () => {
        calls++
        throw err('auth')
      },
    }),
    /auth/,
  )
  assert.equal(calls, 1)
})

test('classifyError maps HTTP status codes', () => {
  assert.equal(classifyError(Object.assign(new Error('x'), { status: 429 })), 'rate_limit')
  assert.equal(classifyError(Object.assign(new Error('x'), { status: 401 })), 'auth')
  assert.equal(classifyError(Object.assign(new Error('x'), { status: 503 })), 'model_unavailable')
  assert.equal(classifyError(new Error('maximum context length exceeded')), 'context_overflow')
  assert.equal(classifyError(new Error('something else')), 'unknown')
})
