import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dashboardWhatsappReady, renderDashboardPage, type DashboardState } from './dashboard.js'
import type { User } from './auth.js'

const user: User = {
  id: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

test('dashboard readiness requires a live Baileys socket and selected group', () => {
  assert.equal(dashboardWhatsappReady({ whatsappJid: '1555@s.whatsapp.net', provider: 'twilio', baileysConnected: false, baileysHomeGroupJid: null }), true)
  assert.equal(dashboardWhatsappReady({ whatsappJid: '1555@s.whatsapp.net', provider: 'baileys', baileysConnected: false, baileysHomeGroupJid: '120@g.us' }), false)
  assert.equal(dashboardWhatsappReady({ whatsappJid: '1555@s.whatsapp.net', provider: 'baileys', baileysConnected: true, baileysHomeGroupJid: null }), false)
  assert.equal(dashboardWhatsappReady({ whatsappJid: '1555@s.whatsapp.net', provider: 'baileys', baileysConnected: true, baileysHomeGroupJid: '120@g.us' }), true)
})

function dashboardState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    whatsappLinked: true,
    whatsappJid: '15551234567@s.whatsapp.net',
    whatsappProvider: 'twilio',
    whatsappHomeGroupSubject: null,
    telegramLinked: false,
    telegramConnectUrl: null,
    slackLinked: false,
    slackConnectUrl: null,
    onboardingStep: 6,
    role: {
      id: 'gtm-operator',
      displayName: 'Pipeline Builder',
      description: 'Turn attention into qualified conversations and a repeatable path to revenue.',
      emoji: '🚀',
    },
    profile: {
      businessName: 'Acme',
      website: 'https://acme.test',
      instagram: '@acme',
      tiktok: null,
      targetAudience: 'Founders',
      brandVoice: 'Direct',
      goals: ['increase_sales'],
    },
    platforms: [{
      id: 'meta-ads',
      displayName: 'Meta Ads',
      required: true,
      status: 'connected',
      connectedAt: '2026-07-01T09:00:00.000Z',
      tokenExpiresAt: null,
    }],
    automations: [{
      id: 'job-1',
      title: 'Weekly pipeline review',
      enabled: true,
      runCount: 2,
      lastRunAt: '2026-07-01T10:00:00.000Z',
      lastRunStatus: 'ok',
    }],
    pendingApproval: null,
    alerts: [],
    lastActivityAt: '2026-07-01T11:00:00.000Z',
    recentRuns: [{
      id: 'run-1',
      status: 'completed',
      channel: 'whatsapp',
      startedAt: '2026-07-01T11:00:00.000Z',
      outputPreview: 'A seven-day plan with three qualified follow-up opportunities.',
    }],
    crmSummary: {
      peopleCount: 3,
      activeOpportunityCount: 2,
      activeValueByCurrency: { USD: 125_000 },
      followUpsDue: 1,
      wonThisMonthByCurrency: {},
      verifiedWonThisMonthByCurrency: {},
      influencedWonThisMonthByCurrency: {},
      lastUpdatedAt: '2026-07-01T11:00:00.000Z',
    },
    ...overrides,
  }
}

test('dashboard renders a business-first SaaS home from verified state', () => {
  const html = renderDashboardPage(user, dashboardState())

  assert.match(html, /Ada, your Pipeline Builder is ready/)
  assert.match(html, /Ready on WhatsApp/)
  assert.match(html, /Recent results/)
  assert.match(html, /Result delivered/)
  assert.match(html, /A seven-day plan with three qualified follow-up opportunities/)
  assert.match(html, /Connected apps/)
  assert.match(html, /Your BizzClaw teammate/)
  assert.doesNotMatch(html, /What Your Agent Knows|Behind The Scenes|Assigned Role|Connected Surfaces|token expired/)
})

test('dashboard uses honest empty states when setup and work are incomplete', () => {
  const html = renderDashboardPage(user, dashboardState({
    whatsappLinked: false,
    whatsappJid: null,
    onboardingStep: 5,
    role: null,
    profile: null,
    platforms: [],
    automations: [],
    lastActivityAt: null,
    recentRuns: [],
    crmSummary: {
      peopleCount: 0,
      activeOpportunityCount: 0,
      activeValueByCurrency: {},
      followUpsDue: 0,
      wonThisMonthByCurrency: {},
      verifiedWonThisMonthByCurrency: {},
      influencedWonThisMonthByCurrency: {},
      lastUpdatedAt: null,
    },
  }))

  assert.match(html, /Finish connecting WhatsApp to start receiving results/)
  assert.match(html, /Your first result will appear here/)
  assert.match(html, /Turn conversations into a real pipeline/)
  assert.match(html, /only records you or your agent actually saved/)
  assert.match(html, /href="\/onboarding\/step\/5"/)
})

test('dashboard gives active work and attention a clear primary action', () => {
  const html = renderDashboardPage(user, dashboardState({
    alerts: [{
      title: 'A prepared action needs your OK',
      detail: 'Review the follow-up before it is sent.',
      level: 'warn',
      actionHref: '/dashboard/activity',
      actionLabel: 'Review',
    }],
    recentRuns: [{
      id: 'run-working',
      status: 'running',
      channel: 'whatsapp',
      startedAt: '2026-07-01T11:00:00.000Z',
      outputPreview: null,
    }],
  }))

  assert.match(html, /BizzClaw is working on your latest request/)
  assert.match(html, /See progress/)
  assert.match(html, /A prepared action needs your OK/)
  assert.match(html, />Review<\/a>/)
})

test('dashboard opens the selected Baileys group instead of a direct chat', () => {
  const html = renderDashboardPage(user, dashboardState({
    whatsappProvider: 'baileys',
    whatsappHomeGroupSubject: 'BizzClaw HQ',
  }))

  assert.match(html, /Open my BizzClaw group/)
  assert.match(html, /Your private workspace is “BizzClaw HQ”/)
  assert.match(html, /fetch\('\/api\/whatsapp\/home-group-link'/)
  assert.doesNotMatch(html, /https:\/\/wa\.me\/15551234567/)
  assert.match(html, /href="\/onboarding\/step\/5\?manage=group">Change or create group/)
})

test('dashboard escapes customer-controlled identity, result, and alert text', () => {
  const unsafeUser = { ...user, name: '<img src=x onerror=alert(1)>', image: 'https://example.test/" onerror="alert(1)' }
  const html = renderDashboardPage(unsafeUser, dashboardState({
    alerts: [{ title: '<script>alert(1)</script>', detail: 'Use <b>care</b>', level: 'warn' }],
    recentRuns: [{
      id: 'run-unsafe',
      status: 'completed',
      channel: 'whatsapp',
      startedAt: '2026-07-01T11:00:00.000Z',
      outputPreview: '<script>steal()</script>',
    }],
  }))

  assert.doesNotMatch(html, /<script>steal\(\)<\/script>/)
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  assert.match(html, /&lt;script&gt;steal\(\)&lt;\/script&gt;/)
  assert.match(html, /https:\/\/example\.test\/&quot; onerror=&quot;alert\(1\)/)
})
