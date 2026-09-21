// Local-time helpers for the movement form. The form lets the user pick the
// movement DAY only; the time of day is always the current local time at the
// moment the movement is saved (see AGENTS.md, "Movement invariants").
import { saudiDateKey } from './saudiTime'

/** `YYYY-MM-DDTHH:mm` in the browser's local time. */
export function toLocalDateTimeInput(date: Date): string {
  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localTime.toISOString().slice(0, 16)
}

/** The date part (`YYYY-MM-DD`) of a local datetime-input string. */
export function movementDateKey(recordedAt: string): string {
  return recordedAt.slice(0, 10)
}

/** The picked day stamped with the current local time, as `YYYY-MM-DDTHH:mm`. */
export function withCurrentLocalTime(dateKey: string, now: Date): string {
  return `${dateKey}T${toLocalDateTimeInput(now).slice(11, 16)}`
}

/**
 * The instant written for the movement: the day the user picked plus the
 * current local time. Returns an invalid Date for an empty or malformed day,
 * which the caller rejects with the same message as before.
 */
export function actualMovementDate(dateKey: string, now: Date): Date {
  return new Date(withCurrentLocalTime(dateKey, now))
}

/**
 * The instant actually written for the movement, protecting the strict
 * ENTRY/EXIT sequence against a same-day backdated record. `actualMovementDate`
 * stamps the picked day with the CURRENT wall-clock time: if the previous
 * movement on the same equipment/context was recorded later today (e.g. an
 * EXIT logged yesterday evening, then an ENTRY dated yesterday but keyed in
 * this morning), the naive instant would land before it and the database
 * sequence trigger would reject the save.
 *
 * When `lastMovementRecordedAt` falls on the same Saudi calendar day as the
 * picked `dateKey` and the naive instant would not be after it, the instant is
 * bumped to one minute after the last movement (capped at `now`, since a
 * future instant is rejected elsewhere). If even that bumped instant is not
 * after the last movement (the last movement is within a minute of `now`),
 * `now` itself is returned.
 *
 * A different day, or no prior movement, returns the normal instant.
 */
export function resolveMovementInstant(
  dateKey: string,
  now: Date,
  lastMovementRecordedAt?: string | null,
): Date {
  const instant = actualMovementDate(dateKey, now)
  if (!lastMovementRecordedAt) return instant

  const lastInstant = new Date(lastMovementRecordedAt)
  if (Number.isNaN(lastInstant.getTime())) return instant
  if (dateKey !== saudiDateKey(lastInstant)) return instant
  if (instant.getTime() > lastInstant.getTime()) return instant

  const bumpedMs = Math.min(lastInstant.getTime() + 60_000, now.getTime())
  if (bumpedMs <= lastInstant.getTime()) return now
  return new Date(bumpedMs)
}
