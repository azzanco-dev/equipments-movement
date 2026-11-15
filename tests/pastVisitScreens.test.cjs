const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-11-15 («اضافة زيارة كاملة», migration 0197, screens): a button on
// the /logs page header opens a dialog that records a whole past project
// visit through add_past_site_visit.

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

function loadLib(name, cache = new Map()) {
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
      Intl,
      JSON,
      parseInt,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLib(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value))
const lib = loadLib('pastVisit')
const UUID = '123e4567-e89b-42d3-a456-426614174000'

const values = {
  equipment_id: 'e1',
  supervisor_id: 's1',
  company_id: 'c1',
  project_id: 'p1',
  entry_date: '2026-09-11',
  exit_date: '2026-09-13',
  driver_id: '',
  contractor_code: '  ',
  notes: ' note ',
}

test('payload: blank optional fields go as null, dates as keys', () => {
  assert.deepEqual(plain(lib.buildPastVisitPayload(values)), {
    p_equipment_id: 'e1',
    p_supervisor_id: 's1',
    p_company_id: 'c1',
    p_project_id: 'p1',
    p_entry_date: '2026-09-11',
    p_exit_date: '2026-09-13',
    p_driver_id: null,
    p_contractor_equipment_code: null,
    p_notes: 'note',
  })
  const full = lib.buildPastVisitPayload({
    ...values,
    driver_id: 'd1',
    contractor_code: ' R16513 ',
  })
  assert.equal(full.p_driver_id, 'd1')
  assert.equal(full.p_contractor_equipment_code, 'R16513')
})

test('result: one row or a one-row array with two uuids', () => {
  const row = { entry_id: UUID, exit_id: UUID }
  assert.deepEqual(plain(lib.parsePastVisitResult([row])), {
    entryId: UUID,
    exitId: UUID,
  })
  assert.deepEqual(plain(lib.parsePastVisitResult(row)), {
    entryId: UUID,
    exitId: UUID,
  })
  assert.equal(lib.parsePastVisitResult([]), null)
  assert.equal(lib.parsePastVisitResult([{ entry_id: 'x', exit_id: UUID }]), null)
})

test('days between the two dates', () => {
  assert.equal(lib.pastVisitDays('2026-09-11', '2026-09-13'), 2)
  assert.equal(lib.pastVisitDays('2026-09-11', '2026-09-11'), 0)
  assert.equal(lib.pastVisitDays('2026-09-13', '2026-09-11'), null)
  assert.equal(lib.pastVisitDays('', '2026-09-11'), null)
})

test('conflict parser: a valid object, an open visit, and malformed input', () => {
  const good = {
    entry_id: UUID,
    entry_at: '2026-09-11T09:00:00+00:00',
    exit_at: '2026-09-13T09:00:00+00:00',
    project_name_ar: 'القدية',
    project_name_en: null,
  }
  assert.deepEqual(plain(lib.parsePastVisitConflict(JSON.stringify(good))), {
    entryId: UUID,
    entryAt: good.entry_at,
    exitAt: good.exit_at,
    projectNameAr: 'القدية',
    projectNameEn: null,
  })
  const open = lib.parsePastVisitConflict(
    JSON.stringify({ ...good, exit_at: null }),
  )
  assert.equal(open.exitAt, null)
  assert.deepEqual(plain(lib.pastVisitConflictDays(open)), {
    from: '2026-09-11',
    to: null,
  })
  assert.equal(lib.pastVisitConflictProject(open, 'en'), 'القدية')
  for (const bad of [
    null,
    '',
    'not json',
    '[]',
    '"x"',
    JSON.stringify({ ...good, entry_id: 'nope' }),
    JSON.stringify({ ...good, entry_at: 'yesterday' }),
    JSON.stringify({ ...good, exit_at: 5 }),
    JSON.stringify({ ...good, project_name_ar: 7 }),
    JSON.stringify({ ...good, project_name_en: undefined }),
  ])
    assert.equal(lib.parsePastVisitConflict(bad), null, String(bad))
})

