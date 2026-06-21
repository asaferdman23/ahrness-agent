import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, chmod, chown } from 'node:fs/promises'
import path from 'node:path'
import { DockerSandbox } from '@strands-agents/sdk/sandbox/docker'

const SANDBOX_VERSION = '1'
const CONTAINER_WORKSPACE = '/workspace'
export const OUTPUTS_DIR = `${CONTAINER_WORKSPACE}/outputs`

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

    if (inspection.exitCode === 0) {
      const [managed, version, running] = inspection.stdout.trim().split(/\s+/)
      if (managed !== 'true') {
        throw new Error(`Refusing to use unmanaged container ${containerName}`)
      }
      if (version !== SANDBOX_VERSION) {
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

  private async create(containerName: string, workspaceDir: string, user: string): Promise<void> {
    const image = process.env.AGENT_SANDBOX_IMAGE ?? 'ahrness-sandbox:latest'
    const network = process.env.AGENT_SANDBOX_NETWORK ?? 'none'
    if (network !== 'none' && network !== 'bridge') {
      throw new Error('AGENT_SANDBOX_NETWORK must be "none" or "bridge"')
    }

    await runDocker([
      'create',
      '--name',
      containerName,
      '--label',
      'com.ahrness.managed=true',
      '--label',
      `com.ahrness.version=${SANDBOX_VERSION}`,
      '--network',
      network,
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
