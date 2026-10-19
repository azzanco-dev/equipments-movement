import { Badge, type BadgeSize } from '@/components/ui/Badge'
import { useI18n } from '@/i18n/I18nContext'
import { SUPPLIER_PO_STATUS_BADGE, type SupplierPoStatus } from '@/lib/purchasing'

/** The shared status badge of a supplier PO: open = success, closed = muted. */
export function SupplierPoStatusBadge({
  status,
  size,
}: {
  status: SupplierPoStatus
  size?: BadgeSize
}) {
  const { t } = useI18n()
  const badge = SUPPLIER_PO_STATUS_BADGE[status]
  return (
    <Badge tone={badge.tone} size={size}>
      {t(badge.key)}
    </Badge>
  )
}
