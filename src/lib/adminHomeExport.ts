/**
 * The Excel export of the admin home's fleet mini tables (migration 0107).
 *
 * The export follows the filter the table is showing, not the page: the owner
 * asked for "the whole current filter", so the table walks the same loader
 * page by page and writes one sheet. Two caps keep that bounded — at most
 * `OUTSIDE_EXPORT_MAX_ROWS` rows, fetched `OUTSIDE_EXPORT_PAGE_SIZE` at
 * a time — and the caller is told when the cap actually truncated the file
 * rather than being handed a silently short export.
 *
 * Nothing here imports Supabase or `xlsx`: the page walker takes the fetcher
 * as an argument, and the columns below are plain descriptions for the shared
 * `exportRowsToExcel` (`src/lib/excel.ts`), which the table imports
 * dynamically, so the ~400 KB spreadsheet library is only downloaded when
 * someone actually presses the export button on the landing page.
 */
import { formatDate } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import type {
  FleetEquipmentRow,
  FleetMiniTableId,
  LatestEntryRow,
  LatestEquipmentRow,
} from '@/lib/adminHomeStats'
import type { ExcelColumn } from '@/lib/excel'
import type { Language, TranslationKey } from '@/i18n/translations'

/** Hard ceiling on an export, so one press can never pull an unbounded list
 *  into the browser (the "first 5000 rows" note names this number). The
 *  `OUTSIDE_` names predate the mini tables and are kept because the movement
 *  log and visits exports import them too. */
export const OUTSIDE_EXPORT_MAX_ROWS = 5000
/** Page size the export walks with: the largest the database function allows
 *  and the largest the shared list system offers. */
export const OUTSIDE_EXPORT_PAGE_SIZE = 500

export interface ExportPage<T> {
  rows: T[]
  total: number
}

export interface CollectedPages<T> {
  rows: T[]
  /** The size of the whole filtered set, as the database counted it. */
  total: number
  /** True when the cap stopped the walk before the end of the set. */
  capped: boolean
}

/**
 * Walks a paginated loader to the end of its result set.
 *
 * The loader is passed in rather than imported, which keeps this file free of
 * Supabase (and unit-testable) and lets the caller decide which filter the
 * export follows. The walk stops on three conditions, all of them necessary:
 * the reported total is reached, the cap is reached, or a page comes back
 * empty — the last one is what guarantees termination if the total and the
 * rows ever disagree.
 */
export async function collectAllPages<T>(
  loadPage: (page: number, pageSize: number) => Promise<ExportPage<T>>,
  options: { maxRows?: number; pageSize?: number } = {},
): Promise<CollectedPages<T>> {
  const pageSize = Math.max(
    1,
    Math.trunc(options.pageSize ?? OUTSIDE_EXPORT_PAGE_SIZE),
  )
  const maxRows = Math.max(
    1,
    Math.trunc(options.maxRows ?? OUTSIDE_EXPORT_MAX_ROWS),
  )
  const rows: T[] = []
  let total = 0
  let page = 1
  for (;;) {
    const result = await loadPage(page, pageSize)
    total = result.total
    if (result.rows.length === 0) break
    rows.push(...result.rows)
    if (rows.length >= maxRows) {
      rows.length = maxRows
      break
    }
    if (rows.length >= total) break
    page += 1
  }
  return { rows, total, capped: rows.length < total }
}

type Translate = (key: TranslationKey) => string

export interface FleetExportLabels {
  t: Translate
  lang: Language
  /** Labels an `ownership_status`; the table already has this hook. */
  ownerLabel: (owner: string) => string
}

/** File names per table; ASCII so every operating system keeps them. */
export const FLEET_EXPORT_FILE_NAMES: Record<FleetMiniTableId, string> = {
  inside: 'inside-sites',
  workshop: 'in-workshop',
  available: 'available-equipment',
  entries: 'latest-entries',
  added: 'latest-equipment',
}

