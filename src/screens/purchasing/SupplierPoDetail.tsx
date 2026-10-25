import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Calendar,
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
  Truck,
  User,
} from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { useListRequest } from '@/components/data-list/useListRequest'
import { fetchProfileNames } from '@/components/details/profileNames'
import { AddEquipmentDialog } from '@/components/purchasing/AddEquipmentDialog'
import { CloseSupplierPoDialog } from '@/components/purchasing/CloseSupplierPoDialog'
import { EditLineDialog } from '@/components/purchasing/EditLineDialog'
import { EditSupplierPoDialog } from '@/components/purchasing/EditSupplierPoDialog'
import { Price } from '@/components/purchasing/Price'
import { PurchasingUnitCell } from '@/components/purchasing/PurchasingUnitCell'
import { SupplierPoEventsTimeline } from '@/components/purchasing/SupplierPoEventsTimeline'
import { SupplierPoOptionsMenu } from '@/components/purchasing/SupplierPoOptionsMenu'
import { SupplierPoPrintSheet } from '@/components/purchasing/SupplierPoPrintSheet'
import { SupplierPoReceipt } from '@/components/purchasing/SupplierPoReceipt'
import { SupplierPoStatusBadge } from '@/components/purchasing/SupplierPoStatusBadge'
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
import type { TranslationKey } from '@/i18n/translations'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import {
  SUPPLIER_PO_EVENTS_LIMIT,
  supplierPoSupplierLabel,
  vatOf,
  withVat,
} from '@/lib/purchasing'
import {
  SUPPLIER_PO_EVENT_SELECT,
  SUPPLIER_PO_LINE_SELECT,
  SUPPLIER_PO_SELECT,
  supplierPoTotal,
  type SupplierPoEventRow,
  type SupplierPoLineRow,
  type SupplierPoRow,
} from '@/lib/purchasingData'
import { supabase } from '@/lib/supabase'

export interface SupplierPoDetailProps {
  poId: string
  onBack: () => void
  onOpenEquipment?: (equipmentId: string) => void
}

type SortKey = 'equipment' | 'period' | 'price'
type SortDirection = 'asc' | 'desc'

/** The list the page returns to (the «اوامر الشراء» child of «المشتريات»). */
export const SUPPLIER_POS_PATH = '/purchasing/orders'

