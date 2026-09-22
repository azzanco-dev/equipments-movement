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
 */
export function useDriverDetail(driverId: string | null) {
  const { t } = useI18n()
  const [driver, setDriver] = useState<Driver | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [equipment, setEquipment] = useState<DriverEquipmentItem[]>([])
  const [equipmentLoading, setEquipmentLoading] = useState(true)
  const [equipmentError, setEquipmentError] = useState(false)
  const startEquipmentRequest = useListRequest()

  const fetchDriver = useCallback(async () => {
    if (!driverId) {
      setDriver(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
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
   * (migration 0092). The view is `security_invoker`, so a foreman only
   * ever gets the visits his own RLS lets him read; no role check belongs
   * here.
   */
  const fetchEquipment = useCallback(async () => {
    if (!driverId) {
      setEquipment([])
      setEquipmentLoading(false)
      return
    }
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

  return {
    driver,
    loading,
    error,
    equipment,
    equipmentLoading,
    equipmentError,
    refetchEquipment: fetchEquipment,
  }
}
