import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import {
  hostMatchesAllowlist,
  assertEgressAllowed,
  createWindowedRateLimiter,
  createEgressProxy,
} from './egress-proxy.js'

// ── allowlist matching ────────────────────────────────────────────────────────

test('hostMatchesAllowlist: exact, suffix, wildcard, star, and denials', () => {
  assert.equal(hostMatchesAllowlist('example.com', ['example.com']), true)
  assert.equal(hostMatchesAllowlist('api.example.com', ['example.com']), true) // suffix
  assert.equal(hostMatchesAllowlist('api.example.com', ['*.example.com']), true)
  assert.equal(hostMatchesAllowlist('example.com', ['*.example.com']), false) // wildcard needs a label
  assert.equal(hostMatchesAllowlist('evil.com', ['example.com']), false)
  assert.equal(hostMatchesAllowlist('notexample.com', ['example.com']), false) // not a real suffix
  assert.equal(hostMatchesAllowlist('anything.test', ['*']), true)
  assert.equal(hostMatchesAllowlist('example.com', []), false)
})

// ── connect gate ──────────────────────────────────────────────────────────────

test('assertEgressAllowed rejects non-443 ports', async () => {
  await assert.rejects(() => assertEgressAllowed('8.8.8.8', 80, ['*']), /port/i)
})

test('assertEgressAllowed rejects hosts not on the allowlist', async () => {
  await assert.rejects(() => assertEgressAllowed('8.8.8.8', 443, ['example.com']), /allow/i)
})

test('assertEgressAllowed rejects private/loopback IP targets', async () => {
  await assert.rejects(() => assertEgressAllowed('10.0.0.5', 443, ['*']), /private/i)
  await assert.rejects(() => assertEgressAllowed('127.0.0.1', 443, ['*']), /private/i)
})

test('assertEgressAllowed permits a public, allowlisted target', async () => {
  await assert.doesNotReject(() => assertEgressAllowed('8.8.8.8', 443, ['*']))
})

// ── rate limiter ──────────────────────────────────────────────────────────────

test('createWindowedRateLimiter caps per key and isolates keys', () => {
  const limiter = createWindowedRateLimiter(2, 60_000)
  assert.equal(limiter.check('a'), true)
  assert.equal(limiter.check('a'), true)
  assert.equal(limiter.check('a'), false) // 3rd over cap
  assert.equal(limiter.check('b'), true) // different key unaffected
})

// ── live proxy: a disallowed CONNECT is refused with 403 ──────────────────────

test('proxy refuses a CONNECT to a non-allowlisted host with 403', async () => {
  const proxy = createEgressProxy({ allowlist: ['example.com'] })
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  const { port } = proxy.address() as net.AddressInfo
  try {
    const response = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.write('CONNECT evil.com:443 HTTP/1.1\r\nHost: evil.com:443\r\n\r\n')
      })
      let buf = ''
      sock.on('data', (d) => {
        buf += d.toString()
        if (buf.includes('\r\n\r\n')) {
          sock.destroy()
          resolve(buf)
        }
      })
      sock.on('error', reject)
    })
    assert.match(response, /^HTTP\/1\.1 403/)
  } finally {
    await new Promise<void>((resolve) => proxy.close(() => resolve()))
  }
})
