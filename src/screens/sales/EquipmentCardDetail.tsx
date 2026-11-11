import { useCallback, useEffect, useState } from 'react'
import {
  ArrowUpRight,
  BadgeCheck,
  Building2,
  Calendar,
  Check,
  Clock,
  Coins,
  CreditCard,
  Edit2,
  Eye,
  FileText,
  Hourglass,
  Lock,
  LogIn,
  LogOut,
  Percent,
  Plus,
  Receipt,
  RotateCcw,
  Timer,
  Truck,
  User,
} from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { useListRequest } from '@/components/data-list/useListRequest'
import { EquipmentIdentifierTag } from '@/components/data-list/EquipmentIdentifierTag'
import { fetchProfileNames } from '@/components/details/profileNames'
import {
  CardMonthDueCell,
  CardMonthStateBadge,
  HoursFigure,
} from '@/components/sales/CardMonthCells'
import {
  CardMarginCell,
  CardPricingStatusBadge,
  CardSupplierPriceCell,
} from '@/components/sales/CardPricingCells'
import {
  ApproveCardPricingDialog,
  ReturnCardPricingDialog,
  type CardPricingTarget,
} from '@/components/sales/CardPricingDialogs'
import {
  EventTimeline,
  compareTimelineItems,
  useClientPoTimelineItems,
  type TimelineItem,
} from '@/components/sales/EventTimeline'
import { PoPill } from '@/components/sales/PoPill'
import { QuantityCell } from '@/components/sales/QuantityCell'
import {
  RecordCardMonthDialog,
  type RecordCardMonthEditing,
} from '@/components/sales/RecordCardMonthDialog'
import { SaleAmountOrDash } from '@/components/sales/SalePrice'
import {
  AppLink,
  PageTrailBar,
  Badge,
  Button,
  Card,
  DataTable,
  DescriptionList,
  DetailHeader,
  EmptyState,
  ErrorState,
  IconButton,
  Notice,
  SectionHeader,
  Skeleton,
  StatCard,
  ToastProvider,
  Tooltip,
  useToast,
  type DataTableColumn,
  type DescriptionListItem,
} from '@/components/ui'
import { InfoGridSkeleton } from '@/components/ui/InfoGrid'
import { useI18n } from '@/i18n/I18nContext'
import { useTabTitle } from '@/components/TabTitle'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import { displayDriverName } from '@/lib/driverDisplayName'
import { localizedName } from '@/lib/localizedName'
import {
  SUPPLIER_PO_EVENTS_LIMIT,
  formatSupplierPoPrice,
  supplierPoEventLabel,
} from '@/lib/purchasing'
import {
  SUPPLIER_PO_EVENT_SELECT,
  supplierPoEventDetail,
  type SupplierPoEventRow,
} from '@/lib/purchasingData'
import {
  CLIENT_PO_EVENTS_LIMIT,
  EQUIPMENT_CARD_EVENT_LABEL_KEYS,
  SALE_PER_UNIT_KEYS,
  SALE_RATE_UNIT_LABEL_KEYS,
  cardMargin,
  cardMarginPct,
  cardMonthState,
  cardPricingApprovalBlocker,
  cardPricingStatusOf,
  contractHours,
  currentSaudiMonthKey,
  equipmentCardEventDetail,
  formatDaysText,
  formatHours,
  isDaysRateUnit,
  monthKeyOf,
  monthLabel,
  monthShortLabel,
  recordedHoursTotal,
  saleRateUnitOf,
  storedCardMonthFigures,
  type CardMonthDue,
  type CardMonthSides,
  type CardMonthState,
  type MonthKey,
} from '@/lib/sales'
import {
  CARD_MONTHS_LIMIT,
  CARD_MONTHS_SELECT,
  CARD_PENDING_SLOTS_SELECT,
  CARD_VISIT_SELECT,
  CLIENT_PO_EVENT_SELECT,
  EQUIPMENT_CARD_EVENT_SELECT,
  EQUIPMENT_CARDS_SELECT,
  type CardMonthRecordRow,
  type CardPendingSlotRow,
  type CardVisitRow,
  type ClientPoEventRow,
  type EquipmentCardEventRow,
  type SalesEquipmentCardRow,
} from '@/lib/salesData'
import { supabase } from '@/lib/supabase'

export interface EquipmentCardDetailProps {
  cardId: string
  onBack: () => void
  onOpenEquipment?: (equipmentId: string) => void
  onOpenMovement?: (movementId: string) => void
  onOpenClientPo?: (poId: string) => void
  onOpenSupplierPo?: (poId: string) => void
}

/**
 * Owner 2026-11-04 (card pricing, migration 0174): the «الشهور» section of
 * phase 2 («كروت التشغيل»), its «تسجيل شهر» button and its reads are hidden
 * for now, like the other sales pages; the code stays for when they come
 * back. While hidden, the summary strip shows the card's pricing instead.
 */
export const SHOW_CARD_MONTHS = false

function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <Skeleton className="h-7 w-40" />
      <div className="card space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-[26px] w-16 rounded-full" />
        </div>
        <Skeleton variant="text" className="w-56" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-[72px] w-full rounded-xl" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="card space-y-3 p-4">
            <Skeleton variant="text" className="w-24" />
            <InfoGridSkeleton count={4} columns={2} withIcon />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The events of a PO that concern this card: the PO's own events plus the
 *  line events naming this unit or this line. */
