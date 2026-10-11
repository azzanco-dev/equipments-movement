// Wave 19: the driver's CURRENT record name instead of the stored snapshot
// (migration 0124). Pure and regex checks only, like the rest of the suite: no
// database is reached.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const MIGRATION = '20261011100000_0124_driver_current_name.sql'
const migration = (number) => {
  const name = fs
    .readdirSync(MIGRATIONS)
    .find((file) => file.includes(`_${number}_`))
  assert.ok(name, `migration ${number} exists`)
  return fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
}
const SQL = fs.readFileSync(path.join(MIGRATIONS, MIGRATION), 'utf8')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

/** Loads a src/lib module; `@/lib/...` imports resolve to the real files. */
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Date,
      Math,
      Number,
      String,
      Object,
      Array,
      JSON,
      Map,
      Set,
      Promise,
      require(request) {
        if (request === 'xlsx') return require('xlsx')
        const alias = /^@\/lib\/(.+)$/.exec(request)
        if (alias) return loadLibModule(alias[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const cache = new Map()
const names = loadLibModule('driverDisplayName', cache)
const fields = loadLibModule('exportFields', cache)
const visits = loadLibModule('visitsList', cache)
const movementExcel = loadLibModule('movementExcel', cache)
const logSearch = loadLibModule('movementLogSearch', cache)

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const fakeT = (key) => `[${key}]`

// --- Migration ---------------------------------------------------------------

/** The definition without comment lines, so only the SQL is compared. */
const code = (text) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

/** `CREATE OR REPLACE VIEW public.<name>` up to its terminating `;`. */
function viewBlock(sql, name) {
  const start = sql.lastIndexOf(`CREATE OR REPLACE VIEW public.${name}`)
  assert.ok(start >= 0, name)
  return sql.slice(start, sql.indexOf(';\n', start) + 1)
}

/** Replaces exactly one occurrence, failing when the anchor is missing. */
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `anchor found once: ${from}`)
  return text.replace(from, to)
}

test('0124 is a new migration ordered after 0123, and nothing later redefines the views', () => {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  assert.equal(files.filter((file) => /_0124_/.test(file)).length, 1)
  assert.ok(
    files.indexOf(MIGRATION) > files.findIndex((file) => /_0123_/.test(file)),
  )
  // 0118 is the latest definition 0124 copies: no migration between them
  // touched either view.
  const between = files.slice(
    files.findIndex((file) => /_0118_/.test(file)) + 1,
    files.indexOf(MIGRATION),
  )
  for (const file of between) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
    assert.doesNotMatch(sql, /VIEW public\.movement_log_search/, file)
    assert.doesNotMatch(sql, /VIEW public\.movement_visits/, file)
  }
  assert.match(SQL, /NOTIFY pgrst, 'reload schema';\s*$/)
  // Only the two views: no data change, no index, no function.
  const body = code(SQL)
  assert.doesNotMatch(body, /CREATE (UNIQUE )?INDEX/)
  assert.doesNotMatch(body, /\b(UPDATE|DELETE FROM|INSERT INTO)\b/)
  assert.doesNotMatch(body, /CREATE (OR REPLACE )?FUNCTION/)
  assert.equal((body.match(/CREATE OR REPLACE VIEW/g) ?? []).length, 2)
})

test('movement_log_search is 0118 verbatim plus driver_full_name appended', () => {
  const before = code(viewBlock(migration('0118'), 'movement_log_search'))
  const after = code(viewBlock(SQL, 'movement_log_search'))
  const expected = replaceOnce(
    before,
    '  l.exit_purpose AS exit_purpose\nFROM',
    '  l.exit_purpose AS exit_purpose,\n  d.full_name AS driver_full_name\nFROM',
  )
  assert.equal(after, expected)
  assert.match(after, /WITH \(security_invoker = true\)/)
  // The existing drivers join is reused; no second one is added.
  assert.equal((after.match(/JOIN public\.drivers/g) ?? []).length, 1)
})

