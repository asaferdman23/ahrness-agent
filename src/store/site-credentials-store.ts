/**
 * Encrypted per-client, per-domain site login credentials — the vault a client
 * fills in on the /connect-site web form, never via chat. The password is
 * encrypted at rest through the same AES-256-GCM primitive (src/vault.ts)
 * already protecting OAuth tokens and CRM PII.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { decryptSecret, encryptSecret } from '../vault.js'

export interface SiteCredential {
  domain: string
  username: string
  connectedAt: string
}

interface StoredSiteCredential extends SiteCredential {
  encryptedPassword: string
}

type SiteCredentialsFile = Record<string, StoredSiteCredential>

function clientsDir(): string {
  return path.resolve(process.env.AGENT_STORE_DIR ?? './store', 'clients')
}

function filePathFor(clientId: string): string {
  return path.join(clientsDir(), clientId, 'site-credentials.json')
}

async function readAll(clientId: string): Promise<SiteCredentialsFile> {
  try {
    return JSON.parse(await readFile(filePathFor(clientId), 'utf-8')) as SiteCredentialsFile
  } catch {
    return {}
  }
}

async function writeAll(clientId: string, data: SiteCredentialsFile): Promise<void> {
  const filePath = filePathFor(clientId)
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  await rename(tmp, filePath)
}

/** Domain-only lookup: username + connectedAt, never the password. */
export async function getSiteCredential(clientId: string, domain: string): Promise<SiteCredential | null> {
  const all = await readAll(clientId)
  const stored = all[domain]
  if (!stored) return null
  return { domain: stored.domain, username: stored.username, connectedAt: stored.connectedAt }
}

/** The one caller (browser_login) that needs the actual password, to type it into a page. */
export async function getSiteCredentialSecret(clientId: string, domain: string): Promise<string | null> {
  const all = await readAll(clientId)
  const stored = all[domain]
  if (!stored) return null
  return decryptSecret(stored.encryptedPassword)
}

/** Called only from the /connect-site web form handler — never from agent/chat code. */
export async function saveSiteCredential(
  clientId: string,
  domain: string,
  username: string,
  password: string,
): Promise<void> {
  const all = await readAll(clientId)
  all[domain] = {
    domain,
    username,
    encryptedPassword: encryptSecret(password),
    connectedAt: new Date().toISOString(),
  }
  await writeAll(clientId, all)
}
