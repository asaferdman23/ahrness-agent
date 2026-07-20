import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensureBrowserRuntime, BROWSER_RUNTIME_CONTAINER, type DockerRunner } from './browser-runtime-manager.js'

function fakeRunner(responses: Record<string, { exitCode: number; stdout: string }>): { runner: DockerRunner; calls: string[][] } {
  const calls: string[][] = []
  const runner: DockerRunner = async (args) => {
    calls.push(args)
    const key = args.join(' ')
    for (const [prefix, result] of Object.entries(responses)) {
      if (key.startsWith(prefix)) return { stdout: result.stdout, stderr: '', exitCode: result.exitCode }
    }
    return { stdout: '', stderr: '', exitCode: 1 }
  }
  return { runner, calls }
}

test('creates the network and starts the container when neither exists', async () => {
  const { runner, calls } = fakeRunner({
    'network inspect': { exitCode: 1, stdout: '' },
    'inspect --format': { exitCode: 1, stdout: '' },
    'network create': { exitCode: 0, stdout: '' },
    run: { exitCode: 0, stdout: '' },
  })
  await ensureBrowserRuntime(runner)
  const ran = calls.some((c) => c[0] === 'run' && c.includes(BROWSER_RUNTIME_CONTAINER))
  assert.ok(ran, 'should docker run the browser-runtime container')
})

test('starts an existing but stopped container instead of recreating it', async () => {
  const { runner, calls } = fakeRunner({
    'network inspect': { exitCode: 0, stdout: '' },
    'inspect --format': { exitCode: 0, stdout: 'false' },
    start: { exitCode: 0, stdout: '' },
  })
  await ensureBrowserRuntime(runner)
  const started = calls.some((c) => c[0] === 'start' && c.includes(BROWSER_RUNTIME_CONTAINER))
  const ran = calls.some((c) => c[0] === 'run')
  assert.ok(started, 'should docker start the stopped container')
  assert.ok(!ran, 'should not docker run when the container already exists')
})

test('does nothing when the container is already running', async () => {
  const { runner, calls } = fakeRunner({
    'network inspect': { exitCode: 0, stdout: '' },
    'inspect --format': { exitCode: 0, stdout: 'true' },
  })
  await ensureBrowserRuntime(runner)
  const mutating = calls.some((c) => c[0] === 'run' || c[0] === 'start' || c[0] === 'create')
  assert.ok(!mutating, 'should be a no-op when already running')
})
