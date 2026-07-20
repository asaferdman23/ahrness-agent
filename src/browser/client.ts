export interface BrowserElement {
  index: number
  tag: string
  type: string | null
  label: string
}

export type ClickOrTypeTarget = { index: number } | { selector: string }

export interface BrowserRuntimeClient {
  navigate(clientId: string, url: string): Promise<{ httpStatus: number | null; title: string }>
  read(clientId: string, format: 'text' | 'html'): Promise<{ title: string; url: string; content: string }>
  elements(clientId: string): Promise<{ elements: BrowserElement[] }>
  click(clientId: string, target: ClickOrTypeTarget): Promise<{ ok: true; url: string }>
  type(clientId: string, target: ClickOrTypeTarget & { text: string }): Promise<{ ok: true }>
  screenshot(clientId: string): Promise<{ imageBase64: string }>
  close(clientId: string): Promise<void>
}

function baseUrl(): string {
  return process.env.BROWSER_RUNTIME_URL ?? 'http://ahrness-browser-runtime:8090'
}

async function call<T>(fetchImpl: typeof fetch, path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetchImpl(`${baseUrl()}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
  })
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : `browser-runtime error: HTTP ${response.status}`
    throw new Error(message)
  }
  return data as T
}

export function createBrowserRuntimeClient(fetchImpl: typeof fetch = fetch): BrowserRuntimeClient {
  return {
    navigate: (clientId, url) => call(fetchImpl, `/contexts/${clientId}/navigate`, 'POST', { url }),
    read: (clientId, format) => call(fetchImpl, `/contexts/${clientId}/read`, 'POST', { format }),
    elements: (clientId) => call(fetchImpl, `/contexts/${clientId}/elements`, 'POST', {}),
    click: (clientId, target) => call(fetchImpl, `/contexts/${clientId}/click`, 'POST', target),
    type: (clientId, target) => call(fetchImpl, `/contexts/${clientId}/type`, 'POST', target),
    screenshot: (clientId) => call(fetchImpl, `/contexts/${clientId}/screenshot`, 'POST', {}),
    close: async (clientId) => {
      await call(fetchImpl, `/contexts/${clientId}`, 'DELETE')
    },
  }
}
