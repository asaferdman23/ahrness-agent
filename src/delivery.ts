/**
 * Shared "run the agent and deliver its output over WhatsApp" path.
 *
 * Used by the inbound message handler (whatsapp.ts / twilio-whatsapp.ts) and by
 * the scheduler runner, so a scheduled job produces exactly the same kind of
 * reply + media a live message would.
 */
import {
  buildClientAgent,
  createSummarizer,
  AGENT_MODEL,
  type ClientAgentSession,
} from './agent.js'
import { clientIdForJid } from './tenant-store.js'
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
import { fileConfirmationStore, resolvePendingApproval } from './confirmations.js'
import type { WhatsAppTransport } from './whatsapp-transport.js'

export interface DeliverOptions {
  /** Runs after the agent is built but before invocation — e.g. to write an attachment. */
  prepare?: (session: ClientAgentSession) => Promise<void>
}

const FALLBACK_MODEL = process.env.AGENT_FALLBACK_MODEL ?? null

// Anti-ban: throttle consecutive sends to the same JID. WhatsApp's spam
// detector flags bursts of messages from unofficial clients (especially
// multiple media messages in <1s). Override via BAILEYS_SEND_GAP_MS.
const SEND_GAP_MS = Number.parseInt(process.env.BAILEYS_SEND_GAP_MS ?? '1000', 10)
const SEND_GAP = Number.isFinite(SEND_GAP_MS) && SEND_GAP_MS > 0 ? SEND_GAP_MS : 1000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Build the client's agent (seeded with prior conversation), invoke it with
 * `prompt`, persist the turn, and send the text reply plus any published outputs
 * to `jid`. Throws on failure so callers can handle it.
 */
export async function runAndDeliver(
  transport: WhatsAppTransport,
  jid: string,
  prompt: string,
  opts: DeliverOptions = {},
): Promise<void> {
  const clientId = await clientIdForJid(jid)
  const key = sessionKeyFor(clientId)
  const store = sessionStore()
  const summarize = createSummarizer()

  store.ensureSession(key, { clientId, channel: SESSION_CHANNEL, model: AGENT_MODEL })

  await runQueue().enqueue(key, async () => {
    // Approve-before-act: a "YES" reply approves a staged action; "NO" cancels it.
    const confirmStore = fileConfirmationStore()
    const decision = await resolvePendingApproval({ store: confirmStore, clientId, text: prompt })
    if (decision?.decision === 'cancelled') {
      await transport.sendText(jid, decision.reply)
      return
    }
    const effectivePrompt = decision?.decision === 'approved' ? `${decision.nudge}\n\n${prompt}` : prompt

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
        const invokeResult = await session.agent.invoke(effectivePrompt)
        delivered = session
        return { result: invokeResult, seededMessageCount: session.seededMessageCount }
      },
    })

    const session = delivered!

    store.appendTurn(
      key,
      extractTurnMessages(
        { messages: (session.agent as { messages?: unknown[] }).messages, lastMessage: result.lastMessage },
        { prompt: effectivePrompt, priorMessageCount: seededMessageCount },
      ),
    )

    const reply =
      result.lastMessage.content
        .filter((b) => b.type === 'textBlock')
        .map((b: any) => b.text as string)
        .join('') || '(no response)'

    await transport.sendText(jid, reply)

    for (const output of session.publishedOutputs) {
      // Anti-ban: space out consecutive sends so we don't fire a burst of
      // media messages in <1s, which trips WhatsApp's automation heuristics.
      await sleep(SEND_GAP)
      const bytes = Buffer.from(await session.readOutput(output))
      if (output.mimeType.startsWith('image/')) {
        await transport.sendImage(jid, bytes, output.mimeType, output.caption)
      } else if (output.mimeType.startsWith('video/')) {
        await transport.sendVideo(jid, bytes, output.mimeType, output.caption)
      } else if (output.mimeType.startsWith('audio/')) {
        await transport.sendAudio(jid, bytes, output.mimeType)
      } else {
        await transport.sendDocument(jid, bytes, output.mimeType, output.fileName, output.caption)
      }
    }
  })
}

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
