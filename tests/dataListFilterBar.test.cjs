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

const { filterBarOperator } = loadModule(
  path.join(ROOT, 'src', 'components', 'data-list', 'FilterBar.tsx'),
)
const configs = loadModule(path.join(ROOT, 'src', 'lib', 'listConfigs.ts'))

test('the bar only ever uses an operator the field allows', () => {
  // The allowlist is what keeps an arbitrary comparison out of PostgREST.
  for (const config of Object.values(configs))
    for (const field of config.filterFields) {
      const operator = filterBarOperator(field)
      assert.ok(
        field.operators.includes(operator),
        `${config.id}.${field.key}: ${operator} is not allowlisted`,
      )
    }
})

test('each field type maps to the comparison a user expects', () => {
  const date = {
    key: 'recorded_at',
    label: 'x',
    type: 'date',
    operators: ['eq', 'gt', 'between'],
  }
  const text = {
    key: 'name',
    label: 'x',
    type: 'text',
    operators: ['eq', 'like'],
  }
  const choice = {
    key: 'role',
    label: 'x',
    type: 'select',
    operators: ['eq', 'in'],
  }
  assert.equal(filterBarOperator(date), 'between')
  assert.equal(filterBarOperator(text), 'like')
  assert.equal(filterBarOperator(choice), 'eq')
})

test('a field that does not allow the preferred operator falls back', () => {
  // `/logs` allows only eq/neq on the movement type, and some date fields are
  // range-less; the bar must not invent an operator.
  assert.equal(
    filterBarOperator({
      key: 'movement_type',
      label: 'x',
      type: 'select',
      operators: ['neq'],
    }),
    'neq',
  )
  assert.equal(
    filterBarOperator({
      key: 'recorded_at',
      label: 'x',
      type: 'date',
      operators: ['gte', 'lte'],
    }),
    'gte',
  )
})

test('every filter field of every config can be rendered by the bar', () => {
  // The bar draws one control per field: options → select, date → range,
  // everything else → text box. A field with no usable type would render an
  // empty cell, so guard the shapes the configs actually ship.
  const types = new Set(['text', 'number', 'date', 'boolean', 'select'])
  for (const config of Object.values(configs))
    for (const field of config.filterFields) {
      assert.ok(
        types.has(field.type),
        `${config.id}.${field.key}: ${field.type}`,
      )
      assert.ok(field.operators.length > 0, `${config.id}.${field.key}`)
      if (field.type === 'select' || field.type === 'boolean')
        assert.ok(
          Array.isArray(field.options),
          `${config.id}.${field.key} needs options or an async search`,
        )
    }
})
