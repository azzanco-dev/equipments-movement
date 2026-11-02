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
 * «خيارات» of a client PO (the supplier PO page's menu without the PDF and
 * the approval, which the sales side does not have): «تعديل PO العميل» and,
 * apart from it, the destructive «اقفال PO العميل», only while the PO is
 * open and the caller holds `sales.manage` (the 0169 functions re-check).
 */
export function ClientPoOptionsMenu({
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
          aria-label={t('clientPoActions')}
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
          {t('clientPoEdit')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Lock size={15} />}
          tone="danger"
          disabled={busy}
          onSelect={onClose}
        >
          {t('clientPoClose')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