test('movement_visits is 0118 verbatim plus the entry driver current name appended', () => {
  const before = code(viewBlock(migration('0118'), 'movement_visits'))
  const after = code(viewBlock(SQL, 'movement_visits'))
  let expected = replaceOnce(
    before,
    '  END AS exit_purpose\nFROM',
    '  END AS exit_purpose,\n  dv.full_name AS driver_full_name\nFROM',
  )
  expected = replaceOnce(
    expected,
    'LEFT JOIN public.profile_names s ON s.id = p.supervisor_id\n',
    'LEFT JOIN public.profile_names s ON s.id = p.supervisor_id\n' +
      'LEFT JOIN public.drivers dv ON dv.id = p.driver_id\n',
  )
  assert.equal(after, expected)
  assert.match(after, /WITH \(security_invoker = true\)/)
  // The pairing window is untouched: same partition, same (recorded_at, id).
  assert.match(
    after,
    /PARTITION BY l\.equipment_id, l\.movement_context\s+ORDER BY l\.recorded_at, l\.id/,
  )
  assert.match(after, /WHERE p\.movement_type = 'entry';$/)
})

test('both views keep their grants and gain a comment naming driver_full_name', () => {
  for (const view of ['movement_log_search', 'movement_visits']) {
    assert.match(
      SQL,
      new RegExp(`REVOKE ALL ON public\\.${view} FROM PUBLIC, anon;`),
    )
    assert.match(
      SQL,
      new RegExp(`GRANT SELECT ON public\\.${view} TO authenticated;`),
    )
    const comment = SQL.slice(SQL.indexOf(`COMMENT ON VIEW public.${view}`))
    assert.match(
      comment.slice(0, comment.indexOf(';\n')),
      /driver_full_name \(0124\)/,
    )
  }
})

// --- Display helper ----------------------------------------------------------

test('displayDriverName: a later change, then the record, then the snapshot', () => {
  const { displayDriverName } = names
  // A legacy name-only row keeps its snapshot.
  assert.equal(displayDriverName({ driver_name: 'سارفات علي' }), 'سارفات علي')
  // A linked row shows the record's current name.
  assert.equal(
    displayDriverName({
      driver_full_name: 'شرفت علي',
      driver_name: 'سارفات علي',
    }),
    'شرفت علي',
  )
  // A later driver change wins over both.
  assert.equal(
    displayDriverName({
      current_driver_name: 'خالد',
      driver_full_name: 'شرفت علي',
      driver_name: 'سارفات علي',
    }),
    'خالد',
  )
  // Blank values fall through; no driver at all is empty.
  assert.equal(
    displayDriverName({
      current_driver_name: ' ',
      driver_full_name: '',
      driver_name: ' سالم ',
    }),
    'سالم',
  )
  assert.equal(displayDriverName({}), '')
  assert.equal(
    displayDriverName({ driver_full_name: null, driver_name: null }),
    '',
  )
})

test('change driver names prefer the record, else the snapshot', () => {
  assert.equal(
    names.changeNewDriverName({
      new_driver_name: 'سارفات علي',
      new_driver_full_name: 'شرفت علي',
    }),
    'شرفت علي',
  )
  assert.equal(
    names.changeNewDriverName({ new_driver_name: 'سارفات علي' }),
    'سارفات علي',
  )
  assert.equal(names.changeNewDriverName(null), null)
  assert.equal(
    names.changePreviousDriverName({
      previous_driver_name: 'Old',
      previous_driver_full_name: 'New',
    }),
    'New',
  )
  assert.equal(
    names.changePreviousDriverName({ previous_driver_name: null }),
    null,
  )
  // A PostgREST to-one embed arrives as an object or an array of one.
  assert.equal(names.embeddedFullName({ full_name: ' شرفت ' }), 'شرفت')
  assert.equal(names.embeddedFullName([{ full_name: 'X' }]), 'X')
  assert.equal(names.embeddedFullName(null), null)
  assert.equal(names.preferRecordName(null, 'snap'), 'snap')
})

// --- Driver change resolution ------------------------------------------------

const change = (over) => ({
  id: 'c1',
  entry_log_id: 'e1',
  new_driver_id: 'd9',
  new_driver_name: 'Snapshot',
  changed_at: '2026-10-01T10:00:00+00:00',
  ...over,
})

test('withChangeDriverNames sets the record name and keeps the snapshot', () => {
  const input = [
    change({ id: 'c1', new_driver_id: 'd1', new_driver_name: 'سارفات علي' }),
    change({ id: 'c2', new_driver_id: 'd2', new_driver_name: 'Other' }),
  ]
  const out = fields.withChangeDriverNames(input, new Map([['d1', 'شرفت علي']]))
  assert.equal(out[0].new_driver_full_name, 'شرفت علي')
  assert.equal(out[0].new_driver_name, 'سارفات علي')
  // Unknown record: untouched, so the snapshot shows.
  assert.equal(out[1], input[1])
  assert.equal(input[0].new_driver_full_name, undefined)
})

