/**
 * Adapter between the SDK-agnostic session store and the Strands Agent.
 *
 * These functions are pure and SDK-free so they can be unit-tested. They encode
 * our assumptions about the Strands message shape; if the spike reveals a
 * different shape, this is the only file that changes.
 *
 *   - `toSeedMessages`   : working context  → messages to seed a new Agent with
 *   - `extractTurnMessages`: an invoke result → the new messages to persist
 */
import type { Role, StoredMessage, TurnMessage, WorkingContext } from './types.js'

const DEFAULT_MAX_SEED_MESSAGES = 40

/** A provider-agnostic message: `{ role, content }`. */
interface RawMessage {
  role: Role
  content: unknown
}

export interface ExtractContext {
  prompt: string
  /** Number of messages the agent was seeded with (the prefix to skip). */
  priorMessageCount: number
}

/**
 * Extract the messages produced this turn. Prefers the full transcript on
 * `result.messages` (slicing off the seeded prefix); falls back to a
 * user-prompt + assistant-text pair when only `lastMessage` is available.
 */
export function extractTurnMessages(result: unknown, ctx: ExtractContext): TurnMessage[] {
  const r = result as { messages?: RawMessage[]; lastMessage?: { content?: unknown } }

  if (Array.isArray(r?.messages) && r.messages.length >= ctx.priorMessageCount) {
    const fresh = r.messages.slice(ctx.priorMessageCount)
    if (fresh.length > 0) {
      return fresh.map((m) => ({ role: m.role, content: m.content }))
    }
  }

  // Fallback: minimal but real memory (loses tool-call replay fidelity).
  return [
    { role: 'user', content: ctx.prompt },
    { role: 'assistant', content: r?.lastMessage?.content ?? '' },
  ]
}

export interface SeedOptions {
  /** Cap on verbatim messages seeded (most recent kept). Default 40. */
  maxSeedMessages?: number
}

/**
 * Build the seed messages for a new Agent from a working context: an optional
 * leading summary note, then the most-recent verbatim messages (capped).
 */
export function toSeedMessages(ctx: WorkingContext, opts: SeedOptions = {}): TurnMessage[] {
  const cap = opts.maxSeedMessages ?? DEFAULT_MAX_SEED_MESSAGES
  const recent: StoredMessage[] = ctx.messages.slice(-cap)

  const seed: TurnMessage[] = recent.map((m) => ({ role: m.role, content: m.content }))

  if (ctx.summary) {
    seed.unshift({
      role: 'user',
      content: `[Earlier conversation summary — context from before this point]\n${ctx.summary}`,
    })
  }

  return seed
}
