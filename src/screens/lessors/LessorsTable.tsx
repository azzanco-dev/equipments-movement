import type { ReactNode } from 'react'
import { Edit2, Trash2, Truck } from 'lucide-react'
import { DataTable, EmptyState, ErrorState, IconButton } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { RelativeTime } from '@/components/RelativeTime'
import { useI18n } from '@/i18n/I18nContext'
import type { Lessor } from '@/lib/types'

/** Same pattern as `screens/equipment/EquipmentTable.tsx` (see the comment
 *  there). */
export interface LessorsTableProps {
  rows: Lessor[]
  loading: boolean
  error: string | null
  onRetry: () => void
  sort: string
  direction: 'asc' | 'desc'
  onSortChange: (key: string, direction: 'asc' | 'desc') => void
  onEdit: (lessor: Lessor) => void
  onDelete: (lessor: Lessor) => void
  emptyAction?: ReactNode
}

export function LessorsTable({
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
}: LessorsTableProps) {
  const { t } = useI18n()

  if (error) return <ErrorState description={error} onRetry={onRetry} />

  if (!loading && rows.length === 0)
    return (
      <EmptyState
        icon={<Truck size={28} aria-hidden="true" />}
        title={t('noLessors')}
        action={emptyAction}
      />
    )

  const columns: DataTableColumn<Lessor>[] = [
    {
      key: 'name',
      header: t('lessorName'),
      sortable: true,
      className: 'font-semibold',
      cell: (row) => row.name,
    },
    {
      key: 'contact_person',
      header: t('contactPerson'),
      className: 'text-muted',
      cell: (row) => row.contact_person ?? '—',
    },
    {
      key: 'contact_number',
      header: t('contactNumber'),
      className: 'text-muted',
      cell: (row) => <span dir="ltr">{row.contact_number ?? '—'}</span>,
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
      caption={t('lessors')}
      sort={{ key: sort, direction }}
      onSortChange={onSortChange}
      empty={t('noLessors')}
    />
  )
}
