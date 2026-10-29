import { Badge, type BadgeSize } from '@/components/ui/Badge'
import { useI18n } from '@/i18n/I18nContext'
import {
  equipmentStateText,
  equipmentStateTone,
  parseEquipmentState,
} from '@/lib/equipmentState'

/**
 * wave 20 (migration 0125): the one equipment state as the shared `Badge`,
 * e.g. «تعمل», «متاحة», «في الورشة · وقوف». The tone comes from
 * `equipmentStateTone` (tokens only); an unknown or missing state is a muted
 * dash rather than a guess. The «جديدة» mark is NOT part of the state since
 * 2026-10-14 (owner decision): `EquipmentNewBadge` shows it next to the code.
 */
export function EquipmentStateBadge({
  state,
  assetStatus,
  size,
  className,
}: {
  state: string | null | undefined
  /** 0163 (owner 2026-10-29): a «منتهية» supplier unit shows «منتهية» in
   *  grey instead of the «متاحة» its last exit derives. */
  assetStatus?: string | null
  size?: BadgeSize
  className?: string
}) {
  const { t } = useI18n()
  if (assetStatus === 'rental_ended')
    return (
      <Badge tone="neutral" size={size} className={className}>
        {t('equipmentStatusRentalEnded')}
      </Badge>
    )
  const parsed = parseEquipmentState(state)
  if (!parsed) return <span className="text-muted">—</span>
  return (
    <Badge tone={equipmentStateTone(parsed)} size={size} className={className}>
      {equipmentStateText(t, parsed)}
    </Badge>
  )
}
