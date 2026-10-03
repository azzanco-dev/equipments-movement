// Wave 11 search fixes: EM-113 (Arabic normalisation), EM-116 (placeholders
// that match the search), EM-117 (workshop chassis search), EM-119 (a list's
// `searchFields` is its search) and EM-122 (indexes). Pure and regex checks
// only, like the rest of the suite: no database is reached.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const migration = (number) => {
  const name = fs
    .readdirSync(MIGRATIONS)
    .find((file) => file.includes(`_${number}_`))
  assert.ok(name, `migration ${number} exists`)
  return fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
}

/**
 * Loads a source module, resolving `@/...` and relative imports to the real
 * files. Anything outside `src` is stubbed: only module-level data and pure
 * helpers are exercised here.
 */
function loadModule(file, cache = new Map()) {
  const resolved = resolveFile(file)
  if (cache.has(resolved)) return cache.get(resolved)
  const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const exports = {}
  cache.set(resolved, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      React: { createElement: () => null },
      require(request) {
        if (request.startsWith('@/'))
          return loadModule(path.join(ROOT, 'src', request.slice(2)), cache)
        if (request.startsWith('.'))
          return loadModule(path.join(path.dirname(resolved), request), cache)
        return new Proxy({}, { get: () => () => null, apply: () => null })
      },
    },
    { filename: resolved },
  )
  return exports
}

function resolveFile(file) {
  for (const candidate of [file, `${file}.ts`, `${file}.tsx`])
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate
  throw new Error(`Unresolved module: ${file}`)
}

const lib = (name) => loadModule(path.join(ROOT, 'src', 'lib', `${name}.ts`))
const search = lib('search')
const { normalizeSearchText, buildSearchFilter } = search
const { buildMovementSearchFilter } = lib('movementLogSearch')
const visits = lib('visitsList')
const configs = lib('listConfigs')
const { resolveListLabel } = loadModule(
  path.join(ROOT, 'src', 'components', 'data-list', 'labels.ts'),
)

const SQL = migration('0116')

/** The columns of a PostgREST `or(...)` filter, in order. */
const columnsOf = (filter) =>
  filter.split(',').map((part) => part.slice(0, part.indexOf('.ilike.')))
/** The pattern given to one column. */
const valueOf = (filter, column) => {
  const part = filter.split(',').find((item) => item.startsWith(`${column}.`))
  return part && part.slice(part.indexOf('.ilike.') + '.ilike.'.length)
}

// ---------------------------------------------------------------------------
// EM-113: the normaliser
// ---------------------------------------------------------------------------

test('hamza and madda alif, alif maqsura, teh marbuta and digits fold', () => {
  const cases = [
    ['\u0623\u062d\u0645\u062f', '\u0627\u062d\u0645\u062f'], // أحمد -> احمد
    [
      '\u0625\u0628\u0631\u0627\u0647\u064a\u0645',
      '\u0627\u0628\u0631\u0627\u0647\u064a\u0645',
    ],
    ['\u0622\u0645\u0646\u0629', '\u0627\u0645\u0646\u0647'], // آمنة -> امنه
    ['\u0645\u0635\u0637\u0641\u0649', '\u0645\u0635\u0637\u0641\u064a'], // ى -> ي
    ['\u0634\u0631\u0643\u0629', '\u0634\u0631\u0643\u0647'], // شركة -> شركه
    ['\u0661\u0662\u0663', '123'],
    ['\u06f4\u06f5', '45'],
  ]
  for (const [input, expected] of cases)
    assert.equal(normalizeSearchText(input), expected, input)
})

test('tatweel and harakat are removed; case and spaces are canonical', () => {
  // محـــمد and مُحَمَّد both become محمد.
  assert.equal(
    normalizeSearchText('\u0645\u062d\u0640\u0640\u0640\u0645\u062f'),
    '\u0645\u062d\u0645\u062f',
  )
  assert.equal(
    normalizeSearchText('\u0645\u064f\u062d\u064e\u0645\u0651\u064e\u062f'),
    '\u0645\u062d\u0645\u062f',
  )
  assert.equal(normalizeSearchText('  ABC   Def '), 'abc def')
  assert.equal(normalizeSearchText(''), '')
})

