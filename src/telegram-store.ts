/**
 * Per-client Telegram bot connection storage.
 *
 * Each client brings their own bot (a BotFather token). The token is
 * encrypted at rest via the vault, the same as OAuth tokens in
 * connections.json. Once the bot receives its first inbound message we bind
 * it to that chat (ownerChatId) so it behaves like a personal assistant —
 * locked to its owner, mirroring the Baileys "home group" binding.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { decryptSecret, encryptSecret, isEncrypted } from './vault.js'

export interface TelegramConnection {
  botToken: string
  botUsername?: string
  ownerChatId?: string
  connectedAt: string
}

interface StoredTelegramConnection {
  botTokenEncrypted: string
  botUsername?: string
  ownerChatId?: string
  connectedAt: string
}

function storeRoot(): string {
  return process.env.AGENT_STORE_DIR ?? './store'
}

function clientsDir(): string {
  return path.resolve(storeRoot(), 'clients')
}

function connectionPath(clientId: string): string {
  return path.join(clientsDir(), clientId, 'telegram.json')
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

/** Save (or rotate) a client's Telegram bot token, encrypted at rest. */
export async function saveTelegramBotToken(
  clientId: string,
  botToken: string,
  botUsername?: string,
): Promise<void> {
  const existing = await readJson<StoredTelegramConnection>(connectionPath(clientId))
  const record: StoredTelegramConnection = {
    botTokenEncrypted: encryptSecret(botToken),
    botUsername: botUsername ?? existing?.botUsername,
    ownerChatId: existing?.ownerChatId,
    connectedAt: existing?.connectedAt ?? new Date().toISOString(),
  }
  await atomicWrite(connectionPath(clientId), record)
}

/** Bind the bot to the chat that first messaged it (personal-assistant lockdown). First writer wins. */
export async function bindTelegramOwnerChat(clientId: string, chatId: string): Promise<void> {
  const existing = await readJson<StoredTelegramConnection>(connectionPath(clientId))
  if (!existing || existing.ownerChatId) return
  await atomicWrite(connectionPath(clientId), { ...existing, ownerChatId: chatId })
}

/** Read + decrypt a client's Telegram connection, or null if not connected. */
export async function getTelegramConnection(clientId: string): Promise<TelegramConnection | null> {
  const record = await readJson<StoredTelegramConnection>(connectionPath(clientId))
  if (!record) return null
  return {
    botToken: isEncrypted(record.botTokenEncrypted)
      ? decryptSecret(record.botTokenEncrypted)
      : record.botTokenEncrypted,
    botUsername: record.botUsername,
    ownerChatId: record.ownerChatId,
    connectedAt: record.connectedAt,
  }
}

/** Remove a client's Telegram connection (disconnect). */
export async function removeTelegramConnection(clientId: string): Promise<void> {
  await rm(connectionPath(clientId), { force: true })
}

/** clientIds with a stored bot token — used to start bots for all connected clients at boot. */
export async function listConnectedTelegramClients(): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(clientsDir())
  } catch {
    return []
  }
  const connected: string[] = []
  for (const clientId of entries) {
    const record = await readJson<StoredTelegramConnection>(connectionPath(clientId))
    if (record?.botTokenEncrypted) connected.push(clientId)
  }
  return connected
}