test('token map: fields, conflict, permission, sequence, generic', () => {
  const out = (message, details) =>
    plain(lib.pastVisitErrorOutcome({ message, details }))
  assert.deepEqual(out('equipment_in_workshop'), {
    kind: 'fields',
    fields: { entry_date: 'pastVisitErrorInWorkshop' },
  })
  assert.deepEqual(out('exit_before_entry'), {
    kind: 'fields',
    fields: { exit_date: 'pastVisitExitBeforeEntry' },
  })
  assert.deepEqual(out('visit_in_future'), {
    kind: 'fields',
    fields: { exit_date: 'pastVisitExitInFuture' },
  })
  assert.deepEqual(out('invalid_dates').fields, {
    entry_date: 'pastVisitDatesInvalid',
    exit_date: 'pastVisitDatesInvalid',
  })
  assert.deepEqual(out('invalid_supervisor').fields, {
    supervisor_id: 'pastVisitErrorSupervisor',
  })
  for (const [token, field] of [
    ['invalid_equipment', 'equipment_id'],
    ['invalid_company', 'company_id'],
    ['invalid_project', 'project_id'],
    ['invalid_driver', 'driver_id'],
    ['invalid_contractor_code', 'contractor_code'],
    ['invalid_notes', 'notes'],
  ])
    assert.deepEqual(Object.keys(out(token).fields), [field], token)
  assert.deepEqual(out('past_visit_required'), {
    kind: 'form',
    message: 'pastVisitErrorNotAllowed',
  })
  for (const sequence of [
    'enforce: sequence would be invalid',
    'no prior entry found',
    'exit_equipment_in_workshop',
    'exit_equipment_on_site',
  ])
    assert.deepEqual(out(sequence), {
      kind: 'form',
      message: 'pastVisitErrorSequence',
    })
  // A PO / movement lock or anything unknown: the generic message, never raw.
  for (const unknown of ['movement_on_po', 'duplicate key value', ''])
    assert.deepEqual(out(unknown), { kind: 'form', message: 'saveFailed' })
  assert.deepEqual(plain(lib.pastVisitErrorOutcome(null)), {
    kind: 'form',
    message: 'saveFailed',
  })

  const details = JSON.stringify({
    entry_id: UUID,
    entry_at: '2026-09-11T09:00:00Z',
    exit_at: null,
    project_name_ar: null,
    project_name_en: 'Qiddiya',
  })
  const conflict = out('visit_overlap', details)
  assert.equal(conflict.kind, 'conflict')
  assert.equal(conflict.conflict.entryId, UUID)
  assert.deepEqual(Object.keys(conflict.fields).sort(), ['entry_date', 'exit_date'])
  assert.equal(out('visit_overlap', 'garbage').conflict, null)
})

test('the limits mirror the admin edit', () => {
  const admin = read('src', 'lib', 'movementAdmin.ts')
  assert.match(admin, /MOVEMENT_NOTES_MAX_LENGTH = 1000/)
  assert.match(admin, /MOVEMENT_CONTRACTOR_CODE_MAX_LENGTH = 50/)
  assert.equal(lib.PAST_VISIT_NOTES_MAX_LENGTH, 1000)
  assert.equal(lib.PAST_VISIT_CONTRACTOR_CODE_MAX_LENGTH, 50)
})

test('the schema is Zod, with required fields and the date rules', () => {
  const f = read('src', 'lib', 'formValidation.ts')
  const schema = f.slice(f.indexOf('export const pastVisitFormSchema'))
  assert.match(schema, /pastVisitExitBeforeEntry/)
  assert.match(schema, /pastVisitExitInFuture/)
  assert.match(schema, /pastVisitEntryInFuture/)
  assert.match(schema, /PAST_VISIT_NOTES_MAX_LENGTH/)
})