test('hamza on waw and yeh is not folded (owner rule)', () => {
  assert.equal(normalizeSearchText('\u0624'), '\u0624')
  assert.equal(normalizeSearchText('\u0626'), '\u0626')
})

/** Decodes a PostgreSQL U&'...' literal with \XXXX escapes only. */
function decodeUnicodeLiteral(body) {
  assert.match(body, /^(\\[0-9A-Fa-f]{4})+$/)
  return Array.from(body.matchAll(/\\([0-9A-Fa-f]{4})/g), (match) =>
    String.fromCharCode(parseInt(match[1], 16)),
  )
}

test('the TypeScript normaliser mirrors normalize_search_text exactly', () => {
  const fn = SQL.slice(
    SQL.indexOf('CREATE OR REPLACE FUNCTION public.normalize_search_text'),
  )
  const body = fn.slice(0, fn.indexOf(');\n') + 3)
  const literals = Array.from(body.matchAll(/U&'([^']*)'/g), (m) => m[1])
  assert.equal(literals.length, 2, 'translate(value, FROM, TO)')
  const from = decodeUnicodeLiteral(literals[0])
  const to = decodeUnicodeLiteral(literals[1])
  assert.ok(to.length < from.length)

  // The same steps, in the same order, as the TypeScript mirror.
  assert.match(
    body,
    /pg_catalog\.btrim\(\s*pg_catalog\.regexp_replace\(\s*pg_catalog\.lower\(\s*pg_catalog\.translate\(/,
  )
  assert.match(body, /'\\s\+',\s*' ',\s*'g'/)
  assert.match(body, /IMMUTABLE\s+PARALLEL SAFE\s+RETURN /)
  assert.doesNotMatch(body, /SET search_path|SECURITY DEFINER/)

  // Every character of the Arabic block behaves the same on both sides.
  const sqlFold = new Map(
    from.map((character, index) => [character, to[index] ?? '']),
  )
  for (let code = 0x0600; code <= 0x06ff; code += 1) {
    const character = String.fromCharCode(code)
    const expected = sqlFold.has(character) ? sqlFold.get(character) : character
    assert.equal(
      normalizeSearchText(`x${character}y`),
      `x${expected}y`.toLowerCase(),
      `U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
    )
  }
})

// ---------------------------------------------------------------------------
// EM-113: the shared filter builder
// ---------------------------------------------------------------------------

test('normalised columns get the normalised term, the rest the term as typed', () => {
  const filter = buildSearchFilter(
    ['full_name_search', 'name_en', 'mobile_number'],
    '\u0623\u062d\u0645\u062f',
  )
  assert.equal(
    valueOf(filter, 'full_name_search'),
    '%\u0627\u062d\u0645\u062f%',
  )
  assert.equal(valueOf(filter, 'name_en'), '%\u0623\u062d\u0645\u062f%')
  // Arabic-Indic digits reach every column as ASCII.
  const digits = buildSearchFilter(
    ['mobile_number', 'name_search'],
    '\u0660\u0665\u0665',
  )
  assert.equal(valueOf(digits, 'mobile_number'), '%055%')
  assert.equal(valueOf(digits, 'name_search'), '%055%')
})

test('the builder cannot be broken out of and adds nothing for an empty term', () => {
  assert.equal(buildSearchFilter(['name_search'], ''), null)
  assert.equal(buildSearchFilter(['name_search'], ' %_* '), null)
  // A term that normalises to nothing never becomes `ilike.%%` (match all).
  assert.equal(buildSearchFilter(['name_search'], '\u0640\u0640'), null)
  const filter = buildSearchFilter(['name_search', 'code'], 'a,b.c(d)')
  for (const column of columnsOf(filter))
    assert.equal(valueOf(filter, column), '%a b c d%')
})

test('plate digits are probed only for a digits-only term', () => {
  const fields = ['code', 'plate_digits', 'equipment_plate_digits']
  assert.deepEqual(columnsOf(buildSearchFilter(fields, 'a341')), ['code'])
  assert.deepEqual(columnsOf(buildSearchFilter(fields, '34 1')), fields)
  assert.equal(
    valueOf(buildSearchFilter(fields, '34 1'), 'plate_digits'),
    '%341%',
  )
})

// ---------------------------------------------------------------------------
// EM-119 / EM-116: searchFields is the search, and the placeholder names it
// ---------------------------------------------------------------------------

// A digits-only term so every column, plate digits included, appears.
const ALL_COLUMNS_TERM = '1234'

test('the movement and visits configs list exactly the columns searched', () => {
  const movement = columnsOf(
    buildMovementSearchFilter(ALL_COLUMNS_TERM, {
      includeCompanyProject: true,
    }),
  )
  for (const name of [
    'logsListConfig',
    'homeMovementsListConfig',
    'movementsListConfig',
  ])
    assert.deepEqual([...configs[name].searchFields], movement, name)

  const visit = columnsOf(visits.buildVisitSearchFilter(ALL_COLUMNS_TERM))
  for (const name of [
    'visitsListConfig',
    'foremanVisitsListConfig',
    'adminVisitsListConfig',
  ])
    assert.deepEqual([...visits[name].searchFields], visit, name)
})

test('every master list builds its search from its own searchFields', () => {
  const screens = {
    'src/screens/drivers/DriversListScreen.tsx': 'driversListConfig',
    'src/screens/equipment/EquipmentListScreen.tsx': 'equipmentListConfig',
    'src/screens/companies/CompaniesListScreen.tsx': 'companiesListConfig',
    'src/screens/projects/ProjectsListScreen.tsx': 'projectsListConfig',
    'src/screens/lessors/LessorsListScreen.tsx': 'lessorsListConfig',
    'src/screens/AdminUsers.tsx': 'usersListConfig',
  }
  for (const [file, config] of Object.entries(screens))
    assert.match(
      read(file),
      new RegExp(
        `buildSearchFilter\\(\\s*${config}\\.searchFields,\\s*list\\.search,?\\s*\\)`,
      ),
      file,
    )
  // The movement and visits lists go through their shared builders.
  assert.match(
    read('src/screens/admin-home/LogsScreen.tsx'),
    /buildMovementSearchFilter\(list\.search, \{\s*includeCompanyProject: true,\s*\}\)/,
  )
  assert.match(
    read('src/components/home/HomeMovementsCard.tsx'),
    /buildMovementSearchFilter\(search, \{\s*includeCompanyProject: true,\s*\}\)/,
  )
  assert.match(
    read('src/components/visits/VisitsTable.tsx'),
    /buildVisitSearchFilter\(search\)/,
  )
})

/**
 * What each searched column is called in a placeholder. `company` is checked
 * after the company-number phrase is removed, so «ترقيم الشركة» alone never
 * counts as «الشركة».
 */
const CONCEPTS = {
  code: { ar: 'كود', en: 'code' },
  type: { ar: 'نوع', en: 'type' },
  plate: { ar: 'لوحة', en: 'plate' },
  chassis: { ar: 'شاصي', en: 'chassis' },
  driver: { ar: 'السائق', en: 'driver' },
  companyNumber: { ar: 'ترقيم الشركة', en: 'company number' },
  company: { ar: 'الشركة', en: 'company' },
  project: { ar: 'المشروع', en: 'project' },
  name: { ar: 'اسم', en: 'name' },
  idNumber: { ar: 'الهوية', en: 'id' },
  mobile: { ar: 'الجوال', en: 'mobile' },
  contactPerson: { ar: 'جهة الاتصال', en: 'contact person' },
}
const COLUMN_CONCEPT = {
  code: 'code',
  equipment_code: 'code',
  type_search: 'type',
  equipment_type_search: 'type',
  plate_number: 'plate',
  plate_digits: 'plate',
  equipment_plate_number: 'plate',
  equipment_plate_digits: 'plate',
  chassis_number: 'chassis',
  equipment_chassis_number: 'chassis',
  driver_name_search: 'driver',
  contractor_equipment_code: 'companyNumber',
  company_name_ar_search: 'company',
  company_name_en: 'company',
  project_name_ar_search: 'project',
  project_name_en: 'project',
  full_name: 'name',
  full_name_search: 'name',
  name_en: 'name',
  name_ar_search: 'name',
  name_search: 'name',
  id_number: 'idNumber',
  mobile_number: 'mobile',
  contact_number: 'mobile',
  contact_person_search: 'contactPerson',
}

function mentions(text, concept, lang) {
  let haystack = text.toLowerCase()
  if (concept === 'company')
    haystack = haystack.split(CONCEPTS.companyNumber[lang]).join(' ')
  return haystack.includes(CONCEPTS[concept][lang])
}

const WIRED = [
  ['drivers', configs.driversListConfig],
  ['equipment', configs.equipmentListConfig],
  ['companies', configs.companiesListConfig],
  ['projects', configs.projectsListConfig],
  ['lessors', configs.lessorsListConfig],
  ['users', configs.usersListConfig],
  ['logs', configs.logsListConfig],
  ['homeMovements', configs.homeMovementsListConfig],
  ['visits', visits.visitsListConfig],
  ['adminVisits', visits.adminVisitsListConfig],
]

test('every placeholder names what its list searches (EM-116)', () => {
  for (const [name, config] of WIRED)
    for (const field of config.searchFields) {
      const concept = COLUMN_CONCEPT[field]
      assert.ok(concept, `${name}: unknown search column ${field}`)
      for (const lang of ['ar', 'en'])
        assert.ok(
          mentions(
            resolveListLabel(config.searchPlaceholder, lang),
            concept,
            lang,
          ),
          `${name} (${lang}) searches ${field} but the placeholder does not say ${CONCEPTS[concept][lang]}`,
        )
    }
})

test('the movement and visits placeholders promise nothing they do not search', () => {
  const movementConcepts = [
    'code',
    'type',
    'plate',
    'chassis',
    'driver',
    'companyNumber',
    'company',
    'project',
  ]
  for (const [name, config] of WIRED.filter(([id]) =>
    ['logs', 'homeMovements', 'visits', 'adminVisits'].includes(id),
  )) {
    const searched = new Set(
      config.searchFields.map((field) => COLUMN_CONCEPT[field]),
    )
    for (const concept of movementConcepts)
      for (const lang of ['ar', 'en'])
        if (
          mentions(
            resolveListLabel(config.searchPlaceholder, lang),
            concept,
            lang,
          )
        )
          assert.ok(
            searched.has(concept),
            `${name} (${lang}) promises ${concept}`,
          )
  }
})

test('new Arabic placeholder copy has no hamza or madda on alif', () => {
  for (const [, config] of [
    ['logs', configs.logsListConfig],
    ['homeMovements', configs.homeMovementsListConfig],
  ])
    assert.doesNotMatch(
      resolveListLabel(config.searchPlaceholder, 'ar'),
      /[أإآ]/,
    )
})

test('the screens show placeholders that match their search', () => {
  // The movement form searches code, type, plate and chassis in all modes.
  const step = read('src/components/movement/EquipmentStep.tsx')
  assert.match(step, /placeholder=\{t\('searchEquipmentAnyField'\)\}/)
  // The workshop report: equipment fields only.
  const workshop = read('src/screens/WorkshopReports.tsx')
  assert.match(workshop, /placeholder=\{t\('searchEquipmentAnyField'\)\}/)
  // The home log: the config placeholder for the foreman, equipment for the
  // workshop (its rows have no driver, company number, company or project).
  const home = read('src/components/home/HomeMovementsCard.tsx')
  assert.match(
    home,
    /workshopMode\s*\?\s*t\('searchEquipmentAnyField'\)\s*:\s*listLabel\(homeMovementsListConfig\.searchPlaceholder\)/,
  )
  // EM-121: the shared toolbar's search box has an accessible name.
  const toolbar = read('src/components/data-list/DataListToolbar.tsx')
  assert.match(toolbar, /aria-label=\{listLabel\(config\.searchPlaceholder\)\}/)
})

test('no Arabic name search bypasses the normalised columns', () => {
  // Every relational selector and list goes through `buildSearchFilter` with
  // the `*_search` columns. Left as they are on purpose: profiles (no
  // normalised column), the raw driver snapshot in the entry report, and the
  // activity log; the extracting module belongs to another workstream.
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'extracting') walk(full)
      } else if (/\.tsx?$/.test(entry.name)) {
        const source = fs.readFileSync(full, 'utf8')
        for (const pattern of [
          /\bname_ar\.ilike\b/,
          /\bname\.ilike\b/,
          /\btype\.ilike\b/,
          /\bcontact_person\.ilike\b/,
          /`full_name\.ilike\b/,
          /\.ilike\('name'/,
          /\.ilike\('name_ar'/,
        ])
          if (pattern.test(source))
            offenders.push(`${path.relative(ROOT, full)} ${pattern}`)
      }
    }
  }
  walk(path.join(ROOT, 'src'))
  assert.deepEqual(offenders, [])
})

// ---------------------------------------------------------------------------
// Migration 0116
// ---------------------------------------------------------------------------

test('0116: the normalised columns are generated, indexed and read-only', () => {
  for (const [table, column, source] of [
    ['drivers', 'full_name_search', 'full_name'],
    ['companies', 'name_ar_search', 'name_ar'],
    ['projects', 'name_ar_search', 'name_ar'],
    ['lessors', 'name_search', 'name'],
    ['lessors', 'contact_person_search', 'contact_person'],
    ['equipment', 'type_search', 'type'],
    ['equipment_types', 'name_search', 'name'],
  ]) {
    assert.match(
      SQL,
      new RegExp(
        `ADD COLUMN ${column} text\\s+GENERATED ALWAYS AS \\(public\\.normalize_search_text\\(${source}\\)\\) STORED`,
      ),
      `${table}.${column}`,
    )
    assert.match(
      SQL,
      new RegExp(
        `ON public\\.${table} USING gin \\(${column} extensions\\.gin_trgm_ops\\)`,
      ),
      `${table}.${column} index`,
    )
  }
  assert.match(
    SQL,
    /ON public\.entry_exit_logs\s+USING gin \(public\.normalize_search_text\(driver_name\) extensions\.gin_trgm_ops\)/,
  )
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.normalize_search_text\(text\) FROM PUBLIC, anon;/,
  )
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.normalize_search_text\(text\) TO authenticated, service_role;/,
  )
  // Nothing is dropped or renamed: backward compatible with the live UI.
  assert.doesNotMatch(SQL, /^\s*(DROP|ALTER TABLE [^;]* (DROP|RENAME))/m)
})

test('0116: EM-122 indexes for the remaining searched columns', () => {
  assert.match(
    SQL,
    /ON public\.profiles USING gin \(full_name extensions\.gin_trgm_ops\)/,
  )
  assert.match(
    SQL,
    /ON public\.movement_audit_logs USING gin \(equipment_code extensions\.gin_trgm_ops\)/,
  )
  assert.match(
    SQL,
    /ON public\.movement_audit_logs USING gin \(actor_name extensions\.gin_trgm_ops\)/,
  )
})

/** `CREATE OR REPLACE VIEW public.<name>` up to its terminating `;`. */
function viewBlock(sql, name) {
  const start = sql.lastIndexOf(`CREATE OR REPLACE VIEW public.${name}`)
  assert.ok(start >= 0, name)
  return sql.slice(start, sql.indexOf(';\n', start) + 1)
}
/** The view without comment lines, so only the definition is compared. */
const code = (text) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

test('0116: both views are the previous definitions with columns appended', () => {
  for (const [name, previous, appended] of [
    [
      'movement_log_search',
      '0099',
      [
        'e.type_search AS equipment_type_search,',
        'public.normalize_search_text(l.driver_name) AS driver_name_search,',
        'c.name_ar_search AS company_name_ar_search,',
        'p.name_ar_search AS project_name_ar_search',
      ],
    ],
    [
      'movement_visits',
      '0106',
      [
        'e.type_search AS equipment_type_search,',
        'public.normalize_search_text(p.driver_name) AS driver_name_search',
      ],
    ],
  ]) {
    const before = code(viewBlock(migration(previous), name))
    const after = code(viewBlock(SQL, name))
    assert.match(after, /WITH \(security_invoker = true\)/)
    // The old last column gains a comma, then the new columns follow it.
    const lastColumn = 'e.ownership_status AS equipment_ownership_status'
    const expected = before.replace(
      `  ${lastColumn}\nFROM`,
      `  ${lastColumn},\n${appended.map((line) => `  ${line}`).join('\n')}\nFROM`,
    )
    assert.notEqual(expected, before, `${name}: anchor found`)
    assert.equal(
      after,
      expected,
      `${name} is ${previous} plus appended columns`,
    )
    assert.match(
      SQL,
      new RegExp(
        `REVOKE ALL ON public\\.${name} FROM PUBLIC, anon;\\s*GRANT SELECT ON public\\.${name} TO authenticated;`,
      ),
    )
  }
})

/** A function definition up to the end of its `$$` body. */
function functionBlock(sql, name) {
  const start = sql.search(
    new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\(`),
  )
  assert.ok(start >= 0, name)
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('AS $$', start)) + 3)
}

test('0116: the selectors are 0114 verbatim except the normalised type and EM-117', () => {
  const previous = migration('0114')
  for (const name of [
    'search_entry_equipment',
    'search_site_exit_equipment',
    'search_workshop_equipment',
  ]) {
    const after = functionBlock(SQL, name)
    assert.match(after, /SECURITY DEFINER\s+SET search_path = public/)
    assert.match(after, /ORDER BY e\.code\s+LIMIT 20;/)
    assert.match(
      after,
      /OR e\.type_search ILIKE '%' \|\| v_term_search \|\| '%'/,
    )
    assert.match(after, /OR e\.chassis_number ILIKE '%' \|\| v_term \|\| '%'/)
    // Undo the documented changes; what remains must be 0114 character for
    // character (the header changes from CREATE to CREATE OR REPLACE).
    const undone = after
      .replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
      .replace('  v_term_search text;\n', '')
      .replace(
        "  -- 0116: the same term, normalised like equipment.type_search. NULL when\n  -- nothing is left (a term of tatweel only), so it never matches every row.\n  v_term_search := NULLIF(public.normalize_search_text(v_term), '');\n",
        '',
      )
      .replace(
        "      -- 0116: the type is compared normalised on both sides.\n      OR e.type_search ILIKE '%' || v_term_search || '%'\n",
        "      OR e.type ILIKE '%' || v_term || '%'\n",
      )
      .replace(
        "      -- 0116 (EM-117): the chassis number, as the two site searches match it.\n      OR e.chassis_number ILIKE '%' || v_term || '%'\n",
        '',
      )
    assert.equal(undone, functionBlock(previous, name), name)
    assert.match(
      SQL,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(text, text, text\\) FROM PUBLIC, anon;\\s*GRANT EXECUTE ON FUNCTION public\\.${name}\\(text, text, text\\) TO authenticated;`,
      ),
    )
  }
  // EM-117 is the workshop search only: the two site searches had it already.
  assert.doesNotMatch(
    functionBlock(previous, 'search_workshop_equipment'),
    /chassis_number ILIKE/,
  )
})
