import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveAllowedGroupJids, shouldProcessBaileysInbound } from './baileys-gate.js'

afterEach(() => {
  delete process.env.BAILEYS_GROUP_ONLY
  delete process.env.BAILEYS_ALLOWED_GROUP_JIDS
  delete process.env.BAILEYS_ALLOWED_GROUP_PARTICIPANTS
  delete process.env.BAILEYS_AGENT_TRIGGERS
  delete process.env.BAILEYS_REQUIRE_TRIGGER
})

test('Baileys group mode blocks direct chats', () => {
  const decision = shouldProcessBaileysInbound({
    remoteJid: '15551234567@s.whatsapp.net',
    text: '@bizzclaw hi',
    hasMedia: false,
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'direct-chat-blocked')
})

test('Baileys group mode requires an explicitly allowed group', () => {
  const decision = shouldProcessBaileysInbound({
    remoteJid: '120363111111111111@g.us',
    text: '@bizzclaw hi',
    hasMedia: false,
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'group-not-configured')
  assert.equal(decision.triggered, true)
})

test('allowed group still requires the BizzClaw trigger', () => {
  process.env.BAILEYS_ALLOWED_GROUP_JIDS = '120363111111111111@g.us'

  const decision = shouldProcessBaileysInbound({
    remoteJid: '120363111111111111@g.us',
    text: 'hi',
    hasMedia: false,
    allowedGroupJids: effectiveAllowedGroupJids(process.env.BAILEYS_ALLOWED_GROUP_JIDS),
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'trigger-missing')
})

test('allowed group strips the trigger before sending text to the agent', () => {
  process.env.BAILEYS_ALLOWED_GROUP_JIDS = '120363111111111111@g.us'

  const decision = shouldProcessBaileysInbound({
    remoteJid: '120363111111111111@g.us',
    text: '@bizzclaw write a launch post',
    hasMedia: false,
    allowedGroupJids: effectiveAllowedGroupJids(process.env.BAILEYS_ALLOWED_GROUP_JIDS),
  })

  assert.equal(decision.allowed, true)
  assert.equal(decision.prompt, 'write a launch post')
})

test('participant allowlist restricts who can trigger inside the home group', () => {
  process.env.BAILEYS_ALLOWED_GROUP_JIDS = '120363111111111111@g.us'
  process.env.BAILEYS_ALLOWED_GROUP_PARTICIPANTS = '15550001111@s.whatsapp.net'

  const decision = shouldProcessBaileysInbound({
    remoteJid: '120363111111111111@g.us',
    participantJid: '15559990000@s.whatsapp.net',
    text: '@bizzclaw hi',
    hasMedia: false,
    allowedGroupJids: effectiveAllowedGroupJids(process.env.BAILEYS_ALLOWED_GROUP_JIDS),
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'participant-not-allowed')
})

test('a real WhatsApp mention of the bot can trigger even when visible text uses phone mention', () => {
  process.env.BAILEYS_ALLOWED_GROUP_JIDS = '120363111111111111@g.us'

  const decision = shouldProcessBaileysInbound({
    remoteJid: '120363111111111111@g.us',
    text: '@15558136169 hi',
    hasMedia: false,
    mentionedJids: ['15558136169@s.whatsapp.net'],
    botJid: '15558136169:17@s.whatsapp.net',
    allowedGroupJids: effectiveAllowedGroupJids(process.env.BAILEYS_ALLOWED_GROUP_JIDS),
  })

  assert.equal(decision.allowed, true)
  assert.equal(decision.prompt, 'hi')
})

test('a per-client home group works without a global env allowlist', () => {
  const decision = shouldProcessBaileysInbound({
    remoteJid: '120363222222222222@g.us',
    text: '@bizzclaw hi',
    hasMedia: false,
    allowedGroupJids: effectiveAllowedGroupJids(undefined, '120363222222222222@g.us'),
  })

  assert.equal(decision.allowed, true)
  assert.equal(decision.prompt, 'hi')
})
