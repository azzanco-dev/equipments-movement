import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import {
  Building2,
  Calendar,
  Edit2,
  Factory,
  Hash,
  MapPin,
  ShieldCheck,
  Truck,
  Wrench,
} from 'lucide-react'
import type {
  Equipment,
  MovementType,
  OperationalStatus,
  OwnershipStatus,
} from '@/lib/types'
import {
  isOwnedEquipment,
  usesExternalSupplier,
} from '@/lib/equipmentOwnership'
import { equipmentStatusBadge, isUnderMaintenance } from '@/lib/equipmentForm'
import { formatDate } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import { Alert } from '@/components/Alert'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  fetchProfileNames,
  withSupervisorNames,
  type ProfileName,
} from '@/components/details/profileNames'
import {
  BackButton,
  Badge,
  Button,
  DetailHeader,
  EmptyState,
  ErrorState,
  InfoGridSection,
  MiniTable,
  MovementBadge,
  Skeleton,
  type DataTableColumn,
  type InfoGridItem,
} from '@/components/ui'

interface EquipmentDetailProps {
  equipmentId: string
  onBack: () => void
  onEdit: (eq: Equipment) => void
  onSelectMovement?: (id: string) => void
  onViewAllMovements?: (equipmentCode: string) => void
}

/** The latest movements shown on the page; the full history is one "View
 *  all" away, so the section never grows with the equipment's age. */
const RECENT_MOVEMENTS_LIMIT = 10

// Only what the recent-movements table and the derived "under maintenance"
// badge read. The recorder's name is resolved separately through
// `profile_names` (see `fetchProfileNames`).
const RECENT_MOVEMENTS_SELECT =
  'id,movement_type,movement_context,workshop_purpose,supervisor_id,driver_name,recorded_at'

interface RecentMovementRow {
  id: string
  movement_type: MovementType
  movement_context: 'site' | 'workshop' | null
  workshop_purpose: 'maintenance' | 'parking' | null
  supervisor_id: string | null
  driver_name: string | null
  recorded_at: string
  supervisor: ProfileName | null
}

