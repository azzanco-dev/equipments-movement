import { useI18n } from '@/i18n/I18nContext'
import { equipmentSupplierLine } from '@/lib/equipmentSupplier'

/**
 * The supplier of an «مالك اخر» unit as one small muted line inside the
 * equipment cell of the admin log and visits tables (owner request
 * 2026-10-15): no new column, so the tables keep their width. Renders nothing
 * for any other owner or a unit without a supplier.
 */
export function EquipmentSupplierLine({
  row,
}: {
  row: {
    equipment_ownership_status?: string | null
    equipment_lessor_name?: string | null
  }
}) {
  const { t } = useI18n()
  const name = equipmentSupplierLine(row)
  if (!name) return null
  return (
    <span className="block text-xs text-muted">
      {t('equipmentSupplierLine').replace('{name}', name)}
    </span>
  )
}
