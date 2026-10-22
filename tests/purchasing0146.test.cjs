// Migration 0146 (owner 2026-10-22): «اخر تعديل» on the PO list —
// supplier_pos.updated_at, moved by the PO row's own updates and by every
// insert / update / delete of one of its lines, backfilled from the history;
// the list selects it, shows it and sorts by it.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261022160000_0146_supplier_po_updated_at.sql'
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

test('updated_at is added, backfilled from the history, then required', () => {
  const add = sql.indexOf('ADD COLUMN IF NOT EXISTS updated_at timestamptz;')
  const fill = sql.indexOf('UPDATE public.supplier_pos p SET updated_at = COALESCE(')
  const required = sql.indexOf('ALTER COLUMN updated_at SET NOT NULL;')
  const trigger = sql.indexOf('CREATE TRIGGER supplier_pos_updated_at')
  assert.ok(add >= 0 && add < fill && fill < required && required < trigger)
  assert.match(
    sql,
    /COALESCE\( \(SELECT max\(e\.created_at\) FROM public\.supplier_po_events e WHERE e\.supplier_po_id = p\.id\), p\.created_at \)/,
  )
  assert.match(sql, /ALTER COLUMN updated_at SET DEFAULT now\(\)/)
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS supplier_pos_updated_at_id_idx ON public\.supplier_pos \(updated_at DESC, id DESC\);/,
  )
})

test('the PO row and every line change move updated_at', () => {
  assert.match(
    sql,
    /CREATE TRIGGER supplier_pos_updated_at BEFORE UPDATE ON public\.supplier_pos FOR EACH ROW EXECUTE FUNCTION public\.update_updated_at\(\);/,
  )
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.touch_supplier_po_from_line\(\) RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp/,
  )
  assert.match(sql, /WHERE id = OLD\.supplier_po_id; RETURN OLD;/)
  assert.match(sql, /WHERE id = NEW\.supplier_po_id;/)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.touch_supplier_po_from_line\(\) FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    sql,
    /CREATE TRIGGER supplier_po_equipment_touch_po AFTER INSERT OR UPDATE OR DELETE ON public\.supplier_po_equipment FOR EACH ROW EXECUTE FUNCTION public\.touch_supplier_po_from_line\(\);/,
  )
})

test('the PO list selects, shows and sorts by updated_at', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(
    data,
    /SUPPLIER_PO_LIST_SELECT = `\$\{SUPPLIER_PO_SELECT\},updated_at,supplier_po_equipment\(count\)`/,
  )
  // Only the list reads it; the shared select stays as it was.
  assert.doesNotMatch(data, /SUPPLIER_PO_SELECT = `[^`]*updated_at/)
  const config = read('src', 'lib', 'listConfigs.ts')
  assert.match(config, /\{ key: 'updated_at', label: 'supplierPoLastModified' \}/)
  const screen = read('src', 'screens', 'purchasing', 'SupplierPosListScreen.tsx')
  assert.match(screen, /key: 'updated_at',\s+header: t\('supplierPoLastModified'\),\s+sortable: true,/)
  assert.match(screen, /formatDateTime\(row\.updated_at\)/)
  const translations = read('src', 'i18n', 'translations.ts')
  assert.match(translations, /supplierPoLastModified: 'اخر تعديل',/)
  assert.match(translations, /supplierPoLastModified: 'Last modified',/)
})
