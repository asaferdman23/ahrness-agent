import { createHash } from 'node:crypto'
import { Agent } from '@strands-agents/sdk'
import { createModel } from '../agent.js'
import type { ClientProfile, OnboardingPreview, OnboardingSession } from '../store/types.js'

const PREVIEW_TIMEOUT_MS = 20_000
const PREVIEW_ATTEMPT_LIMIT = 3
const PREVIEW_WINDOW_MS = 60 * 60 * 1000

export function profileFingerprint(profile: ClientProfile): string {
  return createHash('sha256').update(JSON.stringify({
    name: profile.business.name,
    description: profile.business.description ?? '',
    targetAudience: profile.business.targetAudience ?? '',
    website: profile.assets.website ?? '',
  })).digest('hex')
}

export function currentPreview(session: OnboardingSession): OnboardingPreview | null {
  if (!session.profile || !session.preview || !session.previewProfileFingerprint) return null
  return session.previewProfileFingerprint === profileFingerprint(session.profile) ? session.preview : null
}

export function registerPreviewAttempt(session: OnboardingSession, now = new Date()): void {
  const cutoff = now.getTime() - PREVIEW_WINDOW_MS
  const recent = (session.previewAttempts ?? []).filter((value) => {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) && timestamp > cutoff
  })
  if (recent.length >= PREVIEW_ATTEMPT_LIMIT) {
    throw new Error('Preview limit reached. You can continue setting up your agent now or try again later.')
  }
  session.previewAttempts = [...recent, now.toISOString()]
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  return cleaned.slice(0, maxLength)
}

export function parsePreviewJson(raw: string, generatedAt = new Date().toISOString()): OnboardingPreview | null {
  const candidate = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(candidate) as Record<string, unknown>
  } catch {
    return null
  }
  const headline = cleanText(parsed.headline, 90)
  const insight = cleanText(parsed.insight, 240)
  const suggestedFirstBrief = cleanText(parsed.suggestedFirstBrief, 360)
  const opportunities = Array.isArray(parsed.opportunities)
    ? parsed.opportunities.map((value) => cleanText(value, 180)).filter((value): value is string => Boolean(value))
    : []
  if (!headline || !insight || !suggestedFirstBrief || opportunities.length !== 3) return null
  return {
    headline,
    insight,
    opportunities: [opportunities[0]!, opportunities[1]!, opportunities[2]!],
    suggestedFirstBrief,
    generatedAt,
    source: 'ai',
  }
}

export function fallbackPreview(profile: ClientProfile, generatedAt = new Date().toISOString()): OnboardingPreview {
  const name = profile.business.name
  const audience = profile.business.targetAudience?.trim() || 'your best-fit customers'
  return {
    headline: `A focused starting plan for ${name}`,
    insight: `${name} can create momentum by turning its clearest customer outcome into a consistent message and repeatable campaign rhythm.`,
    opportunities: [
      `Clarify the one result ${audience} should immediately associate with ${name}.`,
      'Turn that promise into one campaign idea that can work across your strongest channel.',
      'Review responses and conversion signals weekly, then double down on the message that earns action.',
    ],
    suggestedFirstBrief: `Create a practical 30-day marketing plan for ${name}. Start from our business description, identify the strongest positioning angle, and give me the first three actions to take this week.`,
    generatedAt,
    source: 'fallback',
  }
}

function previewPrompt(profile: ClientProfile): string {
  return `Create a concise first-value marketing preview for this business.

Business name: ${profile.business.name}
Business description: ${profile.business.description ?? 'Not provided'}
Target audience: ${profile.business.targetAudience ?? 'Not provided'}
Website reference: ${profile.assets.website ?? 'Not provided; do not imply it was visited'}

Return ONLY valid JSON with this exact shape:
{"headline":"...","insight":"...","opportunities":["...","...","..."],"suggestedFirstBrief":"..."}

Be specific to the provided information, practical, concise, and honest. Do not claim to have visited the website or accessed live account data.`
}

export async function generatePreview(profile: ClientProfile): Promise<OnboardingPreview> {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackPreview(profile)
  try {
    const agent = new Agent({
      systemPrompt: 'You are Bizzclaw, a precise marketing strategist creating a safe onboarding preview. Use no tools.',
      model: createModel(process.env.ONBOARDING_PREVIEW_MODEL),
    } as ConstructorParameters<typeof Agent>[0])
    const result = await Promise.race([
      agent.invoke(previewPrompt(profile)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Preview timed out')), PREVIEW_TIMEOUT_MS)),
    ])
    const raw = result.lastMessage.content
      .filter((block) => block.type === 'textBlock')
      .map((block: any) => block.text as string)
      .join('')
    return parsePreviewJson(raw) ?? fallbackPreview(profile)
  } catch {
    return fallbackPreview(profile)
  }
}
