const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

// Owner rule: an LTR value (plate, phone, id, code) is an inline
// `<bdi dir="ltr">` under its label at the start edge. `dir` on the
// block-level value box flips that box's own start edge to the left.
test('DescriptionList and InfoRow isolate LTR values inline, never on the block', () => {
  for (const file of [
    'src/components/ui/DescriptionList.tsx',
    'src/components/ui/InfoRow.tsx',
  ]) {
    const source = read(file)
    assert.doesNotMatch(source, /\bdir=\{/, file)
    assert.match(source, /<LtrValue>/, file)
  }
  assert.match(
    read('src/components/ui/InfoGrid.tsx'),
    /<bdi\s+dir="ltr"/,
    'LtrValue renders an inline bdi',
  )
})

test('the movement detail page sets no dir on a block value', () => {
  const source = read('src/screens/MovementDetail.tsx')
  // The only `dir="ltr"` left is the contractor-code text input.
  assert.equal((source.match(/dir="ltr"/g) ?? []).length, 1)
  assert.doesNotMatch(source, /dir="auto"/)
})

test('the movement detail skeleton stays up for the whole first load', () => {
  const source = read('src/screens/MovementDetail.tsx')
  assert.match(source, /if \(loading && !error\) \{/)
  assert.doesNotMatch(source, /loading && !log && !error/)
  const skeleton = read('src/components/movement/MovementDetailSkeleton.tsx')
  // Same fixed photo box as the page, and no always-on driver card.
  assert.match(skeleton, /h-\[320px\]/)
  assert.match(skeleton, /context === 'site' && \(/)
  assert.match(skeleton, /isAdmin && </)
})

test('InfoGrid applies cellClassName to the grid cell', () => {
  const source = read('src/components/ui/InfoGrid.tsx')
  assert.match(
    source,
    /'flex min-w-0 items-start gap-2\.5',\s+item\.cellClassName,/,
  )
  assert.match(
    read('src/screens/UserDetail.tsx'),
    /cellClassName: 'sm:col-span-2'/,
  )
})

test('DetailHeader lets a long badge row wrap', () => {
  const source = read('src/components/ui/DetailHeader.tsx')
  assert.match(source, /flex min-w-0 flex-wrap items-center gap-1\.5/)
})

test('detail screens derive "pending" from the requested id', () => {
  assert.match(
    read('src/screens/drivers/useDriverDetail.ts'),
    /const loading = driverId !== null && driverLoadedId !== driverId/,
  )
  assert.match(
    read('src/screens/inquiry/EquipmentInquiryScreen.tsx'),
    /detailLoadedId !== equipmentId/,
  )
  // A language switch must not reload the user and wipe unsaved edits.
  assert.match(
    read('src/screens/UserDetail.tsx'),
    /\}, \[callManageUser, reloadKey, userId\]\)/,
  )
})
