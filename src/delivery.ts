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
import { decodeClientChannelAddress } from './channel-address.js'
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
import { openDb, createSqliteStore, previewText, withRunRecording, type Store } from '@agent-live/sdk'
import path from 'node:path'
import type { WhatsAppTransport } from './whatsapp-transport.js'

export interface DeliverOptions {
  /** Runs after the agent is built but before invocation — e.g. to write an attachment. */
  prepare?: (session: ClientAgentSession) => Promise<void>
  /** Set only by the scheduler runner — reports as its own channel regardless of the underlying jid/address. */
  channel?: 'scheduler'
}

const CONTENT_ENABLED = process.env.AGENT_ACTIVITY_CONTENT_ENABLED === 'true'
const PREVIEW_MAX_CHARS = Number.parseInt(process.env.AGENT_ACTIVITY_PREVIEW_MAX_CHARS ?? '300', 10)

const FALLBACK_MODEL = process.env.AGENT_FALLBACK_MODEL ?? null

// Anti-ban: throttle consecutive sends to the same JID. WhatsApp's spam
// detector flags bursts of messages from unofficial clients (especially
// multiple media messages in <1s). Override via BAILEYS_SEND_GAP_MS.
const SEND_GAP_MS = Number.parseInt(process.env.BAILEYS_SEND_GAP_MS ?? '1000', 10)
const SEND_GAP = Number.isFinite(SEND_GAP_MS) && SEND_GAP_MS > 0 ? SEND_GAP_MS : 1000

const AGENT_LIVE_DB_PATH = process.env.AGENT_LIVE_DB ?? path.join(process.env.AGENT_STORE_DIR ?? './store', 'agent-live.sqlite')
let _agentLiveStore: Store | null = null
function agentLiveStore(): Store {
  return (_agentLiveStore ??= createSqliteStore(openDb(AGENT_LIVE_DB_PATH)))
}

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

  const channel = opts.channel ?? decodeClientChannelAddress(jid)?.channel ?? 'whatsapp'

  await withRunRecording(agentLiveStore(), { tenantId: clientId, sessionKey: key, channel, model: AGENT_MODEL }, async (recorder) => {
    recorder.emit('run.received', 'Message received')
    recorder.emit('run.queued', 'Queued for processing')

    await runQueue().enqueue(key, async () => {
      // Approve-before-act: a "YES" reply approves a staged action; "NO" cancels it.
      const confirmStore = fileConfirmationStore()
      const decision = await resolvePendingApproval({ store: confirmStore, clientId, text: prompt })
      if (decision?.decision === 'cancelled') {
        recorder.emit('approval.cancelled', 'Pending action cancelled')
        await transport.sendText(jid, decision.reply)
        return
      }
      if (decision?.decision === 'approved') {
        recorder.emit('approval.approved', 'Pending action approved')
      }
      const effectivePrompt = decision?.decision === 'approved' ? `${decision.nudge}\n\n${prompt}` : prompt

      recorder.emit('context.loading', 'Loading business profile and memory')
      await compactQuietly(key, summarize)
      recorder.emit('context.loaded', 'Context ready')

      let delivered: ClientAgentSession | null = null

      const { result, seededMessageCount } = await runWithFailover({
        model: AGENT_MODEL,
        fallbackModel: FALLBACK_MODEL,
        getWorkingContext: () => store.getWorkingContext(key),
        forceCompact: () => compactQuietly(key, summarize, 0),
        buildAndInvoke: async (ctx, model) => {
          const session = await buildClientAgent(jid, toSeedMessages(ctx), model, {
            runId: recorder.runId,
            tenantId: recorder.tenantId,
            store: agentLiveStore(),
          })
          if (opts.prepare) await opts.prepare(session)
          const invokeResult = await session.agent.invoke(effectivePrompt)
          delivered = session
          return { result: invokeResult, seededMessageCount: session.seededMessageCount }
        },
      })

      const session = delivered!
      const usage = result.metrics?.accumulatedUsage

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
      const extras: { inputTokens?: number | null; outputTokens?: number | null; outputPreview?: string | null } = {
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
      }
      if (CONTENT_ENABLED) extras.outputPreview = previewText(reply, PREVIEW_MAX_CHARS)
      recorder.attachCompletionExtras(extras)
      if (reply.startsWith('⚠️ This needs your OK')) recorder.emit('approval.waiting', 'Waiting for approval')

      recorder.emit('delivery.started', 'Sending reply')
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
        recorder.emit('output.published', `Published output: ${output.fileName}`, { fileName: output.fileName, mimeType: output.mimeType })
      }
      recorder.emit('delivery.completed', 'Delivery succeeded')
    })
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
