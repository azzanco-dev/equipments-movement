import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { QRCodeDisplay } from '@/components/QRCodeDisplay'
import {
  Edit2,
  Power,
  Printer,
  Calendar,
  Truck,
  Building2,
  Wrench,
  FileText,
} from 'lucide-react'
import type {
  Equipment,
  EntryExitLog,
  OperationalStatus,
  OwnershipStatus,
} from '@/lib/types'
import {
  isOwnedEquipment,
  usesExternalSupplier,
} from '@/lib/equipmentOwnership'
import { formatDate } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import { printEquipmentQr } from '@/lib/printEquipmentQr'
import { Alert } from '@/components/Alert'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  BackButton,
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  InfoRow,
  MovementBadge,
  PageHeader,
  Skeleton,
  type DataTableColumn,
} from '@/components/ui'

interface EquipmentDetailProps {
  equipmentId: string
  onBack: () => void
  onEdit: (eq: Equipment) => void
  onSelectMovement?: (id: string) => void
  onViewAllMovements?: (equipmentCode: string) => void
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
  const [logs, setLogs] = useState<EntryExitLog[]>([])
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
        .select('*, project:projects(*), lessor:lessors(*)')
        .eq('id', equipmentId)
        .abortSignal(signal)
        .maybeSingle(),
      supabase
        .from('entry_exit_logs')
        .select('*, supervisor:profiles(*)')
        .eq('equipment_id', equipmentId)
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(10)
        .abortSignal(signal),
    ])
    if (signal.aborted) return
    if (equipmentResult.error || logsResult.error)
      setError(t('equipmentLoadError'))
    setEquipment(equipmentResult.data as Equipment | null)
    setLogs((logsResult.data as EntryExitLog[]) ?? [])
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
          : '—'

  const movementColumns: DataTableColumn<EntryExitLog>[] = [
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

  async function toggleActive(eq: Equipment) {
    const { error } = await supabase
      .from('equipment')
      .update({ is_active: !eq.is_active })
      .eq('id', eq.id)
    if (error) console.error(error)
    fetchData()
  }

  function printQR(eq: Equipment) {
    setError(null)
    void printEquipmentQr(eq, () => setError(t('printQrError')))
  }

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

  return (
    <div className="space-y-6">
      {error && <Alert type="error">{error}</Alert>}

      <PageHeader
        title={t('equipmentDetails')}
        description={t('equipmentDetailDesc')}
        onBack={onBack}
        backLabel={t('backToEquipment')}
      />

      {/* Header card */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-6">
          {/* QR Code */}
          <div className="flex flex-col items-center gap-3 shrink-0">
            <QRCodeDisplay value={equipment.qr_value} size={160} />
            <div className="flex gap-2">
              <IconButton
                label={t('printQR')}
                icon={<Printer size={16} />}
                onClick={() => printQR(equipment)}
              />
              <IconButton
                label={t('editEquipment')}
                icon={<Edit2 size={16} />}
                onClick={() => onEdit(equipment)}
              />
              <IconButton
                label={t('isActive')}
                icon={<Power size={16} />}
                onClick={() => toggleActive(equipment)}
              />
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 space-y-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-2xl font-bold">{equipment.code}</h2>
                <Badge tone={equipment.is_active ? 'success' : 'neutral'}>
                  {equipment.is_active ? t('active') : t('inactive')}
                </Badge>
              </div>
              <p className="text-muted mt-1">{equipment.type}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <InfoRow
                icon={<Truck size={16} />}
                label={t('plateNumber')}
                value={equipment.plate_number}
                dir="ltr"
              />
              <InfoRow
                icon={<Wrench size={16} />}
                label={t('operationalStatus')}
                value={statusLabel(equipment.operational_status)}
              />
              <InfoRow
                icon={<Building2 size={16} />}
                label={t('ownershipStatus')}
                value={ownLabel(equipment.ownership_status)}
              />
              <InfoRow
                label={t('ownershipState')}
                value={
                  isOwnedEquipment(equipment.ownership_status)
                    ? t('owned')
                    : t('rented')
                }
              />
              <InfoRow label={t('brand')} value={equipment.brand} />
              <InfoRow label={t('model')} value={equipment.model} />
              <InfoRow
                label={t('manufactureYear')}
                value={equipment.manufacture_year?.toString()}
              />
              <InfoRow
                label={t('chassisNumber')}
                value={equipment.chassis_number}
                dir="ltr"
              />
              <InfoRow
                label={t('registrationType')}
                value={regLabel(equipment.registration_type)}
              />
              <InfoRow
                label={t('project')}
                value={
                  equipment.project
                    ? localizedName(
                        lang,
                        equipment.project.name_ar,
                        equipment.project.name_en,
                      )
                    : undefined
                }
              />
              {usesExternalSupplier(equipment.ownership_status) && (
                <InfoRow
                  label={t('externalSupplier')}
                  value={equipment.lessor?.name}
                />
              )}
              <InfoRow
                icon={<Calendar size={16} />}
                label={t('lastMaintenanceDate')}
                value={
                  equipment.last_maintenance_date
                    ? formatDate(equipment.last_maintenance_date)
                    : null
                }
              />
              <InfoRow
                icon={<Calendar size={16} />}
                label={t('registrationExpiry')}
                value={
                  equipment.registration_expiry
                    ? formatDate(equipment.registration_expiry)
                    : null
                }
              />
              <InfoRow
                icon={<Calendar size={16} />}
                label={t('insuranceExpiry')}
                value={
                  equipment.insurance_expiry
                    ? formatDate(equipment.insurance_expiry)
                    : null
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* Movement history */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <FileText size={18} /> {t('movementHistory')}
          </h3>
          {onViewAllMovements && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onViewAllMovements(equipment.code)}
            >
              {t('viewAll')}
            </Button>
          )}
        </div>
        <DataTable
          size="sm"
          columns={movementColumns}
          rows={logs}
          rowKey={(log) => log.id}
          onRowClick={
            onSelectMovement ? (log) => onSelectMovement(log.id) : undefined
          }
          empty={t('noMovements')}
        />
      </div>
    </div>
  )
}
