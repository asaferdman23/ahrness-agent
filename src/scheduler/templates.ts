import type { RoleId } from '../store/types.js'
import type { SchedulerTemplate } from './types.js'

/**
 * Pre-built automations offered per role. Each one becomes a recurring job that
 * invokes the client's agent with `prompt` and delivers the result over WhatsApp.
 *
 * Cron expressions are evaluated in the client's timezone (see AGENT_TIMEZONE).
 * Keep prompts WhatsApp-friendly — the agent already knows to stay concise.
 */
export const SCHEDULER_TEMPLATES: SchedulerTemplate[] = [
  // ── Marketing Manager ───────────────────────────────────────────────────────
  {
    id: 'mm-weekly-digest',
    roles: ['marketing-manager'],
    emoji: '📈',
    title: 'Weekly performance digest',
    description: 'Every Monday morning, a cross-channel summary of last week: spend, leads, ROAS, and what to do next.',
    cron: '0 9 * * 1',
    cadence: 'Every Monday, 9:00',
    prompt:
      'Produce this week\'s marketing performance digest across every connected channel (paid + organic). ' +
      'Compare against the client\'s stated goals, call out the single biggest win and the biggest leak, and ' +
      'recommend up to 3 concrete actions for the coming week. Keep it tight for WhatsApp.',
  },
  {
    id: 'mm-monthly-budget',
    roles: ['marketing-manager'],
    emoji: '💰',
    title: 'Monthly budget review',
    description: 'On the 1st, review budget allocation vs. results and propose reallocations for the month ahead.',
    cron: '0 9 1 * *',
    cadence: '1st of the month, 9:00',
    prompt:
      'Run a monthly budget review. Show how last month\'s spend mapped to results per channel/campaign, flag ' +
      'overspend with weak return, and propose a reallocation for this month with expected impact. Be specific.',
  },
  {
    id: 'mm-daily-pulse',
    roles: ['marketing-manager'],
    emoji: '🩺',
    title: 'Daily anomaly pulse',
    description: 'Each morning, a quick scan for anything off — spend spikes, ROAS drops, stalled campaigns.',
    cron: '0 8 * * *',
    cadence: 'Every day, 8:00',
    prompt:
      'Scan all connected channels for anomalies since yesterday: spend spikes, ROAS or CTR drops, campaigns ' +
      'that stalled or hit limits. If nothing is wrong, say so in one line. Otherwise list each issue with a fix.',
  },

  // ── Client Reporting (agency wedge) ──────────────────────────────────────────
  {
    id: 'client-weekly-report',
    roles: ['marketing-manager', 'ads-analyst'],
    emoji: '📄',
    title: 'Weekly client report (auto-delivered)',
    description:
      'Every Monday, a polished, client-ready performance report compiled across all connected channels and delivered as a document.',
    cron: '0 8 * * 1',
    cadence: 'Every Monday, 8:00',
    prompt:
      'Compile this client\'s weekly performance report across every connected channel (Meta Ads, Instagram, ' +
      'TikTok, Google Analytics/Search Console). For each: key metrics and the change vs. the prior week. ' +
      'Open with a 3-bullet executive summary, then per-channel detail, then up to 3 recommended actions. ' +
      'Reference what we recommended last week and whether it moved the numbers — make it feel like a continuing ' +
      'relationship, not a cold dump. Build it as a clean Markdown document in the sandbox, convert it to a PDF, ' +
      'and call publish_output so it is delivered as a downloadable file. In the WhatsApp message, send only the ' +
      'executive summary and note that the full report is attached.',
  },

  // ── Ads Analyst ─────────────────────────────────────────────────────────────
  {
    id: 'aa-daily-roas',
    roles: ['ads-analyst'],
    emoji: '📊',
    title: 'Daily ROAS report',
    description: 'Every morning, yesterday\'s ad performance with ROAS, CPA, and the one change to make today.',
    cron: '0 8 * * *',
    cadence: 'Every day, 8:00',
    prompt:
      'Generate yesterday\'s Meta Ads performance report: spend, ROAS, CPA, and top/bottom performers. ' +
      'End with the single highest-leverage change to make today and your confidence level.',
  },
  {
    id: 'aa-weekly-reallocation',
    roles: ['ads-analyst'],
    emoji: '🔀',
    title: 'Weekly budget reallocation',
    description: 'Mondays, a ranked list of where to shift budget based on last week\'s efficiency.',
    cron: '0 9 * * 1',
    cadence: 'Every Monday, 9:00',
    prompt:
      'Based on last week\'s efficiency, produce a ranked budget-reallocation plan: which ad sets to scale, ' +
      'which to cut, and the expected ROAS impact of each move.',
  },
  {
    id: 'aa-spend-watch',
    roles: ['ads-analyst'],
    emoji: '🚨',
    title: 'Spend & CPA watchdog',
    description: 'Every 6 hours, flag CPA spikes or runaway spend before they burn the budget.',
    cron: '0 */6 * * *',
    cadence: 'Every 6 hours',
    prompt:
      'Check active campaigns for CPA spikes or unusually fast spend in the last 6 hours. Only message if ' +
      'something needs attention — name the campaign, the anomaly, and the recommended action. If all is healthy, stay brief.',
  },

  // ── Creative Director ───────────────────────────────────────────────────────
  {
    id: 'cd-weekly-concepts',
    roles: ['creative-director'],
    emoji: '🎨',
    title: 'Weekly creative concepts',
    description: 'Mondays, three fresh on-brand creative concepts (hook + visual direction) for the week.',
    cron: '0 10 * * 1',
    cadence: 'Every Monday, 10:00',
    prompt:
      'Propose 3 fresh, on-brand creative concepts for this week. For each: a hook line, the visual direction, ' +
      'and the best placement (feed/story/reel). Respect the brand voice and colors from the business profile.',
  },
  {
    id: 'cd-friday-batch',
    roles: ['creative-director'],
    emoji: '🗂️',
    title: 'Next-week content batch',
    description: 'Friday afternoons, a ready-to-produce shortlist of creatives for the coming week.',
    cron: '0 14 * * 5',
    cadence: 'Every Friday, 14:00',
    prompt:
      'Plan next week\'s creative batch: list the assets worth producing, each with a one-line brief and format. ' +
      'Offer to generate the first one now.',
  },

  // ── Social Media Manager ────────────────────────────────────────────────────
  {
    id: 'sm-daily-engagement',
    roles: ['social-media-manager'],
    emoji: '💬',
    title: 'Daily engagement snapshot',
    description: 'Each morning, yesterday\'s organic performance and any comments worth replying to.',
    cron: '0 9 * * *',
    cadence: 'Every day, 9:00',
    prompt:
      'Summarise yesterday\'s organic performance on the connected social channels: top post, follower change, ' +
      'and notable engagement. Surface any comments or DMs that deserve a reply today.',
  },
  {
    id: 'sm-weekly-calendar',
    roles: ['social-media-manager'],
    emoji: '🗓️',
    title: 'Weekly content calendar',
    description: 'Sunday evenings, a draft posting calendar for the week with captions and hashtags.',
    cron: '0 17 * * 0',
    cadence: 'Every Sunday, 17:00',
    prompt:
      'Draft next week\'s content calendar: one idea per planned slot across a healthy mix of educational, ' +
      'inspirational, and promotional pillars. Include ready-to-publish captions and hashtag sets.',
  },

  // ── Personal Assistant / Developer ──────────────────────────────────────────
  {
    id: 'pa-morning-briefing',
    roles: ['personal-assistant-dev'],
    emoji: '☀️',
    title: 'Morning briefing',
    description: 'Each morning, a short briefing: today\'s priorities and any reminders you\'ve set.',
    cron: '0 8 * * *',
    cadence: 'Every day, 8:00',
    prompt:
      'Give me a short morning briefing: today\'s likely priorities based on our recent conversations and any ' +
      'reminders or follow-ups I asked you to track. Keep it to a few lines.',
  },
  {
    id: 'pa-eod-summary',
    roles: ['personal-assistant-dev'],
    emoji: '🌙',
    title: 'End-of-day wrap-up',
    description: 'Evenings, a wrap-up of what got done and what to carry into tomorrow.',
    cron: '0 18 * * *',
    cadence: 'Every day, 18:00',
    prompt:
      'Wrap up the day: what we covered, anything still open, and what to carry into tomorrow. Be concise.',
  },
  {
    id: 'pa-weekly-review',
    roles: ['personal-assistant-dev'],
    emoji: '🧭',
    title: 'Weekly review',
    description: 'Friday afternoons, a review of the week and a plan for the next one.',
    cron: '0 17 * * 5',
    cadence: 'Every Friday, 17:00',
    prompt:
      'Run a weekly review: highlights, what slipped, and a simple plan for next week. End with the single most ' +
      'important thing to focus on.',
  },
]

const byId = new Map(SCHEDULER_TEMPLATES.map((t) => [t.id, t]))

export function getTemplate(id: string): SchedulerTemplate | undefined {
  return byId.get(id)
}

export function getTemplatesForRole(roleId: RoleId): SchedulerTemplate[] {
  return SCHEDULER_TEMPLATES.filter((t) => t.roles.includes(roleId))
}
