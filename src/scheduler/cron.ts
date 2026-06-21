/**
 * Tiny, dependency-free cron evaluator.
 *
 * Supports standard 5-field expressions: `minute hour day-of-month month day-of-week`.
 * Each field accepts `*`, single values, `a-b` ranges, `a,b,c` lists, and `* /n` or
 * `a-b/n` steps. Day-of-week is 0–6 with Sunday = 0 (7 also accepted for Sunday).
 *
 * Expressions are matched against a wall-clock minute in a given IANA timezone, so a
 * job authored as "0 9 * * 1" fires at 09:00 local time regardless of the host clock.
 */

const FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday)
]

function parseField(raw: string, index: number): Set<number> {
  const [min, max] = FIELD_RANGES[index]!
  const allowed = new Set<number>()

  for (const part of raw.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number.parseInt(stepPart, 10)
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step in "${raw}"`)

    let lo: number
    let hi: number
    if (rangePart === '*' || rangePart === undefined) {
      lo = min
      hi = max
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-')
      lo = Number.parseInt(a!, 10)
      hi = Number.parseInt(b!, 10)
    } else {
      lo = hi = Number.parseInt(rangePart, 10)
    }

    if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`Invalid cron field "${raw}"`)
    // Day-of-week: normalise 7 → 0 (both mean Sunday).
    if (index === 4) {
      if (lo === 7) lo = 0
      if (hi === 7) hi = 0
    }
    if (lo > hi) throw new Error(`Inverted cron range "${rangePart}"`)
    if (lo < min || hi > max) throw new Error(`Cron field "${raw}" out of range [${min}-${max}]`)

    for (let v = lo; v <= hi; v += step) allowed.add(v)
  }

  return allowed
}

export interface ParsedCron {
  minute: Set<number>
  hour: Set<number>
  dayOfMonth: Set<number>
  month: Set<number>
  dayOfWeek: Set<number>
  /** True when both day-of-month and day-of-week were explicitly restricted. */
  domAndDowRestricted: boolean
}

export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error(`Cron expression must have 5 fields, got ${fields.length}: "${expr}"`)
  return {
    minute: parseField(fields[0]!, 0),
    hour: parseField(fields[1]!, 1),
    dayOfMonth: parseField(fields[2]!, 2),
    month: parseField(fields[3]!, 3),
    dayOfWeek: parseField(fields[4]!, 4),
    domAndDowRestricted: fields[2] !== '*' && fields[4] !== '*',
  }
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr)
    return true
  } catch {
    return false
  }
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

interface WallClock {
  minute: number
  hour: number
  dayOfMonth: number
  month: number
  dayOfWeek: number
}

/** Break a moment into wall-clock fields for the given IANA timezone. */
function wallClockIn(date: Date, timezone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(date)

  const lookup = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  // Intl renders midnight as "24" in some engines; normalise to 0.
  const hour = Number.parseInt(lookup('hour'), 10) % 24
  return {
    minute: Number.parseInt(lookup('minute'), 10),
    hour,
    dayOfMonth: Number.parseInt(lookup('day'), 10),
    month: Number.parseInt(lookup('month'), 10),
    dayOfWeek: WEEKDAY_INDEX[lookup('weekday')] ?? 0,
  }
}

/**
 * Does `expr` fire during the wall-clock minute of `date` in `timezone`?
 * Follows Vixie-cron semantics: when both day-of-month and day-of-week are
 * restricted, a match on either is sufficient.
 */
export function cronMatches(expr: string, date: Date, timezone: string): boolean {
  const cron = parseCron(expr)
  const wc = wallClockIn(date, timezone)

  if (!cron.minute.has(wc.minute)) return false
  if (!cron.hour.has(wc.hour)) return false
  if (!cron.month.has(wc.month)) return false

  const domMatch = cron.dayOfMonth.has(wc.dayOfMonth)
  const dowMatch = cron.dayOfWeek.has(wc.dayOfWeek)
  return cron.domAndDowRestricted ? domMatch || dowMatch : domMatch && dowMatch
}
