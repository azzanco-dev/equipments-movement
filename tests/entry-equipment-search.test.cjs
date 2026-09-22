const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files.
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(__dirname, '..', 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const { entryEquipmentArgs, equipmentStateOption, saudiDaysSince } =
  loadLibModule('entryEquipmentSearch')

// The real Arabic/English copy for the keys the mapping uses.
const AR = {
  insideSiteBadge: 'داخل موقع',
  insideWorkshopBadge: 'في الورشة',
  sinceDays: 'منذ {count} يوم',
  maintenancePurpose: 'صيانة',
  parkingPurpose: 'وقوف',
  pendingClassification: 'غير محدد',
}
const EN = {
  insideSiteBadge: 'Inside site',
  insideWorkshopBadge: 'In workshop',
  sinceDays: '{count} days ago',
  maintenancePurpose: 'Maintenance',
  parkingPurpose: 'Parking',
  pendingClassification: 'Unclassified',
}
const ar = (key) => AR[key]
const en = (key) => EN[key]

// The helper runs in a vm realm, so its objects are compared field by field.
function assertArgs(actual, expected) {
  assert.equal(actual.p_search, expected.p_search)
  assert.equal(actual.p_ownership_status, expected.p_ownership_status)
  assert.equal(actual.p_plate_digits, expected.p_plate_digits)
}

test('the entry equipment search sends null instead of empty arguments', () => {
  assertArgs(entryEquipmentArgs('', ''), {
    p_search: null,
    p_ownership_status: null,
    p_plate_digits: null,
  })
  assertArgs(entryEquipmentArgs('  ', 'takween'), {
    p_search: null,
    p_ownership_status: 'takween',
    p_plate_digits: null,
  })
})

test('a digits-only term still probes plate digits', () => {
  assertArgs(entryEquipmentArgs('4821', ''), {
    p_search: '4821',
    p_ownership_status: null,
    p_plate_digits: '4821',
  })
  assert.equal(entryEquipmentArgs('48 21', '').p_plate_digits, '4821')
})

test('a code-like term stays plain text and never becomes plate parts', () => {
  const args = entryEquipmentArgs('a341', '')
  assert.equal(args.p_search, 'a341')
  assert.equal(args.p_plate_digits, null)
})

test('days are counted by Saudi calendar day, not by 24-hour blocks', () => {
  // 2026-09-18T21:30Z is already 2026-09-19 in Saudi time (+03:00), so a visit
  // opened then is 0 days old on 2026-09-19 and 1 day old on 2026-09-20.
  assert.equal(
    saudiDaysSince('2026-09-18T21:30:00Z', '2026-09-19T05:00:00Z'),
    0,
  )
  assert.equal(
    saudiDaysSince('2026-09-18T21:30:00Z', '2026-09-20T05:00:00Z'),
    1,
  )
  // 2026-09-18T20:30Z is still 2026-09-18 in Saudi time: one day earlier.
  assert.equal(
    saudiDaysSince('2026-09-18T20:30:00Z', '2026-09-19T05:00:00Z'),
    1,
  )
  // Nine days, including the month boundary.
  assert.equal(
    saudiDaysSince('2026-08-30T06:00:00Z', '2026-09-08T06:00:00Z'),
    9,
  )
})

test('a future or unreadable timestamp never produces a negative day count', () => {
  assert.equal(
    saudiDaysSince('2026-09-20T06:00:00Z', '2026-09-19T06:00:00Z'),
    0,
  )
  assert.equal(saudiDaysSince('not a date', '2026-09-19T06:00:00Z'), 0)
})

test('equipment inside a site gets the badge and one company/project line', () => {
  const option = equipmentStateOption(
    {
      id: 'eq-1',
      code: 'A282',
      state: 'inside_site',
      state_since: '2026-09-15T07:00:00Z',
      state_company_name_ar: 'العزاني',
      state_company_name_en: 'Alazani',
      state_project_name_ar: 'مشروع الرياض',
      state_project_name_en: 'Riyadh project',
    },
    'ar',
    ar,
    '2026-09-19T07:00:00Z',
  )
  assert.equal(option.value, 'eq-1')
  assert.equal(option.label, 'A282')
  assert.equal(option.badge.label, 'داخل موقع')
  assert.equal(option.badge.tone, 'entry')
  assert.equal(option.description, 'العزاني - مشروع الرياض · منذ 4 يوم')
})

test('the inside-site line follows the selected language', () => {
  const option = equipmentStateOption(
    {
      id: 'eq-1',
      code: 'A282',
      state: 'inside_site',
      state_since: '2026-09-17T07:00:00Z',
      state_company_name_ar: 'العزاني',
      state_company_name_en: 'Alazani',
      state_project_name_ar: 'مشروع الرياض',
      state_project_name_en: 'Riyadh project',
    },
    'en',
    en,
    '2026-09-19T07:00:00Z',
  )
  assert.equal(option.badge.label, 'Inside site')
  assert.equal(option.description, 'Alazani - Riyadh project · 2 days ago')
})

test('a visit opened today drops the day count instead of showing zero', () => {
  const option = equipmentStateOption(
    {
      id: 'eq-1',
      code: 'A282',
      state: 'inside_site',
      state_since: '2026-09-19T05:00:00Z',
      state_company_name_ar: 'العزاني',
      state_project_name_ar: 'مشروع الرياض',
    },
    'ar',
    ar,
    '2026-09-19T09:00:00Z',
  )
  assert.equal(option.description, 'العزاني - مشروع الرياض')
})

test('a missing company or project falls back instead of breaking the line', () => {
  const option = equipmentStateOption(
    {
      id: 'eq-1',
      code: 'A282',
      state: 'inside_site',
      state_since: '2026-09-19T05:00:00Z',
      state_company_name_ar: 'العزاني',
      state_project_name_ar: null,
      state_project_name_en: null,
    },
    'ar',
    ar,
    '2026-09-19T09:00:00Z',
  )
  assert.equal(option.description, 'العزاني - —')
})

test('equipment inside the workshop shows the purpose as its only line', () => {
  const maintenance = equipmentStateOption(
    {
      id: 'eq-2',
      code: 'TK10',
      state: 'inside_workshop',
      state_since: '2026-09-10T07:00:00Z',
      state_workshop_purpose: 'maintenance',
    },
    'ar',
    ar,
    '2026-09-19T07:00:00Z',
  )
  assert.equal(maintenance.badge.label, 'في الورشة')
  assert.equal(maintenance.badge.tone, 'info')
  assert.equal(maintenance.description, 'صيانة')

  const parking = equipmentStateOption(
    { id: 'eq-3', code: 'TK11', state: 'inside_workshop' },
    'ar',
    ar,
    '2026-09-19T07:00:00Z',
  )
  assert.equal(parking.description, 'غير محدد')

  const standby = equipmentStateOption(
    {
      id: 'eq-4',
      code: 'TK12',
      state: 'inside_workshop',
      state_workshop_purpose: 'parking',
    },
    'ar',
    ar,
    '2026-09-19T07:00:00Z',
  )
  assert.equal(standby.description, 'وقوف')
})

// The workshop equipment list (search_workshop_equipment) reuses this mapping
// since migration 0100. Until 0100 is applied that function returns the plain
// equipment columns, so the rows arrive without any state field: the mapping
// must degrade to "no badge, no line" instead of throwing.
test('a row from the pre-0100 workshop function maps without a badge', () => {
  const option = equipmentStateOption(
    { id: 'eq-6', code: 'TK20' },
    'ar',
    ar,
    '2026-09-22T07:00:00Z',
  )
  assert.equal(option.value, 'eq-6')
  assert.equal(option.label, 'TK20')
  assert.equal(option.badge, undefined)
  assert.equal(option.description, undefined)
})

test('a workshop row inside a site still gets the inside-site badge', () => {
  const option = equipmentStateOption(
    {
      id: 'eq-7',
      code: 'A310',
      state: 'inside_site',
      state_since: '2026-09-20T05:00:00Z',
      state_company_name_ar: 'تكوين',
      state_project_name_ar: 'مشروع جدة',
    },
    'ar',
    ar,
    '2026-09-22T07:00:00Z',
  )
  assert.equal(option.badge.label, 'داخل موقع')
  assert.equal(option.badge.tone, 'entry')
  assert.equal(option.description, 'تكوين - مشروع جدة · منذ 2 يوم')
})

test('available equipment gets no badge and no extra line', () => {
  for (const state of ['outside', 'none', null, undefined]) {
    const option = equipmentStateOption(
      { id: 'eq-5', code: 'F900', state },
      'ar',
      ar,
      '2026-09-19T07:00:00Z',
    )
    assert.equal(option.badge, undefined)
    assert.equal(option.description, undefined)
    assert.equal(option.label, 'F900')
  }
})
