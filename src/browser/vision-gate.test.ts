import { test } from 'node:test'
import assert from 'node:assert/strict'
import { disableVision, enableVision, isVisionDisabled } from './vision-gate.js'

test('vision is enabled by default for a client with no prior state', () => {
  assert.equal(isVisionDisabled('client-fresh'), false)
})

test('disableVision then isVisionDisabled reports true', () => {
  disableVision('client-a')
  assert.equal(isVisionDisabled('client-a'), true)
  enableVision('client-a')
})

test('enableVision clears the disabled state', () => {
  disableVision('client-b')
  enableVision('client-b')
  assert.equal(isVisionDisabled('client-b'), false)
})

test('the gate is scoped per client, not global', () => {
  disableVision('client-c')
  assert.equal(isVisionDisabled('client-d'), false)
  enableVision('client-c')
})
