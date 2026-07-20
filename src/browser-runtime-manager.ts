import { spawn } from 'node:child_process'
import path from 'node:path'

export const BROWSER_RUNTIME_NETWORK = 'ahrness-browser'
export const BROWSER_RUNTIME_CONTAINER = 'ahrness-browser-runtime'
export const BROWSER_RUNTIME_PORT = 8090

export type DockerRunner = (args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>

async function defaultDockerRunner(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (exitCode) => {
      resolve({ stdout: Buffer.concat(stdout).toString('utf-8'), stderr: Buffer.concat(stderr).toString('utf-8'), exitCode: exitCode ?? 1 })
    })
  })
}

// Keyed by the runner instance rather than a single module-level slot: the
// default (production) runner is always the same function reference, so this
// still behaves as a per-process singleton in production, but each distinct
// injected runner (e.g. a fresh fake per test) gets its own independent cache.
const readyPromises = new WeakMap<DockerRunner, Promise<void>>()

/** Idempotent: creates the internal network + browser-runtime container if missing, starts it if stopped, no-ops if already running. */
export async function ensureBrowserRuntime(runner: DockerRunner = defaultDockerRunner): Promise<void> {
  const cached = readyPromises.get(runner)
  if (cached) return cached
  const readyPromise = (async () => {
    const netInspect = await runner(['network', 'inspect', BROWSER_RUNTIME_NETWORK])
    if (netInspect.exitCode !== 0) {
      await runner(['network', 'create', BROWSER_RUNTIME_NETWORK])
    }

    const containerInspect = await runner(['inspect', '--format', '{{.State.Running}}', BROWSER_RUNTIME_CONTAINER])
    if (containerInspect.exitCode !== 0) {
      const repoRoot = path.resolve(process.env.AGENT_REPO_DIR ?? '.')
      await runner([
        'run',
        '-d',
        '--name',
        BROWSER_RUNTIME_CONTAINER,
        '--label',
        'com.ahrness.managed=true',
        '--network',
        BROWSER_RUNTIME_NETWORK,
        '--restart',
        'unless-stopped',
        '--volume',
        `${repoRoot}:/app:ro`,
        '--workdir',
        '/app',
        '--env',
        `BROWSER_RUNTIME_PORT=${BROWSER_RUNTIME_PORT}`,
        '--env',
        `BROWSER_MAX_CONTEXTS=${process.env.BROWSER_MAX_CONTEXTS ?? '20'}`,
        '--env',
        `BROWSER_IDLE_TIMEOUT_MS=${process.env.BROWSER_IDLE_TIMEOUT_MS ?? '300000'}`,
        '--env',
        `BROWSER_NAV_TIMEOUT_MS=${process.env.BROWSER_NAV_TIMEOUT_MS ?? '30000'}`,
        'ahrness-browser-runtime:latest',
      ])
    } else if (containerInspect.stdout.trim() !== 'true') {
      await runner(['start', BROWSER_RUNTIME_CONTAINER])
    }
  })().catch((err) => {
    readyPromises.delete(runner) // allow a retry on the next call
    throw err
  })
  readyPromises.set(runner, readyPromise)
  return readyPromise
}
