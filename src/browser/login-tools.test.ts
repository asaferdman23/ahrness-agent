import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserLoginTools } from './login-tools.js'
import type { BrowserRuntimeClient } from './client.js'
import { isVisionDisabled } from './vision-gate.js'

function fakeSandbox() {
  const writes: Array<{ path: string; bytes: Uint8Array }> = []
  return {
    writes,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sandbox: { writeFile: async (path: string, bytes: Uint8Array) => { writes.push({ path, bytes }) } } as any,
  }
}

function fakeClient(overrides: Partial<BrowserRuntimeClient> = {}): BrowserRuntimeClient {
  return {
    navigate: async () => ({ httpStatus: 200, title: 'Login' }),
    read: async () => ({ title: 'Login', url: 'https://example.com/login', content: '' }),
    elements: async () => ({
      elements: [
        { index: 0, tag: 'input', type: 'email', label: 'Email' },
        { index: 1, tag: 'input', type: 'password', label: 'Password' },
        { index: 2, tag: 'button', type: null, label: 'Log in' },
      ],
    }),
    click: async () => ({ ok: true, url: 'https://example.com/home' }),
    type: async () => ({ ok: true }),
    screenshot: async () => ({ imageBase64: 'ZmFrZQ==' }),
    close: async () => undefined,
    ...overrides,
  }
}

function findTool(tools: ReturnType<typeof createBrowserLoginTools>, name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = (tools as any[]).find((t) => t.name === name)
  assert.ok(found, `expected a tool named ${name}`)
  return found
}

test('browser_login returns a connect-link when no credential exists for the domain', async () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  process.env.CALLBACK_BASE_URL = 'https://example.com'
  process.env.AGENT_STORE_DIR = '/tmp/ahrness-login-tools-test-nocred'
  const { sandbox } = fakeSandbox()
  const published: import('../outputs.js').PublishedOutput[] = []
  const tools = createBrowserLoginTools('client-nocred', '972501234567@s.whatsapp.net', sandbox, published, fakeClient())
  const loginTool = findTool(tools, 'browser_login')
  const result = await loginTool.invoke({ domain: 'some-uncurated-site.example' })
  assert.match(result, /connect-site/)
  assert.match(result, /domain=some-uncurated-site\.example/)
})

test('browser_login with a saved credential publishes a before-screenshot, disables vision during entry, and re-enables it after', async () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  process.env.AGENT_STORE_DIR = '/tmp/ahrness-login-tools-test-withcred'
  process.env.AGENT_MASTER_KEY = 'b'.repeat(32)
  const { saveSiteCredential } = await import('../store/site-credentials-store.js')
  await saveSiteCredential('client-withcred', 'reddit.com', 'alice', 'hunter2')

  const { sandbox, writes } = fakeSandbox()
  const published: import('../outputs.js').PublishedOutput[] = []
  let visionDuringType = true
  const client = fakeClient({
    type: async (id, target) => {
      visionDuringType = isVisionDisabled(id)
      return { ok: true }
    },
  })
  const tools = createBrowserLoginTools('client-withcred', '972501234567@s.whatsapp.net', sandbox, published, client)
  const loginTool = findTool(tools, 'browser_login')
  const result = await loginTool.invoke({ domain: 'reddit.com' })

  assert.ok(writes.length >= 1, 'must write at least the before-screenshot into the sandbox')
  assert.ok(published.length >= 1, 'must publish at least the before-screenshot for delivery')
  assert.equal(visionDuringType, true, 'vision must be disabled while credentials are being typed')
  assert.equal(isVisionDisabled('client-withcred'), false, 'vision must be re-enabled after the login sequence finishes')

  assert.ok(!result.includes('hunter2'), 'the tool result must never contain the password')
  for (const item of published) {
    assert.ok(!item.caption?.includes('hunter2'), `caption must never contain the password: ${item.caption}`)
    assert.ok(!item.fileName.includes('hunter2'), `fileName must never contain the password: ${item.fileName}`)
  }
})

test('browser_login re-enables vision even if the login sequence throws', async () => {
  process.env.MEDIA_SIGNING_SECRET = 'a'.repeat(24)
  process.env.AGENT_STORE_DIR = '/tmp/ahrness-login-tools-test-throws'
  process.env.AGENT_MASTER_KEY = 'c'.repeat(32)
  const { saveSiteCredential } = await import('../store/site-credentials-store.js')
  await saveSiteCredential('client-throws', 'reddit.com', 'alice', 'hunter2')

  const { sandbox } = fakeSandbox()
  const published: import('../outputs.js').PublishedOutput[] = []
  const client = fakeClient({
    type: async () => {
      throw new Error('boom')
    },
  })
  const tools = createBrowserLoginTools('client-throws', '972501234567@s.whatsapp.net', sandbox, published, client)
  const loginTool = findTool(tools, 'browser_login')
  await assert.rejects(() => loginTool.invoke({ domain: 'reddit.com' }))
  assert.equal(isVisionDisabled('client-throws'), false, 'must re-enable vision even when the login flow fails partway through')
})