test('latestChangeDriverNames: the latest change by (changed_at, id), record name first', () => {
  const map = fields.latestChangeDriverNames([
    change({ id: 'c1', new_driver_full_name: 'Early record' }),
    change({
      id: 'c3',
      new_driver_name: 'Last snap',
      new_driver_full_name: 'Last record',
    }),
    change({ id: 'c2', new_driver_name: 'Middle' }),
    change({ id: 'c4', entry_log_id: 'e2', new_driver_name: 'Only snap' }),
  ])
  assert.equal(map.get('e1'), 'Last record')
  assert.equal(map.get('e2'), 'Only snap')
  assert.equal(map.has('e3'), false)
})

function recordingClient(answer) {
  const calls = []
  return {
    calls,
    from(table) {
      const call = { table, select: null, ids: null, column: null }
      calls.push(call)
      const chain = {
        select(columns) {
          call.select = columns
          return chain
        },
        in(column, ids) {
          call.column = column
          call.ids = ids
          return chain
        },
        abortSignal: () => chain,
        then: (resolve, reject) =>
          Promise.resolve(answer(call)).then(resolve, reject),
      }
      return chain
    },
  }
}

test('loadDriverChanges resolves each new driver to its current record name', async () => {
  const client = recordingClient((call) => {
    if (call.table === 'movement_driver_changes')
      return {
        data: [
          change({
            id: 'c1',
            new_driver_id: 'd1',
            new_driver_name: 'سارفات علي',
          }),
          change({ id: 'c2', entry_log_id: 'e2', new_driver_id: 'd2' }),
        ],
        error: null,
      }
    return {
      data: [{ id: 'd1', full_name: 'شرفت علي' }],
      error: null,
    }
  })
  const out = await fields.loadDriverChanges(client, ['e1', 'e2'])
  assert.deepEqual(
    plain(client.calls.map((call) => [call.table, call.select])),
    [
      ['movement_driver_changes', fields.DRIVER_CHANGES_SELECT],
      ['drivers', 'id,full_name'],
    ],
  )
  assert.deepEqual(plain(client.calls[1].ids), ['d1', 'd2'])
  assert.equal(out[0].new_driver_full_name, 'شرفت علي')
  assert.equal(out[1].new_driver_full_name, undefined)

  // No change: no driver lookup at all.
  const idle = recordingClient(() => ({ data: [], error: null }))
  assert.deepEqual(plain(await fields.loadDriverChanges(idle, ['e1'])), [])
  assert.equal(idle.calls.length, 1)

  // A failed name lookup fails the loader, like every export lookup.
  const failing = recordingClient((call) =>
    call.table === 'drivers'
      ? { data: null, error: { message: 'x' } }
      : { data: [change({})], error: null },
  )
  await assert.rejects(fields.loadDriverChanges(failing, ['e1']), {
    name: 'SupabaseLoadError',
  })
})

test('a visit shows its current driver record name, a change winning', () => {
  const rows = [
    // Linked entry driver whose record was corrected.
    {
      entry_id: 'e1',
      driver_id: 'd1',
      driver_name: 'سارفات علي',
      driver_full_name: 'شرفت علي',
    },
    // Changed during the visit; the change's record is known.
    {
      entry_id: 'e2',
      driver_id: 'd1',
      driver_name: 'سارفات علي',
      driver_full_name: 'شرفت علي',
    },
    // Changed, but the change's record name is unknown: its snapshot shows,
    // never the entry driver's record name.
    {
      entry_id: 'e3',
      driver_id: 'd1',
      driver_name: 'سارفات علي',
      driver_full_name: 'شرفت علي',
    },
    // Legacy name-only visit.
    {
      entry_id: 'e4',
      driver_id: null,
      driver_name: 'قديم',
      driver_full_name: null,
    },
  ]
  const out = visits.withCurrentDrivers(rows, [
    change({
      id: 'c1',
      entry_log_id: 'e2',
      new_driver_id: 'd5',
      new_driver_name: 'Old spelling',
      new_driver_full_name: 'New spelling',
    }),
    change({
      id: 'c2',
      entry_log_id: 'e3',
      new_driver_id: 'd6',
      new_driver_name: 'Snap only',
    }),
  ])
  assert.deepEqual(out.map(visits.visitDriverName), [
    'شرفت علي',
    'New spelling',
    'Snap only',
    'قديم',
  ])
  assert.equal(out[1].driver_id, 'd5')
  assert.equal(out[2].driver_full_name, null)
  // The export cell reads the same helper.
  const column = visits
    .visitExportColumns(fakeT, 'ar')
    .find((item) => item.key === 'driver_name')
  assert.deepEqual(
    out.map((row) => column.value(row)),
    ['شرفت علي', 'New spelling', 'Snap only', 'قديم'],
  )
})

