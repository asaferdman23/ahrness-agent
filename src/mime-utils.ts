/** Shared by telegram-client.ts and slack-transport.ts for naming uploaded media. */
export function extensionForMime(mimeType: string): string {
  const subtype = mimeType.split('/', 2)[1]?.split(';', 1)[0]?.toLowerCase() ?? 'bin'
  const aliases: Record<string, string> = { jpeg: 'jpg', quicktime: 'mov', mpeg: 'mp3', plain: 'txt' }
  return aliases[subtype] ?? (subtype.replace(/[^a-z0-9]+/g, '') || 'bin')
}
