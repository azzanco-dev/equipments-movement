const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files
// so the /inquiry helpers are exercised exactly as the screen uses them.
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

const {
  buildEquipmentSuggestFilter,
  parseEquipmentIdParam,
  deriveEquipmentState,
} = loadLibModule('equipmentInquiry')

// The module runs in its own vm realm, so the objects it returns do not share
// this realm's prototypes. Comparing plain copies keeps the assertions strict.
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

// --- buildEquipmentSuggestFilter -------------------------------------------

test('buildEquipmentSuggestFilter returns null for an empty term', () => {
  assert.equal(buildEquipmentSuggestFilter(''), null)
  assert.equal(buildEquipmentSuggestFilter('   '), null)
})

test('buildEquipmentSuggestFilter searches code/type/plate/chassis', () => {
  const filter = buildEquipmentSuggestFilter('A120')
  assert.equal(
    filter,
    'code.ilike.%A120%,type.ilike.%A120%,plate_number.ilike.%A120%,chassis_number.ilike.%A120%',
  )
})

test('buildEquipmentSuggestFilter adds a plate_digits probe for a digits-only term', () => {
  const filter = buildEquipmentSuggestFilter('1234')
  assert.equal(
    filter,
    'code.ilike.%1234%,type.ilike.%1234%,plate_number.ilike.%1234%,chassis_number.ilike.%1234%,plate_digits.ilike.%1234%',
  )
})

test('buildEquipmentSuggestFilter never splits a plate into letters', () => {
  // "a341" must search as one plain-text term (never a plate_digits probe for
  // "341" alone, and never a separate plate-letters probe for "A").
  const filter = buildEquipmentSuggestFilter('a341')
  assert.ok(filter.includes('code.ilike.%a341%'))
  assert.ok(!filter.includes('plate_digits'))
  assert.ok(!filter.includes('plate_letters'))
})

test('buildEquipmentSuggestFilter converts Arabic-Indic digits before probing plate_digits', () => {
  const filter = buildEquipmentSuggestFilter('١٢٣٤')
  assert.ok(filter.includes('plate_digits.ilike.%1234%'))
})

test('buildEquipmentSuggestFilter strips PostgREST-structural characters', () => {
  const filter = buildEquipmentSuggestFilter('a1,2).3')
  assert.ok(!filter.includes(','.repeat(2)))
  assert.ok(!filter.includes(')'))
  // sanitizeSearchTerm collapses the stripped characters to single spaces,
  // and the resulting term is still searched as plain text.
  assert.ok(filter.includes('code.ilike.%a1 2 3%'))
})

// --- parseEquipmentIdParam ---------------------------------------------------

test('parseEquipmentIdParam accepts a well-formed uuid', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000'
  assert.equal(parseEquipmentIdParam(id), id)
})

test('parseEquipmentIdParam trims surrounding whitespace', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000'
  assert.equal(parseEquipmentIdParam(`  ${id}  `), id)
})

test('parseEquipmentIdParam rejects null, empty, and non-uuid values', () => {
  assert.equal(parseEquipmentIdParam(null), null)
  assert.equal(parseEquipmentIdParam(undefined), null)
  assert.equal(parseEquipmentIdParam(''), null)
  assert.equal(parseEquipmentIdParam('drop table equipment;'), null)
  assert.equal(parseEquipmentIdParam('123'), null)
})

// --- deriveEquipmentState ----------------------------------------------------

function lastMovement(overrides = {}) {
  return {
    movement_type: 'entry',
    movement_context: 'site',
    workshop_purpose: null,
    recorded_at: '2026-09-10T06:00:00Z',
    company_name_ar: 'شركة تكوين',
    company_name_en: 'Takween',
    project_name_ar: 'مشروع الرياض',
    project_name_en: 'Riyadh Project',
    supervisor_name: 'Saad',
    ...overrides,
  }
}

test('deriveEquipmentState reports outside with no movement at all', () => {
  assert.deepEqual(plain(deriveEquipmentState(null)), {
    presence: 'outside',
    companyNameAr: null,
    companyNameEn: null,
    projectNameAr: null,
    projectNameEn: null,
    supervisorName: null,
    workshopPurpose: null,
    since: null,
  })
  assert.equal(deriveEquipmentState(undefined).presence, 'outside')
})

test('deriveEquipmentState reports outside when the latest movement is an exit', () => {
  const state = deriveEquipmentState(lastMovement({ movement_type: 'exit' }))
  assert.equal(state.presence, 'outside')
  assert.equal(state.companyNameAr, null)
})

test('deriveEquipmentState reports inside_site with company/project/foreman', () => {
  const state = deriveEquipmentState(lastMovement())
  assert.equal(state.presence, 'inside_site')
  assert.equal(state.companyNameEn, 'Takween')
  assert.equal(state.projectNameEn, 'Riyadh Project')
  assert.equal(state.supervisorName, 'Saad')
  assert.equal(state.since, '2026-09-10T06:00:00Z')
  assert.equal(state.workshopPurpose, null)
})

test('deriveEquipmentState reports inside_workshop with the purpose, no company/project', () => {
  const state = deriveEquipmentState(
    lastMovement({
      movement_context: 'workshop',
      workshop_purpose: 'maintenance',
      company_name_ar: null,
      company_name_en: null,
      project_name_ar: null,
      project_name_en: null,
    }),
  )
  assert.equal(state.presence, 'inside_workshop')
  assert.equal(state.workshopPurpose, 'maintenance')
  assert.equal(state.companyNameEn, null)
  assert.equal(state.projectNameEn, null)
  assert.equal(state.supervisorName, 'Saad')
})
