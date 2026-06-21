/**
 * Cheap token accounting for context-window budgeting.
 *
 * We deliberately avoid a real tokenizer dependency: a `chars / 4` heuristic is
 * good enough to decide *when* to compact, and compaction has its own safety
 * guard if the estimate drifts. Swap for a real tokenizer if drift is observed.
 */

const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_COMPACT_FRACTION = 0.7

/** Context window (in tokens) per known model. Prefixes are matched loosely. */
const CONTEXT_WINDOWS: Array<[prefix: string, window: number]> = [
  ['claude-opus-4', 200_000],
  ['claude-sonnet-4', 200_000],
  ['claude-haiku-4', 200_000],
  ['claude-', 200_000],
  ['gpt-5', 128_000],
  ['gpt-4o', 128_000],
  ['gemini-', 1_000_000],
]

/** Estimate token count for a string (~4 chars per token, rounded up). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Look up the context window for a model id, falling back to a safe default. */
export function contextWindowFor(model: string | null | undefined): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW
  for (const [prefix, window] of CONTEXT_WINDOWS) {
    if (model.startsWith(prefix)) return window
  }
  return DEFAULT_CONTEXT_WINDOW
}

/**
 * Whether a working context of `estimatedTokens` should be compacted before the
 * next call, given the model's window and an optional fraction override.
 */
export function shouldCompact(
  estimatedTokens: number,
  model: string | null | undefined,
  fraction: number = DEFAULT_COMPACT_FRACTION,
): boolean {
  return estimatedTokens > contextWindowFor(model) * fraction
}
