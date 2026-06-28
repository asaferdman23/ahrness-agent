/**
 * Approve-before-act — human-in-the-loop confirmation for irreversible actions.
 *
 * Because the agent is rebuilt per message, approval can't live in memory. A
 * guarded tool stages a pending action (with a fingerprint of its exact args);
 * the user's "YES" on the next turn flips it to approved; when the agent re-calls
 * the same tool with the same args, the fingerprint matches and it executes.
 *
 * Safety property: execution happens ONLY when an *approved* pending action
 * matches the tool name AND the exact args fingerprint, and only before it
 * expires. Different args → re-confirm. No silent execution.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'

export const PENDING_TTL_MS = 10 * 60 * 1000

export interface PendingAction {
  id: string
  toolName: string
  argsFingerprint: string
  summary: string
  createdAt: number
  approved: boolean
}

export interface ConfirmationStore {
  get(clientId: string): Promise<PendingAction | null>
  set(clientId: string, action: PendingAction): Promise<void>
  clear(clientId: string): Promise<void>
}

/** Deterministic JSON: object keys sorted recursively, so arg order never changes the fingerprint. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
  return `{${entries.join(',')}}`
}

export function fingerprint(toolName: string, input: unknown): string {
  return createHash('sha256').update(`${toolName}\n${stableStringify(input)}`).digest('hex')
}

export function isAffirmative(text: string): boolean {
  return /^\s*(yes|yep|yeah|y|confirm|confirmed|approve|approved|ok|okay|go ahead|do it|sounds good)\b/i.test(text)
}

export function isNegative(text: string): boolean {
  return /^\s*(no|nope|nah|cancel|stop|don'?t|do not|abort)\b/i.test(text)
}

interface StageArgs {
  store: ConfirmationStore
  clientId: string
  toolName: string
  input: unknown
  summarize: (input: unknown) => string
  now?: () => number
}

const PROMPT = (summary: string) => `⚠️ This needs your OK before I do it: ${summary}. Reply YES to confirm or NO to cancel.`

/**
 * Either execute (when an approved, non-expired, matching pending action exists)
 * or stage a new pending action and return a confirmation prompt without executing.
 */
export async function stageOrExecute<T>(args: StageArgs, execute: () => Promise<T>): Promise<T | string> {
  const now = (args.now ?? Date.now)()
  const fp = fingerprint(args.toolName, args.input)
  const pending = await args.store.get(args.clientId)

  const matchesApproved =
    pending &&
    pending.approved &&
    pending.toolName === args.toolName &&
    pending.argsFingerprint === fp &&
    now - pending.createdAt <= PENDING_TTL_MS

  if (matchesApproved) {
    await args.store.clear(args.clientId)
    return execute()
  }

  const summary = args.summarize(args.input)
  await args.store.set(args.clientId, {
    id: createHash('sha256').update(`${fp}\n${now}`).digest('hex').slice(0, 12),
    toolName: args.toolName,
    argsFingerprint: fp,
    summary,
    createdAt: now,
    approved: false,
  })
  return PROMPT(summary)
}

interface ResolveArgs {
  store: ConfirmationStore
  clientId: string
  text: string
  now?: () => number
}

export type ApprovalDecision =
  | { decision: 'approved'; nudge: string }
  | { decision: 'cancelled'; reply: string }
  | null

/** Apply an inbound reply to a pending action: approve, cancel, or pass through (null). */
export async function resolvePendingApproval(args: ResolveArgs): Promise<ApprovalDecision> {
  const now = (args.now ?? Date.now)()
  const pending = await args.store.get(args.clientId)
  if (!pending) return null
  if (now - pending.createdAt > PENDING_TTL_MS) {
    await args.store.clear(args.clientId)
    return null
  }
  if (isAffirmative(args.text)) {
    await args.store.set(args.clientId, { ...pending, approved: true })
    return { decision: 'approved', nudge: 'The user approved the pending action — execute it now.' }
  }
  if (isNegative(args.text)) {
    await args.store.clear(args.clientId)
    return { decision: 'cancelled', reply: 'Okay, cancelled — I won’t do that.' }
  }
  return null
}

// ── Stores ────────────────────────────────────────────────────────────────────

/** In-memory store for tests. */
export function makeMemoryStore(): ConfirmationStore {
  const map = new Map<string, PendingAction>()
  return {
    async get(clientId) {
      return map.get(clientId) ?? null
    },
    async set(clientId, action) {
      map.set(clientId, action)
    },
    async clear(clientId) {
      map.delete(clientId)
    },
  }
}

/** Persistent store: store/clients/<id>/pending-action.json (atomic tmp+rename). */
export function fileConfirmationStore(): ConfirmationStore {
  const clientsDir = () => path.resolve(process.env.AGENT_STORE_DIR ?? './store', 'clients')
  const fileFor = (clientId: string) => path.join(clientsDir(), clientId, 'pending-action.json')
  return {
    async get(clientId) {
      try {
        return JSON.parse(await readFile(fileFor(clientId), 'utf-8')) as PendingAction
      } catch {
        return null
      }
    },
    async set(clientId, action) {
      const file = fileFor(clientId)
      await mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(action, null, 2), { mode: 0o600 })
      await rename(tmp, file)
    },
    async clear(clientId) {
      await rm(fileFor(clientId), { force: true })
    },
  }
}
