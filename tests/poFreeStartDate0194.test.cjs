const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0194 (owner 2026-11-14): «خلي تاريخ البداية قابل للتعديل في
// نموذج الانشاء», «اي تاريخ», editable after creation on a draft with units;
// the units of one PO still entered on the same Saudi day.

const ROOT = path.join(__dirname, '..')
const DIR = path.join(ROOT, 'supabase', 'migrations')
const read = (file) => fs.readFileSync(path.join(DIR, file), 'utf8')

const FILE = '20261114100000_0194_po_free_start_date.sql'
const SQL = read(FILE)
const M0189 = read('20261111100000_0189_po_start_date_only.sql')
const M0192 = read('20261111130000_0192_site_visits_created_at.sql')
const M0193 = read('20261112100000_0193_movement_po_lock_delete_draft.sql')

/** Without `--` comments. */
const strip = (s) => s.replace(/--[^\n]*/g, '')
const squash = (s) => s.replace(/\s+/g, ' ').trim()
const CODE = strip(SQL)

/** The whole CREATE … $$; of one function. */
function fn(code, name) {
  const start = code.search(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`),
  )
  assert.ok(start >= 0, `${name} is there`)
  const open = code.indexOf('AS $$', start)
  return code.slice(start, code.indexOf('$$;', open) + 3)
}
/** The whole CREATE … VIEW … ; of one view. */
function view(code, name) {
  const start = code.search(
    new RegExp(`CREATE (?:OR REPLACE )?VIEW public\\.${name}\\b`),
  )
  assert.ok(start >= 0, `${name} is there`)
  return code.slice(start, code.indexOf(';\n', start) + 1)
}

test('0194 is the single 0194 migration, after 0193, LF only', () => {
  const files = fs.readdirSync(DIR)
  assert.equal(files.filter((f) => /_0194_/.test(f)).length, 1)
  assert.ok(FILE > '20261112100000_0193_movement_po_lock_delete_draft.sql')
  assert.ok(!SQL.includes('\r'))
})

test('the header quotes the owner', () => {
  for (const q of ['خلي تاريخ البداية قابل للتعديل في نموذج', 'اي تاريخ', 'نفس تاريخ الدخول']) {
    assert.ok(SQL.includes(q), q)
  }
  assert.match(SQL, /po_start_date_locked \(raised by nothing\)/)
})

test('A: the five-argument add is dropped, the six-argument one granted', () => {
  assert.match(
    CODE,
    /DROP FUNCTION IF EXISTS public\.add_supplier_po_equipment\(uuid, uuid, numeric, text, text\);/,
  )
  const head = squash(fn(CODE, 'add_supplier_po_equipment'))
  assert.match(
    head,
    /add_supplier_po_equipment\( p_po_id uuid, p_equipment_id uuid, p_price numeric DEFAULT NULL, p_note text DEFAULT NULL, p_rate_unit text DEFAULT 'month', p_entry_log_id uuid DEFAULT NULL \) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp/,
  )
  const sig = 'add_supplier_po_equipment\\(uuid, uuid, numeric, text, text, uuid\\)'
  assert.match(CODE, new RegExp(`COMMENT ON FUNCTION public\\.${sig} IS`))
  assert.match(CODE, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig}\\s+FROM PUBLIC, anon;`))
  assert.match(CODE, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig}\\s+TO authenticated;`))
  assert.ok(CODE.indexOf('DROP FUNCTION IF EXISTS public.add_supplier_po_equipment') <
    CODE.indexOf('CREATE OR REPLACE FUNCTION public.add_supplier_po_equipment'))
})

test('A: the visit no longer reads the start date; the same-day rule compares the lines', () => {
  const body = fn(CODE, 'add_supplier_po_equipment')
  // The start date is read ONCE, and only as a preference in the ORDER BY of
  // a caller that names no entry (the screens deployed before 0194 send a
  // start date equal to the ticked visit's entry day): never as a condition.
  assert.equal((body.match(/start_date/g) || []).length, 1, 'the start date only as a preference')
  const b = squash(body)
  assert.match(b, /\(\(l\.recorded_at AT TIME ZONE 'Asia\/Riyadh'\)::date = v_po\.start_date\) DESC, \(l\.id IS NOT DISTINCT FROM v_last\.id\) DESC/)
  assert.match(b, /IF p_entry_log_id IS NOT NULL THEN SELECT l\.\* INTO v_entry FROM public\.entry_exit_logs l WHERE l\.id = p_entry_log_id AND l\.equipment_id = p_equipment_id AND l\.movement_type = 'entry' AND l\.movement_context = 'site' AND l\.company_id = v_po\.company_id AND l\.project_id = v_po\.project_id;/)
  assert.equal((b.match(/RAISE EXCEPTION 'equipment_not_at_po_project' USING ERRCODE = '55000'/g) || []).length, 2)
  assert.match(b, /\(l\.id IS NOT DISTINCT FROM v_last\.id\) DESC, l\.recorded_at DESC, l\.id DESC/)
  assert.match(b, /RAISE EXCEPTION 'entry_date_mismatch' USING ERRCODE = '55000', HINT = 'The equipment entered the project on a day other than the PO''s units\.'/)
  assert.match(b, /= \(v_entry\.recorded_at AT TIME ZONE 'Asia\/Riyadh'\)::date/)
  // The rest of the 0189 body is kept.
  for (const piece of [
    "RAISE EXCEPTION 'po_approved_locked'",
    "RAISE EXCEPTION 'equipment_not_of_po_supplier'",
    'pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0))',
    'AND c.entry_log_id = v_entry.id',
    "RAISE EXCEPTION 'equipment_already_on_po' USING ERRCODE = '23505'",
    "'entry_log_id', v_entry.id",
  ]) {
    assert.ok(b.includes(piece), piece)
    assert.ok(squash(fn(strip(M0189), 'add_supplier_po_equipment')).includes(piece), `0189: ${piece}`)
  }
})

test('B: create_supplier_po is 0193 plus the item entry_log_id', () => {
  const now = squash(fn(CODE, 'create_supplier_po'))
  const before = squash(fn(strip(M0193), 'create_supplier_po'))
  assert.equal(
    now,
    before.replace(
      "NULLIF(v_item->>'rate_unit', '') );",
      "NULLIF(v_item->>'rate_unit', ''), NULLIF(v_item->>'entry_log_id', '')::uuid );",
    ),
  )
  assert.match(SQL, /entry_log_id\|null \(0194: the unit''s visit\)/)
})

test('C: update_supplier_po is 0189 minus the start-date lock', () => {
  const now = fn(CODE, 'update_supplier_po')
  assert.ok(!now.includes('po_start_date_locked'))
  assert.match(now, /'po_approved_locked'/)
  const before = fn(strip(M0189), 'update_supplier_po')
  const lock = before.match(/\s*IF p_start_date <> v_po\.start_date AND EXISTS \([\s\S]*?END IF;/)
  assert.ok(lock && lock[0].includes('po_start_date_locked'))
  assert.equal(squash(now), squash(before.replace(lock[0], '')))
})

test('D: the guard refuses a day change on a supplier PO line without the start date', () => {
  const now = fn(CODE, 'guard_movement_with_po')
  assert.ok(!now.includes('start_date'))
  const before = squash(fn(strip(M0193), 'guard_movement_with_po'))
  assert.equal(
    squash(now),
    before.replace(
      ' JOIN public.supplier_pos sp ON sp.id = sl.supplier_po_id WHERE c.entry_log_id = OLD.id AND sp.start_date IS DISTINCT FROM v_new_day )',
      ' WHERE c.entry_log_id = OLD.id )',
    ),
  )
  assert.match(CODE, /REVOKE ALL ON FUNCTION public\.guard_movement_with_po\(\) FROM PUBLIC, anon, authenticated;/)
  assert.ok(!/CREATE TRIGGER/.test(CODE), 'the trigger is not re-created')
})

test('E: the two views keep their columns and find the PO by the card entry', () => {
  const cases = [
    ['purchasing_site_visits', M0192],
    ['purchasing_site_units', M0189],
  ]
  const oldLateral = [
    'OR p.start_date <= (v.entry_at AT TIME ZONE \'Asia/Riyadh\')::date',
    'p.start_date DESC, p.created_at DESC, p.id DESC',
  ]
  for (const [name, prev] of cases) {
    const now = squash(view(CODE, name))
    const before = squash(view(strip(prev), name)).replace(/^CREATE VIEW/, 'CREATE OR REPLACE VIEW')
    assert.match(now, /WITH \(security_invoker = true\)/)
    const expected = before
      .replace(
        'JOIN public.supplier_pos p ON p.id = l.supplier_po_id WHERE c.equipment_id',
        'JOIN public.supplier_pos p ON p.id = l.supplier_po_id LEFT JOIN public.entry_exit_logs ce ON ce.id = c.entry_log_id WHERE c.equipment_id',
      )
      .replace(oldLateral[0], 'OR (ce.recorded_at, ce.id) <= (v.entry_at, v.entry_id)')
      .replace(oldLateral[1], 'ce.recorded_at DESC NULLS LAST, ce.id DESC NULLS LAST, p.created_at DESC, p.id DESC')
    assert.equal(now, expected, name)
    // party_po keeps the start date of the entry day.
    assert.ok(now.includes("AND p.start_date = (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date AND p.approval_status = 'draft'"))
    assert.match(CODE, new RegExp(`COMMENT ON VIEW public\\.${name} IS`))
    assert.match(CODE, new RegExp(`REVOKE ALL ON public\\.${name} FROM PUBLIC, anon;`))
    assert.match(CODE, new RegExp(`GRANT SELECT ON public\\.${name} TO authenticated;`))
  }
  assert.ok(!/SECURITY DEFINER/.test(view(CODE, 'purchasing_site_visits')))
})

test('F: the closing guard and the schema reload', () => {
  const guard = CODE.slice(CODE.lastIndexOf('DO $$'))
  assert.match(guard, /to_regprocedure\('public\.add_supplier_po_equipment\(uuid, uuid, numeric, text, text\)'\) IS NOT NULL/)
  assert.match(guard, /to_regprocedure\('public\.add_supplier_po_equipment\(uuid, uuid, numeric, text, text, uuid\)'\) IS NULL/)
  assert.match(guard, /'po_start_date_locked' IN pg_get_functiondef/)
  assert.match(guard, /'entry_log_id' IN pg_get_functiondef/)
  assert.match(SQL.trimEnd(), /NOTIFY pgrst, 'reload schema';$/)
})

test('no later migration re-creates the 0194 objects', () => {
  const later = fs.readdirSync(DIR).filter((f) => f > FILE)
  for (const f of later) {
    const text = read(f)
    for (const re of [
      /FUNCTION public\.add_supplier_po_equipment\(/,
      /FUNCTION public\.create_supplier_po\(/,
      /FUNCTION public\.update_supplier_po\(/,
      /FUNCTION public\.guard_movement_with_po\(/,
      /VIEW public\.purchasing_site_visits\b/,
      /VIEW public\.purchasing_site_units\b/,
    ]) {
      assert.ok(!re.test(text), `${f}: ${re}`)
    }
  }
})
