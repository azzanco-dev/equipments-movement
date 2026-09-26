import { Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@/components/ui'

export interface MovementAdminMenuProps {
  /** Opens the single admin correction dialog (all editable fields). */
  onEdit: () => void
  /** Opens the delete confirmation. */
  onDelete: () => void
  /** Disables both items while an edit or a delete is still running. */
  busy?: boolean
}

/**
 * wave6-J3/J4 — admin-only actions in the movement detail header: the ONE
 * correction dialog and the delete.
 *
 * Rendered by `MovementDetail` only for `profile.role === 'admin'`; the
 * database functions behind both items (`admin_update_movement`, migration
 * 0105, and `admin_delete_movement`, migrations 0104/0105) re-check the role
 * and fail closed, so hiding the menu is presentation, never the permission.
 */
export function MovementAdminMenu({
  onEdit,
  onDelete,
  busy = false,
}: MovementAdminMenuProps) {
  const { t } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={t('movementActions')}
          variant="outline"
          icon={<Ellipsis size={16} />}
          disabled={busy}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          icon={<Pencil size={15} />}
          disabled={busy}
          onSelect={onEdit}
        >
          {t('edit')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Trash2 size={15} />}
          tone="danger"
          disabled={busy}
          onSelect={onDelete}
        >
          {t('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
