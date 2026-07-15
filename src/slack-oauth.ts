/**
 * Slack OAuth v2 install flow — multi-tenant: each client installs the app
 * into their own workspace. `state` is HMAC-signed with the same helper as
 * onboarding links (onboarding/client-link.ts) so the callback can trust
 * which client to credit without a separate session lookup.
 */
import { signClientToken, verifyClientToken } from './onboarding/client-link.js'

const BOT_SCOPES = 'chat:write,im:history,im:read,files:write'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export function slackRedirectUri(): string {
  const base = requireEnv('CALLBACK_BASE_URL')
  return `${base.replace(/\/$/, '')}/auth/slack/callback`
}

/** Install URL for a client's dashboard "Connect Slack" button. Null if unconfigured. */
export function slackInstallUrl(clientId: string): string | null {
  try {
    const params = new URLSearchParams({
      client_id: requireEnv('SLACK_CLIENT_ID'),
      scope: BOT_SCOPES,
      redirect_uri: slackRedirectUri(),
      state: signClientToken(clientId),
    })
    return `https://slack.com/oauth/v2/authorize?${params.toString()}`
  } catch {
    return null
  }
}

/** Verify the OAuth `state` param and return the clientId it was signed for, or null if invalid/tampered. */
export function verifySlackState(state: string): string | null {
  return verifyClientToken(state)
}
