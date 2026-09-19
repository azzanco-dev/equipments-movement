/**
 * Option mapping for the site ENTRY driver selector.
 *
 * The label carries the driver's name and one muted secondary line carries the
 * identifiers a foreman recognises the driver by:
 *
 *   الاسم
 *   رقم الاقامة · الجوال
 *
 * Whichever identifier is missing is dropped, and the line disappears when both
 * are missing. Pure on purpose, so it is covered by tests without React.
 */
export interface DriverOptionRow {
  id: string
  full_name: string
  name_en?: string | null
  id_number?: string | null
  mobile_number?: string | null
}

export interface DriverOption {
  value: string
  label: string
  /** ONE secondary line, muted, under the label. */
  description?: string
}

/** `رقم الاقامة · الجوال`, or undefined when neither value exists. */
export function driverOptionDescription(
  idNumber: string | null | undefined,
  mobileNumber: string | null | undefined,
): string | undefined {
  const parts = [idNumber, mobileNumber]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

export function driverOption(row: DriverOptionRow): DriverOption {
  const nameEn = row.name_en?.trim()
  const option: DriverOption = {
    value: row.id,
    label: nameEn ? `${row.full_name} — ${nameEn}` : row.full_name,
  }
  const description = driverOptionDescription(row.id_number, row.mobile_number)
  if (description) option.description = description
  return option
}
