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

/** Delays (ms) between retry attempts for transient, network-level (not HTTP-error) failures — a short
 *  bounded backoff to absorb the brief window right after the browser-runtime container starts, before
 *  its HTTP server is listening yet. */
const RETRY_DELAYS_MS = [100, 300]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function call<T>(fetchImpl: typeof fetch, path: string, method: string, body?: unknown): Promise<T> {
  let lastNetworkError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1])
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl()}${path}`, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(45_000),
      })
    } catch (err) {
      // Network-level failure (e.g. ECONNREFUSED, "fetch failed") — retryable.
      lastNetworkError = err
      continue
    }
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      // A real HTTP error response — surface immediately, never retry.
      const message = typeof data.error === 'string' ? data.error : `browser-runtime error: HTTP ${response.status}`
      throw new Error(message)
    }
    return data as T
  }
  throw lastNetworkError
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
