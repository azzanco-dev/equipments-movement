import { Badge, type BadgeSize } from '@/components/ui/Badge'
import { useI18n } from '@/i18n/I18nContext'
import {
  SUPPLIER_PO_APPROVAL_BADGE,
  supplierPoApprovalListBadge,
} from '@/lib/purchasing'

/** 0160 (owner 2026-10-28): the approval badge, draft = amber, approved =
 *  blue; on a list row a draft reads «بانتظار الاعتماد». It is the PO's only
 *  state badge since 0189 (owner 2026-11-11: a supplier PO is neither open
 *  nor closed, so the open / closed badge that lived here is gone). */
export function SupplierPoApprovalBadge({
  po,
  list = false,
  size,
}: {
  po: { approval_status?: string | null }
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
