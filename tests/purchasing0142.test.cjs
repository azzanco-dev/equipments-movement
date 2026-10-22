// Migration 0142 (owner review 2026-10-22): an OPEN supplier PO's start date
// and notes can be edited (`update_supplier_po`, event `updated`) and a line
// is edited with its price AND note in one call
// (`update_supplier_po_equipment`; `price_changed` or `line_updated`).
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261022100000_0142_supplier_po_update.sql'
const PREVIOUS = '20261021100000_0141_supplier_po_events_seq.sql'

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

test('0142 is the single 0142 migration, right after 0141', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0142 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0142_/.test(file)).length, 1)
})

test('the event log accepts updated and line_updated', () => {
  const body = norm(stripped)
  const drop = body.indexOf('ALTER TABLE public.supplier_po_events DROP CONSTRAINT supplier_po_events_type_check;')
  const add = body.indexOf(
    "ADD CONSTRAINT supplier_po_events_type_check CHECK ( event_type IN ( 'created', 'updated', 'equipment_added', 'price_changed', 'line_updated', 'card_changed', 'closed' ) );",
  )
  assert.ok(drop >= 0 && add > drop)
})

test('update_supplier_po: an open PO, start date and notes only, old and new recorded', () => {
  const update = fn('update_supplier_po')
  assert.match(update, /update_supplier_po\( p_po_id uuid, p_start_date date, p_notes text DEFAULT NULL \) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(update, /PERFORM public\.assert_purchasing_manage\(\);/)
  assert.match(update, /WHERE p\.id = p_po_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'invalid_po' USING ERRCODE = '22023'/)
  assert.match(update, /IF v_po\.status <> 'open' THEN RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000'/)
  assert.match(update, /IF p_start_date IS NULL THEN RAISE EXCEPTION 'invalid_start_date'/)
  assert.match(update, /v_notes := NULLIF\(btrim\(p_notes\), ''\); IF char_length\(v_notes\) > 1000 THEN RAISE EXCEPTION 'invalid_notes'/)
  // A no-op save writes nothing (no empty event).
  assert.match(update, /IF p_start_date = v_po\.start_date AND v_notes IS NOT DISTINCT FROM v_po\.notes THEN RETURN; END IF;/)
  // Only these two columns change: never the party, company, project or status.
  assert.match(update, /UPDATE public\.supplier_pos SET start_date = p_start_date, notes = v_notes WHERE id = p_po_id;/)
  assert.doesNotMatch(update, /SET [^;]*(lessor_id|owner_class|company_id|project_id|status|po_number)/)
  assert.match(update, /'updated', jsonb_build_object\( 'old_start_date', v_po\.start_date, 'new_start_date', p_start_date, 'old_notes', v_po\.notes, 'new_notes', v_notes \), auth\.uid\(\)/)
  assert.match(norm(stripped), /REVOKE ALL ON FUNCTION public\.update_supplier_po\(uuid, date, text\) FROM PUBLIC, anon;/)
  assert.match(norm(stripped), /GRANT EXECUTE ON FUNCTION public\.update_supplier_po\(uuid, date, text\) TO authenticated;/)
})

test('update_supplier_po_equipment: price (nullable) and note together, one event', () => {
  const update = fn('update_supplier_po_equipment')
  assert.match(update, /update_supplier_po_equipment\( p_line_id uuid, p_price numeric, p_note text DEFAULT NULL \) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(update, /PERFORM public\.assert_purchasing_manage\(\);/)
  assert.match(update, /WHERE l\.id = p_line_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'invalid_line'/)
  assert.match(update, /WHERE p\.id = v_line\.supplier_po_id FOR UPDATE; IF v_status <> 'open' THEN RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000'/)
  // 0138: the price stays optional (NULL = unpriced); no internal rule.
  assert.match(update, /IF p_price IS NOT NULL AND \(p_price < 0 OR p_price > 9999999999\.99\) THEN RAISE EXCEPTION 'invalid_price'/)
  assert.doesNotMatch(update, /internal_price_must_be_zero|is_internal_equipment/)
  assert.match(update, /v_note := NULLIF\(btrim\(p_note\), ''\); IF char_length\(v_note\) > 500 THEN RAISE EXCEPTION 'invalid_note'/)
  assert.match(update, /v_price_changed := p_price IS DISTINCT FROM v_line\.price; IF NOT v_price_changed AND v_note IS NOT DISTINCT FROM v_line\.note THEN RETURN; END IF;/)
  assert.match(update, /UPDATE public\.supplier_po_equipment SET price = p_price, note = v_note WHERE id = v_line\.id;/)
  assert.match(update, /CASE WHEN v_price_changed THEN 'price_changed' ELSE 'line_updated' END/)
  assert.match(update, /'old_price', v_line\.price, 'new_price', p_price, 'old_note', v_line\.note, 'new_note', v_note/)
  assert.match(norm(stripped), /REVOKE ALL ON FUNCTION public\.update_supplier_po_equipment\(uuid, numeric, text\) FROM PUBLIC, anon;/)
  assert.match(norm(stripped), /GRANT EXECUTE ON FUNCTION public\.update_supplier_po_equipment\(uuid, numeric, text\) TO authenticated;/)
})

test('0142 touches nothing else', () => {
  assert.doesNotMatch(stripped, /CREATE POLICY|DROP POLICY|entry_exit_logs|legacy_role_permissions|is_admin\(\)/)
  const created = [...stripped.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(/g)].map((m) => m[1])
  assert.deepEqual(created, ['update_supplier_po', 'update_supplier_po_equipment'])
  // The 0136/0138 price-only function is not re-created or dropped.
  assert.doesNotMatch(stripped, /update_supplier_po_equipment_price/)
})

test('the client knows the two new events and calls the two new functions', () => {
  const purchasing = read('src', 'lib', 'purchasing.ts')
  assert.match(purchasing, /\| 'updated'\n/)
  assert.match(purchasing, /\| 'line_updated'\n/)
  assert.match(purchasing, /updated: 'supplierPoEventUpdated'/)
  assert.match(purchasing, /line_updated: 'supplierPoEventLineUpdated'/)
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(data, /supabase\.rpc\('update_supplier_po', \{\s*p_po_id: input\.poId,\s*p_start_date: input\.startDate,\s*p_notes: input\.notes\.trim\(\) \|\| null,/)
  assert.match(data, /supabase\.rpc\('update_supplier_po_equipment', \{\s*p_line_id: input\.lineId,\s*p_price: input\.price,\s*p_note: input\.note\.trim\(\) \|\| null,/)
  // The timeline shows a start date change as old → new.
  assert.match(data, /case 'updated':/)
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of ['supplierPoEventUpdated', 'supplierPoEventLineUpdated', 'supplierPoEditLine', 'supplierPoEdit'])
    assert.equal((translations.match(new RegExp(`^\\s+${key}:`, 'gm')) ?? []).length, 2, `${key} in ar and en`)
  // New Arabic copy: plain alif only.
  const arabic = translations.slice(0, translations.indexOf('en: {'))
  for (const line of arabic.split('\n').filter((l) => /supplierPoE(vent(Updated|LineUpdated)|dit(Line|LineDesc|Desc)?):/.test(l)))
    assert.doesNotMatch(line, /[أإآ]/, line)
})
