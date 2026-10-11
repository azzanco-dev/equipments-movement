/**
 * wave-19-driver-current-name: which driver name a screen shows.
 *
 * Every movement stores a `driver_name` SNAPSHOT when it is recorded, and a
 * driver change stores `previous_driver_name` / `new_driver_name`. When the
 * driver record is corrected later, the snapshot keeps the old spelling. The
 * owner decided (2026-10-11) that a row linked to a driver record shows that
 * record's CURRENT `drivers.full_name`; the snapshot stays in the database
 * and is shown only for legacy rows that carry a name and no `driver_id`.
 *
 * The current name reaches the client as `driver_full_name` (the list views
 * since migration 0124, or an embed / lookup for screens that read
 * `entry_exit_logs` directly) and, for a change, as `new_driver_full_name` /
 * `previous_driver_full_name` (resolved by `loadDriverChanges` or an embed).
 *
 * Pure, so `tests/wave19DriverName.test.cjs` exercises it without React.
 */

/** A trimmed name, or `null` for a missing or blank one. */
function cleanName(value: string | null | undefined): string | null {
  const name = value?.trim()
  return name ? name : null
}

/**
 * The record's current name when the row is linked to one, else the stored
 * snapshot; `null` when neither has text.
 */
export function preferRecordName(
  recordName: string | null | undefined,
  snapshot: string | null | undefined,
): string | null {
  return cleanName(recordName) ?? cleanName(snapshot)
}

/** The driver fields a movement or visit row may carry. */
export interface DriverNameFields {
  /**
   * The driver of a later driver change of the visit (already resolved to
   * that change's driver record); set only when a change exists.
   */
  current_driver_name?: string | null
  /** The current `drivers.full_name` of the row's own `driver_id`. */
  driver_full_name?: string | null
  /** The snapshot stored on the row when it was recorded. */
  driver_name?: string | null
}

/**
 * The driver name a screen, export or print shows for a row, in this order:
 *   1. `current_driver_name`: a later driver change of the visit wins (the
 *      entry driver is immutable; a change is how the visit's driver moves on);
 *   2. `driver_full_name`: the row's own driver record, as it reads today;
 *   3. `driver_name`: the snapshot, for legacy rows without a record.
 * Empty when the row has no driver at all.
 */
export function displayDriverName(row: DriverNameFields): string {
  return (
    cleanName(row.current_driver_name) ??
    preferRecordName(row.driver_full_name, row.driver_name) ??
    ''
  )
}

/** The new-driver fields of a `movement_driver_changes` row. */
export interface ChangeNewDriverFields {
  new_driver_name?: string | null
  /** The current `drivers.full_name` of `new_driver_id`. */
  new_driver_full_name?: string | null
}

/** The new driver of a change: its record's current name, else its snapshot. */
export function changeNewDriverName(
  change: ChangeNewDriverFields | null | undefined,
): string | null {
  if (!change) return null
  return preferRecordName(change.new_driver_full_name, change.new_driver_name)
}

/** The previous-driver fields of a `movement_driver_changes` row. */
export interface ChangePreviousDriverFields {
  previous_driver_name?: string | null
  /** The current `drivers.full_name` of `previous_driver_id`. */
  previous_driver_full_name?: string | null
}

/** The previous driver of a change: its record's current name, else its snapshot. */
export function changePreviousDriverName(
  change: ChangePreviousDriverFields | null | undefined,
): string | null {
  if (!change) return null
  return preferRecordName(
    change.previous_driver_full_name,
    change.previous_driver_name,
  )
}

/**
 * The `full_name` of a PostgREST to-one embed (`driver:drivers(full_name)`),
 * which arrives as an object, an array of one, or `null`.
 */
export function embeddedFullName(
  embed:
    | { full_name?: string | null }
    | { full_name?: string | null }[]
    | null
    | undefined,
): string | null {
  const record = Array.isArray(embed) ? embed[0] : embed
  return cleanName(record?.full_name)
}
