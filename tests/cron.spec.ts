/** Five-field cron parsing and next-occurrence calculation used by the Watchdog task list. */
import { expect, it } from 'vitest'
import { nextCron, parseCron, validCron } from '../src/cron.ts'

const local = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute, 30)

it('parses the supported field forms and rejects bad ones', () => {
  expect(parseCron('*/15 9-17 1,15 * 1-5')).toEqual(expect.objectContaining({ anyDay: false, anyWeekday: false }))
  expect([...parseCron('0 9 * * 7').weekdays]).toEqual([0])
  expect(validCron('*/15 * * * *')).toBe(true)
  expect(validCron('60 * * * *')).toBe(false)
  expect(validCron('* * * *')).toBe(false)
  expect(() => nextCron('nope', local(2026, 11, 11, 10))).toThrow()
})

it('returns the next local minute, day and weekday', () => {
  expect(nextCron('*/15 * * * *', local(2026, 11, 11, 10))).toEqual(new Date(2026, 10, 11, 10, 15, 0))
  expect(nextCron('0 9 * * *', local(2026, 11, 11, 10))).toEqual(new Date(2026, 10, 12, 9, 0, 0))
  expect(nextCron('0 9 * * 1', local(2026, 11, 11, 10))).toEqual(new Date(2026, 10, 16, 9, 0, 0))
  expect(nextCron('0 9 * * 1', local(2026, 10, 9, 10))).toEqual(new Date(2026, 9, 12, 9, 0, 0))
})

it('matches a day when either a restricted day-of-month or weekday matches', () => {
  // The 15th is a Sunday in November 2026; the 1st is a Sunday and a Wednesday is a different day.
  expect(nextCron('0 9 15 * 1', local(2026, 11, 11, 10))).toEqual(new Date(2026, 10, 15, 9, 0, 0))
  expect(nextCron('0 9 1 * 1', local(2026, 11, 11, 10))).toEqual(new Date(2026, 10, 16, 9, 0, 0))
})
