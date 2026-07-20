/**
 * BaileysSessionManager — registry of per-client Baileys sockets.
 *
 * Each client (identified by clientId) gets its own WhatsApp linked-device
 * socket with its own auth state at store/clients/<clientId>/auth/. This lets
 * one process serve multiple WhatsApp accounts (BYO number) without colliding.
 *
 * Lifecycle:
 * - ensureSocket(clientId) — lazily start a client's socket (idempotent).
 * - get(clientId) — fetch the active socket's transport for outbound routing.
 * - stop(clientId) — clean shutdown on logout / unlink.
 * - stopAll() — graceful shutdown on process exit.
 *
 * Reconnect is handled inside startBaileysWhatsApp via onReconnect, which calls
 * back into this manager to re-create the socket. One client's reconnect storm
 * is isolated from the others.
 */
import { startBaileysWhatsApp, type BaileysSession } from './whatsapp.js'
import { broadcastLoggedOut } from './onboarding/server.js'
import { access, readdir } from 'node:fs/promises'
import path from 'node:path'

export type EnsureSocketOptions = {
  /** Onboarding session id to route QR/pairing broadcasts to. */
  onboardingSessionId?: string
  /** Override the phone number for pairing-code flow. */
  phoneNumber?: string
}

/** A WhatsApp group the linked account participates in (for the picker UI). */
export type BaileysGroupInfo = {
  jid: string
  subject: string
  size: number
}

export type CreateBaileysGroupInput = {
  subject: string
  participantJid: string
  removeParticipantAfterCreate?: boolean
}

export type CreatedBaileysGroup = BaileysGroupInfo & {
  temporaryParticipantRemoved: boolean | null
}

/**
 * Map Baileys GroupMetadata records to picker rows, sorted by member count
 * (largest first) so the most relevant groups surface at the top. Pure and
 * exported for testing.
 */
export function toGroupInfoList(
  groups: Record<string, { id: string; subject?: string; size?: number }>,
): BaileysGroupInfo[] {
  return Object.values(groups)
    .map((g) => ({ jid: g.id, subject: g.subject ?? '', size: g.size ?? 0 }))
    .sort((a, b) => b.size - a.size)
}

/** Find persisted linked-device credentials without reading or exposing them. */
export async function discoverBaileysAuthClients(
  storeRoot = process.env.AGENT_STORE_DIR ?? './store',
): Promise<string[]> {
  const clientsRoot = path.resolve(storeRoot, 'clients')
  let entries
  try {
    entries = await readdir(clientsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const clientIds = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      try {
        await access(path.join(clientsRoot, entry.name, 'auth', 'creds.json'))
        return entry.name
      } catch {
        return null
      }
    }))
  return clientIds.filter((clientId): clientId is string => clientId !== null).sort()
}

export class BaileysSessionManager {
  private sessions = new Map<string, BaileysSession>()
  private starting = new Map<string, Promise<BaileysSession>>()

  constructor(private readonly startSession: typeof startBaileysWhatsApp = startBaileysWhatsApp) {}

  /**
   * Ensure a Baileys socket is running for the given client. Idempotent —
   * returns the existing session if one is already active.
   */
  async ensureSocket(clientId: string, opts: EnsureSocketOptions = {}): Promise<BaileysSession> {
    const existing = this.sessions.get(clientId)
    if (existing) return existing

    const inFlight = this.starting.get(clientId)
    if (inFlight) return inFlight

    const promise = this.startClient(clientId, opts)
    this.starting.set(clientId, promise)
    try {
      const session = await promise
      this.sessions.set(clientId, session)
      return session
    } finally {
      this.starting.delete(clientId)
    }
  }

  /** Get the active transport for a client, or null if not running. */
  get(clientId: string): BaileysSession | null {
    return this.sessions.get(clientId) ?? null
  }

  /**
   * List the WhatsApp groups the client's linked account participates in,
   * for the onboarding "pick your home group" step. Returns null when the
   * socket isn't linked/available right now. Sorted by member count desc.
   */
  async listGroups(clientId: string): Promise<BaileysGroupInfo[] | null> {
    const session = this.sessions.get(clientId)
    if (!session || !this._connected.has(clientId)) return null
    try {
      const groups = await session.socket.groupFetchAllParticipating()
      return toGroupInfoList(groups)
    } catch (err) {
      console.error(`[client ${clientId}] failed to fetch participating groups:`, err)
      return null
    }
  }