test('the entry point: a Settings hub card gated on the key, not the log', () => {
  // Owner 2026-11-15, «خلي الزر في الاعدادات»: the button left the /logs header.
  const logs = read('src', 'screens', 'admin-home', 'LogsScreen.tsx')
  assert.ok(!logs.includes('AddPastVisitDialog'))
  assert.ok(!logs.includes('pastVisit'))

  const s = read('src', 'screens', 'AdminSettings.tsx')
  assert.equal(lib.PAST_VISIT_PERMISSION, 'movements.site.add_past_visit')
  assert.match(
    s,
    /permissionStatus === 'ready' && permissions\.has\(PAST_VISIT_PERMISSION\)/,
  )
  const card = s.slice(s.indexOf('{canAddPastVisit && ('), s.indexOf("{opens('settings/afaqy')"))
  assert.match(card, /setPastVisitOpen\(true\)/)
  assert.match(card, /<CalendarPlus /)
  assert.match(card, /pastVisitButton/)
  assert.match(card, /pastVisitDesc/)
  assert.equal((s.match(/<AddPastVisitDialog/g) ?? []).length, 1)
  assert.match(s, /router\.push\(`\/movements\/\$\{entryId\}`\)/)

  // A holder of the key alone reaches the Settings hub.
  const nav = read('src', 'lib', 'navPermissions.ts')
  const settings = nav.slice(nav.indexOf("key: 'settings',"))
  assert.match(
    settings.slice(0, settings.indexOf(']')),
    /\{ key: 'movements\.site\.add_past_visit' \}/,
  )
})

test('the dialog: fields, the RPC, the conflict link', () => {
  const d = read('src', 'components', 'movement', 'AddPastVisitDialog.tsx')
  for (const name of [
    'equipment_id',
    'supervisor_id',
    'company_id',
    'project_id',
    'entry_date',
    'exit_date',
    'driver_id',
    'contractor_code',
    'notes',
  ])
    assert.match(d, new RegExp(`name="${name}"`))
  assert.match(d, /size="lg"/)
  assert.match(d, /max=\{today\}/)
  assert.match(d, /min=\{values\.entry_date \|\| undefined\}/)
  assert.match(d, /'movements\.site\.create'/)
  assert.match(d, /<AppLink\s+href=\{`\/movements\/\$\{conflict\.entryId\}`\}/)
  assert.match(d, /if \(!busy\) onOpenChange\(next\)/)
  const data = read('src', 'lib', 'pastVisitData.ts')
  assert.match(data, /supabase\.rpc\(\s*'add_past_site_visit'/)
  // Never a raw database message.
  assert.doesNotMatch(d, /error\.message|\.details/)
})

test('both languages carry every past-visit key, without hamza alif', () => {
  const src = read('src', 'i18n', 'translations.ts')
  const blocks = [...src.matchAll(/\/\/ past-visit — start\n([\s\S]*?)\/\/ past-visit — end/g)]
  assert.equal(blocks.length, 2)
  const keys = blocks.map((block) =>
    [...block[1].matchAll(/^ {4}(pastVisit\w+):/gm)].map((m) => m[1]),
  )
  assert.deepEqual(keys[0], keys[1])
  assert.ok(keys[0].length > 30)
  assert.doesNotMatch(blocks[0][1], /[أإآ]/)
  // Every key the code uses exists.
  const used = new Set()
  for (const file of [
    read('src', 'lib', 'pastVisit.ts'),
    read('src', 'lib', 'formValidation.ts'),
    read('src', 'components', 'movement', 'AddPastVisitDialog.tsx'),
    read('src', 'screens', 'AdminSettings.tsx'),
  ])
    for (const m of file.matchAll(/'(pastVisit\w+)'/g)) used.add(m[1])
  for (const key of used) assert.ok(keys[0].includes(key), key)
})
