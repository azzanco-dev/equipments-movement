import type { ReactNode } from 'react'
import { Building2, Edit2, FolderTree, Trash2 } from 'lucide-react'
import { DataTable, EmptyState, ErrorState, IconButton } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { RelativeTime } from '@/components/RelativeTime'
import { useI18n } from '@/i18n/I18nContext'
import { localizedName } from '@/lib/localizedName'
import type { Company } from '@/lib/types'

/** Same pattern as `screens/equipment/EquipmentTable.tsx` (see the comment
 *  there). Companies and projects show a single localized name column
 *  because that is what the list has always shown; the toolbar's own sort
 *  menu still covers sorting by the Arabic or English name individually. */
export interface CompaniesTableProps {
  rows: Company[]
  loading: boolean
  error: string | null
  onRetry: () => void
  sort: string
  direction: 'asc' | 'desc'
  onSortChange: (key: string, direction: 'asc' | 'desc') => void
  onEdit: (company: Company) => void
  onManageProjects: (company: Company) => void
  onDelete: (company: Company) => void
  emptyAction?: ReactNode
}

export function CompaniesTable({
  rows,
  loading,
  error,
  onRetry,
  sort,
  direction,
  onSortChange,
  onEdit,
  onManageProjects,
  onDelete,
  emptyAction,
}: CompaniesTableProps) {
  const { t, lang } = useI18n()

  if (error) return <ErrorState description={error} onRetry={onRetry} />

  if (!loading && rows.length === 0)
    return (
      <EmptyState
        icon={<Building2 size={28} aria-hidden="true" />}
        title={t('noCompanies')}
        action={emptyAction}
      />
    )

  const columns: DataTableColumn<Company>[] = [
    {
      key: 'name_ar',
      header: t('company'),
      sortable: true,
      className: 'font-semibold',
      cell: (row) => localizedName(lang, row.name_ar, row.name_en),
    },
    {
      key: 'actions',
      header: t('actions'),
      cell: (row) => (
        <span className="flex items-center gap-1">
          <IconButton
            size="sm"
            label={t('edit')}
            title={t('edit')}
            icon={<Edit2 size={15} />}
            onClick={() => onEdit(row)}
          />
          <IconButton
            size="sm"
            label={t('manageProjects')}
            title={t('manageProjects')}
            icon={<FolderTree size={15} />}
            onClick={() => onManageProjects(row)}
          />
          <IconButton
            size="sm"
            label={t('delete')}
            title={t('delete')}
            icon={<Trash2 size={15} />}
            onClick={() => onDelete(row)}
          />
        </span>
      ),
    },
    {
      key: 'updated_at',
      header: t('updatedAt'),
      sortable: true,
      className: 'text-muted',
      hideBelow: 'md',
      cell: (row) => <RelativeTime value={row.updated_at} />,
    },
  ]

  return (
    <DataTable
      size="md"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      loading={loading}
      loadingRows={8}
      caption={t('companies')}
      sort={{ key: sort, direction }}
      onSortChange={onSortChange}
      empty={t('noCompanies')}
    />
  )
}
