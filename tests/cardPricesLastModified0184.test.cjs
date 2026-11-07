// Migration 0184 (owner 2026-11-07, «الترتيب حقها ابغاه يكون حسب احدث تعديل
// سواء على امر العميل او امر المورد»): «اسعار المعدات» sorts by the latest
// change of the card, its client PO or its supplier PO, newest first.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')
const MIGRATION = '20261107140000_0184_card_prices_last_modified.sql'
const sql = read('supabase', 'migrations', MIGRATION)
const view = (text) => {
  const start = text.indexOf('CREATE OR REPLACE VIEW public.sales_equipment_cards')
  return text.slice(start, text.indexOf(') m;', start) + 4)
}

test('0184 follows 0183', () => {
  const files = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  assert.match(files[files.indexOf(MIGRATION) - 1], /_0183_/)
})

test('the view is 0174 verbatim plus the three trailing columns', () => {
  const before = view(read('supabase', 'migrations', '20261104110000_0174_equipment_card_pricing.sql'))
  const after = view(sql)
  const expected = before
    .replace(
      '  sp.supplier_po_approval_status\nFROM',
      '  sp.supplier_po_approval_status,\n' +
        '  -- 0184: the two PO dates and the latest modification, at the END.\n' +
        '  cl.client_po_updated_at,\n' +
        '  sp.supplier_po_updated_at,\n' +
        '  GREATEST(c.updated_at, cl.client_po_updated_at, sp.supplier_po_updated_at) AS last_modified_at\nFROM',
    )
    .replace(
      '    l.quantity AS client_quantity\n',
      '    l.quantity AS client_quantity,\n    p.updated_at AS client_po_updated_at\n',
    )
    .replace(
      '    sp2.approval_status AS supplier_po_approval_status\n',
      '    sp2.approval_status AS supplier_po_approval_status,\n    sp2.updated_at AS supplier_po_updated_at\n',
    )
  assert.notEqual(expected, before)
  assert.equal(after, expected)
  assert.match(sql, /WITH \(security_invoker = true\)/)
  assert.match(sql, /REVOKE ALL ON public\.sales_equipment_cards FROM PUBLIC, anon;\nGRANT SELECT ON public\.sales_equipment_cards TO authenticated;/)
  assert.doesNotMatch(sql, /DROP VIEW|CREATE TABLE|ALTER TABLE|CREATE POLICY|CREATE (OR REPLACE )?FUNCTION/)
})

test('the page selects it, sorts by it newest first and shows it last', () => {
  const data = read('src', 'lib', 'salesData.ts')
  assert.match(data, /CARD_PRICES_SELECT = `[^`]*,last_modified_at`/)
  const configs = read('src', 'lib', 'listConfigs.ts')
  const prices = configs.slice(configs.indexOf('export const cardPricesListConfig'))
  assert.match(prices, /defaultSort: 'last_modified_at',\s+defaultDirection: 'desc',/)
  const screen = read('src', 'screens', 'sales', 'CardPricesScreen.tsx')
  assert.match(screen, /key: 'last_modified_at',\s+header: t\('updatedAt'\),\s+sortable: true,/)
  assert.match(screen, /<RelativeTime value=\{row\.last_modified_at\} \/>/)
})
