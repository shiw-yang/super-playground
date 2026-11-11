/** Minimal five-field cron expressions: parsing, validation, and the next local-time occurrence. */
export interface CronSpec {
  readonly minutes: ReadonlySet<number>
  readonly hours: ReadonlySet<number>
  readonly days: ReadonlySet<number>
  readonly months: ReadonlySet<number>
  readonly weekdays: ReadonlySet<number>
  /** Whether the day-of-month field was `*`; when both day fields are restricted, either may match. */
  readonly anyDay: boolean
  /** Whether the day-of-week field was `*`. */
  readonly anyWeekday: boolean
}
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]] as const
function numbers(field: string, min: number, max: number): Set<number> | undefined {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!match) return undefined
    const step = match[4] === undefined ? 1 : Number(match[4])
    if (step < 1) return undefined
    let start = min, end = max
    if (match[1] !== '*') {
      start = Number(match[2])
      end = match[3] === undefined ? start : Number(match[3])
    }
    if (start < min || end > max || start > end) return undefined
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return values
}
/**
 * Parse a five-field cron expression (`minute hour day-of-month month day-of-week`) in local time.
 * Fields accept `*`, a number, a range, a `step`, and comma-separated lists. `7` is accepted as Sunday.
 * @throws Error naming the bad field when the expression is not valid.
 */
export function parseCron(expression: string): CronSpec {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error('A cron expression has five fields')
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string]
  const parsed = RANGES.map(([min, max], index) => numbers(fields[index]!, min, max))
  const bad = parsed.findIndex(value => value === undefined)
  if (bad >= 0) throw new Error(`The cron field ${bad + 1} is invalid`)
  const [minutes, hours, days, months, weekdays] = parsed as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>]
  if (weekdays.has(7)) { weekdays.delete(7); weekdays.add(0) }
  return { minutes, hours, days, months, weekdays, anyDay: day === '*', anyWeekday: weekday === '*' }
}
const dayMatches = (spec: CronSpec, date: Date): boolean => {
  if (!spec.months.has(date.getMonth() + 1)) return false
  const day = spec.days.has(date.getDate()), weekday = spec.weekdays.has(date.getDay())
  return spec.anyDay ? (spec.anyWeekday || weekday) : spec.anyWeekday ? day : day || weekday
}
/**
 * The first local minute strictly after `after` at which `expression` matches.
 * @throws Error when the expression is invalid.
 */
export function nextCron(expression: string, after: Date): Date {
  const spec = parseCron(expression), candidate = new Date(after)
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)
  const firstDay = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate())
  for (let offset = 0; offset < 366 * 8; offset++) {
    const day = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + offset)
    if (!dayMatches(spec, day)) continue
    for (const hour of [...spec.hours].sort((a, b) => a - b)) {
      for (const minute of [...spec.minutes].sort((a, b) => a - b)) {
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)
        if (at.getTime() > after.getTime() && at.getTime() >= candidate.getTime()) return at
      }
    }
  }
  throw new Error('The cron expression has no occurrence in the next eight years')
}
/** Whether `expression` is a valid five-field cron expression. */
export function validCron(expression: string): boolean {
  try { parseCron(expression); return true } catch { return false }
}
