// Wave 21: the workshop manager and the assistant workshop manager read every
// movement and visit (projects and workshop) on their home, through the admin
// log embedded with its context tabs, filter dialog and export. Pure and regex
// checks only, like the rest of the suite: no database is reached.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

/** Loads a dependency-free src/lib module. */
function loadLibModule(name) {
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const scope = loadLibModule('homeScope')

const MANAGERS = ['workshop_manager', 'assistant_workshop_manager']

// ---------------------------------------------------------------------------
// Role gating
// ---------------------------------------------------------------------------

// Roles stage 4a: the home list follows the home.* permission only (the
// two workshop managers hold home.workshop scope all in the legacy mapping,
// the workshop role scope workshop; tests/wave23Shell.test.cjs proves the
// six roles); the role variant is gone.
const ready = (entries) => ({ status: 'ready', permissions: new Map(entries) })

test('only home.workshop scope all gets the all-contexts home', () => {
  assert.equal(MANAGERS.length, 2)
  assert.equal(scope.homeMovementsScope, undefined)
  const resolve = scope.resolveHomeMovementsScope
  assert.equal(resolve(ready([['home.workshop', 'all']])), 'all_contexts')
  assert.equal(resolve(ready([['home.workshop', 'workshop']])), 'workshop')
  assert.equal(resolve(ready([['home.foreman', 'own']])), 'own_site')
  // home.foreman wins over home.workshop (planShell's precedence).
  assert.equal(
    resolve(
      ready([
        ['home.foreman', 'all'],
        ['home.workshop', 'all'],
      ]),
    ),
    'own_site',
  )
})

test('no home key, loading or a failed load fails closed onto the narrowest list', () => {
  const resolve = scope.resolveHomeMovementsScope
  assert.equal(resolve(ready([])), 'own_site')
  assert.equal(resolve(ready([['home.admin', 'all']])), 'own_site')
  for (const status of ['loading', 'error'])
    assert.equal(
      resolve({ status, permissions: new Map([['home.workshop', 'all']]) }),
      'own_site',
      status,
    )
})

test('the all-contexts home opens on the workshop tab', () => {
  assert.equal(scope.ALL_CONTEXTS_HOME_DEFAULT_TAB, 'workshop')
})

// ---------------------------------------------------------------------------
// Home screen
// ---------------------------------------------------------------------------

test('the home picks its list through homeMovementsScope', () => {
  const home = read('src', 'screens', 'HomeScreen.tsx')
  // wave 23: App.tsx passes the scope derived from the home.* permission;
  // wave 24: without the prop the home resolves it itself, from the same
  // permissions once ready, the narrowest list meanwhile (roles stage 4a).
  assert.match(
    home,
    /const scope = movementsScope \?\? resolveHomeMovementsScope\(permissionState\)/,
  )
  assert.match(home, /const managerMode = scope === 'all_contexts'/)
  assert.match(
    home,
    /const workshopMode = scope === 'workshop' \|\| managerMode/,
  )
  // No role string is compared directly any more.
  assert.doesNotMatch(home, /profile\?\.role === '/)
})

test('the managers get the embedded admin log, opening on the workshop', () => {
  const home = read('src', 'screens', 'HomeScreen.tsx')
  const managers = home.match(
    /scope === 'all_contexts' \|\| scope === 'site_all' \? \(([\s\S]*?)\) : \(\s*<HomeMovementsCard([\s\S]*?)\/>/,
  )
  assert.ok(managers, 'one branch per scope')
  const [, logBranch, homeBranch] = managers
  assert.match(logBranch, /<LogsScreen\s/)
  assert.match(logBranch, /\bembedded\b/)
  assert.match(
    logBranch,
    /defaultContext=\{\s*scope === 'site_all' \? 'site' : ALL_CONTEXTS_HOME_DEFAULT_TAB\s*\}/,
  )
  // wave 24: the classification follows movements.workshop.classify.
  assert.match(logBranch, /classify=\{canClassify \? classify : undefined\}/)
  assert.match(logBranch, /refreshToken=\{refreshToken\}/)
  assert.match(logBranch, /t\('homeAllMovementsTitle'\)/)
  // The plain workshop role and the foreman keep their own card, which does
  // not classify for them (the managers classify on the embedded log); since
  // wave 24 it follows the classify key, which neither of them holds.
  assert.match(homeBranch, /workshopMode=\{workshopMode\}/)
  assert.match(homeBranch, /canClassify=\{canClassify\}/)
  // Classification still goes through the database function.
  assert.match(home, /supabase\.rpc\('classify_workshop_entry'/)
  // The stat cards stay the workshop's.
  assert.match(home, /'get_workshop_home_stats'/)
})

test('the plain workshop home keeps its workshop-only list', () => {
  const card = read('src', 'components', 'home', 'HomeMovementsCard.tsx')
  assert.match(
    card,
    /\.eq\('movement_context', workshopMode \? 'workshop' : 'site'\)/,
  )
  const visits = read('src', 'components', 'home', 'HomeVisitsCard.tsx')
  assert.match(visits, /context=\{workshopMode \? 'workshop' : 'site'\}/)
})

// ---------------------------------------------------------------------------
// The admin log, reused
// ---------------------------------------------------------------------------

test('/logs keeps opening on the projects tab for admin and monitor', () => {
  const logs = read('src', 'screens', 'admin-home', 'LogsScreen.tsx')
  assert.match(logs, /defaultContext = 'site',/)
  assert.match(
    logs,
    /isLogsTab\(requestedTab\) \? requestedTab : defaultContext/,
  )
  // The default tab is the one left out of the URL.
  assert.match(
    logs,
    /if \(next === defaultContext\) query\.delete\('context'\)/,
  )
  assert.match(logs, /const TABS: LogsTab\[\] = \['site', 'workshop', 'all'\]/)
  // The admin-shell route (the admin and monitor roles and, since 2026-10-13,
  // anyone whose sections include the log) passes none of the embedding props.
  const app = read('src', 'App.tsx')
  const routes = app.match(/<LogsScreen[^>]*\/>/g)
  assert.ok(routes && routes.length >= 1)
  for (const route of routes)
    assert.equal(route, '<LogsScreen onSelectMovement={openMovement} />')
})

test('the embedded log keeps the admin filters, visits view and export', () => {
  const logs = read('src', 'screens', 'admin-home', 'LogsScreen.tsx')
  assert.match(logs, /\{!embedded && \(\s*<PageHeader title=\{t\('logs'\)\}/)
  assert.match(logs, /config=\{logsListConfig\}/)
  assert.match(logs, /filterFields=\{logsListConfig\.filterFields\}/)
  assert.match(logs, /<ExportDialog<MovementExportRow>/)
  // The visits view is the admin variant (adminVisitsListConfig, export).
  assert.match(logs, /<VisitsTable\s+variant="log"\s+context=\{tab\}/)
  assert.match(logs, /refreshToken=\{refreshToken\}/)
  assert.match(logs, /\}, \[fetchLogs, view, refreshToken\]\)/)
})

test('classification is offered only on the workshop tab, on entries', () => {
  const logs = read('src', 'screens', 'admin-home', 'LogsScreen.tsx')
  assert.match(
    logs,
    /classifyColumn && tab === 'workshop' \? classifyColumn : contextColumn/,
  )
  assert.match(
    logs,
    /const classifyColumn: DataTableColumn<LogRow> \| null = classify/,
  )
  assert.match(logs, /row\.movement_type === 'entry' \? \(\s*<Select/)
  assert.match(logs, /options=\{WORKSHOP_PURPOSES\.map/)
})

// ---------------------------------------------------------------------------
// The database already grants the read (migration 0098); nothing narrows it
// ---------------------------------------------------------------------------

/** Every migration, oldest first, with the definitions it contains. */
const MIGRATION_FILES = fs
  .readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()

/** The last migration whose text matches `pattern`. */
function latest(pattern) {
  let found = null
  for (const file of MIGRATION_FILES) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
    if (pattern.test(sql)) found = { file, sql }
  }
  assert.ok(found, `a migration matches ${pattern}`)
  return found
}

/** The statement starting at the first match of `start`, up to `end`. */
function statement(sql, start, end = /;\s*$/m) {
  const at = sql.search(start)
  assert.ok(at >= 0, `statement ${start}`)
  const rest = sql.slice(at)
  const stop = rest.search(end)
  return stop >= 0 ? rest.slice(0, stop + 1) : rest
}

/**
 * wave 22A (0127) moved the read rule from role names to the permission key
 * movements.read: the managers still read every context because the frozen
 * legacy mapping (0126) gives them the scope 'all'.
 */
function legacyScope(role, key) {
  const { sql } = latest(/FUNCTION public\.legacy_role_permissions\(/)
  const row = new RegExp(
    `\\('${role}', '${key.replace(/\./g, '\\.')}', (NULL|'(\\w+)')\\)`,
  ).exec(sql)
  return row ? (row[2] ?? 'all') : null
}

test('movements: every workshop role reads both contexts (0098, keys since 0127)', () => {
  const { file, sql } = latest(
    /CREATE POLICY "?select_entry_exit_logs"? ON public\.entry_exit_logs/,
  )
  const policy = statement(
    sql,
    /CREATE POLICY "?select_entry_exit_logs"?/,
    /\);\s*$/m,
  )
  if (/_0098_/.test(file)) {
    for (const role of MANAGERS) assert.match(policy, new RegExp(`'${role}'`))
    assert.doesNotMatch(policy, /movement_context/)
  } else {
    // 0145 restores the 0127 policy verbatim (after 0143's company rule).
    assert.match(file, /_0127_|_0145_/)
    assert.match(
      policy,
      /CASE \(SELECT public\.permission_scope\('movements\.read'\)\)\s+WHEN 'all' THEN true/,
    )
    for (const role of MANAGERS)
      assert.equal(legacyScope(role, 'movements.read'), 'all', role)
  }
})

test('movement detail and photos follow can_access_movement (0098, keys since 0127)', () => {
  const { file, sql } = latest(
    /CREATE OR REPLACE FUNCTION public\.can_access_movement\(/,
  )
  const fn = statement(
    sql,
    /CREATE OR REPLACE FUNCTION public\.can_access_movement\(/,
    /\$\$;/,
  )
  if (/_0098_/.test(file)) {
    for (const role of MANAGERS) assert.match(fn, new RegExp(`'${role}'`))
    assert.doesNotMatch(fn, /movement_context/)
  } else {
    assert.match(file, /_0127_/)
    assert.match(
      fn,
      /public\.movement_scope_allows\(\s+public\.permission_scope\('movements\.read'\)/,
    )
    for (const role of MANAGERS)
      assert.equal(legacyScope(role, 'movements.read'), 'all', role)
  }

  // Photo rows, driver changes and the Storage read all delegate to it.
  const photos = latest(/CREATE POLICY "select_entry_exit_photos"/)
  assert.match(
    statement(photos.sql, /CREATE POLICY "select_entry_exit_photos"/),
    /public\.can_access_movement\(entry_exit_log_id\)/,
  )
  const changes = latest(/CREATE POLICY select_movement_driver_changes/)
  assert.match(
    statement(changes.sql, /CREATE POLICY select_movement_driver_changes/),
    /public\.can_access_movement\(entry_log_id\)/,
  )
  const storage = latest(/CREATE POLICY select_log_photos ON storage\.objects/)
  const storagePolicy = statement(
    storage.sql,
    /CREATE POLICY select_log_photos ON storage\.objects/,
    /^\);\s*$/m,
  )
  assert.match(
    storagePolicy,
    /public\.can_access_movement\(photo\.entry_exit_log_id\)/,
  )
  assert.match(storagePolicy, /public\.can_access_movement\(movement\.id\)/)
})

test('the log and visits views stay security invoker', () => {
  const log = latest(/CREATE OR REPLACE VIEW public\.movement_log_search/)
  assert.match(
    statement(
      log.sql,
      /CREATE OR REPLACE VIEW public\.movement_log_search/,
      /\bAS\b/,
    ),
    /security_invoker = true/,
  )
  const visits = latest(/CREATE OR REPLACE VIEW public\.movement_visits/)
  assert.match(
    statement(
      visits.sql,
      /CREATE OR REPLACE VIEW public\.movement_visits/,
      /\bAS\b/,
    ),
    /security_invoker = true/,
  )
})

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

test('the wave-21 copy exists in Arabic and English without hamza forms', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = source.match(
    /\/\/ wave-21-workshop-scope — start([\s\S]*?)\/\/ wave-21-workshop-scope — end/g,
  )
  assert.equal(blocks?.length, 2)
  assert.match(blocks[0], /homeAllMovementsTitle: 'الحركات'/)
  assert.match(blocks[1], /homeAllMovementsTitle: 'Movements'/)
  for (const block of blocks) assert.doesNotMatch(block, /[أإآ]/)
})
