import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifySlackSignature } from './slack-client.js'

const SECRET = 'test-signing-secret'

function sign(timestamp: string, body: string): string {
  return `v0=${createHmac('sha256', SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}`
}

test('accepts a correctly signed, fresh request', () => {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const body = Buffer.from('{"type":"event_callback"}')
  const signature = sign(timestamp, body.toString('utf-8'))

  assert.equal(verifySlackSignature(SECRET, timestamp, signature, body), true)
})

test('rejects a tampered body', () => {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = sign(timestamp, '{"type":"event_callback"}')
  const tamperedBody = Buffer.from('{"type":"tampered"}')

  assert.equal(verifySlackSignature(SECRET, timestamp, signature, tamperedBody), false)
})

test('rejects a signature computed with the wrong secret', () => {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const body = Buffer.from('{"type":"event_callback"}')
  const wrongSignature = `v0=${createHmac('sha256', 'wrong-secret').update(`v0:${timestamp}:${body}`).digest('hex')}`

  assert.equal(verifySlackSignature(SECRET, timestamp, wrongSignature, body), false)
})

test('rejects a stale timestamp (replay protection)', () => {
  const staleTimestamp = String(Math.floor(Date.now() / 1000) - 60 * 10)
  const body = Buffer.from('{"type":"event_callback"}')
  const signature = sign(staleTimestamp, body.toString('utf-8'))

  assert.equal(verifySlackSignature(SECRET, staleTimestamp, signature, body), false)
})

test('rejects missing headers', () => {
  const body = Buffer.from('{}')
  assert.equal(verifySlackSignature(SECRET, undefined, 'v0=abc', body), false)
  assert.equal(verifySlackSignature(SECRET, '12345', undefined, body), false)
})

test('rejects a non-numeric timestamp', () => {
  const body = Buffer.from('{}')
  assert.equal(verifySlackSignature(SECRET, 'not-a-number', 'v0=abc', body), false)
})
