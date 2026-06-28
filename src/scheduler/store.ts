import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ScheduledJob } from './types.js'

function clientsDir(): string {
  return path.resolve(process.env.AGENT_STORE_DIR ?? './store', 'clients')
}

function jobsPath(clientId: string): string {
  return path.join(clientsDir(), clientId, 'schedules.json')
}

async function atomicWrite(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  await rename(tmp, filePath)
}

async function readJobsFile(filePath: string): Promise<ScheduledJob[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf-8')) as unknown
    return Array.isArray(parsed) ? (parsed as ScheduledJob[]) : []
  } catch {
    return []
  }
}

export async function listJobs(clientId: string): Promise<ScheduledJob[]> {
  return readJobsFile(jobsPath(clientId))
}

export async function getJob(clientId: string, jobId: string): Promise<ScheduledJob | null> {
  return (await listJobs(clientId)).find((j) => j.id === jobId) ?? null
}

/** Does a job created from `templateId` already exist for this client? */
export async function hasTemplateJob(clientId: string, templateId: string): Promise<boolean> {
  return (await listJobs(clientId)).some((j) => j.templateId === templateId)
}

export async function addJob(
  input: Omit<ScheduledJob, 'id' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'runCount'>,
): Promise<ScheduledJob> {
  const now = new Date().toISOString()
  const job: ScheduledJob = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    runCount: 0,
  }
  const jobs = await listJobs(job.clientId)
  jobs.push(job)
  await atomicWrite(jobsPath(job.clientId), jobs)
  return job
}

export async function updateJob(
  clientId: string,
  jobId: string,
  patch: Partial<ScheduledJob>,
): Promise<ScheduledJob | null> {
  const jobs = await listJobs(clientId)
  const index = jobs.findIndex((j) => j.id === jobId)
  if (index === -1) return null
  const updated: ScheduledJob = { ...jobs[index]!, ...patch, updatedAt: new Date().toISOString() }
  jobs[index] = updated
  await atomicWrite(jobsPath(clientId), jobs)
  return updated
}

export async function removeJob(clientId: string, jobId: string): Promise<boolean> {
  const jobs = await listJobs(clientId)
  const next = jobs.filter((j) => j.id !== jobId)
  if (next.length === jobs.length) return false
  await atomicWrite(jobsPath(clientId), next)
  return true
}

/** Every job across every client — used by the runner's tick. */
export async function listAllJobs(): Promise<ScheduledJob[]> {
  let entries: string[]
  try {
    entries = await readdir(clientsDir())
  } catch {
    return []
  }
  const all: ScheduledJob[] = []
  for (const clientId of entries) {
    all.push(...(await readJobsFile(jobsPath(clientId))))
  }
  return all
}
