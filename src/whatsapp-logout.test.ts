import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, access, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { authDirFor } from './whatsapp.js'

test('authDirFor resolves under store/clients/<clientId>/auth', () => {
  const dir = authDirFor('abc123')
  assert.ok(dir.endsWith(path.join('store', 'clients', 'abc123', 'auth')), dir)
})

test('authDirFor gives each client an isolated auth dir', () => {
  assert.notEqual(authDirFor('client-a'), authDirFor('client-b'))
})

// The 401 loggedOut path wipes the auth dir so the next socket start emits a
// fresh QR. This exercises the same rm semantics the connection.update handler
// relies on: a populated auth dir is removed, and a missing one is tolerated.
test('wiping auth dir removes dead creds and tolerates a missing dir', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'baileys-auth-'))
  try {
    const authDir = path.join(root, 'auth')
    await mkdir(authDir, { recursive: true })
    await writeFile(path.join(authDir, 'creds.json'), '{}')

    // Present: wiped clean.
    await rm(authDir, { recursive: true, force: true })
    await assert.rejects(access(authDir), /ENOENT/)

    // Absent: force:true makes the wipe a no-op (matches handler .catch guard).
    await rm(authDir, { recursive: true, force: true })

    // A fresh mkdir (what the next startBaileysWhatsApp does) starts empty,
    // which is exactly the condition that makes Baileys emit a new QR.
    await mkdir(authDir, { recursive: true })
    assert.deepEqual(await readdir(authDir), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
