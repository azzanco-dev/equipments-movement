'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { localizedName } from '@/lib/localizedName'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionHeader,
  Skeleton,
} from '@/components/ui'
import type { BadgeTone } from '@/components/ui'
import {
  EquipmentSuggestSearch,
  type EquipmentSuggestion,
} from '@/components/inquiry/EquipmentSuggestSearch'
import { EquipmentTimeline } from '@/components/inquiry/EquipmentTimeline'
import type { EquipmentPresence, TimelineMovement } from '@/lib/visitTimeline'
import {
  buildEquipmentSuggestFilter,
  deriveEquipmentState,
  parseEquipmentIdParam,
  type InquiryLastMovement,
} from '@/lib/equipmentInquiry'
import type { OwnershipStatus } from '@/lib/types'

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
  ownership_status: OwnershipStatus
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

const STATE_TONE: Record<EquipmentPresence, BadgeTone> = {
  inside_site: 'success',
  inside_workshop: 'info',
  outside: 'neutral',
}

const STATE_LABEL = {
  inside_site: 'insideSite',
  inside_workshop: 'insideWorkshop',
  outside: 'outsideSite',
} as const

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
  const [lastMovement, setLastMovement] = useState<InquiryLastMovement | null>(
    null,
  )
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

  // --- Selected equipment + current state -------------------------------

  const fetchDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true)
      setDetailError(false)
      setDetailMissing(false)
      const signal = startDetailRequest()
      const [equipmentResult, lastMovementResult] = await Promise.all([
        supabase
          .from('equipment')
          .select('id,code,type,plate_number,chassis_number,ownership_status')
          .eq('id', id)
          .abortSignal(signal)
          .maybeSingle(),
        // get_last_movement returns the latest movement across BOTH contexts
        // regardless of the context argument (migration 0091) and is granted
        // to every authenticated role, so the current state stays correct
        // even when entry_exit_logs RLS would hide the row from a plain
        // select (e.g. a foreman looking up equipment inside the workshop).
        supabase.rpc('get_last_movement', {
          p_equipment_id: id,
          p_movement_context: 'site',
        }),
      ])
      if (signal.aborted) return
      if (equipmentResult.error || lastMovementResult.error) {
        setDetailError(true)
        setEquipment(null)
        setLastMovement(null)
        setDetailLoading(false)
        return
      }
      const row = equipmentResult.data as InquiryEquipmentRow | null
      if (!row) {
        setDetailMissing(true)
        setEquipment(null)
        setLastMovement(null)
        setDetailLoading(false)
        return
      }
      const lastRows =
        (lastMovementResult.data as InquiryLastMovement[] | null) ?? []
      setEquipment(row)
      setLastMovement(lastRows[0] ?? null)
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
      setLastMovement(null)
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

  const state = useMemo(
    () => deriveEquipmentState(lastMovement),
    [lastMovement],
  )

  const ownerLabel = equipment
    ? equipment.ownership_status === 'alazani'
      ? t('ownershipAlazani')
      : equipment.ownership_status === 'takween'
        ? t('ownershipTakween')
        : equipment.ownership_status === 'third_party_f'
          ? t('ownershipThirdPartyF')
          : equipment.ownership_status === 'third_party_partnership_b'
            ? t('ownershipThirdPartyPartnershipB')
            : t('ownershipExternalSupplier')
    : null

  // Company and project are two lines under the identity row (owner
  // decision): one joined line overflowed the card on long names.
  const stateCompany =
    state.presence === 'inside_site'
      ? localizedName(lang, state.companyNameAr, state.companyNameEn)
      : null
  const stateProject =
    state.presence === 'inside_site'
      ? localizedName(lang, state.projectNameAr, state.projectNameEn)
      : null
  const hasName = (value: string | null) => Boolean(value && value !== '—')

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
            <div className="space-y-2 rounded-lg border bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-semibold" dir="ltr">
                  {equipment.code}
                </span>
                <span className="truncate-safe min-w-0 text-sm text-muted">
                  {equipment.type || '—'}
                </span>
                {equipment.plate_number && (
                  <span className="text-sm text-muted" dir="ltr">
                    {equipment.plate_number}
                  </span>
                )}
                {ownerLabel && <Badge>{ownerLabel}</Badge>}
                <span className="mx-1 hidden text-muted sm:inline">·</span>
                <Badge tone={STATE_TONE[state.presence]}>
                  {t(STATE_LABEL[state.presence])}
                </Badge>
              </div>
              {state.presence === 'inside_site' &&
                (hasName(stateCompany) || hasName(stateProject)) && (
                  <div className="min-w-0 space-y-0.5 text-sm">
                    {hasName(stateCompany) && (
                      <p
                        className="truncate-safe text-fg"
                        title={stateCompany!}
                      >
                        {stateCompany}
                      </p>
                    )}
                    {hasName(stateProject) && (
                      <p
                        className="truncate-safe text-muted"
                        title={stateProject!}
                      >
                        {stateProject}
                      </p>
                    )}
                  </div>
                )}
              {state.presence === 'inside_site' && state.supervisorName && (
                <p className="truncate-safe text-xs text-muted">
                  {state.supervisorName}
                </p>
              )}
              {state.presence === 'inside_workshop' &&
                state.workshopPurpose && (
                  <span className="text-xs text-muted">
                    {t(
                      state.workshopPurpose === 'maintenance'
                        ? 'maintenancePurpose'
                        : 'parkingPurpose',
                    )}
                  </span>
                )}
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
