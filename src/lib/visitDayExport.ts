/**
 * The day columns of the visits Excel export and «المستخلص» (owner
 * 2026-11-16): for one Saudi month, a column per day at the END of the visits
 * sheet — 10 for a day inside a project (Fridays empty), a letter for a
 * workshop day —, the counts before them (hours, workshop days), a second
 * sheet with one row per unit for the whole month (hours, workshop days,
 * days without a record, the days) and a legend sheet.
 *
 * Pure: the rules are `@/lib/visitDayGrid`, the reads `@/lib/visitDayExportData`.
 */
import type { Language, TranslationKey } from '@/i18n/translations'
import {
  sheetSpec,
  type ExcelColumn,
  type ExportSheetSpec,
} from '@/lib/excelSheet'
import { exportOwnerLabel } from '@/lib/exportFields'
import { monthLabel } from '@/lib/sales'
import {
  DAY_HOURS,
  dayCodes,
  monthDayKeys,
  saudiDayKeyOf,
  summarizeDayCells,
  unitDayCell,
  unitMonthDays,
  visitDayCell,
  visitsByUnit,
  workshopParents,
  type DayCell,
  type DaySummary,
  type GridVisit,
} from '@/lib/visitDayGrid'
import type { EquipmentVisitRow } from '@/lib/visitsList'

type Translate = (key: TranslationKey) => string

/** One visit as the month read selects it from `movement_visits`. */
export interface MonthVisitRow {
  entry_id: string
  equipment_id: string
  movement_context: 'site' | 'workshop'
  workshop_purpose: string | null
  entry_at: string
  exit_at: string | null
}

export function gridVisitOf(row: MonthVisitRow): GridVisit {
  return {
    entryId: row.entry_id,
    equipmentId: row.equipment_id,
    context: row.movement_context,
    workshopPurpose: row.workshop_purpose,
    entryAt: row.entry_at,
    exitAt: row.exit_at,
  }
}

/**
 * The units whose month visits do not already prove an earlier stay: none of
 * their visits started before the month. Only these need the «seen before»
 * read (an uncovered first day is «بدون تسجيل» for a known unit, empty for a
 * unit that had not arrived yet).
 */
export function unitsNeedingHistory(
  unitIds: readonly string[],
  monthVisits: readonly MonthVisitRow[],
  monthKey: string,
): string[] {
  const firstDay = monthDayKeys(monthKey)[0] ?? ''
  const known = new Set<string>()
  for (const visit of monthVisits)
    if (saudiDayKeyOf(visit.entry_at) < firstDay) known.add(visit.equipment_id)
  return unitIds.filter((id) => !known.has(id))
}

/** One row of the units sheet. */
export interface UnitMonthRow {
  equipmentId: string
  code: string
  type: string
  plateOrChassis: string
  owner: string
  cells: DayCell[]
  summary: DaySummary
}

export interface VisitDayExport {
  /** Written after the chosen columns of the visits sheet: counts, then days. */
  trailingColumns: ExcelColumn<EquipmentVisitRow>[]
  /** The units sheet, then the legend. */
  extraSheets: ExportSheetSpec[]
  /** The units sheet's rows, exposed for tests. */
  unitRows: UnitMonthRow[]
}

const cellValue = (cell: DayCell | undefined) =>
  cell === undefined || cell === '' ? null : cell

function dayColumns<T>(
  days: readonly string[],
  cellsOf: (row: T) => readonly DayCell[] | undefined,
): ExcelColumn<T>[] {
  return days.map((day, index) => ({
    header: String(Number(day.slice(8, 10))),
    width: 2,
    align: 'center' as const,
    value: (row: T) => cellValue(cellsOf(row)?.[index]),
  }))
}

function countColumn<T>(
  header: string,
  value: (row: T) => number | null,
): ExcelColumn<T> {
  return { header, width: 12, align: 'center', value }
}

