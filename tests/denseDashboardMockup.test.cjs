const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-11-01 (EM-252, «الارقام الحالية ماخذه كامل الصفحة»): a review
// mockup of a denser admin dashboard on /ui-kit, in the look of the dashboard
// board he sent, with two variants to compare.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

const mockup = read('src', 'screens', 'ui-kit', 'DenseDashboardMockup.tsx')
const data = read('src', 'screens', 'ui-kit', 'denseDashboardData.ts')
const uiKit = read('src', 'screens', 'UiKit.tsx')
const sources = { mockup, data }

test('the section is registered on /ui-kit under review', () => {
  assert.match(
    uiKit,
    /import \{ DenseDashboardMockup \} from '@\/screens\/ui-kit\/DenseDashboardMockup'/,
  )
  const start = uiKit.indexOf("id: 'dense-dashboard'")
  assert.ok(start > 0, 'the section has an id')
  const block = uiKit.slice(start, uiKit.indexOf('element:', start) + 60)
  assert.match(block, /title: 'نموذج لوحة التحكم الكثيفة'/)
  assert.match(block, /status: 'review'/)
  assert.match(block, /element: <DenseDashboardMockup \/>/)
})

test('sample data only: no Supabase, no fetch', () => {
  for (const [name, source] of Object.entries(sources)) {
    // The comments may say «Supabase»; an import or a client call may not.
    assert.doesNotMatch(
      source,
      /from '[^']*supabase|supabase\.(from|rpc)\(/i,
      `${name} imports or calls supabase`,
    )
    assert.doesNotMatch(source, /\bfetch\(/, `${name} fetches`)
    assert.doesNotMatch(source, /Math\.random/, `${name} is not deterministic`)
  }
})

test('two variants on the shared segmented Tabs', () => {
  assert.match(mockup, /<TabsList variant="segmented"/)
  assert.match(mockup, /label: 'مربعات'/)
  assert.match(mockup, /label: 'اكثر كثافة'/)
})

test('charts come from the lazy entry point, fills from the chart tints', () => {
  assert.match(
    mockup,
    /import \{ EntriesLineChart, FleetDonut \} from '@\/components\/charts\/lazy'/,
  )
  assert.doesNotMatch(mockup, /from 'recharts'/)
  assert.match(data, /var\(--chart-\d\)/)
  assert.match(data, /var\(--chart-stroke-\d\)/)
})

test('project tokens only: no hex colors, no Tailwind palette classes', () => {
  const palette =
    /\b(?:bg|text|border|fill|stroke|from|to|via|ring|outline)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
  for (const [name, source] of Object.entries(sources)) {
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
  }
})

test('the new Arabic copy uses plain alif (no أ / إ / آ)', () => {
  for (const [name, source] of Object.entries(sources))
    assert.doesNotMatch(source, /[أإآ]/, `${name} has alif with hamza or madda`)
  const start = uiKit.indexOf("id: 'dense-dashboard'")
  const block = uiKit.slice(start, uiKit.indexOf('element:', start))
  assert.doesNotMatch(block, /[أإآ]/)
})

test('the figures add up: fleet = projects + workshop + available', () => {
  const owners = [...data.matchAll(/fleet: (\d+),\s+inProjects: (\d+)/g)]
  assert.equal(owners.length, 5)
  const fleet = owners.reduce((sum, m) => sum + Number(m[1]), 0)
  const projects = owners.reduce((sum, m) => sum + Number(m[2]), 0)
  const states = [
    ...data.matchAll(/id: '([a-z_]+)',\n\s+label: '[^']+',\n\s+count: (\d+)/g),
  ]
  const rest = states.reduce((sum, m) => sum + Number(m[2]), 0)
  assert.equal(fleet, projects + rest)
})
