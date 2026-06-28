/**
 * Dependency-free network guards shared by the host fetch path (outputs.ts) and
 * the standalone egress proxy. Kept free of app/SDK imports so the proxy can run
 * in a minimal container.
 */
import { isIP } from 'node:net'

/** True for loopback, link-local, RFC1918, CGNAT, multicast and IPv6 ULA/link-local. */
export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true
  }
  if (/^fe[89ab]/.test(normalized)) return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1]
  const ipv4 = mapped ?? (isIP(normalized) === 4 ? normalized : null)
  if (!ipv4) return false
  const [a, b] = ipv4.split('.').map(Number)
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  )
}
