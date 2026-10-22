import { Lock, Pencil, SlidersHorizontal } from 'lucide-react'
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
 * «خيارات» of an open PO (owner 2026-10-22, task 8; the same labelled
 * button + menu as the movement page's admin menu): «تعديل الامر» and, apart
 * from it, the destructive «اغلاق الامر». Rendered only for a holder of
 * `purchasing.manage` on an open PO; the 0136/0142 functions behind both
 * items re-check the permission and the status.
 */
export function SupplierPoOptionsMenu({
  onEdit,
  onClose,
  busy = false,
  className,
}: {
  onEdit: () => void
  onClose: () => void
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
