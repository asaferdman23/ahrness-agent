import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAllSiteProfiles, getSiteProfile } from './registry.js'

test('getSiteProfile returns a curated profile for a known domain', () => {
  const profile = getSiteProfile('linkedin.com')
  assert.ok(profile)
  assert.equal(profile.domain, 'linkedin.com')
  assert.match(profile.loginUrl, /^https:\/\//)
})

test('getSiteProfile returns null for an uncurated domain', () => {
  assert.equal(getSiteProfile('some-random-saas.example'), null)
})

test('getAllSiteProfiles returns all four curated sites', () => {
  const profiles = getAllSiteProfiles()
  const domains = profiles.map((p) => p.domain).sort()
  assert.deepEqual(domains, ['facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com'])
})
