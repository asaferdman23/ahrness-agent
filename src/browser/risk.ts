/**
 * Heuristic for whether a click target looks like it commits an irreversible
 * or paid action, so the browser tool can route it through the existing
 * approve-before-act confirmation gate (confirmations.ts) instead of
 * executing directly.
 */

const RISK_KEYWORDS = [
  'place order', 'confirm order', 'buy now', 'buy it now', 'complete purchase',
  'pay now', 'checkout', 'proceed to payment', 'submit payment',
  'delete account', 'permanently', 'unsubscribe', 'cancel subscription', 'close account',
]

export function isLikelyIrreversibleAction(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  if (!normalized) return false
  return RISK_KEYWORDS.some((keyword) => normalized.includes(keyword))
}
