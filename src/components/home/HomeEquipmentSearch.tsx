import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { Button, SearchInput, cn } from '@/components/ui'
import { Card, SectionHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import {
  EquipmentStatusCard,
  type EquipmentTimelineItem,
} from '@/components/home/EquipmentStatusCard'
import {
  equipmentStateFromLastMovement,
  type HomeLastMovement,
} from '@/lib/homeStats'
import {
  MOVEMENT_LOG_HOME_TIMELINE_SELECT,
  MOVEMENT_LOG_SEARCH_VIEW,
} from '@/lib/movementLogSearch'
import { localizedName } from '@/lib/localizedName'
import { formatDate } from '@/lib/dateFormat'
import { plateDigitsSearchTerm, toLatinDigits } from '@/lib/plate'
import { sanitizeSearchTerm } from '@/lib/search'
import type { OwnershipStatus } from '@/lib/types'

interface EquipmentRow {
  id: string
  code: string
  type: string | null
  plate_number: string | null
  ownership_status: OwnershipStatus
}

interface TimelineRow {
  id: string
  movement_type: 'entry' | 'exit'
  movement_context: 'site' | 'workshop'
  workshop_purpose: 'maintenance' | 'parking' | null
  recorded_at: string
  company_name_ar: string | null
  company_name_en: string | null
  project_name_ar: string | null
  project_name_en: string | null
}

const SEARCH_LIMIT = 5
const TIMELINE_LIMIT = 5

/**
 * Unified equipment search shared by the foreman and workshop home pages: one
 * box that finds an equipment by code, plate, chassis or type and shows where
 * it is right now plus its latest movements.
 *
 * The current state comes from `get_last_movement()`, which returns the latest
 * movement across BOTH contexts. That is deliberate: `entry_exit_logs` RLS
 * hides workshop rows from a foreman, so a `movement_log_search` lookup would
 * report a piece of equipment that is inside the workshop as merely "outside".
 * The RPC is the reviewed SECURITY DEFINER function the movement form already
 * uses, and it returns the state only (never who registered it), which is
 * exactly the owner's decision of 2026-09-17: a foreman sees the workshop
 * state, but not the workshop movement rows. The timeline below it stays on
 * the `security_invoker` view, so a foreman keeps seeing site rows only.
 */
export function HomeEquipmentSearch({ className }: { className?: string }) {
  const { t, lang } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EquipmentRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [detail, setDetail] = useState<{
    last: HomeLastMovement | null
    timeline: EquipmentTimelineItem[]
  } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const term = toLatinDigits(sanitizeSearchTerm(query))
  const retry = useCallback(() => setReloadToken((value) => value + 1), [])

  useEffect(() => {
    if (!term) {
      setResults([])
      setSelectedId(null)
      setSearchError(false)
      setSearching(false)
      return
    }
    let active = true
    setSearching(true)
    const timer = window.setTimeout(async () => {
      const parts = [
        `code.ilike.%${term}%`,
        `type.ilike.%${term}%`,
        `plate_number.ilike.%${term}%`,
        `chassis_number.ilike.%${term}%`,
      ]
      const digits = plateDigitsSearchTerm(term)
      if (digits) parts.push(`plate_digits.ilike.%${digits}%`)
      const { data, error } = await supabase
        .from('equipment')
        .select('id,code,type,plate_number,ownership_status')
        .or(parts.join(','))
        .order('code')
        .limit(SEARCH_LIMIT)
      if (!active) return
      const rows = (data as EquipmentRow[] | null) ?? []
      setSearchError(Boolean(error))
      setResults(error ? [] : rows)
      setSelectedId(error ? null : (rows[0]?.id ?? null))
      setSearching(false)
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [term, reloadToken])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      setDetailError(false)
      setDetailLoading(false)
      return
    }
    let active = true
    setDetailLoading(true)
    setDetailError(false)
    void (async () => {
      const [lastResult, timelineResult] = await Promise.all([
        supabase.rpc('get_last_movement', {
          p_equipment_id: selectedId,
          p_movement_context: 'site',
        }),
        supabase
          .from(MOVEMENT_LOG_SEARCH_VIEW)
          .select(MOVEMENT_LOG_HOME_TIMELINE_SELECT)
          .eq('equipment_id', selectedId)
          .order('recorded_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(TIMELINE_LIMIT),
      ])
      if (!active) return
      if (lastResult.error || timelineResult.error) {
        setDetailError(true)
        setDetail(null)
        setDetailLoading(false)
        return
      }
      const last =
        ((lastResult.data as HomeLastMovement[] | null) ?? [])[0] ?? null
      const rows = (timelineResult.data as TimelineRow[] | null) ?? []
      setDetail({
        last,
        timeline: rows.map((row) => ({
          id: row.id,
          context: row.movement_context,
          movement: row.movement_type,
          location:
            row.movement_context === 'workshop'
              ? row.workshop_purpose === 'maintenance'
                ? t('maintenancePurpose')
                : row.workshop_purpose === 'parking'
                  ? t('parkingPurpose')
                  : t('pendingClassification')
              : `${localizedName(lang, row.company_name_ar, row.company_name_en)} · ${localizedName(lang, row.project_name_ar, row.project_name_en)}`,
          date: formatDate(row.recorded_at),
        })),
      })
      setDetailLoading(false)
    })()
    return () => {
      active = false
    }
  }, [selectedId, reloadToken, lang, t])

  const selected = results.find((row) => row.id === selectedId) ?? null
  const ownerLabel = (status: OwnershipStatus) =>
    status === 'alazani'
      ? t('ownershipAlazani')
      : status === 'takween'
        ? t('ownershipTakween')
        : status === 'third_party_f'
          ? t('ownershipThirdPartyF')
          : status === 'third_party_partnership_b'
            ? t('ownershipThirdPartyPartnershipB')
            : t('ownershipExternalSupplier')

  const siteLocation = detail?.timeline.find(
    (item) => item.context === 'site' && item.movement === 'entry',
  )?.location

  return (
    <Card className={cn('space-y-3', className)}>
      <SectionHeader
        as="h2"
        title={t('equipmentSearchTitle')}
        description={t('equipmentSearchDesc')}
      />
      <SearchInput
        value={query}
        onValueChange={setQuery}
        placeholder={t('equipmentSearchPlaceholder')}
        className="max-w-md"
      />

      {!term ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted">
          {t('equipmentSearchPrompt')}
        </p>
      ) : searchError ? (
        <ErrorState onRetry={retry} />
      ) : (
        <>
          {results.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {results.map((row) => (
                <Button
                  key={row.id}
                  size="sm"
                  variant={row.id === selectedId ? 'primary' : 'outline'}
                  onClick={() => setSelectedId(row.id)}
                >
                  {row.code}
                </Button>
              ))}
            </div>
          )}
          {selected && detailError ? (
            <ErrorState onRetry={retry} />
          ) : (
            <EquipmentStatusCard
              equipment={
                selected
                  ? {
                      id: selected.id,
                      code: selected.code,
                      type: selected.type ?? '—',
                      plate: selected.plate_number ?? '—',
                      owner: ownerLabel(selected.ownership_status),
                    }
                  : null
              }
              state={
                selected
                  ? equipmentStateFromLastMovement(
                      detail?.last,
                      siteLocation ?? '—',
                    )
                  : undefined
              }
              timeline={detail?.timeline ?? []}
              loading={searching || (Boolean(selected) && detailLoading)}
            />
          )}
        </>
      )}
    </Card>
  )
}
