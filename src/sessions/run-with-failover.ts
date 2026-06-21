/**
 * Failover wrapper around an agent invocation.
 *
 * Each attempt rebuilds the working context from the store (immutable attempt
 * state — a mid-chain failure never corrupts persisted data, because the store
 * is only appended to on success, by the caller, after this returns).
 */
import type { WorkingContext } from './types.js'

export type FailoverClass = 'context_overflow' | 'rate_limit' | 'model_unavailable' | 'auth' | 'unknown'

const DEFAULT_MAX_RATE_LIMIT_RETRIES = 3

/** Classify an error to decide the recovery action. */
export function classifyError(error: unknown): FailoverClass {
  const e = error as { failoverClass?: FailoverClass; status?: number; message?: string }
  if (e?.failoverClass) return e.failoverClass

  const status = e?.status
  if (status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'auth'
  if (status === 500 || status === 502 || status === 503 || status === 504) return 'model_unavailable'

  const msg = (e?.message ?? '').toLowerCase()
  if (msg.includes('context') && (msg.includes('exceed') || msg.includes('too long') || msg.includes('maximum'))) {
    return 'context_overflow'
  }
  return 'unknown'
}

/** Default exponential backoff: 250ms, 500ms, 1s, … */
function defaultBackoff(attempt: number): Promise<void> {
  return new Promise((r) => setTimeout(r, 250 * 2 ** attempt))
}

export interface FailoverDeps<T> {
  /** Build the (context-seeded) agent for `model` and invoke it. */
  buildAndInvoke: (ctx: WorkingContext, model: string | null) => Promise<T>
  /** Read the current working context fresh (called once per attempt). */
  getWorkingContext: () => WorkingContext
  /** Compact the session in place (advances the summary pointer). */
  forceCompact: () => Promise<void>
  model: string | null
  fallbackModel?: string | null
  maxRateLimitRetries?: number
  /** Injectable for tests; defaults to real exponential backoff. */
  backoff?: (attempt: number) => Promise<void>
  classify?: (error: unknown) => FailoverClass
}

export async function runWithFailover<T>(deps: FailoverDeps<T>): Promise<T> {
  const classify = deps.classify ?? classifyError
  const backoff = deps.backoff ?? defaultBackoff
  const maxRateLimitRetries = deps.maxRateLimitRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES

  let model = deps.model
  let rateLimitRetries = 0
  let compacted = false
  let switchedModel = false

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ctx = deps.getWorkingContext()
    try {
      return await deps.buildAndInvoke(ctx, model)
    } catch (error) {
      switch (classify(error)) {
        case 'context_overflow':
          if (compacted) throw error
          compacted = true
          await deps.forceCompact()
          continue
        case 'rate_limit':
          if (rateLimitRetries >= maxRateLimitRetries) throw error
          await backoff(rateLimitRetries)
          rateLimitRetries++
          continue
        case 'model_unavailable':
          if (switchedModel || !deps.fallbackModel) throw error
          switchedModel = true
          model = deps.fallbackModel
          continue
        default:
          throw error // auth + unknown: surface immediately
      }
    }
  }
}
