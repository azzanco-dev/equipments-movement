const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0193 (owner decisions 2026-11-12): «حلو قفل الحركة, اعتمده» (a
// movement whose card sits on a PO is locked), «حذف الامر الدرافت مو موجود؟
// سويه» (delete a draft supplier PO), «حلو يصير لازم يكون فيه معدة» (a PO
// needs a unit) and «اذا اختلفت الوحدة يرفض» (card pricing needs the same
// unit on both sides).

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

const FILE = '20261112100000_0193_movement_po_lock_delete_draft.sql'
const SQL = read('supabase', 'migrations', FILE)
const PREV = read(
  'supabase',
  'migrations',
  '20261111110000_0190_po_number_at_approval.sql',
)
/** The migration without its `--` comments. */
const strip = (s) => s.replace(/--[^\n]*/g, '')
const CODE = strip(SQL)

/** The whole CREATE … $$; of one function. */
function fn(code, name) {
  const start = code.search(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`),
  )
  assert.ok(start >= 0, `${name} is in the migration`)
  const open = code.indexOf('AS $$', start)
  const close = code.indexOf('$$;', open)
  return code.slice(start, close + 3)
}
const body = (name) => {
  const all = fn(CODE, name)
  return all.slice(all.indexOf('AS $$'))
}
const squash = (s) => s.replace(/\s+/g, ' ').trim()

test('LF line endings and no later migration re-creates the functions', () => {
  assert.ok(!SQL.includes('\r'), 'LF only')
  const dir = path.join(ROOT, 'supabase', 'migrations')
  const later = fs.readdirSync(dir).filter((f) => f > FILE)
  // 0194 (free start date) re-creates two of them on purpose; its own test
  // checks they are the 0193 bodies plus its change.
  const recreatedBy = {
    '20261114100000_0194_po_free_start_date.sql': ['guard_movement_with_po', 'create_supplier_po'],
  }
  for (const f of later) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const name of [
      'guard_movement_with_po',
      'delete_supplier_po',
      'create_supplier_po',
      'approve_equipment_card_pricing',
    ]) {
      if ((recreatedBy[f] || []).includes(name)) continue
      assert.ok(
        !new RegExp(`FUNCTION public\\.${name}\\(`).test(text),
        `${f} re-creates ${name}`,
      )
    }
  }
})

test('the header quotes the four owner decisions', () => {
  for (const quote of [
    'حلو يصير لازم يكون فيه معدة',
    'حلو قفل الحركة, اعتمده',
    'حذف الامر الدرافت مو موجود؟ سويه',
    'اذا اختلفت الوحدة يرفض',
  ]) {
    assert.ok(SQL.includes(quote), quote)
  }
})

test('every function is SECURITY DEFINER with a fixed search_path and a comment', () => {
  for (const name of [
    'guard_movement_with_po',
    'delete_supplier_po',
    'create_supplier_po',
    'approve_equipment_card_pricing',
  ]) {
    const head = fn(CODE, name)
    assert.match(head, /SECURITY DEFINER/)
    assert.match(head, /SET search_path = public, pg_temp/)
    assert.match(CODE, new RegExp(`COMMENT ON FUNCTION public\\.${name}\\(`))
  }
  assert.match(
    CODE,
    /REVOKE ALL ON FUNCTION public\.guard_movement_with_po\(\) FROM PUBLIC, anon, authenticated;/,
  )
  assert.ok(!/GRANT EXECUTE ON FUNCTION public\.guard_movement_with_po/.test(CODE))
  for (const sig of [
    'delete_supplier_po\\(uuid\\)',
    'create_supplier_po\\(uuid, text, uuid, uuid, date, text, jsonb\\)',
    'approve_equipment_card_pricing\\(uuid\\)',
  ]) {
    assert.match(CODE, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig}\\s+FROM PUBLIC, anon;`))
    assert.match(CODE, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig}\\s+TO authenticated;`))
  }
})

test('A: the trigger guards every update and delete of a movement', () => {
  assert.match(
    squash(CODE),
    /CREATE TRIGGER entry_exit_logs_po_guard BEFORE UPDATE OR DELETE ON public\.entry_exit_logs FOR EACH ROW EXECUTE FUNCTION public\.guard_movement_with_po\(\);/,
  )
  assert.match(CODE, /CREATE INDEX IF NOT EXISTS equipment_cards_entry_log_idx/)
})

test('A: the cheap exit compares the locked facts before any query', () => {
  const b = body('guard_movement_with_po')
  const exit = b.indexOf('RETURN NEW;')
  const firstQuery = b.search(/\bSELECT\b|\bEXISTS\b/)
  assert.ok(exit > 0 && exit < firstQuery, 'RETURN NEW before the first query')
  for (const col of [
    'equipment_id',
    'company_id',
    'project_id',
    'movement_type',
    'movement_context',
  ]) {
    assert.match(b, new RegExp(`NEW\\.${col} IS NOT DISTINCT FROM OLD\\.${col}`))
  }
  assert.match(b, /\(OLD\.recorded_at AT TIME ZONE 'Asia\/Riyadh'\)::date/)
  assert.match(b, /\(NEW\.recorded_at AT TIME ZONE 'Asia\/Riyadh'\)::date/)
})

test('A: movement_on_po carries the PO numbers, supplier first', () => {
  const b = body('guard_movement_with_po')
  assert.match(b, /RAISE EXCEPTION 'movement_on_po'/)
  assert.ok(!/RAISE EXCEPTION 'movement_on_po'\s+USING ERRCODE = '(?!55000)/.test(b))
  assert.match(b, /DETAIL = v_numbers/)
  assert.match(b, /DETAIL = 'card months'/)
  const sup = b.indexOf('string_agg(DISTINCT sp.po_number')
  const cli = b.indexOf('string_agg(DISTINCT cp.po_number')
  assert.ok(sup > 0 && cli > sup, 'supplier numbers before client numbers')
  assert.match(b, /concat_ws\(', '/)
  assert.match(b, /ORDER BY sp\.po_number/)
  assert.match(b, /ORDER BY cp\.po_number/)
})

test('A: delete refuses a card on a PO or with months, else deletes the cards', () => {
  const b = body('guard_movement_with_po')
  const at = b.indexOf("IF TG_OP = 'DELETE' THEN\n    IF v_numbers")
  assert.ok(at >= 0, 'the delete branch')
  const del = b.slice(at)
  assert.match(del, /equipment_card_months/)
  assert.match(
    del,
    /DELETE FROM public\.equipment_cards c WHERE c\.entry_log_id = OLD\.id;\s+RETURN OLD;/,
  )
})

test('A: an update keeps cards on a PO consistent and moves the orphan cards', () => {
  const b = squash(body('guard_movement_with_po'))
  assert.match(b, /NEW\.movement_type = 'entry' AND NEW\.movement_context = 'site'/)
  assert.match(b, /c\.company_id IS DISTINCT FROM NEW\.company_id/)
  assert.match(b, /sp\.start_date IS DISTINCT FROM v_new_day/)
  assert.match(
    b,
    /UPDATE public\.equipment_cards c SET equipment_id = NEW\.equipment_id, company_id = NEW\.company_id, project_id = NEW\.project_id/,
  )
  assert.match(b, /pg_advisory_xact_lock\(hashtextextended\(OLD\.equipment_id::text, 0\)\)/)
  assert.match(b, /FOR UPDATE/)
})

test('A: the admin movement functions are not re-created', () => {
  assert.ok(!/FUNCTION public\.admin_update_movement\(/.test(CODE))
  assert.ok(!/FUNCTION public\.admin_delete_movement\(/.test(CODE))
})

test('B: supplier_po_deletions is append-only and read by purchasing.view', () => {
  const table = squash(
    CODE.slice(
      CODE.indexOf('CREATE TABLE public.supplier_po_deletions'),
      CODE.indexOf(');', CODE.indexOf('CREATE TABLE public.supplier_po_deletions')),
    ),
  )
  for (const col of [
    'po_id uuid NOT NULL',
    'po_number text NOT NULL',
    'lines jsonb NOT NULL',
    'events jsonb NOT NULL',
    'deleted_by uuid',
    'deleted_by_name text',
    'created_at timestamptz NOT NULL DEFAULT now()',
  ]) {
    assert.ok(table.includes(col), col)
  }
  assert.ok(!/updated_at/.test(table), 'append-only: no updated_at')
  assert.ok(!/REFERENCES public\.supplier_pos/.test(table), 'no FK to the PO')
  assert.match(CODE, /ALTER TABLE public\.supplier_po_deletions ENABLE ROW LEVEL SECURITY;/)
  assert.match(
    squash(CODE),
    /CREATE POLICY select_supplier_po_deletions ON public\.supplier_po_deletions FOR SELECT TO authenticated USING \(\(SELECT public\.has_permission\('purchasing\.view'\)\)\);/,
  )
  assert.ok(!/POLICY \w+ ON public\.supplier_po_deletions\s+FOR (INSERT|UPDATE|DELETE|ALL)/.test(CODE))
})

test('B: delete_supplier_po checks, records and deletes in order', () => {
  const b = body('delete_supplier_po')
  const steps = [
    'PERFORM public.assert_purchasing_manage();',
    "RAISE EXCEPTION 'invalid_po' USING ERRCODE = '22023'",
    "RAISE EXCEPTION 'po_approved_locked'",
    "RAISE EXCEPTION 'po_number_issued'",
    'FROM public.supplier_po_events e',
    'pg_advisory_xact_lock(hashtextextended(v_unit.equipment_id::text, 0))',
    'DELETE FROM public.supplier_po_equipment WHERE id = v_line.id;',
    'INSERT INTO public.supplier_po_deletions',
    'DELETE FROM public.supplier_pos WHERE id = v_po.id;',
  ]
  let at = -1
  for (const step of steps) {
    const next = b.indexOf(step, at + 1)
    assert.ok(next > at, `in order: ${step}`)
    at = next
  }
  assert.match(b, /po_number !~ '\^DRAFT-\[0-9\]\{4,\}\$'/)
  assert.match(b, /HINT = 'A PO whose official number was issued cannot be deleted\.'/)
  assert.match(b, /ORDER BY c\.equipment_id/)
  assert.match(b, /ORDER BY e\.created_at, e\.seq/)
  assert.match(b, /FROM public\.profile_names/)
  for (const key of ['po_id', 'po_number', 'line_count', 'cards_deleted']) {
    assert.match(b, new RegExp(`'${key}'`))
  }
  for (const key of ['line_id', 'equipment_code', 'card_id', 'card_deleted', 'price', 'rate_unit', 'note']) {
    assert.match(b, new RegExp(`'${key}'`))
  }
})

test('B: the card rule is the one of remove_supplier_po_equipment', () => {
  const b = squash(body('delete_supplier_po'))
  for (const part of [
    "v_card.pricing_status = 'draft'",
    'v_card.client_price IS NULL',
    'SELECT 1 FROM public.supplier_po_equipment l WHERE l.equipment_card_id = v_card.id',
    'SELECT 1 FROM public.client_po_equipment l WHERE l.equipment_card_id = v_card.id',
    'SELECT 1 FROM public.equipment_card_months m WHERE m.equipment_card_id = v_card.id',
    'SELECT 1 FROM public.equipment_card_events ev WHERE ev.equipment_card_id = v_card.id',
    'DELETE FROM public.equipment_cards WHERE id = v_card.id;',
  ]) {
    assert.ok(b.includes(part), part)
  }
  assert.ok(!/FUNCTION public\.remove_supplier_po_equipment\(/.test(CODE))
})

test('C: create_supplier_po is 0190 verbatim plus po_has_no_lines before the reference', () => {
  const now = fn(CODE, 'create_supplier_po')
  const before = fn(strip(PREV), 'create_supplier_po')
  const check = now.match(
    /\s*IF p_equipment IS NULL OR jsonb_array_length\(p_equipment\) = 0 THEN[\s\S]*?END IF;/,
  )
  assert.ok(check, 'the new check')
  assert.match(check[0], /'po_has_no_lines'/)
  assert.match(check[0], /ERRCODE = '55000'/)
  assert.match(check[0], /HINT = 'A purchase order needs at least one unit\.'/)
  assert.equal(squash(now.replace(check[0], '')), squash(before))
  assert.ok(
    now.indexOf("'po_has_no_lines'") < now.indexOf('next_supplier_po_draft_ref()'),
    'before the draft reference',
  )
  assert.ok(now.indexOf('jsonb_typeof(p_equipment)') < now.indexOf("'po_has_no_lines'"))
})

test('D: approve_equipment_card_pricing adds the unit match, priced lines and the re-read', () => {
  const now = fn(CODE, 'approve_equipment_card_pricing')
  const b = squash(now)
  assert.match(b, /IF v_card\.client_price_unit IS DISTINCT FROM v_line\.rate_unit THEN RAISE EXCEPTION 'card_pricing_unit_mismatch' USING ERRCODE = '55000'/)
  assert.match(b, /AND NOT EXISTS \( SELECT 1 FROM public\.supplier_po_equipment l WHERE l\.supplier_po_id = v_po\.id AND l\.price IS NULL \)/)
  const lock = now.indexOf('FOR UPDATE;', now.indexOf('FROM public.supplier_pos p'))
  const reread = now.indexOf('WHERE sl.id = v_line.id')
  const priceCheck = now.indexOf("'card_pricing_no_supplier_price'")
  const unitCheck = now.indexOf("'card_pricing_unit_mismatch'")
  assert.ok(lock > 0 && reread > lock, 're-read after the PO lock')
  assert.ok(priceCheck > reread && unitCheck > priceCheck, 'checks on the locked line')
  assert.match(b, /ORDER BY sp\.created_at DESC, sp\.id DESC LIMIT 1/)
  // Everything else is the 0190 body: the old body's statements are all here.
  const before = squash(fn(strip(PREV), 'approve_equipment_card_pricing'))
  for (const piece of [
    "SET pricing_status = 'approved'",
    "'via', 'card_pricing'",
    "v_po.po_number ~ '^DRAFT-[0-9]{4,}$'",
    'public.next_supplier_po_number()',
    "'supplier_po_approved', v_po_approved",
  ]) {
    assert.ok(before.includes(piece) && b.includes(piece), piece)
  }
})

test('E: the closing guard checks the trigger, the table and both tokens', () => {
  const guard = CODE.slice(CODE.lastIndexOf('DO $$'))
  assert.match(guard, /entry_exit_logs_po_guard/)
  assert.match(guard, /to_regprocedure\('public\.delete_supplier_po\(uuid\)'\)/)
  assert.match(guard, /to_regclass\('public\.supplier_po_deletions'\)/)
  assert.match(guard, /pg_get_functiondef/)
  assert.match(guard, /'po_has_no_lines'/)
  assert.match(guard, /'card_pricing_unit_mismatch'/)
})
