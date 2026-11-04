import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Calendar,
  CalendarDays,
  Clock,
  Coins,
  Edit2,
  FileText,
  Lock,
  MapPin,
  Percent,
  Plus,
  Receipt,
  StickyNote,
  Timer,
  Truck,
  User,
} from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { useListRequest } from '@/components/data-list/useListRequest'
import { fetchProfileNames } from '@/components/details/profileNames'
import { PurchasingUnitCell } from '@/components/purchasing/PurchasingUnitCell'
import { AddClientPoEquipmentDialog } from '@/components/sales/AddClientPoEquipmentDialog'
import { HoursFigure } from '@/components/sales/CardMonthCells'
import { ClientPoOptionsMenu } from '@/components/sales/ClientPoOptionsMenu'
import { ClientPoStatusBadge } from '@/components/sales/ClientPoStatusBadge'
import { CloseClientPoDialog } from '@/components/sales/CloseClientPoDialog'
import { EditClientPoDialog } from '@/components/sales/EditClientPoDialog'
import { EditClientPoLineDialog } from '@/components/sales/EditClientPoLineDialog'
import { ClientPoEventsTimeline } from '@/components/sales/EventTimeline'
import { QuantityCell } from '@/components/sales/QuantityCell'
import { SalePrice, SalePricesByUnit } from '@/components/sales/SalePrice'
import {
  BackButton,
  Badge,
  Button,
  Card,
  DescriptionList,
  DetailHeader,
  EmptyState,
  ErrorState,
  IconButton,
  Notice,
  SectionHeader,
  Select,
  Skeleton,
  StatCard,
  type DescriptionListItem,
} from '@/components/ui'
import { InfoGridSkeleton } from '@/components/ui/InfoGrid'
import { useI18n } from '@/i18n/I18nContext'
import { useTabTitle } from '@/components/TabTitle'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import { vatOf, withVat } from '@/lib/purchasing'
import {
  CLIENT_PO_EVENTS_LIMIT,
  SALE_RATE_UNIT_LABEL_KEYS,
  clientPoTotalsByUnit,
  contractHours,
  contractHoursTotal,
  saleRateUnitOf,
} from '@/lib/sales'
import {
  CLIENT_PO_EVENT_SELECT,
  CLIENT_PO_LINE_SELECT,
  CLIENT_PO_SELECT,
  cardPeriodLabel,
  type ClientPoEventRow,
  type ClientPoLineRow,
  type ClientPoRow,
} from '@/lib/salesData'
import { supabase } from '@/lib/supabase'

export interface ClientPoDetailProps {
  poId: string
  onBack: () => void
  onOpenEquipment?: (equipmentId: string) => void
}

type SortKey = 'equipment' | 'period' | 'price'
type SortDirection = 'asc' | 'desc'

/** The list the page returns to (the «PO العملاء» child of «المبيعات»). */
export const CLIENT_POS_PATH = '/sales/orders'

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
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card space-y-3 p-4 xl:col-start-3 xl:row-start-1">
          <Skeleton variant="text" className="w-24" />
          <InfoGridSkeleton count={6} columns={2} withIcon />
        </div>
        <div className="card space-y-3 p-4 xl:col-span-2 xl:col-start-1 xl:row-start-1">
          <Skeleton variant="text" className="w-28" />
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The client PO page (/sales/:id), the approved detail-page pattern as the
 * owner approved it on /ui-kit (2026-11-02): header card (the client's
 * number, status, the CLIENT company on its own line with the project under
 * it, «خيارات» for `sales.manage`), the summary strip (one amount per
 * price unit), the lines as wide cards with a sort select and a total
 * card, the facts card (above the lines below `xl`) and the event timeline
 * beside them from `xl`, and a bottom action bar on mobile. Reads through
 * RLS (`sales.view`); every write goes through the 0169 functions, which
 * check `sales.manage` again. No approval and no PDF on this side.
 */
