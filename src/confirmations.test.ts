import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fingerprint,
  isAffirmative,
  isNegative,
  makeMemoryStore,
  stageOrExecute,
  resolvePendingApproval,
} from './confirmations.js'

const CLIENT = 'client-1'
const summarize = (input: unknown) => `post "${(input as { caption?: string }).caption ?? ''}"`

test('fingerprint is stable regardless of key order', () => {
  assert.equal(fingerprint('t', { a: 1, b: 2 }), fingerprint('t', { b: 2, a: 1 }))
  assert.notEqual(fingerprint('t', { a: 1 }), fingerprint('t', { a: 2 }))
})

test('isAffirmative / isNegative', () => {
  for (const yes of ['yes', 'Yes', 'y', 'confirm', 'go ahead', 'do it']) assert.equal(isAffirmative(yes), true)
  for (const no of ['no', 'cancel', 'stop', 'nope']) assert.equal(isNegative(no), true)
  assert.equal(isAffirmative('maybe later'), false)
})

test('first call stages the action and does NOT execute', async () => {
  const store = makeMemoryStore()
  let executed = 0
  const now = () => 1_000
  const res = await stageOrExecute(
    { store, clientId: CLIENT, toolName: 'instagram_create_post', input: { caption: 'hi' }, summarize, now },
    async () => {
      executed += 1
      return { posted: true }
    },
  )
  assert.equal(executed, 0, 'must not execute before approval')
  assert.match(JSON.stringify(res), /reply yes/i)
  const pending = await store.get(CLIENT)
  assert.equal(pending?.approved, false)
  assert.equal(pending?.toolName, 'instagram_create_post')
})

test('approval then a matching re-call executes exactly once and clears', async () => {
  const store = makeMemoryStore()
  let executed = 0
  const now = () => 2_000
  const args = { caption: 'launch' }
  await stageOrExecute({ store, clientId: CLIENT, toolName: 'post', input: args, summarize, now }, async () => ++executed)

  const decision = await resolvePendingApproval({ store, clientId: CLIENT, text: 'yes', now })
  assert.equal(decision?.decision, 'approved')

  const res = await stageOrExecute(
    { store, clientId: CLIENT, toolName: 'post', input: args, summarize, now },
    async () => {
      executed += 1
      return { posted: true }
    },
  )
  assert.equal(executed, 1, 'executes once on approved matching re-call')
  assert.deepEqual(res, { posted: true })
  assert.equal(await store.get(CLIENT), null, 'pending cleared after execution')
})

test('approved but DIFFERENT args re-stage instead of executing (safety)', async () => {
  const store = makeMemoryStore()
  let executed = 0
  const now = () => 3_000
  await stageOrExecute({ store, clientId: CLIENT, toolName: 'post', input: { caption: 'a' }, summarize, now }, async () => ++executed)
  await resolvePendingApproval({ store, clientId: CLIENT, text: 'yes', now })
  // agent re-calls with tampered/different args
  const res = await stageOrExecute(
    { store, clientId: CLIENT, toolName: 'post', input: { caption: 'DIFFERENT' }, summarize, now },
    async () => ++executed,
  )
  assert.equal(executed, 0, 'must not execute when args differ from the approved fingerprint')
  assert.match(JSON.stringify(res), /reply yes/i)
})

test('expired approval is ignored', async () => {
  const store = makeMemoryStore()
  let executed = 0
  const args = { caption: 'x' }
  await stageOrExecute({ store, clientId: CLIENT, toolName: 'post', input: args, summarize, now: () => 0 }, async () => ++executed)
  await resolvePendingApproval({ store, clientId: CLIENT, text: 'yes', now: () => 0 })
  // 11 minutes later
  const later = () => 11 * 60 * 1000
  const res = await stageOrExecute({ store, clientId: CLIENT, toolName: 'post', input: args, summarize, now: later }, async () => ++executed)
  assert.equal(executed, 0, 'expired approval must not execute')
  assert.match(JSON.stringify(res), /reply yes/i)
})

test('negative reply cancels and clears the pending action', async () => {
  const store = makeMemoryStore()
  await stageOrExecute({ store, clientId: CLIENT, toolName: 'post', input: { caption: 'x' }, summarize, now: () => 0 }, async () => 1)
  const decision = await resolvePendingApproval({ store, clientId: CLIENT, text: 'no', now: () => 0 })
  assert.equal(decision?.decision, 'cancelled')
  assert.equal(await store.get(CLIENT), null)
})

test('resolvePendingApproval returns null when nothing is pending', async () => {
  const store = makeMemoryStore()
  assert.equal(await resolvePendingApproval({ store, clientId: CLIENT, text: 'yes', now: () => 0 }), null)
})