  /**
   * Create a WhatsApp-owned link that opens the selected home group. WhatsApp
   * does not expose a stable deep link for a raw group JID, so the invite link
   * is the only supported hand-off from the web dashboard into that group.
   * The caller must supply the tenant's persisted home-group JID; never accept
   * a browser-provided JID here.
   */
  async homeGroupUrl(clientId: string, groupJid: string): Promise<string | null> {
    const session = this.sessions.get(clientId)
    if (!session || !this._connected.has(clientId)) return null
    if (!/^\d+@g\.us$/.test(groupJid)) throw new Error('Invalid WhatsApp group')

    const groups = await this.listGroups(clientId)
    if (!groups?.some((group) => group.jid === groupJid)) {
      throw new Error('The selected WhatsApp group is no longer available')
    }

    const code = await session.socket.groupInviteCode(groupJid)
    if (!code) throw new Error('WhatsApp did not return a group link')
    return `https://chat.whatsapp.com/${encodeURIComponent(code)}`
  }

  /** Create one explicitly requested WhatsApp group for a connected tenant. */
  async createGroup(clientId: string, input: CreateBaileysGroupInput): Promise<CreatedBaileysGroup | null> {
    const session = this.sessions.get(clientId)
    if (!session || !this._connected.has(clientId)) return null
    const subject = input.subject.trim()
    if (!subject || subject.length > 100) throw new Error('Group name must be between 1 and 100 characters')
    if (!/^\d{8,15}@s\.whatsapp\.net$/.test(input.participantJid)) {
      throw new Error('Enter a valid WhatsApp phone number including country code')
    }

    const created = await session.socket.groupCreate(subject, [input.participantJid])
    if (!created.id || !/^\d+@g\.us$/.test(created.id)) {
      throw new Error('WhatsApp did not return the new group')
    }
    let temporaryParticipantRemoved: boolean | null = null
    if (input.removeParticipantAfterCreate) {
      try {
        const results = await session.socket.groupParticipantsUpdate(created.id, [input.participantJid], 'remove')
        temporaryParticipantRemoved = results.some((result) => result.status === '200')
      } catch {
        // The group exists even if participant removal fails. Return a partial
        // result so the UI can tell the owner to remove the person manually.
        temporaryParticipantRemoved = false
      }
    }
    return {
      jid: created.id,
      subject: created.subject || subject,
      size: created.size ?? 2,
      temporaryParticipantRemoved,
    }
  }

  /** True if a socket is currently active (open or connecting) for the client. */
  has(clientId: string): boolean {
    return this.sessions.has(clientId) || this.starting.has(clientId)
  }

  /** Stop a single client's socket and remove it from the registry. */
  stop(clientId: string): void {
    const session = this.sessions.get(clientId)
    this._connected.delete(clientId)
    if (session) {
      session.stop()
      this.sessions.delete(clientId)
    }
  }

  /**
   * Disconnect a client's WhatsApp: log out the linked device server-side
   * (so it disappears from the user's phone), stop the socket, and clear the
   * connection state. The socket removes local credentials so a later process
   * restart cannot reconnect a tenant who explicitly disconnected.
   */
  async disconnect(clientId: string): Promise<void> {
    const session = this.sessions.get(clientId)
    this._connected.delete(clientId)
    if (session) {
      this.sessions.delete(clientId)
      await session.logout()
    }
  }

  /**
   * Force a fresh QR for a client. Baileys only emits a QR on initial connect,
   * so if the socket is already running (but not yet linked) we restart it to
   * trigger a new QR. If it's already linked, the caller should send a
   * `linked` event instead. Idempotent + safe if no socket exists yet.
   *
   * Throttled: won't restart more than once every 10s per client, to avoid
   * amplifying a reconnect loop when the SSE reopens rapidly.
   */
  async refreshQr(clientId: string, opts: EnsureSocketOptions = {}): Promise<BaileysSession> {
    const now = Date.now()
    const last = this._lastRefresh.get(clientId) ?? 0
    if (now - last < 10_000) {
      // Throttled — return the existing session (or start one if none).
      return this.ensureSocket(clientId, opts)
    }
    this._lastRefresh.set(clientId, now)

    const existing = this.sessions.get(clientId)
    if (!existing) {
      // No socket yet — starting one will emit the first QR.
      return this.ensureSocket(clientId, opts)
    }
    // Stop and restart so Baileys emits a fresh QR for the new SSE client.
    existing.stop()
    this.sessions.delete(clientId)
    this._connected.delete(clientId)
    return this.ensureSocket(clientId, opts)
  }

  /** Switch an unlinked socket from QR mode to same-phone pairing-code mode.
   * This intentionally bypasses the QR refresh throttle: the user explicitly
   * changed linking methods, so returning the existing QR socket would never
   * produce the code they requested. The API rate-limits these calls. */
  async refreshPairingCode(clientId: string, opts: EnsureSocketOptions & { phoneNumber: string }): Promise<BaileysSession> {
    // Let an initial QR start finish before replacing it. Deleting an in-flight
    // promise would allow two sockets to race and whichever finished last
    // could overwrite the requested phone-pairing session.
    const inFlight = this.starting.get(clientId)
    if (inFlight) await inFlight
    const existing = this.sessions.get(clientId)
    if (existing) {
      existing.stop()
      this.sessions.delete(clientId)
      this._connected.delete(clientId)
    }
    return this.ensureSocket(clientId, opts)
  }

