import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDashboardPage } from './dashboard.js'
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

test('dashboard renders the minimal agent home sections', () => {
  const html = renderDashboardPage(user, {
    whatsappLinked: true,
    whatsappJid: '15551234567@s.whatsapp.net',
    whatsappProvider: 'twilio',
    telegramLinked: false,
    telegramConnectUrl: null,
    slackLinked: false,
    slackConnectUrl: null,
    onboardingStep: 6,
    role: {
      id: 'marketing-manager',
      displayName: 'Marketing Manager',
      description: 'Runs cross-channel planning and campaign strategy.',
      emoji: '📣',
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
    platforms: [
      {
        id: 'meta-ads',
        displayName: 'Meta Ads',
        required: true,
        status: 'connected',
        connectedAt: '2026-07-01T09:00:00.000Z',
        tokenExpiresAt: null,
      },
    ],
    automations: [
      {
        id: 'job-1',
        title: 'Weekly ROAS digest',
        enabled: true,
        runCount: 2,
        lastRunAt: '2026-07-01T10:00:00.000Z',
        lastRunStatus: 'ok',
      },
    ],
    pendingApproval: {
      summary: 'Publish an Instagram post for the July launch',
      createdAt: '2026-07-01T11:00:00.000Z',
      approved: false,
    },
    alerts: [
      {
        title: 'Action is waiting for your approval',
        detail: 'Reply YES in WhatsApp to let the agent publish the prepared post.',
        level: 'warn',
      },
    ],
    lastActivityAt: '2026-07-01T11:00:00.000Z',
  })

  assert.match(html, /Your agent home/)
  assert.match(html, /What Your Agent Knows/)
  assert.match(html, /What It Can Touch/)
  assert.match(html, /Behind The Scenes/)
  assert.match(html, /Pending Approval/)
  assert.match(html, /What You Should Know/)
  assert.match(html, /Weekly ROAS digest/)
  assert.match(html, /Publish an Instagram post for the July launch/)
})
