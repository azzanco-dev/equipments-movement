// Real links for navigation (owner 2026-10-25, «click يمين واسوي new tab او
// اضغط ctrl … في موقعنا مو ضابط»): the sidebar, the list rows and the
// purchasing buttons that open a page are <a href> elements, so right click
// › open in new tab, Ctrl / Cmd click and the middle button work, while a
// plain click still navigates on the client.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

test('AppLink: a real href, the app handles only a plain left click', () => {
  const link = read('src', 'components', 'ui', 'AppLink.tsx')
  assert.match(
    link,
    /event\.button === 0 &&\s+!event\.ctrlKey &&\s+!event\.metaKey &&\s+!event\.shiftKey &&\s+!event\.altKey/,
  )
  assert.match(
    link,
    /if \(event\.defaultPrevented \|\| target \|\| !isPlainLeftClick\(event\)\) return/,
  )
  assert.match(
    link,
    /event\.preventDefault\(\)\s+if \(onNavigate\) onNavigate\(\)\s+else router\.push\(href\)/,
  )
  assert.match(link, /<a\s+ref=\{ref\}\s+href=\{href\}/)
  assert.match(link, /window\.open\(href, '_blank', 'noopener'\)/)
  const index = read('src', 'components', 'ui', 'index.ts')
  assert.match(
    index,
    /export \{ AppLink, isPlainLeftClick, openInNewTab \} from '\.\/AppLink'/,
  )
})

test('the sidebar and the drawer: links for pages, buttons for parents', () => {
  const layout = read('src', 'components', 'Layout.tsx')
  assert.match(layout, /if \(!href\)\s+return \(\s+<button/)
  assert.match(layout, /<AppLink\s+href=\{href\}\s+onNavigate=\{onActivate\}/)
  // Desktop and mobile entries, and their children.
  assert.equal(
    (
      layout.match(
        /href=\{item\.children \? undefined : `\/\$\{item\.key\}`\}/g,
      ) ?? []
    ).length,
    2,
  )
  assert.equal((layout.match(/href=\{`\/\$\{child\.key\}`\}/g) ?? []).length, 2)
  assert.match(layout, /<AppLink\s+href="\/dashboard"/)
})

test('DataTable rows: a new tab on a modified or middle click, a link cell', () => {
  const table = read('src', 'components', 'ui', 'DataTable.tsx')
  assert.match(table, /rowHref\?: \(row: Row\) => string \| null \| undefined/)
  assert.match(
    table,
    /!expandable && onRowClick \? \(rowHref\?\.\(row\) \?\? null\) : null/,
  )
  assert.match(
    table,
    /if \(href && !isPlainLeftClick\(event\)\) \{\s+openInNewTab\(href\)\s+return\s+\}/,
  )
  assert.match(
    table,
    /onAuxClick:[\s\S]*?if \(event\.button !== 1\) return[\s\S]*?openInNewTab\(href\)/,
  )
  assert.match(
    table,
    /<AppLink\s+href=\{href\}\s+tabIndex=\{-1\}\s+className="contents"\s+onNavigate=\{\(\) => onRowClick\?\.\(row\)\}/,
  )
})

test('the lists give their rows the page they open', () => {
  const cases = [
    [
      ['src', 'screens', 'equipment', 'EquipmentTable.tsx'],
      /rowHref=\{\(row\) => `\/equipment\/\$\{row\.id\}`\}/,
    ],
    [
      ['src', 'screens', 'drivers', 'DriversTable.tsx'],
      /rowHref=\{\(row\) => buildDriverDialogHref\(row\.id\)\}/,
    ],
    [
      ['src', 'screens', 'AdminUsers.tsx'],
      /rowHref=\{\(row\) => `\/users\/\$\{row\.id\}`\}/,
    ],
    [
      ['src', 'screens', 'admin-home', 'LogsScreen.tsx'],
      /rowHref=\{\(row\) => `\/movements\/\$\{row\.id\}`\}/,
    ],
    [
      ['src', 'components', 'visits', 'VisitsTable.tsx'],
      /rowHref=\{\(visit\) => `\/movements\/\$\{visit\.entry_id\}`\}/,
    ],
    [
      ['src', 'components', 'home', 'HomeMovementsCard.tsx'],
      /rowHref=\{\(log\) => `\/movements\/\$\{log\.id\}`\}/,
    ],
    [
      ['src', 'screens', 'EquipmentDetail.tsx'],
      /rowHref=\{\(log\) => `\/movements\/\$\{log\.id\}`\}/,
    ],
    [
      ['src', 'screens', 'drivers', 'DriverDetailDialog.tsx'],
      /rowHref=\{\(item\) => `\/equipment\/\$\{item\.equipmentId\}`\}/,
    ],
  ]
  for (const [file, pattern] of cases)
    assert.match(read(...file), pattern, file.join('/'))
})

test('purchasing: «تفاصيل», the SPO pill and «انتقل للحركة» are links', () => {
  const list = read('src', 'screens', 'purchasing', 'SupplierPosListScreen.tsx')
  assert.match(
    list,
    /<Button size="sm" variant="primary" asChild>\s+<AppLink\s+href=\{`\/purchasing\/\$\{row\.id\}`\}/,
  )
  const units = read('src', 'screens', 'purchasing', 'SiteUnitsScreen.tsx')
  assert.match(
    units,
    /<AppLink\s+href=\{`\/purchasing\/\$\{row\.supplier_po_id\}`\}/,
  )
  assert.match(units, /<AppLink\s+href=\{`\/movements\/\$\{row\.entry_id\}`\}/)
})
