import { Agent, tool } from '@strands-agents/sdk'
import { AnthropicModel } from '@strands-agents/sdk/models/anthropic'
import { AgentSkills } from '@strands-agents/sdk/vended-plugins/skills'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getProfile,
  getRole as getClientRole,
  getConnections,
  migrateLegacyToken,
  clientIdFromJid,
} from './store/client-store.js'
import { getRole as getRoleDefinition } from './roles/index.js'
import { getMcp } from './mcps/index.js'
import { createInstagramTools } from './mcps/instagram-graph.js'
import { createTikTokTools } from './mcps/tiktok.js'
import { createGoogleTools } from './mcps/google.js'
import { limitHiggsfieldTools } from './higgsfield-usage.js'
import {
  createImportRemoteOutputTool,
  createPublishOutputTool,
  readPublishedOutput,
  type PublishedOutput,
} from './outputs.js'
import { createShareInputTool } from './input-sharing.js'
import { createSchedulerTools, materializeTemplates } from './scheduler/index.js'
import { getClientSandbox } from './sandbox.js'
import { BusinessContextPlugin } from './plugins/business-context-plugin.js'
import { createHiggsFieldMcpClient } from './mcp.js'
import type { PlatformId } from './store/types.js'
import type { TurnMessage, Summarize } from './sessions/index.js'

/** Model id used for the client agent and for context-window budgeting. */
export const AGENT_MODEL = process.env.AGENT_MODEL ?? 'claude-opus-4-8'

/**
 * Build a direct-Anthropic model provider. The Strands `Agent` treats a bare
 * string model id as a Bedrock model, so we construct an explicit AnthropicModel
 * to route through the Anthropic API (uses ANTHROPIC_API_KEY).
 */
export function createModel(modelId: string = AGENT_MODEL): AnthropicModel {
  return new AnthropicModel({
    apiKey: process.env.ANTHROPIC_API_KEY,
    modelId,
    maxTokens: Number(process.env.AGENT_MAX_TOKENS ?? 16384),
  })
}

export { clientIdFromJid }

const SKILLS_DIR = resolve(fileURLToPath(import.meta.url), '../../skills')

// Platforms served by REST tool wrappers — no official MCP server exists
const NATIVE_TOOL_PLATFORMS = new Set<PlatformId>(['instagram-graph', 'tiktok', 'google'])

// ── Higgsfield shared session ─────────────────────────────────────────────────

let higgsfield: ReturnType<typeof createHiggsFieldMcpClient> | null = null

