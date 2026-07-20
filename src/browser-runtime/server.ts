import http from 'node:http'
import puppeteerExtraDefault from 'puppeteer-extra'
import type { PuppeteerExtra } from 'puppeteer-extra'
import type { Browser, Page } from 'puppeteer'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

// `puppeteer-extra`'s default-export typing doesn't resolve correctly under this
// project's NodeNext + esModuleInterop config (the import types as the CJS module
// namespace instead of the PuppeteerExtra instance), even though the runtime value
// is correct — Node's cjs-module-lexer detects `exports.default` fine. Cast to the
// real (named-exported) type rather than using `import ... = require(...)`, which
// type-checks but breaks at runtime under tsx/esbuild's per-file ESM transform
// (`require is not defined in ES module scope`).
const puppeteer = puppeteerExtraDefault as unknown as PuppeteerExtra

puppeteer.use(StealthPlugin())

const PORT = Number(process.env.BROWSER_RUNTIME_PORT ?? 8090)
const MAX_CONTEXTS = Number(process.env.BROWSER_MAX_CONTEXTS ?? 20)
const IDLE_TIMEOUT_MS = Number(process.env.BROWSER_IDLE_TIMEOUT_MS ?? 300_000)
const NAV_TIMEOUT_MS = Number(process.env.BROWSER_NAV_TIMEOUT_MS ?? 30_000)

let browserInstance: Browser | null = null
async function getBrowser(): Promise<Browser> {
  if (browserInstance?.connected) return browserInstance
  browserInstance = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  return browserInstance
}

interface ClientSession {
  page: Page
  lastUsedAt: number
}
const sessions = new Map<string, ClientSession>()

async function getSession(clientId: string): Promise<ClientSession> {
  const existing = sessions.get(clientId)
  if (existing) {
    existing.lastUsedAt = Date.now()
    return existing
  }
  if (sessions.size >= MAX_CONTEXTS) {
    throw new Error('CAPACITY: too many active browsing sessions right now, try again shortly')
  }
  const browser = await getBrowser()
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS)
  const session: ClientSession = { page, lastUsedAt: Date.now() }
  sessions.set(clientId, session)
  return session
}

async function closeSession(clientId: string): Promise<void> {
  const session = sessions.get(clientId)
  if (!session) return
  sessions.delete(clientId)
  try {
    await session.page.browserContext().close()
  } catch {
    // context already gone — nothing to clean up
  }
}

setInterval(() => {
  const now = Date.now()
  for (const [clientId, session] of sessions) {
    if (now - session.lastUsedAt > IDLE_TIMEOUT_MS) void closeSession(clientId)
  }
}, 60_000).unref()

// Tags every visible, interactive element with data-bu-index so click/type can
// target it reliably by number instead of the agent having to guess a selector.
const INDEX_SCRIPT = `(() => {
  const SELECTOR = 'a[href], button, input, select, textarea, [role="button"], [onclick], [tabindex]:not([tabindex="-1"])'
  const nodes = Array.from(document.querySelectorAll(SELECTOR))
  const results = []
  let i = 0
  for (const el of nodes) {
    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue
    el.setAttribute('data-bu-index', String(i))
    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('value') || '').trim().slice(0, 80)
    results.push({ index: i, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || null, label })
    i++
  }
  return results
})()`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
}

function targetSelector(body: { index?: unknown; selector?: unknown }): string {
  if (typeof body.index === 'number') return `[data-bu-index="${body.index}"]`
  if (typeof body.selector === 'string') return body.selector
  throw new Error('Either "index" (from a prior elements() call) or "selector" is required')
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://internal')

    const deleteMatch = /^\/contexts\/([^/]+)$/.exec(url.pathname)
    if (req.method === 'DELETE' && deleteMatch) {
      await closeSession(deleteMatch[1])
      return send(res, 200, { ok: true })
    }

    const actionMatch = /^\/contexts\/([^/]+)\/(navigate|read|elements|click|type|screenshot)$/.exec(url.pathname)
    if (req.method !== 'POST' || !actionMatch) return send(res, 404, { error: 'not found' })

    const [, clientId, action] = actionMatch
    const body = await readJsonBody(req)
    const { page } = await getSession(clientId)

    if (action === 'navigate') {
      if (typeof body.url !== 'string' || !body.url) return send(res, 400, { error: 'url is required' })
      const response = await page.goto(body.url, { waitUntil: 'networkidle2' })
      return send(res, 200, { httpStatus: response?.status() ?? null, title: await page.title() })
    }

    if (action === 'read') {
      const format = body.format === 'html' ? 'html' : 'text'
      const content = format === 'html' ? await page.content() : await page.evaluate(() => document.body.innerText)
      return send(res, 200, { title: await page.title(), url: page.url(), content })
    }

    if (action === 'elements') {
      const elements = await page.evaluate(INDEX_SCRIPT)
      return send(res, 200, { elements })
    }

    if (action === 'click') {
      const selector = targetSelector(body)
      await page.click(selector)
      return send(res, 200, { ok: true, url: page.url() })
    }

    if (action === 'type') {
      if (typeof body.text !== 'string') return send(res, 400, { error: 'text is required' })
      const selector = targetSelector(body)
      await page.type(selector, body.text, { delay: 20 })
      return send(res, 200, { ok: true })
    }

    if (action === 'screenshot') {
      const imageBase64 = await page.screenshot({ encoding: 'base64', type: 'png' })
      return send(res, 200, { imageBase64 })
    }

    return send(res, 404, { error: 'unknown action' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.startsWith('CAPACITY:') ? 503 : 500
    return send(res, status, { error: message })
  }
})

server.listen(PORT, () => {
  console.log(`[browser-runtime] listening on :${PORT}`)
})
