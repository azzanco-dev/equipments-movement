const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-10-29: «ومتاحة جنب داخل الورشة».

const source = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'src',
    'components',
    'admin-home',
    'FleetMiniTables.tsx',
  ),
  'utf8',
)

const block = (table) => {
  const start = source.indexOf(`table="${table}"`)
  return source.slice(start, source.indexOf('/>', start))
}

/** `gridOrder` from the source, its type annotations stripped. */
function loadGridOrder() {
  const start = source.indexOf('function gridOrder')
  const end = source.indexOf('\n}\n', start) + 2
  const code = source.slice(start, end).replace(/: (number|boolean)/g, '')
  return new Function(`${code}\nreturn gridOrder`)()
}

test('inside spans the row; workshop and available share the next', () => {
  assert.match(block('inside'), /gridIndex=\{0\}[\s\S]*fullRow/)
  assert.match(block('workshop'), /gridIndex=\{2\}/)
  assert.doesNotMatch(block('workshop'), /fullRow/)
  assert.match(block('available'), /gridIndex=\{3\}/)
  assert.doesNotMatch(block('available'), /fullRow/)
})

test('an expanded table still moves to the start of its own row', () => {
  const gridOrder = loadGridOrder()
  const order = (index, expanded) => gridOrder(index, 2, expanded)
  // Collapsed: inside, workshop, available in that order.
  assert.ok(order(0, false) < order(2, false))
  assert.ok(order(2, false) < order(3, false))
  // Expanded workshop or available: after inside, before its row-mate.
  assert.ok(order(2, true) > order(0, false))
  assert.ok(order(2, true) < order(3, false))
  assert.ok(order(3, true) > order(0, false))
  assert.ok(order(3, true) < order(2, false))
})

// Owner 2026-10-29: «وشيل داخل المشاريع», then «اي شي حذفناه اليوم من
// الرئيسية رجعه وخليه اخر الصفحة تحت»: two copies split the tables.
test('the home shows each table once, inside at the end', () => {
  assert.match(source, /tables = FLEET_MINI_TABLES,/)
  for (const table of ['inside', 'workshop', 'available'])
    assert.match(
      source,
      new RegExp(
        `\\{tables\\.includes\\('${table}'\\) && \\(\\s*<FleetTable\\s+table="${table}"`,
      ),
    )
  const home = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'src',
      'screens',
      'admin-home',
      'AdminHomeScreen.tsx',
    ),
    'utf8',
  )
  const top = home.indexOf("tables={['workshop', 'available']}")
  const end = home.indexOf("tables={['inside']}")
  assert.ok(top > 0 && end > top)
  assert.ok(end > home.indexOf('<EntriesFlowSection'))
  assert.ok(home.indexOf('<RestStatesCard') > end)
  assert.ok(home.indexOf('<AttentionSection') > end)
})
