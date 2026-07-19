export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6

export type OnboardingReadiness =
  | 'needs_profile'
  | 'needs_role'
  | 'needs_automations'
  | 'needs_connections'
  | 'needs_whatsapp'
  | 'live'

export interface OnboardingProgress {
  allowedStep: OnboardingStep
  readiness: OnboardingReadiness
  checks: {
    profile: boolean
    role: boolean
    automations: boolean
    requiredConnections: boolean
    whatsapp: boolean
  }
  missingRequiredPlatforms: string[]
}

export interface OnboardingProgressInput {
  hasProfile: boolean
  hasRole: boolean
  automationsConfigured: boolean
  requiredPlatformIds: string[]
  connections: Record<string, string | undefined>
  whatsappLinked: boolean
  /** Compatibility switch for the pre-activation-v2 hard integration gate. */
  requireConnectionsForLaunch?: boolean
}

/**
 * Derive the furthest trustworthy onboarding step from persisted state.
 *
 * The URL and the session's historical step counter are deliberately excluded:
 * either can be ahead of reality after a direct navigation, a role change, a
 * revoked OAuth grant, or a disconnected WhatsApp device.
 */
export function deriveOnboardingProgress(input: OnboardingProgressInput): OnboardingProgress {
  const missingRequiredPlatforms = input.requiredPlatformIds.filter(
    (platformId) => input.connections[platformId] !== 'connected',
  )
  const checks = {
    profile: input.hasProfile,
    role: input.hasRole,
    automations: input.automationsConfigured,
    requiredConnections: missingRequiredPlatforms.length === 0,
    whatsapp: input.whatsappLinked,
  }

  if (!checks.profile) {
    return { allowedStep: 1, readiness: 'needs_profile', checks, missingRequiredPlatforms }
  }
  if (!checks.role) {
    return { allowedStep: 2, readiness: 'needs_role', checks, missingRequiredPlatforms }
  }
  if (!checks.automations) {
    return { allowedStep: 3, readiness: 'needs_automations', checks, missingRequiredPlatforms }
  }
  if (input.requireConnectionsForLaunch && !checks.requiredConnections) {
    return { allowedStep: 4, readiness: 'needs_connections', checks, missingRequiredPlatforms }
  }
  if (!checks.whatsapp) {
    return { allowedStep: 5, readiness: 'needs_whatsapp', checks, missingRequiredPlatforms }
  }
  return { allowedStep: 6, readiness: 'live', checks, missingRequiredPlatforms }
}
