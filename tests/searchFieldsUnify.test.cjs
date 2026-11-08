const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')

/** Loads a source module with `@/...` and relative imports resolved; anything
 *  outside `src` is stubbed, because these tests only call pure helpers. */
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
      URLSearchParams,
      React: { createElement: () => null },
      require(request) {
        const target = request.startsWith('@/')
          ? path.join(ROOT, 'src', request.slice(2))
          : request.startsWith('.')
            ? path.join(path.dirname(resolved), request)
            : null
        // A barrel (`@/components/ui`) or an outside package is stubbed: the
        // helpers under test never touch the components themselves.
        if (!target || !fileExists(target)) return stub()
        return loadModule(target, cache)
      },
    },
    { filename: resolved },
  )
  return exports
}

function candidates(file) {
  return [file, `${file}.ts`, `${file}.tsx`]
}

function fileExists(file) {
  return candidates(file).some(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  )
}

function resolveFile(file) {
  for (const candidate of candidates(file))
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate
  throw new Error(`Unresolved module: ${file}`)
}

function stub() {
  return new Proxy({}, { get: () => () => null })
}

// Objects made inside the vm context have its own prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value))

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

// EM-121 (owner go 2026-11-08): one search field, settings search in the URL,
// and the custom range's per-date clear button.

const { nextCustomRange } = loadModule(
  path.join(ROOT, 'src', 'lib', 'calendar.ts'),
)
const { searchPageFromParams, searchPageQuery } = loadModule(
  path.join(ROOT, 'src', 'components', 'data-list', 'useUrlSearchPage.ts'),
)
const { dateRangeFilter } = loadModule(
  path.join(ROOT, 'src', 'components', 'data-list', 'FilterBar.tsx'),
)

test('the list toolbar uses the shared SearchInput, not a raw input', () => {
  const source = read('src', 'components', 'data-list', 'DataListToolbar.tsx')
  assert.match(source, /import \{ SearchInput \} from '@\/components\/ui'/)
  assert.match(source, /<SearchInput[\s\S]*?onValueChange=\{onSearch\}/)
  assert.doesNotMatch(source, /<input\s+className="input ps-9/)
  // The compact embedded lists keep a smaller box; the equipment list stays LTR.
  assert.match(source, /size=\{compact \? 'sm' : 'md'\}/)
  assert.match(
    source,
    /dir=\{config\.id === 'equipment' \? 'ltr' : undefined\}/,
  )
  assert.match(source, /min-w-\[220px\] w-full sm:w-\[360px\] lg:w-\[460px\]/)
})

test('Input keeps its default height and offers an opt-in small size', () => {
  const source = read('src', 'components', 'ui', 'Input.tsx')
  assert.match(source, /size === 'sm' \? 'h-8 py-1 text-sm' : 'h-10 md:h-9'/)
  assert.match(source, /size = 'md'/)
  // The icon wrapper follows a forced field direction (the icon's side).
  assert.match(source, /dir=\{props\.dir\}/)
})

test('clearing one end of the custom range keeps the other', () => {
  const range = { from: '2026-10-01', to: '2026-10-20' }
  assert.deepEqual(plain(nextCustomRange(range, 'from', '')), {
    from: '',
    to: '2026-10-20',
  })
  assert.deepEqual(plain(nextCustomRange(range, 'to', '')), {
    from: '2026-10-01',
    to: '',
  })
  assert.deepEqual(
    plain(nextCustomRange({ from: '', to: '2026-10-20' }, 'to', '')),
    {
      from: '',
      to: '',
    },
  )
})

test('a picked date keeps from <= to and a malformed key is ignored', () => {
  const range = { from: '2026-10-01', to: '2026-10-20' }
  assert.equal(nextCustomRange(range, 'from', '2026-10-21'), null)
  assert.equal(nextCustomRange(range, 'to', '2026-09-30'), null)
  assert.equal(nextCustomRange(range, 'from', '2026-02-30'), null)
  assert.deepEqual(plain(nextCustomRange(range, 'from', '2026-10-20')), {
    from: '2026-10-20',
    to: '2026-10-20',
  })
  // Against an empty end any valid date is accepted.
  assert.deepEqual(
    plain(nextCustomRange({ from: '', to: '' }, 'to', '2026-01-05')),
    {
      from: '',
      to: '2026-01-05',
    },
  )
})

test('both ends cleared through the X buttons leave no filter', () => {
  const field = {
    key: 'recorded_at',
    label: 'x',
    type: 'date',
    operators: ['gte', 'lte', 'between'],
  }
  let range = { from: '2026-10-01', to: '2026-10-20' }
  range = nextCustomRange(range, 'from', '')
  assert.equal(dateRangeFilter(field, range.from, range.to).operator, 'lte')
  range = nextCustomRange(range, 'to', '')
  assert.equal(dateRangeFilter(field, range.from, range.to), null)
})

test('DateRangeFilter routes both pickers through the clearing rule', () => {
  const source = read('src', 'components', 'ui', 'DateRangeFilter.tsx')
  assert.match(source, /nextCustomRange\(value, end, key\)/)
  assert.match(source, /setCustomEnd\('from', key\)/)
  assert.match(source, /setCustomEnd\('to', key\)/)
  assert.doesNotMatch(source, /if \(!isValidDateKey\(from\)\) return/)
})

test('the settings lists read q and page from the URL', () => {
  const params = (query) => new URLSearchParams(query)
  assert.deepEqual(plain(searchPageFromParams(params(''))), {
    search: '',
    page: 1,
  })
  assert.deepEqual(
    plain(searchPageFromParams(params('q=%D8%AD%D9%81%D8%A7%D8%B1&page=3'))),
    {
      search: 'حفار',
      page: 3,
    },
  )
  for (const bad of ['page=0', 'page=-2', 'page=x', 'page=1.5'])
    assert.equal(searchPageFromParams(params(bad)).page, 1, bad)
})

test('writing the settings URL keeps other keys and drops empty values', () => {
  assert.equal(
    searchPageQuery('x=1', { q: 'abc', page: 1 }),
    'x=1&q=abc&page=1',
  )
  assert.equal(searchPageQuery('q=abc&page=4', { q: '', page: 1 }), 'page=1')
  assert.equal(searchPageQuery('q=abc&page=4', { page: null }), 'q=abc')
})

test('both settings lists use the URL hook, equipment types only while shown', () => {
  const settings = read('src', 'screens', 'AdminSettings.tsx')
  assert.match(settings, /useUrlSearchPage\(showEquipmentTypes\)/)
  const banks = read('src', 'components', 'banks', 'BanksSettings.tsx')
  assert.match(banks, /useUrlSearchPage\(\)/)
  for (const source of [settings, banks]) {
    assert.doesNotMatch(source, /const \[search, setSearch\] = useState/)
    assert.doesNotMatch(source, /const \[page, setPage\] = useState/)
  }
  const hook = read('src', 'components', 'data-list', 'useUrlSearchPage.ts')
  assert.match(hook, /window\.history\.replaceState/)
  assert.doesNotMatch(hook, /pushState|router\.push/)
  assert.match(hook, /if \(!enabled\) return/)
})
