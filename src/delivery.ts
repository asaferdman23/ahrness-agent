/**
 * Shared "run the agent and deliver its output over WhatsApp" path.
 *
 * Used by the inbound message handler (whatsapp.ts) and by the scheduler runner,
 * so a scheduled job produces exactly the same kind of reply + media a live
 * message would.
 *
 * This path is memory-aware: it loads the client's session transcript, seeds the
 * agent with a compacted working view, runs with failover, and persists the new
 * turn — but only after a successful run. See
 * docs/superpowers/specs/2026-06-22-agent-memory-layer-design.md.
 */
import type { WASocket } from '@whiskeysockets/baileys'
import {
  buildClientAgent,
  createSummarizer,
  AGENT_MODEL,
  clientIdFromJid,
  type ClientAgentSession,
} from './agent.js'
import {
  sessionStore,
  runQueue,
  sessionKeyFor,
  SESSION_CHANNEL,
  compactIfNeeded,
  PostCompactionGuardError,
  runWithFailover,
  toSeedMessages,
  extractTurnMessages,
} from './sessions/index.js'

export interface DeliverOptions {
  /** Runs after the agent is built but before invocation — e.g. to write an attachment. */
  prepare?: (session: ClientAgentSession) => Promise<void>
}

const FALLBACK_MODEL = process.env.AGENT_FALLBACK_MODEL ?? null

/**
 * Build the client's agent (seeded with prior conversation), invoke it with
 * `prompt`, persist the turn, and send the text reply plus any published outputs
 * to `jid`. Throws on failure so callers can handle it.
 */
export async function runAndDeliver(
  socket: WASocket,
  jid: string,
  prompt: string,
  opts: DeliverOptions = {},
): Promise<void> {
  const clientId = clientIdFromJid(jid)
  const key = sessionKeyFor(clientId)
  const store = sessionStore()
  const summarize = createSummarizer()

  store.ensureSession(key, { clientId, channel: SESSION_CHANNEL, model: AGENT_MODEL })

  // Serialize per client so two rapid messages can't interleave-corrupt the log.
  await runQueue().enqueue(key, async () => {
    // Pre-emptive compaction. A guard error means the summary+tail alone are over
    // budget — proceed anyway; the seed is capped and failover will not loop.
    await compactQuietly(key, summarize)

    let delivered: ClientAgentSession | null = null

    const { result, seededMessageCount } = await runWithFailover({
      model: AGENT_MODEL,
      fallbackModel: FALLBACK_MODEL,
      getWorkingContext: () => store.getWorkingContext(key),
      forceCompact: () => compactQuietly(key, summarize, 0),
      buildAndInvoke: async (ctx, model) => {
        const session = await buildClientAgent(jid, toSeedMessages(ctx), model)
        if (opts.prepare) await opts.prepare(session)
        const invokeResult = await session.agent.invoke(prompt)
        delivered = session
        return { result: invokeResult, seededMessageCount: session.seededMessageCount }
      },
    })

    // Persist the turn — only now that the run has succeeded.
    store.appendTurn(key, extractTurnMessages(result, { prompt, priorMessageCount: seededMessageCount }))

    const session = delivered!
    const reply =
      result.lastMessage.content
        .filter((b) => b.type === 'textBlock')
        .map((b: any) => b.text as string)
        .join('') || '(no response)'

    await socket.sendMessage(jid, { text: reply })

    for (const output of session.publishedOutputs) {
      const bytes = await session.readOutput(output)
      const content = Buffer.from(bytes)
      if (output.mimeType.startsWith('image/')) {
        await socket.sendMessage(jid, { image: content, mimetype: output.mimeType, caption: output.caption })
      } else if (output.mimeType.startsWith('video/')) {
        await socket.sendMessage(jid, { video: content, mimetype: output.mimeType, caption: output.caption })
      } else if (output.mimeType.startsWith('audio/')) {
        await socket.sendMessage(jid, { audio: content, mimetype: output.mimeType })
      } else {
        await socket.sendMessage(jid, {
          document: content,
          mimetype: output.mimeType,
          fileName: output.fileName,
          ...(output.caption ? { caption: output.caption } : {}),
        })
      }
    }
  })
}

/** Compact if needed, swallowing the post-compaction guard (caller proceeds). */
async function compactQuietly(
  key: string,
  summarize: ReturnType<typeof createSummarizer>,
  fraction?: number,
): Promise<void> {
  try {
    await compactIfNeeded({ store: sessionStore(), key, model: AGENT_MODEL, summarize, fraction })
  } catch (e) {
    if (!(e instanceof PostCompactionGuardError)) throw e
  }
}
