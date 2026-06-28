/**
 * One-time onboarding nudge for un-onboarded senders.
 *
 * We now serve guests with the agent immediately (value before integration), but
 * we still want to invite them to finish setup — exactly once, so we don't nag on
 * every message. The "already nudged" flag lives in the client's meta record.
 */
import { getClientMeta, updateClientMeta } from './store/client-store.js'
import { onboardingUrlFor } from './onboarding/client-link.js'

/**
 * Returns a short onboarding invitation the first time it's called for a client,
 * then null on subsequent calls. Marks the client as nudged.
 */
export async function maybeOnboardingNudge(clientId: string, jid: string): Promise<string | null> {
  const meta = await getClientMeta(clientId)
  if (meta.onboardingNudgedAt) return null
  await updateClientMeta(clientId, { onboardingNudgedAt: new Date().toISOString() })

  const base = process.env.CALLBACK_BASE_URL
  const link = base ? onboardingUrlFor(base, jid) : null
  const name = process.env.AGENT_NAME ?? 'BizzClaw'
  if (!link) {
    return `By the way — ask your admin for the ${name} setup link to connect your accounts and unlock automations.`
  }
  return (
    `By the way — finish a 2-minute setup to personalise me and connect your accounts: ${link}\n` +
    `Your passwords stay encrypted (I never see them), and I'll always ask before posting or spending.`
  )
}
