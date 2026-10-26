// AsyncSearchSelect's phone mode (owner 2026-10-26): the mobile search-field
// behaviour he approved on /ui-kit «حقل بحث للجوال», switched on for the
// movement entry form first. Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const select = read('src', 'components', 'AsyncSearchSelect.tsx')

test('opt-in, phones only; larger screens keep the popover', () => {
  assert.match(select, /phoneInline\?: boolean/)
  assert.match(select, /phoneInline = false,/)
  assert.match(select, /const inline = phoneInline && isPhone/)
  assert.match(select, /if \(inline\)\s+return \(/)
  assert.match(select, /<PopoverContent/)
})

test('no scroll by code; the list hangs from the field', () => {
  assert.doesNotMatch(select, /scrollIntoView|scrollBy|scrollTo\(/)
  assert.match(
    select,
    /<div ref=\{wrapRef\} className=\{cn\('relative', className\)\}>/,
  )
  assert.match(
    select,
    /'absolute inset-x-0 flex flex-col !p-0',\s+inlineBox\.side === 'below' \? 'top-full' : 'bottom-full'/,
  )
  assert.match(select, /const INLINE_EDGE = 2/)
  assert.match(select, /const INLINE_LIST_MAX = 320/)
  assert.match(select, /const INLINE_LIST_MIN = 120/)
  assert.match(
    select,
    /below < INLINE_FLIP_BELOW && above > below \? 'above' : 'below'/,
  )
})

test('the search box is the field; «تم» keeps the list open', () => {
  assert.match(select, /role="combobox"/)
  assert.match(select, /onFocus=\{\(\) => setOpen\(true\)\}/)
  // A blur with no next focus (the keyboard's «تم») does not close.
  assert.match(
    select,
    /if \(next && !wrapRef\.current\?\.contains\(next\)\) \{\s+setOpen\(false\)/,
  )
  // A press outside closes.
  assert.match(
    select,
    /if \(!wrapRef\.current\?\.contains\(event\.target as Node\)\) closeInline\(\)/,
  )
  // Pressing the list keeps the focus (and the keyboard).
  assert.match(
    select,
    /onPointerDown=\{\(event\) => event\.preventDefault\(\)\}/,
  )
})

test('the visible area follows the iPhone readings', () => {
  const area = read('src', 'lib', 'visibleArea.ts')
  assert.match(area, /position:fixed;top:0/)
  assert.match(
    area,
    /probe\.getBoundingClientRect\(\)\.top \+ \(view\?\.offsetTop \?\? 0\)/,
  )
  assert.match(area, /'\(max-width: 767px\)'/)
})

test('switched on in the movement entry form only', () => {
  const form = read('src', 'components', 'EntryExitForm.tsx')
  for (const anchor of ['selectedCompanyId', 'selectedProjectId', 'driverId'])
    assert.match(
      form,
      new RegExp(
        `\\{\\.\\.\\.control\\}\\s+phoneInline\\s+size="md"\\s+value=\\{${anchor}\\}`,
      ),
      anchor,
    )
  const quick = read('src', 'components', 'movement', 'QuickEquipmentForm.tsx')
  assert.equal(
    (quick.match(/\{\.\.\.control\}\s+phoneInline/g) ?? []).length,
    2,
  )
  const users = fs
    .readdirSync(path.join(root, 'src'), { recursive: true })
    .filter((file) => /\.tsx$/.test(file))
    .filter((file) => /\bphoneInline\b/.test(read('src', file)))
    .map((file) => file.replace(/\\/g, '/'))
    .sort()
  assert.deepEqual(users, [
    'components/AsyncSearchSelect.tsx',
    'components/EntryExitForm.tsx',
    'components/movement/QuickEquipmentForm.tsx',
  ])
})

test('the entry form fields take the owner field height (40 / 36 px)', () => {
  assert.match(select, /md: 'h-10 md:h-9',/)
  assert.match(select, /legacy: 'h-8',/)
  assert.match(select, /size = 'legacy',/)
  const form = read('src', 'components', 'EntryExitForm.tsx')
  assert.equal((form.match(/phoneInline\s+size="md"/g) ?? []).length, 3)
  const quick = read('src', 'components', 'movement', 'QuickEquipmentForm.tsx')
  assert.equal((quick.match(/phoneInline\s+size="md"/g) ?? []).length, 2)
})
