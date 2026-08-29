import * as XLSX from 'xlsx'

export type MovementImportMode = 'entry' | 'exit' | 'both'

export interface ParsedMovementImportRow {
  row_number: number
  mode: MovementImportMode
  supervisor_name: string
  company_name: string
  project_name: string
  equipment_code: string
  equipment_name: string
  plate_number: string
  contractor_equipment_code: string
  driver_name: string
  driver_number: string
  entry_date: string
  exit_date: string
  notes: string
}

const aliases = {
  supervisor_name: [
    'الفورمين',
    'المشرف',
    'اسم المشرف',
    'supervisor',
    'foreman',
  ],
  company_name: ['الشركة', 'اسم الشركة', 'company'],
  project_name: ['الموقع', 'المشروع', 'اسم المشروع', 'site', 'project'],
  equipment_code: [
    'رقم المعدة',
    'كود المعدة',
    'equipment code',
    'equipment number',
  ],
  equipment_name: [
    'المعدة',
    'اسم المعدة',
    'نوع المعدة',
    'equipment',
    'equipment name',
  ],
  plate_number: ['رقم اللوحة', 'plate number', 'plate'],
  contractor_equipment_code: [
    'ترقيم الشركة',
    'كود المقاول للمعدة',
    'company number',
    'contractor equipment code',
  ],
  driver_name: ['اسم سائق', 'اسم السائق', 'السائق', 'driver', 'driver name'],
  driver_number: [
    'رقم جوال السائق',
    'رقم السائق',
    'هوية السائق',
    'driver mobile',
    'driver id',
  ],
  entry_date: ['تاريخ الدخول', 'entry date'],
  exit_date: ['تاريخ الخروج', 'exit date'],
  notes: ['ملاحظات', 'الملاحظات', 'notes'],
} as const

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ـ_-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function valueFor(row: Record<string, unknown>, names: readonly string[]) {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]),
  )
  for (const name of names) {
    const value = normalized.get(normalizeHeader(name))
    if (value !== undefined && value !== null) return value
  }
  return ''
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function localDateString(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function excelDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return localDateString(value)
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
    }
  }
  const raw = text(value)
  if (!raw) return ''
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (iso)
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const local = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (local)
    return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw : localDateString(parsed)
}

export async function parseMovementWorkbook(
  file: File,
): Promise<ParsedMovementImportRow[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: 'array',
    cellDates: true,
  })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('missing_sheet')
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: true,
  })
  return rows
    .map((row, index) => {
      const entryDate = excelDate(valueFor(row, aliases.entry_date))
      const exitDate = excelDate(valueFor(row, aliases.exit_date))
      const mode: MovementImportMode =
        entryDate && exitDate ? 'both' : exitDate ? 'exit' : 'entry'
      return {
        row_number: index + 2,
        mode,
        supervisor_name: text(valueFor(row, aliases.supervisor_name)),
        company_name: text(valueFor(row, aliases.company_name)),
        project_name: text(valueFor(row, aliases.project_name)),
        equipment_code: text(valueFor(row, aliases.equipment_code)),
        equipment_name: text(valueFor(row, aliases.equipment_name)),
        plate_number: text(valueFor(row, aliases.plate_number)),
        contractor_equipment_code: text(
          valueFor(row, aliases.contractor_equipment_code),
        ),
        driver_name: text(valueFor(row, aliases.driver_name)),
        driver_number: text(valueFor(row, aliases.driver_number)),
        entry_date: entryDate,
        exit_date: exitDate,
        notes: text(valueFor(row, aliases.notes)),
      }
    })
    .filter(
      (row) =>
        row.equipment_code ||
        row.plate_number ||
        row.entry_date ||
        row.exit_date,
    )
}

export function downloadMovementImportTemplate() {
  const sheet = XLSX.utils.json_to_sheet([
    {
      الفورمين: '',
      الشركة: '',
      الموقع: '',
      'رقم المعدة': '',
      المعدة: '',
      'رقم اللوحة': '',
      'ترقيم الشركة': '',
      'اسم السائق': '',
      'رقم جوال السائق': '',
      'تاريخ الدخول': '',
      'تاريخ الخروج': '',
      ملاحظات: '',
    },
  ])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'الحركات')
  XLSX.writeFile(workbook, 'movement-import-template.xlsx')
}
