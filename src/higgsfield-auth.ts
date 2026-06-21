import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

export const HIGGSFIELD_MCP_URL = process.env.HIGGSFIELD_MCP_URL ?? 'https://mcp.higgsfield.ai/mcp'
const STORE_PATH = path.resolve(process.env.HIGGSFIELD_AUTH_STORE ?? './store/higgsfield-oauth.json')
let storeQueue: Promise<void> = Promise.resolve()

type OAuthStore = {
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  codeVerifier?: string
  state?: string
  authorizationUrl?: string
}

async function readStore(): Promise<OAuthStore> {
  try {
    return JSON.parse(await readFile(STORE_PATH, 'utf8')) as OAuthStore
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

async function writeStore(store: OAuthStore): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true })
  const temporary = `${STORE_PATH}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(store, null, 2), { mode: 0o600 })
  await rename(temporary, STORE_PATH)
}

async function updateStore(update: (current: OAuthStore) => OAuthStore): Promise<void> {
  const operation = storeQueue.then(async () => writeStore(update(await readStore())))
  storeQueue = operation.catch(() => {})
  await operation
}

function callbackUrl(): string {
  const base = process.env.CALLBACK_BASE_URL?.replace(/\/$/, '')
  if (!base) throw new Error('CALLBACK_BASE_URL is required for Higgsfield OAuth')
  return `${base}/auth/higgsfield/callback`
}

class HiggsfieldOAuthProvider implements OAuthClientProvider {
  get redirectUrl(): string {
    return callbackUrl()
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: process.env.AGENT_NAME ?? 'Ahrness',
      scope: 'openid email offline_access',
    }
  }

  async state(): Promise<string> {
    const state = randomBytes(32).toString('base64url')
    await updateStore((current) => ({ ...current, state }))
    return state
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await readStore()).clientInformation
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await updateStore((current) => ({ ...current, clientInformation }))
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await readStore()).tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await updateStore((current) => ({
      ...current,
      tokens,
      codeVerifier: undefined,
      state: undefined,
      authorizationUrl: undefined,
    }))
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await updateStore((current) => ({ ...current, authorizationUrl: authorizationUrl.toString() }))
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await updateStore((current) => ({ ...current, codeVerifier }))
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await readStore()).codeVerifier
    if (!verifier) throw new Error('Higgsfield OAuth code verifier is missing')
    return verifier
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    await updateStore((current) => {
      if (scope === 'all') return {}
      if (scope === 'client') return { ...current, clientInformation: undefined }
      if (scope === 'tokens') return { ...current, tokens: undefined }
      if (scope === 'verifier') return { ...current, codeVerifier: undefined, state: undefined }
      return current
    })
  }
}

const provider = new HiggsfieldOAuthProvider()

export function getHiggsfieldOAuthProvider(): OAuthClientProvider {
  return provider
}

export async function startHiggsfieldAuthorization(): Promise<string | null> {
  const result = await auth(provider, {
    serverUrl: HIGGSFIELD_MCP_URL,
    scope: 'openid email offline_access',
  })
  if (result === 'AUTHORIZED') return null
  const authorizationUrl = (await readStore()).authorizationUrl
  if (!authorizationUrl) throw new Error('Higgsfield did not provide an authorization URL')
  return authorizationUrl
}

export async function completeHiggsfieldAuthorization(code: string, returnedState: string): Promise<void> {
  const expectedState = (await readStore()).state
  if (!expectedState || !safeEqual(expectedState, returnedState)) {
    throw new Error('Invalid Higgsfield OAuth state')
  }
  await auth(provider, {
    serverUrl: HIGGSFIELD_MCP_URL,
    authorizationCode: code,
    scope: 'openid email offline_access',
  })
}

export async function isHiggsfieldAuthorized(): Promise<boolean> {
  return Boolean((await readStore()).tokens?.access_token || process.env.HIGGSFIELD_MCP_ACCESS_TOKEN)
}

export function verifyHiggsfieldSetupSecret(candidate: string | null): boolean {
  const expected = process.env.HIGGSFIELD_SETUP_SECRET
  if (!expected || !candidate) return false
  return safeEqual(expected, candidate)
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
