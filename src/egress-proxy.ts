/**
 * Host-side filtering forward proxy — the sandbox's only route to the internet.
 *
 * When sandbox egress is enabled, each client container is placed on an internal
 * Docker network (no NAT) and pointed at this proxy via HTTPS_PROXY. The proxy:
 *   - serves HTTPS CONNECT tunnels only (no plaintext HTTP),
 *   - allows only hosts on the domain allowlist,
 *   - resolves the target and refuses private/loopback addresses (SSRF guard),
 *   - rate-limits per source so a runaway agent can't hammer the web,
 *   - logs every tunnel for audit.
 *
 * Credentials never pass through here: app tokens stay in host tool calls, so the
 * proxy only ever carries the agent's own scraping/fetch traffic.
 */
import net from 'node:net'
import http from 'node:http'
import { lookup } from 'node:dns/promises'
import { isPrivateAddress } from './net-guard.js'

/** Suffix/wildcard host match. `*` allows all; `*.x.com` needs a leading label; bare `x.com` matches `x.com` and `*.x.com`. */
export function hostMatchesAllowlist(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase()
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase()
    if (!p) return false
    if (p === '*') return true
    if (p.startsWith('*.')) {
      const base = p.slice(2)
      return h.endsWith(`.${base}`)
    }
    return h === p || h.endsWith(`.${p}`)
  })
}

/** Throws with a descriptive reason if a CONNECT to host:port must not be allowed. */
export async function assertEgressAllowed(host: string, port: number, allowlist: string[]): Promise<void> {
  if (port !== 443) throw new Error(`Only HTTPS port 443 egress is allowed (got ${port})`)
  if (!hostMatchesAllowlist(host, allowlist)) throw new Error(`Host ${host} is not on the egress allowlist`)
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`Host ${host} resolves to a private or local address`)
  }
}

export interface RateLimiter {
  check(key: string): boolean
}

/** Fixed-window limiter: at most `max` allowed calls per `windowMs` per key. */
export function createWindowedRateLimiter(max: number, windowMs: number): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return {
    check(key: string): boolean {
      const now = Date.now()
      const entry = hits.get(key)
      if (!entry || now >= entry.resetAt) {
        hits.set(key, { count: 1, resetAt: now + windowMs })
        return true
      }
      if (entry.count >= max) return false
      entry.count += 1
      return true
    },
  }
}

export interface EgressProxyOptions {
  allowlist: string[]
  /** Max CONNECTs per source IP per window (0/undefined = unlimited). */
  maxRequestsPerWindow?: number
  windowMs?: number
  onLog?: (line: string) => void
}

export function createEgressProxy(opts: EgressProxyOptions): http.Server {
  const log = opts.onLog ?? ((line: string) => console.log(`[egress] ${line}`))
  const limiter =
    opts.maxRequestsPerWindow && opts.maxRequestsPerWindow > 0
      ? createWindowedRateLimiter(opts.maxRequestsPerWindow, opts.windowMs ?? 60_000)
      : null

  const server = http.createServer((_req, res) => {
    // Plain HTTP proxying is not supported — only HTTPS CONNECT tunnels.
    res.writeHead(405, { 'Content-Type': 'text/plain' }).end('Only HTTPS CONNECT is supported')
  })

  server.on('connect', (req, clientSocket: net.Socket, head: Buffer) => {
    const source = clientSocket.remoteAddress ?? 'unknown'
    const [host, portStr] = (req.url ?? '').split(':')
    const port = Number.parseInt(portStr ?? '443', 10)

    const refuse = (code: number, reason: string) => {
      log(`DENY ${source} → ${req.url} (${reason})`)
      clientSocket.write(`HTTP/1.1 ${code} ${reason}\r\n\r\n`)
      clientSocket.destroy()
    }

    if (limiter && !limiter.check(source)) return refuse(429, 'Rate limit exceeded')

    assertEgressAllowed(host, port, opts.allowlist)
      .then(() => {
        const upstream = net.connect(port, host, () => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          if (head?.length) upstream.write(head)
          upstream.pipe(clientSocket)
          clientSocket.pipe(upstream)
          log(`ALLOW ${source} → ${host}:${port}`)
        })
        upstream.on('error', () => refuse(502, 'Upstream error'))
        clientSocket.on('error', () => upstream.destroy())
      })
      .catch((err: Error) => refuse(403, err.message))
  })

  return server
}