  /** True if the client's socket is open (linked). */
  isConnected(clientId: string): boolean {
    // Baileys exposes socket.user only after connection.open. We treat the
    // presence of a linked auth state + open socket as connected; the caller
    // also has linkedSessions on the onboarding side for the SSE flow.
    return this.sessions.has(clientId) && this._connected.has(clientId)
  }

  /** Restore every persisted linked account after a process restart. Failures
   * stay isolated so one revoked device cannot prevent other tenants starting. */
  async restoreSockets(): Promise<{ restored: string[]; failed: string[] }> {
    const clientIds = await discoverBaileysAuthClients()
    const outcomes = await Promise.all(clientIds.map(async (clientId) => {
      try {
        await this.ensureSocket(clientId)
        return { clientId, ok: true as const }
      } catch (err) {
        console.error(`[client ${clientId}] failed to restore Baileys session:`, err)
        return { clientId, ok: false as const }
      }
    }))
    return {
      restored: outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.clientId),
      failed: outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.clientId),
    }
  }

  /** Mark a client's socket as connected (called from connection.open). */
  markConnected(clientId: string): void {
    this._connected.add(clientId)
  }

  /** Mark a client's socket as disconnected (called from connection.close). */
  markDisconnected(clientId: string): void {
    this._connected.delete(clientId)
  }

  private _connected = new Set<string>()
  private _lastRefresh = new Map<string, number>()

  /** Stop all sockets — used on process shutdown. */
  stopAll(): void {
    for (const [, session] of this.sessions) {
      try {
        session.stop()
      } catch {
        // best-effort
      }
    }
    this.sessions.clear()
    this._connected.clear()
  }

  private async startClient(
    clientId: string,
    opts: EnsureSocketOptions,
  ): Promise<BaileysSession> {
    // Only use pairing-code mode when a phone number is explicitly provided.
    // The onboarding QR screen expects a scannable QR, and falling back to a
    // global env phone number can block QR emission entirely.
    const phoneNumber = opts.phoneNumber

    return this.startSession(clientId, {
      phoneNumber,
      onboardingSessionId: opts.onboardingSessionId,
      onConnected: (id) => this.markConnected(id),
      onDisconnected: (id) => this.markDisconnected(id),
      onReconnect: (id) => {
        // Re-create the socket on disconnect. The old session is already
        // closed; drop it and start fresh, preserving onboarding routing.
        this.sessions.delete(id)
        this.ensureSocket(id, opts).catch((err) => {
          console.error(`[client ${id}] reconnect failed:`, err)
        })
      },
      onLoggedOut: (id) => {
        // 401 loggedOut: WhatsApp invalidated the linked device (user removed
        // it from their phone). whatsapp.ts already wiped the auth dir, so the
        // creds are gone. Drop the session and tell the onboarding UI to flip
        // back to the QR screen.
        this._connected.delete(id)
        this.sessions.delete(id)
        if (opts.onboardingSessionId) {
          broadcastLoggedOut(opts.onboardingSessionId)
          // A user is on the QR screen waiting — start a fresh socket so the
          // clean auth dir makes Baileys emit a new QR, which the SSE stream
          // delivers. (With no onboarding session we stay stopped; the next
          // qr-stream/refreshQr call will start the socket on demand instead,
          // avoiding a pointless unattended connection.)
          this.ensureSocket(id, opts).catch((err) => {
            console.error(`[client ${id}] re-link socket start failed:`, err)
          })
        }
      },
      onReconnectExhausted: (id) => {
        // Ban-risk reconnect loop gave up. Keep the creds (they may still be
        // valid) and do NOT surface a fresh QR — require manual operator
        // intervention. Just drop the in-memory session so nothing spins.
        this._connected.delete(id)
        this.sessions.delete(id)
      },
      onStopCommand: (id) => {
        // Owner typed stop/עצור in the chat. Confirm and let the socket
        // logout proceed (the caller in whatsapp.ts handles the actual
        // logout). Clear our session state so reconnect doesn't fire.
        console.log(`[client ${id}] stop command received from chat — disconnecting`)
        this._connected.delete(id)
        this.sessions.delete(id)
        return true
      },
    })
  }
}

/** Process-wide singleton. */
let _manager: BaileysSessionManager | null = null

export function baileysSessionManager(): BaileysSessionManager {
  return (_manager ??= new BaileysSessionManager())
}
