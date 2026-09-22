const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')

/**
 * Loads a source module, resolving `@/...` and relative imports to the real
 * files. Anything outside `src` (react, radix, lucide) is stubbed: these tests
 * only exercise module-level data and pure helpers, never rendering.
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

const configs = loadModule(path.join(ROOT, 'src', 'lib', 'listConfigs.ts'))
const { resolveListLabel, resolveOptionLabel } = loadModule(
  path.join(ROOT, 'src', 'components', 'data-list', 'labels.ts'),
)

const ALL = Object.values(configs)
const ARABIC = /\p{Script=Arabic}/u

/** The Arabic wording each config showed before labels became translatable;
 *  the migration must not change a single word of it. */
const ARABIC_SNAPSHOT = {
  drivers: {
    search: 'البحث بالاسم او الهوية او الجوال',
    filters: ['الجنسية', 'نوع التوظيف', 'المسمى الوظيفي'],
    sorts: ['الاسم', 'الاسم بالانجليزي', 'تاريخ الإنشاء', 'تاريخ التعديل'],
  },
  equipment: {
    search: 'البحث بالكود او اللوحة او الشاصي او النوع',
    // The `is_active` boolean filter («نشطة») was replaced by the lifecycle
    // status filter in wave 6 batch 3.
    filters: ['الحالة التشغيلية', 'المالك', 'حالة المعدة'],
  },
  companies: {
    search: 'البحث باسم الشركة',
    filters: ['الاسم العربي', 'الاسم الإنجليزي'],
  },
  lessors: { search: 'البحث بالاسم أو جهة الاتصال أو الجوال' },
  logs: {
    filters: [
      'نوع الحركة',
      'وقت الحركة',
      'المالك',
      'الشركة',
      'المشروع',
      'الفورمان',
      'غرض الورشة',
    ],
    sorts: ['وقت الحركة', 'وقت الانشاء', 'نوع الحركة', 'كود المعدة'],
  },
  users: { search: 'البحث باسم المستخدم', filters: ['الدور'] },
  visits: { sorts: ['وقت الدخول', 'وقت الخروج', 'كود المعدة'] },
}

test('every list config label resolves in both languages', () => {
  for (const config of ALL) {
    const labels = [
      config.searchPlaceholder,
      ...config.filterFields.map((field) => field.label),
      ...config.sortableFields.map((field) => field.label),
    ]
    for (const label of labels) {
      for (const lang of ['ar', 'en']) {
        const text = resolveListLabel(label, lang)
        assert.equal(typeof text, 'string')
        assert.ok(text.trim().length > 0, `empty ${lang} label in ${config.id}`)
      }
    }
  }
})

test('no config label falls back to Arabic in the English UI', () => {
  for (const config of ALL) {
    const labels = [
      config.searchPlaceholder,
      ...config.filterFields.map((field) => field.label),
      ...config.sortableFields.map((field) => field.label),
    ]
    for (const label of labels) {
      const english = resolveListLabel(label, 'en')
      assert.ok(
        !ARABIC.test(english),
        `${config.id}: English UI would show Arabic "${english}"`,
      )
    }
  }
})

test('the Arabic wording is unchanged', () => {
  for (const [id, expected] of Object.entries(ARABIC_SNAPSHOT)) {
    const config = ALL.find((item) => item.id === id)
    assert.ok(config, `missing config ${id}`)
    if (expected.search)
      assert.equal(
        resolveListLabel(config.searchPlaceholder, 'ar'),
        expected.search,
      )
    if (expected.filters)
      assert.deepEqual(
        Array.from(config.filterFields, (field) =>
          resolveListLabel(field.label, 'ar'),
        ),
        expected.filters,
      )
    if (expected.sorts)
      assert.deepEqual(
        Array.from(config.sortableFields, (field) =>
          resolveListLabel(field.label, 'ar'),
        ),
        expected.sorts,
      )
  }
})

test('static filter options are translated, runtime options are not', () => {
  for (const config of ALL)
    for (const field of config.filterFields)
      for (const option of field.options ?? []) {
        assert.ok(option.value, `${config.id}.${field.key}: empty option value`)
        if (!option.labelI18n) continue
        const english = resolveOptionLabel(option, 'en')
        assert.ok(english.trim().length > 0)
        assert.ok(
          !ARABIC.test(english),
          `${config.id}.${field.key}: English option "${english}"`,
        )
        // An option that already shipped Arabic text keeps exactly that text;
        // options that used to show a raw database value now read properly.
        const arabic = resolveOptionLabel(option, 'ar')
        assert.ok(ARABIC.test(arabic), `${config.id}.${field.key}: ${arabic}`)
        if (ARABIC.test(option.label)) assert.equal(arabic, option.label)
      }
})

test('an option with no labelI18n keeps its own text (foreman names)', () => {
  const name = 'سالم العمري'
  assert.equal(resolveOptionLabel({ value: 'f1', label: name }, 'en'), name)
  assert.equal(resolveOptionLabel({ value: 'f1', label: name }, 'ar'), name)
})

test('a label that is neither a key nor a pair is used as written', () => {
  // Keeps older configs and runtime-built labels working.
  assert.equal(resolveListLabel('Some list label', 'en'), 'Some list label')
  assert.equal(resolveListLabel({ ar: 'الاسم', en: 'Name' }, 'en'), 'Name')
  assert.equal(resolveListLabel({ ar: 'الاسم', en: 'Name' }, 'ar'), 'الاسم')
})
