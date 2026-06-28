/**
 * Standalone entrypoint for the egress proxy container.
 *
 * Runs inside `ahrness-egress-proxy`, attached to the internal `ahrness-egress`
 * network (shared with client sandboxes) and a normal bridge (internet). Client
 * sandboxes have no internet of their own; their HTTPS_PROXY points here, so this
 * is the only way out — and it only lets allowlisted, public hosts through.
 *
 * Config via env:
 *   AGENT_WEB_ALLOWLIST        comma-separated domains (supports *.x.com, *)
 *   EGRESS_PROXY_PORT          listen port (default 8080)
 *   EGRESS_MAX_PER_MINUTE      per-source CONNECTs/minute (default 120, 0 = off)
 */
import { createEgressProxy } from './egress-proxy.js'

const allowlist = (process.env.AGENT_WEB_ALLOWLIST ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const port = Number.parseInt(process.env.EGRESS_PROXY_PORT ?? '8080', 10)
const maxPerMinute = Number.parseInt(process.env.EGRESS_MAX_PER_MINUTE ?? '120', 10)

const server = createEgressProxy({
  allowlist,
  maxRequestsPerWindow: maxPerMinute,
  windowMs: 60_000,
})

server.listen(port, () => {
  console.log(`[egress] proxy listening on :${port}; allowlist=[${allowlist.join(', ') || '(empty — all denied)'}]`)
})
