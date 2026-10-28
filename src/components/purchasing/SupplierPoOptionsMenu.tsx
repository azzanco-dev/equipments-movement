import { BadgeCheck, FileDown, Lock, Pencil, SlidersHorizontal } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
 * then — only while the PO is open and the caller may manage purchasing —
 * «تعديل الامر» and, apart from it, the destructive «اغلاق الامر». The
 * 0136/0142 functions behind the two management items re-check the
 * permission and the status. 0160 (owner 2026-10-28, EM-107): «اعتماد» for
 * a `purchasing.approve` holder on an open draft, disabled with its reason
 * (own PO, unpriced units, no units); «تصدير PDF» is disabled with its
 * reason until the PO is approved.
 */
export function SupplierPoOptionsMenu({
  onExport,
  exportBlockedReason = null,
  onApprove,
  approveBlockedReason = null,
  onEdit,
  onClose,
  busy = false,
  className,
}: {
  onExport: () => void
  /** Why the PDF cannot be exported yet (a draft PO), or null. */
  exportBlockedReason?: TranslationKey | null
  /** «اعتماد»; omitted when the caller may not approve or the PO is not an
   *  open draft. */
  onApprove?: () => void
  /** Why «اعتماد» cannot run now, or null. */
  approveBlockedReason?: TranslationKey | null
  /** The management items; omitted for a reader or a closed PO. */
  onEdit?: () => void
  onClose?: () => void
  busy?: boolean
  /** Extra classes of the trigger (the mobile bar makes it 44 px tall). */
  className?: string
}) {
  const { t } = useI18n()
  const manage = Boolean(onEdit && onClose)
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
        {manage && (
          <>
            <DropdownMenuItem
              icon={<Pencil size={15} />}
              disabled={busy}
              onSelect={onEdit}
            >
              {t('supplierPoEdit')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<Lock size={15} />}
              tone="danger"
              disabled={busy}
              onSelect={onClose}
            >
              {t('supplierPoClose')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
