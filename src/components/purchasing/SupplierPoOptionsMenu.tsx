import { FileDown, Lock, Pencil, SlidersHorizontal } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'

/**
 * «خيارات» of a PO (owner 2026-10-22, task 8; the same labelled button +
 * menu as the movement page's admin menu): «تصدير PDF» for every reader
 * (owner: the PDF lives under the options, not as a button of its own),
 * then — only while the PO is open and the caller may manage purchasing —
 * «تعديل الامر» and, apart from it, the destructive «اغلاق الامر». The
 * 0136/0142 functions behind the two management items re-check the
 * permission and the status.
 */
export function SupplierPoOptionsMenu({
  onExport,
  onEdit,
  onClose,
  busy = false,
  className,
}: {
  onExport: () => void
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
          disabled={busy}
          onSelect={onExport}
        >
          {t('supplierPoPdf')}
        </DropdownMenuItem>
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
