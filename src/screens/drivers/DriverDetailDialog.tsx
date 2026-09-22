import { useRouter } from 'next/navigation'
import { Briefcase, CreditCard, Flag, Phone, Truck, User } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { buildDriverMovementsHref } from '@/lib/driverEquipment'
import type { DriverEquipmentItem } from '@/lib/driverEquipment'
import { formatDate } from '@/lib/dateFormat'
import { useDriverDetail } from './useDriverDetail'
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  SectionHeader,
  Skeleton,
  type DataTableColumn,
} from '@/components/ui'
// InfoGrid is new (this change) and not yet wired into the `ui` barrel
// (src/components/ui/index.ts), which is owned separately.
import { InfoGrid, type InfoGridItem } from '@/components/ui/InfoGrid'

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
    equipmentLoading,
    equipmentError,
    refetchEquipment,
  } = useDriverDetail(driverId)

  const equipmentColumns: DataTableColumn<DriverEquipmentItem>[] = [
    {
      key: 'equipment',
      header: t('equipmentNameLabel'),
      cell: (item) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{item.code ?? '—'}</span>
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
        {
          key: 'employmentType',
          icon: <Briefcase size={16} />,
          label: t('employmentType'),
          value: driver.employment_type,
        },
        {
          key: 'jobTitle',
          icon: <Briefcase size={16} />,
          label: t('jobTitle'),
          value: driver.job_title,
        },
      ]
    : []

  const showEmptyEquipment =
    !equipmentLoading && !equipmentError && equipment.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={driver?.full_name ?? t('driverDetailsDialogTitle')}
      description={driver ? t('driverDetails') : undefined}
      size="lg"
    >
      {loading ? (
        <div
          className="space-y-2 py-2"
          aria-busy="true"
          aria-label={t('loading')}
        >
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      ) : error || !driver ? (
        <ErrorState title={error ?? undefined} />
      ) : (
        <div className="space-y-5">
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
