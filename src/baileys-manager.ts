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
   * Force a fresh QR for a client. Baileys only emits a QR on initial connect,
   * so if the socket is already running (but not yet linked) we restart it to
   * trigger a new QR. If it's already linked, the caller should send a
   * `linked` event instead. Idempotent + safe if no socket exists yet.
   */
  async refreshQr(clientId: string, opts: EnsureSocketOptions = {}): Promise<BaileysSession> {
    const existing = this.sessions.get(clientId)
    if (!existing) {
      // No socket yet — starting one will emit the first QR.
      return this.ensureSocket(clientId, opts)
    }
    // Stop and restart so Baileys emits a fresh QR for the new SSE client.
    existing.stop()
    this.sessions.delete(clientId)
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
    // Resolve the phone number: explicit override > env. (Per-client phone
    // numbers are passed via onboarding opts, not stored on the profile.)
    const phoneNumber = opts.phoneNumber ?? process.env.WHATSAPP_PHONE_NUMBER

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
        // Logged out / max reconnect attempts — drop the session. Operator
        // must delete the auth dir and re-link to recover.
        this.sessions.delete(id)
      },
    })
  }
}

/** Process-wide singleton. */
let _manager: BaileysSessionManager | null = null

export function baileysSessionManager(): BaileysSessionManager {
  return (_manager ??= new BaileysSessionManager())
}
