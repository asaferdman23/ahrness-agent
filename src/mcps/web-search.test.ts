import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWebSearch, formatResults, type SearchResult } from './web-search.js'

const FAKE: SearchResult[] = [
  { title: 'Example', url: 'https://example.com/a', snippet: 'first result' },
  { title: 'Two', url: 'https://example.com/b', snippet: 'second result' },
]

test('formatResults frames output as untrusted and lists titles + urls', () => {
  const out = formatResults('best tools', FAKE)
  assert.match(out, /untrusted/i, 'must warn the model the content is untrusted')
  assert.match(out, /https:\/\/example\.com\/a/)
  assert.match(out, /Example/)
})

test('runWebSearch passes the query through and returns formatted results', async () => {
  let seenQuery = ''
  let seenMax = 0
  const search = async (q: string, max: number) => {
    seenQuery = q
    seenMax = max
    return FAKE
  }
  const out = await runWebSearch({ query: 'best tools', maxResults: 3 }, search)
  assert.equal(seenQuery, 'best tools')
  assert.equal(seenMax, 3)
  assert.match(out, /example\.com\/b/)
})

test('runWebSearch rejects an empty query', async () => {
  await assert.rejects(() => runWebSearch({ query: '   ' }, async () => FAKE), /query/i)
})

test('runWebSearch clamps maxResults into a sane range', async () => {
  let seenMax = 0
  const search = async (_q: string, max: number) => {
    seenMax = max
    return FAKE
  }
  await runWebSearch({ query: 'x', maxResults: 999 }, search)
  assert.ok(seenMax <= 10, 'should clamp to at most 10')
  await runWebSearch({ query: 'x', maxResults: 0 }, search)
  assert.ok(seenMax >= 1, 'should clamp up to at least 1')
})
