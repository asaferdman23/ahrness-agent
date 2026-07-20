import { signClientToken, verifyClientToken } from '../onboarding/client-link.js'

/** Builds the signed link a client taps to enter a website login on the /connect-site form. */
export function siteLoginConnectUrlFor(base: string, jid: string, domain: string): string {
  const token = signClientToken(jid)
  return `${base.replace(/\/$/, '')}/connect-site?c=${token}&domain=${encodeURIComponent(domain)}`
}

/** Verifies a /connect-site token, returning the jid it was signed for, or null if invalid. */
export function verifySiteLoginToken(token: string): string | null {
  return verifyClientToken(token)
}
