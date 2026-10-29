const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-10-29: «حالات المتبقي … فلتر للملاك كلهم، وافتراضي على
// العزاني، وفيه تصدير اكسل»; «الحالة الان غيرها لعنوان مناسب وشيل كلمة
// الان واضف خيار تكوين في الفلتر».

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

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
      Intl,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLib(match[1], cache)
        if (request.startsWith('@/')) return {}
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

test('the fleet tables offer Takween beside the home three', () => {
  const stats = loadLib('adminHomeStats')
  const plain = (value) => [...value]
  assert.deepEqual(plain(stats.FLEET_FILTER_OWNERS), [
    'alazani',
    'takween',
    'third_party_f',
    'third_party_partnership_b',
  ])
  assert.deepEqual(plain(stats.fleetOwnerArgument(['takween'])), ['takween'])
  assert.deepEqual(
    plain(stats.fleetOwnerArgument([])),
    plain(stats.FLEET_FILTER_OWNERS),
  )
  assert.deepEqual(
    plain(stats.fleetOwnerArgument(['external_supplier'])),
    plain(stats.FLEET_FILTER_OWNERS),
  )
  const args = stats.fleetEquipmentRpcArgs({
    state: 'workshop',
    owners: ['takween'],
    page: 1,
    pageSize: 20,
  })
  assert.deepEqual(plain(args.p_owners), ['takween'])
  // The rest of the home keeps its three.
  assert.deepEqual(plain(stats.homeOwnerArgument(['takween'])), [
    'alazani',
    'third_party_f',
    'third_party_partnership_b',
  ])
})

test('the export: unit data, the entry date and the state', () => {
  const exp = loadLib('adminHomeExport')
  const t = (key) => key
  const columns = exp.restUnitExcelColumns({
    t,
    lang: 'ar',
    ownerLabel: (owner) => `owner:${owner}`,
  })
  assert.deepEqual(
    [...columns.map((column) => column.header)],
    [
      'adminHomeColEquipment',
      'adminHomeColType',
      'plateNumber',
      'adminHomeColOwner',
      'supplierFilter',
      'adminHomeColEntryDate',
      'equipmentState',
    ],
  )
  const row = {
    code: 'A1',
    type: 'X',
    plate: null,
    chassis: 'CH1',
    owner: 'alazani',
    lessor: null,
    since: '2026-10-01T08:00:00Z',
    state: 'workshop_parking',
  }
  assert.deepEqual(
    [...columns.map((column) => column.value(row))],
    [
      'A1',
      'X',
      'CH1',
      'owner:alazani',
      '',
      '2026-10-01T08:00:00Z',
      'parkingPurpose',
    ],
  )
  assert.equal(columns[5].type, 'date')
  assert.equal(
    columns[6].value({ ...row, state: 'available' }),
    'equipmentStateAvailable',
  )
})

test('the export reads the remaining units page by page, never inside_site', () => {
  const data = read('src', 'lib', 'adminHomeData.ts')
  const fn = data.slice(
    data.indexOf('export async function fetchRestUnitsPage'),
  )
  assert.match(fn, /from\('admin_equipment_state'\)/)
  assert.match(fn, /\.neq\('state', 'inside_site'\)/)
  assert.match(fn, /\.eq\('is_active', true\)/)
  assert.match(fn, /\.eq\('status', 'active'\)/)
  assert.match(fn, /\.range\(/)
  assert.match(
    fn,
    /if \(owners\.length\) query = query\.in\('ownership_status'/,
  )
  assert.match(fn, /from\('equipment'\)[\s\S]*?\.in\(\s*'id',/)
})

test('the fleet section titles, no «الان», Takween in its filter', () => {
  const section = read(
    'src',
    'components',
    'admin-home',
    'FleetStateSection.tsx',
  )
  assert.doesNotMatch(section, /adminHomeNow/)
  assert.match(section, /<FleetOwnerFilter/)
  const home = read('src', 'screens', 'admin-home', 'AdminHomeScreen.tsx')
  assert.match(home, /title="adminHomeFleetTablesTitle"/)
  const translations = read('src', 'i18n', 'translations.ts')
  assert.match(translations, /adminHomeStateTitle: 'حالة الاسطول'/)
  assert.match(translations, /adminHomeFleetTablesTitle: 'الورشة والمتاحة'/)
  assert.doesNotMatch(translations, /adminHomeStateTitle: 'الحالة الان'/)
})
