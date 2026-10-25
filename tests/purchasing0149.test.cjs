// Migration 0149 (owner 2026-10-25): SPO260001 and SPO260002 reopened once,
// the U175 line leaving SPO260002 because its card sits on the open
// SPO260046 (option «أ»). A data fix only: no function, no button.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261025110000_0149_reopen_spo260001_spo260002.sql'
const PREVIOUS = '20261025100000_0148_supplier_po_same_entry_day.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const sql = read('supabase', 'migrations', MIGRATION)
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim()

test('0149 is the single 0149 migration, right after 0148', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0149 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0149_/.test(file)).length, 1)
})

test('a one-off fix: no function, no trigger, no grant', () => {
  assert.doesNotMatch(
    sql,
    /CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|GRANT /,
  )
  assert.match(sql, /DO \$\$/)
})

test('the event list gains equipment_removed and reopened', () => {
  assert.match(
    sql,
    /event_type IN \( 'created', 'updated', 'equipment_added', 'price_changed', 'line_updated', 'card_changed', 'equipment_removed', 'closed', 'reopened' \)/,
  )
})

test('every step checks the state it expects first', () => {
  assert.match(sql, /WHERE po_number = 'SPO260001' FOR UPDATE/)
  assert.match(sql, /WHERE po_number = 'SPO260002' FOR UPDATE/)
  assert.match(
    sql,
    /IF v_po1\.status <> 'closed' OR v_po2\.status <> 'closed' THEN RAISE EXCEPTION/,
  )
  assert.match(sql, /IF v_code IS DISTINCT FROM 'U175' THEN RAISE EXCEPTION/)
  // The line leaves only while its card is on another open PO.
  assert.match(
    sql,
    /IF NOT EXISTS \([^)]*AND p\.status = 'open' \) THEN RAISE EXCEPTION/,
  )
})

test('only the U175 line goes, both reopen, both are logged', () => {
  assert.match(
    sql,
    /DELETE FROM public\.supplier_po_equipment WHERE id = v_line\.id;/,
  )
  assert.doesNotMatch(sql, /DELETE FROM public\.equipment_cards/)
  assert.match(
    sql,
    /SET status = 'open', closed_at = NULL WHERE id IN \(v_po1\.id, v_po2\.id\);/,
  )
  assert.match(
    sql,
    /'equipment_removed', jsonb_build_object\( 'equipment_id', v_equipment_id, 'equipment_code', v_code,/,
  )
  assert.match(
    sql,
    /\(v_po1\.id, 'reopened'[^)]*\), NULL\), \(v_po2\.id, 'reopened'/,
  )
})

test('the page labels the two events and shows the removed code', () => {
  const purchasing = read('src', 'lib', 'purchasing.ts')
  assert.match(
    purchasing,
    /equipment_removed: 'supplierPoEventEquipmentRemoved',/,
  )
  assert.match(purchasing, /reopened: 'supplierPoEventReopened',/)
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(data, /case 'equipment_removed':[\s\S]*?payload\.equipment_code/)
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'supplierPoEventEquipmentRemoved',
    'supplierPoEventReopened',
  ]) {
    const matches =
      translations.match(new RegExp(`^    ${key}: '([^']*)',$`, 'gm')) ?? []
    assert.equal(matches.length, 2, key)
    assert.doesNotMatch(matches[0], /[أإآ]/, key)
  }
})
