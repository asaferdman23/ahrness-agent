import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLikelyIrreversibleAction } from './risk.js'

test('flags checkout and payment language', () => {
  assert.equal(isLikelyIrreversibleAction('Place order'), true)
  assert.equal(isLikelyIrreversibleAction('Pay now'), true)
  assert.equal(isLikelyIrreversibleAction('Complete purchase'), true)
  assert.equal(isLikelyIrreversibleAction('Buy it now'), true)
})

test('flags destructive and subscription-changing language', () => {
  assert.equal(isLikelyIrreversibleAction('Delete account'), true)
  assert.equal(isLikelyIrreversibleAction('Unsubscribe'), true)
  assert.equal(isLikelyIrreversibleAction('Remove item permanently'), true)
})

test('does not flag ordinary navigation/reading actions', () => {
  assert.equal(isLikelyIrreversibleAction('Learn more'), false)
  assert.equal(isLikelyIrreversibleAction('View profile'), false)
  assert.equal(isLikelyIrreversibleAction('Next page'), false)
  assert.equal(isLikelyIrreversibleAction(''), false)
})

test('is case-insensitive', () => {
  assert.equal(isLikelyIrreversibleAction('CONFIRM ORDER'), true)
})
