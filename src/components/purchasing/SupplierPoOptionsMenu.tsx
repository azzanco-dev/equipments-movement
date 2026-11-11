import {
  BadgeCheck,
  FileDown,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'

/** A menu item's label with, while it is disabled, the reason under it. */
function ItemLabel({
  label,
  reason,
}: {
  label: string
  reason?: TranslationKey | null
}) {
  const { t } = useI18n()
  if (!reason) return <>{label}</>
  return (
    <span className="flex min-w-0 flex-col">
      <span>{label}</span>
      <span className="max-w-56 whitespace-normal text-xs text-muted">{t(reason)}</span>
    </span>
  )
}

/**
 * «خيارات» of a PO (owner 2026-10-22, task 8; the same labelled button +
 * menu as the movement page's admin menu): «تصدير PDF» for every reader
 * (owner: the PDF lives under the options, not as a button of its own),
 * then «تعديل الامر» for a caller who may manage purchasing (the 0142
 * function re-checks the permission). 0160 (owner 2026-10-28, EM-107):
 * «اعتماد» for a `purchasing.approve` holder on a draft, disabled with its
 * reason (own PO, unpriced units, no units). 0189 (owner 2026-11-11): a PO
 * is never closed, so «اغلاق الامر» is gone; an approver gets «رجوع
 * للتعديل» on an APPROVED PO instead, the way to change it.
 */
export function SupplierPoOptionsMenu({
  onExport,
  exportBlockedReason = null,
  onApprove,
  approveBlockedReason = null,
  onReturn,
  onEdit,
  busy = false,
  className,
}: {
  onExport: () => void
  /** Why the PDF cannot be exported yet (a draft PO), or null. */
  exportBlockedReason?: TranslationKey | null
  /** «اعتماد»; omitted when the caller may not approve or the PO is not a
   *  draft. */
  onApprove?: () => void
  /** Why «اعتماد» cannot run now, or null. */
  approveBlockedReason?: TranslationKey | null
  /** «رجوع للتعديل» (0189); omitted when the caller may not approve or the
   *  PO is not approved. */
  onReturn?: () => void
  /** «تعديل الامر»; omitted for a reader. */
  onEdit?: () => void
  busy?: boolean
  /** Extra classes of the trigger (the mobile bar makes it 44 px tall). */
  className?: string
}) {
  const { t } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={className ? 'md' : 'sm'}
          className={className}
          icon={<SlidersHorizontal size={14} aria-hidden="true" />}
          aria-label={t('supplierPoActions')}
          disabled={busy}
        >
          {t('options')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          icon={<FileDown size={15} />}
          disabled={busy || Boolean(exportBlockedReason)}
          onSelect={onExport}
        >
          <ItemLabel label={t('supplierPoPdf')} reason={exportBlockedReason} />
        </DropdownMenuItem>
        {onApprove && (
          <DropdownMenuItem
            icon={<BadgeCheck size={15} />}
            disabled={busy || Boolean(approveBlockedReason)}
            onSelect={onApprove}
          >
            <ItemLabel label={t('supplierPoApprove')} reason={approveBlockedReason} />
          </DropdownMenuItem>
        )}
        {onReturn && (
          <DropdownMenuItem
            icon={<RotateCcw size={15} />}
            disabled={busy}
            onSelect={onReturn}
          >
            {t('supplierPoReturn')}
          </DropdownMenuItem>
        )}
        {onEdit && (
          <DropdownMenuItem
            icon={<Pencil size={15} />}
            disabled={busy}
            onSelect={onEdit}
          >
            {t('supplierPoEdit')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
