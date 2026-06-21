import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const STORE_DIR = './store'
const STORE_PATH = './store/tokens.json'

interface TokenRecord {
  accessToken: string
  expiresAt: number // unix ms — 0 means never
  refreshedAt: number
}

type TokenMap = Record<string, TokenRecord>

async function read(): Promise<TokenMap> {
  if (!existsSync(STORE_PATH)) return {}
  const raw = await readFile(STORE_PATH, 'utf-8')
  return JSON.parse(raw) as TokenMap
}

async function write(map: TokenMap): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true })
  await writeFile(STORE_PATH, JSON.stringify(map, null, 2))
}

export async function saveToken(jid: string, accessToken: string, expiresIn: number): Promise<void> {
  const map = await read()
  map[jid] = {
    accessToken,
    expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
    refreshedAt: Date.now(),
  }
  await write(map)
}

export async function getToken(jid: string): Promise<string | null> {
  const map = await read()
  const record = map[jid]
  if (!record) return null
  // treat as expired if within 24h of expiry (so we can refresh proactively)
  if (record.expiresAt > 0 && record.expiresAt - Date.now() < 24 * 60 * 60 * 1000) return null
  return record.accessToken
}

export async function deleteToken(jid: string): Promise<void> {
  const map = await read()
  delete map[jid]
  await write(map)
}
