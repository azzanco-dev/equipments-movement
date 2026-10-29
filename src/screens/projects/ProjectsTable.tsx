import type { ReactNode } from 'react'
import { Edit2, FolderKanban, Trash2 } from 'lucide-react'
import { DataTable, EmptyState, ErrorState, IconButton } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { RelativeTime } from '@/components/RelativeTime'
import { useI18n } from '@/i18n/I18nContext'
import { localizedName } from '@/lib/localizedName'
import type { Project } from '@/lib/types'

/** Same pattern as `screens/companies/CompaniesTable.tsx`: one localized
 *  name column, with the toolbar's own sort menu covering the Arabic and
 *  English names individually. */
export interface ProjectsTableProps {
  rows: Project[]
  loading: boolean
  error: string | null
  onRetry: () => void
  sort: string
  direction: 'asc' | 'desc'
  onSortChange: (key: string, direction: 'asc' | 'desc') => void
  /** Omitted without `companies_projects.edit`: the row shows no edit button. */
  onEdit?: (project: Project) => void
  /** Omitted without `companies_projects.edit`: the row shows no delete button. */
  onDelete?: (project: Project) => void
  emptyAction?: ReactNode
}

export function ProjectsTable({
  rows,
  loading,
  error,
  onRetry,
  sort,
  direction,
  onSortChange,
  onEdit,
  onDelete,
  emptyAction,
}: ProjectsTableProps) {
  const { t, lang } = useI18n()

  if (error) return <ErrorState description={error} onRetry={onRetry} />

  if (!loading && rows.length === 0)
    return (
      <EmptyState
        icon={<FolderKanban size={28} aria-hidden="true" />}
        title={t('noProjects')}
        action={emptyAction}
      />
    )

  const columns: DataTableColumn<Project>[] = [
    {
      key: 'name_ar',
      header: t('project'),
      sortable: true,
      className: 'font-semibold',
      cell: (row) => localizedName(lang, row.name_ar, row.name_en),
    },
    {
      key: 'actions',
      header: t('actions'),
      cell: (row) => (
        <span className="flex items-center gap-1">
          {onEdit && (
            <IconButton
              size="sm"
              label={t('edit')}
              title={t('edit')}
              icon={<Edit2 size={15} />}
              onClick={() => onEdit(row)}
            />
          )}
          {onDelete && (
            <IconButton
              size="sm"
              label={t('delete')}
              title={t('delete')}
              icon={<Trash2 size={15} />}
              onClick={() => onDelete(row)}
            />
          )}
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
      caption={t('projects')}
      // Owner 2026-10-29: the log / PO list look — 13 px rows with 8 px above
      // and below the content (headers stay 12 px).
      cellTextClassName="text-[13px]"
      cellClassName="py-2"
      sort={{ key: sort, direction }}
      onSortChange={onSortChange}
      empty={t('noProjects')}
    />
  )
}
