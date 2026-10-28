// Master-data screens follow their write keys (2026-10-28).
//
// The drivers, companies, projects and lessors pages open on the *.read keys,
// but their writes are PostgREST calls whose row policies (0127) test the
// write keys. A refused UPDATE / DELETE matches no row and PostgREST answers
// with no error, so (1) the buttons follow the write keys through the pure
// decisions of src/lib/actionPermissions.ts and (2) every write reads its
// returned rows (`.select(`) and treats none as a refusal (`refusedByPolicy`).
//
// With the frozen legacy mapping, every original role sees exactly what it
// saw before: the pages were the admin's, and everybody who opened them saw
// every button.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

function loadLib(name) {
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(
    code,
    {
      exports,
      require(request) {
        throw new Error(`Unexpected runtime import: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const actions = loadLib('actionPermissions')
const nav = loadLib('navPermissions')

// --- The frozen legacy mapping and the 0126 catalogue -----------------------

const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const migrationTexts = fs
  .readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => read('supabase', 'migrations', name))

function legacyMapping() {
  let body = null
  for (const sql of migrationTexts) {
    const re =
      /CREATE OR REPLACE FUNCTION public\.legacy_role_permissions\(p_role text\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g
    for (const match of sql.matchAll(re)) body = match[1]
  }
  assert.ok(body, 'legacy_role_permissions is defined')
  const mapping = new Map()
  for (const [, role, key, , scope] of body.matchAll(
    /\('(\w+)', '([\w.]+)', (NULL|'(\w+)')\)/g,
  )) {
    if (!mapping.has(role)) mapping.set(role, new Map())
    mapping.get(role).set(key, scope ?? 'all')
  }
  return mapping
}

function seededRole(roleKey) {
  const sql = read(
    'supabase',
    'migrations',
    '20261011130000_0126_roles_and_permissions.sql',
  )
  const map = new Map()
  const re = new RegExp(`\\('${roleKey}', '([\\w.]+)', (NULL|'(\\w+)')\\)`, 'g')
  for (const [, key, , scope] of sql.matchAll(re)) map.set(key, scope ?? 'all')
  return map
}

const LEGACY = legacyMapping()
const ROLES = [
  'admin',
  'supervisor',
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
  'monitor',
]
const ready = (entries) => ({
  status: 'ready',
  permissions: entries instanceof Map ? entries : new Map(entries),
})
const keys = (...names) => ready(names.map((name) => [name, 'all']))

const ALL_DRIVERS = { create: true, edit: true, remove: true, importRows: true }
const NO_DRIVERS = {
  create: false,
  edit: false,
  remove: false,
  importRows: false,
}

// --- The keys are the row policies' keys -------------------------------------

test('the decisions read the keys the 0127 row policies test', () => {
  const sql = read(
    'supabase',
    'migrations',
    '20261011140000_0127_permission_keys_in_policies.sql',
  )
  const policyKey = (name, table) => {
    const match = sql.match(
      new RegExp(
        `CREATE POLICY ${name} ON public\\.${table}\\n[\\s\\S]*?has_permission\\('([\\w.]+)'\\)`,
      ),
    )
    assert.ok(match, `${name} on ${table}`)
    return match[1]
  }
  assert.equal(policyKey('insert_drivers', 'drivers'), 'drivers.create')
  assert.equal(policyKey('update_drivers', 'drivers'), 'drivers.edit')
  assert.equal(policyKey('delete_drivers', 'drivers'), 'drivers.delete')
  for (const table of ['companies', 'projects', 'company_projects'])
    for (const op of ['insert', 'update', 'delete'])
      assert.equal(
        policyKey(`${op}_${table}`, table),
        'companies_projects.edit',
        `${op}_${table}`,
      )
  for (const op of ['insert', 'update', 'delete'])
    assert.equal(policyKey(`${op}_lessors`, 'lessors'), 'lessors.edit')
  // No later migration re-creates these write policies.
  const later = migrationTexts.slice(
    migrationTexts.findIndex((text) => text === sql) + 1,
  )
  for (const text of later)
    assert.doesNotMatch(
      text,
      /CREATE POLICY (insert|update|delete)_(drivers|companies|projects|company_projects|lessors) /,
    )
})

// --- Ready with the legacy mapping: what each role saw before ---------------

for (const role of ROLES) {
  test(`${role}: the master-data buttons are unchanged`, () => {
    const permissions = LEGACY.get(role) ?? new Map()
    const state = ready(permissions)
    // Before: whoever opened the page saw every button.
    const drivers = nav.canOpenPage(permissions, 'drivers')
    assert.deepEqual(
      plain(actions.driversActions(state)),
      drivers ? ALL_DRIVERS : NO_DRIVERS,
    )
    assert.equal(
      actions.companiesProjectsActions(state).edit,
      nav.canOpenPage(permissions, 'companies'),
    )
    assert.equal(
      actions.companiesProjectsActions(state).edit,
      nav.canOpenPage(permissions, 'projects'),
    )
    assert.equal(
      actions.lessorsActions(state).edit,
      nav.canOpenPage(permissions, 'lessors'),
    )
    // Those pages were the admin's alone.
    assert.equal(drivers, role === 'admin')
  })
}

test('the admin keeps every button', () => {
  const state = ready(LEGACY.get('admin'))
  assert.deepEqual(plain(actions.driversActions(state)), ALL_DRIVERS)
  assert.equal(actions.companiesProjectsActions(state).edit, true)
  assert.equal(actions.lessorsActions(state).edit, true)
})

test('while loading or after a failed load nothing is offered', () => {
  const full = LEGACY.get('admin')
  for (const state of [
    { status: 'loading', permissions: new Map() },
    { status: 'error', permissions: new Map() },
    { status: 'loading', permissions: full },
    { status: 'error', permissions: full },
  ]) {
    assert.deepEqual(plain(actions.driversActions(state)), NO_DRIVERS)
    assert.equal(actions.companiesProjectsActions(state).edit, false)
    assert.equal(actions.lessorsActions(state).edit, false)
  }
})

test('the read keys alone offer no write', () => {
  const readers = keys(
    'drivers.read',
    'companies_projects.read',
    'lessors.read',
  )
  assert.deepEqual(plain(actions.driversActions(readers)), NO_DRIVERS)
  assert.equal(actions.companiesProjectsActions(readers).edit, false)
  assert.equal(actions.lessorsActions(readers).edit, false)
})

test('each driver button follows its own key', () => {
  assert.deepEqual(
    plain(actions.driversActions(keys('drivers.read', 'drivers.edit'))),
    { ...NO_DRIVERS, edit: true },
  )
  assert.deepEqual(plain(actions.driversActions(keys('drivers.delete'))), {
    ...NO_DRIVERS,
    remove: true,
  })
  assert.deepEqual(plain(actions.driversActions(keys('drivers.create'))), {
    ...NO_DRIVERS,
    create: true,
  })
  // The import inserts: it needs the insert policy's key too.
  assert.equal(actions.driversActions(keys('drivers.import')).importRows, false)
  assert.equal(
    actions.driversActions(keys('drivers.import', 'drivers.create')).importRows,
    true,
  )
})

test('the seeded custom roles get the buttons of their keys', () => {
  // purchasing (0126): reads suppliers and manages them, nothing else here.
  const purchasing = ready(seededRole('purchasing'))
  assert.equal(actions.lessorsActions(purchasing).edit, true)
  assert.equal(actions.companiesProjectsActions(purchasing).edit, false)
  assert.deepEqual(plain(actions.driversActions(purchasing)), NO_DRIVERS)
  // equipment_officer (0126): master data without deleting drivers.
  const officer = seededRole('equipment_officer')
  assert.ok(officer.size > 5, 'the seed rows are parsed')
  const state = ready(officer)
  assert.deepEqual(plain(actions.driversActions(state)), {
    create: officer.has('drivers.create'),
    edit: officer.has('drivers.edit'),
    remove: officer.has('drivers.delete'),
    importRows: officer.has('drivers.import') && officer.has('drivers.create'),
  })
  assert.equal(actions.companiesProjectsActions(state).edit, true)
  assert.equal(actions.lessorsActions(state).edit, true)
})

test('refusedByPolicy: 42501 or no returned row is a refusal', () => {
  assert.equal(actions.refusedByPolicy(null, []), true)
  assert.equal(actions.refusedByPolicy(null, null), true)
  assert.equal(actions.refusedByPolicy(undefined, undefined), true)
  assert.equal(actions.refusedByPolicy(null, [{ id: 'a' }]), false)
  assert.equal(actions.refusedByPolicy({ code: '42501' }, null), true)
  // Other errors stay the caller's (duplicate, foreign key, ...).
  assert.equal(actions.refusedByPolicy({ code: '23505' }, null), false)
  assert.equal(actions.refusedByPolicy({ code: '23503' }, null), false)
})

// --- Sources -----------------------------------------------------------------

const TABLES = [
  'drivers',
  'companies',
  'projects',
  'company_projects',
  'lessors',
]
const WRITERS = [
  'src/screens/drivers/DriversListScreen.tsx',
  'src/screens/drivers/DriverFormDialog.tsx',
  'src/components/DriverExcelImport.tsx',
  'src/screens/companies/CompaniesListScreen.tsx',
  'src/screens/companies/CompanyFormDialog.tsx',
  'src/screens/companies/CompanyProjectsDialog.tsx',
  'src/screens/companies/CompanyImportDialog.tsx',
  'src/screens/projects/ProjectsListScreen.tsx',
  'src/screens/projects/ProjectFormDialog.tsx',
  'src/screens/projects/ProjectImportDialog.tsx',
  'src/screens/lessors/LessorsListScreen.tsx',
  'src/screens/lessors/LessorFormDialog.tsx',
]

/** Every `.from('<table>')` chain that writes, up to its `await`ed end. */
function writeChains(source) {
  const chains = []
  const re = new RegExp(
    `\\.from\\('(${TABLES.join('|')})'\\)((?:\\s*\\.[a-zA-Z]+\\((?:[^()]|\\([^()]*\\))*\\))+)`,
    'g',
  )
  for (const [, table, chain] of source.matchAll(re))
    if (/\.(insert|update|delete|upsert)\(/.test(chain))
      chains.push({ table, chain })
  return chains
}

test('every master-data write reads its rows back and checks the refusal', () => {
  let count = 0
  for (const file of WRITERS) {
    const source = read(...file.split('/'))
    const chains = writeChains(source)
    assert.ok(chains.length > 0, `${file} writes`)
    for (const { table, chain } of chains) {
      count++
      assert.match(chain, /\.select\('id'\)/, `${file}: ${table}${chain}`)
    }
    assert.match(
      source,
      /import \{[^}]*\brefusedByPolicy\b[^}]*\} from '@\/lib\/actionPermissions'/,
      file,
    )
    assert.equal(
      (source.match(/refusedByPolicy\(/g) ?? []).length,
      // Each write's result is checked once (a ternary insert/update shares
      // one result).
      (source.match(/const result = \w+\s*\?/g) ?? []).length
        ? chains.length - 1
        : chains.length,
      file,
    )
  }
  assert.equal(count, 18)
})

test('no other screen writes these tables directly', () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) {
        const rel = path.relative(ROOT, full).split(path.sep).join('/')
        if (WRITERS.includes(rel)) continue
        if (writeChains(read(...rel.split('/'))).length) offenders.push(rel)
      }
    }
  }
  walk(path.join(ROOT, 'src'))
  assert.deepEqual(offenders, [])
})

const GATES = {
  'src/screens/drivers/DriversListScreen.tsx': [
    /const actions = driversActions\(usePermissions\(\)\)/,
    /const addButton = actions\.create \?/,
    /menuActions=\{\s*actions\.importRows \?/,
    /selectedCount=\{actions\.remove \? selection\.selected\.size : 0\}/,
    /bulkActions=\{\s*actions\.remove \?/,
    /onEdit=\{actions\.edit \? openEdit : undefined\}/,
    /onDelete=\{actions\.remove \? remove : undefined\}/,
    /open=\{importOpen && actions\.importRows\}/,
  ],
  'src/screens/drivers/DriversTable.tsx': [
    /onEdit\?: \(driver: Driver\) => void/,
    /onDelete\?: \(driver: Driver\) => void/,
    /\{onEdit && \(/,
    /\{onDelete && \(/,
    /const selectColumn: DataTableColumn<Driver>\[\] = onDelete/,
  ],
  'src/screens/drivers/DriverFormDialog.tsx': [
    /const canSave = driver \? actions\.edit : actions\.create/,
    /\{canSave && \(/,
  ],
  'src/components/DriverExcelImport.tsx': [
    /const canImport = driversActions\(usePermissions\(\)\)\.importRows/,
    /\{canImport && \(/,
  ],
  'src/screens/companies/CompaniesListScreen.tsx': [
    /const canEdit = companiesProjectsActions\(usePermissions\(\)\)\.edit/,
    /const addButton = canEdit \?/,
    /\{canEdit && \(\s*<Button[\s\S]*?setImportOpen\(true\)/,
    /onEdit=\{canEdit \? openEdit : undefined\}/,
    /onDelete=\{canEdit \? remove : undefined\}/,
    /open=\{importOpen && canEdit\}/,
  ],
  'src/screens/companies/CompanyFormDialog.tsx': [
    /const canSave = companiesProjectsActions\(usePermissions\(\)\)\.edit/,
    /\{canSave && \(/,
  ],
  'src/screens/companies/CompanyProjectsDialog.tsx': [
    /const canEdit = companiesProjectsActions\(usePermissions\(\)\)\.edit/,
    /\{canEdit && \(\s*<button\s+onClick=\{\(\) => removeLink/,
    /\{canEdit && \(\s*<div[\s\S]*?addProjectLink/,
  ],
  'src/screens/projects/ProjectsListScreen.tsx': [
    /const canEdit = companiesProjectsActions\(usePermissions\(\)\)\.edit/,
    /const addButton = canEdit \?/,
    /menuActions=\{\s*canEdit \?/,
    /onEdit=\{canEdit \? openEdit : undefined\}/,
    /onDelete=\{canEdit \? remove : undefined\}/,
    /open=\{importOpen && canEdit\}/,
  ],
  'src/screens/projects/ProjectFormDialog.tsx': [
    /const canSave = companiesProjectsActions\(usePermissions\(\)\)\.edit/,
    /\{canSave && \(/,
  ],
  'src/screens/lessors/LessorsListScreen.tsx': [
    /const canEdit = lessorsActions\(usePermissions\(\)\)\.edit/,
    /const addButton = canEdit \?/,
    /onEdit=\{canEdit \? openEdit : undefined\}/,
    /onDelete=\{canEdit \? remove : undefined\}/,
  ],
  'src/screens/lessors/LessorFormDialog.tsx': [
    /const canSave = lessorsActions\(usePermissions\(\)\)\.edit/,
    /\{canSave && \(/,
  ],
}

for (const table of ['CompaniesTable', 'ProjectsTable', 'LessorsTable']) {
  const dir = { CompaniesTable: 'companies', ProjectsTable: 'projects' }[table]
  GATES[`src/screens/${dir ?? 'lessors'}/${table}.tsx`] = [
    /onEdit\?: \(\w+: \w+\) => void/,
    /onDelete\?: \(\w+: \w+\) => void/,
    /\{onEdit && \(/,
    /\{onDelete && \(/,
  ]
}

test('every add / edit / delete / import control is gated', () => {
  for (const [file, patterns] of Object.entries(GATES)) {
    const source = read(...file.split('/'))
    for (const pattern of patterns) assert.match(source, pattern, file)
    assert.doesNotMatch(source, /profile\??\.role\b/, file)
  }
})

test('the refusal copy exists in Arabic and English, without hamza', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...source.matchAll(
      /\/\/ master-data-save-refused — start\n([\s\S]*?)\/\/ master-data-save-refused — end/g,
    ),
  ].map((match) => match[1])
  assert.equal(blocks.length, 2)
  const blockKeys = (block) =>
    [...block.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]).sort()
  assert.deepEqual(blockKeys(blocks[0]), blockKeys(blocks[1]))
  assert.doesNotMatch(blocks[0], /[أإآ]/)
  // Every key a screen uses is in the block.
  const used = new Set()
  for (const file of WRITERS)
    for (const [, key] of read(...file.split('/')).matchAll(
      /'(\w+NotAllowed)'/g,
    ))
      used.add(key)
  assert.ok(used.size >= 9, `${used.size} keys`)
  for (const key of used) assert.ok(blockKeys(blocks[0]).includes(key), key)
})