export function buildVisitDayExport({
  rows,
  monthVisits,
  seenBefore,
  monthKey,
  now = Date.now(),
  t,
  lang,
}: {
  /** The exported visits (the rows of the first sheet). */
  rows: readonly EquipmentVisitRow[]
  /** Every visit of the exported units that touches the month. */
  monthVisits: readonly MonthVisitRow[]
  /** The units that have a visit before the month. */
  seenBefore: ReadonlySet<string>
  monthKey: string
  now?: number | Date
  t: Translate
  lang: Language
}): VisitDayExport {
  const codes = dayCodes()
  const days = monthDayKeys(monthKey)
  const firstDay = days[0] ?? ''
  const lastDay = days[days.length - 1] ?? ''
  const todayKey = saudiDayKeyOf(now)
  // The month's visits plus the exported rows themselves (a row may lie
  // outside the month and still be the project a workshop stay came from).
  const known = new Map<string, GridVisit>()
  for (const visit of monthVisits) known.set(visit.entry_id, gridVisitOf(visit))
  for (const row of rows)
    if (!known.has(row.entry_id)) known.set(row.entry_id, gridVisitOf(row))
  const byUnit = visitsByUnit([...known.values()])

  // Each unit once, in the order of its code.
  const units = new Map<string, EquipmentVisitRow>()
  for (const row of rows)
    if (!units.has(row.equipment_id)) units.set(row.equipment_id, row)

  const unitDays = new Map(
    [...units.keys()].map((id) => [
      id,
      unitMonthDays(byUnit.get(id) ?? [], monthKey, now, seenBefore.has(id)),
    ]),
  )
  // Which project row each workshop stay of a unit is drawn on.
  const unitParents = new Map(
    [...units.keys()].map((id) => [id, workshopParents(byUnit.get(id) ?? [])]),
  )

  // The visits sheet: a visit with no part in the month — outside it, and no
  // workshop day of its own there — keeps its cells empty and its counts
  // blank (not 0).
  const visitCells = new Map<string, DayCell[]>()
  const visitSummary = new Map<string, DaySummary>()
  for (const row of rows) {
    const from = saudiDayKeyOf(row.entry_at)
    if (!from) continue
    const to = row.exit_at ? saudiDayKeyOf(row.exit_at) : todayKey
    const visit = gridVisitOf(row)
    const parents = unitParents.get(row.equipment_id)
    const cells = (unitDays.get(row.equipment_id) ?? []).map((day) =>
      visitDayCell(day, visit, codes, now, parents),
    )
    const touches = from <= lastDay && to >= firstDay
    if (!touches && cells.every((cell) => cell === '')) continue
    visitCells.set(row.entry_id, cells)
    visitSummary.set(row.entry_id, summarizeDayCells(cells, codes))
  }

  const trailingColumns: ExcelColumn<EquipmentVisitRow>[] = [
    countColumn(
      t('exportDaysHours'),
      (row) => visitSummary.get(row.entry_id)?.hours ?? null,
    ),
    countColumn(
      t('exportDaysWorkshop'),
      (row) => visitSummary.get(row.entry_id)?.workshopDays ?? null,
    ),
    ...dayColumns<EquipmentVisitRow>(days, (row) =>
      visitCells.get(row.entry_id),
    ),
  ]

  const unitRows: UnitMonthRow[] = [...units.values()]
    .map((row) => {
      const cells = (unitDays.get(row.equipment_id) ?? []).map((day) =>
        unitDayCell(day, codes),
      )
      return {
        equipmentId: row.equipment_id,
        code: row.equipment_code ?? '',
        type: row.equipment_type ?? '',
        plateOrChassis:
          row.equipment_plate_number?.trim() ||
          row.equipment_chassis_number?.trim() ||
          '',
        owner: exportOwnerLabel(row.equipment_ownership_status, t),
        cells,
        summary: summarizeDayCells(cells, codes),
      }
    })
    .sort((a, b) =>
      a.code.localeCompare(b.code, 'en', {
        numeric: true,
        sensitivity: 'base',
      }),
    )

  const unitColumns: ExcelColumn<UnitMonthRow>[] = [
    { header: t('equipmentCodeLabel'), width: 14, value: (row) => row.code },
    { header: t('equipmentType'), width: 24, value: (row) => row.type },
    {
      header: t('exportDaysPlateOrChassis'),
      width: 18,
      value: (row) => row.plateOrChassis,
    },
    { header: t('ownershipStatus'), width: 16, value: (row) => row.owner },
    countColumn(t('exportDaysHours'), (row) => row.summary.hours),
    countColumn(t('exportDaysWorkshop'), (row) => row.summary.workshopDays),
    countColumn(t('exportDaysUnrecorded'), (row) => row.summary.unrecordedDays),
    ...dayColumns<UnitMonthRow>(days, (row) => row.cells),
  ]

  const legendRows: Array<{ code: string; meaning: string }> = [
    { code: t('exportDaysMonth'), meaning: monthLabel(monthKey, lang) },
    { code: String(DAY_HOURS), meaning: t('exportDaysLegendSite') },
    { code: codes.workshop, meaning: t('exportDaysLegendWorkshop') },
    { code: codes.unrecorded, meaning: t('exportDaysLegendUnrecorded') },
    {
      code: t('exportDaysLegendEmptyCode'),
      meaning: t('exportDaysLegendEmpty'),
    },
    { code: t('exportDaysHours'), meaning: t('exportDaysLegendHours') },
    { code: t('exportDaysSheetUnits'), meaning: t('exportDaysLegendUnits') },
  ]
  const legendColumns: ExcelColumn<{ code: string; meaning: string }>[] = [
    {
      header: t('exportDaysLegendCode'),
      width: 16,
      align: 'center',
      value: (row) => row.code,
    },
    {
      header: t('exportDaysLegendMeaning'),
      width: 70,
      value: (row) => row.meaning,
    },
  ]

  return {
    trailingColumns,
    extraSheets: [
      sheetSpec(t('exportDaysSheetUnits'), unitColumns, unitRows),
      sheetSpec(t('exportDaysSheetLegend'), legendColumns, legendRows),
    ],
    unitRows,
  }
}

/**
 * The month the dialog opens on: a date filter of the list that lies inside
 * one month, else the previous Saudi month. `value` / `valueTo` are the list
 * filter's own (a Saudi day, or an instant whose day is read in Saudi time).
 */
export function filterDayRange(filter: {
  operator: string
  value?: string
  valueTo?: string
}): { from: string | null; to: string | null } {
  const day = (value: string | undefined) => {
    const text = value?.trim()
    if (!text) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
    return saudiDayKeyOf(text) || null
  }
  if (filter.operator === 'eq') {
    const only = day(filter.value)
    return { from: only, to: only }
  }
  if (filter.operator === 'between')
    return { from: day(filter.value), to: day(filter.valueTo ?? filter.value) }
  return { from: null, to: null }
}
