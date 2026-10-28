import { useI18n } from '@/i18n/I18nContext'
import { Dialog } from '@/components/ui'
import { ChangesTable } from './ChangesTable'
import type { ChangeItem } from './model'

export interface AllChangesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  log: {
    rows: ChangeItem[]
    loading?: boolean
    error?: boolean
    onRetry?: () => void
    canShowAll?: boolean
    onShowAll?: () => void
  }
  roleLabel: (roleKey: string | null) => string
}

/**
 * «سجل كل التغييرات»: the change log of every role (`role_changes`), with the
 * role column. It replaced «اعدادات النظام» on 2026-10-28: the roles system
 * is the only one (0150 / 0156), so the dialog lost the system state and
 * kept the full log, which the role panel's «سجل التغييرات» tab shows for one
 * role only.
 */
export function AllChangesDialog({
  open,
  onOpenChange,
  log,
  roleLabel,
}: AllChangesDialogProps) {
  const { t } = useI18n()
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('rolesPageAllChanges')}
      description={t('rolesPageAllChangesDesc')}
    >
      <ChangesTable
        rows={log.rows}
        roleLabel={roleLabel}
        loading={log.loading}
        error={log.error}
        onRetry={log.onRetry}
        canShowAll={log.canShowAll}
        onShowAll={log.onShowAll}
      />
    </Dialog>
  )
}