function concernsCard(
  payload: Record<string, unknown> | null,
  eventType: string,
  card: Pick<SalesEquipmentCardRow, 'equipment_id' | 'card_id'>,
  lineId: string | null,
): boolean {
  const p = payload ?? {}
  if (p.equipment_id === card.equipment_id) return true
  if (p.equipment_card_id === card.card_id) return true
  if (lineId && p.line_id === lineId) return true
  return (
    !('equipment_id' in p) &&
    !('line_id' in p) &&
    eventType !== 'equipment_removed'
  )
}

/** One row of the «الشهور» table: a recorded month, or an awaited one. */
interface CardMonthRow {
  month: MonthKey
  state: CardMonthState
  record: CardMonthRecordRow | null
  /** 0185: the unit's presence days in an awaited month. */
  presence_days?: number | null
}

/**
 * «صفحة كرت المعدة» (/sales/cards/:id, migration 0169, the /ui-kit mockup
 * the owner approved on 2026-11-02, phase 1; phase 2 «كروت التشغيل»,
 * migration 0172, approved 2026-11-04): the header (the unit with its plate
 * and type, «الشركة · المشروع», the days of its visit and whether the unit
 * is still inside), the summary strip
 * with the LATEST RECORDED month's figures, the three cards الحركة /
 * المبيعات / المشتريات with real data, the «الشهور» table (the recorded
 * months of `sales_card_months` with their amounts and the awaited months
 * of `sales_card_month_slots`, newest first, under the consumed hours
 * against the contract total), «تسجيل شهر» / edit / delete for
 * `sales.manage` through `RecordCardMonthDialog`, and the timeline from
 * both PO event tables plus the card's own events. The card's client price
 * shows its own unit (0185). Since migration 0189 (owner 2026-11-11, «وحتى
 * المعدة نشيل منها البداية والنهاية ومفتوح») a card has NO period and is
 * neither open nor ended: «انهاء الكرت» / «اعادة فتح الكرت» (0185) are gone
 * (their past events stay on the timeline) and the dates shown are the
 * visit's, from the movements. Reads through RLS: `sales.view` or
 * `purchasing.view` for the card, each side's own key (the other side is
 * simply NULL without it).
 */
export function EquipmentCardDetail(props: EquipmentCardDetailProps) {
  return (
    <ToastProvider>
      <CardDetail {...props} />
    </ToastProvider>
  )
}

