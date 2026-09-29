const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const FILE = path.join(
  __dirname,
  '..',
  'src',
  'components',
  'ui',
  'DataTable.tsx',
)
const source = fs.readFileSync(FILE, 'utf8')

// Loads DataTable.tsx with its React/icon/i18n imports stubbed: only the pure
// drag-to-scroll helpers are exercised here, never the component itself.
function loadDataTable() {
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const exports = {}
  const stubs = {
    react: {},
    'react/jsx-runtime': {},
    'lucide-react': {},
    '@/i18n/I18nContext': {},
    './cn': { cn: () => '' },
  }
  vm.runInNewContext(
    code,
    {
      exports,
      require(request) {
        if (request in stubs) return stubs[request]
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: FILE },
  )
  return exports
}

const { canStartDragScroll, dragScrollIntent, DRAG_SCROLL_THRESHOLD } =
  loadDataTable()

const base = {
  pointerType: 'mouse',
  button: 0,
  detail: 1,
  modifier: false,
  onControl: false,
  overflowing: true,
}

test('a primary mouse press on an overflowing table may start a drag', () => {
  assert.equal(canStartDragScroll(base), true)
})

test('touch and pen keep native scrolling', () => {
  assert.equal(canStartDragScroll({ ...base, pointerType: 'touch' }), false)
  assert.equal(canStartDragScroll({ ...base, pointerType: 'pen' }), false)
})

test('drags never start on controls, secondary buttons or without overflow', () => {
  assert.equal(canStartDragScroll({ ...base, onControl: true }), false)
  assert.equal(canStartDragScroll({ ...base, button: 2 }), false)
  assert.equal(canStartDragScroll({ ...base, overflowing: false }), false)
})

test('an intended text selection is left alone', () => {
  // Double/triple click selects a word/line; a modifier extends a selection.
  assert.equal(canStartDragScroll({ ...base, detail: 2 }), false)
  assert.equal(canStartDragScroll({ ...base, modifier: true }), false)
})

test('a move within the threshold stays a click', () => {
  assert.equal(DRAG_SCROLL_THRESHOLD, 6)
  assert.equal(dragScrollIntent(0, 0), 'pending')
  assert.equal(dragScrollIntent(6, -6), 'pending')
  assert.equal(dragScrollIntent(-5, 3), 'pending')
})

test('a mostly horizontal move past the threshold becomes a drag', () => {
  assert.equal(dragScrollIntent(7, 0), 'drag')
  assert.equal(dragScrollIntent(-20, 8), 'drag')
})

test('a mostly vertical move is handed back to the browser', () => {
  assert.equal(dragScrollIntent(2, 10), 'cancel')
  assert.equal(dragScrollIntent(-8, -30), 'cancel')
})

test('the scroll wrapper wires the drag and swallows the click after a drag', () => {
  assert.match(source, /\{\.\.\.dragScroll\.handlers\}/)
  assert.match(source, /onClickCapture/)
  assert.match(source, /suppressClick\.current = true/)
  // Only mouse pointers are handled, so touch scrolling stays native.
  assert.match(source, /pointerType === 'mouse'/)
  // The native scrollbar stays: the wrapper still scrolls with overflow-x.
  assert.match(source, /overflow-x-auto/)
  // A clickable row carries role="button" but must still start a drag.
  assert.match(source, /\[role="button"\]:not\(tr\)/)
})
