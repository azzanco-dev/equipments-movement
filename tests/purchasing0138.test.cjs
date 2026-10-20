// Migration 0138 (owner review 2026-10-20): the PO's party is a lessor OR an
// owner class, prices are optional, the PO is created with its equipment in
// one call, a card's period starts at the unit's entry date, and the 0136
// internal-zero rule is gone.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261020100000_0138_supplier_po_party_and_optional_price.sql'
const PREVIOUS = '20261019100000_0137_supplier_po_equipment_at_project.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const sql = read('supabase', 'migrations', MIGRATION)
const stripped = sql.replace(/--[^\n]*/g, '')
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

function fn(name) {
  const match = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`).exec(sql)
  assert.ok(match, `missing function ${name}`)
  const end = sql.indexOf('\n$$;', match.index)
  assert.ok(end > match.index, `unterminated function ${name}`)
  return norm(sql.slice(match.index, end + 4))
}

test('0138 is the single 0138 migration, right after 0137', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0138 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0138_/.test(file)).length, 1)
})

test('the price is optional and counted by a computed column', () => {
  assert.match(
    norm(stripped),
    /ALTER TABLE public\.supplier_po_equipment ALTER COLUMN price DROP NOT NULL;/,
  )
  const counter = fn('unpriced_count')
  assert.match(counter, /RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp/)
  assert.match(counter, /WHERE l\.supplier_po_id = po\.id AND l\.price IS NULL;/)
  assert.match(
    norm(stripped),
    /GRANT EXECUTE ON FUNCTION public\.unpriced_count\(public\.supplier_pos\) TO authenticated;/,
  )
})

test('the party: exactly one of lessor_id and owner_class', () => {
  const body = norm(stripped)
  assert.match(
    body,
    /ADD COLUMN IF NOT EXISTS owner_class text CONSTRAINT supplier_pos_owner_class_check CHECK \( owner_class IN \('alazani', 'takween', 'third_party_f', 'third_party_partnership_b'\) \)/,
  )
  // Pre-0138 internal POs become Al-Azani POs before the constraint lands.
  const backfill = body.indexOf("SET owner_class = 'alazani' WHERE lessor_id IS NULL AND owner_class IS NULL;")
  const constraint = body.indexOf('ADD CONSTRAINT supplier_pos_party_check CHECK ((lessor_id IS NOT NULL) <> (owner_class IS NOT NULL));')
  assert.ok(backfill > 0 && constraint > backfill)
  assert.match(body, /DROP CONSTRAINT IF EXISTS supplier_pos_lessor_check;/)
})

test('add_supplier_po_equipment: no internal rule, party check, optional price, entry-based card', () => {
  const add = fn('add_supplier_po_equipment')
  assert.match(add, /SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.doesNotMatch(add, /internal_price_must_be_zero|is_internal_equipment/)
  assert.match(add, /IF p_price IS NOT NULL AND \(p_price < 0 OR p_price > 9999999999\.99\) THEN RAISE EXCEPTION 'invalid_price'/)
  assert.match(
    add,
    /\(v_po\.lessor_id IS NOT NULL AND v_unit\.lessor_id = v_po\.lessor_id\) OR \(v_po\.owner_class IS NOT NULL AND v_unit\.ownership_status = v_po\.owner_class\)/,
  )
  assert.match(add, /RAISE EXCEPTION 'equipment_not_of_po_supplier' USING ERRCODE = '55000'/)
  // The 0137 rule stays, under the advisory key, and feeds the card period.
  const lock = add.indexOf('PERFORM pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0));')
  const check = add.indexOf("RAISE EXCEPTION 'equipment_not_at_po_project'")
  assert.ok(lock > 0 && check > lock)
  assert.match(add, /v_entry_date := \(v_last\.recorded_at AT TIME ZONE 'Asia\/Riyadh'\)::date;/)
  assert.match(add, /AND c\.period_from <= v_entry_date AND \(c\.period_to IS NULL OR c\.period_to >= v_entry_date\)/)
  assert.match(add, /VALUES \( p_equipment_id, v_po\.company_id, v_po\.project_id, v_entry_date, auth\.uid\(\), v_last\.id \)/)
  assert.match(add, /'entry_log_id', v_last\.id/)
})

test('create_supplier_po takes the party and the equipment, in one transaction', () => {
  assert.match(
    norm(stripped),
    /DROP FUNCTION IF EXISTS public\.create_supplier_po\(uuid, uuid, uuid, date, text\);/,
  )
  const create = fn('create_supplier_po')
  assert.match(
    create,
    /create_supplier_po\( p_lessor_id uuid, p_owner_class text, p_company_id uuid, p_project_id uuid, p_start_date date, p_notes text DEFAULT NULL, p_equipment jsonb DEFAULT '\[\]'::jsonb \)/,
  )
  assert.match(create, /IF p_lessor_id IS NULL AND p_owner_class IS NULL THEN RAISE EXCEPTION 'party_required'/)
  assert.match(create, /IF p_lessor_id IS NOT NULL AND p_owner_class IS NOT NULL THEN RAISE EXCEPTION 'invalid_party'/)
  assert.match(create, /RAISE EXCEPTION 'invalid_owner_class'/)
  assert.match(create, /po_number, lessor_id, owner_class, is_internal, company_id, project_id, start_date, notes, created_by/)
  assert.match(create, /FOR v_item IN SELECT value FROM jsonb_array_elements\(COALESCE\(p_equipment, '\[\]'::jsonb\)\) LOOP PERFORM public\.add_supplier_po_equipment\( v_id, NULLIF\(v_item->>'equipment_id', ''\)::uuid, NULLIF\(v_item->>'price', ''\)::numeric, v_item->>'note' \); END LOOP;/)
  assert.match(
    norm(stripped),
    /GRANT EXECUTE ON FUNCTION public\.create_supplier_po\(uuid, text, uuid, uuid, date, text, jsonb\) TO authenticated;/,
  )
})

test('update_supplier_po_equipment_price keeps the price mandatory and drops the internal rule', () => {
  const update = fn('update_supplier_po_equipment_price')
  assert.doesNotMatch(update, /internal_price_must_be_zero|is_internal_equipment/)
  assert.match(update, /IF p_price IS NULL OR p_price < 0 OR p_price > 9999999999\.99 THEN RAISE EXCEPTION 'invalid_price'/)
  assert.match(update, /'price_changed'/)
  // Nothing of the movements or the policies is touched.
  assert.doesNotMatch(stripped, /CREATE POLICY|DROP POLICY|entry_exit_logs\s+(ENABLE|DISABLE|ALTER)|legacy_role_permissions/)
  const created = [...stripped.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(/g)].map((m) => m[1])
  assert.deepEqual(created, [
    'unpriced_count',
    'add_supplier_po_equipment',
    'create_supplier_po',
    'update_supplier_po_equipment_price',
  ])
})
