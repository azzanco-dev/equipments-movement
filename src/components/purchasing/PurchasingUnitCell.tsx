import { EquipmentIdentifierTag } from '@/components/data-list/EquipmentIdentifierTag'
import type { PurchasingUnit } from '@/lib/purchasingData'

/**
 * A unit on a purchasing screen: the code with the plate or chassis tag
 * beside it (the log tables' tag), and the type under it when asked.
 */
export function PurchasingUnitCell({
  unit,
  withType = false,
}: {
  unit: Pick<
    PurchasingUnit,
    'code' | 'type' | 'plate_number' | 'chassis_number'
  > | null
  withType?: boolean
}) {
  if (!unit) return <span className="text-muted">—</span>
  return (
    <span className="flex min-w-0 flex-col text-start">
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <bdi dir="ltr" className="font-semibold">
          {unit.code}
        </bdi>
        <EquipmentIdentifierTag
          row={{
            equipment_plate_number: unit.plate_number,
            equipment_chassis_number: unit.chassis_number,
          }}
        />
      </span>
      {withType && <span className="text-xs text-muted">{unit.type}</span>}
    </span>
  )
}