function companyProject(
  lang: Language,
  row: Pick<
    FleetEquipmentRow,
    'companyNameAr' | 'companyNameEn' | 'projectNameAr' | 'projectNameEn'
  >,
): string {
  const parts = [
    row.companyNameAr || row.companyNameEn
      ? localizedName(lang, row.companyNameAr, row.companyNameEn)
      : '',
    row.projectNameAr || row.projectNameEn
      ? localizedName(lang, row.projectNameAr, row.projectNameEn)
      : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

/** The purpose cell of a workshop row, as plain text rather than a code. */
export function workshopPurposeLabel(
  purpose: FleetEquipmentRow['workshopPurpose'],
  t: Translate,
): string {
  if (purpose === 'maintenance') return t('adminHomeMaintenance')
  if (purpose === 'parking') return t('adminHomeParking')
  return t('adminHomeUnclassified')
}

/**
 * The sheet columns of one fleet state table, in the table's own order plus
 * the type and owner the narrow card leaves out.
 *
 * The date is a real Saudi-time date cell (`type: 'date'`) so it sorts and
 * filters in Excel. The one exception is the available table: a unit that has
 * never moved has no date, and a blank cell reads as missing data rather than
 * as a fact, so that column is text carrying the explicit «بلا حركات» — as the
 * export of the section it replaces already did.
 */
export function fleetEquipmentExcelColumns(
  table: 'inside' | 'workshop' | 'available',
  { t, lang, ownerLabel }: FleetExportLabels,
): ExcelColumn<FleetEquipmentRow>[] {
  const code: ExcelColumn<FleetEquipmentRow> = {
    header: t('adminHomeColEquipment'),
    width: 14,
    value: (row) => row.code,
  }
  const type: ExcelColumn<FleetEquipmentRow> = {
    header: t('adminHomeColType'),
    width: 24,
    value: (row) => row.type,
  }
  const owner: ExcelColumn<FleetEquipmentRow> = {
    header: t('adminHomeColOwner'),
    width: 16,
    value: (row) => ownerLabel(row.owner),
  }
  const since: ExcelColumn<FleetEquipmentRow> = {
    header: t('adminHomeColSince'),
    width: 18,
    type: 'date',
    value: (row) => row.since,
  }
  if (table === 'inside')
    return [
      code,
      {
        header: t('adminHomeColCompanyProject'),
        width: 34,
        value: (row) => companyProject(lang, row),
      },
      since,
      type,
      owner,
    ]
  if (table === 'workshop')
    return [
      code,
      {
        header: t('adminHomeColPurpose'),
        width: 14,
        value: (row) => workshopPurposeLabel(row.workshopPurpose, t),
      },
      since,
      type,
      owner,
    ]
  return [
    code,
    type,
    {
      header: t('adminHomeColLastExit'),
      width: 16,
      value: (row) =>
        row.since ? formatDate(row.since) : t('adminHomeNeverMoved'),
    },
    owner,
  ]
}

/** "اخر الدخوليات": a workshop entry has no company, so it reads «ورشة». */
export function latestEntryCompany(
  row: LatestEntryRow,
  lang: Language,
  t: Translate,
): string {
  if (row.context === 'workshop') return t('workshopContext')
  if (!row.companyNameAr && !row.companyNameEn) return ''
  return localizedName(lang, row.companyNameAr, row.companyNameEn)
}

export function latestEntriesExcelColumns({
  t,
  lang,
  ownerLabel,
}: FleetExportLabels): ExcelColumn<LatestEntryRow>[] {
  return [
    {
      header: t('adminHomeColEquipment'),
      width: 14,
      value: (row) => row.equipmentCode,
    },
    {
      header: t('company'),
      width: 26,
      value: (row) => latestEntryCompany(row, lang, t),
    },
    {
      header: t('adminHomeColForeman'),
      width: 22,
      value: (row) => row.foreman ?? '',
    },
    {
      header: t('adminHomeColMovementDate'),
      width: 18,
      type: 'date',
      value: (row) => row.recordedAt,
    },
    {
      header: t('adminHomeColType'),
      width: 24,
      value: (row) => row.equipmentType,
    },
    {
      header: t('adminHomeColOwner'),
      width: 16,
      value: (row) => ownerLabel(row.owner),
    },
  ]
}

export function latestEquipmentExcelColumns({
  t,
  ownerLabel,
}: FleetExportLabels): ExcelColumn<LatestEquipmentRow>[] {
  return [
    {
      header: t('adminHomeColEquipment'),
      width: 14,
      value: (row) => row.code,
    },
    { header: t('adminHomeColType'), width: 24, value: (row) => row.type },
    {
      header: t('adminHomeColOwner'),
      width: 16,
      value: (row) => ownerLabel(row.owner),
    },
    {
      header: t('adminHomeColAddedAt'),
      width: 18,
      type: 'date',
      value: (row) => row.createdAt,
    },
  ]
}
