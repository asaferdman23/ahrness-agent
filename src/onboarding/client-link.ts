/**
 * Signed onboarding links.
 *
 * The agent sends each un-onboarded client a personalised onboarding link that
 * carries their WhatsApp JID, HMAC-signed so it can't be tampered with or guessed.
 * For authenticated onboarding, the session keeps the signed-in tenant id and
 * links the WhatsApp JID to it. Legacy unauthenticated links can still fall back
 * to `clientIdFromJid(jid)` so old local demos keep working.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { OnboardingSession } from '../store/types.js'

function signingSecret(): string {
  const secret = process.env.MEDIA_SIGNING_SECRET ?? process.env.HIGGSFIELD_SETUP_SECRET
  if (!secret || secret.length < 24) throw new Error('MEDIA_SIGNING_SECRET must contain at least 24 characters')
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url')
}

/** `<base64url(jid)>.<hmac>` — throws if no signing secret is configured. */
export function signClientToken(jid: string): string {
  const body = Buffer.from(jid).toString('base64url')
  return `${body}.${sign(body)}`
}

/** Returns the JID if the token is valid and untampered, else null. */
export function verifyClientToken(token: string): string | null {
  const [body, suppliedSig] = token.split('.')
  if (!body || !suppliedSig) return null
  let expected: string
  try {
    expected = sign(body)
  } catch {
    return null
  }
  const a = Buffer.from(suppliedSig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const jid = Buffer.from(body, 'base64url').toString('utf-8')
    return jid || null
  } catch {
    return null
  }
}

/**
 * Build the onboarding URL for a client. Includes the signed JID token when a
 * signing secret is configured; otherwise falls back to the plain URL so local
 * demos without secrets still work.
 */
export function onboardingUrlFor(base: string, jid: string, platform?: string): string {
  const url = `${base.replace(/\/$/, '')}/onboarding`
  const suffix = platform ? `&platform=${encodeURIComponent(platform)}` : ''
  try {
    return `${url}?c=${signClientToken(jid)}${suffix}`
  } catch {
    return platform ? `${url}?platform=${encodeURIComponent(platform)}` : url
  }
}

/**
 * OAuth `state` for an onboarding session: a signed JID token when the session is
 * tied to a client (so the callback can verify and key the connection by client),
 * otherwise the session id as a plain CSRF token.
 */
export function oauthStateFor(session: OnboardingSession): string {
  if (session.whatsappJid) {
    try {
      return signClientToken(session.whatsappJid)
    } catch {
      // No signing secret — fall through to the session id.
    }
  }
  return session.sessionId
}
