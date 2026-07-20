import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  baileysHomeChatFromMeta,
  baileysHomeChatPatch,
  clearBaileysHomeChatPatch,
} from './baileys-home-chat.js'

test('resolves legacy home groups and new self-chat records', () => {
  assert.deepEqual(baileysHomeChatFromMeta({
    baileysHomeGroupJid: '120363111111111111@g.us',
    baileysHomeGroupSubject: 'Planning',
  }), {
    jid: '120363111111111111@g.us',
    kind: 'group',
    subject: 'Planning',
    boundAt: undefined,
  })

  assert.deepEqual(baileysHomeChatFromMeta({
    baileysHomeChatJid: '15551234567@s.whatsapp.net',
    baileysHomeChatKind: 'self',
    baileysHomeChatSubject: 'Message yourself',
  }), {
    jid: '15551234567@s.whatsapp.net',
    kind: 'self',
    subject: 'Message yourself',
    boundAt: undefined,
  })
})

test('selecting self clears legacy group fields and disconnect clears every home-chat field', () => {
  const patch = baileysHomeChatPatch({
    jid: '15551234567@s.whatsapp.net',
    kind: 'self',
    subject: 'Message yourself',
    boundAt: '2026-07-20T00:00:00.000Z',
  })
  assert.equal(patch.baileysHomeGroupJid, undefined)
  assert.equal(patch.baileysHomeChatKind, 'self')

  const cleared = clearBaileysHomeChatPatch()
  assert.equal(cleared.baileysHomeChatJid, undefined)
  assert.equal(cleared.baileysHomeGroupJid, undefined)
})
