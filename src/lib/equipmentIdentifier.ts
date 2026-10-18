/**
 * The physical identifier shown next to the equipment code in the admin log
 * and visits tables (owner request 2026-10-18): the plate number when the
 * unit has one, else the chassis number, else nothing. Both views expose the
 * plate (`equipment_plate_number`); only `movement_log_search` also exposes
 * the chassis, so a visits row without a plate shows nothing until the view
 * carries the chassis too.
 */
export function equipmentIdentifier(row: {
  equipment_plate_number?: string | null
  equipment_chassis_number?: string | null
}): string | null {
  const plate = row.equipment_plate_number?.trim()
  if (plate) return plate
  const chassis = row.equipment_chassis_number?.trim()
  return chassis ? chassis : null
}
