/** GitHub REST rate-limit headers, the wait they require, and the rejection that reports them; shared by the GitHub Source and setup. */
import { CliError } from './commands.ts'

/** One response's rate-limit headers; a field is absent when the response did not carry it, as in reads without `--include`. */
export interface RateLimit { remaining?: number; reset?: number; retryAfter?: number }
/** How long a rate-limit rejection without a usable reset waits before the next attempt. */
export const RATE_LIMIT_FALLBACK_MS = 60_000
/** GitHub's primary window is an hour; a reset further away than that is a clock skew and is waited out no longer than this. */
const MAX_WAIT_MS = 3_600_000 + 60_000
const HTTP_ERROR = /\bHTTP (\d{3})\b/
const LIMIT_TEXT = /rate limit|abuse detection/i
const header = (headers: string, name: string): number | undefined => {
  const value = new RegExp(`^${name}:\\s*(\\d+)\\s*$`, 'im').exec(headers)?.[1]
  return value === undefined ? undefined : Number(value)
}
/** Reads the rate-limit headers of one `gh api --include` response. */
export function rateLimitHeaders(headers: string): RateLimit {
  return { remaining: header(headers, 'x-ratelimit-remaining'), reset: header(headers, 'x-ratelimit-reset'),
    retryAfter: header(headers, 'retry-after') }
}
/**
 * True when GitHub rejected a call for a primary or secondary rate limit; another 403, such as a permission problem, is not one.
 * The status comes from the parsed error code, or from the `(HTTP 403)` in a rejection a worker probe passes through as text.
 */
export function rateLimited(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  const status = error instanceof CliError && error.code ? error.code : Number(HTTP_ERROR.exec(text)?.[1] ?? 0)
  return (status === 403 || status === 429) && LIMIT_TEXT.test(text)
}
/** Milliseconds to wait before the next GitHub call, or `undefined` when the response did not report a rate limit. */
export function rateLimitWait(limit: RateLimit, now = Date.now()): number | undefined {
  const wait = limit.retryAfter !== undefined ? Math.max(limit.retryAfter, 1) * 1000
    : limit.remaining === 0 && limit.reset !== undefined ? Math.max(limit.reset * 1000 - now, 0) : undefined
  // Waiting one second past the reset keeps the next call from landing in the closing window again.
  return wait === undefined ? undefined : Math.min(wait, MAX_WAIT_MS) + 1000
}
/** Reads the reset of `gh api rate_limit`, which does not spend the primary budget; GitHub returns it as `rate`. */
export function rateLimitOf(value: unknown): RateLimit | undefined {
  const rate = (value as { rate?: { remaining?: unknown; reset?: unknown } } | null | undefined)?.rate
  if (typeof rate !== 'object' || rate === null) return undefined
  const remaining = typeof rate.remaining === 'number' ? rate.remaining : undefined
  const reset = typeof rate.reset === 'number' ? rate.reset : undefined
  return remaining === undefined && reset === undefined ? undefined : { remaining, reset }
}
