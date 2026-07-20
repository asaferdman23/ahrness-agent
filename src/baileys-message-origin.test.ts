import { test } from 'node:test'
import assert from 'node:assert/strict'
import { consumeAgentAuthoredMessage, rememberAgentMessageId } from './baileys-message-origin.js'

test('ignores only messages authored by the agent socket, not owner phone messages', () => {
  const sent = new Set<string>()
  rememberAgentMessageId(sent, 'agent-output-1')

  assert.equal(consumeAgentAuthoredMessage(sent, true, 'owner-phone-message'), false)
  assert.equal(consumeAgentAuthoredMessage(sent, false, 'agent-output-1'), false)
  assert.equal(consumeAgentAuthoredMessage(sent, true, 'agent-output-1'), true)
  assert.equal(consumeAgentAuthoredMessage(sent, true, 'agent-output-1'), false)
})

test('bounds remembered agent message ids', () => {
  const sent = new Set<string>()
  for (let index = 0; index < 550; index += 1) rememberAgentMessageId(sent, `message-${index}`)

  assert.equal(sent.size, 500)
  assert.equal(sent.has('message-0'), false)
  assert.equal(sent.has('message-549'), true)
})
