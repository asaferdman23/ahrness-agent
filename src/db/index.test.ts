import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('creates the database parent directory before opening SQLite', () => {
  const root = mkdtempSync(join(tmpdir(), 'ahrness-db-init-'))
  const storeDir = join(root, 'missing', 'store')
  const moduleUrl = new URL('./index.ts', import.meta.url).href

  try {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', `await import(${JSON.stringify(moduleUrl)})`],
      {
        encoding: 'utf8',
        env: { ...process.env, AGENT_STORE_DIR: storeDir },
      },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(join(storeDir, 'ahrness.db')), true)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
