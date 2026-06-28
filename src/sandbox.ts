import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, chmod, chown } from 'node:fs/promises'
import path from 'node:path'
import { DockerSandbox } from '@strands-agents/sdk/sandbox/docker'

const CONTAINER_WORKSPACE = '/workspace'
export const OUTPUTS_DIR = `${CONTAINER_WORKSPACE}/outputs`

// Egress: when enabled, the sandbox has no internet of its own and reaches the
// web only through the filtering proxy container on an internal Docker network.
const EGRESS_NETWORK = 'ahrness-egress'
const EGRESS_PROXY_CONTAINER = 'ahrness-egress-proxy'
const EGRESS_PROXY_PORT = 8080

function egressEnabled(): boolean {
  return process.env.AGENT_SANDBOX_EGRESS === 'true'
}

// Container layout version — bumped implicitly by egress mode so toggling it
// recreates sandboxes with the right network instead of reusing a stale one.
function sandboxVersion(): string {
  return egressEnabled() ? '2-egress' : '1'
}

type DockerResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type ClientSandbox = {
  sandbox: DockerSandbox
  containerName: string
  workspaceDir: string
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function sandboxUser(): { value: string; uid: number; gid: number } {
  const configured = process.env.AGENT_SANDBOX_USER?.trim()
  if (configured) {
    const match = /^(\d+)(?::(\d+))?$/.exec(configured)
    if (!match) throw new Error('AGENT_SANDBOX_USER must be a numeric uid or uid:gid')
    const uid = Number(match[1])
    const gid = Number(match[2] ?? match[1])
    return { value: `${uid}:${gid}`, uid, gid }
  }

  const hostUid = process.getuid?.() ?? 1000
  const hostGid = process.getgid?.() ?? 1000
  // Never run an agent sandbox as root. Root-hosted services use nobody by default.
  const uid = hostUid === 0 ? 65534 : hostUid
  const gid = hostGid === 0 ? 65534 : hostGid
  return { value: `${uid}:${gid}`, uid, gid }
}

export function clientSandboxKey(clientId: string): string {
  return createHash('sha256').update(clientId).digest('hex').slice(0, 24)
}

export function resolvePublishedOutputPath(requestedPath: string): string {
  const trimmed = requestedPath.trim()
  if (!trimmed || trimmed.includes('\0')) throw new Error('Output path is required')

  const absolute = path.posix.resolve(CONTAINER_WORKSPACE, trimmed)
  if (absolute === OUTPUTS_DIR || !absolute.startsWith(`${OUTPUTS_DIR}/`)) {
    throw new Error(`Only files inside ${OUTPUTS_DIR} can be published`)
  }
  return absolute
}

async function runDocker(args: string[], allowFailure = false): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timeout = setTimeout(() => child.kill('SIGKILL'), 30_000)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout)
      if (error.code === 'ENOENT') {
        reject(new Error('Docker is required for agent sandboxing but was not found in PATH'))
        return
      }
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: code ?? 1,
      }
      if (result.exitCode !== 0 && !allowFailure) {
        reject(new Error(result.stderr.trim() || `docker ${args[0] ?? ''} failed`))
        return
      }
      resolve(result)
    })
  })
}

class SandboxManager {
  private readonly pending = new Map<string, Promise<ClientSandbox>>()

  get(clientId: string): Promise<ClientSandbox> {
    return this.getByKey(clientSandboxKey(clientId))
  }

  getByKey(key: string): Promise<ClientSandbox> {
    if (!/^[a-f0-9]{24}$/.test(key)) throw new Error('Invalid sandbox key')
    const existing = this.pending.get(key)
    if (existing) return existing

    const created = this.ensure(key).finally(() => {
      this.pending.delete(key)
    })
    this.pending.set(key, created)
    return created
  }

  private async ensure(key: string): Promise<ClientSandbox> {
    const root = path.resolve(process.env.AGENT_WORKSPACES_DIR ?? './store/workspaces')
    const workspaceDir = path.join(root, key)
    const containerName = `ahrness-${key}`
    const user = sandboxUser()

    await mkdir(path.join(workspaceDir, 'inbox'), { recursive: true })
    await mkdir(path.join(workspaceDir, 'outputs'), { recursive: true })
    await chmod(workspaceDir, 0o770)
    if ((process.getuid?.() ?? -1) === 0) {
      await chown(workspaceDir, user.uid, user.gid)
      await chown(path.join(workspaceDir, 'inbox'), user.uid, user.gid)
      await chown(path.join(workspaceDir, 'outputs'), user.uid, user.gid)
    }

    const inspection = await runDocker(
      [
        'inspect',
        '--format',
        '{{index .Config.Labels "com.ahrness.managed"}} {{index .Config.Labels "com.ahrness.version"}} {{.State.Running}}',
        containerName,
      ],
      true,
    )

    if (egressEnabled()) await this.ensureEgressInfra()

    if (inspection.exitCode === 0) {
      const [managed, version, running] = inspection.stdout.trim().split(/\s+/)
      if (managed !== 'true') {
        throw new Error(`Refusing to use unmanaged container ${containerName}`)
      }
      if (version !== sandboxVersion()) {
        await runDocker(['rm', '--force', containerName])
        await this.create(containerName, workspaceDir, user.value)
      } else if (running !== 'true') {
        await runDocker(['start', containerName])
      }
    } else {
      await this.create(containerName, workspaceDir, user.value)
    }

    return {
      sandbox: new DockerSandbox({
        container: containerName,
        workingDir: CONTAINER_WORKSPACE,
        user: user.value,
      }),
      containerName,
      workspaceDir,
    }
  }

