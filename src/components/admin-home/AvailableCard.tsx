import { useCallback, useState } from 'react'
import { DataTable, type DataTableColumn } from '@/components/ui'
import { EquipmentNewBadge } from '@/components/equipment/EquipmentNewBadge'
import { ExitPurposeBadge } from '@/components/movement/ExitPurposeBadge'
import { useI18n } from '@/i18n/I18nContext'
import {
  fetchFleetEquipment,
  fetchMovementRecorderNames,
} from '@/lib/adminHomeData'
import { availableEquipmentHref } from '@/lib/adminHomeLinks'
import {
  FLEET_FILTER_OWNERS,
  type AdminHomeOwner,
  type AdminHomePage,
  type FleetEquipmentRow,
} from '@/lib/adminHomeStats'
import { formatDateTime } from '@/lib/dateFormat'
import { elapsedInWords } from '@/lib/elapsedWords'
import { localizedName } from '@/lib/localizedName'
import { HomeBlock, ViewAllAction } from './HomeBlock'
import { ListRowsSkeleton } from './HomeSkeletons'
import { OwnerFilter } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

/** Rows the block shows before «عرض الكل». */
const ROWS = 6

/** A fleet row with the foreman of its last site exit (null when the unit
 *  last left the workshop, never moved, or the lookup failed). */
type AvailableRow = FleetEquipmentRow & { foreman: string | null }

/**
 * The foreman of each row's last SITE exit (the recorder of that movement,
 * the fleet tables' rule), one bounded read by movement id; a failed lookup
 * leaves every name empty and never fails the card.
 */
async function withForemen(
  page: AdminHomePage<FleetEquipmentRow>,
  signal: AbortSignal,
): Promise<AdminHomePage<AvailableRow>> {
  const ids = page.rows
    .filter(
      (row) =>
        row.lastMovementContext === 'site' &&
        row.lastMovementType === 'exit' &&
        row.lastMovementId,
    )
    .map((row) => row.lastMovementId as string)
  const names = ids.length
    ? await fetchMovementRecorderNames(ids, signal)
    : new Map<string, string>()
  return {
    ...page,
    rows: page.rows.map((row) => ({
      ...row,
      foreman:
        row.lastMovementId && ids.includes(row.lastMovementId)
          ? (names.get(row.lastMovementId) ?? null)
          : null,
    })),
  }
}

/**
 * «المتاحة الان» (owner 2026-11-10, «وبداله خليه جدول المتاحة»: it took the
 * place of the projects chart in the first row; then «صغر الخط واضف تفاصيل
 * اكثر، مثل اخر شركة ومشروع، اخر فورمين»): the latest six available units —
 * outside every project and the workshop — of the owners of its own filter
 * (the fleet tables' four owners, Al-Azani by default, empty = the four),
 * from `get_admin_fleet_equipment` with state `available`, in 12 px text:
 * the unit with its type and the purpose of its last exit, the last company
 * and project (or «الورشة» when it last left the workshop), the foreman who
 * recorded that exit, and how long it has been available. A row opens the
 * unit; «عرض الكل» opens the equipment list filtered to the available units
 * of those owners.
 */
export function AvailableCard({
  canOpenEquipment,
  onSelectEquipment,
}: {
  canOpenEquipment: boolean
  onSelectEquipment?: (id: string) => void
}) {
  const { t, lang } = useI18n()
  const [owners, setOwners] = useState<AdminHomeOwner[]>(['alazani'])
  const load = useCallback(
    async (signal: AbortSignal) =>
      withForemen(
        await fetchFleetEquipment(
          {
            state: 'available',
            owners,
            page: 1,
            pageSize: ROWS,
            sort: null,
          },
          signal,
        ),
        signal,
      ),
    [owners],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const columns: DataTableColumn<AvailableRow>[] = [
    {
      key: 'code',
      header: t('homeV2ColUnit'),
      cell: (row) => (
        <span className="block">
          <span className="inline-flex flex-wrap items-center gap-1">
            <bdi dir="ltr" className="text-[13px] font-semibold">
              {row.code}
            </bdi>
            <EquipmentNewBadge isNew={row.isNew} />
            <ExitPurposeBadge purpose={row.exitPurpose} />
          </span>
          <span className="block text-[11px] leading-4 text-muted" dir="ltr">
            {row.type}
          </span>
        </span>
      ),
    },
    {
      key: 'lastSite',
      header: t('adminHomeColLastSite'),
      cell: (row) => {
        if (row.lastMovementContext === 'workshop')
          return (
            <span className="text-muted">{t('adminHomeLastSiteWorkshop')}</span>
          )
        const company = localizedName(
          lang,
          row.companyNameAr,
          row.companyNameEn,
        )
        const project = localizedName(
          lang,
          row.projectNameAr,
          row.projectNameEn,
        )
        if (!company && !project) return <span className="text-muted">—</span>
        return (
          <span className="block">
            <span className="block">{company || '—'}</span>
            {project && (
              <span className="block text-[11px] leading-4 text-muted">
                {project}
              </span>
            )}
          </span>
        )
      },
    },
    {
      key: 'foreman',
      header: t('adminHomeColForeman'),
      cell: (row) =>
        row.foreman ? row.foreman : <span className="text-muted">—</span>,
    },
    {
      key: 'since',
      header: t('adminHomeColSince'),
      align: 'end',
      cell: (row) =>
        row.since ? (
          <time
            dateTime={row.since}
            title={formatDateTime(row.since, false)}
            className="whitespace-nowrap text-muted"
          >
            {elapsedInWords(row.since, lang) ?? '—'}
          </time>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ]

  return (
    <HomeBlock
      title="homeV2AvailableNow"
      count={data?.total ?? null}
      action={
        <>
          <OwnerFilter
            size="sm"
            className="w-32"
            options={FLEET_FILTER_OWNERS}
            value={owners}
            onChange={setOwners}
          />
          <ViewAllAction
            href={canOpenEquipment ? availableEquipmentHref(owners) : null}
          />
        </>
      }
      state={failed ? 'failed' : loading && !data ? 'loading' : 'ready'}
      onRetry={retry}
      skeleton={<ListRowsSkeleton rows={ROWS} />}
    >
      {data && (
        <div
          aria-busy={loading || undefined}
          className={loading ? 'opacity-60' : undefined}
        >
          <DataTable
            size="md"
            columns={columns}
            rows={data.rows}
            rowKey={(row) => row.id}
            caption={t('homeV2AvailableNow')}
            stickyHeader={false}
            cellTextClassName="text-xs"
            cellClassName="py-1.5"
            empty={t('adminHomeFleetAvailableEmpty')}
            onRowClick={
              onSelectEquipment
                ? (row: AvailableRow) => onSelectEquipment(row.id)
                : undefined
            }
            rowHref={(row) => `/equipment/${row.id}`}
          />
        </div>
      )}
    </HomeBlock>
  )
}
