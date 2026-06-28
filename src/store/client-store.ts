import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ClientMeta, ClientProfile, ConnectionRecord, ConnectionsRecord, PlatformId, RoleRecord } from './types.js'
import { decryptSecret, encryptSecret, isEncrypted } from '../vault.js'

function storeRoot(): string {
  return process.env.AGENT_STORE_DIR ?? './store'
}
function clientsDir(): string {
  return path.resolve(storeRoot(), 'clients')
}
function legacyTokensPath(): string {
  return path.resolve(storeRoot(), 'tokens.json')
}

export function clientIdFromJid(jid: string): string {
  return createHash('sha256').update(jid).digest('hex')
}

// ── Atomic file helpers ───────────────────────────────────────────────────────

async function clientDir(clientId: string): Promise<string> {
  const dir = path.join(clientsDir(), clientId)
  await mkdir(dir, { recursive: true })
  return dir
}

async function atomicWrite(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  await rename(tmp, filePath)
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

// ── Profile ───────────────────────────────────────────────────────────────────

export async function saveProfile(profile: ClientProfile): Promise<void> {
  const dir = await clientDir(profile.clientId)
  await atomicWrite(path.join(dir, 'profile.json'), profile)
}

export async function getProfile(clientId: string): Promise<ClientProfile | null> {
  return readJson<ClientProfile>(path.join(clientsDir(), clientId, 'profile.json'))
}

// ── Role ──────────────────────────────────────────────────────────────────────

export async function saveRole(clientId: string, role: RoleRecord): Promise<void> {
  const dir = await clientDir(clientId)
  await atomicWrite(path.join(dir, 'role.json'), role)
}

export async function getRole(clientId: string): Promise<RoleRecord | null> {
  return readJson<RoleRecord>(path.join(clientsDir(), clientId, 'role.json'))
}

// ── Client meta (small runtime flags) ──────────────────────────────────────────

export async function getClientMeta(clientId: string): Promise<ClientMeta> {
  return (await readJson<ClientMeta>(path.join(clientsDir(), clientId, 'meta.json'))) ?? {}
}

export async function updateClientMeta(clientId: string, patch: Partial<ClientMeta>): Promise<void> {
  const dir = await clientDir(clientId)
  const filePath = path.join(dir, 'meta.json')
  const existing = (await readJson<ClientMeta>(filePath)) ?? {}
  await atomicWrite(filePath, { ...existing, ...patch })
}

export async function adoptClientData(fromClientId: string, jid: string): Promise<string> {
  const toClientId = clientIdFromJid(jid)
  if (fromClientId === toClientId) return toClientId

  const profile = await getProfile(fromClientId)
  if (profile) {
    await saveProfile({ ...profile, clientId: toClientId, whatsappJid: jid })
  }

  const role = await getRole(fromClientId)
  if (role) await saveRole(toClientId, role)

  const connections = await getConnections(fromClientId)
  for (const [platformId, rec] of Object.entries(connections)) {
    if (rec) await upsertConnection(toClientId, platformId as PlatformId, rec)
  }

  const meta = await getClientMeta(fromClientId)
  if (Object.keys(meta).length) await updateClientMeta(toClientId, meta)

  return toClientId
}

// ── Connections (tokens encrypted at rest via the vault) ───────────────────────

/** Encrypt token fields that aren't already vault blobs. */
function encryptConnection(rec: ConnectionRecord): ConnectionRecord {
  const out = { ...rec }
  if (out.accessToken && !isEncrypted(out.accessToken)) out.accessToken = encryptSecret(out.accessToken)
  if (out.refreshToken && !isEncrypted(out.refreshToken)) out.refreshToken = encryptSecret(out.refreshToken)
  return out
}

/** Decrypt token fields. Returns whether any field was legacy plaintext. */
function decryptConnection(rec: ConnectionRecord): { record: ConnectionRecord; hadPlaintext: boolean } {
  const out = { ...rec }
  let hadPlaintext = false
  if (out.accessToken) {
    if (isEncrypted(out.accessToken)) out.accessToken = decryptSecret(out.accessToken)
    else hadPlaintext = true
  }
  if (out.refreshToken) {
    if (isEncrypted(out.refreshToken)) out.refreshToken = decryptSecret(out.refreshToken)
    else hadPlaintext = true
  }
  return { record: out, hadPlaintext }
}

export async function getConnections(clientId: string): Promise<ConnectionsRecord> {
  const filePath = path.join(clientsDir(), clientId, 'connections.json')
  const stored = (await readJson<ConnectionsRecord>(filePath)) ?? {}
  const result: ConnectionsRecord = {}
  let needsMigration = false
  for (const [platformId, rec] of Object.entries(stored)) {
    if (!rec) continue
    const { record, hadPlaintext } = decryptConnection(rec)
    result[platformId as PlatformId] = record
    if (hadPlaintext) needsMigration = true
  }
  // One-time migration: re-write any legacy plaintext file as encrypted blobs.
  if (needsMigration) {
    const reEncrypted: ConnectionsRecord = {}
    for (const [platformId, rec] of Object.entries(result)) {
      if (rec) reEncrypted[platformId as PlatformId] = encryptConnection(rec)
    }
    await atomicWrite(filePath, reEncrypted)
  }
  return result
}

export async function upsertConnection(
  clientId: string,
  platformId: PlatformId,
  data: Partial<ConnectionRecord>,
): Promise<void> {
  const dir = await clientDir(clientId)
  const filePath = path.join(dir, 'connections.json')
  const existing = (await readJson<ConnectionsRecord>(filePath)) ?? {}
  const merged = { ...(existing[platformId] ?? {}), ...data } as ConnectionRecord
  existing[platformId] = encryptConnection(merged)
  await atomicWrite(filePath, existing)
}

// ── Legacy migration ──────────────────────────────────────────────────────────

interface LegacyTokenRecord {
  accessToken: string
  expiresAt: number
  refreshedAt: number
}

/**
 * One-time migration: if `store/tokens.json` has an entry for this JID,
 * move it into the per-client connections.json as a meta-ads connection
 * and remove it from the legacy store.
 */
export async function migrateLegacyToken(jid: string, clientId: string): Promise<void> {
  const legacyPath = legacyTokensPath()
  let legacy: Record<string, LegacyTokenRecord>
  try {
    legacy = JSON.parse(await readFile(legacyPath, 'utf-8')) as Record<string, LegacyTokenRecord>
  } catch {
    return // no legacy store — nothing to migrate
  }

  const record = legacy[jid]
  if (!record?.accessToken) return

  // Only migrate if meta-ads connection isn't already saved
  const connections = await getConnections(clientId)
  if (connections['meta-ads']?.status === 'connected') return

  await upsertConnection(clientId, 'meta-ads', {
    status: 'connected',
    accessToken: record.accessToken,
    tokenExpiresAt: record.expiresAt > 0 ? new Date(record.expiresAt).toISOString() : null,
    connectedAt: new Date(record.refreshedAt).toISOString(),
  })

  delete legacy[jid]
  const tmp = `${legacyPath}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(legacy, null, 2), { mode: 0o600 })
  await rename(tmp, legacyPath)
}
