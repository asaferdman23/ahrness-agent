import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyHiggsfieldSetupSecret } from './higgsfield-auth.js'
import { createShareInputTool } from './input-sharing.js'
import { isPrivateAddress } from './outputs.js'

test('Higgsfield setup secret is required and compared exactly', () => {
  const previous = process.env.HIGGSFIELD_SETUP_SECRET
  process.env.HIGGSFIELD_SETUP_SECRET = 'a-long-random-setup-secret'
  try {
    assert.equal(verifyHiggsfieldSetupSecret(null), false)
    assert.equal(verifyHiggsfieldSetupSecret('wrong'), false)
    assert.equal(verifyHiggsfieldSetupSecret('a-long-random-setup-secret'), true)
  } finally {
    if (previous === undefined) delete process.env.HIGGSFIELD_SETUP_SECRET
    else process.env.HIGGSFIELD_SETUP_SECRET = previous
  }
})

test('remote output protection rejects private network addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1']) {
    assert.equal(isPrivateAddress(address), true, address)
  }
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPrivateAddress(address), false, address)
  }
})

test('input sharing only signs files directly inside the client inbox', async () => {
  const previousBase = process.env.CALLBACK_BASE_URL
  const previousSecret = process.env.MEDIA_SIGNING_SECRET
  process.env.CALLBACK_BASE_URL = 'https://agent.example.com'
  process.env.MEDIA_SIGNING_SECRET = 'another-long-random-signing-secret'
  try {
    const share = createShareInputTool('client@example')
    await assert.rejects(() => share.invoke({ path: '/workspace/outputs/file.png' }), /Only files in/)
    const result = await share.invoke({ path: '/workspace/inbox/photo.jpg' }) as { url: string }
    assert.match(result.url, /^https:\/\/agent\.example\.com\/media\/[a-f0-9]{24}\/photo\.jpg\?expires=\d+&sig=/)
  } finally {
    if (previousBase === undefined) delete process.env.CALLBACK_BASE_URL
    else process.env.CALLBACK_BASE_URL = previousBase
    if (previousSecret === undefined) delete process.env.MEDIA_SIGNING_SECRET
    else process.env.MEDIA_SIGNING_SECRET = previousSecret
  }
})
