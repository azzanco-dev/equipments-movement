import type { ReactNode } from 'react'
import { Edit2, Eye, Trash2, Truck } from 'lucide-react'
import { DataTable, EmptyState, ErrorState, IconButton } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { RelativeTime } from '@/components/RelativeTime'
import { CompletenessRing } from '@/components/parties/CompletenessRing'
import { useI18n } from '@/i18n/I18nContext'
import {
  LESSOR_COMPLETENESS_FIELDS,
  partyCompleteness,
} from '@/lib/partyCompleteness'
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
  /** Opens the supplier's details (EM-260): the name and the eye button. */
  onOpen?: (lessor: Lessor) => void
  /** Omitted without `lessors.edit`: the row shows no edit button. */
  onEdit?: (lessor: Lessor) => void
  /** Omitted without `lessors.edit`: the row shows no delete button. */
  onDelete?: (lessor: Lessor) => void
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
  onOpen,
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
      // Owner 2026-10-29 put the contact person under the name; the owner
      // reversed it on 2026-10-31: it is a column of its own again.
      cell: (row) =>
        onOpen ? (
          <button
            type="button"
            className="text-start font-semibold hover:underline focus-visible:underline"
            onClick={() => onOpen(row)}
          >
            {row.name}
          </button>
        ) : (
          <span className="font-semibold">{row.name}</span>
        ),
    },
    {
      key: 'contact_person',
      header: t('contactPerson'),
      className: 'text-muted',
      cell: (row) => row.contact_person || '—',
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
          {onOpen && (
            <IconButton
              size="sm"
              label={t('lessorDetailsDialogTitle')}
              title={t('lessorDetailsDialogTitle')}
              icon={<Eye size={15} />}
              onClick={() => onOpen(row)}
            />
          )}
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
    // Owner 2026-11-05: the data completeness at the END of each row
    // («نهاية كل صف»), suppliers first; computed from the row, not sortable.
    {
      key: 'completeness',
      header: t('completeness'),
      cell: (row) => (
        <CompletenessRing
          value={partyCompleteness(row, LESSOR_COMPLETENESS_FIELDS)}
        />
      ),
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
      // Owner 2026-10-29: the log / PO list look — 13 px rows with 8 px above
      // and below the content (headers stay 12 px).
      cellTextClassName="text-[13px]"
      cellClassName="py-2"
      sort={{ key: sort, direction }}
      onSortChange={onSortChange}
      empty={t('noLessors')}
    />
  )
}
