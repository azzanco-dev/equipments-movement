import { Badge } from '@/components/ui/Badge'
import { useI18n } from '@/i18n/I18nContext'

/**
 * The small «جديدة» mark of an equipment created within the last 7 days
 * (`equipment_is_new` / `admin_equipment_state.is_new`, migration 0129).
 * Owner decision 2026-10-14: it sits right next to the EQUIPMENT CODE
 * wherever the code is shown (list cell, detail header, inquiry brief, the
 * admin-home fleet tables), never beside the state («متاحة …»). Renders
 * nothing when the unit is not new, so callers place it unconditionally.
 */
export function EquipmentNewBadge({
  isNew,
  className,
}: {
  isNew: boolean | null | undefined
  className?: string
}) {
  const { t } = useI18n()
  if (!isNew) return null
  return (
    <Badge tone="info" size="sm" className={className}>
      {t('equipmentStateNew')}
    </Badge>
  )
}