export async function getHiggsfield(): Promise<ReturnType<typeof createHiggsFieldMcpClient>> {
  if (higgsfield?.connectionState === 'connected') return higgsfield
  const candidate = createHiggsFieldMcpClient()
  await candidate.connect(true)
  higgsfield = candidate
  return candidate
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(agentName: string, roleAddition: string): string {
  return `You are ${agentName}, a powerful AI assistant available on WhatsApp.

${roleAddition}

Sandbox rules:
- Incoming WhatsApp attachments are saved under /workspace/inbox and their exact paths are included in the user message.
- Before using an attachment with a remote Higgsfield tool, call share_input_with_higgsfield and pass its returned URL to Higgsfield.
- Work only inside /workspace. Put final client-facing files in /workspace/outputs.
- Call publish_output once for every completed file that should be sent to the client.
- For a completed Higgsfield result URL, call deliver_higgsfield_output to download and send it through WhatsApp.
- Never claim a file was delivered unless publish_output or deliver_higgsfield_output succeeded.

Automations:
- When the client asks to be reminded, to get a recurring report, or to run something on a cadence ("every morning", "each Monday", "in 2 hours"), use schedule_task. Translate their phrasing into a cron expression (recurring) or an ISO timestamp (one-time), and confirm what you set in their own words.
- Use list_scheduled_tasks / cancel_scheduled_task / set_scheduled_task_enabled to review, stop, or pause automations on request.
- When a scheduled task fires, you receive its instruction as a normal message — just do it and reply concisely.

Respond naturally and helpfully. Keep replies concise for WhatsApp — short paragraphs, no walls of text.`
}

// ── Public API ────────────────────────────────────────────────────────────────

export type ClientAgentSession = {
  agent: Agent
  /** Model id this agent runs on (for token budgeting / compaction). */
  model: string
  /** Count of messages the agent was seeded with (the memory prefix). */
  seededMessageCount: number
  publishedOutputs: PublishedOutput[]
  readOutput(output: PublishedOutput): Promise<Uint8Array>
  writeInput(path: string, content: Uint8Array): Promise<void>
}

/**
 * Build an Agent for a client identified by their WhatsApp JID.
 * Reads the client's stored profile, role, and platform connections to
 * compose a fully personalised agent with the right tools, skills, and prompt.
 */
export async function buildClientAgent(
  jid: string,
  seedMessages: TurnMessage[] = [],
  modelOverride?: string | null,
): Promise<ClientAgentSession> {
  const model = modelOverride ?? AGENT_MODEL
  const clientId = clientIdFromJid(jid)

  // Migrate legacy token store on first call
  await migrateLegacyToken(jid, clientId)

  const profile = await getProfile(clientId)
  const roleRecord = await getClientRole(clientId)
  const connections = await getConnections(clientId)

  const agentName = process.env.AGENT_NAME ?? 'Ahrness'
  const roleId = roleRecord?.roleId ?? 'personal-assistant-dev'
  const roleDef = getRoleDefinition(roleId)

  // Turn any onboarding-selected automation templates into live scheduled jobs.
  // Idempotent and best-effort — a failure here must never block the agent.
  if (roleRecord?.scheduleTemplates?.length) {
    try {
      await materializeTemplates(clientId, jid, roleRecord.scheduleTemplates)
    } catch (err) {
      console.warn('[scheduler] template materialization failed:', err instanceof Error ? err.message : err)
    }
  }

  // Which platforms to actually load (connected + not overridden)
  const disabledMcps = new Set(roleRecord?.mcpOverrides?.disabled ?? [])
  const extraMcps = (roleRecord?.mcpOverrides?.extra ?? []) as PlatformId[]
  const platformsToLoad = [
    ...roleDef.requiredMcps,
    ...roleDef.optionalMcps,
    ...extraMcps,
  ].filter((p) => {
    if (disabledMcps.has(p)) return false
    const conn = connections[p]
    return conn?.status === 'connected' && conn.accessToken
  })

  const { sandbox } = await getClientSandbox(clientId)
  const publishedOutputs: PublishedOutput[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTools: any[] = []
  let higgsfieldAvailable = false

  // ── MCP-backed and native tools ───────────────────────────────────────────

  for (const platformId of platformsToLoad) {
    const conn = connections[platformId]!

    if (NATIVE_TOOL_PLATFORMS.has(platformId)) {
      if (platformId === 'instagram-graph') allTools.push(...createInstagramTools(conn))
      if (platformId === 'tiktok') allTools.push(...createTikTokTools(conn))
      if (platformId === 'google') allTools.push(...createGoogleTools(conn))
      continue
    }

    const mcpDef = getMcp(platformId)
    const client = mcpDef.createClient(conn)
    if (!client) continue

    try {
      await client.connect()
      const mcpTools = await client.listTools()
      if (platformId === 'higgsfield') {
        allTools.push(...limitHiggsfieldTools(clientId, mcpTools))
        higgsfieldAvailable = true
      } else {
        allTools.push(...mcpTools)
      }
    } catch (err) {
      console.warn(`[${platformId}] MCP connection failed:`, err instanceof Error ? err.message : err)
    }
  }

  // ── Built-in tools ────────────────────────────────────────────────────────

  allTools.push(
    createPublishOutputTool(sandbox, publishedOutputs),
    createImportRemoteOutputTool(sandbox, publishedOutputs),
    createShareInputTool(clientId),
    ...createSchedulerTools(clientId, jid),
    tool({
      name: 'get_business_context',
      description:
        "Returns the client's full business profile including all saved internet assets, goals, and brand info. Call this when you need specific details not visible in the system prompt.",
      inputSchema: { type: 'object', properties: {}, required: [] },
      callback: async (_input: unknown) =>
        JSON.stringify(profile ?? { error: 'No business profile found. Ask the client to complete onboarding.' }),
    }),
  )

  // ── Skills ────────────────────────────────────────────────────────────────

  const disabledSkills = new Set(roleRecord?.skillOverrides?.disabled ?? [])
  const extraSkills = roleRecord?.skillOverrides?.extra ?? []
  const skillPaths = [...roleDef.skills, ...extraSkills]
    .filter((s) => !disabledSkills.has(s))
    .map((name) => resolve(SKILLS_DIR, name))

  const skillsPlugin = new AgentSkills({ skills: skillPaths })

  // ── Plugins ───────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugins: any[] = [skillsPlugin]
  if (profile) plugins.push(new BusinessContextPlugin(profile))

  // ── System prompt ─────────────────────────────────────────────────────────

  let roleAddition = roleDef.systemPromptAddition
  if (!higgsfieldAvailable && roleAddition.toLowerCase().includes('higgsfield')) {
    roleAddition +=
      '\n\nNote: Higgsfield generation is currently unavailable. Explain this plainly if the client requests generated media.'
  }
  if (!profile) {
    roleAddition +=
      '\n\nNote: This client has not completed onboarding yet. Invite them to complete setup at their onboarding link to unlock full personalisation.'
  }

  // ── Agent ─────────────────────────────────────────────────────────────────

  // NOTE: `messages` + `model` seeding is the documented Strands shape but is
  // unverified in this environment (SDK symlink unresolved). Confirm via the
  // spike in docs/superpowers/specs/2026-06-22-agent-memory-layer-design.md.
  const agent = new Agent({
    systemPrompt: buildSystemPrompt(agentName, roleAddition),
    sandbox,
    tools: allTools,
    plugins,
    model: createModel(model),
    ...(seedMessages.length > 0 ? { messages: seedMessages } : {}),
  } as ConstructorParameters<typeof Agent>[0])

  return {
    agent,
    model,
    seededMessageCount: seedMessages.length,
    publishedOutputs,
    readOutput: (output) => readPublishedOutput(sandbox, output),
    writeInput: (path, content) => sandbox.writeFile(path, content),
  }
}

/**
 * A compaction summarizer backed by a lightweight one-shot agent invocation.
 * SDK-gated and unverified pending the spike.
 */
export function createSummarizer(): Summarize {
  return async ({ previousSummary, messages }) => {
    const transcript = messages
      .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n')
    const prompt =
      (previousSummary ? `Existing summary so far:\n${previousSummary}\n\n` : '') +
      'Summarize the conversation below, preserving key facts, decisions, client ' +
      'preferences, and any open tasks. Be concise (under 200 words):\n\n' +
      transcript

    const agent = new Agent({
      systemPrompt: 'You are a precise conversation summarizer for a marketing assistant.',
      model: createModel(),
    } as ConstructorParameters<typeof Agent>[0])
    const result = await agent.invoke(prompt)
    return (
      result.lastMessage.content
        .filter((b: any) => b.type === 'textBlock')
        .map((b: any) => b.text as string)
        .join('') || (previousSummary ?? '')
    )
  }
}
