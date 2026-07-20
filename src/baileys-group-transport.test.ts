import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBaileysGroupTransport } from './baileys-group-transport.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

function captureTransport(calls: string[]): WhatsAppTransport {
  return {
    async sendText(jid) { calls.push(`text:${jid}`) },
    async sendImage(jid) { calls.push(`image:${jid}`) },
    async sendVideo(jid) { calls.push(`video:${jid}`) },
    async sendAudio(jid) { calls.push(`audio:${jid}`) },
    async sendDocument(jid) { calls.push(`document:${jid}`) },
  }
}

test('Baileys group transport allows every output type only in the selected group', async () => {
  const selected = '120363111111111111@g.us'
  const calls: string[] = []
  const transport = createBaileysGroupTransport(
    'client-a',
    captureTransport(calls),
    async () => ({ baileysHomeGroupJid: selected }),
  )

  await transport.sendText(selected, 'hello')
  await transport.sendImage(selected, Buffer.from('image'), 'image/png')
  await transport.sendVideo(selected, Buffer.from('video'), 'video/mp4')
  await transport.sendAudio(selected, Buffer.from('audio'), 'audio/ogg')
  await transport.sendDocument(selected, Buffer.from('doc'), 'text/plain', 'result.txt')

  assert.deepEqual(calls, [
    `text:${selected}`,
    `image:${selected}`,
    `video:${selected}`,
    `audio:${selected}`,
    `document:${selected}`,
  ])
})

test('Baileys group transport fails closed before selection and for every other chat', async () => {
  const calls: string[] = []
  const base = captureTransport(calls)
  const withoutSelection = createBaileysGroupTransport('client-a', base, async () => ({}))
  await assert.rejects(
    () => withoutSelection.sendText('120363111111111111@g.us', 'hello'),
    /no WhatsApp group has been selected/,
  )

  const selected = createBaileysGroupTransport(
    'client-a',
    base,
    async () => ({ baileysHomeGroupJid: '120363111111111111@g.us' }),
  )
  await assert.rejects(
    () => selected.sendText('120363222222222222@g.us', 'wrong group'),
    /not the client selected WhatsApp group/,
  )
  await assert.rejects(
    () => selected.sendText('15551234567@s.whatsapp.net', 'direct chat'),
    /not the client selected WhatsApp group/,
  )
  assert.deepEqual(calls, [])
})
