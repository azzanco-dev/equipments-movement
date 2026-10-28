import { useI18n } from '@/i18n/I18nContext'
import {
  Button,
  DataTable,
  ErrorState,
  type DataTableColumn,
} from '@/components/ui'
import type { ChangeItem } from './model'

/**
 * The change log as the approved mockup shows it: من / متى / ماذا (plus the
 * role in «سجل كل التغييرات», the full log of every role). `onShowAll` adds
 * the «عرض الكل» control under the first rows.
 */
export function ChangesTable({
  rows,
  roleLabel,
  loading,
  error,
  onRetry,
  canShowAll,
  onShowAll,
}: {
  rows: ChangeItem[]
  /** Adds the role column, labelled by this lookup. */
  roleLabel?: (roleKey: string | null) => string
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  canShowAll?: boolean
  onShowAll?: () => void
}) {
  const { t } = useI18n()
  const columns: DataTableColumn<ChangeItem>[] = [
    ...(roleLabel
      ? [
          {
            key: 'role',
            header: t('roleChangesColRole'),
            cell: (row: ChangeItem) => roleLabel(row.roleKey),
          },
        ]
      : []),
    { key: 'who', header: t('roleChangesColWhoShort'), cell: (row) => row.who },
    {
      key: 'when',
      header: t('roleChangesColWhenShort'),
      cell: (row) => (
        <span className="whitespace-nowrap text-muted">{row.when}</span>
      ),
      hideBelow: 'sm',
    },
    { key: 'what', header: t('roleChangesColWhat'), cell: (row) => row.what },
  ]
  if (error)
    return (
      <ErrorState description={t('roleChangesLoadError')} onRetry={onRetry} />
    )
  return (
    <div className="space-y-2">
      <DataTable
        size="sm"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        loadingRows={4}
        caption={t('roleChangesTitle')}
        empty={t('roleChangesNone')}
      />
      {canShowAll && onShowAll && !loading && (
        <Button variant="ghost" size="sm" onClick={onShowAll}>
          {t('roleChangesShowAll')}
        </Button>
      )}
    </div>
  )
}
