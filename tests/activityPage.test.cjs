// The rebuilt activity page (owner 2026-11-02, approved on /ui-kit «نموذج
// صفحة النشاط الجديدة»): /activity is one unified list over the movement
// log and the equipment change log through the view `activity_log`
// (migration 0170), on the shared list system — nothing is merged in the
// browser. Static checks of the screen, the config and the pure module, plus
// the pure module's behaviour loaded through the TypeScript compiler.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

const screen = read('src', 'screens', 'ActivityScreen.tsx')
const lib = read('src', 'lib', 'activityLog.ts')
const fields = read('src', 'lib', 'activityFields.ts')
const actorFilter = read('src', 'lib', 'activityActorFilter.ts')
const configs = read('src', 'lib', 'listConfigs.ts')
const app = read('src', 'App.tsx')
const translations = read('src', 'i18n', 'translations.ts')
const agents = read('AGENTS.md')

const configStart = configs.indexOf('export const activityListConfig')
assert.ok(configStart > 0, 'activityListConfig exists')
const configEnd = configs.indexOf('\nexport const ', configStart + 1)
const config = configs.slice(configStart, configEnd)

/** Loads a `src` module (and its `@/` imports) through tsc, no bundler. */
function loadModule(relative, cache = new Map()) {
  const file = path.join(ROOT, 'src', `${relative}.ts`)
  if (cache.has(file)) return cache.get(file)
  const exports = {}
  cache.set(file, exports)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: 'es2020' },
  }).outputText
  const localRequire = (specifier) => {
    if (!specifier.startsWith('@/'))
      throw new Error(`Unexpected import ${specifier} in ${relative}`)
    return loadModule(specifier.slice(2), cache)
  }
  vm.runInNewContext(
    code,
    { exports, require: localRequire, process, Intl, URLSearchParams },
    { filename: file },
  )
  return exports
}

const activity = loadModule('lib/activityLog')
/** Values from the VM realm carry other prototypes: compare them as JSON. */
const plain = (value) => JSON.parse(JSON.stringify(value))
const t = (key) => `[${key}]`

test('the router opens ActivityScreen at /activity; the old screen is gone', () => {
  assert.match(app, /import\('@\/screens\/ActivityScreen'\)/)
  assert.match(app, /page === 'activity' && <ActivityScreen \/>/)
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'src', 'screens', 'MovementActivity.tsx')),
    'MovementActivity.tsx was replaced',
  )
  assert.doesNotMatch(app, /MovementActivity/)
})

