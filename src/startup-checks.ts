/**
 * Boot-time security checks. Fail fast on insecure configuration rather than
 * discovering it at the first OAuth callback or token write.
 */
import { allowlistMode } from './access.js'

/**
 * Reject an http:// callback base on a public host (OAuth codes/state would
 * travel in cleartext). Localhost http is allowed for development; set
 * ALLOW_INSECURE_CALLBACK=true to override for a non-local host.
 */
export function validateCallbackUrl(rawUrl: string | undefined, allowInsecure: boolean): void {
  if (!rawUrl) return
  const url = new URL(rawUrl)
  if (url.protocol === 'https:') return
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol === 'http:' && (isLocal || allowInsecure)) return
  throw new Error(
    `CALLBACK_BASE_URL must use https for non-local hosts (got ${rawUrl}). ` +
      'Set ALLOW_INSECURE_CALLBACK=true to override (not recommended).',
  )
}

/** Run all boot-time checks; throws on a fatal misconfiguration. */
export function runStartupChecks(): void {
  validateCallbackUrl(process.env.CALLBACK_BASE_URL, process.env.ALLOW_INSECURE_CALLBACK === 'true')

  const key = process.env.AGENT_MASTER_KEY
  if (!key || key.length < 32) {
    throw new Error(
      'AGENT_MASTER_KEY must be set to at least 32 characters — it encrypts client OAuth tokens at rest.',
    )
  }

  if (allowlistMode() === 'open') {
    console.warn(
      '[startup] AGENT_ALLOWED_SENDERS is not set — the agent will respond to ANYONE who messages it. ' +
        'Set it before exposing the number publicly.',
    )
  }
}
