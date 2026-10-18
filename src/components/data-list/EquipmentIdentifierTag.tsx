import { equipmentIdentifier } from '@/lib/equipmentIdentifier'

/**
 * The plate number (or, without one, the chassis number) rendered as a small
 * muted tag beside the equipment code in the admin log and visits tables
 * (owner request 2026-10-18). `bdi` keeps an Arabic plate and a Latin chassis
 * each in its own direction inside the RTL cell. Renders nothing when the
 * unit has neither.
 */
export function EquipmentIdentifierTag({
  row,
}: {
  row: {
    equipment_plate_number?: string | null
    equipment_chassis_number?: string | null
  }
}) {
  const value = equipmentIdentifier(row)
  if (!value) return null
  return (
    <bdi className="text-xs font-normal text-muted" title={value}>
      {value}
    </bdi>
  )
}
