// Local-time helpers for the movement form. The form lets the user pick the
// movement DAY only; the time of day is always the current local time at the
// moment the movement is saved (see AGENTS.md, "Movement invariants").

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
