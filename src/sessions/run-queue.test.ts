import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRunQueue } from './run-queue.js'

const tick = () => new Promise((r) => setTimeout(r, 5))

test('same key runs tasks strictly serially in enqueue order', async () => {
  const q = createRunQueue()
  const order: string[] = []

  const a = q.enqueue('k', async () => {
    order.push('a:start')
    await tick()
    order.push('a:end')
  })
  const b = q.enqueue('k', async () => {
    order.push('b:start')
    await tick()
    order.push('b:end')
  })

  await Promise.all([a, b])
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end'])
})

test('different keys run concurrently', async () => {
  const q = createRunQueue()
  const order: string[] = []

  const a = q.enqueue('k1', async () => {
    order.push('a:start')
    await tick()
    order.push('a:end')
  })
  const b = q.enqueue('k2', async () => {
    order.push('b:start')
    await tick()
    order.push('b:end')
  })

  await Promise.all([a, b])
  // Both start before either ends → interleaved, not serialized.
  assert.deepEqual(order, ['a:start', 'b:start', 'a:end', 'b:end'])
})

test('enqueue returns the task result', async () => {
  const q = createRunQueue()
  const result = await q.enqueue('k', async () => 42)
  assert.equal(result, 42)
})

test('a failing task rejects but does not block the next task on the same key', async () => {
  const q = createRunQueue()
  const failed = q.enqueue('k', async () => {
    throw new Error('boom')
  })
  await assert.rejects(failed, /boom/)

  const after = await q.enqueue('k', async () => 'recovered')
  assert.equal(after, 'recovered')
})
