import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  DataTable,
  ErrorState,
  Tabs,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
} from '@/components/ui'
import { EquipmentNewBadge } from '@/components/equipment/EquipmentNewBadge'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { fetchFleetEquipment } from '@/lib/adminHomeData'
import { movementHref } from '@/lib/adminHomeLinks'
import {
  FLEET_FILTER_OWNERS,
  type AdminHomeOwner,
  type AdminHomePage,
  type FleetEquipmentRow,
  type OwnerStateMatrix,
} from '@/lib/adminHomeStats'
import { formatDateTime } from '@/lib/dateFormat'
import { elapsedInWords } from '@/lib/elapsedWords'
import { HomeBlock, ViewAllAction } from './HomeBlock'
import { ListRowsSkeleton } from './HomeSkeletons'
import { OwnerFilter } from './OwnerFilter'
import type { AdminHomeSectionState } from './useAdminHomeSection'

/** Rows the block shows before «عرض الكل». */
const ROWS = 6

export type WorkshopTab =
  'maintenance' | 'parking' | 'out_of_service' | 'unclassified'

/** The tabs in order: the purpose (the fleet tables' `p_purpose` value),
 *  its label and the snapshot state its count comes from. */
export const WORKSHOP_TABS: readonly {
  id: WorkshopTab
  label: TranslationKey
  state: string
}[] = [
  {
    id: 'maintenance',
    label: 'maintenancePurpose',
    state: 'workshop_maintenance',
  },
  { id: 'parking', label: 'parkingPurpose', state: 'workshop_parking' },
  {
    id: 'out_of_service',
    label: 'workshopPurposeOutOfService',
    state: 'workshop_out_of_service',
  },
  {
    id: 'unclassified',
    label: 'equipmentStateUnclassified',
    state: 'workshop_unclassified',
  },
]

type Page = AdminHomePage<FleetEquipmentRow>

/**
 * «في الورشة الان» (owner 2026-11-09, the v2 mockup). Since the owner's
 * review of 2026-11-10 («جدول الورشة تحت شيل الموردين، وخلي التابات حسب
 * التصنيف») the suppliers tab is gone and the tabs are the workshop
 * purposes: maintenance, standby, out of service and unclassified. Each tab
 * is the latest six units in the workshop with that purpose
 * (`get_admin_fleet_equipment`) for the owners of its own filter (owner
 * 2026-11-10, «اضف في جدول الورشة فلتر المالك وافتراضي على العزاني»: the
 * fleet tables' four owners, Al-Azani by default, empty = the four), read
 * once per tab and kept while the reader switches tabs (a new owner choice
 * reads again); each row opens its open workshop entry (owner 2026-10-29).
 * The count in each tab comes from the page's snapshot (`matrix`) over the
 * same owners. «عرض الكل» opens the full fleet tables in place.
 */
