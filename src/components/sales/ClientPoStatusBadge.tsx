import { Badge, type BadgeSize } from '@/components/ui/Badge'
import { useI18n } from '@/i18n/I18nContext'
import {
  CLIENT_PO_STATUS_BADGE,
  EQUIPMENT_CARD_STATUS_BADGE,
  type ClientPoStatus,
  type EquipmentCardStatus,
} from '@/lib/sales'

/** The shared status badge of a client PO: open = success, closed = muted. */
export function ClientPoStatusBadge({
  status,
  size,
}: {
  status: ClientPoStatus
  size?: BadgeSize
}) {
  const { t } = useI18n()
  const badge = CLIENT_PO_STATUS_BADGE[status]
  return (
    <Badge tone={badge.tone} size={size}>
      {t(badge.key)}
    </Badge>
  )
}

/** The status badge of a «كرت المعدة»: open = success, ended = muted. */
export function EquipmentCardStatusBadge({
  status,
  size,
}: {
  status: EquipmentCardStatus
  size?: BadgeSize
}) {
  const { t } = useI18n()
  const badge = EQUIPMENT_CARD_STATUS_BADGE[status]
  return (
    <Badge tone={badge.tone} size={size}>
      {t(badge.key)}
    </Badge>
  )
}