test('one server-side list over the view: no client merge, standard list state', () => {
  assert.match(screen, /useDataListState\(activityListConfig\)/)
  assert.match(screen, /<DataListToolbar/)
  assert.match(screen, /<DataListPagination/)
  assert.match(screen, /\.from\('activity_log'\)/)
  assert.match(screen, /applyListFilters\(/)
  assert.match(screen, /buildSearchFilter\(\s*activityListConfig\.searchFields/)
  assert.match(screen, /\.range\(\(list\.page - 1\) \* list\.pageSize/)
  // Never the two tables directly, never both lists concatenated here.
  assert.doesNotMatch(
    screen,
    /from\('movement_audit_logs'\)|from\('equipment_audit_logs'\)/,
  )
  assert.doesNotMatch(screen, /\[\.\.\.\w+Rows, \.\.\.\w+Rows\]|\.concat\(/)
  // Deterministic paging: created_at then the log row's id.
  assert.match(screen, /\.order\('source_id'/)
  // The «الحقل» filter overlaps changed_fields on the server.
  assert.match(screen, /query\.overlaps\('changed_fields', fields\)/)
  // A failed load is an error state with retry, never an empty list.
  assert.match(
    screen,
    /<ErrorState description=\{t\('activityLoadError'\)\} onRetry=\{fetchRows\} \/>/,
  )
})

test('the config: allowlisted keys only, the view columns, newest first', () => {
  assert.match(config, /id: 'activity'/)
  assert.match(config, /searchFields: \['equipment_code', 'actor_name'\]/)
  assert.match(config, /defaultSort: 'created_at'/)
  assert.match(config, /defaultDirection: 'desc'/)
  const keys = [...config.matchAll(/^\s{6}key: ([^,\n]+),/gm)].map((m) => m[1])
  assert.deepEqual(keys, [
    'ACTIVITY_KIND_FILTER_KEY',
    "'action'",
    "'actor_id'",
    "'movement_context'",
    'ACTIVITY_FIELD_FILTER_KEY',
    "'created_at'",
  ])
  assert.match(fields, /export const ACTIVITY_KIND_FILTER_KEY = 'kind'/)
  assert.match(
    fields,
    /export const ACTIVITY_FIELD_FILTER_KEY = 'changed_fields'/,
  )
  // listConfigs imports only the light fields module (its tests load it
  // through tsc without a bundler).
  assert.match(configs, /\} from '@\/lib\/activityFields'/)
  assert.doesNotMatch(configs, /from '@\/lib\/activityLog'/)
  // The context only for movements, the field only for equipment changes.
  assert.match(
    config,
    /key: 'movement_context',[\s\S]*?visibleWhen: \{ field: ACTIVITY_KIND_FILTER_KEY, includes: 'movement' \}/,
  )
  assert.match(
    config,
    /key: ACTIVITY_FIELD_FILTER_KEY,[\s\S]*?visibleWhen: \{ field: ACTIVITY_KIND_FILTER_KEY, includes: 'equipment' \}/,
  )
  // The date filter is the shared date type (month presets in FilterBar).
  assert.match(
    config,
    /key: 'created_at',\s+label: 'activityColTime',\s+type: 'date'/,
  )
  // The actor is an async multi-select over profile_names, plus «النظام».
  assert.match(actorFilter, /\.from\('profile_names'\)/)
  assert.match(actorFilter, /value: ACTIVITY_SYSTEM_ACTOR/)
  assert.match(lib, /export const ACTIVITY_SYSTEM_ACTOR = EMPTY_FILTER_VALUE/)
  assert.match(
    screen,
    /actor_id: activityActorFilterOptions\(supabase, t\('system'\)\)/,
  )
})

test('the field filter and the column keys', () => {
  const {
    activityColumnFilterKeys,
    activityFieldFilterValues,
    EQUIPMENT_AUDIT_FIELDS,
  } = activity
  const fieldKeys = EQUIPMENT_AUDIT_FIELDS.map((field) => field.key)
  for (const key of [
    'status',
    'ownership_status',
    'lessor_id',
    'code',
    'type',
    'plate_number',
    'chassis_number',
    'is_active',
    'tracker_unit_id',
    'project_id',
  ])
    assert.ok(fieldKeys.includes(key), key)
  const cfg = {
    filterFields: [
      { key: 'kind' },
      { key: 'action' },
      { key: 'changed_fields' },
      { key: 'created_at' },
    ],
  }
  assert.deepEqual(plain([...activityColumnFilterKeys(cfg)]), [
    'kind',
    'action',
    'created_at',
  ])
  assert.deepEqual(
    plain(
      activityFieldFilterValues([
        {
          id: '1',
          field: 'changed_fields',
          operator: 'in',
          value: 'status, plate_number,bogus',
        },
      ]),
    ),
    ['status', 'plate_number'],
  )
  assert.deepEqual(plain(activityFieldFilterValues([])), [])
})

test('the old URL parameters still work: action, context, kind → filters', () => {
  const { legacyActivityParams } = activity
  assert.equal(legacyActivityParams(new URLSearchParams('q=A028&page=2')), null)
  const fromAction = legacyActivityParams(
    new URLSearchParams('q=A028&action=delete'),
  )
  assert.equal(fromAction.get('q'), 'A028')
  assert.equal(fromAction.has('action'), false)
  assert.deepEqual(JSON.parse(fromAction.get('filters')), [
    { id: 'action', field: 'action', operator: 'eq', value: 'delete' },
  ])
  // A context is a movement filter: the kind comes with it.
  const fromContext = legacyActivityParams(
    new URLSearchParams('context=workshop&action=update'),
  )
  assert.deepEqual(JSON.parse(fromContext.get('filters')), [
    { id: 'kind', field: 'kind', operator: 'eq', value: 'movement' },
    { id: 'action', field: 'action', operator: 'eq', value: 'update' },
    {
      id: 'context',
      field: 'movement_context',
      operator: 'eq',
      value: 'workshop',
    },
  ])
  // The mockup's card link.
  const fromKind = legacyActivityParams(
    new URLSearchParams('kind=equipment&q=A028'),
  )
  assert.deepEqual(JSON.parse(fromKind.get('filters')), [
    { id: 'kind', field: 'kind', operator: 'eq', value: 'equipment' },
  ])
  // An unknown value is dropped, not passed to the server.
  assert.equal(
    legacyActivityParams(new URLSearchParams('action=drop')).has('filters'),
    false,
  )
  // Explicit filters win over legacy keys.
  const both = legacyActivityParams(
    new URLSearchParams('action=create&filters=%5B%5D'),
  )
  assert.equal(both.get('filters'), '[]')
  assert.equal(both.has('action'), false)
  // The screen applies it in place.
  assert.match(
    screen,
    /legacyActivityParams\(new URLSearchParams\(params\.toString\(\)\)\)/,
  )
  assert.match(screen, /window\.history\.replaceState\(/)
})

test('values render humanly: labels, booleans, dates, names', () => {
  const { formatActivityValue } = activity
  assert.equal(
    formatActivityValue('equipment', 'status', 'sold', t),
    '[equipmentStatusSold]',
  )
  assert.equal(
    formatActivityValue('equipment', 'status', 'rental_ended', t),
    '[equipmentStatusRentalEnded]',
  )
  assert.equal(
    formatActivityValue('equipment', 'ownership_status', 'alazani', t),
    '[ownershipAlazani]',
  )
  assert.equal(
    formatActivityValue(
      'equipment',
      'ownership_status',
      'external_supplier',
      t,
    ),
    '[ownershipExternalSupplier]',
  )
  // The owner keys are the ones ownershipBadge gives the badges.
  const form = read('src', 'lib', 'equipmentForm.ts')
  for (const [value, key] of [
    ['alazani', 'ownershipAlazani'],
    ['takween', 'ownershipTakween'],
    ['third_party_f', 'ownershipThirdPartyF'],
    ['third_party_partnership_b', 'ownershipThirdPartyPartnershipB'],
  ]) {
    assert.equal(
      formatActivityValue('equipment', 'ownership_status', value, t),
      `[${key}]`,
    )
    assert.match(
      form,
      new RegExp(`status === '${value}'[\\s\\S]{0,80}key: '${key}'`),
    )
  }
  assert.equal(formatActivityValue('equipment', 'is_active', false, t), '[no]')
  assert.equal(formatActivityValue('equipment', 'is_active', true, t), '[yes]')
  assert.equal(formatActivityValue('equipment', 'code', null, t), '—')
  assert.equal(formatActivityValue('equipment', 'code', '', t), '—')
  // 0168 stores the supplier's name; an unresolved id is shortened.
  assert.equal(
    formatActivityValue('equipment', 'lessor_id', 'مؤسسة الرواد', t),
    'مؤسسة الرواد',
  )
  assert.equal(
    formatActivityValue(
      'equipment',
      'lessor_id',
      '0b9f4c1e-2d3a-4b5c-8d6e-7f8091a2b3c4',
      t,
    ),
    '0b9f4c1e…',
  )
  // A date-only column stays a date; an instant is a Saudi date-time.
  assert.match(
    formatActivityValue('equipment', 'registration_expiry', '2026-12-31', t),
    /2026/,
  )
  assert.doesNotMatch(
    formatActivityValue('equipment', 'registration_expiry', '2026-12-31', t),
    /T/,
  )
  assert.match(
    formatActivityValue(
      'movement',
      'recorded_at',
      '2026-11-02T06:55:00+00:00',
      t,
    ),
    /2026/,
  )
  assert.equal(
    formatActivityValue('movement', 'movement_type', 'exit', t),
    '[exit]',
  )
  assert.equal(
    formatActivityValue('movement', 'movement_context', 'site', t),
    '[activityContextSite]',
  )
  assert.equal(
    formatActivityValue('movement', 'exit_purpose', 'work_completed', t),
    '[exitPurposeWorkCompleted]',
  )
  assert.equal(
    formatActivityValue('equipment', 'registration_type', 'heavy_equipment', t),
    '[heavyEquipment]',
  )
  assert.equal(
    formatActivityValue('equipment', 'manufacture_year', 2019, t),
    '2019',
  )
})

test('field labels, record links and the fields count', () => {
  const {
    activityFieldLabelKey,
    activityHref,
    activityFieldsCountKey,
    activityChanges,
  } = activity
  assert.equal(
    activityFieldLabelKey('equipment', 'plate_number'),
    'plateNumber',
  )
  assert.equal(
    activityFieldLabelKey('equipment', 'is_active'),
    'activityFieldIsActive',
  )
  assert.equal(
    activityFieldLabelKey('movement', 'driver_change'),
    'driverCorrectionAuditField',
  )
  assert.equal(activityFieldLabelKey('movement', 'exit_purpose'), 'exitPurpose')
  assert.equal(activityFieldLabelKey('equipment', 'unknown_column'), null)
  assert.equal(
    activityHref({ kind: 'movement', action: 'update', record_id: 'm1' }),
    '/movements/m1',
  )
  assert.equal(
    activityHref({ kind: 'equipment', action: 'create', record_id: 'e1' }),
    '/equipment/e1',
  )
  assert.equal(
    activityHref({ kind: 'equipment', action: 'delete', record_id: 'e1' }),
    null,
  )
  assert.equal(
    activityHref({ kind: 'equipment', action: 'update', record_id: null }),
    null,
  )
  assert.equal(activityFieldsCountKey(1), 'activityFieldsOne')
  assert.equal(activityFieldsCountKey(2), 'activityFieldsTwo')
  assert.equal(activityFieldsCountKey(5), 'activityFieldsFew')
  assert.equal(activityFieldsCountKey(11), 'activityFieldsMany')
  assert.deepEqual(
    plain(
      activityChanges({
        changed_fields: ['status', 'is_active'],
        old_values: { status: 'active', is_active: true },
        new_values: { status: 'sold' },
      }),
    ),
    [
      { key: 'status', before: 'active', after: 'sold' },
      { key: 'is_active', before: true, after: null },
    ],
  )
})

test('the kind switch is the kind filter', () => {
  const { activityKindOf, withActivityKind } = activity
  const action = { id: 'a', field: 'action', operator: 'eq', value: 'create' }
  assert.equal(activityKindOf([]), null)
  assert.equal(
    activityKindOf([
      { id: 'k', field: 'kind', operator: 'eq', value: 'movement' },
    ]),
    'movement',
  )
  assert.deepEqual(plain(withActivityKind([action], 'equipment')), [
    { id: 'kind', field: 'kind', operator: 'eq', value: 'equipment' },
    action,
  ])
  assert.deepEqual(
    plain(
      withActivityKind(
        [
          { id: 'kind', field: 'kind', operator: 'eq', value: 'equipment' },
          action,
        ],
        null,
      ),
    ),
    [action],
  )
  assert.match(
    screen,
    /<TabsList variant="segmented" aria-label=\{t\('activityKindFilter'\)\}>/,
  )
  assert.match(screen, /actions=\{kindSwitch\}/)
})

test('the approved look: table columns, chips, expandable row, cards on phones', () => {
  assert.match(screen, /cellTextClassName="text-\[13px\]"/)
  assert.match(screen, /cellClassName="py-2"/)
  for (const header of [
    "t('activityColTime')",
    "t('user')",
    "t('activityKindFilter')",
    "t('activityColRecord')",
    "t('activityColChanges')",
  ])
    assert.match(
      screen,
      new RegExp(`header: ${header.replace(/[()]/g, '\\$&')}`),
      header,
    )
  assert.match(
    screen,
    /create: 'success',\s+update: 'neutral',\s+delete: 'danger'/,
  )
  assert.match(screen, /const CHIPS_SHOWN = 3/)
  assert.match(screen, /\+\{rest\}/)
  assert.match(screen, /expandable=\{\{\s+render: \(row\) => <ChangesPanel/)
  assert.match(screen, /<div className="hidden md:block">/)
  assert.match(screen, /<div className="space-y-2 md:hidden">/)
  assert.match(screen, /function ActivityCard\(/)
  // The identity is a real link to the movement or the unit.
  assert.match(
    screen,
    /<AppLink\s+href=\{href\}\s+className="w-fit font-semibold hover:underline"/,
  )
  // «منذ …» under the time, from the shared words.
  assert.match(screen, /elapsedInWords\(at, lang\)/)
  // The tab title is the page's («سجل النشاط · حركة المعدات» through tabTitle).
  assert.match(
    read('src', 'lib', 'pageTitle.ts'),
    /activity: \{ kind: 'top', name: 'activityLog' \}/,
  )
})

test('project tokens only, logical directions, no new dependency', () => {
  const palette =
    /\b(?:bg|text|border|fill|stroke|from|to|via|ring|outline)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
  for (const [name, source] of Object.entries({
    screen,
    lib,
    fields,
    actorFilter,
  })) {
    assert.doesNotMatch(
      source,
      /#[0-9a-fA-F]{3,8}\b/,
      `${name} has a hex color`,
    )
    assert.doesNotMatch(
      source,
      palette,
      `${name} uses a Tailwind palette class`,
    )
    assert.doesNotMatch(source, /gradient/i, `${name} uses a gradient`)
    assert.doesNotMatch(
      source,
      /\b(?:ml|mr|pl|pr|left|right|text-left|text-right)-/,
      `${name} uses a physical direction class`,
    )
  }
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.dependencies['libpg-query'], undefined)
})

test('the new Arabic copy uses plain alif (no أ / إ / آ)', () => {
  for (const [name, source] of Object.entries({
    screen,
    lib,
    fields,
    actorFilter,
    config,
  }))
    assert.doesNotMatch(source, /[أإآ]/, `${name} has alif with hamza or madda`)
  const keys = [
    'activityKindFilter',
    'activityKindMovement',
    'activityKindEquipment',
    'activityColTime',
    'activityColRecord',
    'activityColChanges',
    'activityFieldFilter',
    'activityContextSite',
    'activityNewEquipment',
    'activityEquipmentDeleted',
    'activityFieldsOne',
    'activityFieldsMany',
    'activitySince',
    'activityBefore',
    'activityAfter',
    'activityAllChanges',
    'activityHideDetails',
    'activityEquipmentPage',
    'activityEmptyFiltered',
    'activityLoadError',
    'activityFieldIsActive',
    'activityFieldTrackerUnit',
    'activityFieldOperationalStatus',
    'activityFieldMasterDataComplete',
  ]
  for (const key of keys) {
    const matches = [
      ...translations.matchAll(
        new RegExp(`^\\s+${key}:\\s*\\n?\\s*'([^']*)'`, 'gm'),
      ),
    ]
    assert.equal(matches.length, 2, `${key} in both languages`)
    assert.doesNotMatch(matches[0][1], /[أإآ]/, `${key} Arabic copy`)
  }
  const arDesc = translations.match(/activityLogDesc:\s*\n?\s*'([^']*)'/)[1]
  assert.doesNotMatch(arDesc, /[أإآ]/)
  assert.match(arDesc, /المعدات/)
  // AGENTS.md records the page and the owner's exclusion of the equipment card.
  assert.match(agents, /activity_log/)
  assert.match(agents, /سجل التعديلات/)
})
