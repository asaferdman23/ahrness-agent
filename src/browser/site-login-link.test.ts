import { test } from 'node:test'
import assert from 'node:assert/strict'
import { siteLoginConnectUrlFor, verifySiteLoginToken } from './site-login-link.js'

test('siteLoginConnectUrlFor builds a link carrying a signed token and the domain', () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  const url = siteLoginConnectUrlFor('https://example.com', '972501234567@s.whatsapp.net', 'linkedin.com')
  assert.match(url, /^https:\/\/example\.com\/connect-site\?c=/)
  assert.match(url, /domain=linkedin\.com/)
})

test('the token embedded in the link verifies back to the original jid', () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  const url = siteLoginConnectUrlFor('https://example.com', '972501234567@s.whatsapp.net', 'reddit.com')
  const token = new URL(url).searchParams.get('c')
  assert.ok(token)
  assert.equal(verifySiteLoginToken(token), '972501234567@s.whatsapp.net')
})

test('verifySiteLoginToken rejects a tampered token', () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  const url = siteLoginConnectUrlFor('https://example.com', '972501234567@s.whatsapp.net', 'reddit.com')
  const token = new URL(url).searchParams.get('c')!
  assert.equal(verifySiteLoginToken(`${token}x`), null)
})
