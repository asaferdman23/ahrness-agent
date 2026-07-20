/**
 * Local two-device Baileys acceptance harness.
 *
 * Starts the real onboarding handler and creates two stable tenant-scoped
 * sessions. It deliberately refuses production mode and uses a temporary store
 * by default so device testing cannot overwrite normal client state.
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { networkInterfaces, tmpdir } from 'node:os'
import path from 'node:path'

if (process.env.NODE_ENV === 'production') {
  throw new Error('The Baileys device-test harness cannot run in production mode')
}

process.env.AGENT_STORE_DIR = process.env.BAILEYS_DEVICE_TEST_STORE_DIR
  ?? path.join(tmpdir(), 'bizzclaw-baileys-device-test')
process.env.ONBOARDING_ACTIVATION_V2 = 'true'
process.env.ONBOARDING_ACTIVATION_V2_PERCENT = '100'
process.env.WHATSAPP_PROVIDER = 'baileys'

const host = process.env.BAILEYS_DEVICE_TEST_HOST?.trim() || '127.0.0.1'
const parsedPort = Number.parseInt(process.env.BAILEYS_DEVICE_TEST_PORT ?? '3457', 10)
if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
  throw new Error('BAILEYS_DEVICE_TEST_PORT must be a valid TCP port')
}

const [{ createOnboardingHandler }, { createSession, saveSession }, { baileysSessionManager }] = await Promise.all([
  import('../src/onboarding/server.js'),
  import('../src/onboarding/session.js'),
  import('../src/baileys-manager.js'),
])

const sessions = await Promise.all(['A', 'B'].map(async (label) => {
  const session = await createSession()
  // A stable explicit client id prevents the unauthenticated test session from
  // being re-keyed from its session id to the linked phone JID after QR scan.
  session.clientId = `baileys-device-${label.toLowerCase()}-${randomUUID()}`
  session.whatsappProvider = 'baileys'
  await saveSession(session)
  return { label, session }
}))

const handler = createOnboardingHandler()
const server = createServer((req, res) => {
  handler(req, res).catch((error: unknown) => {
    console.error('[baileys-device-test] request failed:', error)
    if (!res.headersSent) res.statusCode = 500
    res.end('Internal Server Error')
  })
})

await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(parsedPort, host, resolve)
})

const addresses = host === '0.0.0.0' ? localIpv4Addresses() : [host]
console.log('\nBaileys two-device onboarding is ready.')
console.log('Open tenant A and tenant B in separate browser profiles or devices:')
for (const address of addresses) {
  for (const { label, session } of sessions) {
    console.log(`  Tenant ${label}: http://${address}:${parsedPort}/onboarding?session=${session.sessionId}&platform=baileys`)
  }
}
console.log('\nPress Ctrl+C when the test is finished. Test data is isolated at:')
console.log(`  ${process.env.AGENT_STORE_DIR}`)

function shutdown(): void {
  baileysSessionManager().stopAll()
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function localIpv4Addresses(): string[] {
  const addresses = Object.values(networkInterfaces())
    .flatMap((records) => records ?? [])
    .filter((record) => record.family === 'IPv4' && !record.internal)
    .map((record) => record.address)
  return addresses.length > 0 ? addresses : ['127.0.0.1']
}
