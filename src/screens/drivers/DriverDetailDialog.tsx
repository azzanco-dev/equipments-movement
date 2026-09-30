import { useRouter } from 'next/navigation'
import { CreditCard, Flag, Phone, Truck, User } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { buildDriverMovementsHref } from '@/lib/driverEquipment'
import type { DriverEquipmentItem } from '@/lib/driverEquipment'
import { formatDate } from '@/lib/dateFormat'
import { useDriverDetail } from './useDriverDetail'
import {
  Badge,
  Button,
  DataTable,
  DetailHeader,
  Dialog,
  EmptyState,
  ErrorState,
  InfoGrid,
  SectionHeader,
  Skeleton,
  type DataTableColumn,
  type InfoGridItem,
} from '@/components/ui'
import { InfoGridSkeleton, LtrValue } from '@/components/ui/InfoGrid'

export interface DriverDetailDialogProps {
  /** The driver to show, or `null` while the dialog is closed. The hook
   *  skips its fetches when this is `null`. */
  driverId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Driver detail as a dialog, opened from the drivers list (row click sets
 * `?driver=<id>` on the list URL; see `DriversListScreen`). Same content as
 * the former standalone `/drivers/:id` page: personal fields plus the
 * "related equipment" section from `driver_equipment_summary`.
 *
 * The dialog's own title stays the generic "Driver details" (it labels the
 * dialog for assistive tech); the driver's name, job title and employment
 * type sit in a `DetailHeader` inside the body, so they are not repeated in
 * the info grid below it.
 *
 * The equipment section deliberately does not use the shared `MiniTable`:
 * `MiniTable`'s error slot renders inside a `<span>`, which cannot host
 * `ErrorState`'s own block markup, and a failed load here must keep its
 * retry button (see `useDriverDetail`'s comment on `equipmentError`). This
 * mirrors the conditional the standalone page used before it became a
 * dialog.
 */
export function DriverDetailDialog({
  driverId,
  open,
  onOpenChange,
}: DriverDetailDialogProps) {
  const { t } = useI18n()
  const router = useRouter()
  const {
    driver,
    loading,
    error,
    equipment,
    equipmentPending,
    equipmentLoading,
    equipmentError,
    refetchEquipment,
  } = useDriverDetail(driverId)
  // One placeholder for the whole body until the driver AND the first answer
  // of the equipment section are in, so the centred dialog is sized once
  // instead of growing when each part arrives. A failed driver load shows its
  // error without waiting for the equipment.
  const bodyPending = loading || (Boolean(driver) && equipmentPending)

  const equipmentColumns: DataTableColumn<DriverEquipmentItem>[] = [
    {
      key: 'equipment',
      header: t('equipmentNameLabel'),
      cell: (item) => (
        <span className="flex flex-col">
          {item.code ? (
            // `self-start`: the column flex would otherwise stretch the LTR
            // run to the full width and push the code to the left edge.
            <LtrValue className="self-start font-medium text-fg">
              {item.code}
            </LtrValue>
          ) : (
            <span className="text-muted">—</span>
          )}
          {item.type && (
            <span className="text-[11px] text-muted">{item.type}</span>
          )}
        </span>
      ),
    },
    {
      key: 'plate_number',
      header: t('plateNumber'),
      hideBelow: 'sm',
      cell: (item) =>
        item.plateNumber ? (
          <span dir="ltr" className="inline-block">
            {item.plateNumber}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'times_driven',
      header: t('timesDriven'),
      align: 'center',
      cell: (item) => item.timesDriven,
    },
    {
      key: 'last_driven_at',
      header: t('lastDriven'),
      cell: (item) => (item.lastDrivenAt ? formatDate(item.lastDrivenAt) : '—'),
    },
    {
      key: 'is_current',
      header: <span className="sr-only">{t('drivingNow')}</span>,
      align: 'end',
      cell: (item) =>
        item.isCurrent ? (
          <Badge tone="entry" size="sm">
            {t('drivingNow')}
          </Badge>
        ) : null,
    },
  ]

  const infoItems: InfoGridItem[] = driver
    ? [
        {
          key: 'nameEn',
          icon: <User size={16} />,
          label: t('driverNameEn'),
          value: driver.name_en,
        },
        {
          key: 'idNumber',
          icon: <CreditCard size={16} />,
          label: t('idNumber'),
          value: driver.id_number,
          dir: 'ltr',
        },
        {
          key: 'mobileNumber',
          icon: <Phone size={16} />,
          label: t('mobileNumber'),
          value: driver.mobile_number,
          dir: 'ltr',
        },
        {
          key: 'nationality',
          icon: <Flag size={16} />,
          label: t('nationality'),
          value: driver.nationality,
        },
      ]
    : []

  const showEmptyEquipment =
    !equipmentLoading && !equipmentError && equipment.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('driverDetailsDialogTitle')}
      size="lg"
    >
      {bodyPending ? (
        // Mirrors the body below: header, the 2x2 info grid, the section
        // heading and the table block.
        <div className="space-y-5" aria-busy="true">
          <span className="sr-only" role="status">
            {t('loading')}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-7 w-48 max-w-full" />
              <Skeleton className="h-[26px] w-24 rounded-full" />
            </div>
            <div className="mt-0.5 flex h-[21px] items-center">
              <Skeleton variant="text" className="w-28" />
            </div>
          </div>
          <InfoGridSkeleton count={4} columns={2} withIcon />
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex h-5 items-center">
                  <Skeleton variant="text" className="w-28" />
                </div>
                <div className="mt-0.5 flex h-4 items-center">
                  <Skeleton variant="text" className="w-56 max-w-full" />
                </div>
              </div>
              <Skeleton className="h-7 w-20 shrink-0" />
            </div>
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </div>
          </div>
        </div>
      ) : error || !driver ? (
        <ErrorState title={error ?? undefined} />
      ) : (
        <div className="space-y-5">
          <DetailHeader
            as="h3"
            identifier={driver.full_name}
            subtitle={driver.job_title ?? undefined}
            badges={
              // Values such as "العزاني" or "نقدي" read like an owner on their
              // own, so the badge carries its label.
              driver.employment_type ? (
                <Badge tone="neutral">
                  {t('employmentType')}: {driver.employment_type}
                </Badge>
              ) : undefined
            }
          />
          <InfoGrid items={infoItems} columns={2} />
          <div className="space-y-3">
            <SectionHeader
              title={t('relatedEquipment')}
              description={t('relatedEquipmentDesc')}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    router.push(buildDriverMovementsHref(driver.full_name))
                  }
                >
                  {t('viewAll')}
                </Button>
              }
            />
            {equipmentError ? (
              <ErrorState
                title={t('relatedEquipmentLoadError')}
                onRetry={refetchEquipment}
              />
            ) : showEmptyEquipment ? (
              <EmptyState
                icon={<Truck size={22} />}
                title={t('noRelatedEquipment')}
              />
            ) : (
              <DataTable
                size="sm"
                caption={t('relatedEquipment')}
                columns={equipmentColumns}
                rows={equipment}
                rowKey={(item) => item.equipmentId}
                loading={equipmentLoading}
                loadingRows={4}
                onRowClick={(item) =>
                  router.push(`/equipment/${item.equipmentId}`)
                }
              />
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}
