import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { SlackConversationWindow, shouldProcessSlackChannelMessage, slackConversationTtlMs } from './slack-gate.js'

afterEach(() => {
  delete process.env.SLACK_CONVERSATION_TTL_MS
})

test('a channel message without a mention is blocked when no conversation is active', () => {
  const decision = shouldProcessSlackChannelMessage({
    text: 'hi there',
    hasFile: false,
    botUserId: 'UBOT1',
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'mention-missing')
})

test('an explicit @mention triggers and strips the mention token from the prompt', () => {
  const decision = shouldProcessSlackChannelMessage({
    text: '<@UBOT1> draft a follow-up for the Acme deal',
    hasFile: false,
    botUserId: 'UBOT1',
  })

  assert.equal(decision.allowed, true)
  assert.equal(decision.triggered, true)
  assert.equal(decision.prompt, 'draft a follow-up for the Acme deal')
})

test('a bare mention with no other text defaults to a greeting', () => {
  const decision = shouldProcessSlackChannelMessage({
    text: '<@UBOT1>',
    hasFile: false,
    botUserId: 'UBOT1',
  })

  assert.equal(decision.allowed, true)
  assert.equal(decision.prompt, 'Hi')
})

test('a bare mention with only a file attached asks the agent to use it', () => {
  const decision = shouldProcessSlackChannelMessage({
    text: '<@UBOT1>',
    hasFile: true,
    botUserId: 'UBOT1',
  })

  assert.equal(decision.allowed, true)
  assert.equal(decision.prompt, 'Use the attached file to complete my request.')
})

test('mentioning a different user does not trigger', () => {
  const decision = shouldProcessSlackChannelMessage({
    text: '<@USOMEONEELSE> hi',
    hasFile: false,
    botUserId: 'UBOT1',
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'mention-missing')
})

test('a follow-up without a mention is accepted while the conversation window is active', () => {
  const decision = shouldProcessSlackChannelMessage({
    text: 'make it shorter',
    hasFile: false,
    botUserId: 'UBOT1',
    conversationActive: true,
  })

  assert.equal(decision.allowed, true)
  assert.equal(decision.triggered, false)
  assert.equal(decision.prompt, 'make it shorter')
})

test('conversation window expires after inactivity and extends on touch', () => {
  const conversations = new SlackConversationWindow(1_000)

  assert.equal(conversations.isActive('C1', 'U1', 1_000), false)
  conversations.touch('C1', 'U1', 'root-ts', 1_000)
  assert.equal(conversations.isActive('C1', 'U1', 1_999), true)
  assert.equal(conversations.activeThreadTs('C1', 'U1', 1_999), 'root-ts')
  conversations.touch('C1', 'U1', 'root-ts', 1_500)
  assert.equal(conversations.isActive('C1', 'U1', 2_499), true)
  assert.equal(conversations.isActive('C1', 'U1', 2_500), false)
})

test('conversation windows are scoped per (channel, user)', () => {
  const conversations = new SlackConversationWindow(1_000)
  conversations.touch('C1', 'U1', 'root-ts', 0)

  assert.equal(conversations.isActive('C1', 'U2', 500), false)
  assert.equal(conversations.isActive('C2', 'U1', 500), false)
  assert.equal(conversations.isActive('C1', 'U1', 500), true)
})

test('clear removes an active window', () => {
  const conversations = new SlackConversationWindow(1_000)
  conversations.touch('C1', 'U1', 'root-ts', 0)
  conversations.clear('C1', 'U1')

  assert.equal(conversations.isActive('C1', 'U1', 0), false)
})

test('conversation TTL is configurable and fail-safe', () => {
  assert.equal(slackConversationTtlMs('60000'), 60_000)
  assert.equal(slackConversationTtlMs('0'), 0)
  assert.equal(slackConversationTtlMs('-1'), 30 * 60 * 1000)
  assert.equal(slackConversationTtlMs('not-a-number'), 30 * 60 * 1000)
})

test('a TTL of 0 disables the conversation window entirely', () => {
  const conversations = new SlackConversationWindow(0)
  conversations.touch('C1', 'U1', 'root-ts', 0)

  assert.equal(conversations.isActive('C1', 'U1', 0), false)
})
