import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  isActivationEventName,
  recordActivationEvent,
  sanitizeActivationProperties,
  type ActivationEventRecord,
} from './activation-events.js'

const roots: string[] = []

afterEach(async () => {
  delete process.env.AGENT_STORE_DIR
  delete process.env.POSTHOG_API_KEY
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('event names are allowlisted and arbitrary properties are discarded', () => {
  assert.equal(isActivationEventName('preview_generated'), true)
  assert.equal(isActivationEventName('send_business_description'), false)
  assert.deepEqual(sanitizeActivationProperties({
    phase: 'brief',
    step: 1,
    durationMs: 321,
    platform: 'meta-ads',
    description: 'sensitive business content',
    accessToken: 'secret',
  }), { phase: 'brief', step: 1, durationMs: 321, platform: 'meta-ads' })
})

test('events persist atomically, bound history, and deduplicate milestones', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'activation-events-'))
  roots.push(root)
  process.env.AGENT_STORE_DIR = root

  await recordActivationEvent('client-a', 'launch_completed', { phase: 'launch' }, { now: new Date('2026-07-18T12:00:00Z') })
  await recordActivationEvent('client-a', 'launch_completed', { phase: 'launch' }, { now: new Date('2026-07-18T12:01:00Z') })
  const file = path.join(root, 'clients', 'client-a', 'activation-events.json')
  const records = JSON.parse(await readFile(file, 'utf8')) as ActivationEventRecord[]

  assert.equal(records.length, 1)
  assert.equal(records[0]?.event, 'launch_completed')
})

test('PostHog delivery fails soft after the local fallback is saved', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'activation-events-'))
  roots.push(root)
  process.env.AGENT_STORE_DIR = root
  process.env.POSTHOG_API_KEY = 'phc_test'

  await recordActivationEvent('client-b', 'preview_generated', { phase: 'brief', source: 'ai' }, {
    fetchImpl: async () => { throw new Error('network unavailable') },
  })

  const file = path.join(root, 'clients', 'client-b', 'activation-events.json')
  const records = JSON.parse(await readFile(file, 'utf8')) as ActivationEventRecord[]
  assert.equal(records[0]?.event, 'preview_generated')
})
