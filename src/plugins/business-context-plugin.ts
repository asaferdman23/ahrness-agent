import { BeforeInvocationEvent } from '@strands-agents/sdk'
import type { Plugin, LocalAgent } from '@strands-agents/sdk'
import type { ClientProfile } from '../store/types.js'

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildContextXml(profile: ClientProfile): string {
  const { business, assets } = profile
  const lines: string[] = ['<business_context>']

  lines.push(`  <name>${escapeXml(business.name)}</name>`)
  lines.push(`  <industry>${escapeXml(business.industry)}</industry>`)
  if (business.description) lines.push(`  <description>${escapeXml(business.description)}</description>`)
  if (business.targetAudience) lines.push(`  <target_audience>${escapeXml(business.targetAudience)}</target_audience>`)
  if (business.brandVoice) lines.push(`  <brand_voice>${escapeXml(business.brandVoice)}</brand_voice>`)
  if (business.brandColors?.length) lines.push(`  <brand_colors>${escapeXml(business.brandColors.join(', '))}</brand_colors>`)
  if (business.goals?.length) lines.push(`  <goals>${escapeXml(business.goals.join(', '))}</goals>`)
  if (business.productCatalog) lines.push(`  <product_catalog>${escapeXml(business.productCatalog)}</product_catalog>`)

  lines.push('  <assets>')
  if (assets.website) lines.push(`    <website>${escapeXml(assets.website)}</website>`)
  if (assets.landingPages?.length) {
    for (const lp of assets.landingPages) lines.push(`    <landing_page>${escapeXml(lp)}</landing_page>`)
  }
  if (assets.instagram) {
    lines.push(`    <instagram handle="${escapeXml(assets.instagram.handle)}">${escapeXml(assets.instagram.profileUrl)}</instagram>`)
  }
  if (assets.tiktok) {
    lines.push(`    <tiktok handle="${escapeXml(assets.tiktok.handle)}">${escapeXml(assets.tiktok.profileUrl)}</tiktok>`)
  }
  if (assets.facebook) {
    lines.push(`    <facebook page_id="${escapeXml(assets.facebook.pageId)}">${escapeXml(assets.facebook.pageUrl)}</facebook>`)
  }
  if (assets.youtube) {
    lines.push(`    <youtube handle="${escapeXml(assets.youtube.handle)}">${escapeXml(assets.youtube.profileUrl)}</youtube>`)
  }
  if (assets.linkedin) {
    lines.push(`    <linkedin handle="${escapeXml(assets.linkedin.handle)}">${escapeXml(assets.linkedin.profileUrl)}</linkedin>`)
  }
  if (assets.googleBusinessProfile) {
    lines.push(`    <google_business_profile>${escapeXml(assets.googleBusinessProfile)}</google_business_profile>`)
  }
  lines.push('  </assets>')
  lines.push('</business_context>')

  return lines.join('\n')
}

const STATE_KEY = 'business_context_plugin'

/**
 * Plugin that injects <business_context> XML into the system prompt before every invocation.
 * This ensures the agent always knows the client's business profile, assets, and goals
 * without the client having to repeat themselves.
 */
export class BusinessContextPlugin implements Plugin {
  readonly name = 'ahrness:business-context'

  constructor(private readonly profile: ClientProfile) {}

  async initAgent(agent: LocalAgent): Promise<void> {
    agent.addHook(BeforeInvocationEvent, () => {
      this._inject(agent)
    })
    this._inject(agent)
  }

  private _inject(agent: LocalAgent): void {
    const xml = buildContextXml(this.profile)
    const systemPrompt = agent.systemPrompt

    const lastXml = agent.appState.get(STATE_KEY) as string | undefined

    if (typeof systemPrompt === 'string' || systemPrompt == null) {
      let current = systemPrompt ?? ''
      if (lastXml && current.includes(lastXml)) {
        current = current.replace(lastXml, '')
      }
      agent.systemPrompt = current ? `${current}\n\n${xml}` : xml
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filtered: any[] = lastXml
        ? systemPrompt.filter((b) => !(b.type === 'textBlock' && b.text === lastXml))
        : [...systemPrompt]
      filtered.push({ type: 'textBlock', text: xml })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agent.systemPrompt = filtered as any
    }

    agent.appState.set(STATE_KEY, xml)
  }
}
