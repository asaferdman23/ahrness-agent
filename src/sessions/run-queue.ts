/**
 * Per-session serial run queue.
 *
 * Guarantees only one agent run executes per session key at a time, so two
 * rapid inbound messages from the same client can't interleave-corrupt the
 * transcript. Different keys run concurrently. Per-process — matches the
 * single persistent gateway process deployment model.
 */
export interface RunQueue {
  enqueue<T>(key: string, fn: () => Promise<T>): Promise<T>
}

export function createRunQueue(): RunQueue {
  /** Tail of the promise chain per key. Resolves when that key is idle. */
  const tails = new Map<string, Promise<unknown>>()

  function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = tails.get(key) ?? Promise.resolve()
    // Chain after the prior task regardless of whether it resolved or rejected,
    // so one failure doesn't wedge the key.
    const run = prior.then(fn, fn)
    // Keep the chain alive but swallow results/errors on the stored tail; the
    // caller's returned promise still surfaces them.
    tails.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }

  return { enqueue }
}
