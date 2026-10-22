// Migration 0146 (owner 2026-10-22): «اخر تعديل» on the PO list — the
// computed column last_modified_at(supplier_pos) = the latest PO event, else
// the PO's created_at; the list selects it, shows it and sorts by it.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261022160000_0146_supplier_po_last_modified.sql'
const PREVIOUS = '20261022140000_0145_undo_company_scope.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const sql = norm(read('supabase', 'migrations', MIGRATION))

test('0146 is the single 0146 migration, right after 0145', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0146 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0146_/.test(file)).length, 1)
})

test('last_modified_at is the latest event, else created_at, as the caller', () => {
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.last_modified_at\(po public\.supplier_pos\) RETURNS timestamptz LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp/,
  )
  assert.match(
    sql,
    /COALESCE\( \(SELECT max\(e\.created_at\) FROM public\.supplier_po_events e WHERE e\.supplier_po_id = po\.id\), po\.created_at \)/,
  )
  assert.doesNotMatch(sql, /SECURITY DEFINER/)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.last_modified_at\(public\.supplier_pos\) FROM PUBLIC, anon;/,
  )
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.last_modified_at\(public\.supplier_pos\) TO authenticated;/,
  )
})

test('the PO list selects, shows and sorts by last_modified_at', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(
    data,
    /SUPPLIER_PO_LIST_SELECT = `\$\{SUPPLIER_PO_SELECT\},last_modified_at,supplier_po_equipment\(count\)`/,
  )
  // Only the list reads it; the shared select stays as it was.
  assert.doesNotMatch(data, /SUPPLIER_PO_SELECT = `[^`]*last_modified_at/)
  const config = read('src', 'lib', 'listConfigs.ts')
  assert.match(config, /\{ key: 'last_modified_at', label: 'supplierPoLastModified' \}/)
  const screen = read('src', 'screens', 'purchasing', 'SupplierPosListScreen.tsx')
  assert.match(screen, /key: 'last_modified_at',\s+header: t\('supplierPoLastModified'\),\s+sortable: true,/)
  assert.match(screen, /formatDateTime\(row\.last_modified_at\)/)
  const translations = read('src', 'i18n', 'translations.ts')
  assert.match(translations, /supplierPoLastModified: 'اخر تعديل',/)
  assert.match(translations, /supplierPoLastModified: 'Last modified',/)
})
