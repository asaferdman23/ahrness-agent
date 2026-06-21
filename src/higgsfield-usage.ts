import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Tool, type ToolContext, type ToolStreamGenerator } from '@strands-agents/sdk'

const STORE_PATH = path.resolve(process.env.HIGGSFIELD_USAGE_STORE ?? './store/higgsfield-usage.json')
let writeQueue: Promise<void> = Promise.resolve()

type UsageRecord = { date: string; count: number }
type UsageMap = Record<string, UsageRecord>

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function dailyLimit(): number {
  const value = Number.parseInt(process.env.HIGGSFIELD_DAILY_GENERATION_LIMIT ?? '', 10)
  return Number.isFinite(value) && value >= 0 ? value : 10
}

async function readUsage(): Promise<UsageMap> {
  try {
    return JSON.parse(await readFile(STORE_PATH, 'utf8')) as UsageMap
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

async function consume(clientId: string): Promise<{ used: number; limit: number }> {
  let result = { used: 0, limit: dailyLimit() }
  const operation = writeQueue.then(async () => {
    const usage = await readUsage()
    const date = today()
    const usageKey = createHash('sha256').update(clientId).digest('hex').slice(0, 24)
    const current = usage[usageKey]?.date === date ? usage[usageKey]!.count : 0
    if (current >= result.limit) {
      throw new Error(`Daily Higgsfield generation limit reached (${result.limit}). Try again tomorrow.`)
    }
    result = { used: current + 1, limit: result.limit }
    usage[usageKey] = { date, count: result.used }
    await mkdir(path.dirname(STORE_PATH), { recursive: true })
    const temporary = `${STORE_PATH}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(usage, null, 2), { mode: 0o600 })
    await rename(temporary, STORE_PATH)
  })
  writeQueue = operation.catch(() => {})
  await operation
  return result
}

function isBillableTool(name: string): boolean {
  return !/(?:^|[_-])(list|get|status|wait|search|model|models|voice|voices|account|cost|credits|upload)(?:$|[_-])/i.test(name)
}

class LimitedHiggsfieldTool extends Tool {
  readonly name: string
  readonly description: string
  readonly toolSpec: Tool['toolSpec']

  constructor(
    private readonly clientId: string,
    private readonly delegate: Tool,
  ) {
    super()
    this.name = delegate.name
    this.description = delegate.description
    this.toolSpec = delegate.toolSpec
  }

  async *stream(context: ToolContext): ToolStreamGenerator {
    if (isBillableTool(this.name)) await consume(this.clientId)
    return yield* this.delegate.stream(context)
  }
}

export function limitHiggsfieldTools(clientId: string, tools: Tool[]): Tool[] {
  return tools.map((tool) => new LimitedHiggsfieldTool(clientId, tool))
}