test('the movement export prefers a change, then the record, then the snapshot', () => {
  const base = {
    movement_type: 'entry',
    movement_context: 'site',
    recorded_at: '2026-10-01T10:00:00+00:00',
  }
  const rows = movementExcel.withCurrentMovementDrivers(
    [
      {
        ...base,
        id: 'm1',
        driver_id: 'd1',
        driver_name: 'سارفات علي',
        driver_full_name: 'شرفت علي',
      },
      {
        ...base,
        id: 'm2',
        driver_id: 'd1',
        driver_name: 'سارفات علي',
        driver_full_name: 'شرفت علي',
      },
      {
        ...base,
        id: 'm3',
        driver_id: null,
        driver_name: 'قديم',
        driver_full_name: null,
      },
    ],
    [
      change({
        entry_log_id: 'm2',
        new_driver_id: 'd5',
        new_driver_name: 'Old spelling',
        new_driver_full_name: 'New spelling',
      }),
    ],
  )
  assert.equal(rows[1].current_driver_name, 'New spelling')
  assert.equal(rows[1].current_driver_id, 'd5')
  const column = movementExcel
    .movementExportColumns(fakeT, 'ar')
    .find((item) => item.key === 'driver_name')
  assert.deepEqual(
    rows.map((row) => column.value(row)),
    ['شرفت علي', 'New spelling', 'قديم'],
  )
})

// --- Wiring ------------------------------------------------------------------

test('the list selects read driver_full_name and the row mapper keeps it', () => {
  assert.match(visits.EQUIPMENT_VISITS_SELECT, /,driver_full_name(,|$)/)
  for (const select of [
    logSearch.MOVEMENT_LOG_ADMIN_SELECT,
    logSearch.MOVEMENT_LOG_WORKSHOP_SELECT,
    logSearch.MOVEMENT_LOG_SUPERVISOR_SELECT,
  ])
    assert.match(select, /(^|,)driver_full_name(,|$)/)
  const mapped = logSearch.mapMovementLogRow({
    id: 'm1',
    equipment_id: 'e1',
    supervisor_id: 'u1',
    movement_type: 'entry',
    driver_id: 'd1',
    driver_name: 'سارفات علي',
    driver_full_name: 'شرفت علي',
    recorded_at: '2026-10-01T10:00:00+00:00',
    created_at: '2026-10-01T10:00:00+00:00',
  })
  assert.equal(mapped.driver_full_name, 'شرفت علي')
  assert.equal(mapped.driver_name, 'سارفات علي')
  assert.match(
    read('src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx'),
    /exit_purpose,driver_full_name'/,
  )
})

test('every driver cell reads the shared helpers, not the snapshot alone', () => {
  const logs = read('src', 'screens', 'admin-home', 'LogsScreen.tsx')
  assert.match(logs, /cell: \(row\) => displayDriverName\(row\) \|\| '—'/)
  const table = read('src', 'components', 'visits', 'VisitsTable.tsx')
  assert.match(table, /cell: \(visit\) => visitDriverName\(visit\) \|\| '—'/)
  const home = read('src', 'components', 'home', 'HomeMovementsCard.tsx')
  assert.match(home, /displayDriverName\(log\) \|\| '—'/)
  assert.match(home, /latestChangeDriverNames\(/)
  assert.doesNotMatch(home, /\.select\('entry_log_id,new_driver_name/)
  const card = read('src', 'components', 'MovementLogCard.tsx')
  assert.match(card, /displayDriverName\(/)
  const detail = read('src', 'screens', 'MovementDetail.tsx')
  assert.match(detail, /loadDriverNames\(/)
  assert.match(detail, /<bdi>\{changeNewDriverName\(change\)\}<\/bdi>/)
  assert.match(detail, /changePreviousDriverName\(change\)/)
  assert.doesNotMatch(detail, /\?\.new_driver_name \?\?/)
  const equipment = read('src', 'screens', 'EquipmentDetail.tsx')
  assert.match(equipment, /driver:drivers\(full_name\)'/)
  assert.match(
    equipment,
    /preferRecordName\(embeddedFullName\(log\.driver\), log\.driver_name\)/,
  )
  const form = read('src', 'components', 'EntryExitForm.tsx')
  assert.match(form, /driverName=\{preferRecordName\(/)
})
