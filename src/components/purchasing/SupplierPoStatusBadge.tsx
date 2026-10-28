import { Badge, type BadgeSize } from '@/components/ui/Badge'
import { useI18n } from '@/i18n/I18nContext'
import {
  SUPPLIER_PO_APPROVAL_BADGE,
  SUPPLIER_PO_STATUS_BADGE,
  supplierPoApprovalListBadge,
  type SupplierPoStatus,
} from '@/lib/purchasing'

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

/** 0160 (owner 2026-10-28): the approval badge, draft = amber, approved =
 *  blue; on a list row an open draft reads «بانتظار الاعتماد». */
export function SupplierPoApprovalBadge({
  po,
  list = false,
  size,
}: {
  po: { status: SupplierPoStatus; approval_status?: string | null }
  /** The list's wording (`supplierPoApprovalListBadge`). */
  list?: boolean
  size?: BadgeSize
}) {
  const { t } = useI18n()
  const badge = list
    ? supplierPoApprovalListBadge(po)
    : SUPPLIER_PO_APPROVAL_BADGE[
        po.approval_status === 'approved' ? 'approved' : 'draft'
      ]
  return (
    <Badge tone={badge.tone} size={size}>
      {t(badge.key)}
    </Badge>
  )
}
