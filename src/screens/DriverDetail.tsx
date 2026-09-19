import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Briefcase, CreditCard, Flag, Phone, Truck, User } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import type { Driver } from '@/lib/types'
import { formatDate } from '@/lib/dateFormat'
import {
  DRIVER_EQUIPMENT_LIMIT,
  DRIVER_EQUIPMENT_SELECT,
  DRIVER_EQUIPMENT_SUMMARY_VIEW,
  buildDriverMovementsHref,
  mapDriverEquipmentRows,
  type DriverEquipmentItem,
  type DriverEquipmentSummaryRow,
} from '@/lib/driverEquipment'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  BackButton,
  Badge,
  Button,
  Card,
  DataTable,
  DescriptionList,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionHeader,
  Skeleton,
  type DataTableColumn,
  type DescriptionListItem,
} from '@/components/ui'

export function DriverDetail({
  driverId,
  onBack,
}: {
  driverId: string
  onBack: () => void
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [driver, setDriver] = useState<Driver | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [equipment, setEquipment] = useState<DriverEquipmentItem[]>([])
  const [equipmentLoading, setEquipmentLoading] = useState(true)
  const [equipmentError, setEquipmentError] = useState(false)
  const startEquipmentRequest = useListRequest()

  const fetchDriver = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('drivers')
      .select(
        'id,full_name,name_en,id_number,mobile_number,nationality,employment_type,job_title,created_at,updated_at',
      )
      .eq('id', driverId)
      .maybeSingle()
    if (fetchError || !data) setError(t('driverNotFound'))
    else setDriver(data as Driver)
    setLoading(false)
  }, [driverId, t])

  /**
   * Equipment derived from movements by `driver_equipment_summary`
   * (migration 0092). The view is `security_invoker`, so a foreman only ever
   * gets the visits his own RLS lets him read; no role check belongs here.
   */
  const fetchEquipment = useCallback(async () => {
    setEquipmentLoading(true)
    setEquipmentError(false)
    const signal = startEquipmentRequest()
    const { data, error: fetchError } = await supabase
      .from(DRIVER_EQUIPMENT_SUMMARY_VIEW)
      .select(DRIVER_EQUIPMENT_SELECT)
      .eq('driver_id', driverId)
      .order('is_current', { ascending: false })
      .order('last_driven_at', { ascending: false })
      .order('equipment_id', { ascending: true })
      .limit(DRIVER_EQUIPMENT_LIMIT)
      .abortSignal(signal)
    if (signal.aborted) return
    // A failed load must never render as "no related equipment".
    if (fetchError) setEquipmentError(true)
    else
      setEquipment(
        mapDriverEquipmentRows(
          data as unknown as DriverEquipmentSummaryRow[] | null,
        ),
      )
    setEquipmentLoading(false)
  }, [driverId, startEquipmentRequest])

  useEffect(() => {
    fetchDriver()
  }, [fetchDriver])

  useEffect(() => {
    fetchEquipment()
  }, [fetchEquipment])

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
      // The column only ever holds the "driving now" badge, so the visible
      // header would be noise; screen readers still get a name.
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

  if (loading)
    return (
      <div
        className="space-y-2 py-2"
        aria-busy="true"
        aria-label={t('loading')}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-4/5" />
      </div>
    )
  if (error || !driver)
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} label={t('back')} />
        <ErrorState title={error ?? undefined} />
      </div>
    )
  const items: DescriptionListItem[] = [
    {
      key: 'fullName',
      icon: <User size={17} />,
      label: t('fullName'),
      value: driver.full_name,
    },
    {
      key: 'nameEn',
      icon: <User size={17} />,
      label: t('driverNameEn'),
      value: driver.name_en,
    },
    {
      key: 'idNumber',
      icon: <CreditCard size={17} />,
      label: t('idNumber'),
      value: driver.id_number,
      dir: 'ltr',
    },
    {
      key: 'mobileNumber',
      icon: <Phone size={17} />,
      label: t('mobileNumber'),
      value: driver.mobile_number,
      dir: 'ltr',
    },
    {
      key: 'nationality',
      icon: <Flag size={17} />,
      label: t('nationality'),
      value: driver.nationality,
    },
    {
      key: 'employmentType',
      icon: <Briefcase size={17} />,
      label: t('employmentType'),
      value: driver.employment_type,
    },
    {
      key: 'jobTitle',
      icon: <Briefcase size={17} />,
      label: t('jobTitle'),
      value: driver.job_title,
    },
  ]
  const showEmptyEquipment =
    !equipmentLoading && !equipmentError && equipment.length === 0
  return (
    <div className="space-y-5">
      <PageHeader
        title={driver.full_name}
        description={t('driverDetails')}
        onBack={onBack}
        backLabel={t('backToDrivers')}
      />
      <div className="card">
        <DescriptionList items={items} columns={2} />
      </div>
      <Card className="space-y-3">
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
            onRetry={fetchEquipment}
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
            onRowClick={(item) => router.push(`/equipment/${item.equipmentId}`)}
          />
        )}
      </Card>
    </div>
  )
}
