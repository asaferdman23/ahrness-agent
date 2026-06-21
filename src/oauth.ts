/**
 * Meta OAuth 2.0 authorization code flow.
 *
 * Clients authorize via a link you send them on WhatsApp.
 * Their token is stored per WhatsApp JID in store/tokens.json.
 */

const GRAPH = 'https://graph.facebook.com/v25.0'
const SCOPES = 'ads_management,ads_read,business_management'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

/**
 * Generates the Meta OAuth URL to send to the client.
 * The `state` encodes their WhatsApp JID so the callback knows who to credit.
 */
export function buildAuthUrl(jid: string): string {
  const appId = requireEnv('META_APP_ID')
  const callbackUrl = requireEnv('CALLBACK_BASE_URL')
  const redirectUri = `${callbackUrl}/auth/meta/callback`

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state: Buffer.from(jid).toString('base64'),
  })

  return `https://www.facebook.com/v25.0/dialog/oauth?${params}`
}

/**
 * Exchanges an OAuth code for a long-lived token (60 days).
 * Always call server-side — never expose app secret to clients.
 */
export async function exchangeCodeForToken(code: string): Promise<{ accessToken: string; expiresIn: number }> {
  const appId = requireEnv('META_APP_ID')
  const appSecret = requireEnv('META_APP_SECRET')
  const callbackUrl = requireEnv('CALLBACK_BASE_URL')
  const redirectUri = `${callbackUrl}/auth/meta/callback`

  // Step 1: short-lived token
  const shortRes = await fetch(
    `${GRAPH}/oauth/access_token?` +
      new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }),
  )
  const shortData = (await shortRes.json()) as { access_token?: string; error?: { message: string } }
  if (!shortData.access_token) throw new Error(`Meta token exchange failed: ${shortData.error?.message}`)

  // Step 2: exchange for long-lived token (~60 days)
  const longRes = await fetch(
    `${GRAPH}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortData.access_token,
      }),
  )
  const longData = (await longRes.json()) as { access_token?: string; expires_in?: number; error?: { message: string } }
  if (!longData.access_token) throw new Error(`Meta long-lived token exchange failed: ${longData.error?.message}`)

  return { accessToken: longData.access_token, expiresIn: longData.expires_in ?? 0 }
}

/** Decodes the state param back to a WhatsApp JID. */
export function decodeState(state: string): string {
  return Buffer.from(state, 'base64').toString('utf-8')
}
