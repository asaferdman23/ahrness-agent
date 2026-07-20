import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertSafeNavigationTarget } from './ssrf-guard.js'

test('allows a URL whose host resolves to a public address', async () => {
  await assert.doesNotReject(() => assertSafeNavigationTarget('https://example.com', async () => ['93.184.216.34']))
})

test('rejects a URL whose host resolves to a private address', async () => {
  await assert.rejects(
    () => assertSafeNavigationTarget('https://internal.example', async () => ['10.0.0.5']),
    /private or local/,
  )
})

test('rejects a literal loopback IP without needing a resolver', async () => {
  await assert.rejects(() => assertSafeNavigationTarget('http://127.0.0.1/admin'), /private or local/)
})

test('rejects a non-http(s) protocol', async () => {
  await assert.rejects(() => assertSafeNavigationTarget('file:///etc/passwd'), /http\/https/)
})
