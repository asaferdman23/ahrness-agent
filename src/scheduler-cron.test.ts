import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cronMatches, isValidCron, parseCron } from './scheduler/cron.js'

// 2026-06-22 is a Monday; 2026-06-21 is a Sunday.
const mon0900Z = new Date('2026-06-22T09:00:00Z')

test('matches weekday + time in UTC', () => {
  assert.equal(cronMatches('0 9 * * 1', mon0900Z, 'UTC'), true)
  assert.equal(cronMatches('0 9 * * 2', mon0900Z, 'UTC'), false)
})

test('step ranges (every 6 hours)', () => {
  assert.equal(cronMatches('0 */6 * * *', new Date('2026-06-22T12:00:00Z'), 'UTC'), true)
  assert.equal(cronMatches('0 */6 * * *', new Date('2026-06-22T13:00:00Z'), 'UTC'), false)
})

test('evaluates cron in the given timezone', () => {
  // 09:00 New York (EDT) is 13:00 UTC.
  assert.equal(cronMatches('0 9 * * 1', new Date('2026-06-22T13:00:00Z'), 'America/New_York'), true)
  assert.equal(cronMatches('0 9 * * 1', mon0900Z, 'America/New_York'), false)
})

test('Vixie OR-semantics when both day-of-month and day-of-week are set', () => {
  assert.equal(cronMatches('0 0 1 * 1', new Date('2026-06-01T00:00:00Z'), 'UTC'), true) // 1st
  assert.equal(cronMatches('0 0 1 * 1', new Date('2026-06-22T00:00:00Z'), 'UTC'), true) // Monday
  assert.equal(cronMatches('0 0 1 * 1', new Date('2026-06-02T00:00:00Z'), 'UTC'), false)
})

test('Sunday accepted as both 0 and 7', () => {
  const sun = new Date('2026-06-21T17:00:00Z')
  assert.equal(cronMatches('0 17 * * 0', sun, 'UTC'), true)
  assert.equal(cronMatches('0 17 * * 7', sun, 'UTC'), true)
})

test('validation', () => {
  assert.equal(isValidCron('0 9 * * 1'), true)
  assert.equal(isValidCron('0 9 * *'), false) // too few fields
  assert.equal(isValidCron('60 9 * * 1'), false) // minute out of range
  assert.throws(() => parseCron('* * *'))
})
