const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-10-29: «حلو التاريخ والتصبيحة، اعتمدها في الرئيسية، واضف مربعين
// الاسطول وفي المشاريع للرئيسية» (from the /ui-kit home mockup).

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
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

test('the greeting and the day follow Saudi time', () => {
  const greeting = loadLib('homeGreeting')
  // 06:30 UTC = 09:30 Riyadh; 09:00 UTC = 12:00; 21:30 UTC = 00:30 next day.
  assert.equal(
    greeting.saudiGreetingPeriod(new Date('2026-10-29T06:30:00Z')),
    'morning',
  )
  assert.equal(
    greeting.saudiGreetingPeriod(new Date('2026-10-29T09:00:00Z')),
    'evening',
  )
  assert.equal(
    greeting.saudiGreetingPeriod(new Date('2026-10-28T21:30:00Z')),
    'morning',
  )
  assert.equal(
    greeting.saudiDayLabel(new Date('2026-10-29T06:30:00Z'), 'ar'),
    'الخميس 29 اكتوبر',
  )
  assert.equal(
    greeting.saudiDayLabel(new Date('2026-10-29T06:30:00Z'), 'en'),
    'Thursday 29 October',
  )
  // The Saudi day, not the UTC one: 22:00 UTC on the 28th is the 29th.
  assert.match(
    greeting.saudiDayLabel(new Date('2026-10-28T22:00:00Z'), 'ar'),
    / 29 /,
  )
  assert.doesNotMatch(
    greeting.saudiDayLabel(new Date('2026-04-15T06:00:00Z'), 'ar'),
    /[أإآ]/,
  )
})

test('ownerTotals covers all five owners and adds up', () => {
  const stats = loadLib('adminHomeStats')
  const matrix = stats.parseOwnerStateMatrix({
    total: 10,
    cells: [
      { owner: 'alazani', state: 'inside_site', count: 4 },
      { owner: 'alazani', state: 'available', count: 2 },
      { owner: 'takween', state: 'inside_site', count: 1 },
      { owner: 'external_supplier', state: 'workshop_parking', count: 3 },
    ],
  })
  const fleet = stats.ownerTotals(matrix, stats.FLEET_STATES)
  assert.equal(fleet.total, 10)
  assert.deepEqual(
    [...fleet.owners.map((row) => `${row.owner}:${row.count}`)],
    [
      'alazani:6',
      'takween:1',
      'third_party_f:0',
      'third_party_partnership_b:0',
      'external_supplier:3',
    ],
  )
  const sites = stats.ownerTotals(matrix, ['inside_site'])
  assert.equal(sites.total, 5)
  assert.equal(sites.owners[0].count, 4)
})

test('the cards read every owner and link to the filtered equipment list', () => {
  const data = read('src', 'lib', 'adminHomeData.ts')
  assert.match(
    data,
    /fetchAllOwnersStateMatrix[\s\S]*?rpc\('get_admin_owner_state_matrix', \{ p_owners: null \}\)/,
  )
  const section = read(
    'src',
    'components',
    'admin-home',
    'OwnerTotalsSection.tsx',
  )
  assert.match(section, /ownerTotals\(data, FLEET_STATES\)/)
  assert.match(section, /ownerTotals\(data, \['inside_site'\]\)/)
  assert.match(section, /field: 'ownership_status'/)
  assert.match(
    section,
    /field: 'equipment_state',\s*operator: 'eq',\s*value: state/,
  )
  assert.match(section, /canOpenEquipment\s*\?/)
  const screen = read('src', 'screens', 'admin-home', 'AdminHomeScreen.tsx')
  assert.match(
    screen,
    /<OwnerTotalsSection canOpenEquipment=\{Boolean\(onSelectEquipment\)\} \/>/,
  )
  assert.ok(
    screen.indexOf('<OwnerTotalsSection') <
      screen.indexOf('<FleetStateSection'),
  )
  assert.match(screen, /description=\{saudiDayLabel\(now, lang\)\}/)
  assert.match(screen, /'adminHomeGreetingMorning'/)
})
