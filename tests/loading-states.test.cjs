const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Source-level guards for the loading convention (wave 8): a skeleton only
// when there is nothing to show yet, the previous content dimmed on a refetch,
// and one loader per phase instead of a chain of different placeholders.
const read = (file) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8')

test('the full-screen loader is for the auth bootstrap only', () => {
  const app = read('App.tsx')
  // Every dynamic() screen falls back to an in-layout placeholder.
  assert.doesNotMatch(app, /loading:\s*\(\)\s*=>\s*<FullPageSpinner/)
  assert.doesNotMatch(app, /const \w+Loading = \(\) => <FullPageSpinner/)
  assert.match(app, /const screenLoading = \(\) => <RouteFallback \/>/)
  assert.equal(app.match(/<FullPageSpinner \/>/g)?.length, 1)
  assert.match(app, /if \(loading\) return <FullPageSpinner \/>/)
})

test('the route fallback lives inside the shell', () => {
  const fallback = read('components/RouteFallback.tsx')
  assert.doesNotMatch(fallback, /min-h-screen|min-h-\[100dvh\]/)
  assert.doesNotMatch(fallback, /style=\{/)
})

test('the legacy loaders use tokens, not palette colours', () => {
  const spinner = read('components/Spinner.tsx')
  assert.doesNotMatch(
    spinner,
    /\b(bg|text|border)-(gray|slate|zinc|neutral)-\d/,
  )
})

test('the equipment search starts in the loading state', () => {
  const form = read('components/EntryExitForm.tsx')
  assert.match(
    form,
    /\[loadingEquipment, setLoadingEquipment\] = useState\(true\)/,
  )
  const step = read('components/movement/EquipmentStep.tsx')
  // The skeleton is gated on the first load, not on every search.
  assert.match(step, /\{firstLoad \? \(/)
  assert.doesNotMatch(step, /\{loading \? \(/)
})

test('chart sections keep one skeleton and dim on a refetch', () => {
  for (const file of [
    'components/admin-home/EntriesFlowSection.tsx',
    'components/admin-home/FleetDonutSection.tsx',
  ]) {
    const source = read(file)
    assert.match(source, /loading=\{firstLoad\}/, file)
    assert.match(source, /\(loading && data === null\) \|\| !chartReady/, file)
    assert.match(source, /aria-busy=\{refreshing \|\| undefined\}/, file)
  }
  // The chart code is requested on mount, not behind next/dynamic.
  assert.doesNotMatch(
    read('components/charts/lazy.tsx'),
    /from 'next\/dynamic'/,
  )
})

test('report lists use the shared skeleton only before the first result', () => {
  for (const file of [
    'screens/EquipmentReports.tsx',
    'screens/WorkshopReports.tsx',
    'screens/EntryReportsAll.tsx',
  ]) {
    const source = read(file)
    assert.doesNotMatch(source, /InlineSpinner/, file)
    assert.match(source, /\{firstLoad \? \(\s*<ReportListSkeleton \/>/, file)
    assert.match(source, /aria-busy=\{refreshing \|\| undefined\}/, file)
  }
})

test('the field home keeps its numbers during a refresh', () => {
  const home = read('screens/HomeScreen.tsx')
  assert.doesNotMatch(home, /loading=\{statsLoading\}/)
  assert.match(home, /const statsFirstLoad = statsLoading && !statsLoaded/)
})
