'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Building2, Calendar, ExternalLink, Hash, Tag } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { localizedName } from '@/lib/localizedName'
import { useListRequest } from '@/components/data-list/useListRequest'
import { usePermissions } from '@/auth/PermissionsContext'
import {
  AppLink,
  Button,
  EmptyState,
  ErrorState,
  InfoGrid,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  type InfoGridItem,
} from '@/components/ui'
import type { EquipmentSuggestion } from '@/components/inquiry/EquipmentSuggestSearch'
import { InquirySearch } from '@/components/inquiry/InquirySearch'
import { InquiryPlate } from '@/components/inquiry/InquiryPlate'
import { InquiryNow } from '@/components/inquiry/InquiryNow'
import { InquiryThinking } from '@/components/inquiry/InquiryThinking'
import { InquiryPoCard, type InquiryPo } from '@/components/inquiry/InquiryPoCard'
import { InquiryYearNumbers, InquiryYearStrip } from '@/components/inquiry/InquiryYear'
import {
  InquiryJourney,
  inquiryVisitAnchor,
} from '@/components/inquiry/InquiryJourney'
import {
  INQUIRY_SURFACE,
  InquiryCardTitle,
  InquiryStateDot,
  inquiryRise,
} from '@/components/inquiry/inquiryStyle'
import { buildEquipmentVisits, type TimelineMovement } from '@/lib/visitTimeline'
import {
  inquiryYearChoices,
  inquiryYearDays,
  inquiryYearMonths,
  inquiryYearRange,
  saudiYear,
  summarizeInquiryYear,
} from '@/lib/inquiryYear'
import {
  buildEquipmentSuggestFilter,
  parseEquipmentIdParam,
} from '@/lib/equipmentInquiry'
import { toLatinDigits } from '@/lib/plate'
import { sanitizeSearchTerm } from '@/lib/search'
import {
  EQUIPMENT_CODE_CHANGES_LIMIT,
  EQUIPMENT_CODE_CHANGE_SELECT,
  codeMatchesTerm,
  fetchPreviousCodeMatchIds,
  previousCodeOrPart,
  type EquipmentCodeChange,
} from '@/lib/equipmentCodeHistory'
import { PreviousCodesLine } from '@/components/inquiry/PreviousCodes'
import { EquipmentLocationCard } from '@/components/afaqy/EquipmentLocationCard'
import { preferRecordName } from '@/lib/driverDisplayName'
import {
  equipmentStateFromMovement,
  equipmentStateText,
  isEquipmentNew,
  parseEquipmentState,
  type EquipmentState,
} from '@/lib/equipmentState'
import { EquipmentStateBadge } from '@/components/equipment/EquipmentStateBadge'
import { EquipmentNewBadge } from '@/components/equipment/EquipmentNewBadge'
import { LtrValue } from '@/components/ui/InfoGrid'
import { formatDate } from '@/lib/dateFormat'
import { ownershipBadge } from '@/lib/equipmentForm'
import type { OwnershipStatus } from '@/lib/types'

/**
 * `/inquiry` (redesigned 2026-10-26 on the owner's word, «طيب الحين طبق على
 * الصفحة», after the /ui-kit mockup «نموذج صفحة الاستعلام الجديدة»): the
 * page opens like the home of an AI assistant — a question, one line and a
 * big field in the middle, with the reader's recent units — and the answer
 * rises in: the unit with its one state and, for an external supplier's
 * unit, the supplier; «الحين» (where it is now, since when, the foreman,
 * driver); the chosen calendar year (this year first): its numbers
 * and one strip of its stays;
 * the facts and the (admin) location beside «الرحلة», every stay in full.
 *
 * Every signed-in role can open it — `entry_exit_logs` RLS decides which
 * movement rows come back, so a foreman only ever sees his own site visits
 * and a workshop role only workshop visits, exactly as everywhere else; the
 * state itself comes from `get_last_movement`.
 */

interface InquiryEquipmentRow {
  id: string
  code: string
  type: string | null
  plate_number: string | null
  chassis_number: string | null
  /** Selected by the detail read only (the suggestions do not need it): the
   *  «جديدة» mark is "created within the last 7 days" (migration 0129). */
  created_at?: string | null
  ownership_status?: OwnershipStatus | null
  lessor?: { id: string; name: string | null } | null
  /** The suggestions' dot only. */
  equipment_state?: string | null
}