export function WorkshopCard({
  matrix,
  onSelectEquipment,
  onSelectMovement,
  onShowFleetTables,
}: {
  /** The page's snapshot over every owner: the counts in the tabs. */
  matrix: AdminHomeSectionState<OwnerStateMatrix>
  onSelectEquipment?: (id: string) => void
  onSelectMovement?: (id: string) => void
  onShowFleetTables: () => void
}) {
  const { t, lang } = useI18n()
  const [tab, setTab] = useState<WorkshopTab>('maintenance')
  const [owners, setOwners] = useState<AdminHomeOwner[]>(['alazani'])
  // One read per tab and owner choice, kept so switching back never refetches.
  const [pages, setPages] = useState<Partial<Record<WorkshopTab, Page>>>({})
  const [failed, setFailed] = useState<Partial<Record<WorkshopTab, boolean>>>(
    {},
  )
  const [attempt, setAttempt] = useState(0)
  const loaded = pages[tab] !== undefined

  const chooseOwners = useCallback((value: AdminHomeOwner[]) => {
    setOwners(value)
    setPages({})
    setFailed({})
  }, [])

  useEffect(() => {
    if (loaded) return
    const controller = new AbortController()
    const current = tab
    setFailed((value) => ({ ...value, [current]: false }))
    fetchFleetEquipment(
      {
        state: 'workshop',
        purpose: current,
        owners,
        page: 1,
        pageSize: ROWS,
        sort: null,
      },
      controller.signal,
    ).then(
      (page) => {
        if (!controller.signal.aborted)
          setPages((value) => ({ ...value, [current]: page }))
      },
      () => {
        if (!controller.signal.aborted)
          setFailed((value) => ({ ...value, [current]: true }))
      },
    )
    return () => controller.abort()
    // `owners` is read through the reset of `pages` in `chooseOwners`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loaded, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  const countedOwners = owners.length ? owners : FLEET_FILTER_OWNERS
  const countOf = (state: string): number | null =>
    matrix.data
      ? countedOwners.reduce(
          (sum, owner) => sum + (matrix.data?.count(owner, state) ?? 0),
          0,
        )
      : null

  const columns: DataTableColumn<FleetEquipmentRow>[] = [
    {
      key: 'code',
      header: t('homeV2ColUnit'),
      cell: (row) => (
        <span className="block">
          <span className="inline-flex flex-wrap items-center gap-1">
            <bdi dir="ltr" className="font-semibold">
              {row.code}
            </bdi>
            <EquipmentNewBadge isNew={row.isNew} />
          </span>
          <span className="block text-[11px] leading-4 text-muted">
            {row.type}
          </span>
        </span>
      ),
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
            className="text-muted"
          >
            {elapsedInWords(row.since, lang) ?? '—'}
          </time>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ]

  const openWorkshopRow =
    onSelectMovement || onSelectEquipment
      ? (row: FleetEquipmentRow) => {
          if (onSelectMovement && row.lastMovementId)
            onSelectMovement(row.lastMovementId)
          else onSelectEquipment?.(row.id)
        }
      : undefined

  const page = pages[tab]

  return (
    <HomeBlock
      title="homeV2WorkshopNow"
      action={
        <>
          <OwnerFilter
            size="sm"
            className="w-32"
            options={FLEET_FILTER_OWNERS}
            value={owners}
            onChange={chooseOwners}
          />
          <ViewAllAction onClick={onShowFleetTables} />
        </>
      }
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as WorkshopTab)}>
        <TabsList
          variant="segmented"
          aria-label={t('homeV2TabsLabel')}
          className="mb-1.5"
        >
          {WORKSHOP_TABS.map((item) => {
            const count = countOf(item.state)
            return (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className="!h-7 !px-2.5 text-xs"
              >
                {t(item.label)}
                {count !== null && (
                  <span className="ms-1 tabular-nums text-muted">{count}</span>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>
      {failed[tab] ? (
        <ErrorState
          title={t('adminHomeSectionError')}
          description={t('adminHomeSectionErrorHint')}
          onRetry={retry}
        />
      ) : !page ? (
        <SkeletonBody>
          <ListRowsSkeleton rows={ROWS} />
        </SkeletonBody>
      ) : (
        <DataTable
          size="md"
          columns={columns}
          rows={page.rows}
          rowKey={(row) => row.id}
          caption={t('homeV2WorkshopNow')}
          stickyHeader={false}
          cellTextClassName="text-sm"
          cellClassName="py-1.5"
          empty={t('adminHomeFleetWorkshopEmpty')}
          onRowClick={openWorkshopRow}
          rowHref={(row) =>
            row.lastMovementId
              ? movementHref(row.lastMovementId)
              : `/equipment/${row.id}`
          }
        />
      )}
    </HomeBlock>
  )
}

/** A tab's first load: its shaped skeleton, announced once. The tabs stay
 *  above it, so the block keeps its header while it loads. */
function SkeletonBody({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div aria-busy="true">
      {children}
      <span className="sr-only">{t('loading')}</span>
    </div>
  )
}
