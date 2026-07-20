export type PlatformId = 'meta-ads' | 'instagram-graph' | 'tiktok' | 'google' | 'higgsfield'
export type WhatsAppProvider = 'twilio' | 'baileys'

export type RoleId =
  | 'marketing-manager'
  | 'creative-director'
  | 'ads-analyst'
  | 'social-media-manager'
  | 'gtm-operator'
  | 'personal-assistant-dev'

export type GoalType =
  | 'generate_leads'
  | 'increase_roas'
  | 'grow_instagram'
  | 'grow_tiktok'
  | 'increase_sales'
  | 'brand_awareness'

export interface ConnectionRecord {
  status: 'connected' | 'pending' | 'error'
  accessToken: string | null
  refreshToken?: string
  tokenExpiresAt: string | null
  connectedAt: string
  scopes?: string[]
  /** Instagram user ID, stored at connect time */
  userId?: string
}

export type ConnectionsRecord = Partial<Record<PlatformId, ConnectionRecord>>

export interface ClientProfile {
  clientId: string
  whatsappJid: string
  createdAt: string
  business: {
    name: string
    industry: string
    description?: string
    goals: GoalType[]
    targetAudience?: string
    brandVoice?: string
    brandColors?: string[]
    productCatalog?: string
  }
  assets: {
    website?: string
    landingPages?: string[]
    instagram?: { handle: string; profileUrl: string }
    tiktok?: { handle: string; profileUrl: string }
    facebook?: { pageId: string; pageUrl: string }
    youtube?: { handle: string; profileUrl: string } | null
    linkedin?: { handle: string; profileUrl: string } | null
    googleBusinessProfile?: string
  }
}

export interface OnboardingPreview {
  headline: string
  insight: string
  opportunities: [string, string, string]
  suggestedFirstBrief: string
  generatedAt: string
  source: 'ai' | 'fallback'
}

export interface RoleRecord {
  roleId: RoleId
  assignedAt: string
  skillOverrides: { disabled: string[]; extra: string[] }
  mcpOverrides: { disabled: PlatformId[]; extra: PlatformId[] }
  /** Scheduler template ids the client switched on during onboarding. */
  scheduleTemplates?: string[]
}

/** Small per-client runtime flags not tied to profile/role/connections. */
export interface ClientMeta {
  /** ISO timestamp of the one-time onboarding nudge sent to an un-onboarded sender. */
  onboardingNudgedAt?: string
  /** Transport this client chose or last used for WhatsApp delivery. */
  whatsappProvider?: WhatsAppProvider
  /** Per-client Baileys home group for customer-facing group-only mode. */
  baileysHomeGroupJid?: string
  /** Display-only group title captured when the user confirms the group. */
  baileysHomeGroupSubject?: string
  /** ISO timestamp for when the Baileys home group was first bound. */
  baileysHomeGroupBoundAt?: string
  /** Telegram chat id bound via the shared platform bot's /start deep link (see telegram-shared-bot.ts). */
  telegramChatId?: string
  /** ISO timestamp for when the Telegram chat was bound. */
  telegramChatBoundAt?: string
  /** Slack team id, set once the client installs the app into their workspace (see slack-store.ts). */
  slackTeamId?: string
  /** ISO timestamp for when the Slack workspace was connected. */
  slackConnectedAt?: string
}

export interface OnboardingSession {
  sessionId: string
  step: number
  /** Runtime client key (sha256 of the JID) once adopted from a signed link. */
  clientId?: string
  /** Raw WhatsApp JID this onboarding belongs to, from the signed link. */
  whatsappJid?: string
  /** Preferred WhatsApp transport chosen during onboarding. */
  whatsappProvider?: WhatsAppProvider
  /** Short code the client sends to the Twilio number to bind this web session. */
  whatsappConnectCode?: string
  profile?: ClientProfile
  /** Cached first-value preview, invalidated when the saved profile changes. */
  preview?: OnboardingPreview
  previewProfileFingerprint?: string
  /** ISO timestamps used to enforce the per-session preview attempt limit. */
  previewAttempts?: string[]
  roleId?: RoleId
  /** Simplified per-platform status strings used during the onboarding flow */
  connections: Partial<Record<PlatformId, string>>
  whatsappLinked: boolean
  createdAt: string
  updatedAt: string
}
