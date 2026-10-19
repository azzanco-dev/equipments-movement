// Migration 0137 (owner rule 2026-10-19): a unit joins a supplier PO only
// while it is inside the PO's company and project (its latest movement is an
// open site ENTRY there), and the card remembers that entry.
//
// Source checks only: add_supplier_po_equipment is the 0136 body plus the
// documented 0137 clauses, the new column and token exist, the grants are
// restated, and the client maps the token to the equipment field.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261019100000_0137_supplier_po_equipment_at_project.sql'
const PREVIOUS = '20261018130000_0136_purchasing_supplier_pos.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const sql = read('supabase', 'migrations', MIGRATION)
const sql0136 = read('supabase', 'migrations', PREVIOUS)
const stripped = sql.replace(/--[^\n]*/g, '')

const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

function fn(source, name) {
  const match = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`,
  ).exec(source)
  assert.ok(match, `missing function ${name}`)
  const end = source.indexOf('\n$$;', match.index)
  assert.ok(end > match.index, `unterminated function ${name}`)
  return source.slice(match.index, end + 4)
}

test('0137 is the single 0137 migration, right after 0136', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0137 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0137_/.test(file)).length, 1)
})

test('equipment_cards.entry_log_id: optional, ON DELETE SET NULL, indexed', () => {
  assert.match(
    norm(stripped),
    /ALTER TABLE public\.equipment_cards ADD COLUMN IF NOT EXISTS entry_log_id uuid REFERENCES public\.entry_exit_logs\(id\) ON DELETE SET NULL;/,
  )
  assert.match(
    norm(stripped),
    /CREATE INDEX IF NOT EXISTS equipment_cards_entry_log_idx ON public\.equipment_cards \(entry_log_id\) WHERE entry_log_id IS NOT NULL;/,
  )
})

test('add_supplier_po_equipment is the 0136 body plus the 0137 clauses', () => {
  const before = norm(fn(sql0136, 'add_supplier_po_equipment'))
  const after = norm(fn(sql, 'add_supplier_po_equipment'))
  // Same header, same security.
  assert.match(after, /SECURITY DEFINER SET search_path = public, pg_temp/)
  // The new declaration and the latest-movement check, under the advisory key.
  assert.match(after, /v_last public\.entry_exit_logs%ROWTYPE;/)
  const lock = after.indexOf('PERFORM pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0));')
  const check = after.indexOf("ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1; IF NOT FOUND OR v_last.movement_type <> 'entry' OR v_last.movement_context <> 'site' OR v_last.company_id IS DISTINCT FROM v_po.company_id OR v_last.project_id IS DISTINCT FROM v_po.project_id THEN RAISE EXCEPTION 'equipment_not_at_po_project' USING ERRCODE = '55000'")
  assert.ok(lock > 0 && check > lock, 'the check runs after the lock')
  // The entry lands on a created card and on a reused card without one.
  assert.match(after, /equipment_id, company_id, project_id, period_from, created_by, entry_log_id \) VALUES \( p_equipment_id, v_po\.company_id, v_po\.project_id, v_po\.start_date, auth\.uid\(\), v_last\.id \)/)
  assert.match(after, /UPDATE public\.equipment_cards SET entry_log_id = v_last\.id WHERE id = v_card_id AND entry_log_id IS NULL;/)
  assert.match(after, /'entry_log_id', v_last\.id/)
  // Everything of 0136 is still there, in order.
  for (const clause of [
    "RAISE EXCEPTION 'invalid_po' USING ERRCODE = '22023';",
    "RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000';",
    "RAISE EXCEPTION 'invalid_equipment' USING ERRCODE = '22023';",
    "RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';",
    "RAISE EXCEPTION 'internal_price_must_be_zero' USING ERRCODE = '22023';",
    "RAISE EXCEPTION 'card_overlap' USING ERRCODE = '23P01'",
    "RAISE EXCEPTION 'equipment_already_on_open_po' USING ERRCODE = '23505'",
    "INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id) VALUES ( v_po.id, 'equipment_added',",
  ]) {
    assert.ok(before.includes(clause), `0136 has: ${clause}`)
    assert.ok(after.includes(clause), `0137 keeps: ${clause}`)
  }
  // Grants restated; nothing else of 0136 is redefined.
  assert.match(
    norm(stripped),
    /REVOKE ALL ON FUNCTION public\.add_supplier_po_equipment\(uuid, uuid, numeric, text\) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\.add_supplier_po_equipment\(uuid, uuid, numeric, text\) TO authenticated;/,
  )
  const created = [...stripped.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(/g)].map((m) => m[1])
  assert.deepEqual(created, ['add_supplier_po_equipment'])
  assert.doesNotMatch(stripped, /CREATE POLICY|DROP POLICY|legacy_role_permissions|entry_exit_logs\s+(ENABLE|DISABLE|ALTER)/)
})

test('the client maps the token to the equipment field and limits the search', () => {
  const lib = read('src', 'lib', 'purchasing.ts').replace(/\s+/g, ' ')
  assert.match(
    lib,
    /\{ on: 'raised', match: 'equipment_not_at_po_project', field: 'equipment_id', key: 'supplierPoErrorNotAtProject', \}/,
  )
  assert.match(lib, /'equipment_not_at_po_project',/)
  const translations = read('src', 'i18n', 'translations.ts')
  assert.equal(translations.split('supplierPoErrorNotAtProject:').length, 3, 'ar + en')
  assert.equal(translations.split('supplierPoEquipmentAtProjectHint:').length, 3, 'ar + en')
  assert.doesNotMatch(
    translations.slice(translations.indexOf('supplierPoErrorNotAtProject:'), translations.indexOf('supplierPoErrorNotAtProject:') + 400),
    /[أإآ]/,
  )
})
