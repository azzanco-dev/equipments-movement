'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { localizedName } from '@/lib/localizedName'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionHeader,
  Skeleton,
} from '@/components/ui'
import {
  EquipmentSuggestSearch,
  type EquipmentSuggestion,
} from '@/components/inquiry/EquipmentSuggestSearch'
import { EquipmentTimeline } from '@/components/inquiry/EquipmentTimeline'
import type { TimelineMovement } from '@/lib/visitTimeline'
import {
  buildEquipmentSuggestFilter,
  parseEquipmentIdParam,
} from '@/lib/equipmentInquiry'

/**
 * `/inquiry`: one search field finds an equipment by code/plate/chassis/type,
 * the product owner picks exactly one, and the page shows where it is right
 * now plus its full movement history as a timeline of visits. Every
 * signed-in role can open it — `entry_exit_logs` RLS decides which movement
 * rows come back, so a foreman only ever sees his own site visits and a
 * workshop role only ever sees workshop visits, exactly as everywhere else.
 *
 * Reviewed on `/ui-kit` as `EquipmentInquiryShowcase`; this screen keeps the
 * same `EquipmentSuggestSearch` / `EquipmentTimeline` components and swaps
 * the sample data for real Supabase reads.
 */

interface InquiryEquipmentRow {
  id: string
  code: string
  type: string | null
  plate_number: string | null
  chassis_number: string | null
}

interface MovementLogTimelineRow {
  id: string
  movement_type: 'entry' | 'exit'
  movement_context: 'site' | 'workshop'
  workshop_purpose: 'maintenance' | 'parking' | null
  recorded_at: string
  company_name_ar: string | null
  company_name_en: string | null
  project_name_ar: string | null
  project_name_en: string | null
  supervisor_name: string | null
  driver_name: string | null
}

const SUGGEST_LIMIT = 20
const SUGGEST_DEBOUNCE_MS = 300
// One page of RAW movement rows, not visits: a closed visit is 2 rows, an
// open one or a legacy lone exit is 1. 40 rows comfortably covers "the most
// recent 20 visits" for the common case while staying a bounded range fetch
// (never a full-table load). The oldest row in a page can render as a
// stand-alone "exit without entry" segment until "show more" pulls in the
// entry that actually opened it — a display nuance, not a data error.
const MOVEMENTS_PAGE_SIZE = 40

