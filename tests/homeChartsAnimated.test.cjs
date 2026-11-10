// The admin home's charts draw in and its blocks load with shaped skeletons
// (owner 2026-11-09, «خلي الرسوم البيانية انيماتد» then «واضف skeleton»):
// one shared `useChartAnimation()` spread on every Recharts series (the
// tooltips stay static), the hand-drawn bars grow in through `.bar-grow`,
// both off under reduced motion, and every home block passes a skeleton
// shaped like its content to `HomeBlock`.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

const CHARTS = [
  ['EntriesLineChart', ['Line'], 2],
  ['FleetDonut', ['Pie'], 1],
  ['SoftAreaChart', ['Area'], 2],
  ['SoftBarChart', ['Bar'], 1],
  ['SoftDonut', ['Pie'], 1],
]

/** The JSX opening tags of `name` in `source`, attributes included. */
function openingTags(source, name) {
  const tags = []
  const re = new RegExp(`<${name}\\b`, 'g')
  let match
  while ((match = re.exec(source))) {
    let depth = 0
    let index = match.index
    for (; index < source.length; index += 1) {
      const char = source[index]
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (char === '>' && depth === 0) break
    }
    tags.push(source.slice(match.index, index + 1))
  }
  return tags
}

test('the shared hook returns Recharts animation props and honours reduced motion', () => {
  const source = read('src', 'components', 'charts', 'chartShared.tsx')
  assert.match(
    source,
    /export function useChartAnimation\(\): ChartAnimationProps/,
  )
  assert.match(source, /useSyncExternalStore\(/)
  assert.match(source, /'\(prefers-reduced-motion: reduce\)'/)
  assert.match(source, /!window\.matchMedia\(REDUCED_MOTION_QUERY\)\.matches/)
  // The server and hydration never animate.
  assert.match(
    source,
    /function motionAllowedOnServer\(\): boolean \{\s*return false/,
  )
  assert.match(source, /animationBegin: 0/)
  assert.match(source, /animationDuration: CHART_ANIMATION_MS/)
  assert.match(source, /CHART_ANIMATION_MS = 900/)
  assert.match(source, /animationEasing: 'ease-out'/)
  assert.doesNotMatch(
    source,
    /from 'recharts'/,
    'the barrel stays free of Recharts',
  )
})

for (const [chart, series, count] of CHARTS)
  test(`${chart} animates its series and keeps the tooltip static`, () => {
    const source = read('src', 'components', 'charts', `${chart}.tsx`)
    assert.match(source, /const animation = useChartAnimation\(\)/)
    let spread = 0
    for (const name of series)
      for (const tag of openingTags(source, name)) {
        assert.match(tag, /\{\.\.\.animation\}/, `${name} spreads the hook`)
        assert.doesNotMatch(tag, /isAnimationActive=\{false\}/)
        spread += 1
      }
    assert.equal(spread, count)
    const tooltips = openingTags(source, 'Tooltip')
    assert.ok(tooltips.length >= 1)
    for (const tag of tooltips) assert.match(tag, /isAnimationActive=\{false\}/)
    assert.equal(
      (source.match(/isAnimationActive=\{false\}/g) ?? []).length,
      tooltips.length,
      'only the tooltips stay static',
    )
  })

test('.bar-grow grows from the start edge and stops under reduced motion', () => {
  const css = read('src', 'index.css')
  assert.match(
    css,
    /@keyframes bar-grow \{\s*from \{\s*transform: scaleX\(0\);\s*\}\s*to \{\s*transform: scaleX\(1\);/,
  )
  assert.match(css, /\.bar-grow \{\s*animation: bar-grow 900ms ease-out both;/)
  assert.match(css, /\[dir='rtl'\] \.bar-grow \{\s*transform-origin: right;/)
  assert.match(css, /\[dir='ltr'\] \.bar-grow \{\s*transform-origin: left;/)
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.bar-grow \{\s*animation: none;/,
  )
})

test('the home bars use bar-grow', () => {
  const dir = ['src', 'components', 'admin-home']
  const homeBlock = read(...dir, 'HomeBlock.tsx')
  // ShareBar and BarRow: the fill grows.
  assert.equal(
    (homeBlock.match(/bar-grow block h-full rounded-full/g) ?? []).length,
    2,
  )
  // The stacked bars grow as one fill container.
  assert.match(
    read(...dir, 'KpiStrip.tsx'),
    /bar-grow flex h-full w-full gap-px/,
  )
  assert.match(
    read(...dir, 'AfaqyCard.tsx'),
    /bar-grow flex h-full w-full gap-px/,
  )
  assert.match(
    read(...dir, 'AvailabilityCard.tsx'),
    /bar-grow flex h-full gap-px/,
  )
})

test('the top projects chart gets one items array per load', () => {
  const source = read('src', 'components', 'admin-home', 'TopProjectsCard.tsx')
  assert.match(source, /const items = useMemo\(/)
  assert.match(source, /items=\{items\}/)
})

test('every home block passes a skeleton shaped like its content', () => {
  const dir = ['src', 'components', 'admin-home']
  const homeBlock = read(...dir, 'HomeBlock.tsx')
  assert.match(homeBlock, /skeleton\?: ReactNode/)
  assert.match(
    homeBlock,
    /\{skeleton \?\? <Skeleton className=\{skeletonClassName\} \/>\}/,
  )
  assert.equal((homeBlock.match(/t\('loading'\)/g) ?? []).length, 1)

  const expected = {
    'FleetStateCard.tsx': /skeleton=\{<OwnerTableSkeleton \/>\}/,
    'TopProjectsCard.tsx':
      /skeleton=\{<VerticalBarsSkeleton height=\{210\} \/>\}/,
    'WorkshopPurposeCard.tsx':
      /skeleton=\{<DonutSkeleton footerRows=\{2\} footerButton \/>\}/,
    'LatestMovementsCard.tsx': /skeleton=\{<ListRowsSkeleton rows=\{7\} \/>\}/,
    'AttentionSection.tsx':
      /skeleton=\{<ListRowsSkeleton rows=\{3\} icon \/>\}/,
    'AvailabilityCard.tsx': /skeleton=\{<BarRowsSkeleton rows=\{6\} \/>\}/,
    'AfaqyCard.tsx': /skeleton=\{<AfaqySkeleton \/>\}/,
    'EntriesCard.tsx': /skeleton=\{<AreaSkeleton height=\{220\} \/>\}/,
  }
  for (const [file, pattern] of Object.entries(expected))
    assert.match(read(...dir, file), pattern, file)

  // The KPI strip and the tabbed workshop block draw theirs themselves
  // (the tabs stay above the skeleton).
  assert.match(read(...dir, 'KpiStrip.tsx'), /<KpiStripSkeleton \/>/)
  const workshop = read(...dir, 'WorkshopCard.tsx')
  assert.match(workshop, /<ListRowsSkeleton rows=\{ROWS\} \/>/)

  // No home block falls back to the generic block any more.
  for (const file of fs.readdirSync(path.join(ROOT, ...dir))) {
    const source = read(...dir, file)
    if (/<HomeBlock\b/.test(source) && file !== 'WorkshopCard.tsx')
      assert.match(source, /skeleton=\{</, file)
  }
})

test('the skeletons use the shared Skeleton and tokens only, without hamza', () => {
  const files = [
    ['src', 'components', 'admin-home', 'HomeSkeletons.tsx'],
    ['src', 'components', 'charts', 'chartShared.tsx'],
  ]
  const skeletons = read(...files[0])
  for (const name of [
    'KpiStripSkeleton',
    'DonutSkeleton',
    'VerticalBarsSkeleton',
    'BarRowsSkeleton',
    'ListRowsSkeleton',
    'AfaqySkeleton',
    'AreaSkeleton',
  ])
    assert.match(skeletons, new RegExp(`export function ${name}\\(`))
  assert.match(skeletons, /import \{ Skeleton, cn \} from '@\/components\/ui'/)
  assert.match(skeletons, /border-surface/)
  assert.match(skeletons, /fill="var\(--surface\)"/)
  const palette =
    /\b(?:bg|text|border|fill|stroke|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
  for (const file of files) {
    const source = read(...file)
    assert.doesNotMatch(source, palette, file.join('/'))
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, file.join('/'))
    assert.doesNotMatch(source, /[أإآ]/, file.join('/'))
  }
  const css = read('src', 'index.css')
  const block = css.slice(
    css.indexOf('/* Admin home bars grow in'),
    css.indexOf('@keyframes bar-grow'),
  )
  assert.ok(block.length > 0)
  assert.doesNotMatch(block, /[أإآ]/)
})
