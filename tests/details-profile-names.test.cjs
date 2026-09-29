const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

// Loads a module with no runtime imports (type-only imports are erased).
function loadModule(relative, extraGlobals = {}) {
  const file = path.join(root, relative)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(
    code,
    {
      exports,
      require(request) {
        throw new Error(`Unexpected module: ${request}`)
      },
      ...extraGlobals,
    },
    { filename: file },
  )
  return exports
}

const names = loadModule('src/components/details/profileNames.ts')

function fakeClient(result) {
  const calls = []
  const builder = {
    select(columns) {
      calls.push(['select', columns])
      return builder
    },
    in(column, values) {
      calls.push(['in', column, [...values]])
      return builder
    },
    abortSignal(signal) {
      calls.push(['abortSignal', signal])
      return builder
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject)
    },
  }
  return {
    calls,
    from(table) {
      calls.push(['from', table])
      return builder
    },
  }
}

test('names come from the name-only view with an explicit column list', () => {
  assert.equal(names.PROFILE_NAMES_VIEW, 'profile_names')
  assert.equal(names.PROFILE_NAMES_SELECT, 'id,full_name')
})

test('uniqueProfileIds drops empty and repeated ids, keeping order', () => {
  assert.deepEqual(
    [...names.uniqueProfileIds(['b', null, 'a', 'b', undefined, '', 'a'])],
    ['b', 'a'],
  )
})

test('fetchProfileNames skips the request when there are no ids', async () => {
  const client = fakeClient({ data: [], error: null })
  const result = await names.fetchProfileNames(client, [null, undefined])
  assert.equal(result.failed, false)
  assert.equal(result.names.size, 0)
  assert.equal(client.calls.length, 0)
})

test('fetchProfileNames queries profile_names by the distinct ids', async () => {
  const client = fakeClient({
    data: [
      { id: 'u1', full_name: 'خالد' },
      { id: 'u2', full_name: null },
    ],
    error: null,
  })
  const signal = new AbortController().signal
  const result = await names.fetchProfileNames(
    client,
    ['u1', 'u2', 'u1'],
    signal,
  )
  assert.deepEqual(client.calls, [
    ['from', 'profile_names'],
    ['select', 'id,full_name'],
    ['in', 'id', ['u1', 'u2']],
    ['abortSignal', signal],
  ])
  assert.equal(result.failed, false)
  assert.equal(result.names.get('u1'), 'خالد')
  assert.equal(result.names.has('u2'), false)
})

test('fetchProfileNames reports a failed lookup instead of empty names', async () => {
  const client = fakeClient({ data: null, error: { message: 'boom' } })
  const result = await names.fetchProfileNames(client, ['u1'])
  assert.equal(result.failed, true)
  assert.equal(result.names.size, 0)
})

test('withSupervisorNames keeps the former embed shape', () => {
  const rows = names.withSupervisorNames(
    [
      { id: 'm1', supervisor_id: 'u1' },
      { id: 'm2', supervisor_id: 'u9' },
      { id: 'm3', supervisor_id: null },
    ],
    new Map([['u1', 'خالد']]),
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(rows.map((row) => row.supervisor))),
    [{ id: 'u1', full_name: 'خالد' }, null, null],
  )
  assert.equal(rows[0].id, 'm1')
})

test('detail screens no longer embed profiles for the recorder name', () => {
  for (const file of [
    'src/screens/EquipmentDetail.tsx',
    'src/screens/EntryReportsAll.tsx',
  ]) {
    const source = read(file)
    assert.doesNotMatch(source, /:profiles\(/, file)
    assert.match(source, /fetchProfileNames\(/, file)
  }
  assert.doesNotMatch(
    read('src/screens/EquipmentDetail.tsx'),
    /from\('entry_exit_logs'\)\s*\.select\('\*/,
  )
})

test('migrated detail surfaces use the shared detail components', () => {
  const uses = {
    'src/screens/EquipmentDetail.tsx': [/<DetailHeader/, /<InfoGridSection/],
    'src/screens/drivers/DriverDetailDialog.tsx': [
      /<DetailHeader/,
      /<InfoGrid/,
    ],
    'src/screens/UserDetail.tsx': [/<DetailHeader/, /<InfoGridSection/],
    'src/screens/inquiry/EquipmentInquiryScreen.tsx': [/<InfoGrid/],
    'src/components/inquiry/EquipmentTimeline.tsx': [/<InfoGrid/],
  }
  for (const [file, patterns] of Object.entries(uses)) {
    const source = read(file)
    for (const pattern of patterns) assert.match(source, pattern, file)
    assert.doesNotMatch(source, /\b(InfoRow|DescriptionList)\b/, file)
  }
})

test('wave7-B keys exist in Arabic and English, Arabic without hamza', () => {
  const source = read('src/i18n/translations.ts')
  const keys = [
    'detailSectionIdentity',
    'detailSectionOwnership',
    'detailSectionDates',
    'detailRecentMovementsDesc',
    'userSectionAccount',
  ]
  for (const key of keys) {
    const matches = [
      ...source.matchAll(new RegExp(`\\n\\s+${key}: '([^']*)'`, 'g')),
    ]
    assert.equal(matches.length, 2, key)
    assert.doesNotMatch(matches[0][1], /[أإآ]/, key)
  }
})
