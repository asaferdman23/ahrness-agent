/**
 * Context compaction: replace old turns with a rolling summary so a long-running
 * session never overflows the model window.
 *
 * Invariant: only the *view* is compressed. The `messages` table (source of
 * truth) is never modified — compaction merely advances the summary pointer.
 */
import { shouldCompact } from './tokens.js'
import type { SessionStore } from './store.js'
import type { StoredMessage } from './types.js'

const DEFAULT_KEEP_RECENT_TURNS = 8

/** Input handed to the injected summarizer (which performs the LLM call). */
export interface SummarizeInput {
  previousSummary: string | null
  messages: StoredMessage[]
}

export type Summarize = (input: SummarizeInput) => Promise<string>

export interface CompactOptions {
  store: SessionStore
  key: string
  model: string | null
  summarize: Summarize
  /** Fraction of the context window at which to compact (default 0.7). */
  fraction?: number
  /** Number of most-recent turns to keep verbatim (default 8). */
  keepRecentTurns?: number
}

export interface CompactResult {
  compacted: boolean
}

/**
 * Thrown when the working context is over budget but there is nothing left to
 * fold (the summary + retained tail alone exceed the threshold). Prevents an
 * infinite summarize-of-summary loop. Callers should hard-trim and surface a
 * warning instead of retrying.
 */
export class PostCompactionGuardError extends Error {
  constructor(key: string) {
    super(`Compaction cannot make progress for session ${key}: summary + retained tail exceed the budget`)
    this.name = 'PostCompactionGuardError'
  }
}

/**
 * Compact the session if its working context exceeds the budget. Returns
 * `{ compacted: false }` if no compaction was needed.
 */
export async function compactIfNeeded(opts: CompactOptions): Promise<CompactResult> {
  const { store, key, model, summarize } = opts
  const keepRecentTurns = opts.keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS

  const ctx = store.getWorkingContext(key)
  if (!shouldCompact(ctx.estimatedTokens, model, opts.fraction)) {
    return { compacted: false }
  }

  const foldable = ctx.messages.slice(0, Math.max(0, ctx.messages.length - keepRecentTurns))
  if (foldable.length === 0) {
    throw new PostCompactionGuardError(key)
  }

  const summary = await summarize({ previousSummary: ctx.summary, messages: foldable })
  const throughSeq = foldable[foldable.length - 1].seq
  store.saveCompaction(key, { summary, throughSeq })
  return { compacted: true }
}
