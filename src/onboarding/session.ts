import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { OnboardingSession } from '../store/types.js'
import { adoptClientData, clientIdFromJid, updateClientMeta } from '../store/client-store.js'
import { linkWhatsAppToTenant } from '../tenant-store.js'
import type { WhatsAppProvider } from '../whatsapp-providers.js'

function sessionsDir(): string {
  return path.resolve(process.env.AGENT_STORE_DIR ?? './store', 'sessions')
}

async function sessionPath(sessionId: string): Promise<string> {
  const dir = sessionsDir()
  await mkdir(dir, { recursive: true })
  return path.join(dir, `${sessionId}.json`)
}

export async function createSession(): Promise<OnboardingSession> {
  const now = new Date().toISOString()
  const session: OnboardingSession = {
    sessionId: randomUUID(),
    step: 1,
    connections: {},
    whatsappLinked: false,
    createdAt: now,
    updatedAt: now,
  }
  await saveSession(session)
  return session
}

export async function loadSession(sessionId: string): Promise<OnboardingSession | null> {
  try {
    const file = await sessionPath(sessionId)
    return JSON.parse(await readFile(file, 'utf-8')) as OnboardingSession
  } catch {
    return null
  }
}

export async function saveSession(session: OnboardingSession): Promise<void> {
  session.updatedAt = new Date().toISOString()
  const file = await sessionPath(session.sessionId)
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(session, null, 2), { mode: 0o600 })
  await rename(tmp, file)
}

export async function ensureWhatsAppConnectCode(session: OnboardingSession): Promise<string> {
  if (session.whatsappConnectCode) return session.whatsappConnectCode
  session.whatsappConnectCode = randomBytes(4).toString('hex').toUpperCase()
  await saveSession(session)
  return session.whatsappConnectCode
}

export async function bindSessionToWhatsAppCode(
  code: string,
  jid: string,
  provider: WhatsAppProvider,
): Promise<OnboardingSession | null> {
  const wanted = code.trim().toUpperCase()
  if (!wanted) return null

  const dir = sessionsDir()
  await mkdir(dir, { recursive: true })
  const files = await readdir(dir)
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const session = await loadSession(file.slice(0, -'.json'.length))
    if (!session || session.whatsappConnectCode !== wanted) continue

    const oldClientId = session.clientId ?? session.sessionId
    const legacyClientId = clientIdFromJid(jid)
    const hasAuthenticatedTenant = Boolean(session.clientId && session.clientId !== session.sessionId && session.clientId !== legacyClientId)
    const clientId = hasAuthenticatedTenant ? oldClientId : await adoptClientData(oldClientId, jid)
    session.clientId = clientId
    session.whatsappJid = jid
    session.whatsappProvider = provider
    session.whatsappConnectCode = undefined
    session.whatsappLinked = true
    session.step = Math.max(session.step, 6)
    await saveSession(session)
    await updateClientMeta(clientId, { whatsappProvider: provider })
    if (hasAuthenticatedTenant) {
      await linkWhatsAppToTenant(clientId, jid, provider).catch(() => {})
    }
    return session
  }
  return null
}

export async function getOrCreateSession(sessionId?: string): Promise<OnboardingSession> {
  if (sessionId) {
    const existing = await loadSession(sessionId)
    if (existing) return existing
  }
  return createSession()
}