  /** Create the internal network + filtering proxy container (idempotent, once per process). */
  private egressReady: Promise<void> | null = null
  private ensureEgressInfra(): Promise<void> {
    if (this.egressReady) return this.egressReady
    this.egressReady = (async () => {
      const netInspect = await runDocker(['network', 'inspect', EGRESS_NETWORK], true)
      if (netInspect.exitCode !== 0) {
        // --internal: no NAT to the internet, so the sandbox's only way out is the proxy.
        await runDocker(['network', 'create', '--internal', EGRESS_NETWORK])
      }
      const proxyInspect = await runDocker(
        ['inspect', '--format', '{{.State.Running}}', EGRESS_PROXY_CONTAINER],
        true,
      )
      if (proxyInspect.exitCode !== 0) {
        const repoRoot = path.resolve(process.env.AGENT_REPO_DIR ?? '.')
        await runDocker([
          'run',
          '-d',
          '--name',
          EGRESS_PROXY_CONTAINER,
          '--label',
          'com.ahrness.managed=true',
          '--network',
          EGRESS_NETWORK,
          '--restart',
          'unless-stopped',
          '--volume',
          `${repoRoot}:/app:ro`,
          '--workdir',
          '/app',
          '--env',
          `AGENT_WEB_ALLOWLIST=${process.env.AGENT_WEB_ALLOWLIST ?? ''}`,
          '--env',
          `EGRESS_PROXY_PORT=${EGRESS_PROXY_PORT}`,
          '--env',
          `EGRESS_MAX_PER_MINUTE=${process.env.EGRESS_MAX_PER_MINUTE ?? '120'}`,
          'node:22',
          'node',
          '--import',
          'tsx',
          'src/egress-proxy-server.ts',
        ])
        // Give the proxy (and only the proxy) real internet via the default bridge.
        await runDocker(['network', 'connect', 'bridge', EGRESS_PROXY_CONTAINER])
      } else if (proxyInspect.stdout.trim() !== 'true') {
        await runDocker(['start', EGRESS_PROXY_CONTAINER])
      }
    })().catch((err) => {
      this.egressReady = null // allow a retry on the next sandbox request
      throw err
    })
    return this.egressReady
  }

  private async create(containerName: string, workspaceDir: string, user: string): Promise<void> {
    const image = process.env.AGENT_SANDBOX_IMAGE ?? 'ahrness-sandbox:latest'
    const proxyEnv: string[] = []
    let network: string
    if (egressEnabled()) {
      network = EGRESS_NETWORK
      const proxyUrl = `http://${EGRESS_PROXY_CONTAINER}:${EGRESS_PROXY_PORT}`
      for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) {
        proxyEnv.push('--env', `${key}=${proxyUrl}`)
      }
      proxyEnv.push('--env', 'NO_PROXY=localhost,127.0.0.1')
    } else {
      network = process.env.AGENT_SANDBOX_NETWORK ?? 'none'
      if (network !== 'none' && network !== 'bridge') {
        throw new Error('AGENT_SANDBOX_NETWORK must be "none" or "bridge"')
      }
    }

    await runDocker([
      'create',
      '--name',
      containerName,
      '--label',
      'com.ahrness.managed=true',
      '--label',
      `com.ahrness.version=${sandboxVersion()}`,
      '--network',
      network,
      ...proxyEnv,
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--pids-limit',
      String(positiveInteger(process.env.AGENT_SANDBOX_PIDS_LIMIT, 128)),
      '--memory',
      process.env.AGENT_SANDBOX_MEMORY ?? '512m',
      '--cpus',
      process.env.AGENT_SANDBOX_CPUS ?? '1',
      '--user',
      user,
      '--workdir',
      CONTAINER_WORKSPACE,
      '--volume',
      `${workspaceDir}:${CONTAINER_WORKSPACE}:rw`,
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '--restart',
      'no',
      image,
      'sleep',
      'infinity',
    ])
    await runDocker(['start', containerName])
  }
}

const manager = new SandboxManager()

export async function getClientSandbox(clientId: string): Promise<ClientSandbox> {
  if (process.env.AGENT_SANDBOX_ENABLED === 'false') {
    throw new Error('Agent sandboxing is disabled; host execution is not permitted')
  }
  return manager.get(clientId)
}

export async function getClientSandboxByKey(key: string): Promise<ClientSandbox> {
  if (process.env.AGENT_SANDBOX_ENABLED === 'false') {
    throw new Error('Agent sandboxing is disabled; host execution is not permitted')
  }
  return manager.getByKey(key)
}
