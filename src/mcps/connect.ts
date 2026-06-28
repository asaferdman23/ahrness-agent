/**
 * Deferred, justified OAuth — the agent asks to connect an app only when a task
 * needs the live account, returning a one-tap signed deep link instead of forcing
 * every connection up front. This is the TTFV move: value first, integration only
 * when it pays off.
 */
import { tool } from '@strands-agents/sdk'
import { onboardingUrlFor } from '../onboarding/client-link.js'
import type { PlatformId } from '../store/types.js'

const LABELS: Record<string, string> = {
  'meta-ads': 'Meta Ads',
  'instagram-graph': 'Instagram',
  tiktok: 'TikTok',
  google: 'Google Analytics & Search Console',
  higgsfield: 'Higgsfield',
}

function label(platform: string): string {
  return LABELS[platform] ?? platform
}

/** Pure logic for the connect tool — easy to test without the SDK. */
export function buildConnectResponse(
  jid: string,
  allowed: PlatformId[],
  platform: string,
  base: string | undefined,
): string {
  if (!allowed.includes(platform as PlatformId)) {
    throw new Error(
      `${label(platform)} is not available for this role. Connectable apps: ${allowed.map(label).join(', ') || 'none'}.`,
    )
  }
  if (!base) {
    return `To connect ${label(platform)}, you'll need the setup link from your admin (no public URL is configured).`
  }
  const link = onboardingUrlFor(base, jid, platform)
  return `To connect ${label(platform)}, tap this link (about 30 seconds): ${link}`
}

export function createConnectTools(jid: string, allowed: PlatformId[]): Array<ReturnType<typeof tool>> {
  return [
    tool({
      name: 'request_app_connection',
      description:
        'Returns a one-tap link the client can use to connect one of their apps. Call this only when ' +
        'a task genuinely needs live access to that account — work from the conversation first.',
      inputSchema: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            description: `Which app to connect. One of: ${allowed.join(', ') || '(none available)'}`,
          },
        },
        required: ['platform'],
        additionalProperties: false,
      },
      callback: async (rawInput) => {
        const input = (rawInput ?? {}) as { platform?: unknown }
        if (typeof input.platform !== 'string') throw new Error('platform must be a string')
        return buildConnectResponse(jid, allowed, input.platform, process.env.CALLBACK_BASE_URL)
      },
    }),
  ]
}
