/**
 * Per-client flag that disables browser_screenshot for the narrow window
 * during which browser_login is actively typing a real password into a page
 * — closes the (small but real) chance a screenshot/vision-analysis call
 * mid-login could expose a password character or a "show password" toggle.
 */
const disabledClients = new Set<string>()

export function disableVision(clientId: string): void {
  disabledClients.add(clientId)
}

export function enableVision(clientId: string): void {
  disabledClients.delete(clientId)
}

export function isVisionDisabled(clientId: string): boolean {
  return disabledClients.has(clientId)
}
