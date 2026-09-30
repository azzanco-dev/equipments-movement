import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import type { Driver } from '@/lib/types'
import {
  DRIVER_EQUIPMENT_LIMIT,
  DRIVER_EQUIPMENT_SELECT,
  DRIVER_EQUIPMENT_SUMMARY_VIEW,
  mapDriverEquipmentRows,
  type DriverEquipmentItem,
  type DriverEquipmentSummaryRow,
} from '@/lib/driverEquipment'
import { useListRequest } from '@/components/data-list/useListRequest'

/**
 * Driver record plus its "related equipment" summary (migration 0092),
 * shared by the standalone driver page and the driver detail dialog so the
 * fetch logic exists exactly once. `driverId` of `null` skips both fetches,
 * which lets a caller mount the hook unconditionally (before a dialog has a
 * driver to show, for example) without firing a request.
 *
 * "Pending" is derived from "the requested id is not the loaded id", never
 * from a flag that an effect raises after the first render: the very first
 * render for a new `driverId` already reports `loading`, so a caller can
 * never paint its error or empty state before the first fetch has answered.
 */
export function useDriverDetail(driverId: string | null) {
  const { t } = useI18n()
  const [driver, setDriver] = useState<Driver | null>(null)
  // The id the `driver`/`failed` pair below belongs to.
  const [driverLoadedId, setDriverLoadedId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [equipment, setEquipment] = useState<DriverEquipmentItem[]>([])
  // The id the `equipment`/`equipmentError` pair below belongs to.
  const [equipmentLoadedId, setEquipmentLoadedId] = useState<string | null>(
    null,
  )
  const [equipmentBusy, setEquipmentBusy] = useState(false)
  const [equipmentError, setEquipmentError] = useState(false)
  const startDriverRequest = useListRequest()
  const startEquipmentRequest = useListRequest()

  const fetchDriver = useCallback(async () => {
    // Also aborts the request of the previous driver, so a slow answer for
    // it can never overwrite the one on screen.
    const signal = startDriverRequest()
    if (!driverId) return
    const { data, error: fetchError } = await supabase
      .from('drivers')
      .select(
        'id,full_name,name_en,id_number,mobile_number,nationality,employment_type,job_title,created_at,updated_at',
      )
      .eq('id', driverId)
      .abortSignal(signal)
      .maybeSingle()
    if (signal.aborted) return
    const found = !fetchError && Boolean(data)
    setDriver(found ? (data as Driver) : null)
    setFailed(!found)
    setDriverLoadedId(driverId)
  }, [driverId, startDriverRequest])

  /**
   * Equipment derived from movements by `driver_equipment_summary`
   * (migration 0092). The view is `security_invoker`, so a foreman only
   * ever gets the visits his own RLS lets him read; no role check belongs
   * here.
   */
  const fetchEquipment = useCallback(async () => {
    const signal = startEquipmentRequest()
    if (!driverId) {
      setEquipmentBusy(false)
      return
    }
    setEquipmentBusy(true)
    setEquipmentError(false)
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
    setEquipmentError(Boolean(fetchError))
    setEquipment(
      fetchError
        ? []
        : mapDriverEquipmentRows(
            data as unknown as DriverEquipmentSummaryRow[] | null,
          ),
    )
    setEquipmentLoadedId(driverId)
    setEquipmentBusy(false)
  }, [driverId, startEquipmentRequest])

  useEffect(() => {
    fetchDriver()
  }, [fetchDriver])

  useEffect(() => {
    fetchEquipment()
  }, [fetchEquipment])

  // While the dialog is closed (`driverId` null) the last record stays as it
  // was; a new id is pending until its own answer arrived.
  const loading = driverId !== null && driverLoadedId !== driverId
  const equipmentPending = driverId !== null && equipmentLoadedId !== driverId

  return {
    driver: loading ? null : driver,
    loading,
    error: !loading && failed ? t('driverNotFound') : null,
    equipment: equipmentPending ? [] : equipment,
    /** First load of the equipment for this driver (no data to show yet). */
    equipmentPending,
    /** First load or a retry in flight. */
    equipmentLoading: equipmentPending || equipmentBusy,
    equipmentError: !equipmentPending && equipmentError,
    refetchEquipment: fetchEquipment,
  }
}
