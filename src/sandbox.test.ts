import assert from 'node:assert/strict'
import test from 'node:test'
import { clientSandboxKey, resolvePublishedOutputPath } from './sandbox.js'

test('client sandbox keys are stable and do not expose the client id', () => {
  const clientId = '15551234567@s.whatsapp.net'
  const key = clientSandboxKey(clientId)

  assert.equal(key, clientSandboxKey(clientId))
  assert.match(key, /^[a-f0-9]{24}$/)
  assert.equal(key.includes('15551234567'), false)
  assert.notEqual(key, clientSandboxKey('another-client'))
})

test('published outputs stay inside the output directory', () => {
  assert.equal(resolvePublishedOutputPath('outputs/report.pdf'), '/workspace/outputs/report.pdf')
  assert.equal(resolvePublishedOutputPath('/workspace/outputs/ad.png'), '/workspace/outputs/ad.png')

  assert.throws(() => resolvePublishedOutputPath('/workspace/private.txt'), /Only files inside/)
  assert.throws(() => resolvePublishedOutputPath('outputs/../../etc/passwd'), /Only files inside/)
  assert.throws(() => resolvePublishedOutputPath('/workspace/outputs'), /Only files inside/)
})
