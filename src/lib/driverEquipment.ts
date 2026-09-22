/**
 * Related equipment on the driver detail page.
 *
 * `driver_equipment_summary` (migration 0092) is a `security_invoker` view that
 * derives, per (driver_id, equipment_id), how many site ENTRY visits the driver
 * drove that equipment on, when he last drove it, and whether he is driving it
 * right now. The database is the only place that rule lives; everything here is
 * pure shaping so it can be unit tested without React or Supabase.
 *
 * Legacy movements that carry only the `driver_name` snapshot have no
 * `driver_id`, so the view cannot attribute them to a driver record and this
 * section never claims it counted them.
 */

export const DRIVER_EQUIPMENT_SUMMARY_VIEW = 'driver_equipment_summary'

/** Only the columns the section renders; never `select('*')`. */
export const DRIVER_EQUIPMENT_SELECT =
  'equipment_id,equipment_code,equipment_type,equipment_plate_number,times_driven,last_driven_at,is_current'

/** Detail pages show a short recent slice plus a "view all" route. */
export const DRIVER_EQUIPMENT_LIMIT = 20

export interface DriverEquipmentSummaryRow {
  equipment_id: string | null
  equipment_code: string | null
  equipment_type: string | null
  equipment_plate_number: string | null
  times_driven: number | null
  last_driven_at: string | null
  is_current: boolean | null
}

export interface DriverEquipmentItem {
  equipmentId: string
  code: string | null
  type: string | null
  plateNumber: string | null
  timesDriven: number
  lastDrivenAt: string | null
  isCurrent: boolean
}

/**
 * "View all" target for the driver page: the admin movement log pre-filtered to
 * this driver.
 *
 * Limitation, deliberate: `movementsListConfig` only exposes a `driver_name`
 * filter (and a `driver_name` search field) — there is no `driver_id` filter
 * field — so the link can only carry the driver's *name*. It therefore matches
 * the `driver_name` snapshot stored on each movement, which means it also
 * returns legacy rows recorded under that name, cannot separate two drivers who
 * share a name, and misses movements recorded before the driver was renamed.
 * The counts in the section itself are exact because they come from
 * `driver_id`; only this link is name-based. Adding a `driver_id` filter field
 * to the movements list is the follow-up that would remove the limitation.
 */
export function buildDriverMovementsHref(fullName: string): string {
  const name = fullName.trim()
  if (!name) return '/logs'
  const filters = JSON.stringify([
    { id: 'driver', field: 'driver_name', operator: 'eq', value: name },
  ])
  return `/logs?filters=${encodeURIComponent(filters)}`
}

/** Query-string key that opens the driver detail dialog on the drivers list. */
export const DRIVER_DIALOG_QUERY_PARAM = 'driver'

/** URL for the drivers list with the detail dialog open on this driver. Also
 *  the redirect target for the retired standalone `/drivers/:id` page. */
export function buildDriverDialogHref(driverId: string): string {
  return `/drivers?${DRIVER_DIALOG_QUERY_PARAM}=${encodeURIComponent(driverId)}`
}

/**
 * Reads the open dialog's driver id from the drivers list URL search params.
 * Takes anything with a `.get`, so it works with both `URLSearchParams` and
 * Next's `ReadonlyURLSearchParams`. A missing or blank param returns null so
 * callers never try to open a dialog for an empty id.
 */
export function driverIdFromSearchParams(
  params: { get(name: string): string | null } | null | undefined,
): string | null {
  const value = params?.get(DRIVER_DIALOG_QUERY_PARAM)
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function positiveCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return 0
  return Math.trunc(value)
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * One view row to the shape the table renders. Display columns can be NULL
 * when the caller's RLS hides the equipment master row, so every field is
 * normalized and the table falls back to a dash.
 */
export function mapDriverEquipmentRow(
  row: DriverEquipmentSummaryRow,
): DriverEquipmentItem {
  return {
    equipmentId: text(row.equipment_id) ?? '',
    code: text(row.equipment_code),
    type: text(row.equipment_type),
    plateNumber: text(row.equipment_plate_number),
    timesDriven: positiveCount(row.times_driven),
    lastDrivenAt: text(row.last_driven_at),
    isCurrent: row.is_current === true,
  }
}

/**
 * Maps and drops rows that carry no equipment id — such a row cannot be opened
 * and would only render an empty line.
 *
 * The order is the one the query already asked PostgreSQL for
 * (`is_current desc, last_driven_at desc`); it is re-applied here so the list
 * stays deterministic even if the transport reorders equal rows, with the
 * equipment id as the final tie-break.
 */
export function mapDriverEquipmentRows(
  rows: DriverEquipmentSummaryRow[] | null | undefined,
): DriverEquipmentItem[] {
  return (rows ?? [])
    .map(mapDriverEquipmentRow)
    .filter((item) => item.equipmentId !== '')
    .sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      const left = a.lastDrivenAt ?? ''
      const right = b.lastDrivenAt ?? ''
      if (left !== right) return left < right ? 1 : -1
      return a.equipmentId < b.equipmentId ? -1 : 1
    })
}
