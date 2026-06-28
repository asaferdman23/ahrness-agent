import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { isSenderAllowed, allowlistMode } from './access.js'

afterEach(() => {
  delete process.env.AGENT_ALLOWED_SENDERS
})

test('open mode (unset) allows everyone', () => {
  delete process.env.AGENT_ALLOWED_SENDERS
  assert.equal(allowlistMode(), 'open')
  assert.equal(isSenderAllowed('972509999999@s.whatsapp.net'), true)
})

test('restricted mode allows listed JIDs and denies others', () => {
  process.env.AGENT_ALLOWED_SENDERS = '+972501234567, 0521112222'
  assert.equal(allowlistMode(), 'restricted')
  assert.equal(isSenderAllowed('972501234567@s.whatsapp.net'), true)
  assert.equal(isSenderAllowed('972999999999@s.whatsapp.net'), false)
})

test('restricted mode normalizes across JID / +E164 / whatsapp: / leading-zero forms', () => {
  process.env.AGENT_ALLOWED_SENDERS = '0521112222'
  // same number expressed three ways all resolve to the listed entry
  assert.equal(isSenderAllowed('972521112222@s.whatsapp.net'), true)
  assert.equal(isSenderAllowed('whatsapp:+972521112222'), true)
  assert.equal(isSenderAllowed('+972521112222'), true)
})
