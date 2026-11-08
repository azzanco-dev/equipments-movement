const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-11-08 («خليه 1700»): the page (header and content) and /ui-kit
// share one maximum width so the mockups show what the real pages will.
const PAGE_MAX_WIDTH = 'max-w-[1700px]'

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

test('the header and the content frame share the 1700 px maximum width', () => {
  const layout = read('src/components/Layout.tsx')
  assert.equal(layout.split(PAGE_MAX_WIDTH).length - 1, 2)
  assert.ok(!layout.includes('max-w-[1600px]'))
})

test('/ui-kit uses the same maximum width as the pages', () => {
  const uiKit = read('src/screens/UiKit.tsx')
  assert.ok(uiKit.includes(PAGE_MAX_WIDTH))
  assert.ok(!uiKit.includes('max-w-[1400px]'))
})
