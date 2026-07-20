import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserTools } from './tools.js'
import type { BrowserRuntimeClient } from './client.js'

function fakeClient(overrides: Partial<BrowserRuntimeClient> = {}): BrowserRuntimeClient {
  return {
    navigate: async () => ({ httpStatus: 200, title: 'Example' }),
    read: async () => ({ title: 'Example', url: 'https://example.com', content: 'Hello world' }),
    elements: async () => ({ elements: [{ index: 0, tag: 'button', type: null, label: 'Sign in' }] }),
    click: async () => ({ ok: true, url: 'https://example.com' }),
    type: async () => ({ ok: true }),
    screenshot: async () => ({ imageBase64: 'ZmFrZQ==' }),
    close: async () => undefined,
    ...overrides,
  }
}

function findTool(tools: ReturnType<typeof createBrowserTools>, name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = (tools as any[]).find((t) => t.name === name)
  assert.ok(found, `expected a tool named ${name}`)
  return found
}

test('browser_read wraps page content as untrusted', async () => {
  const tools = createBrowserTools('client-1', fakeClient())
  const readTool = findTool(tools, 'browser_read')
  const result = await readTool.invoke({ format: 'text' })
  assert.match(result, /untrusted/i)
  assert.match(result, /Hello world/)
})

test('browser_view_elements returns the numbered element list', async () => {
  const tools = createBrowserTools('client-1', fakeClient())
  const elementsTool = findTool(tools, 'browser_view_elements')
  const result = await elementsTool.invoke({})
  assert.match(result, /Sign in/)
  assert.match(result, /\[0\]/)
})

test('browser_click on a low-risk element executes immediately', async () => {
  let clicked = false
  const client = fakeClient({
    elements: async () => ({ elements: [{ index: 0, tag: 'a', type: null, label: 'Learn more' }] }),
    click: async () => {
      clicked = true
      return { ok: true, url: 'https://example.com/more' }
    },
  })
  const tools = createBrowserTools('client-2', client)
  const elementsTool = findTool(tools, 'browser_view_elements')
  await elementsTool.invoke({})
  const clickTool = findTool(tools, 'browser_click')
  const result = await clickTool.invoke({ index: 0 })
  assert.ok(clicked, 'should execute the click directly for a low-risk label')
  assert.match(result, /https:\/\/example\.com\/more/)
})

test('browser_click on a high-risk element stages a confirmation instead of executing', async () => {
  let clicked = false
  const client = fakeClient({
    elements: async () => ({ elements: [{ index: 0, tag: 'button', type: null, label: 'Complete purchase' }] }),
    click: async () => {
      clicked = true
      return { ok: true, url: 'https://example.com/receipt' }
    },
  })
  const tools = createBrowserTools('client-3', client)
  const elementsTool = findTool(tools, 'browser_view_elements')
  await elementsTool.invoke({})
  const clickTool = findTool(tools, 'browser_click')
  const result = await clickTool.invoke({ index: 0 })
  assert.ok(!clicked, 'must not execute a high-risk click without confirmation')
  assert.match(result, /confirm/i)
})

test('browser_click on an unresolved index stages a confirmation instead of executing', async () => {
  let clicked = false
  const client = fakeClient({
    click: async () => {
      clicked = true
      return { ok: true, url: 'https://example.com/receipt' }
    },
  })
  const tools = createBrowserTools('client-3b', client)
  // No browser_view_elements() call was ever made for this client, so index 0 is unresolved.
  const clickTool = findTool(tools, 'browser_click')
  const result = await clickTool.invoke({ index: 0 })
  assert.ok(!clicked, 'must not execute a click for an index that was never resolved to a label')
  assert.match(result, /confirm/i)
})

test('browser_click_selector always stages a confirmation and never clicks directly', async () => {
  let clicked = false
  const client = fakeClient({
    click: async () => {
      clicked = true
      return { ok: true, url: 'https://example.com/receipt' }
    },
  })
  const tools = createBrowserTools('client-3c', client)
  const clickSelectorTool = findTool(tools, 'browser_click_selector')
  const result = await clickSelectorTool.invoke({ selector: '#some-button' })
  assert.ok(!clicked, 'must not execute a selector-based click without confirmation')
  assert.match(result, /confirm/i)
})

test('browser_screenshot returns an image payload', async () => {
  const tools = createBrowserTools('client-4', fakeClient())
  const screenshotTool = findTool(tools, 'browser_screenshot')
  const result = await screenshotTool.invoke({})
  assert.match(result, /ZmFrZQ==/)
})

test('browser_navigate clears the cached element labels so a stale index is treated as unresolved', async () => {
  let clicked = false
  const client = fakeClient({
    elements: async () => ({ elements: [{ index: 0, tag: 'a', type: null, label: 'Learn more' }] }),
    navigate: async () => ({ httpStatus: 200, title: 'New page' }),
    click: async () => {
      clicked = true
      return { ok: true, url: 'https://example.com/receipt' }
    },
  })
  const tools = createBrowserTools('client-6', client)
  const elementsTool = findTool(tools, 'browser_view_elements')
  await elementsTool.invoke({})
  const navigateTool = findTool(tools, 'browser_navigate')
  await navigateTool.invoke({ url: 'https://example.com/new' })
  const clickTool = findTool(tools, 'browser_click')
  const result = await clickTool.invoke({ index: 0 })
  assert.ok(!clicked, 'must not execute a click for an index that was valid before navigation but not re-resolved after')
  assert.match(result, /confirm/i)
})

test('browser_navigate rejects a URL that resolves to a private address before calling the client', async () => {
  let navigated = false
  const client = fakeClient({
    navigate: async () => {
      navigated = true
      return { httpStatus: 200, title: 'should not get here' }
    },
  })
  const tools = createBrowserTools('client-5', client)
  const navigateTool = findTool(tools, 'browser_navigate')
  await assert.rejects(() => navigateTool.invoke({ url: 'http://127.0.0.1/admin' }), /private or local/)
  assert.ok(!navigated, 'must not call the browser-runtime client for an unsafe target')
})
