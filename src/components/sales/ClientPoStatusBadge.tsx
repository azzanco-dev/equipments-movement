import { Badge, type BadgeSize } from '@/components/ui/Badge'
import { useI18n } from '@/i18n/I18nContext'
import { CLIENT_PO_STATUS_BADGE, type ClientPoStatus } from '@/lib/sales'

/** The shared status badge of a client PO: open = success, closed = muted.
 *  (The «كرت المعدة» badge that lived beside it — open / ended — went with
 *  the card's period in migration 0189.) */
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
