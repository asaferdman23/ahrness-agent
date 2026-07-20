import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { isPrivateAddress } from '../net-guard.js'

async function defaultResolve(host: string): Promise<string[]> {
  if (net.isIP(host)) return [host]
  const results = await lookup(host, { all: true, verbatim: true })
  return results.map((r) => r.address)
}

/**
 * Throws if a browser_navigate target isn't http/https, or resolves to a
 * private/loopback/link-local address. Deliberately has NO domain allowlist —
 * unlike the code-sandbox's egress proxy, browsing is meant to reach any
 * public site; this only blocks internal-network targets.
 */
export async function assertSafeNavigationTarget(
  url: string,
  resolveAddresses: (host: string) => Promise<string[]> = defaultResolve,
): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http/https URLs are allowed (got ${parsed.protocol})`)
  }
  const addresses = await resolveAddresses(parsed.hostname)
  if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address))) {
    throw new Error(`URL host "${parsed.hostname}" resolves to a private or local address`)
  }
}