interface MovementLogTimelineRow {
  id: string
  movement_type: 'entry' | 'exit'
  movement_context: 'site' | 'workshop'
  workshop_purpose: 'maintenance' | 'parking' | 'out_of_service' | null
  recorded_at: string
  company_name_ar: string | null
  company_name_en: string | null
  project_name_ar: string | null
  project_name_en: string | null
  supervisor_name: string | null
  driver_name: string | null
  /** The driver record's current name (appended by migration 0124). */
  driver_full_name?: string | null
  /** A site exit's purpose (appended to the view by migration 0118). */
  exit_purpose?: string | null
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
// One calendar year of one unit: a bound, not a page (a unit moves a few
// times a month).
const YEAR_MOVEMENTS_LIMIT = 1000

const TIMELINE_SELECT =
  'id,movement_type,movement_context,workshop_purpose,recorded_at,company_name_ar,company_name_en,project_name_ar,project_name_en,supervisor_name,driver_name,exit_purpose,driver_full_name'

/** The reader's recent units, in this browser only (a convenience). */
const RECENT_KEY = 'inquiry:recent'
const RECENT_LIMIT = 5
type RecentUnit = { id: string; code: string; type: string | null }

function readRecent(): RecentUnit[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is RecentUnit =>
              typeof item?.id === 'string' && typeof item?.code === 'string',
          )
          .slice(0, RECENT_LIMIT)
      : []
  } catch {
    return []
  }
}

function writeRecent(units: RecentUnit[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(units))
  } catch {
    // Private windows and blocked storage simply keep no history.
  }
}

/**
 * wave 20 (migration 0125): the one equipment state of the brief. It is read
 * through `get_last_movement` (SECURITY DEFINER), not the `equipment_state`
 * computed field, because a foreman's RLS hides other people's movements and
 * the computed field would then see only part of the chain. `error` keeps a
 * failed read visible instead of showing a state. The «جديدة» mark is not
 * part of it: it is the row's age (`isEquipmentNew`, migration 0129) and
 * sits next to the code (owner decision 2026-10-14).
 */
type InquiryState = { state: EquipmentState } | 'error' | null

