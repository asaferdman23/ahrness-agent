export interface SiteProfile {
  domain: string
  displayName: string
  loginUrl: string
}

const profiles: SiteProfile[] = [
  { domain: 'linkedin.com', displayName: 'LinkedIn', loginUrl: 'https://www.linkedin.com/login' },
  { domain: 'instagram.com', displayName: 'Instagram', loginUrl: 'https://www.instagram.com/accounts/login/' },
  { domain: 'facebook.com', displayName: 'Facebook', loginUrl: 'https://www.facebook.com/login' },
  { domain: 'reddit.com', displayName: 'Reddit', loginUrl: 'https://www.reddit.com/login' },
]

const profileMap = new Map<string, SiteProfile>(profiles.map((p) => [p.domain, p]))

export function getSiteProfile(domain: string): SiteProfile | null {
  return profileMap.get(domain) ?? null
}

export function getAllSiteProfiles(): SiteProfile[] {
  return profiles
}
