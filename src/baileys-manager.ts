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
import { broadcastLoggedOut, broadcastLoggedOutToAll } from './onboarding/server.js'

export type EnsureSocketOptions = {
  /** Onboarding session id to route QR/pairing broadcasts to. */
  onboardingSessionId?: string
  /** Override the phone number for pairing-code flow. */
  phoneNumber?: string
}

export class BaileysSessionManager {
  private sessions = new Map<string, BaileysSession>()
  private starting = new Map<string, Promise<BaileysSession>>()

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

  /** True if a socket is currently active (open or connecting) for the client. */
  has(clientId: string): boolean {
    return this.sessions.has(clientId) || this.starting.has(clientId)
  }

  /** Stop a single client's socket and remove it from the registry. */
  stop(clientId: string): void {
    const session = this.sessions.get(clientId)
    if (session) {
      session.stop()
      this.sessions.delete(clientId)
    }
  }

  /**
   * Disconnect a client's WhatsApp: log out the linked device server-side
   * (so it disappears from the user's phone), stop the socket, and clear the
   * connection state. The auth dir on disk is left in place — the user can
   * re-link later, which overwrites it.
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

  /** True if the client's socket is open (linked). */
  isConnected(clientId: string): boolean {
    // Baileys exposes socket.user only after connection.open. We treat the
    // presence of a linked auth state + open socket as connected; the caller
    // also has linkedSessions on the onboarding side for the SSE flow.
    return this.sessions.has(clientId) && this._connected.has(clientId)
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
  }

  private async startClient(
    clientId: string,
    opts: EnsureSocketOptions,
  ): Promise<BaileysSession> {
    // Only use pairing-code mode when a phone number is explicitly provided.
    // The onboarding QR screen expects a scannable QR, and falling back to a
    // global env phone number can block QR emission entirely.
    const phoneNumber = opts.phoneNumber

    return startBaileysWhatsApp(clientId, {
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
        } else {
          broadcastLoggedOutToAll()
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
