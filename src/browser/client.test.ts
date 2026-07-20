import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserRuntimeClient } from './client.js'

function fakeFetch(responses: Array<{ status: number; body: unknown }>): { fetch: typeof fetch; calls: Array<{ url: string; method: string; body: unknown }> } {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  let i = 0
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = responses[Math.min(i, responses.length - 1)]
    i++
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify(response.body), { status: response.status })
  }) as typeof fetch
  return { fetch: impl, calls }
}

test('navigate posts to the right path with the url in the body', async () => {
  const { fetch: f, calls } = fakeFetch([{ status: 200, body: { httpStatus: 200, title: 'Example' } }])
  const client = createBrowserRuntimeClient(f)
  const result = await client.navigate('client-1', 'https://example.com')
  assert.equal(result.title, 'Example')
  assert.match(calls[0].url, /\/contexts\/client-1\/navigate$/)
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(calls[0].body, { url: 'https://example.com' })
})

test('click accepts either an index or a selector target', async () => {
  const { fetch: f, calls } = fakeFetch([{ status: 200, body: { ok: true, url: 'https://example.com' } }])
  const client = createBrowserRuntimeClient(f)
  await client.click('client-1', { index: 3 })
  assert.deepEqual(calls[0].body, { index: 3 })
})

test('throws with the server-provided error message on a non-2xx response', async () => {
  const { fetch: f } = fakeFetch([{ status: 503, body: { error: 'CAPACITY: too many active browsing sessions right now, try again shortly' } }])
  const client = createBrowserRuntimeClient(f)
  await assert.rejects(() => client.navigate('client-1', 'https://example.com'), /CAPACITY/)
})

test('close issues a DELETE to the context path', async () => {
  const { fetch: f, calls } = fakeFetch([{ status: 200, body: { ok: true } }])
  const client = createBrowserRuntimeClient(f)
  await client.close('client-1')
  assert.equal(calls[0].method, 'DELETE')
  assert.match(calls[0].url, /\/contexts\/client-1$/)
})
