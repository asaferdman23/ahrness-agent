import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { OnboardingSession } from '../store/types.js'

const SESSIONS_DIR = path.resolve('./store/sessions')

async function sessionPath(sessionId: string): Promise<string> {
  await mkdir(SESSIONS_DIR, { recursive: true })
  return path.join(SESSIONS_DIR, `${sessionId}.json`)
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

export async function getOrCreateSession(sessionId?: string): Promise<OnboardingSession> {
  if (sessionId) {
    const existing = await loadSession(sessionId)
    if (existing) return existing
  }
  return createSession()
}