function toTimelineMovement(
  row: MovementLogTimelineRow,
  lang: 'ar' | 'en',
): TimelineMovement {
  return {
    id: row.id,
    movement_context: row.movement_context,
    movement_type: row.movement_type,
    recorded_at: row.recorded_at,
    company_name: localizedName(lang, row.company_name_ar, row.company_name_en),
    project_name: localizedName(lang, row.project_name_ar, row.project_name_en),
    workshop_purpose: row.workshop_purpose,
    exit_purpose: row.exit_purpose ?? null,
    supervisor_name: row.supervisor_name,
    // wave 19: the driver record's current name, else the snapshot.
    driver_name: preferRecordName(row.driver_full_name, row.driver_name),
  }
}

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
  const permissions = usePermissions()
  const permissionsReady = permissions.status === 'ready'
  const canOpenEquipment = permissionsReady && permissions.can('equipment.read')
  const canSeePurchasing = permissionsReady && permissions.can('purchasing.view')

  const startSuggestRequest = useListRequest()
  const startDetailRequest = useListRequest()
  const startMovementsRequest = useListRequest()
  const startYearRequest = useListRequest()
  const startPoRequest = useListRequest()

  const equipmentId = parseEquipmentIdParam(searchParams.get('equipment'))

  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<EquipmentSuggestion[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [recent, setRecent] = useState<RecentUnit[]>([])
  // Fixed per answer so durations do not drift while reading it.
  const [now, setNow] = useState(() => Date.now())

  const [equipment, setEquipment] = useState<InquiryEquipmentRow | null>(null)
  const [inquiryState, setInquiryState] = useState<InquiryState>(null)
  const [codeChanges, setCodeChanges] = useState<EquipmentCodeChange[]>([])
  const [codeChangesError, setCodeChangesError] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [detailMissing, setDetailMissing] = useState(false)
  // The equipment id the detail answer (row, error or "missing") belongs to.
  const [detailLoadedId, setDetailLoadedId] = useState<string | null>(null)

  const [movements, setMovements] = useState<MovementLogTimelineRow[]>([])
  const [movementsOffset, setMovementsOffset] = useState(0)
  const [hasMoreMovements, setHasMoreMovements] = useState(false)
  const [movementsLoading, setMovementsLoading] = useState(false)
  const [movementsLoadingMore, setMovementsLoadingMore] = useState(false)
  const [movementsError, setMovementsError] = useState(false)
  // The equipment id the first movements page (or its error) belongs to.
  const [movementsLoadedId, setMovementsLoadedId] = useState<string | null>(
    null,
  )

  // The last 12 months (plus the movement just before them, for a stay
  // already open when the window starts).
  const [yearMovements, setYearMovements] = useState<MovementLogTimelineRow[]>([])
  const [yearError, setYearError] = useState(false)
  // The unit the first year read answered for (the answer waits on it) and
  // the `unit:year` the shown year belongs to (a picked year loads alone).
  const [yearLoadedId, setYearLoadedId] = useState<string | null>(null)
  const [yearLoadedFor, setYearLoadedFor] = useState<string | null>(null)
  // A calendar year (owner 2026-10-27: «المفروض بالسنة»), this year first.
  const [selectedYear, setSelectedYear] = useState(() => saudiYear(Date.now()))
  // The year of the unit's first movement, for the year picker.
  const [firstMovementYear, setFirstMovementYear] = useState<number | null>(null)

  // The stay the 12-month strip opened in the history.
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null)
  // The PO card under the facts: `undefined` hides it (no purchasing
  // access, a failed read, or the unit is not inside a project).
  const [po, setPo] = useState<InquiryPo | undefined>(undefined)

  useEffect(() => setRecent(readRecent()), [])

  // The recent units' current states, for their dots: one bounded read
  // whenever the start shows (a failed read only drops the dots).
  const [recentStates, setRecentStates] = useState<Map<string, string>>(new Map())
  const recentIds = recent.map((item) => item.id).join(',')
  useEffect(() => {
    if (equipmentId || !recentIds) return
    let active = true
    void supabase
      .from('equipment')
      .select('id,equipment_state')
      .in('id', recentIds.split(','))
      .then(({ data, error }) => {
        if (!active || error) return
        setRecentStates(
          new Map(
            ((data as { id: string; equipment_state: string | null }[] | null) ?? [])
              .filter((row) => row.equipment_state)
              .map((row) => [row.id, row.equipment_state as string]),
          ),
        )
      })
    return () => {
      active = false
    }
  }, [equipmentId, recentIds])

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
      // A previous code (EM-196) still finds the same unit: the ids whose
      // old code matches join the existing filter as one more `or` part.
      const term = toLatinDigits(sanitizeSearchTerm(query))
      const previous = await fetchPreviousCodeMatchIds(supabase, term, signal)
      if (!active || signal.aborted) return
      const previousPart = previousCodeOrPart(previous.ids)
      // `equipment_state` (computed field, SECURITY INVOKER) colours the
      // dot beside each code (owner 2026-10-27, «اضفها»): from the
      // movements this reader may see, as on the equipment list.
      const { data, error } = await supabase
        .from('equipment')
        .select('id,code,type,plate_number,chassis_number,equipment_state')
        .or(previousPart ? `${filter},${previousPart}` : filter)
        .order('code')
        .limit(SUGGEST_LIMIT)
        .abortSignal(signal)
      if (!active || signal.aborted) return
      const rows = (data as InquiryEquipmentRow[] | null) ?? []
      const previousIds = new Set(previous.ids)
      // A failed previous-code lookup only drops the «رقم سابق» matches; the
      // current-code matches still show (a load failure is never shown as
      // "no results" when there are rows to show).
      setSuggestions(
        error
          ? []
          : rows.map((row) => ({
              id: row.id,
              code: row.code,
              type_name: row.type,
              plate_number: row.plate_number,
              chassis_number: row.chassis_number,
              matched_previous_code:
                previousIds.has(row.id) && !codeMatchesTerm(row.code, term),
              equipment_state: row.equipment_state ?? null,
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
      // Identity, `created_at` for the «جديدة» mark (migration 0129) and the
      // owner with its supplier for the facts; the state comes from
      // `get_last_movement`, the rest from the movements.
      const [equipmentResult, codeChangesResult, lastMovementResult] =
        await Promise.all([
          supabase
            .from('equipment')
            .select(
              'id,code,type,plate_number,chassis_number,created_at,ownership_status,lessor:lessors(id,name)',
            )
            .eq('id', id)
            .abortSignal(signal)
            .maybeSingle(),
          // Previous codes (EM-196) for the facts.
          supabase
            .from('equipment_code_changes')
            .select(EQUIPMENT_CODE_CHANGE_SELECT)
            .eq('equipment_id', id)
            .order('changed_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(EQUIPMENT_CODE_CHANGES_LIMIT)
            .abortSignal(signal),
          // wave 20: the latest movement across both contexts, for the state.
          supabase
            .rpc('get_last_movement', {
              p_equipment_id: id,
              p_movement_context: 'site',
            })
            .abortSignal(signal),
        ])
      if (signal.aborted) return
      setDetailLoadedId(id)
      const row = equipmentResult.data as InquiryEquipmentRow | null
      if (lastMovementResult.error) setInquiryState('error')
      else {
        const latest =
          (
            lastMovementResult.data as Array<{
              movement_type: string | null
              movement_context: string | null
              workshop_purpose: string | null
            }> | null
          )?.[0] ?? null
        // Migration 0129: «جديدة» is the row's age, not "no movement"; the
        // header derives it from `created_at` next to the code.
        setInquiryState({ state: equipmentStateFromMovement(latest) })
      }
      setCodeChangesError(Boolean(codeChangesResult.error))
      setCodeChanges(
        (codeChangesResult.data as EquipmentCodeChange[] | null) ?? [],
      )
      if (equipmentResult.error) {
        setDetailError(true)
        setEquipment(null)
        setDetailLoading(false)
        return
      }
      if (!row) {
        setDetailMissing(true)
        setEquipment(null)
        setDetailLoading(false)
        return
      }
      setEquipment(row)
      setQuery(row.code)
      setDetailLoading(false)
      const next = [
        { id: row.id, code: row.code, type: row.type },
        ...readRecent().filter((item) => item.id !== row.id),
      ].slice(0, RECENT_LIMIT)
      writeRecent(next)
      setRecent(next)
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
        .select(TIMELINE_SELECT)
        .eq('equipment_id', id)
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + MOVEMENTS_PAGE_SIZE - 1)
        .abortSignal(signal)
      if (signal.aborted) return
      if (!append) setMovementsLoadedId(id)
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

  // --- The chosen calendar year -----------------------------------------

  const fetchYear = useCallback(
    async (id: string, at: number, year: number, withFirst: boolean) => {
      const signal = startYearRequest()
      const range = inquiryYearRange(year, at)
      const start = new Date(range.startMs).toISOString()
      const end = new Date(range.endMs).toISOString()
      const [inside, before, first] = await Promise.all([
        supabase
          .from('movement_log_search')
          .select(TIMELINE_SELECT)
          .eq('equipment_id', id)
          .gte('recorded_at', start)
          .lt('recorded_at', end)
          .order('recorded_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(YEAR_MOVEMENTS_LIMIT)
          .abortSignal(signal),
        // The movement just before the window: an entry still open then.
        supabase
          .from('movement_log_search')
          .select(TIMELINE_SELECT)
          .eq('equipment_id', id)
          .lt('recorded_at', start)
          .order('recorded_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .abortSignal(signal),
        // The unit's first movement, once per unit, for the year picker.
        withFirst
          ? supabase
              .from('movement_log_search')
              .select('recorded_at')
              .eq('equipment_id', id)
              .order('recorded_at', { ascending: true })
              .order('id', { ascending: true })
              .limit(1)
              .abortSignal(signal)
          : null,
      ])
      if (signal.aborted) return
      setYearLoadedId(id)
      setYearLoadedFor(`${id}:${year}`)
      if (first) {
        const firstAt = (first.data as { recorded_at: string }[] | null)?.[0]?.recorded_at
        setFirstMovementYear(firstAt && !first.error ? saudiYear(Date.parse(firstAt)) : null)
      }
      if (inside.error || before.error) {
        setYearError(true)
        setYearMovements([])
        return
      }
      setYearError(false)
      setYearMovements([
        ...((before.data as MovementLogTimelineRow[] | null) ?? []),
        ...((inside.data as MovementLogTimelineRow[] | null) ?? []),
      ])
    },
    [startYearRequest],
  )

  // --- The PO of the open project visit (purchasing readers only) -------

  useEffect(() => {
    setPo(undefined)
    if (!equipmentId || !canSeePurchasing) return
    let active = true
    const signal = startPoRequest()
    void supabase
      .from('purchasing_site_units')
      .select('supplier_po_id,po_number')
      .eq('equipment_id', equipmentId)
      .limit(1)
      .abortSignal(signal)
      .then(({ data, error }) => {
        if (!active || signal.aborted || error) return
        // No row: the unit is not inside a project, so no card.
        const row = (
          data as { supplier_po_id: string | null; po_number: string | null }[] | null
        )?.[0]
        if (!row) return
        setPo(
          row.supplier_po_id && row.po_number
            ? { id: row.supplier_po_id, number: row.po_number }
            : null,
        )
      })
    return () => {
      active = false
    }
  }, [canSeePurchasing, equipmentId, startPoRequest])

  useEffect(() => {
    if (!equipmentId) {
      setEquipment(null)
      setInquiryState(null)
      setMovements([])
      setMovementsOffset(0)
      setHasMoreMovements(false)
      setDetailError(false)
      setDetailMissing(false)
      setYearMovements([])
      setYearError(false)
      // Picking the same equipment again must start pending, not blank.
      setDetailLoadedId(null)
      setMovementsLoadedId(null)
      setYearLoadedId(null)
      setYearLoadedFor(null)
      setFirstMovementYear(null)
      return
    }
    const at = Date.now()
    const thisYear = saudiYear(at)
    setNow(at)
    setSelectedYear(thisYear)
    void fetchDetail(equipmentId)
    setMovements([])
    setMovementsOffset(0)
    setHasMoreMovements(false)
    void fetchMovements(equipmentId, 0, false)
    void fetchYear(equipmentId, at, thisYear, true)
    // fetchDetail/fetchMovements/fetchYear are stable (their own deps never
    // change across the component's life), so equipmentId alone drives this
    // reload.
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

  const retryYear = useCallback(() => {
    if (equipmentId) void fetchYear(equipmentId, now, selectedYear, false)
  }, [equipmentId, fetchYear, now, selectedYear])

  const pickYear = useCallback(
    (year: number) => {
      setSelectedYear(year)
      if (equipmentId) void fetchYear(equipmentId, now, year, false)
    },
    [equipmentId, fetchYear, now],
  )

  const clearSelection = useCallback(() => {
    setEquipmentParam(null)
    setQuery('')
    setSuggestions([])
  }, [setEquipmentParam])

  const selectVisit = useCallback((key: string) => {
    setHighlightedKey(key)
    window.requestAnimationFrame(() =>
      document
        .getElementById(inquiryVisitAnchor(key))
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    )
  }, [])

  const pickSuggestion = useCallback(
    (suggestion: EquipmentSuggestion) => {
      setQuery(suggestion.code)
      setEquipmentParam(suggestion.id)
    },
    [setEquipmentParam],
  )

  // Derived, not raised by an effect: the very first render for a new
  // `equipmentId` is already pending, so there is no blank frame and no
  // second placeholder. Every read must have answered for THIS id; a failed
  // or missing equipment is reported without waiting for the movements.
  const detailPending =
    Boolean(equipmentId) && (detailLoading || detailLoadedId !== equipmentId)
  const resultPending =
    detailPending ||
    (Boolean(equipmentId) &&
      !detailError &&
      !detailMissing &&
      (movementsLoadedId !== equipmentId || yearLoadedId !== equipmentId))

  const visits = useMemo(
    () => buildEquipmentVisits(movements.map((row) => toTimelineMovement(row, lang))),
    [movements, lang],
  )
  const createdAt = equipment?.created_at ? Date.parse(equipment.created_at) : Number.NaN
  const year = useMemo(() => {
    const yearVisits = buildEquipmentVisits(
      yearMovements.map((row) => toTimelineMovement(row, lang)),
    )
    const days = inquiryYearDays(yearVisits, createdAt, now, selectedYear)
    return { days, months: inquiryYearMonths(days), summary: summarizeInquiryYear(days) }
  }, [yearMovements, lang, createdAt, now, selectedYear])
  // From this year back to the unit's first year: its first movement or its
  // creation, the earlier.
  const createdYear = Number.isFinite(createdAt) ? saudiYear(createdAt) : null
  const yearChoices = inquiryYearChoices(
    firstMovementYear !== null && createdYear !== null
      ? Math.min(firstMovementYear, createdYear)
      : (firstMovementYear ?? createdYear),
    now,
  )
  const yearLoading = Boolean(equipmentId) && yearLoadedFor !== `${equipmentId}:${selectedYear}`

  const hero = !equipmentId
  const state = inquiryState && inquiryState !== 'error' ? inquiryState.state : null
  const supplierName =
    equipment?.ownership_status === 'external_supplier' ? equipment.lessor?.name : null

  const facts: InfoGridItem[] = equipment
    ? [
        // An external supplier's unit names the supplier in place of «مالك
        // اخر» (owner 2026-10-26: «اذا كان مالك اخر مايحتاج تحط مالك اخر،
        // حط المورد مباشرة»); without a supplier the owner stays.
        supplierName
          ? {
              key: 'supplier',
              icon: <Building2 size={15} aria-hidden="true" />,
              label: t('inquirySupplier'),
              value: supplierName,
            }
          : {
              key: 'owner',
              icon: <Tag size={15} aria-hidden="true" />,
              label: t('ownershipStatus'),
              value: equipment.ownership_status
                ? t(ownershipBadge(equipment.ownership_status).key)
                : null,
            },
        {
          key: 'plate',
          icon: <Hash size={15} aria-hidden="true" />,
          label: t('plateNumber'),
          value: equipment.plate_number ? (
            <InquiryPlate plate={equipment.plate_number} chassis={null} />
          ) : null,
        },
        {
          key: 'chassis',
          icon: <Hash size={15} aria-hidden="true" />,
          label: t('chassisNumber'),
          value: equipment.chassis_number,
          dir: 'ltr',
        },
        {
          key: 'created',
          icon: <Calendar size={15} aria-hidden="true" />,
          label: t('inquiryCreatedAt'),
          value: equipment.created_at ? formatDate(equipment.created_at) : null,
          dir: 'ltr',
        },
      ]
    : []

  return (
    <div className="inquiry-page-bg min-h-[70vh] rounded-3xl bg-surface px-3 py-6 sm:px-6">
      {/* The page's name: for screen readers while the start's question
          shows, above the field once the answer is below it (owner
          2026-10-27: «اضف عنوان الصفحة فوق حقل البحث لما تكون النتائج في
          الاسفل»). */}
      <h1
        className={cn(
          hero ? 'sr-only' : 'inq-rise mb-3 text-center mt-6 text-xl font-bold sm:mt-10 sm:text-2xl',
        )}
        style={hero ? undefined : { fontFamily: 'var(--font-heading)' }}
      >
        {t('inquiryPageTitle')}
      </h1>
      {/* The page's start (owner 2026-10-26: «نفس واجهات الAI الرئيسية الي
          يكون الحقل في النص، وفيه وصف بسيط»): the space above the field and
          the question fold away when a unit is shown. */}
      <div
        aria-hidden="true"
        style={{
          height: hero ? 'clamp(40px, 14vh, 140px)' : 0,
          transition: 'height 600ms cubic-bezier(.2,.8,.2,1)',
        }}
      />
      <div
        className="grid transition-[grid-template-rows,opacity] duration-500"
        style={{ gridTemplateRows: hero ? '1fr' : '0fr', opacity: hero ? 1 : 0 }}
        aria-hidden={!hero}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 pb-6 text-center">
            <h2
              className="text-2xl font-bold sm:text-3xl"
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              {t('inquiryHeroTitle')}
            </h2>
            <p className="text-sm text-muted">{t('inquiryHeroDescription')}</p>
          </div>
        </div>
      </div>

      <div
        className="mx-auto transition-[max-width] duration-500"
        style={{ maxWidth: hero ? 640 : 520 }}
      >
        <InquirySearch
          query={query}
          onQueryChange={setQuery}
          suggestions={suggestions}
          loading={suggestLoading}
          onPick={pickSuggestion}
          big={hero}
        />
      </div>

      {hero && recent.length > 0 && (
        <div
          className="inq-rise mx-auto mt-5 max-w-2xl space-y-2 text-center"
          style={inquiryRise(2)}
        >
          <p className="text-xs text-muted">{t('inquiryRecent')}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {recent.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setQuery(item.code)
                  setEquipmentParam(item.id)
                }}
                className="inline-flex items-center gap-2 rounded-full bg-bg px-3 py-1.5 text-sm shadow-sm transition-transform hover:-translate-y-0.5"
              >
                <InquiryStateDot
                  state={recentStates.get(item.id)}
                  label={(() => {
                    const parsed = parseEquipmentState(recentStates.get(item.id))
                    return parsed ? equipmentStateText(t, parsed) : null
                  })()}
                />
                <bdi dir="ltr" className="font-semibold">
                  {item.code}
                </bdi>
                {item.type && <span className="text-xs text-muted">{item.type}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {equipmentId && (
        <div className="mx-auto mt-6 max-w-6xl space-y-4">
          {resultPending ? (
            <InquiryThinking code={query} />
          ) : detailError ? (
            <div className={cn(INQUIRY_SURFACE, 'p-4')}>
              <ErrorState onRetry={retryDetail} />
            </div>
          ) : detailMissing ? (
            <div className={cn(INQUIRY_SURFACE, 'p-4')}>
              <EmptyState
                title={t('inquiryEquipmentNotFound')}
                action={
                  <Button size="sm" variant="outline" onClick={clearSelection}>
                    {t('inquiryChangeEquipment')}
                  </Button>
                }
              />
            </div>
          ) : equipment ? (
            <>
              <section
                className={cn(INQUIRY_SURFACE, 'inq-rise space-y-4 p-4')}
                style={inquiryRise(0)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="inline-flex items-center gap-2 text-2xl font-bold leading-none">
                        <LtrValue>{equipment.code}</LtrValue>
                        <EquipmentNewBadge isNew={isEquipmentNew(equipment.created_at)} />
                      </h2>
                      {inquiryState === 'error' ? (
                        <span className="text-sm text-danger">{t('dataLoadError')}</span>
                      ) : (
                        <EquipmentStateBadge state={state} />
                      )}
                    </div>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
                      <span className="font-medium text-fg">{equipment.type || '—'}</span>
                      <span aria-hidden="true">·</span>
                      <InquiryPlate
                        plate={equipment.plate_number}
                        chassis={equipment.chassis_number}
                      />
                    </p>
                    {/* An external supplier's unit names its supplier (owner
                        2026-10-26: «اضف اسم المورد لو لمورد خارجي»). */}
                    {supplierName && (
                      <p className="mt-1 flex items-center gap-1.5 text-sm">
                        <Building2 size={14} aria-hidden="true" className="text-muted" />
                        <span className="text-muted">{t('inquirySupplier')}</span>
                        <span className="font-semibold">{supplierName}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canOpenEquipment && (
                      <Button asChild size="sm" variant="outline">
                        <AppLink href={`/equipment/${equipment.id}`}>
                          <ExternalLink size={14} aria-hidden="true" />
                          {t('inquiryEquipmentPage')}
                        </AppLink>
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={clearSelection}>
                      {t('inquiryAnotherUnit')}
                    </Button>
                  </div>
                </div>
                <InquiryNow visits={visits} state={state} now={now} />
              </section>

              {visits.length > 0 && (
                <>
                  {/* The calendar year (owner 2026-10-27: «المفروض بالسنة»,
                      «طبقه»): this year from 1 January, any earlier year of
                      the unit by the picker. */}
                  <div
                    className="inq-rise flex flex-wrap items-center justify-between gap-2 px-1 pt-2"
                    style={inquiryRise(1)}
                  >
                    <h3 className="text-base font-semibold">
                      {t('inquiryActivityIn').replace('{year}', String(selectedYear))}
                    </h3>
                    {yearChoices.length > 1 && (
                      <div className="-mx-1 max-w-full overflow-x-auto px-1">
                        <Tabs
                          value={String(selectedYear)}
                          onValueChange={(value) => pickYear(Number(value))}
                        >
                          <TabsList variant="segmented" aria-label={t('inquiryYearPicker')}>
                            {yearChoices.map((choice) => (
                              <TabsTrigger key={choice} value={String(choice)}>
                                <span className="tabular-nums">{choice}</span>
                              </TabsTrigger>
                            ))}
                          </TabsList>
                        </Tabs>
                      </div>
                    )}
                  </div>
                  {yearError ? (
                    <div className={cn(INQUIRY_SURFACE, 'p-4')}>
                      <ErrorState description={t('inquiryYearLoadError')} onRetry={retryYear} />
                    </div>
                  ) : yearLoading ? (
                    <div className="space-y-4" aria-busy="true">
                      <span className="sr-only" role="status">
                        {t('inquiryYearLoadingLabel')}
                      </span>
                      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {[0, 1, 2, 3].map((index) => (
                          <Skeleton key={index} className="h-24 w-full rounded-2xl" />
                        ))}
                      </div>
                      <Skeleton className="h-36 w-full rounded-2xl" />
                    </div>
                  ) : (
                    <div key={selectedYear} className="space-y-4">
                      <InquiryYearNumbers
                        summary={year.summary}
                        year={selectedYear}
                        index={2}
                      />
                      {/* The strip (owner 2026-10-27: «غير اخر 12 شهر
                          لشريط»); `InquiryYearRings` stays in InquiryYear. */}
                      <InquiryYearStrip
                        days={year.days}
                        months={year.months}
                        index={6}
                        onSelectVisit={selectVisit}
                      />
                    </div>
                  )}
                </>
              )}

              {/* Below xl: the facts, the location, the journey. From xl the
                  journey spans two columns beside them; the facts sit above
                  the location (owner: «جدول بيانات المعدة فوق الموقع
                  الحالي»). */}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="space-y-4 xl:col-start-3 xl:row-start-1">
                  <section
                    className={cn(INQUIRY_SURFACE, 'inq-rise space-y-2 p-4')}
                    style={inquiryRise(6)}
                  >
                    <InquiryCardTitle icon={<Tag size={14} />}>{t('inquiryFacts')}</InquiryCardTitle>
                    {/* One pair under the other at every width (owner
                        2026-10-26: «بيانات المعدة خليها فوق بعض»). */}
                    <InfoGrid items={facts} columns={1} />
                    <PreviousCodesLine
                      changes={codeChanges}
                      currentCode={equipment.code}
                      error={codeChangesError}
                    />
                  </section>
                  {/* The PO in a small card of its own under the facts
                      (owner 2026-10-27: «خليه في كرت مصغر يسار تحت بيانات
                      المعدة»). */}
                  {po !== undefined && <InquiryPoCard po={po} index={7} />}
                  {/* wave 17: admin only (the card renders nothing for any
                      other role and never requests the position then). */}
                  <EquipmentLocationCard
                    equipmentId={equipment.id}
                    equipmentCode={equipment.code}
                    className={cn(INQUIRY_SURFACE, 'border-0 p-4')}
                  />
                </div>
                <div className="xl:col-span-2 xl:col-start-1 xl:row-start-1">
                  {movementsError ? (
                    <div className={cn(INQUIRY_SURFACE, 'p-4')}>
                      <ErrorState onRetry={retryMovements} />
                    </div>
                  ) : movementsLoading ? (
                    // Only a retry after a failed movements read gets here;
                    // the first load is covered by «نبحث عن» above.
                    <Skeleton className="h-60 w-full rounded-2xl" />
                  ) : (
                    <InquiryJourney
                      visits={visits}
                      now={now}
                      index={7}
                      highlightedKey={highlightedKey}
                      onSelectMovement={selectMovement}
                      footer={
                        hasMoreMovements && (
                          <div className="mt-4 flex justify-center">
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
                        )
                      }
                    />
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
