/**
 * Tenant DB operations — JID ↔ tenantId mapping.
 *
 * tenantId = user.id from better-auth (UUID).
 * When a user signs in with Google and links their WhatsApp, their JID is
 * stored in the tenant table so incoming messages can be routed to the right
 * account.
 *
 * For WhatsApp senders who haven't signed up yet, we fall back to the old
 * sha256(jid) hash so the system degrades gracefully instead of breaking.
 */
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from './db/index.js'
import { tenant } from './db/schema.js'

/** Legacy hash for senders not yet linked to a Google account. */
function jidHash(jid: string): string {
  return createHash('sha256').update(jid).digest('hex')
}

/**
 * Resolve a WhatsApp JID to its tenant's clientId.
 * Returns the tenantId (UUID) if the JID is linked, otherwise falls back to
 * sha256(jid) so pre-auth behaviour is preserved.
 */
export async function clientIdForJid(jid: string): Promise<string> {
  try {
    const row = await db.select({ userId: tenant.userId }).from(tenant).where(eq(tenant.whatsappJid, jid)).get()
    if (row) return row.userId
  } catch {
    // DB not ready yet (e.g. during tests) — fall through to hash
  }
  return jidHash(jid)
}

/** Write (or update) the JID → tenantId link after WhatsApp linking in onboarding. */
export async function linkWhatsAppToTenant(
  tenantId: string,
  jid: string,
  provider: string,
): Promise<void> {
  const now = new Date()
  await db
    .insert(tenant)
    .values({ userId: tenantId, whatsappJid: jid, whatsappProvider: provider, createdAt: now })
    .onConflictDoUpdate({
      target: tenant.userId,
      set: { whatsappJid: jid, whatsappProvider: provider },
    })
}

/** Ensure a tenant row exists for a signed-in user (called after Google login). */
export async function ensureTenant(tenantId: string): Promise<void> {
  await db
    .insert(tenant)
    .values({ userId: tenantId, createdAt: new Date() })
    .onConflictDoNothing()
}

/** Return the tenantId for a JID if it is linked, null otherwise. */
export async function tenantIdForJid(jid: string): Promise<string | null> {
  try {
    const row = await db.select({ userId: tenant.userId }).from(tenant).where(eq(tenant.whatsappJid, jid)).get()
    return row?.userId ?? null
  } catch {
    return null
  }
}