function CardDetail({
  cardId,
  onBack,
  onOpenEquipment,
  onOpenMovement,
  onOpenClientPo,
  onOpenSupplierPo,
}: EquipmentCardDetailProps) {
  const { t, lang } = useI18n()
  const { can } = usePermissions()
  const canManage = can('sales.manage')
  const canApprove = can('sales.approve')
  const toast = useToast()
  const [card, setCard] = useState<SalesEquipmentCardRow | null>(null)
  const [pricingDialog, setPricingDialog] = useState<
    'approve' | 'return' | null
  >(null)
  useTabTitle(card?.equipment_code)
  const [visit, setVisit] = useState<CardVisitRow | null>(null)
  const [clientEvents, setClientEvents] = useState<ClientPoEventRow[]>([])
  const [supplierEvents, setSupplierEvents] = useState<SupplierPoEventRow[]>([])
  const [cardEvents, setCardEvents] = useState<EquipmentCardEventRow[]>([])
  const [months, setMonths] = useState<CardMonthRecordRow[]>([])
  const [pendingSlots, setPendingSlots] = useState<CardPendingSlotRow[]>([])
  const [actorNames, setActorNames] = useState<ReadonlyMap<string, string>>(
    new Map(),
  )
  const [loading, setLoading] = useState(true)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [dialog, setDialog] = useState<{
    editing: RecordCardMonthEditing | null
    initialMonth: MonthKey | null
  } | null>(null)
  const startRequest = useListRequest()

  const fetchData = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    const signal = startRequest()
    const cardResult = await supabase
      .from('sales_equipment_cards')
      .select(EQUIPMENT_CARDS_SELECT)
      .eq('card_id', cardId)
      .abortSignal(signal)
      .maybeSingle()
    if (signal.aborted) return
    const row = cardResult.data as unknown as SalesEquipmentCardRow | null
    let failed = Boolean(cardResult.error)
    let visitRow: CardVisitRow | null = null
    let clientRows: ClientPoEventRow[] = []
    let supplierRows: SupplierPoEventRow[] = []
    let monthRows: CardMonthRecordRow[] = []
    let pendingRows: CardPendingSlotRow[] = []
    let cardEventRows: EquipmentCardEventRow[] = []
    if (row) {
      const [
        visitResult,
        clientResult,
        supplierResult,
        monthsResult,
        pendingResult,
        cardEventsResult,
      ] = await Promise.all([
        row.entry_log_id
          ? supabase
              .from('movement_visits')
              .select(CARD_VISIT_SELECT)
              .eq('entry_id', row.entry_log_id)
              .abortSignal(signal)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        row.client_po_id
          ? supabase
              .from('client_po_events')
              .select(CLIENT_PO_EVENT_SELECT)
              .eq('client_po_id', row.client_po_id)
              .order('created_at', { ascending: false })
              .order('seq', { ascending: false })
              .limit(CLIENT_PO_EVENTS_LIMIT * 3)
              .abortSignal(signal)
          : Promise.resolve({ data: null, error: null }),
        row.supplier_po_id
          ? supabase
              .from('supplier_po_events')
              .select(SUPPLIER_PO_EVENT_SELECT)
              .eq('supplier_po_id', row.supplier_po_id)
              .order('created_at', { ascending: false })
              .order('seq', { ascending: false })
              .limit(SUPPLIER_PO_EVENTS_LIMIT * 3)
              .abortSignal(signal)
          : Promise.resolve({ data: null, error: null }),
        // Phase 2: the recorded months (newest first), the awaited months
        // of the card's period and the card's own events. The two month
        // reads are skipped while the section is hidden (SHOW_CARD_MONTHS).
        SHOW_CARD_MONTHS
          ? supabase
              .from('sales_card_months')
              .select(CARD_MONTHS_SELECT)
              .eq('card_id', cardId)
              .order('month', { ascending: false })
              .limit(CARD_MONTHS_LIMIT)
              .abortSignal(signal)
          : Promise.resolve({ data: null, error: null }),
        SHOW_CARD_MONTHS
          ? supabase
              .from('sales_card_month_slots')
              .select(CARD_PENDING_SLOTS_SELECT)
              .eq('card_id', cardId)
              .eq('recorded', false)
              .order('month', { ascending: false })
              .limit(CARD_MONTHS_LIMIT)
              .abortSignal(signal)
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('equipment_card_events')
          .select(EQUIPMENT_CARD_EVENT_SELECT)
          .eq('equipment_card_id', cardId)
          .order('created_at', { ascending: false })
          .order('seq', { ascending: false })
          .limit(CLIENT_PO_EVENTS_LIMIT * 3)
          .abortSignal(signal),
      ])
      if (signal.aborted) return
      failed =
        failed ||
        Boolean(
          visitResult.error ||
          clientResult.error ||
          supplierResult.error ||
          monthsResult.error ||
          pendingResult.error ||
          cardEventsResult.error,
        )
      visitRow = (visitResult.data as unknown as CardVisitRow | null) ?? null
      clientRows =
        (clientResult.data as unknown as ClientPoEventRow[] | null) ?? []
      supplierRows =
        (supplierResult.data as unknown as SupplierPoEventRow[] | null) ?? []
      monthRows =
        (monthsResult.data as unknown as CardMonthRecordRow[] | null) ?? []
      pendingRows =
        (pendingResult.data as unknown as CardPendingSlotRow[] | null) ?? []
      cardEventRows =
        (cardEventsResult.data as unknown as EquipmentCardEventRow[] | null) ??
        []
    }
    // The supplier events carry no actor name: looked up like the PO page.
    const names = await fetchProfileNames(
      supabase,
      supplierRows.map((event) => event.actor_id),
      signal,
    )
    if (signal.aborted) return
    setLoadError(failed || names.failed)
    setCard(row)
    setVisit(visitRow)
    setClientEvents(clientRows)
    setSupplierEvents(supplierRows)
    setMonths(monthRows)
    setPendingSlots(pendingRows)
    setCardEvents(cardEventRows)
    setActorNames(names.names)
    setLoadedId(cardId)
    setLoading(false)
  }, [cardId, startRequest])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const ownClientEvents = card
    ? clientEvents.filter((event) =>
        concernsCard(
          event.payload,
          event.event_type,
          card,
          card.client_line_id,
        ),
      )
    : []
  const clientItems = useClientPoTimelineItems(
    ownClientEvents,
    () => card?.equipment_code ?? null,
    `${t('clientPo')} · `,
  )

  if (loading && (loadedId !== cardId || !card))
    return <PageSkeleton label={t('loading')} />
  if (!card)
    return (
      <div className="space-y-4">
        <PageTrailBar
          onBack={onBack}
          fallbackLabel={t('equipmentCardBackToList')}
        />
        {loadError ? (
          <ErrorState
            description={t('equipmentCardLoadError')}
            onRetry={fetchData}
          />
        ) : (
          <EmptyState
            icon={<CreditCard size={28} aria-hidden="true" />}
            title={t('equipmentCardNotFound')}
          />
        )}
      </div>
    )

  const owned = card.equipment_ownership_status === 'alazani'
  const companyName = localizedName(
    lang,
    card.company_name_ar,
    card.company_name_en,
  )
  const projectName = localizedName(
    lang,
    card.project_name_ar,
    card.project_name_en,
  )
  // 0189: the card has no period; the header shows its VISIT — the entry
  // day and, once the unit left, the exit day (from the movement read; a
  // reader without the movement rights sees neither).
  const visitLabel = card.entry_at
    ? visit?.exit_at
      ? `${formatDate(card.entry_at)} – ${formatDate(visit.exit_at)}`
      : formatDate(card.entry_at)
    : null

  const supplierItems: TimelineItem[] = supplierEvents
    .filter((event) =>
      concernsCard(
        event.payload,
        event.event_type,
        card,
        card.supplier_line_id,
      ),
    )
    .slice(0, SUPPLIER_PO_EVENTS_LIMIT)
    .map((event) => ({
      id: event.id,
      // The same label as the PO page's timeline (`renumbered` included).
      label: `${t('supplierPo')} · ${supplierPoEventLabel(event.event_type, t, lang)}`,
      detail: supplierPoEventDetail(
        event,
        () => card.equipment_code,
        (value) =>
          formatSupplierPoPrice(value as number | string | null | undefined),
        formatDate,
        // 0185: any of the four units (the purchasing labels name two).
        (unit) => t(SALE_RATE_UNIT_LABEL_KEYS[saleRateUnitOf(unit)]),
      ),
      actor: event.actor_id ? (actorNames.get(event.actor_id) ?? null) : null,
      created_at: event.created_at,
    }))
  // The card's own events (0172): the hours recorded, changed or deleted,
  // with the actor's name stored on the event.
  const cardItems: TimelineItem[] = cardEvents
    .slice(0, CLIENT_PO_EVENTS_LIMIT)
    .map((event) => ({
      id: event.id,
      label: t(
        EQUIPMENT_CARD_EVENT_LABEL_KEYS[event.event_type] ??
          'cardMonthEventUpdated',
      ),
      detail: equipmentCardEventDetail(
        event,
        lang,
        (hours) => `${formatHours(hours)} ${t('cardMonthHoursUnit')}`,
        (price) => formatSupplierPoPrice(price),
        (po) => t('cardPricingPoApprovedDetail').replace('{po}', po ?? ''),
        () => t('cardPricingPoReturnedDetail'),
        {
          perUnit: (unit) => t(SALE_PER_UNIT_KEYS[unit]),
          endedOn: (day) =>
            t('equipmentCardEndedOn').replace('{date}', formatDate(day)),
        },
      ),
      actor: event.actor_name,
      created_at: event.created_at,
      seq: event.seq,
    }))
  // All three sources on one timeline, newest first (events of one
  // transaction share created_at; seq keeps their order).
  const timeline = [...clientItems, ...supplierItems, ...cardItems].sort(
    compareTimelineItems,
  )

  // --- The months (phase 2): the recorded ones with their amounts and the
  // awaited ones, newest first; the figures of the latest recorded month.
  const currentMonth = currentSaudiMonthKey()
  const sides: CardMonthSides = {
    client_line_id: card.client_line_id,
    client_price: card.client_price,
    client_rate_unit: card.client_rate_unit,
    supplier_line_id: card.supplier_line_id,
    supplier_price: card.supplier_price,
    supplier_rate_unit: card.supplier_rate_unit,
    owned,
    due_standard_hours: card.client_standard_hours ?? card.standard_hours,
  }
  const monthRows: CardMonthRow[] = [
    ...months.map((record) => ({
      month: monthKeyOf(record.month),
      state: 'recorded' as const,
      record,
    })),
    ...pendingSlots
      .filter(
        (slot) =>
          !months.some(
            (record) => monthKeyOf(record.month) === monthKeyOf(slot.month),
          ),
      )
      .map((slot) => ({
        month: monthKeyOf(slot.month),
        // «جاري» while the unit is still inside (0189: the visit's exit;
        // it was the card's own open state).
        state: cardMonthState(
          { ...slot, is_open: slot.exit_at === null },
          currentMonth,
        ),
        record: null,
        presence_days: slot.presence_days,
      })),
  ].sort((a, b) => b.month.localeCompare(a.month))
  const openMonths = monthRows.filter((row) => row.state !== 'recorded')
  const latest = months[0] ?? null
  const figuresOf = (record: CardMonthRecordRow) =>
    storedCardMonthFigures({
      ...sides,
      due_standard_hours: record.due_standard_hours ?? sides.due_standard_hours,
      hours: record.hours,
      days: record.days,
      client_due: record.client_due,
      supplier_due: record.supplier_due,
      margin: record.margin,
    })
  const noHours: CardMonthDue = { value: null, blocker: 'no_hours' }
  const latestFigures = latest
    ? figuresOf(latest)
    : {
        client: noHours,
        supplier: owned ? { value: null, blocker: 'owned' as const } : noHours,
        margin: noHours,
      }
  const latestHint = latest
    ? t('cardMonthLatestHint').replace(
        '{month}',
        monthLabel(monthKeyOf(latest.month), lang),
      )
    : t('cardMonthNoneRecorded')
  const standardHours = latest?.due_standard_hours ?? sides.due_standard_hours
  // The contract ceiling in hours (owner 2026-11-04) against the recorded
  // months: null without a client line, a quantity or a rule (daily).
  const totalHours = card.client_line_id
    ? contractHours({
        quantity: card.client_quantity,
        rate_unit: card.client_rate_unit,
        standard_hours: card.client_standard_hours ?? card.standard_hours,
      })
    : null
  const consumedHours = recordedHoursTotal(months)
  const remainingHours =
    totalHours === null ? null : Math.max(0, totalHours - consumedHours)
  const consumedShare =
    totalHours === null || totalHours <= 0
      ? null
      : Math.min(1, consumedHours / totalHours)

  const openDialog = (row: CardMonthRow | null) =>
    setDialog({
      editing: row?.record
        ? {
            month: row.month,
            hours: row.record.hours,
            days: row.record.days,
            note: row.record.note,
          }
        : null,
      initialMonth: row && !row.record ? row.month : null,
    })
  const notify = (
    key: 'cardMonthRecorded' | 'cardMonthDeleted',
    month: MonthKey,
  ) =>
    void toast({
      title: t(key).replace('{month}', monthShortLabel(month, lang)),
      tone: 'success',
    })

  const movementFacts: DescriptionListItem[] = visit
    ? [
        {
          key: 'entry',
          icon: <LogIn size={16} />,
          label: t('supplierPoEntryDate'),
          value: formatDate(visit.entry_at),
          dir: 'ltr',
        },
        {
          key: 'exit',
          icon: <LogOut size={16} />,
          label: t('equipmentCardExitDate'),
          value: visit.exit_at
            ? formatDate(visit.exit_at)
            : t('equipmentCardStillInside'),
          dir: visit.exit_at ? 'ltr' : undefined,
        },
        {
          key: 'foreman',
          icon: <User size={16} />,
          label: t('logsColForeman'),
          value: visit.entry_supervisor_name ?? '—',
        },
        {
          key: 'driver',
          icon: <User size={16} />,
          label: t('equipmentCardCurrentDriver'),
          value: displayDriverName(visit) || '—',
        },
      ]
    : []

  // Card pricing (0174): the card's own client price (in its unit since
  // 0185), its state and, for sales.approve, «اعتماد» / «رجوع للتعديل».
  const pricingStatus = cardPricingStatusOf(card.pricing_status)
  const pricingMargin = cardMargin(
    card.card_client_price,
    card.card_client_price_unit,
    card.supplier_price,
    card.supplier_rate_unit,
  )
  const approvalBlocker = cardPricingApprovalBlocker(card)
  const pricingTarget: CardPricingTarget = {
    card_id: card.card_id,
    equipment_code: card.equipment_code,
    client_price: card.card_client_price,
    client_price_unit: card.card_client_price_unit,
    supplier_price: card.supplier_price,
    supplier_rate_unit: card.supplier_rate_unit,
    supplier_po_number: card.supplier_po_number,
  }
  const pricingButton = (size: 'sm' | 'md') => {
    const className = size === 'md' ? 'h-11 flex-1' : undefined
    if (pricingStatus === 'approved')
      return (
        <Button
          size={size}
          variant="outline"
          className={className}
          icon={<RotateCcw size={size === 'sm' ? 14 : 16} aria-hidden="true" />}
          onClick={() => setPricingDialog('return')}
        >
          {t('cardPricingReturn')}
        </Button>
      )
    return (
      <Tooltip
        content={approvalBlocker ? t(approvalBlocker) : ''}
        disabled={!approvalBlocker}
      >
        <span className={size === 'md' ? 'flex flex-1' : 'inline-flex'}>
          <Button
            size={size}
            variant="primary"
            className={className}
            icon={<Check size={size === 'sm' ? 14 : 16} aria-hidden="true" />}
            disabled={approvalBlocker !== null}
            onClick={() => setPricingDialog('approve')}
          >
            {t('cardPricingApprove')}
          </Button>
        </span>
      </Tooltip>
    )
  }
  const pricingFacts: DescriptionListItem[] = [
    {
      key: 'clientPrice',
      icon: <Coins size={16} />,
      label: t('cardPriceClient'),
      value:
        card.card_client_price === null ? (
          <Badge tone="warning" size="sm">
            {t('cardMonthNeedsPrice')}
          </Badge>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            {pricingStatus === 'approved' && (
              <Lock size={14} aria-hidden="true" className="text-muted" />
            )}
            <SaleAmountOrDash
              value={card.card_client_price}
              unit={card.card_client_price_unit}
            />
          </span>
        ),
    },
    {
      key: 'pricingStatus',
      icon: <BadgeCheck size={16} />,
      label: t('cardPricingStatus'),
      value: (
        <CardPricingStatusBadge
          status={pricingStatus}
          approvedBy={card.pricing_approved_by_name}
          approvedAt={card.pricing_approved_at}
        />
      ),
    },
  ]

  const salesFacts: DescriptionListItem[] = card.client_po_number
    ? [
        {
          key: 'po',
          icon: <FileText size={16} />,
          label: t('clientPo'),
          value: (
            <PoPill
              number={card.client_po_number}
              href={
                onOpenClientPo && card.client_po_id
                  ? `/sales/${card.client_po_id}`
                  : undefined
              }
              onNavigate={
                onOpenClientPo && card.client_po_id
                  ? () => onOpenClientPo(card.client_po_id!)
                  : undefined
              }
              muted={!card.has_client_po}
            />
          ),
        },
        {
          key: 'price',
          icon: <Coins size={16} />,
          label: t('salePrice'),
          value: (
            <SaleAmountOrDash
              value={card.client_price}
              unit={card.client_rate_unit}
            />
          ),
        },
        {
          key: 'hours',
          icon: <Timer size={16} />,
          label: t('clientPoStandardHours'),
          value: (
            <>
              <bdi dir="ltr" className="tabular-nums">
                {card.client_standard_hours ?? card.standard_hours}
              </bdi>{' '}
              {t('clientPoHoursPerMonth')}
            </>
          ),
        },
        {
          key: 'quantity',
          icon: <Hourglass size={16} />,
          label: t('clientPoQuantity'),
          value: (
            <QuantityCell
              quantity={card.client_quantity}
              unit={card.client_rate_unit}
            />
          ),
        },
        {
          // Owner 2026-11-04: quantity × standard hours (a daily line «—»).
          key: 'contractHours',
          icon: <Clock size={16} />,
          label: t('clientPoContractHours'),
          value: <HoursFigure hours={totalHours} strong={false} />,
        },
      ]
    : []

  const purchasingFacts: DescriptionListItem[] =
    owned || !card.supplier_po_number
      ? []
      : [
          {
            key: 'po',
            icon: <FileText size={16} />,
            label: t('supplierPo'),
            value: (
              <PoPill
                number={card.supplier_po_number}
                href={
                  onOpenSupplierPo && card.supplier_po_id
                    ? `/purchasing/${card.supplier_po_id}`
                    : undefined
                }
                onNavigate={
                  onOpenSupplierPo && card.supplier_po_id
                    ? () => onOpenSupplierPo(card.supplier_po_id!)
                    : undefined
                }
                muted={!card.has_supplier_po}
              />
            ),
          },
          {
            key: 'supplier',
            icon: <Building2 size={16} />,
            label: t('supplierPoSupplier'),
            value: card.equipment_lessor_name ?? '—',
          },
          {
            key: 'price',
            icon: <Coins size={16} />,
            label: t('purchasePrice'),
            value:
              card.supplier_price === null ? (
                <span className="text-muted">—</span>
              ) : (
                <CardSupplierPriceCell
                  price={card.supplier_price}
                  rateUnit={card.supplier_rate_unit}
                />
              ),
          },
        ]

  const daysShown =
    isDaysRateUnit(card.client_rate_unit) ||
    isDaysRateUnit(card.supplier_rate_unit)
  const monthColumns: DataTableColumn<CardMonthRow>[] = [
    {
      key: 'month',
      header: t('cardMonthsMonth'),
      className: 'whitespace-nowrap',
      cell: (row) => (
        <span className="font-medium">{monthLabel(row.month, lang)}</span>
      ),
    },
    {
      key: 'hours',
      header: t('cardMonthHours'),
      align: 'center',
      className: 'tabular-nums',
      // 0185: a daily or weekly line shows its days under the hours.
      cell: (row) =>
        row.record ? (
          <span className="inline-flex flex-col items-center">
            <bdi dir="ltr">{row.record.hours}</bdi>
            {daysShown && row.record.days !== null && (
              <span className="text-xs text-muted">
                {formatDaysText(row.record.days, lang)}
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'client',
      header: t('cardMonthClientDue'),
      align: 'end',
      cell: (row) => (
        <CardMonthDueCell
          due={row.record ? figuresOf(row.record).client : noHours}
          side="client"
        />
      ),
    },
    {
      key: 'supplier',
      header: t('cardMonthSupplierDue'),
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => (
        <CardMonthDueCell
          due={
            row.record
              ? figuresOf(row.record).supplier
              : owned
                ? { value: null, blocker: 'owned' }
                : noHours
          }
          side="supplier"
        />
      ),
    },
    {
      key: 'margin',
      header: t('equipmentCardMargin'),
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => (
        <CardMonthDueCell
          due={row.record ? figuresOf(row.record).margin : noHours}
          side="margin"
        />
      ),
    },
    {
      key: 'state',
      header: t('status'),
      cell: (row) => <CardMonthStateBadge state={row.state} />,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">{t('cardMonthActions')}</span>,
            align: 'end' as const,
            cell: (row: CardMonthRow) => (
              <IconButton
                size="sm"
                variant="ghost"
                label={t(
                  row.record ? 'cardMonthEdit' : 'cardMonthRecordMonth',
                ).replace('{month}', monthShortLabel(row.month, lang))}
                icon={
                  row.record ? (
                    <Edit2 size={14} aria-hidden="true" />
                  ) : (
                    <Plus size={14} aria-hidden="true" />
                  )
                }
                onClick={() => openDialog(row)}
              />
            ),
          },
        ]
      : []),
  ]
  const recordButton = (size: 'sm' | 'md') => (
    <Button
      variant="primary"
      size={size}
      className={size === 'md' ? 'h-11 flex-1' : undefined}
      icon={<Plus size={size === 'sm' ? 14 : 16} aria-hidden="true" />}
      disabled={openMonths.length === 0}
      onClick={() => openDialog(null)}
    >
      {t('cardMonthRecord')}
    </Button>
  )

  const unitCell = (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
        <EquipmentIdentifierTag
          row={{
            equipment_plate_number: card.equipment_plate_number,
            equipment_chassis_number: card.equipment_chassis_number,
          }}
        />
        <span>{card.equipment_type ?? '—'}</span>
      </span>
      <span className="flex items-center gap-1.5 text-base font-semibold text-fg">
        <Building2 size={16} aria-hidden="true" className="text-muted" />
        {companyName} · {projectName}
      </span>
      {visitLabel && (
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <Calendar size={14} aria-hidden="true" />
          <bdi dir="ltr">{visitLabel}</bdi>
        </span>
      )}
    </span>
  )

  return (
    <div className="space-y-4">
      <PageTrailBar
        onBack={onBack}
        fallbackLabel={t('equipmentCardBackToList')}
      />

      {loadError && (
        <Notice tone="danger" size="compact">
          {t('equipmentCardLoadError')}
        </Notice>
      )}

      {/* 1. The header card: the unit, the company and project, the days of
          its visit and whether the unit is still inside. */}
      <div className="card space-y-4 p-4">
        <DetailHeader
          as="h1"
          identifier={card.equipment_code ?? '—'}
          identifierLtr
          subtitle={unitCell}
          badges={
            visit ? (
              <Badge tone={visit.is_open ? 'success' : 'neutral'}>
                {t(visit.is_open ? 'siteUnitsInside' : 'siteUnitsExited')}
              </Badge>
            ) : undefined
          }
          actions={
            onOpenEquipment || canManage || canApprove ? (
              <div className="hidden gap-2 sm:flex">
                {onOpenEquipment && (
                  <Button size="sm" variant="outline" asChild>
                    <AppLink
                      href={`/equipment/${card.equipment_id}`}
                      onNavigate={() => onOpenEquipment(card.equipment_id)}
                    >
                      <Truck size={14} aria-hidden="true" />
                      {t('equipment')}
                    </AppLink>
                  </Button>
                )}
                {canApprove && pricingButton('sm')}
                {canManage && SHOW_CARD_MONTHS && recordButton('sm')}
              </div>
            ) : undefined
          }
        />
        {/* 2. The summary strip: the LATEST RECORDED month's figures (phase
            2); the month is the hint, «—» while no month is recorded. While
            the months are hidden (0174), the card's pricing instead: the
            client price, the supplier price, the margin and its state. */}
        {!SHOW_CARD_MONTHS && (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard
              label={t('cardPriceClient')}
              value={
                card.card_client_price === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <SaleAmountOrDash
                    value={card.card_client_price}
                    unit={card.card_client_price_unit}
                  />
                )
              }
              hint={
                card.card_client_price === null
                  ? t('cardMonthNeedsPrice')
                  : undefined
              }
              icon={<Coins size={18} />}
            />
            <StatCard
              label={t('cardPriceSupplier')}
              value={
                owned && card.supplier_price === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <CardSupplierPriceCell
                    price={card.supplier_price}
                    rateUnit={card.supplier_rate_unit}
                  />
                )
              }
              hint={owned ? t('equipmentCardOwnedNoSupplierPo') : undefined}
              icon={<Receipt size={18} />}
            />
            <StatCard
              label={t('equipmentCardMargin')}
              value={
                <CardMarginCell
                  margin={pricingMargin}
                  pct={cardMarginPct(pricingMargin, card.card_client_price)}
                  clientPrice={card.card_client_price}
                  clientRateUnit={card.card_client_price_unit}
                  supplierPrice={card.supplier_price}
                  supplierRateUnit={card.supplier_rate_unit}
                  alignEnd={false}
                />
              }
              hint={owned ? t('cardPriceOwnedHint') : t('cardMonthMarginHint')}
              icon={<Percent size={18} />}
            />
            <StatCard
              label={t('cardPricingStatus')}
              value={
                <CardPricingStatusBadge
                  status={pricingStatus}
                  approvedBy={card.pricing_approved_by_name}
                  approvedAt={card.pricing_approved_at}
                  size="md"
                  compact
                />
              }
              hint={
                pricingStatus === 'approved' && card.pricing_approved_at
                  ? `${card.pricing_approved_by_name ?? '—'} · ${formatDateTime(card.pricing_approved_at, false)}`
                  : undefined
              }
              icon={<BadgeCheck size={18} />}
            />
          </div>
        )}
        {SHOW_CARD_MONTHS && (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard
              label={t('cardMonthClientDue')}
              value={
                <CardMonthDueCell
                  due={latestFigures.client}
                  side="client"
                  alignEnd={false}
                />
              }
              hint={latestHint}
              icon={<Coins size={18} />}
            />
            <StatCard
              label={t('cardMonthSupplierDue')}
              value={
                <CardMonthDueCell
                  due={latestFigures.supplier}
                  side="supplier"
                  alignEnd={false}
                />
              }
              hint={owned ? t('equipmentCardOwnedNoSupplierPo') : latestHint}
              icon={<Receipt size={18} />}
            />
            <StatCard
              label={t('equipmentCardMargin')}
              value={
                <CardMonthDueCell
                  due={latestFigures.margin}
                  side="margin"
                  alignEnd={false}
                />
              }
              hint={
                owned ? t('cardMonthMarginOwnedHint') : t('cardMonthMarginHint')
              }
              icon={<Percent size={18} />}
            />
            <StatCard
              label={t('cardMonthHours')}
              value={
                latest ? (
                  <bdi dir="ltr" className="tabular-nums">
                    {formatHours(latest.hours)}
                  </bdi>
                ) : (
                  <span className="text-muted">—</span>
                )
              }
              hint={
                (latest
                  ? `${monthShortLabel(monthKeyOf(latest.month), lang)} · `
                  : '') +
                t('equipmentCardFromStandardHours').replace(
                  '{hours}',
                  String(standardHours ?? card.standard_hours),
                )
              }
              icon={<Timer size={18} />}
            />
          </div>
        )}
      </div>

      {/* The visibility rule (owner 2026-10-15): nothing is hidden. */}
      <Notice tone="info" size="compact" icon={<Eye size={16} />}>
        {t('equipmentCardVisibilityNote')}
      </Notice>

      {/* 3. The three sides of the card, side by side; stacked on a phone. */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="space-y-3 p-4">
          <SectionHeader
            title={t('equipmentCardMovement')}
            action={
              visit && onOpenMovement ? (
                <Button size="sm" variant="outline" asChild>
                  <AppLink
                    href={`/movements/${visit.entry_id}`}
                    onNavigate={() => onOpenMovement(visit.entry_id)}
                  >
                    <ArrowUpRight
                      size={14}
                      aria-hidden="true"
                      className="rtl:-scale-x-100"
                    />
                    {t('siteUnitsOpenMovement')}
                  </AppLink>
                </Button>
              ) : undefined
            }
            actionBesideText
          />
          {movementFacts.length > 0 ? (
            <DescriptionList items={movementFacts} className="-my-2" />
          ) : (
            <p className="text-sm text-muted">{t('equipmentCardNoMovement')}</p>
          )}
        </Card>
        <Card className="space-y-3 p-4">
          <SectionHeader
            title={t('sales')}
            description={
              card.client_po_number ? undefined : t('equipmentCardNoClientLine')
            }
            action={canApprove ? pricingButton('sm') : undefined}
            actionBesideText
          />
          <DescriptionList
            items={[...pricingFacts, ...salesFacts]}
            className="-my-2"
          />
        </Card>
        <Card className="space-y-3 p-4">
          <SectionHeader
            title={t('purchasing')}
            description={
              owned || card.supplier_po_number
                ? undefined
                : t('equipmentCardNoSupplierLine')
            }
          />
          {owned ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Truck size={16} aria-hidden="true" />
              {t('equipmentCardOwnedNoSupplierPo')}
            </p>
          ) : purchasingFacts.length > 0 ? (
            <DescriptionList items={purchasingFacts} className="-my-2" />
          ) : (
            <EmptyState
              title={t('equipmentCardNoSupplierPo')}
              className="p-4"
            />
          )}
        </Card>
      </div>

      {/* 4. The months («كروت التشغيل», phase 2): one row per month of the
          card's period, newest first — the recorded hours with their
          amounts, or the awaited month — under the consumed hours against
          the contract total (owner 2026-11-04). Hidden for now
          (SHOW_CARD_MONTHS, owner 2026-11-04). */}
      {SHOW_CARD_MONTHS && (
        <Card padded={false} className="flex min-w-0 flex-col">
          <div className="p-4 pb-0">
            <SectionHeader
              title={
                <span className="flex items-center gap-2">
                  {t('equipmentCardMonths')}
                  <Badge size="sm">{monthRows.length}</Badge>
                  {openMonths.length > 0 && (
                    <Badge tone="warning" size="sm">
                      {t('cardMonthPendingCount').replace(
                        '{count}',
                        String(openMonths.length),
                      )}
                    </Badge>
                  )}
                </span>
              }
              description={t('equipmentCardMonthsDesc')}
              action={canManage ? recordButton('sm') : undefined}
            />
            <div className="mt-3 space-y-1.5">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted">
                <span>
                  {t('cardMonthConsumed')}{' '}
                  <bdi dir="ltr" className="font-medium tabular-nums text-fg">
                    {formatHours(consumedHours)}
                  </bdi>
                  {totalHours !== null && (
                    <>
                      {' '}
                      {t('cardMonthOf')}{' '}
                      <bdi dir="ltr" className="tabular-nums">
                        {formatHours(totalHours)}
                      </bdi>
                    </>
                  )}{' '}
                  {t('cardMonthHoursUnit')}
                </span>
                {remainingHours !== null && (
                  <span>
                    {t('cardMonthRemaining')}{' '}
                    <bdi dir="ltr" className="font-medium tabular-nums text-fg">
                      {formatHours(remainingHours)}
                    </bdi>{' '}
                    {t('cardMonthHoursUnit')}
                  </span>
                )}
              </p>
              {consumedShare !== null && (
                <span
                  aria-hidden="true"
                  className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
                >
                  <span
                    className="block h-full rounded-full bg-fg"
                    style={{ width: `${Math.round(consumedShare * 100)}%` }}
                  />
                </span>
              )}
            </div>
          </div>
          <div className="p-4 pt-3">
            {monthRows.length === 0 ? (
              <EmptyState
                icon={<Hourglass size={24} aria-hidden="true" />}
                title={t('cardMonthNoMonths')}
                className="p-6"
              />
            ) : (
              <DataTable
                size="md"
                cellTextClassName="text-[13px]"
                cellClassName="py-2"
                columns={monthColumns}
                rows={monthRows}
                rowKey={(row) => row.month}
                caption={t('equipmentCardMonths')}
              />
            )}
            <p className="mt-3 text-xs text-muted">{t('cardMonthsRuleNote')}</p>
          </div>
        </Card>
      )}

      {/* 5. The event timeline from both PO event tables and the card's. */}
      <Card className="space-y-3 p-4">
        <SectionHeader
          title={t('supplierPoEvents')}
          description={t('equipmentCardEventsDesc')}
        />
        <EventTimeline items={timeline} emptyLabel={t('supplierPoNoEvents')} />
      </Card>
      {/* The card's own time stamps, for the record. */}
      <p className="text-xs text-muted">
        {t('supplierPoCreatedAt')}:{' '}
        <bdi dir="ltr">{formatDateTime(card.created_at, false)}</bdi>
      </p>

      {/* 6. The mobile action bar. */}
      {(canApprove || (canManage && SHOW_CARD_MONTHS)) && (
        <div
          className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t bg-bg p-3 sm:hidden"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          {canApprove && pricingButton('md')}
          {canManage && SHOW_CARD_MONTHS && recordButton('md')}
        </div>
      )}

      {canApprove && (
        <>
          <ApproveCardPricingDialog
            card={pricingTarget}
            open={pricingDialog === 'approve'}
            onOpenChange={(next) => {
              if (!next) setPricingDialog(null)
            }}
            onApproved={(target) => {
              setPricingDialog(null)
              void toast({
                title: t('cardPricingApprovedToast').replace(
                  '{unit}',
                  target.equipment_code ?? '—',
                ),
                tone: 'success',
              })
              fetchData()
            }}
          />
          <ReturnCardPricingDialog
            card={pricingTarget}
            open={pricingDialog === 'return'}
            onOpenChange={(next) => {
              if (!next) setPricingDialog(null)
            }}
            onReturned={(target) => {
              setPricingDialog(null)
              void toast({
                title: t('cardPricingReturnedToast').replace(
                  '{unit}',
                  target.equipment_code ?? '—',
                ),
                tone: 'success',
              })
              fetchData()
            }}
          />
        </>
      )}

      {canManage && SHOW_CARD_MONTHS && (
        <RecordCardMonthDialog
          open={dialog !== null}
          onOpenChange={(next) => {
            if (!next) setDialog(null)
          }}
          card={{
            ...sides,
            card_id: card.card_id,
            equipment_code: card.equipment_code,
            standard_hours: card.standard_hours,
          }}
          openMonths={openMonths}
          editing={dialog?.editing ?? null}
          initialMonth={dialog?.initialMonth ?? null}
          onSaved={(month) => {
            setDialog(null)
            notify('cardMonthRecorded', month)
            fetchData()
          }}
          onDeleted={(month) => {
            setDialog(null)
            notify('cardMonthDeleted', month)
            fetchData()
          }}
        />
      )}
    </div>
  )
}