/** The card period behind a line: «from – to», or «from – مفتوح». */
function periodLabel(
  card: { period_from: string; period_to: string | null },
  t: (key: TranslationKey) => string,
): string {
  const to = card.period_to
    ? formatDate(card.period_to)
    : t('equipmentPurchasingOpenEnd')
  return `${formatDate(card.period_from)} – ${to}`
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
 * The supplier PO page (/purchasing/:id), the approved detail-page pattern
 * (2026-10-19): header card (number, status, the SUPPLIER NAME on its own
 * line, actions; no meta line since 2026-10-24), the summary strip, the
 * lines as wide cards with a sort select and a total card, the facts card
 * (every fact of the PO; above the lines below `xl`) and the event timeline
 * beside them from `xl`, and a bottom action bar on mobile. Reads through RLS
 * (`purchasing.view`); every write goes through the 0136 functions, which
 * check `purchasing.manage` again.
 */
export function SupplierPoDetail({
  poId,
  onBack,
  onOpenEquipment,
}: SupplierPoDetailProps) {
  const { t, lang } = useI18n()
  const { can } = usePermissions()
  const canManage = can('purchasing.manage')
  const [po, setPo] = useState<SupplierPoRow | null>(null)
  const [lines, setLines] = useState<SupplierPoLineRow[]>([])
  const [events, setEvents] = useState<SupplierPoEventRow[]>([])
  const [actorNames, setActorNames] = useState<ReadonlyMap<string, string>>(
    new Map(),
  )
  const [loading, setLoading] = useState(true)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<SupplierPoLineRow | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  // «تصدير PDF»: the hidden print sheet is mounted only while the browser's
  // print dialog is up (owner 2026-10-22: no tab, no page of the site).
  const [printing, setPrinting] = useState(false)
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
        .from('supplier_pos')
        .select(SUPPLIER_PO_SELECT)
        .eq('id', poId)
        .abortSignal(signal)
        .maybeSingle(),
      supabase
        .from('supplier_po_equipment')
        .select(SUPPLIER_PO_LINE_SELECT)
        .eq('supplier_po_id', poId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .abortSignal(signal),
      supabase
        .from('supplier_po_events')
        .select(SUPPLIER_PO_EVENT_SELECT)
        .eq('supplier_po_id', poId)
        // 0141: events of one transaction share created_at; seq keeps their
        // order (the PO's creation before its lines).
        .order('created_at', { ascending: false })
        .order('seq', { ascending: false })
        .limit(SUPPLIER_PO_EVENTS_LIMIT)
        .abortSignal(signal),
    ])
    if (signal.aborted) return
    const eventRows =
      (eventsResult.data as unknown as SupplierPoEventRow[] | null) ?? []
    const poRow = poResult.data as unknown as SupplierPoRow | null
    const names = await fetchProfileNames(
      supabase,
      [...eventRows.map((event) => event.actor_id), poRow?.created_by],
      signal,
    )
    if (signal.aborted) return
    // A failed name lookup is reported like the data it belongs to, so the
    // page never silently shows every actor as "—".
    setLoadError(
      Boolean(poResult.error || linesResult.error || eventsResult.error) ||
        names.failed,
    )
    setPo(poRow)
    setLines((linesResult.data as unknown as SupplierPoLineRow[] | null) ?? [])
    setEvents(eventRows)
    setActorNames(names.names)
    setLoadedId(poId)
    setLoading(false)
  }, [poId, startRequest])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Skeleton only while there is nothing to show for this PO yet; a refetch
  // of the PO already on screen keeps the page in place.
  if (loading && (loadedId !== poId || !po))
    return <PageSkeleton label={t('loading')} />
  if (!po)
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} label={t('supplierPoBackToList')} />
        {loadError ? (
          <ErrorState
            description={t('supplierPoLoadError')}
            onRetry={fetchData}
          />
        ) : (
          <EmptyState
            icon={<FileText size={28} aria-hidden="true" />}
            title={t('supplierPoNotFound')}
          />
        )}
      </div>
    )

  const open = po.status === 'open'
  const showActions = open && canManage
  const supplier = supplierPoSupplierLabel(po, t)
  const companyName = po.company
    ? localizedName(lang, po.company.name_ar, po.company.name_en)
    : '—'
  const projectName = po.project
    ? localizedName(lang, po.project.name_ar, po.project.name_en)
    : '—'
  const { total, unpriced } = supplierPoTotal(lines)
  const createdByName =
    (po.created_by && actorNames.get(po.created_by)) || '—'
  const codeOf = (equipmentId: string) =>
    lines.find((line) => line.card?.equipment?.id === equipmentId)?.card
      ?.equipment?.code ?? null

  const sortValue = (line: SupplierPoLineRow): string | number => {
    switch (sort.key) {
      case 'period':
        return line.card?.period_from ?? ''
      case 'price':
        // Unpriced lines sort before every price.
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

  // Owner 2026-10-24: every fact of the PO lives in this card and the header
  // has no meta line; the supplier stays in the header only (its own line).
  const facts: DescriptionListItem[] = [
    {
      key: 'company',
      icon: <Building2 size={16} />,
      label: t('company'),
      value: companyName,
    },
    {
      key: 'project',
      icon: <MapPin size={16} />,
      label: t('project'),
      value: projectName,
    },
    {
      key: 'start',
      icon: <Calendar size={16} />,
      label: t('supplierPoStartDate'),
      value: formatDate(po.start_date),
      dir: 'ltr',
    },
    {
      key: 'createdBy',
      icon: <User size={16} />,
      label: t('supplierPoCreatedBy'),
      value: createdByName,
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

  // «خيارات» (owner 2026-10-22): «تصدير PDF» for every reader, plus edit
  // and close for a manager while the PO is open.
  const optionsMenu = (className?: string) => (
    <SupplierPoOptionsMenu
      className={className}
      busy={printing}
      onExport={() => setPrinting(true)}
      onEdit={showActions ? () => setEditOpen(true) : undefined}
      onClose={showActions ? () => setCloseOpen(true) : undefined}
    />
  )

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'equipment', label: t('supplierPoEquipmentField') },
    { value: 'period', label: t('equipmentPurchasingPeriod') },
    { value: 'price', label: t('supplierPoPrice') },
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
        label={sort.direction === 'asc' ? t('sortDescending') : t('sortAscending')}
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
      <BackButton onClick={onBack} label={t('supplierPoBackToList')} />

      {loadError && (
        <Notice tone="danger" size="compact">
          {t('supplierPoLoadError')}
        </Notice>
      )}

      {/* 1. Header card: identity, the supplier, meta, actions, summary. */}
      <div className="card space-y-4 p-4">
        <DetailHeader
          as="h1"
          identifier={po.po_number}
          identifierLtr
          subtitle={
            <span className="flex items-center gap-1.5 text-base font-semibold text-fg">
              <Building2 size={16} aria-hidden="true" className="text-muted" />
              {supplier}
            </span>
          }
          badges={
            <>
              <SupplierPoStatusBadge status={po.status} />
              {unpriced > 0 && (
                <Badge tone="warning">
                  {t('supplierPoNeedsPrices')} ({unpriced})
                </Badge>
              )}
            </>
          }
          actions={
            /* A manager has the same menu in the mobile bar; a reader keeps
               it in the header on every size. */
            <div className={showActions ? 'hidden sm:flex' : 'flex'}>
              {optionsMenu()}
            </div>
          }
        />
        {/* 2. Summary strip (owner 2026-10-22): the total without VAT, the
            VAT, the total with VAT, and the unit count. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label={t('supplierPoSummaryTotal')}
            value={<Price value={total} />}
            icon={<Coins size={18} />}
          />
          <StatCard
            label={t('supplierPoSummaryVat')}
            value={<Price value={vatOf(total)} />}
            icon={<Percent size={18} />}
          />
          <StatCard
            label={t('supplierPoSummaryTotalWithVat')}
            value={<Price value={withVat(total)} />}
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
          {t('supplierPoClosedNotice')}
        </Notice>
      )}

      {/* 3. Body. Below xl: the facts, the lines, the timeline (owner
          2026-10-24: the facts above the lines on mobile). From xl: the lines
          over two columns, the facts and the timeline stacked beside them
          (the 1fr second row takes the lines' extra height, so the facts and
          the timeline stay together at the top). */}
      <div className="grid gap-4 xl:grid-cols-3 xl:grid-rows-[auto_1fr]">
        <Card className="space-y-3 p-4 xl:col-start-3 xl:row-start-1 xl:self-start">
          <SectionHeader title={t('supplierPoDetails')} />
          <DescriptionList items={facts} className="-my-2" />
        </Card>
        <Card
          padded={false}
          className="flex min-w-0 flex-col xl:col-span-2 xl:col-start-1 xl:row-span-2 xl:row-start-1"
        >
          <div className="p-4 pb-0">
            <SectionHeader
              title={t('supplierPoEquipment')}
              description={t('supplierPoEquipmentDesc')}
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
                title={t('supplierPoNoEquipment')}
                className="p-6"
                action={showActions ? addButton : undefined}
              />
            </div>
          ) : (
            /* 4. One wide card per line, the price in a fixed end block, the
               total closing the list. */
            <ul className="space-y-2 p-4 pt-3">
              {sortedLines.map((line) => {
                const unit = line.card?.equipment ?? null
                return (
                  <li key={line.id} className="rounded-xl border bg-bg p-3 sm:p-4">
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
                      {/* Owner 2026-10-22: no supplier on the line — the PO has
                          exactly one party, shown in the header. */}
                      <div className="min-w-0 flex-1 space-y-1 sm:basis-3/5">
                        {line.card && (
                          <p className="flex items-center gap-1.5 text-sm text-muted">
                            <Calendar size={14} aria-hidden="true" className="shrink-0" />
                            <bdi dir="ltr">{periodLabel(line.card, t)}</bdi>
                          </p>
                        )}
                        {line.note && (
                          <p className="flex items-start gap-1.5 text-xs text-muted">
                            <StickyNote
                              size={12}
                              aria-hidden="true"
                              className="mt-0.5 shrink-0"
                            />
                            <span className="min-w-0 break-words">{line.note}</span>
                          </p>
                        )}
                      </div>
                      <div className="flex w-full items-center justify-between gap-3 border-t pt-3 sm:w-44 sm:shrink-0 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                        <div className="text-start sm:text-end">
                          <p className="text-xs text-muted">{t('supplierPoPrice')}</p>
                          <p className="text-lg font-semibold">
                            {line.price === null ? (
                              <Badge tone="warning">{t('supplierPoNoPrice')}</Badge>
                            ) : (
                              <Price value={line.price} />
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
                    </div>
                  </li>
                )
              })}
              {/* «خلاصة الامر» (owner 2026-10-24) closes the list, at its end
                  side, in place of the plain total card. */}
              <li className="flex justify-end pt-2">
                <SupplierPoReceipt
                  count={lines.length}
                  unpriced={unpriced}
                  total={total}
                />
              </li>
            </ul>
          )}
        </Card>

        <Card className="space-y-3 p-4 xl:col-start-3 xl:row-start-2 xl:self-start">
          <SectionHeader
            title={t('supplierPoEvents')}
            description={t('supplierPoEventsDesc')}
          />
          <SupplierPoEventsTimeline
            events={events}
            actorNames={actorNames}
            codeOf={codeOf}
          />
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

      <AddEquipmentDialog
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
      <EditLineDialog
        line={editing}
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
        onSaved={() => {
          setEditing(null)
          fetchData()
        }}
      />
      <EditSupplierPoDialog
        po={po}
        hasLines={lines.length > 0}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => {
          setEditOpen(false)
          fetchData()
        }}
      />
      {printing && (
        <SupplierPoPrintSheet
          po={po}
          lines={sortedLines}
          supplier={supplier}
          company={companyName}
          project={projectName}
          createdBy={createdByName}
          onDone={() => setPrinting(false)}
        />
      )}
      <CloseSupplierPoDialog
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
