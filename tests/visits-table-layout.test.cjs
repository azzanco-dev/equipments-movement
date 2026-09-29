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
