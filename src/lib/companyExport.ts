import * as XLSX from 'xlsx'
import type { TranslationKey } from '@/i18n/translations'

export const COMPANY_EXPORT_COLUMNS = [
  'name_ar',
  'name_en',
  'projects_count',
  'linked_projects',
  'created_at',
  'updated_at',
] as const

export type CompanyExportColumn = (typeof COMPANY_EXPORT_COLUMNS)[number]

export type CompanyExportRow = {
  id: string
  name_ar: string
  name_en: string
  created_at: string
  updated_at: string
  projects: Array<{ name_ar: string; name_en: string }>
}

type Translate = (key: TranslationKey) => string

export const companyExportColumnLabels: Record<
  CompanyExportColumn,
  TranslationKey
> = {
  name_ar: 'companyNameAr',
  name_en: 'companyNameEn',
  projects_count: 'linkedProjectsCount',
  linked_projects: 'linkedProjects',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
}

function columnWidth(column: CompanyExportColumn) {
  switch (column) {
    case 'linked_projects':
      return 42
    case 'name_ar':
    case 'name_en':
      return 30
    case 'created_at':
    case 'updated_at':
      return 18
    default:
      return 16
  }
}

export function exportCompaniesToExcel(
  companies: CompanyExportRow[],
  columns: CompanyExportColumn[],
  t: Translate,
  lang: 'ar' | 'en',
) {
  const headers = columns.map((column) => t(companyExportColumnLabels[column]))
  const rows = companies.map((company) =>
    columns.map((column) => {
      if (column === 'projects_count') return company.projects.length
      if (column === 'linked_projects') {
        return company.projects
          .map((project) =>
            lang === 'ar'
              ? project.name_ar || project.name_en
              : project.name_en || project.name_ar,
          )
          .join('\n')
      }
      if (column === 'created_at' || column === 'updated_at')
        return new Date(company[column])
      return company[column]
    }),
  )

  const sheet = XLSX.utils.aoa_to_sheet([
    [t('companies')],
    [t('companyExportGeneratedAt'), new Date()],
    [],
    headers,
    ...rows,
  ])
  const headerRow = 4
  const lastColumn = XLSX.utils.encode_col(Math.max(columns.length - 1, 0))
  const dateColumns = columns
    .map((column, index) =>
      column === 'created_at' || column === 'updated_at' ? index : -1,
    )
    .filter((index) => index >= 0)

  for (const column of dateColumns) {
    for (let row = headerRow + 1; row <= rows.length + headerRow; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row - 1, c: column })]
      if (cell) cell.z = 'yyyy-mm-dd hh:mm'
    }
  }

  sheet['!cols'] = columns.map((column) => ({ wch: columnWidth(column) }))
  sheet['!rows'] = [{ hpt: 24 }, { hpt: 20 }, { hpt: 8 }, { hpt: 22 }]
  sheet['!autofilter'] = { ref: `A${headerRow}:${lastColumn}${rows.length + headerRow}` }
  sheet['!freeze'] = {
    xSplit: 0,
    ySplit: headerRow,
    topLeftCell: `A${headerRow + 1}`,
    activePane: 'bottomLeft',
    state: 'frozen',
  }
  sheet['!rtl'] = lang === 'ar'

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, t('companies').slice(0, 31))
  XLSX.writeFile(workbook, 'companies-export.xlsx', { cellDates: true })
}
