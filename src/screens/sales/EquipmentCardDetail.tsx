import { useCallback, useEffect, useState } from 'react'
import {
  ArrowUpRight,
  Building2,
  Calendar,
  Coins,
  CreditCard,
  Eye,
  FileText,
  Hourglass,
  Lock,
  LogIn,
  LogOut,
  Percent,
  Receipt,
  Timer,
  Truck,
  User,
} from 'lucide-react'
import { useListRequest } from '@/components/data-list/useListRequest'
import { EquipmentIdentifierTag } from '@/components/data-list/EquipmentIdentifierTag'
import { fetchProfileNames } from '@/components/details/profileNames'
import { EquipmentCardStatusBadge } from '@/components/sales/ClientPoStatusBadge'
import {
  EventTimeline,
  useClientPoTimelineItems,
  type TimelineItem,
} from '@/components/sales/EventTimeline'
import { PoPill } from '@/components/sales/PoPill'
import { QuantityCell } from '@/components/sales/QuantityCell'
import { SaleAmountOrDash } from '@/components/sales/SalePrice'
import {
  AppLink,
  BackButton,
  Button,
  Card,
  DescriptionList,
  DetailHeader,
  EmptyState,
  ErrorState,
  Notice,
  SectionHeader,
  Skeleton,
  StatCard,
  type DescriptionListItem,
} from '@/components/ui'
import { InfoGridSkeleton } from '@/components/ui/InfoGrid'
import { useI18n } from '@/i18n/I18nContext'
import { useTabTitle } from '@/components/TabTitle'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import { displayDriverName } from '@/lib/driverDisplayName'
import { localizedName } from '@/lib/localizedName'
import {
  SUPPLIER_PO_EVENT_LABEL_KEYS,
  SUPPLIER_PO_EVENTS_LIMIT,
  SUPPLIER_PO_RATE_UNIT_LABEL_KEYS,
  formatSupplierPoPrice,
  supplierPoRateUnitOf,
} from '@/lib/purchasing'
import {
  SUPPLIER_PO_EVENT_SELECT,
  supplierPoEventDetail,
  type SupplierPoEventRow,
} from '@/lib/purchasingData'
import { CLIENT_PO_EVENTS_LIMIT, equipmentCardStatus } from '@/lib/sales'
import {
  CARD_VISIT_SELECT,
  CLIENT_PO_EVENT_SELECT,
  EQUIPMENT_CARDS_SELECT,
  type CardVisitRow,
  type ClientPoEventRow,
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

/**
 * «صفحة كرت المعدة» (/sales/cards/:id, migration 0169, the /ui-kit mockup
 * the owner approved on 2026-11-02, phase 1): the header (the unit with
 * its plate and type, «الشركة · المشروع», the period, the status), the
 * summary strip with «—» for the monthly figures phase 2 will fill, the
 * three cards الحركة / المبيعات / المشتريات with real data, the «الشهور»
 * table as an empty state («تبدا مع كروت التشغيل»: no invented numbers)
 * and the timeline from both PO event tables. «انهاء الكرت» is NOT in
 * phase 1 (no function exists), so the page has no action. Reads through
 * RLS: `sales.view` or `purchasing.view` for the card, each side's own key
 * (the other side is simply NULL without it).
 */
export function EquipmentCardDetail({
  cardId,
  onBack,
  onOpenEquipment,
  onOpenMovement,
  onOpenClientPo,
  onOpenSupplierPo,
}: EquipmentCardDetailProps) {
  const { t, lang } = useI18n()
  const [card, setCard] = useState<SalesEquipmentCardRow | null>(null)
  useTabTitle(card?.equipment_code)
  const [visit, setVisit] = useState<CardVisitRow | null>(null)
  const [clientEvents, setClientEvents] = useState<ClientPoEventRow[]>([])
  const [supplierEvents, setSupplierEvents] = useState<SupplierPoEventRow[]>([])
  const [actorNames, setActorNames] = useState<ReadonlyMap<string, string>>(
    new Map(),
  )
  const [loading, setLoading] = useState(true)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
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
    if (row) {
      const [visitResult, clientResult, supplierResult] = await Promise.all([
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
      ])
      if (signal.aborted) return
      failed =
        failed ||
        Boolean(visitResult.error || clientResult.error || supplierResult.error)
      visitRow = (visitResult.data as unknown as CardVisitRow | null) ?? null
      clientRows =
        (clientResult.data as unknown as ClientPoEventRow[] | null) ?? []
      supplierRows =
        (supplierResult.data as unknown as SupplierPoEventRow[] | null) ?? []
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
        <BackButton onClick={onBack} label={t('equipmentCardBackToList')} />
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

  const status = equipmentCardStatus(card)
  const open = status === 'open'
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
  const periodLabel = card.period_to
    ? `${formatDate(card.period_from)} – ${formatDate(card.period_to)}`
    : `${formatDate(card.period_from)} · ${t('equipmentPurchasingOpenEnd')}`

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
      label: `${t('supplierPo')} · ${t(SUPPLIER_PO_EVENT_LABEL_KEYS[event.event_type] ?? 'supplierPoEventUpdated')}`,
      detail: supplierPoEventDetail(
        event,
        () => card.equipment_code,
        (value) =>
          formatSupplierPoPrice(value as number | string | null | undefined),
        formatDate,
        (unit) => t(SUPPLIER_PO_RATE_UNIT_LABEL_KEYS[unit]),
      ),
      actor: event.actor_id ? (actorNames.get(event.actor_id) ?? null) : null,
      created_at: event.created_at,
    }))
  // Both sides on one timeline, newest first.
  const timeline = [...clientItems, ...supplierItems].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )

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
            value: (
              <SaleAmountOrDash
                value={card.supplier_price}
                unit={supplierPoRateUnitOf(card.supplier_rate_unit)}
              />
            ),
          },
        ]

  const dash = <span className="text-muted">—</span>
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
      <span className="flex items-center gap-1.5 text-sm text-muted">
        <Calendar size={14} aria-hidden="true" />
        <bdi dir="ltr">{periodLabel}</bdi>
      </span>
    </span>
  )

  return (
    <div className="space-y-4">
      <BackButton onClick={onBack} label={t('equipmentCardBackToList')} />

      {loadError && (
        <Notice tone="danger" size="compact">
          {t('equipmentCardLoadError')}
        </Notice>
      )}

      {/* 1. The header card: the unit, the company and project, the period,
          the status; no action in phase 1. */}
      <div className="card space-y-4 p-4">
        <DetailHeader
          as="h1"
          identifier={card.equipment_code ?? '—'}
          identifierLtr
          subtitle={unitCell}
          badges={<EquipmentCardStatusBadge status={status} />}
          actions={
            onOpenEquipment ? (
              <Button size="sm" variant="outline" asChild>
                <AppLink
                  href={`/equipment/${card.equipment_id}`}
                  onNavigate={() => onOpenEquipment(card.equipment_id)}
                >
                  <Truck size={14} aria-hidden="true" />
                  {t('equipment')}
                </AppLink>
              </Button>
            ) : undefined
          }
        />
        {/* 2. The summary strip: the monthly figures wait for phase 2. */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard
            label={t('equipmentCardClientDue')}
            value={dash}
            hint={t('equipmentCardPhase2Hint')}
            icon={<Coins size={18} />}
          />
          <StatCard
            label={t('equipmentCardSupplierDue')}
            value={dash}
            hint={
              owned ? t('equipmentCardOwned') : t('equipmentCardPhase2Hint')
            }
            icon={<Receipt size={18} />}
          />
          <StatCard
            label={t('equipmentCardMargin')}
            value={dash}
            hint={t('equipmentCardPhase2Hint')}
            icon={<Percent size={18} />}
          />
          <StatCard
            label={t('equipmentCardHoursThisMonth')}
            value={dash}
            hint={t('equipmentCardFromStandardHours').replace(
              '{hours}',
              String(card.client_standard_hours ?? card.standard_hours),
            )}
            icon={<Timer size={18} />}
          />
        </div>
      </div>

      {!open && (
        <Notice tone="neutral" size="compact" icon={<Lock size={16} />}>
          {t('equipmentCardEndedNotice')}
        </Notice>
      )}

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
          />
          {salesFacts.length > 0 ? (
            <DescriptionList items={salesFacts} className="-my-2" />
          ) : (
            <EmptyState title={t('equipmentSalesNone')} className="p-4" />
          )}
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

      {/* 4. The months (phase 2): an empty state, never invented numbers. */}
      <Card padded={false} className="flex min-w-0 flex-col">
        <div className="p-4 pb-0">
          <SectionHeader
            title={t('equipmentCardMonths')}
            description={t('equipmentCardMonthsDesc')}
          />
        </div>
        <div className="p-4 pt-3">
          <EmptyState
            icon={<Hourglass size={24} aria-hidden="true" />}
            title={t('equipmentCardPhase2Hint')}
            className="p-6"
          />
          <p className="mt-3 text-xs text-muted">
            {t('equipmentCardMonthsNote')}
          </p>
        </div>
      </Card>

      {/* 5. The event timeline from both PO event tables. */}
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
    </div>
  )
}
