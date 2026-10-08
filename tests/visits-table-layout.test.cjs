const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

test('the visits table uses 44 px rows and date-only entry/exit cells', () => {
  const source = read('src/components/visits/VisitsTable.tsx')
  assert.match(source, /<DataTable\s[\s\S]*?size="lg"/)
  assert.match(source, /formatDate\(visit\.entry_at\)/)
  assert.match(source, /formatDate\(visit\.exit_at\)/)
  assert.doesNotMatch(source, /formatDateTime/)
})

test('the visits duration cells use the 12 px text size', () => {
  const source = read('src/components/visits/VisitsTable.tsx')
  assert.match(
    source,
    /className="text-xs text-muted">\s*\{formatVisitDuration\(/,
  )
})

test('company and project share one column in the visits and log tables', () => {
  const visits = read('src/components/visits/VisitsTable.tsx')
  assert.match(visits, /header: t\('logsColWhere'\)/)
  assert.match(visits, /<CompanyProjectCell row=\{visit\} \/>/)
  assert.doesNotMatch(visits, /key: 'company_name'|key: 'project_name'/)
  assert.doesNotMatch(visits, /header: t\('(company|project)'\)/)

  const logs = read('src/screens/admin-home/LogsScreen.tsx')
  assert.match(logs, /header: t\('logsColWhere'\)/)
  assert.match(logs, /<CompanyProjectCell row=\{row\} \/>/)
  assert.doesNotMatch(logs, /join\(' · '\)/)

  const translations = read('src/i18n/translations.ts')
  assert.match(translations, /logsColWhere: 'الشركة \/ المشروع'/)
  assert.match(translations, /logsColWhere: 'Company \/ project'/)
})

test('the company / project cell keeps the 44 px rows', () => {
  const source = read('src/components/data-list/CompanyProjectCell.tsx')
  // Project: smaller and lighter, tokens only.
  assert.match(source, /className="truncate-safe text-xs text-muted"/)
  assert.doesNotMatch(
    source,
    /(gray|slate|zinc|neutral|emerald)-\d|#[0-9a-f]{3,6}\b/i,
  )
  assert.doesNotMatch(source, /tracking-|uppercase/)
  // Long names are cut, with the full name in the tooltip.
  assert.match(source, /title=\{primary\}/)
  assert.match(source, /title=\{secondary\}/)
  assert.match(source, /max-w-\[14rem\]/)
  // `truncate-safe` is line-height 1.5: 14 px and 12 px text are 21 + 18 =
  // 39 px, under both the 44 px visits rows and the 40 px log rows.
  const css = read('src/index.css')
  assert.match(css, /\.truncate-safe \{[^}]*line-height: 1\.5;/)
  assert.ok(14 * 1.5 + 12 * 1.5 <= 40)
  // The row cells have no vertical padding that could push a row past it.
  const table = read('src/components/ui/DataTable.tsx')
  assert.match(
    table,
    /lg: \{ header: 'h-11', row: 'h-11', cell: 'px-3 text-sm' \}/,
  )
  assert.match(
    table,
    /md: \{ header: 'h-10 md:h-9', row: 'h-11 md:h-10', cell: 'px-3 text-sm' \}/,
  )
})

test('the visits Excel export keeps company and project in separate columns', () => {
  // wave-15-export-fields: each one in Arabic and in English.
  const source = read('src/lib/visitsList.ts')
  for (const key of [
    'companyNameAr',
    'companyNameEn',
    'projectNameAr',
    'projectNameEn',
  ])
    assert.match(source, new RegExp(`header: t\\('${key}'\\),`))
})

test('/logs opens on visits and keeps the log behind ?view=log', () => {
  const source = read('src/screens/admin-home/LogsScreen.tsx')
  assert.match(source, /const VIEWS: LogsView\[\] = \['visits', 'log'\]/)
  assert.match(source, /hasLogState\(params\) \? 'log' : 'visits'/)
  assert.match(source, /t\('movementsLogsTab'\)/)
  // Deep links that carry log filters/search without a view keep the log.
  assert.match(source, /const LOG_STATE_KEYS = \['q', 'filters',/)
})

test('the /logs tab label has Arabic and English values', () => {
  const source = read('src/i18n/translations.ts')
  assert.match(source, /movementsLogsTab: 'السجلات'/)
  assert.match(source, /movementsLogsTab: 'Logs'/)
  // The home keeps its own «السجل» label.
  assert.match(source, /movementsLogTab: 'السجل'/)
})
