import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { CalendarDays, Save, Truck } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  CardMonthDueCell,
  CardMonthDueTotal,
  CardMonthStateBadge,
} from '@/components/sales/CardMonthCells'
import {
  CardMonthPicker,
  presetMonthKeys,
} from '@/components/sales/CardMonthPicker'
import { PoPill } from '@/components/sales/PoPill'
import { UnitIdentityCell } from '@/components/sales/UnitIdentityCell'
import {
  AppLink,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  Skeleton,
  ToastProvider,
  useToast,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { localizedName } from '@/lib/localizedName'
import {
  cardMonthFigures,
  cardMonthFormMessage,
  cardMonthState,
  cardMonthTotalsByUnit,
  currentSaudiMonthKey,
  formatDaysText,
  isValidCardMonthDays,
  isValidCardMonthHours,
  monthKeyOf,
  monthLabel,
  monthStartOf,
  monthsCountLabel,
  parseCardMonthDays,
  parseCardMonthHours,
  type CardMonthBatchItem,
  type CardMonthFigures,
  type MonthKey,
} from '@/lib/sales'
import {
  fetchCardMonthSlots,
  fetchCardPlaces,
  fetchEarliestCardDay,
  recordEquipmentCardMonths,
  type CardMonthSlotRow,
  type CardPlaceRow,
} from '@/lib/salesData'

export interface CardMonthsBatchScreenProps {
  onOpenCard: (cardId: string) => void
}

/** The URL parameters of the selection (Back restores it). */
const PARAM_COMPANY = 'company'
const PARAM_PROJECT = 'project'
const PARAM_MONTH = 'month'

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/

interface Draft {
  hours: string
  /** 0185: the days, prefilled from the unit's presence in the month. */
  days: string
  note: string
}

/** A number of the view as the text of a field ('' for none). */
const numberText = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '' : String(value)

/**
 * «كروت التشغيل» (/sales/timesheets, migration 0172, the /ui-kit mockup the
 * owner approved on 2026-11-04): the client's monthly timesheet entered for
 * one project at once — company → its projects with cards → the month (the
 * three presets, or an older month back to the earliest card) — as one
 * table of the cards covering that month (`sales_card_month_slots`), each
 * with its hours, the client due, the supplier due and the margin computed
 * live by the same rule as the views, and a note; one «حفظ» sends only the
 * new or changed rows in ONE `record_equipment_card_months` call. Reads
 * with `sales.view`; the inputs and the save need `sales.manage` (the
 * database checks it again). An empty row is never saved: deleting a month
 * is done on the card page.
 */
export function CardMonthsBatchScreen(props: CardMonthsBatchScreenProps) {
  return (
    <ToastProvider>
      <BatchScreen {...props} />
    </ToastProvider>
  )
}

function BatchScreen({ onOpenCard }: CardMonthsBatchScreenProps) {
  const { t, lang } = useI18n()
  const { can } = usePermissions()
  const canManage = can('sales.manage')
  const toast = useToast()
  const pathname = usePathname()
  const params = useSearchParams()

  const currentMonth = currentSaudiMonthKey()
  const presets = useMemo(() => presetMonthKeys(currentMonth), [currentMonth])
  const companyId = params.get(PARAM_COMPANY) ?? ''
  const projectId = params.get(PARAM_PROJECT) ?? ''
  const monthParam = params.get(PARAM_MONTH) ?? ''
  // The previous month by default: the month whose timesheet arrives now.
  const month: MonthKey = MONTH_KEY.test(monthParam) ? monthParam : presets[1]

  const setParams = useCallback(
    (values: Record<string, string | null>) => {
      // The untouched parameters, then the new values (an empty value drops
      // its parameter).
      const next = new URLSearchParams(
        [...params.entries()].filter(([key]) => !(key in values)),
      )
      for (const [key, value] of Object.entries(values))
        if (value !== null && value !== '') next.set(key, value)
      const query = next.toString()
      if (query !== params.toString())
        window.history.replaceState(
          null,
          '',
          query ? `${pathname}?${query}` : pathname,
        )
    },
    [params, pathname],
  )

  // --- The pickers: the companies and projects with cards, the earliest month.
  const [places, setPlaces] = useState<CardPlaceRow[]>([])
  const [earliestMonth, setEarliestMonth] = useState<MonthKey | null>(null)
  const [placesState, setPlacesState] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  )
  const startPlacesRequest = useListRequest()
  const loadPlaces = useCallback(async () => {
    const signal = startPlacesRequest()
    setPlacesState('loading')
    try {
      const [rows, earliestDay] = await Promise.all([
        fetchCardPlaces(monthStartOf(presets[0]), signal),
        fetchEarliestCardDay(signal),
      ])
      if (signal.aborted) return
      setPlaces(rows)
      setEarliestMonth(earliestDay ? monthKeyOf(earliestDay) : null)
      setPlacesState('ready')
    } catch {
      if (signal.aborted) return
      setPlacesState('error')
    }
  }, [presets, startPlacesRequest])

  useEffect(() => {
    loadPlaces()
  }, [loadPlaces])

  const companyOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const place of places)
      if (!seen.has(place.company_id))
        seen.set(
          place.company_id,
          localizedName(lang, place.company_name_ar, place.company_name_en),
        )
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, lang))
  }, [places, lang])
  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const place of places)
      if (place.company_id === companyId && !seen.has(place.project_id))
        seen.set(
          place.project_id,
          localizedName(lang, place.project_name_ar, place.project_name_en),
        )
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, lang))
  }, [places, companyId, lang])
  const companyName =
    companyOptions.find((option) => option.value === companyId)?.label ?? ''
  const projectName =
    projectOptions.find((option) => option.value === projectId)?.label ?? ''

  // --- The rows of the chosen company, project and month.
  const selected = companyId !== '' && projectId !== ''
  const [rows, setRows] = useState<CardMonthSlotRow[]>([])
  const [rowsState, setRowsState] = useState<
    'idle' | 'loading' | 'error' | 'ready'
  >('idle')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<TranslationKey | null>(null)
  const startRowsRequest = useListRequest()
  const loadRows = useCallback(async () => {
    const signal = startRowsRequest()
    if (!selected) {
      setRows([])
      setRowsState('idle')
      return
    }
    setRowsState('loading')
    try {
      const slots = await fetchCardMonthSlots(
        { companyId, projectId, month },
        signal,
      )
      if (signal.aborted) return
      setRows(slots)
      setDrafts({})
      setRowsState('ready')
    } catch {
      if (signal.aborted) return
      setRows([])
      setRowsState('error')
    }
  }, [selected, companyId, projectId, month, startRowsRequest])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  const draftOf = useCallback(
    (row: CardMonthSlotRow): Draft =>
      drafts[row.slot_id] ?? {
        hours: row.recorded && row.hours !== null ? String(row.hours) : '',
        // A recorded month keeps its days; a new one starts with the
        // unit's presence days in the month (0185).
        days: row.recorded
          ? numberText(row.days)
          : numberText(row.presence_days),
        note: row.note ?? '',
      },
    [drafts],
  )
  const setDraft = (row: CardMonthSlotRow, patch: Partial<Draft>) => {
    setSaveError(null)
    setDrafts((current) => ({
      ...current,
      [row.slot_id]: { ...draftOf(row), ...patch },
    }))
  }

  /** The rows with hours typed; among them the invalid ones (named), and the
   *  ones the save writes: a new record or a changed one. */
  const filled = rows
    .map((row) => ({ row, draft: draftOf(row) }))
    .filter(({ draft }) => draft.hours.trim() !== '')
  const daysValid = (draft: Draft) =>
    draft.days.trim() === '' || isValidCardMonthDays(draft.days)
  const invalid = filled.filter(
    ({ draft }) => !isValidCardMonthHours(draft.hours) || !daysValid(draft),
  )
  const valid = filled
    .filter(
      ({ draft }) => isValidCardMonthHours(draft.hours) && daysValid(draft),
    )
    .map((item) => ({
      ...item,
      hours: Number(item.draft.hours.trim()),
      days: parseCardMonthDays(item.draft.days),
    }))
  const changed = valid.filter(
    ({ row, draft, hours, days }) =>
      !row.recorded ||
      Number(row.hours) !== hours ||
      (row.days === null ? null : Number(row.days)) !== days ||
      (row.note ?? '') !== draft.note.trim(),
  )
  const figuresOf = (row: CardMonthSlotRow): CardMonthFigures =>
    cardMonthFigures(
      row,
      parseCardMonthHours(draftOf(row).hours),
      parseCardMonthDays(draftOf(row).days),
    )
  const validFigures = valid.map(({ row }) => ({
    row,
    figures: figuresOf(row),
  }))
  const clientTotals = cardMonthTotalsByUnit(
    validFigures.map(({ row, figures }) => ({
      value: figures.client.value,
      unit: row.client_rate_unit,
    })),
  )
  const supplierTotals = cardMonthTotalsByUnit(
    validFigures.map(({ row, figures }) => ({
      value: figures.supplier.value,
      unit: row.supplier_rate_unit,
    })),
  )
  const marginTotals = cardMonthTotalsByUnit(
    validFigures.map(({ row, figures }) => ({
      value: figures.margin.value,
      unit: row.client_rate_unit,
    })),
  )

  const save = async () => {
    if (!changed.length || invalid.length) return
    setSaving(true)
    setSaveError(null)
    const items: CardMonthBatchItem[] = changed.map(
      ({ row, draft, hours, days }) => ({
        card_id: row.card_id,
        hours,
        days,
        note: draft.note.trim() || null,
      }),
    )
    const result = await recordEquipmentCardMonths(month, items)
    setSaving(false)
    if (result.error) {
      setSaveError(cardMonthFormMessage(result.error))
      return
    }
    toast({
      title: t('cardMonthsSaved').replace(
        '{months}',
        monthsCountLabel(result.data, lang),
      ),
      description: t('cardMonthsSavedDesc')
        .replace('{month}', monthLabel(month, lang))
        .replace('{project}', projectName),
      tone: 'success',
    })
    loadRows()
  }
  const clear = () => {
    setSaveError(null)
    setDrafts(
      Object.fromEntries(
        rows.map((row) => [row.slot_id, { hours: '', days: '', note: '' }]),
      ),
    )
  }

  const recordedCount = rows.filter((row) => row.recorded).length
  const columns: DataTableColumn<CardMonthSlotRow>[] = [
    {
      key: 'equipment_code',
      header: t('supplierPoEquipmentField'),
      cell: (row) => (
        <AppLink
          href={`/sales/cards/${row.card_id}`}
          onNavigate={() => onOpenCard(row.card_id)}
          className="block underline-offset-2 hover:underline"
        >
          <UnitIdentityCell
            code={row.equipment_code}
            type={row.equipment_type}
            plate={row.equipment_plate_number}
            chassis={row.equipment_chassis_number}
          />
        </AppLink>
      ),
    },
    {
      key: 'client_po',
      header: t('clientPo'),
      hideBelow: 'md',
      cell: (row) =>
        row.client_po_number ? (
          <PoPill number={row.client_po_number} />
        ) : (
          <span className="text-xs text-muted">
            {t('equipmentCardNoClientPo')}
          </span>
        ),
    },
    {
      key: 'supplier_po',
      header: t('supplierPo'),
      hideBelow: 'md',
      cell: (row) =>
        row.owned ? (
          <span className="text-xs text-muted">{t('equipmentCardOwned')}</span>
        ) : row.supplier_po_number ? (
          <PoPill number={row.supplier_po_number} muted />
        ) : (
          <span className="text-xs text-muted">
            {t('equipmentCardNoSupplierPo')}
          </span>
        ),
    },
    {
      key: 'hours',
      header: t('cardMonthHours'),
      cell: (row) => {
        const draft = draftOf(row)
        const label = `${t('cardMonthHours')} ${row.equipment_code ?? ''} · ${monthLabel(month, lang)}`
        return (
          <span className="flex items-center gap-2">
            {canManage ? (
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={9999}
                step={1}
                aria-label={label}
                value={draft.hours}
                onChange={(event) =>
                  setDraft(row, { hours: event.target.value })
                }
                placeholder={row.recorded ? String(row.hours) : '0'}
                invalid={
                  draft.hours.trim() !== '' &&
                  !isValidCardMonthHours(draft.hours)
                }
                className="w-24 tabular-nums"
              />
            ) : (
              <span className="tabular-nums">
                {row.recorded ? (
                  <bdi dir="ltr">{row.hours}</bdi>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </span>
            )}
            <CardMonthStateBadge state={cardMonthState(row, currentMonth)} />
          </span>
        )
      },
    },
    // 0185: the days of the month (a daily or weekly line is paid by them),
    // prefilled from the unit's presence; the presence shows muted under
    // the field once the days differ from it.
    {
      key: 'days',
      header: t('cardMonthDays'),
      cell: (row) => {
        const draft = draftOf(row)
        const presence = row.presence_days
        const differs =
          presence !== null &&
          presence !== undefined &&
          draft.days.trim() !== String(presence)
        return (
          <span className="flex flex-col items-start gap-0.5">
            {canManage ? (
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={31}
                step={1}
                aria-label={`${t('cardMonthDays')} ${row.equipment_code ?? ''} · ${monthLabel(month, lang)}`}
                value={draft.days}
                onChange={(event) =>
                  setDraft(row, { days: event.target.value })
                }
                placeholder="0"
                invalid={!daysValid(draft)}
                className="w-20 tabular-nums"
              />
            ) : (
              <span className="tabular-nums">
                {row.recorded && row.days !== null ? (
                  <bdi dir="ltr">{row.days}</bdi>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </span>
            )}
            {differs && (
              <span className="text-xs text-muted">
                {t('cardMonthPresenceDays').replace(
                  '{days}',
                  formatDaysText(presence, lang),
                )}
              </span>
            )}
          </span>
        )
      },
    },
    {
      key: 'client_due',
      header: t('cardMonthClientDue'),
      align: 'end',
      cell: (row) => (
        <CardMonthDueCell due={figuresOf(row).client} side="client" />
      ),
    },
    {
      key: 'supplier_due',
      header: t('cardMonthSupplierDue'),
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => (
        <CardMonthDueCell due={figuresOf(row).supplier} side="supplier" />
      ),
    },
    {
      key: 'margin',
      header: t('equipmentCardMargin'),
      align: 'end',
      hideBelow: 'sm',
      cell: (row) => (
        <CardMonthDueCell due={figuresOf(row).margin} side="margin" />
      ),
    },
    {
      key: 'note',
      header: t('cardMonthNote'),
      hideBelow: 'lg',
      cell: (row) =>
        canManage ? (
          <Input
            aria-label={`${t('cardMonthNote')} ${row.equipment_code ?? ''}`}
            value={draftOf(row).note}
            onChange={(event) => setDraft(row, { note: event.target.value })}
            placeholder={t('cardMonthNotePlaceholder')}
            maxLength={500}
            className="w-44"
          />
        ) : (
          <span className="text-xs text-muted">{row.note ?? '—'}</span>
        ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('cardTimesheets')}
        description={t('cardTimesheetsDesc')}
      />

      {/* The three selections: company → its projects → the month. */}
      {placesState === 'error' ? (
        <ErrorState
          description={t('cardMonthPlacesLoadError')}
          onRetry={loadPlaces}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <Field label={t('company')} required>
            {(control) =>
              placesState === 'loading' ? (
                <Skeleton className="h-10 w-full md:h-9" />
              ) : (
                <Select
                  {...control}
                  value={companyId}
                  onValueChange={(next) =>
                    setParams({ [PARAM_COMPANY]: next, [PARAM_PROJECT]: null })
                  }
                  placeholder={t('cardMonthCompanyPlaceholder')}
                  options={companyOptions}
                />
              )
            }
          </Field>
          <Field
            label={t('project')}
            required
            hint={
              companyId &&
              placesState === 'ready' &&
              projectOptions.length === 0
                ? t('cardMonthNoProjects')
                : undefined
            }
          >
            {(control) =>
              placesState === 'loading' ? (
                <Skeleton className="h-10 w-full md:h-9" />
              ) : (
                <Select
                  {...control}
                  value={projectId}
                  onValueChange={(next) => setParams({ [PARAM_PROJECT]: next })}
                  disabled={!companyId || projectOptions.length === 0}
                  placeholder={t('cardMonthProjectPlaceholder')}
                  options={projectOptions}
                />
              )
            }
          </Field>
          <Field label={t('cardMonthsMonth')} required>
            {() => (
              <CardMonthPicker
                value={month}
                onChange={(next) => setParams({ [PARAM_MONTH]: next })}
                earliestMonth={earliestMonth}
              />
            )}
          </Field>
        </div>
      )}

      {!selected ? (
        <EmptyState
          icon={<CalendarDays size={24} aria-hidden="true" />}
          title={t('cardMonthPickPlace')}
          description={t('cardMonthPickPlaceDesc')}
          className="p-8"
        />
      ) : rowsState === 'error' ? (
        <ErrorState
          description={t('cardMonthBatchLoadError')}
          onRetry={loadRows}
        />
      ) : rowsState === 'ready' && rows.length === 0 ? (
        <EmptyState
          icon={<Truck size={24} aria-hidden="true" />}
          title={t('cardMonthNoCards')
            .replace('{project}', projectName)
            .replace('{month}', monthLabel(month, lang))}
          description={t('cardMonthNoCardsDesc').replace(
            '{company}',
            companyName,
          )}
          className="p-8"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <span className="font-semibold">{companyName}</span>
              <span className="text-muted"> · {projectName} · </span>
              <span className="font-semibold">{monthLabel(month, lang)}</span>
            </p>
            {rowsState === 'ready' && (
              <p className="text-xs text-muted">
                {t('cardMonthCounts')
                  .replace('{cards}', String(rows.length))
                  .replace('{recorded}', String(recordedCount))
                  .replace('{pending}', String(rows.length - recordedCount))}
              </p>
            )}
          </div>
          {saveError && (
            <Notice tone="danger" size="compact">
              {t(saveError)}
            </Notice>
          )}
          {invalid.length > 0 && (
            <Notice tone="warning" size="compact">
              {t('cardMonthInvalidRows').replace(
                '{units}',
                invalid.map(({ row }) => row.equipment_code ?? '—').join('، '),
              )}
            </Notice>
          )}
          <DataTable
            size="md"
            cellTextClassName="text-[13px]"
            cellClassName="py-2"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.slot_id}
            loading={rowsState === 'loading'}
            loadingRows={6}
            caption={`${t('cardMonthHours')} ${monthLabel(month, lang)}`}
          />
          <p className="text-xs text-muted">{t('cardMonthBatchNote')}</p>
        </>
      )}

      {/* The sticky bottom bar: the save with its count, the totals of the
          filled rows per price unit, and «تفريغ»; sales.manage only. */}
      {canManage && selected && rows.length > 0 && (
        <div
          className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t bg-bg px-4 pt-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <Button
            variant="primary"
            className="h-11"
            icon={<Save size={16} aria-hidden="true" />}
            disabled={changed.length === 0 || invalid.length > 0}
            loading={saving}
            onClick={save}
          >
            {changed.length === 0
              ? t('save')
              : t('cardMonthSaveCount').replace(
                  '{months}',
                  monthsCountLabel(changed.length, lang),
                )}
          </Button>
          <Button
            variant="ghost"
            className="h-11"
            onClick={clear}
            disabled={saving}
          >
            {t('cardMonthClear')}
          </Button>
          <div className="ms-auto flex flex-wrap items-end gap-x-5 gap-y-2">
            <CardMonthDueTotal
              label={t('cardMonthClientDue')}
              parts={clientTotals}
            />
            <CardMonthDueTotal
              label={t('cardMonthSupplierDue')}
              parts={supplierTotals}
              className="hidden sm:flex"
            />
            <CardMonthDueTotal
              label={t('equipmentCardMargin')}
              parts={marginTotals}
              className="hidden sm:flex"
            />
          </div>
        </div>
      )}
    </div>
  )
}
