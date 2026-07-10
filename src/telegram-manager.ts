/**
 * TelegramSessionManager — registry of per-client Telegram bot pollers.
 *
 * Mirrors BaileysSessionManager: each client's bot runs independently, keyed
 * by clientId, so one client's polling errors don't affect another's.
 */
import { getTelegramConnection } from './telegram-store.js'
import { startTelegramBot, type TelegramSession } from './telegram.js'

export class TelegramSessionManager {
  private sessions = new Map<string, TelegramSession>()
  private starting = new Map<string, Promise<TelegramSession | null>>()

  /** Ensure a client's bot is polling. Idempotent; returns null if the client has no stored token. */
  async ensureBot(clientId: string): Promise<TelegramSession | null> {
    const existing = this.sessions.get(clientId)
    if (existing) return existing

    const inFlight = this.starting.get(clientId)
    if (inFlight) return inFlight

    const promise = this.startClient(clientId)
    this.starting.set(clientId, promise)
    try {
      const session = await promise
      if (session) this.sessions.set(clientId, session)
      return session
    } finally {
      this.starting.delete(clientId)
    }
  }

  /** Get the active session for a client, or null if not running. */
  get(clientId: string): TelegramSession | null {
    return this.sessions.get(clientId) ?? null
  }

  /** Stop a single client's bot and remove it from the registry. */
  stop(clientId: string): void {
    const session = this.sessions.get(clientId)
    if (session) {
      session.stop()
      this.sessions.delete(clientId)
    }
  }

  /** Stop all bots — used on process shutdown. */
  stopAll(): void {
    for (const [, session] of this.sessions) {
      try {
        session.stop()
      } catch {
        // best-effort
      }
    }
    this.sessions.clear()
  }

  private async startClient(clientId: string): Promise<TelegramSession | null> {
    const connection = await getTelegramConnection(clientId)
    if (!connection) return null
    try {
      return await startTelegramBot(clientId, connection)
    } catch (err) {
      console.error(`[telegram][client ${clientId}] failed to start bot:`, err instanceof Error ? err.message : err)
      return null
    }
  }
}

/** Process-wide singleton. */
let _manager: TelegramSessionManager | null = null

export function telegramSessionManager(): TelegramSessionManager {
  return (_manager ??= new TelegramSessionManager())
}