export function ClientPoDetail({
  poId,
  onBack,
  onOpenEquipment,
}: ClientPoDetailProps) {
  const { t, lang } = useI18n()
  const { can } = usePermissions()
  const canManage = can('sales.manage')
  const [po, setPo] = useState<ClientPoRow | null>(null)
  useTabTitle(po?.po_number)
  const [lines, setLines] = useState<ClientPoLineRow[]>([])
  const [events, setEvents] = useState<ClientPoEventRow[]>([])
  const [createdByName, setCreatedByName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<ClientPoLineRow | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'equipment',
    direction: 'asc',
  })
  const startRequest = useListRequest()

  const fetchData = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    const signal = startRequest()
    const [poResult, linesResult, eventsResult] = await Promise.all([
      supabase
        .from('client_pos')
        .select(CLIENT_PO_SELECT)
        .eq('id', poId)
        .abortSignal(signal)
        .maybeSingle(),
      supabase
        .from('client_po_equipment')
        .select(CLIENT_PO_LINE_SELECT)
        .eq('client_po_id', poId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .abortSignal(signal),
      supabase
        .from('client_po_events')
        .select(CLIENT_PO_EVENT_SELECT)
        .eq('client_po_id', poId)
        // Events of one transaction share created_at; seq keeps their order.
        .order('created_at', { ascending: false })
        .order('seq', { ascending: false })
        .limit(CLIENT_PO_EVENTS_LIMIT)
        .abortSignal(signal),
    ])
    if (signal.aborted) return
    const poRow = poResult.data as unknown as ClientPoRow | null
    // The events carry the actor's name; only the creator is looked up.
    const names = await fetchProfileNames(supabase, [poRow?.created_by], signal)
    if (signal.aborted) return
    setLoadError(
      Boolean(poResult.error || linesResult.error || eventsResult.error) ||
        names.failed,
    )
    setPo(poRow)
    setLines((linesResult.data as unknown as ClientPoLineRow[] | null) ?? [])
    setEvents((eventsResult.data as unknown as ClientPoEventRow[] | null) ?? [])
    setCreatedByName(
      (poRow?.created_by && names.names.get(poRow.created_by)) || null,
    )
    setLoadedId(poId)
    setLoading(false)
  }, [poId, startRequest])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (loading && (loadedId !== poId || !po))
    return <PageSkeleton label={t('loading')} />
  if (!po)
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} label={t('clientPoBackToList')} />
        {loadError ? (
          <ErrorState
            description={t('clientPoLoadError')}
            onRetry={fetchData}
          />
        ) : (
          <EmptyState
            icon={<FileText size={28} aria-hidden="true" />}
            title={t('clientPoNotFound')}
          />
        )}
      </div>
    )

  const open = po.status === 'open'
  const showActions = open && canManage
  const companyName = po.company
    ? localizedName(lang, po.company.name_ar, po.company.name_en)
    : '—'
  const projectName = po.project
    ? localizedName(lang, po.project.name_ar, po.project.name_en)
    : '—'
  // One total per price unit (a month, a day and an hour are never added).
  const { parts: totalsByUnit, unpriced } = clientPoTotalsByUnit(lines)
  const codeOf = (equipmentId: string) =>
    lines.find((line) => line.card?.equipment?.id === equipmentId)?.card
      ?.equipment?.code ?? null

  const sortValue = (line: ClientPoLineRow): string | number => {
    switch (sort.key) {
      case 'period':
        return line.card?.period_from ?? ''
      case 'price':
        return line.price === null ? -1 : Number(line.price)
      default:
        return line.card?.equipment?.code ?? ''
    }
  }
  // One PO holds a handful of lines (not a major list): sorted here.
  const sortedLines = [...lines].sort((a, b) => {
    const va = sortValue(a)
    const vb = sortValue(b)
    const cmp =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), lang)
    return sort.direction === 'asc' ? cmp : -cmp
  })

  const facts: DescriptionListItem[] = [
    {
      key: 'company',
      icon: <Building2 size={16} />,
      label: t('clientPoCompany'),
      value: companyName,
    },
    {
      key: 'project',
      icon: <MapPin size={16} />,
      label: t('project'),
      value: projectName,
    },
    {
      key: 'issue',
      icon: <Calendar size={16} />,
      label: t('clientPoIssueDate'),
      value: formatDate(po.issue_date),
      dir: 'ltr',
    },
    {
      key: 'expiry',
      icon: <CalendarDays size={16} />,
      label: t('clientPoExpiryDate'),
      value: po.expiry_date
        ? formatDate(po.expiry_date)
        : t('clientPoNoExpiry'),
      dir: po.expiry_date ? 'ltr' : undefined,
    },
    {
      key: 'hours',
      icon: <Timer size={16} />,
      label: t('clientPoStandardHours'),
      value: (
        <>
          <bdi dir="ltr" className="tabular-nums">
            {po.standard_hours}
          </bdi>{' '}
          {t('clientPoHoursPerMonth')}
        </>
      ),
    },
    {
      // Owner 2026-11-04: the lines' contract hours (quantity × standard
      // hours; an hourly line its quantity; a daily line none) summed over
      // the lines that have a total.
      key: 'contractHours',
      icon: <Clock size={16} />,
      label: t('clientPoContractHours'),
      value: <HoursFigure hours={contractHoursTotal(lines)} strong={false} />,
    },
    {
      key: 'createdBy',
      icon: <User size={16} />,
      label: t('supplierPoCreatedBy'),
      value: createdByName ?? '—',
    },
    {
      key: 'createdAt',
      icon: <Clock size={16} />,
      label: t('supplierPoCreatedAt'),
      value: formatDateTime(po.created_at),
      dir: 'ltr',
    },
    ...(po.closed_at
      ? [
          {
            key: 'closedAt',
            icon: <Lock size={16} />,
            label: t('supplierPoClosedAt'),
            value: formatDateTime(po.closed_at),
            dir: 'ltr' as const,
          },
        ]
      : []),
    {
      key: 'notes',
      icon: <StickyNote size={16} />,
      label: t('notes'),
      value: po.notes,
    },
  ]

  const optionsMenu = (className?: string) => (
    <ClientPoOptionsMenu
      className={className}
      onEdit={() => setEditOpen(true)}
      onClose={() => setCloseOpen(true)}
    />
  )

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'equipment', label: t('supplierPoEquipmentField') },
    { value: 'period', label: t('equipmentPurchasingPeriod') },
    { value: 'price', label: t('salePrice') },
  ]
  const sortControls = (
    <div className="flex items-center gap-1.5">
      <Select
        size="sm"
        aria-label={t('sortBy')}
        className="w-[150px]"
        value={sort.key}
        onValueChange={(key) =>
          setSort((current) => ({ ...current, key: key as SortKey }))
        }
        options={sortOptions}
      />
      <IconButton
        size="sm"
        variant="outline"
        label={
          sort.direction === 'asc' ? t('sortDescending') : t('sortAscending')
        }
        icon={
          sort.direction === 'asc' ? (
            <ArrowUp size={14} aria-hidden="true" />
          ) : (
            <ArrowDown size={14} aria-hidden="true" />
          )
        }
        onClick={() =>
          setSort((current) => ({
            ...current,
            direction: current.direction === 'asc' ? 'desc' : 'asc',
          }))
        }
      />
    </div>
  )

  const addButton = (
    <Button
      variant="primary"
      size="sm"
      icon={<Plus size={14} aria-hidden="true" />}
      onClick={() => setAddOpen(true)}
    >
      {t('supplierPoAddEquipment')}
    </Button>
  )

  return (
    <div className="space-y-4">
      <BackButton onClick={onBack} label={t('clientPoBackToList')} />

      {loadError && (
        <Notice tone="danger" size="compact">
          {t('clientPoLoadError')}
        </Notice>
      )}

      {/* 1. Header card: the client's number, the CLIENT, the project,
          actions, then the summary strip (no meta line). */}
      <div className="card space-y-4 p-4">
        <DetailHeader
          as="h1"
          identifier={po.po_number}
          identifierLtr
          subtitle={
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-base font-semibold text-fg">
                <Building2
                  size={16}
                  aria-hidden="true"
                  className="text-muted"
                />
                {companyName}
              </span>
              <span className="flex items-center gap-1.5 text-sm text-muted">
                <MapPin size={14} aria-hidden="true" />
                {projectName}
              </span>
            </span>
          }
          badges={
            <>
              <ClientPoStatusBadge status={po.status} />
              {unpriced > 0 && (
                <Badge tone="warning">
                  {t('supplierPoNeedsPrices')} ({unpriced})
                </Badge>
              )}
            </>
          }
          actions={
            showActions ? (
              /* The same menu sits in the mobile bar. */
              <div className="hidden sm:flex">{optionsMenu()}</div>
            ) : undefined
          }
        />
        {/* 2. Summary strip: one amount per price unit. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label={t('supplierPoSummaryTotal')}
            value={<SalePricesByUnit parts={totalsByUnit} />}
            icon={<Coins size={18} />}
          />
          <StatCard
            label={t('supplierPoSummaryVat')}
            hint="15%"
            value={<SalePricesByUnit parts={totalsByUnit} amount={vatOf} />}
            icon={<Percent size={18} />}
          />
          <StatCard
            label={t('supplierPoSummaryTotalWithVat')}
            value={<SalePricesByUnit parts={totalsByUnit} amount={withVat} />}
            icon={<Receipt size={18} />}
          />
          <StatCard
            label={t('supplierPoEquipmentCount')}
            value={lines.length}
            hint={
              unpriced > 0
                ? `${unpriced} ${t('supplierPoUnpricedTotalNote')}`
                : undefined
            }
            icon={<Truck size={18} />}
          />
        </div>
      </div>

      {!open && (
        <Notice tone="neutral" size="compact" icon={<Lock size={16} />}>
          {t('clientPoClosedNotice')}
        </Notice>
      )}

      {/* 3. Body: below xl the facts, the lines, the timeline; from xl the
          lines over two columns beside the facts and the timeline. */}
      <div className="grid gap-4 xl:grid-cols-3 xl:grid-rows-[auto_1fr]">
        <Card className="space-y-3 p-4 xl:col-start-3 xl:row-start-1 xl:self-start">
          <SectionHeader title={t('clientPoDetails')} />
          <DescriptionList items={facts} className="-my-2" />
        </Card>
        <Card
          padded={false}
          className="flex min-w-0 flex-col xl:col-span-2 xl:col-start-1 xl:row-span-2 xl:row-start-1"
        >
          <div className="p-4 pb-0">
            <SectionHeader
              title={
                <span className="flex items-center gap-2">
                  {t('supplierPoEquipment')}
                  <Badge size="sm">{lines.length}</Badge>
                </span>
              }
              description={t('clientPoEquipmentDesc')}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  {lines.length > 1 && sortControls}
                  {showActions && addButton}
                </div>
              }
            />
          </div>
          {lines.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={t('clientPoNoEquipment')}
                className="p-6"
                action={showActions ? addButton : undefined}
              />
            </div>
          ) : (
            /* 4. One wide card per line: identity at the start, the period,
               hours and note in the middle, and at the end a fixed-width
               block with the price, the quantity and the remaining bar. */
            <ul className="space-y-2 p-4 pt-3">
              {sortedLines.map((line) => {
                const unit = line.card?.equipment ?? null
                return (
                  <li
                    key={line.id}
                    className="rounded-xl border bg-bg p-3 sm:p-4"
                  >
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-3 sm:flex-nowrap">
                      <div className="min-w-0 flex-1 sm:basis-2/5">
                        {unit && onOpenEquipment ? (
                          <button
                            type="button"
                            className="text-start underline-offset-2 hover:underline"
                            onClick={() => onOpenEquipment(unit.id)}
                          >
                            <PurchasingUnitCell unit={unit} withType />
                          </button>
                        ) : (
                          <PurchasingUnitCell unit={unit} withType />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1 sm:basis-3/5">
                        {line.card && (
                          <p className="flex items-center gap-1.5 text-xs text-muted">
                            <Calendar
                              size={12}
                              aria-hidden="true"
                              className="shrink-0"
                            />
                            <bdi dir="ltr">{cardPeriodLabel(line.card, t)}</bdi>
                          </p>
                        )}
                        <p className="flex items-center gap-1.5 text-xs text-muted">
                          <Timer
                            size={12}
                            aria-hidden="true"
                            className="shrink-0"
                          />
                          <span>
                            {t('clientPoStandardHours')}{' '}
                            <bdi dir="ltr" className="font-medium text-fg">
                              {line.standard_hours}
                            </bdi>{' '}
                            ·{' '}
                            {t(
                              SALE_RATE_UNIT_LABEL_KEYS[
                                saleRateUnitOf(line.rate_unit)
                              ],
                            )}
                          </span>
                        </p>
                        {line.note && (
                          <p className="flex items-start gap-1.5 text-xs text-muted">
                            <StickyNote
                              size={12}
                              aria-hidden="true"
                              className="mt-0.5 shrink-0"
                            />
                            <span className="min-w-0 break-words">
                              {line.note}
                            </span>
                          </p>
                        )}
                      </div>
                      <div className="flex w-full flex-col gap-2 border-t pt-3 sm:w-48 sm:shrink-0 sm:items-end sm:border-t-0 sm:pt-0">
                        <div className="flex w-full items-start justify-between gap-3 sm:flex-col sm:items-end">
                          <div className="text-start sm:text-end">
                            <p className="text-xs text-muted">
                              {t('salePrice')}
                            </p>
                            <p className="text-lg font-semibold">
                              {line.price === null ? (
                                <Badge tone="warning">
                                  {t('supplierPoNoPrice')}
                                </Badge>
                              ) : (
                                <SalePrice
                                  value={line.price}
                                  unit={saleRateUnitOf(line.rate_unit)}
                                />
                              )}
                            </p>
                          </div>
                          {showActions && (
                            <Button
                              size="sm"
                              variant="outline"
                              icon={<Edit2 size={14} aria-hidden="true" />}
                              onClick={() => setEditing(line)}
                            >
                              {t('edit')}
                            </Button>
                          )}
                        </div>
                        <QuantityCell
                          quantity={line.quantity}
                          unit={line.rate_unit}
                        />
                        {/* Owner 2026-11-04: the line's total contract
                            hours under its quantity («—» for a daily line
                            or no quantity). */}
                        <p className="text-xs text-muted">
                          {t('clientPoContractHoursShort')}:{' '}
                          <HoursFigure hours={contractHours(line)} />
                        </p>
                      </div>
                    </div>
                  </li>
                )
              })}
              {/* The total card closing the list. */}
              <li className="rounded-xl border bg-surface p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
                  <p className="text-sm font-medium">
                    {t('supplierPoSummaryTotal')}
                    {unpriced > 0 && (
                      <span className="ms-1 font-normal text-muted">
                        ({unpriced} {t('supplierPoUnpricedTotalNote')})
                      </span>
                    )}
                  </p>
                  <p className="text-lg font-semibold sm:w-48 sm:shrink-0">
                    <SalePricesByUnit parts={totalsByUnit} alignEnd />
                  </p>
                </div>
              </li>
            </ul>
          )}
        </Card>

        <Card className="space-y-3 p-4 xl:col-start-3 xl:row-start-2 xl:self-start">
          <SectionHeader
            title={t('supplierPoEvents')}
            description={t('clientPoEventsDesc')}
          />
          <ClientPoEventsTimeline events={events} codeOf={codeOf} />
        </Card>
      </div>

      {/* 5. Mobile action bar. */}
      {showActions && (
        <div
          className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t bg-bg p-3 sm:hidden"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <Button
            variant="primary"
            className="h-11 flex-1"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => setAddOpen(true)}
          >
            {t('supplierPoAddEquipment')}
          </Button>
          {optionsMenu('h-11')}
        </div>
      )}

      <AddClientPoEquipmentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        po={po}
        excludeEquipmentIds={lines.flatMap((line) =>
          line.card?.equipment?.id ? [line.card.equipment.id] : [],
        )}
        onAdded={() => {
          setAddOpen(false)
          fetchData()
        }}
      />
      <EditClientPoLineDialog
        line={editing}
        poStandardHours={po.standard_hours}
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
        onSaved={() => {
          setEditing(null)
          fetchData()
        }}
      />
      <EditClientPoDialog
        po={po}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => {
          setEditOpen(false)
          fetchData()
        }}
      />
      <CloseClientPoDialog
        po={po}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onClosed={() => {
          setCloseOpen(false)
          fetchData()
        }}
      />
    </div>
  )
}