export function EquipmentDetail({
  equipmentId,
  onBack,
  onEdit,
  onSelectMovement,
  onViewAllMovements,
}: EquipmentDetailProps) {
  const { t, lang } = useI18n()
  const [equipment, setEquipment] = useState<Equipment | null>(null)
  const [logs, setLogs] = useState<RecentMovementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const startRequest = useListRequest()

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const signal = startRequest()
    const [equipmentResult, logsResult] = await Promise.all([
      supabase
        .from('equipment')
        .select(
          '*, project:projects(id,name_ar,name_en), lessor:lessors(id,name)',
        )
        .eq('id', equipmentId)
        .abortSignal(signal)
        .maybeSingle(),
      supabase
        .from('entry_exit_logs')
        .select(RECENT_MOVEMENTS_SELECT)
        .eq('equipment_id', equipmentId)
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(RECENT_MOVEMENTS_LIMIT)
        .abortSignal(signal),
    ])
    if (signal.aborted) return
    const rawLogs =
      (logsResult.data as Omit<RecentMovementRow, 'supervisor'>[] | null) ?? []
    const names = await fetchProfileNames(
      supabase,
      rawLogs.map((log) => log.supervisor_id),
      signal,
    )
    if (signal.aborted) return
    // A failed name lookup is reported like the movements it belongs to, so
    // the table never silently shows every recorder as "—".
    if (equipmentResult.error || logsResult.error || names.failed)
      setError(t('equipmentLoadError'))
    setEquipment(equipmentResult.data as Equipment | null)
    setLogs(withSupervisorNames(rawLogs, names.names))
    setLoading(false)
  }, [equipmentId, startRequest, t])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const statusLabel = (s: OperationalStatus) =>
    s === 'operational'
      ? t('operational')
      : s === 'maintenance'
        ? t('maintenance')
        : t('stopped')
  const ownLabel = (s: OwnershipStatus) =>
    s === 'alazani'
      ? t('ownershipAlazani')
      : s === 'takween'
        ? t('ownershipTakween')
        : s === 'third_party_f'
          ? t('ownershipThirdPartyF')
          : s === 'third_party_partnership_b'
            ? t('ownershipThirdPartyPartnershipB')
            : t('ownershipExternalSupplier')
  const regLabel = (s: string | null) =>
    s === 'private_transport'
      ? t('privateTransport')
      : s === 'public_transport'
        ? t('publicTransport')
        : s === 'heavy_equipment'
          ? t('heavyEquipment')
          : null
  const dateOrNull = (value: string | null) =>
    value ? formatDate(value) : null

  const movementColumns: DataTableColumn<RecentMovementRow>[] = [
    {
      key: 'movement_type',
      header: t('movementType'),
      cell: (log) => <MovementBadge type={log.movement_type} />,
    },
    {
      key: 'supervisor',
      header: t('supervisorName'),
      cell: (log) => log.supervisor?.full_name ?? '—',
    },
    {
      key: 'driver',
      header: t('driverName'),
      cell: (log) => log.driver_name ?? '—',
    },
    {
      key: 'recorded_at',
      header: t('recordedAt'),
      cell: (log) => formatDate(log.recorded_at),
    },
  ]

  // `logs` is the latest movements ordered (recorded_at DESC, id DESC), so the
  // first row is the latest movement across both contexts — the same ordering
  // every state derivation in the database uses.
  const statusBadge = equipmentStatusBadge(equipment?.status)
  const underMaintenance = isUnderMaintenance(logs[0])

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
  if (!equipment)
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} label={t('backToEquipment')} />
        {error ? (
          <ErrorState description={error} onRetry={fetchData} />
        ) : (
          <EmptyState title={t('noEquipment')} />
        )}
      </div>
    )

  const identityItems: InfoGridItem[] = [
    {
      key: 'code',
      icon: <Hash size={16} />,
      label: t('equipmentCode'),
      value: equipment.code,
      dir: 'ltr',
    },
    {
      key: 'type',
      icon: <Wrench size={16} />,
      label: t('equipmentType'),
      value: equipment.type,
    },
    {
      key: 'plate',
      icon: <Truck size={16} />,
      label: t('plateNumber'),
      value: equipment.plate_number,
      dir: 'ltr',
    },
    {
      key: 'chassis',
      icon: <Hash size={16} />,
      label: t('chassisNumber'),
      value: equipment.chassis_number,
      dir: 'ltr',
    },
    {
      key: 'brand',
      icon: <Factory size={16} />,
      label: t('brand'),
      value: equipment.brand,
    },
    {
      key: 'model',
      icon: <Factory size={16} />,
      label: t('model'),
      value: equipment.model,
    },
    {
      key: 'manufactureYear',
      icon: <Calendar size={16} />,
      label: t('manufactureYear'),
      value: equipment.manufacture_year?.toString(),
      numeric: true,
    },
    {
      key: 'registrationType',
      icon: <ShieldCheck size={16} />,
      label: t('registrationType'),
      value: regLabel(equipment.registration_type),
    },
    {
      key: 'operationalStatus',
      icon: <Wrench size={16} />,
      label: t('operationalStatus'),
      value: statusLabel(equipment.operational_status),
    },
  ]

  const ownershipItems: InfoGridItem[] = [
    {
      key: 'owner',
      icon: <Building2 size={16} />,
      label: t('ownershipStatus'),
      value: ownLabel(equipment.ownership_status),
    },
    {
      key: 'ownershipState',
      icon: <Building2 size={16} />,
      label: t('ownershipState'),
      value: isOwnedEquipment(equipment.ownership_status)
        ? t('owned')
        : t('rented'),
    },
    // The supplier only exists for "Other owner"; every other owner clears
    // `lessor_id`, so the row is hidden there instead of showing "—".
    ...(usesExternalSupplier(equipment.ownership_status)
      ? [
          {
            key: 'externalSupplier',
            icon: <Building2 size={16} />,
            label: t('externalSupplier'),
            value: equipment.lessor?.name,
          },
        ]
      : []),
    {
      key: 'project',
      icon: <MapPin size={16} />,
      label: t('project'),
      value: equipment.project
        ? localizedName(
            lang,
            equipment.project.name_ar,
            equipment.project.name_en,
          )
        : null,
    },
  ]

  const dateItems: InfoGridItem[] = [
    {
      key: 'registrationExpiry',
      icon: <Calendar size={16} />,
      label: t('registrationExpiry'),
      value: dateOrNull(equipment.registration_expiry),
    },
    {
      key: 'insuranceExpiry',
      icon: <Calendar size={16} />,
      label: t('insuranceExpiry'),
      value: dateOrNull(equipment.insurance_expiry),
    },
    {
      key: 'lastMaintenanceDate',
      icon: <Calendar size={16} />,
      label: t('lastMaintenanceDate'),
      value: dateOrNull(equipment.last_maintenance_date),
    },
  ]

  return (
    <div className="space-y-5">
      <BackButton onClick={onBack} label={t('backToEquipment')} />

      {error && <Alert type="error">{error}</Alert>}

      <div className="card space-y-5">
        <DetailHeader
          as="h1"
          identifier={equipment.code}
          identifierLtr
          subtitle={equipment.type}
          badges={
            <>
              <Badge tone={statusBadge.tone}>{t(statusBadge.key)}</Badge>
              {/* Derived, never stored: the latest movement is an open
                  workshop entry classified as maintenance. */}
              {underMaintenance && (
                <Badge tone="warning">{t('underMaintenance')}</Badge>
              )}
              <Badge tone="neutral">
                {ownLabel(equipment.ownership_status)}
              </Badge>
            </>
          }
          actions={
            <Button
              variant="outline"
              size="sm"
              icon={<Edit2 size={14} />}
              onClick={() => onEdit(equipment)}
            >
              {t('editEquipment')}
            </Button>
          }
        />
        <InfoGridSection
          title={t('detailSectionIdentity')}
          items={identityItems}
        />
        <InfoGridSection
          title={t('detailSectionOwnership')}
          items={ownershipItems}
          columns={2}
        />
        <InfoGridSection title={t('detailSectionDates')} items={dateItems} />
      </div>

      <MiniTable
        title={t('movementHistory')}
        description={t('detailRecentMovementsDesc')}
        columns={movementColumns}
        rows={logs}
        rowKey={(log) => log.id}
        maxRows={RECENT_MOVEMENTS_LIMIT}
        onViewAll={
          onViewAllMovements
            ? () => onViewAllMovements(equipment.code)
            : undefined
        }
        onRowClick={
          onSelectMovement ? (log) => onSelectMovement(log.id) : undefined
        }
        empty={t('noMovements')}
      />
    </div>
  )
}