export function EquipmentInquiryScreen({
  onSelectMovement,
}: {
  /** Falls back to `router.push('/movements/:id')` when omitted. */
  onSelectMovement?: (id: string) => void
}) {
  const { t, lang } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const startSuggestRequest = useListRequest()
  const startDetailRequest = useListRequest()
  const startMovementsRequest = useListRequest()

  const equipmentId = parseEquipmentIdParam(searchParams.get('equipment'))

  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<EquipmentSuggestion[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)

  const [equipment, setEquipment] = useState<InquiryEquipmentRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [detailMissing, setDetailMissing] = useState(false)

  const [movements, setMovements] = useState<MovementLogTimelineRow[]>([])
  const [movementsOffset, setMovementsOffset] = useState(0)
  const [hasMoreMovements, setHasMoreMovements] = useState(false)
  const [movementsLoading, setMovementsLoading] = useState(false)
  const [movementsLoadingMore, setMovementsLoadingMore] = useState(false)
  const [movementsError, setMovementsError] = useState(false)

  const selectMovement = useCallback(
    (id: string) => {
      if (onSelectMovement) onSelectMovement(id)
      else router.push(`/movements/${id}`)
    },
    [onSelectMovement, router],
  )

  const setEquipmentParam = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams.toString())
      if (id) next.set('equipment', id)
      else next.delete('equipment')
      const suffix = next.toString()
      router.replace(`${pathname}${suffix ? `?${suffix}` : ''}`, {
        scroll: false,
      })
    },
    [pathname, router, searchParams],
  )

  // --- Suggestions -----------------------------------------------------

  useEffect(() => {
    const filter = buildEquipmentSuggestFilter(query)
    if (!filter) {
      setSuggestions([])
      setSuggestLoading(false)
      return
    }
    let active = true
    setSuggestLoading(true)
    const timer = window.setTimeout(async () => {
      const signal = startSuggestRequest()
      const { data, error } = await supabase
        .from('equipment')
        .select('id,code,type,plate_number,chassis_number')
        .or(filter)
        .order('code')
        .limit(SUGGEST_LIMIT)
        .abortSignal(signal)
      if (!active || signal.aborted) return
      const rows = (data as InquiryEquipmentRow[] | null) ?? []
      setSuggestions(
        error
          ? []
          : rows.map((row) => ({
              id: row.id,
              code: row.code,
              type_name: row.type,
              plate_number: row.plate_number,
              chassis_number: row.chassis_number,
            })),
      )
      setSuggestLoading(false)
    }, SUGGEST_DEBOUNCE_MS)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query, startSuggestRequest])

  // --- Selected equipment -----------------------------------------------

  const fetchDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true)
      setDetailError(false)
      setDetailMissing(false)
      const signal = startDetailRequest()
      // The brief row is identity only (code, type, plate or chassis); the
      // current state and the time since the last movement come from the
      // timeline summary cards below, so no extra read is needed here.
      const equipmentResult = await supabase
        .from('equipment')
        .select('id,code,type,plate_number,chassis_number')
        .eq('id', id)
        .abortSignal(signal)
        .maybeSingle()
      if (signal.aborted) return
      if (equipmentResult.error) {
        setDetailError(true)
        setEquipment(null)
        setDetailLoading(false)
        return
      }
      const row = equipmentResult.data as InquiryEquipmentRow | null
      if (!row) {
        setDetailMissing(true)
        setEquipment(null)
        setDetailLoading(false)
        return
      }
      setEquipment(row)
      setQuery(row.code)
      setDetailLoading(false)
    },
    [startDetailRequest],
  )

  // --- Movement history (paged, oldest fetch never dropped) ------------

  const fetchMovements = useCallback(
    async (id: string, offset: number, append: boolean) => {
      if (append) setMovementsLoadingMore(true)
      else setMovementsLoading(true)
      setMovementsError(false)
      const signal = startMovementsRequest()
      const { data, error } = await supabase
        .from('movement_log_search')
        .select(
          'id,movement_type,movement_context,workshop_purpose,recorded_at,company_name_ar,company_name_en,project_name_ar,project_name_en,supervisor_name,driver_name',
        )
        .eq('equipment_id', id)
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + MOVEMENTS_PAGE_SIZE - 1)
        .abortSignal(signal)
      if (signal.aborted) return
      if (error) {
        setMovementsError(true)
        if (!append) setMovements([])
      } else {
        const rows = (data as MovementLogTimelineRow[] | null) ?? []
        setMovements((prev) => (append ? [...prev, ...rows] : rows))
        setHasMoreMovements(rows.length === MOVEMENTS_PAGE_SIZE)
        setMovementsOffset(offset + rows.length)
      }
      if (append) setMovementsLoadingMore(false)
      else setMovementsLoading(false)
    },
    [startMovementsRequest],
  )

  useEffect(() => {
    if (!equipmentId) {
      setEquipment(null)
      setMovements([])
      setMovementsOffset(0)
      setHasMoreMovements(false)
      setDetailError(false)
      setDetailMissing(false)
      return
    }
    void fetchDetail(equipmentId)
    setMovements([])
    setMovementsOffset(0)
    setHasMoreMovements(false)
    void fetchMovements(equipmentId, 0, false)
    // fetchDetail/fetchMovements are stable (their own deps never change
    // across the component's life), so equipmentId alone drives this reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipmentId])

  const loadMoreMovements = useCallback(() => {
    if (!equipmentId) return
    void fetchMovements(equipmentId, movementsOffset, true)
  }, [equipmentId, fetchMovements, movementsOffset])

  const retryDetail = useCallback(() => {
    if (equipmentId) void fetchDetail(equipmentId)
  }, [equipmentId, fetchDetail])

  const retryMovements = useCallback(() => {
    if (equipmentId) void fetchMovements(equipmentId, 0, false)
  }, [equipmentId, fetchMovements])

  const clearSelection = useCallback(() => {
    setEquipmentParam(null)
    setQuery('')
    setSuggestions([])
  }, [setEquipmentParam])

  const pickSuggestion = useCallback(
    (suggestion: EquipmentSuggestion) => {
      setQuery(suggestion.code)
      setEquipmentParam(suggestion.id)
    },
    [setEquipmentParam],
  )

  const timelineMovements = useMemo<TimelineMovement[]>(
    () =>
      movements.map((row) => ({
        id: row.id,
        movement_context: row.movement_context,
        movement_type: row.movement_type,
        recorded_at: row.recorded_at,
        company_name: localizedName(
          lang,
          row.company_name_ar,
          row.company_name_en,
        ),
        project_name: localizedName(
          lang,
          row.project_name_ar,
          row.project_name_en,
        ),
        workshop_purpose: row.workshop_purpose,
        supervisor_name: row.supervisor_name,
        driver_name: row.driver_name,
      })),
    [movements, lang],
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('inquiryPageTitle')}
        description={t('inquiryPageDescription')}
      />

      <Card className="space-y-4">
        <SectionHeader
          title={t('searchEquipmentAnyField')}
          action={
            equipmentId && (
              <Button size="sm" variant="outline" onClick={clearSelection}>
                {t('inquiryChangeEquipment')}
              </Button>
            )
          }
        />

        {/* LTR: people type Latin equipment codes / plate digits here, even
            though the rest of the page stays RTL for Arabic. */}
        <div dir="ltr" className="max-w-xl text-start">
          <EquipmentSuggestSearch
            query={query}
            onQueryChange={setQuery}
            suggestions={suggestions}
            loading={suggestLoading}
            onPick={pickSuggestion}
            placeholder={t('searchEquipmentAnyField')}
          />
        </div>

        {!equipmentId ? (
          <EmptyState
            icon={<Search size={28} aria-hidden="true" />}
            title={t('inquiryEmptyTitle')}
            description={t('inquiryEmptyDescription')}
          />
        ) : detailLoading ? (
          <div
            className="space-y-2 py-2"
            aria-busy="true"
            aria-label={t('loading')}
          >
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : detailError ? (
          <ErrorState onRetry={retryDetail} />
        ) : detailMissing ? (
          <EmptyState
            title={t('inquiryEquipmentNotFound')}
            action={
              <Button size="sm" variant="outline" onClick={clearSelection}>
                {t('inquiryChangeEquipment')}
              </Button>
            }
          />
        ) : equipment ? (
          <div className="space-y-4">
            {/* Identity only: code, type, and the plate — or the chassis
                number when the equipment has no plate. The current state,
                the time since the last movement, and the latest visit's
                company/project/foreman all live in the timeline below. */}
            <div className="rounded-lg border bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-semibold" dir="ltr">
                  {equipment.code}
                </span>
                <span className="truncate-safe min-w-0 text-sm text-muted">
                  {equipment.type || '—'}
                </span>
                {equipment.plate_number ? (
                  <span className="text-sm text-muted" dir="ltr">
                    {equipment.plate_number}
                  </span>
                ) : equipment.chassis_number ? (
                  <span className="min-w-0 text-sm text-muted">
                    {t('chassisNumber')}:{' '}
                    <span dir="ltr" className="inline-block">
                      {equipment.chassis_number}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>

            {movementsError ? (
              <ErrorState onRetry={retryMovements} />
            ) : movementsLoading ? (
              <div
                className="space-y-2 py-2"
                aria-busy="true"
                aria-label={t('loading')}
              >
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-4/5" />
              </div>
            ) : (
              <div className="space-y-3">
                <EquipmentTimeline
                  movements={timelineMovements}
                  onSelectMovement={selectMovement}
                />
                {hasMoreMovements && (
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadMoreMovements}
                      disabled={movementsLoadingMore}
                    >
                      {movementsLoadingMore
                        ? t('loading')
                        : t('inquiryShowMoreVisits')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  )
}
