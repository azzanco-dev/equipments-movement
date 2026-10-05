const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// The pure helpers behind src/components/map/ProjectsMap: bubble sizing,
// framing, the accessible name, the marker HTML and label collisions.
function loadProjectsMap() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'projectsMap.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(
    code,
    {
      exports,
      require(request) {
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const map = loadProjectsMap()

// Values built inside the VM have that realm's Object/Array prototypes, which
// deepStrictEqual treats as different; compare plain copies instead.
const plain = (value) => JSON.parse(JSON.stringify(value))
const {
  BUBBLE_MAX_DIAMETER: MAX,
  BUBBLE_MIN_DIAMETER: MIN,
  RIYADH_CENTER,
  RIYADH_ZOOM,
  SINGLE_POINT_ZOOM,
} = map

const point = (id, lat, lng, count, kind = 'project') => ({
  id,
  name: id,
  lat,
  lng,
  count,
  kind,
})

test('bubble diameter follows a square-root scale so area tracks the count', () => {
  assert.equal(map.bubbleDiameter(100, 100), MAX)
  // A quarter of the largest count gets half the diameter (a quarter of the area).
  assert.equal(map.bubbleDiameter(25, 100, 10, 80), 40)
  assert.ok(map.bubbleDiameter(41, 41) > map.bubbleDiameter(24, 41))
  assert.ok(map.bubbleDiameter(24, 41) > map.bubbleDiameter(15, 41))
})

test('bubble diameter is clamped to the readable range', () => {
  assert.equal(map.bubbleDiameter(1, 1000), MIN)
  assert.equal(map.bubbleDiameter(0, 10), MIN)
  assert.equal(map.bubbleDiameter(-3, 10), MIN)
  assert.equal(map.bubbleDiameter(5, 0), MIN)
  assert.equal(map.bubbleDiameter(Number.NaN, 10), MIN)
  // A count above the reference maximum never exceeds the maximum size.
  assert.equal(map.bubbleDiameter(500, 100), MAX)
  assert.equal(map.bubbleDiameter(10, 40, 20, 80), 40)
})

test('initial view frames the points, centres one point, or falls back to Riyadh', () => {
  assert.deepEqual(plain(map.initialView([])), {
    kind: 'center',
    center: [RIYADH_CENTER[0], RIYADH_CENTER[1]],
    zoom: RIYADH_ZOOM,
  })
  assert.deepEqual(plain(map.initialView([point('a', 24.6, 46.3, 3)])), {
    kind: 'center',
    center: [24.6, 46.3],
    zoom: SINGLE_POINT_ZOOM,
  })
  assert.deepEqual(
    plain(
      map.initialView([
        point('a', 24.585, 46.33, 41),
        point('b', 24.957, 46.7, 9),
        point('c', 24.87, 46.97, 6),
      ]),
    ),
    {
      kind: 'bounds',
      bounds: [
        [24.585, 46.33],
        [24.957, 46.97],
      ],
    },
  )
})

test('points without usable coordinates are skipped when framing', () => {
  const view = map.initialView([
    point('bad', Number.NaN, 46.3, 3),
    point('far', 120, 46.3, 3),
    point('ok', 24.7, 46.6, 3),
  ])
  assert.deepEqual(plain(view), {
    kind: 'center',
    center: [24.7, 46.6],
    zoom: SINGLE_POINT_ZOOM,
  })
  assert.equal(map.placeablePoints([point('bad', 24, Infinity, 1)]).length, 0)
})

test('the framing key ignores counts and order but not positions', () => {
  const a = [point('a', 24.6, 46.3, 3), point('b', 24.9, 46.9, 4)]
  const sameButRecounted = [
    point('b', 24.9, 46.9, 40),
    point('a', 24.6, 46.3, 1),
  ]
  const moved = [point('a', 24.6, 46.3, 3), point('b', 24.8, 46.9, 4)]
  assert.equal(map.viewKey(a), map.viewKey(sameButRecounted))
  assert.notEqual(map.viewKey(a), map.viewKey(moved))
})

test('accessible bubble label reads name and count', () => {
  assert.equal(
    map.formatBubbleLabel('{name}: {count} معدة', '  القدية ', 41),
    'القدية: 41 معدة',
  )
  assert.equal(
    map.formatBubbleLabel('{name}: {count} units', 'Diriyah', 24),
    'Diriyah: 24 units',
  )
})

test('marker HTML is a labelled button with escaped content', () => {
  const html = map.bubbleHtml({
    id: 'p"1',
    name: '<b>مشروع</b> & "x"',
    count: 7,
    kind: 'workshop',
    diameter: 40.4,
    label: 'الورشة: 7 معدة',
    selected: true,
  })
  assert.match(
    html,
    /^<button type="button" class="pm-bubble pm-bubble--workshop is-selected"/,
  )
  assert.match(html, /data-pm-id="p&quot;1"/)
  assert.match(html, /aria-label="الورشة: 7 معدة"/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /style="width:40px;height:40px"/)
  assert.match(
    html,
    /<span class="pm-count" aria-hidden="true">7<\/span><\/button>/,
  )
  assert.match(
    html,
    /<span class="pm-label" dir="auto" aria-hidden="true">&lt;b&gt;مشروع&lt;\/b&gt; &amp; &quot;x&quot;<\/span>$/,
  )
  assert.doesNotMatch(html, /<b>/)

  const long = map.bubbleHtml({
    id: 'p2',
    name: 'x',
    count: 120,
    kind: 'project',
    diameter: 64,
    label: 'x',
    selected: false,
  })
  assert.match(long, /class="pm-bubble pm-bubble--project pm-bubble--long"/)
  assert.match(long, /aria-pressed="false"/)
})

test('marker HTML is well formed: every opened tag is closed', () => {
  const html = map.bubbleHtml({
    id: 'a',
    name: 'الدرعية',
    count: 24,
    kind: 'project',
    diameter: 50,
    label: 'الدرعية: 24 معدة',
    selected: false,
  })
  const stack = []
  for (const [, closing, tag] of html.matchAll(/<(\/?)([a-z]+)[^>]*>/g)) {
    if (closing) assert.equal(stack.pop(), tag)
    else stack.push(tag)
  }
  assert.deepEqual(stack, [])
})

const rect = (x, y, width, height) => ({ x, y, width, height })

test('label collisions keep the larger place and hide the overlapping one', () => {
  const big = {
    id: 'big',
    priority: 41,
    bubble: rect(0, 0, 60, 60),
    label: rect(-10, 64, 80, 18),
  }
  const small = {
    id: 'small',
    priority: 9,
    bubble: rect(20, 90, 40, 40),
    label: rect(0, 134, 80, 18),
  }
  // The big label (y 64..82) does not reach the small bubble (y 90): both stay.
  assert.deepEqual([...map.visibleLabelIds([big, small])].sort(), [
    'big',
    'small',
  ])

  // Move the small label onto the big one: only the bigger count keeps it.
  const clash = { ...small, label: rect(10, 70, 80, 18) }
  assert.deepEqual([...map.visibleLabelIds([clash, big])], ['big'])

  // A label covering another place's bubble is hidden even with no label clash.
  const coversBubble = {
    id: 'covers',
    priority: 50,
    bubble: rect(200, 0, 40, 40),
    label: rect(10, 20, 80, 18),
  }
  assert.deepEqual([...map.visibleLabelIds([coversBubble, big])].sort(), [
    'big',
  ])
})

test('label collisions are stable for equal counts', () => {
  const a = {
    id: 'a',
    priority: 5,
    bubble: rect(0, 0, 30, 30),
    label: rect(0, 40, 60, 18),
  }
  const b = {
    id: 'b',
    priority: 5,
    bubble: rect(200, 0, 30, 30),
    label: rect(20, 40, 60, 18),
  }
  assert.deepEqual([...map.visibleLabelIds([b, a])], ['a'])
  assert.deepEqual([...map.visibleLabelIds([a, b])], ['a'])
})

test('stacking puts smaller places above larger ones and the selection on top', () => {
  assert.ok(
    map.stackingOffset(6, 41, false) > map.stackingOffset(41, 41, false),
  )
  assert.ok(map.stackingOffset(41, 41, true) > map.stackingOffset(1, 41, false))
})

test('totals count unplaced projects as projects', () => {
  assert.deepEqual(
    plain(
      map.totalsByKind(
        [point('a', 24, 46, 41), point('w', 24, 46, 7, 'workshop')],
        [{ id: 'u', name: 'u', count: 5 }],
      ),
    ),
    { project: 46, workshop: 7 },
  )
})

test('tile provider config is one constant with attribution for both themes', () => {
  for (const theme of ['light', 'dark']) {
    const config = map.PROJECTS_MAP_TILES[theme]
    assert.match(config.url, /^https:\/\//)
    assert.match(config.attribution, /OpenStreetMap/)
    assert.match(config.attribution, /CARTO/)
  }
})

test('leaflet is only imported by the lazily loaded map module', () => {
  const root = path.join(__dirname, '..', 'src')
  const importers = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const source = fs.readFileSync(full, 'utf8')
        if (/from ['"]leaflet['"]|import ['"]leaflet\//.test(source))
          importers.push(path.relative(root, full).replace(/\\/g, '/'))
      }
    }
  }
  walk(root)
  assert.deepEqual(importers, ['components/map/LeafletProjectsMap.tsx'])
  const wrapper = fs.readFileSync(
    path.join(root, 'components', 'map', 'ProjectsMap.tsx'),
    'utf8',
  )
  assert.match(wrapper, /import\('\.\/LeafletProjectsMap'\)/)
  assert.doesNotMatch(wrapper, /^import [^t].*LeafletProjectsMap/m)
})
