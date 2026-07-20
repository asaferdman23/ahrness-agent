/**
 * Per-client Slack workspace install storage.
 *
 * Multi-tenant: each client installs the app into their own Slack workspace
 * (OAuth v2), so there's a global team_id -> clientId index (mirrors
 * telegram-store.ts's shared-chat index) plus the encrypted bot token per
 * client.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { updateClientMeta } from './store/client-store.js'
import { decryptSecret, encryptSecret, isEncrypted } from './vault.js'

export interface SlackConnection {
  botToken: string
  teamId: string
  teamName?: string
  installerUserId: string
  /** The bot's own Slack user id (`U…`), used to detect `@mentions` in channels. */
  botUserId: string
  connectedAt: string
}

interface StoredSlackConnection {
  botTokenEncrypted: string
  teamId: string
  teamName?: string
  installerUserId: string
  botUserId: string
  connectedAt: string
}

function storeRoot(): string {
  return process.env.AGENT_STORE_DIR ?? './store'
}

function clientsDir(): string {
  return path.resolve(storeRoot(), 'clients')
}

function connectionPath(clientId: string): string {
  return path.join(clientsDir(), clientId, 'slack.json')
}

function teamIndexPath(): string {
  return path.resolve(storeRoot(), 'slack-team-index.json')
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

async function atomicWrite(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  await rename(tmp, filePath)
}

type TeamIndex = Record<string, string> // teamId -> clientId

/** Save a client's Slack install (from the OAuth v2 code exchange), encrypted at rest. */
export async function saveSlackConnection(
  clientId: string,
  install: { botToken: string; teamId: string; teamName?: string; installerUserId: string; botUserId: string },
): Promise<void> {
  const record: StoredSlackConnection = {
    botTokenEncrypted: encryptSecret(install.botToken),
    teamId: install.teamId,
    teamName: install.teamName,
    installerUserId: install.installerUserId,
    botUserId: install.botUserId,
    connectedAt: new Date().toISOString(),
  }
  await atomicWrite(connectionPath(clientId), record)

  const index = (await readJson<TeamIndex>(teamIndexPath())) ?? {}
  index[install.teamId] = clientId
  await atomicWrite(teamIndexPath(), index)

  await updateClientMeta(clientId, { slackTeamId: install.teamId, slackConnectedAt: record.connectedAt })
}

/** Read + decrypt a client's Slack connection, or null if not connected. */
export async function getSlackConnection(clientId: string): Promise<SlackConnection | null> {
  const record = await readJson<StoredSlackConnection>(connectionPath(clientId))
  if (!record) return null
  return {
    botToken: isEncrypted(record.botTokenEncrypted) ? decryptSecret(record.botTokenEncrypted) : record.botTokenEncrypted,
    teamId: record.teamId,
    teamName: record.teamName,
    installerUserId: record.installerUserId,
    botUserId: record.botUserId,
    connectedAt: record.connectedAt,
  }
}

/** Resolve an inbound Slack event's team_id back to the clientId that installed the app there. */
export async function clientIdForSlackTeam(teamId: string): Promise<string | null> {
  const index = (await readJson<TeamIndex>(teamIndexPath())) ?? {}
  return index[teamId] ?? null
}

/** Remove a client's Slack connection (uninstall/disconnect). */
export async function removeSlackConnection(clientId: string): Promise<void> {
  await rm(connectionPath(clientId), { force: true })
}

/** clientIds with a stored Slack connection. */
export async function listConnectedSlackClients(): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(clientsDir())
  } catch {
    return []
  }
  const connected: string[] = []
  for (const clientId of entries) {
    const record = await readJson<StoredSlackConnection>(connectionPath(clientId))
    if (record?.botTokenEncrypted) connected.push(clientId)
  }
  return connected
}
