const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0197 (owner approval 2026-11-15, «اضافة زيارة كاملة»): a whole
// PAST project visit, its entry and its exit together, recorded in the name
// of a foreman through add_past_site_visit.

const ROOT = path.join(__dirname, '..')
const DIR = path.join(ROOT, 'supabase', 'migrations')
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
const FILE = '20261115100000_0197_add_past_site_visit.sql'
const read = (file) => fs.readFileSync(path.join(DIR, file), 'utf8')
const SQL = read(FILE)
const M0195 = read('20261114120000_0195_nested_workshop_visits.sql')
const M0156 = read('20261028110000_0156_drop_legacy_role.sql')

const strip = (s) => s.replace(/--[^\n]*/g, '')
const squash = (s) => s.replace(/\s+/g, ' ').trim()
const norm = (s) => squash(strip(s))
const CODE = strip(SQL)

function fn(code, name) {
  const start = code.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`))
  assert.ok(start >= 0, `${name} is there`)
  const open = code.indexOf('AS $$', start)
  return code.slice(start, code.indexOf('$$;', open + 5) + 3)
}

const FN = norm(fn(CODE, 'add_past_site_visit'))
const SEQ = norm(fn(CODE, 'enforce_movement_sequence'))
const DRV = norm(fn(CODE, 'enforce_site_entry_driver'))
const SIG = 'public.add_past_site_visit(uuid, uuid, uuid, uuid, date, date, uuid, text, text)'
const MARKER = "current_setting('app.past_site_visit', true) = NEW.equipment_id::text"

test('0197 is the single 0197 migration, after 0196, LF only, plain alif', () => {
  assert.equal(FILES.filter((f) => /_0197_/.test(f)).length, 1)
  assert.ok(FILE > '20261114130000_0196_nested_workshop_notices.sql')
  assert.ok(!SQL.includes('\r'))
  assert.ok(!/[أإآ]/.test(SQL))
  assert.ok(!/[ \t]+$/m.test(SQL), 'no trailing whitespace')
})

test('the header names the objects and the rollout', () => {
  assert.ok(SQL.includes('اضافة زيارة كاملة'))
  assert.match(SQL, /Rollout: apply before deploying the screens that call it; nothing live\n-- depends on it/)
  for (const piece of ['enforce_movement_sequence() (latest 0195)', 'enforce_site_entry_driver() (latest 0156)', 'add_past_site_visit(...): NEW']) {
    assert.ok(SQL.includes(piece), piece)
  }
})

test('the permission key, unscoped, enforced in the database, held by admin', () => {
  const c = norm(CODE)
  assert.ok(c.includes(
    "INSERT INTO public.permissions ( key, group_key, name_ar, name_en, description_ar, description_en, scoped, scopes, requires, admin_only, enforced_in, sort ) VALUES ( 'movements.site.add_past_visit', 'movements', 'الحركات: اضافة زيارة كاملة بتاريخ سابق', 'Movements: add a whole past project visit',",
  ))
  assert.ok(c.includes("false, NULL, ARRAY['movements.read'], false, 'database', 115 ) ON CONFLICT (key) DO NOTHING;"))
  assert.ok(c.includes("INSERT INTO public.role_permissions (role_key, permission_key, scope) VALUES ('admin', 'movements.site.add_past_visit', NULL) ON CONFLICT (role_key, permission_key) DO NOTHING;"))
})

test('the function signature, SECURITY DEFINER, search_path, grants', () => {
  assert.ok(FN.startsWith(
    'CREATE OR REPLACE FUNCTION public.add_past_site_visit( p_equipment_id uuid, p_supervisor_id uuid, p_company_id uuid, p_project_id uuid, p_entry_date date, p_exit_date date, p_driver_id uuid DEFAULT NULL, p_contractor_equipment_code text DEFAULT NULL, p_notes text DEFAULT NULL ) RETURNS TABLE (entry_id uuid, exit_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$',
  ))
  const c = norm(CODE)
  assert.ok(c.includes(`REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC, anon;`))
  assert.ok(c.includes(`GRANT EXECUTE ON FUNCTION ${SIG} TO authenticated;`))
  assert.ok(!/GRANT[^;]*add_past_site_visit[^;]*TO (?:anon|PUBLIC)/i.test(c))
  assert.ok(c.includes(`COMMENT ON FUNCTION ${SIG} IS`))
})

test('the gate comes first, then every token with its code', () => {
  const gate = "IF auth.uid() IS NULL OR NOT public.has_permission('movements.site.add_past_visit') THEN RAISE EXCEPTION 'past_visit_required' USING ERRCODE = '42501'"
  assert.ok(FN.includes(gate))
  const order = [
    'past_visit_required', 'invalid_equipment', 'invalid_supervisor', 'invalid_company',
    'invalid_project', 'invalid_driver', 'invalid_contractor_code', 'invalid_notes',
    'invalid_dates', 'exit_before_entry', 'visit_in_future', 'visit_overlap',
    'visit_no_gap',
  ]
  let at = -1
  for (const token of order) {
    const i = FN.indexOf(`RAISE EXCEPTION '${token}'`)
    assert.ok(i > at, `${token} in order`)
    at = i
  }
  for (const token of order.slice(1, -2)) {
    assert.ok(FN.includes(`RAISE EXCEPTION '${token}' USING ERRCODE = '22023'`), token)
  }
  assert.ok(FN.includes("RAISE EXCEPTION 'visit_overlap' USING ERRCODE = '55000'"))
  assert.ok(FN.includes("RAISE EXCEPTION 'visit_no_gap' USING ERRCODE = '55000'"))
  const comment = SQL.slice(SQL.indexOf('COMMENT ON FUNCTION public.add_past_site_visit'))
  assert.ok(comment.slice(0, comment.indexOf("';\n")).includes('visit_no_gap (55000)'))
  // The limits of admin_update_movement.
  assert.ok(FN.includes('char_length(v_code) > 50'))
  assert.ok(FN.includes('char_length(v_notes) > 1000'))
  // The foreman: an assigned active role holding the site create key, or admin.
  assert.ok(FN.includes("JOIN public.roles r ON r.key = pr.role_key AND r.is_active"))
  assert.ok(FN.includes("pr.role_key = 'admin' OR EXISTS ( SELECT 1 FROM public.role_permissions rp WHERE rp.role_key = pr.role_key AND rp.permission_key = 'movements.site.create' )"))
  // The Saudi day.
  assert.ok(FN.includes("v_today := (now() AT TIME ZONE 'Asia/Riyadh')::date; IF p_exit_date > v_today THEN"))
})

test('the advisory key is taken before any read of the unit, the overlap is by days over site visits only', () => {
  const lock = 'PERFORM pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0));'
  assert.ok(FN.includes(lock))
  const loop = FN.indexOf('FOR v_visit IN')
  assert.ok(FN.indexOf(lock) > FN.indexOf("RAISE EXCEPTION 'visit_in_future'"))
  assert.ok(FN.indexOf(lock) < loop)
  assert.ok(FN.indexOf(lock) < FN.indexOf('FROM public.entry_exit_logs'))
  const q = FN.slice(loop, FN.indexOf('LOOP', loop + 15))
  assert.ok(q.includes("(e.recorded_at AT TIME ZONE 'Asia/Riyadh')::date AS d1"))
  assert.ok(q.includes("COALESCE((x.recorded_at AT TIME ZONE 'Asia/Riyadh')::date, 'infinity'::date) AS d2"))
  assert.ok(q.includes("WHERE n.equipment_id = e.equipment_id AND n.movement_context = 'site' AND (n.recorded_at, n.id) > (e.recorded_at, e.id) ORDER BY n.recorded_at, n.id LIMIT 1"))
  assert.ok(q.includes("WHERE e.equipment_id = p_equipment_id AND e.movement_context = 'site' AND e.movement_type = 'entry' ORDER BY e.recorded_at, e.id"))
  assert.ok(!q.includes("'workshop'"))
  // A shared boundary day is not a conflict; the earliest conflict is named.
  assert.ok(FN.includes("IF v_visit.d1 < p_exit_date AND v_visit.d2 > p_entry_date THEN RAISE EXCEPTION 'visit_overlap'"))
  assert.ok(FN.includes("DETAIL = jsonb_build_object( 'entry_id', v_visit.id, 'entry_at', v_visit.entry_at, 'exit_at', v_visit.exit_at, 'project_name_ar', v_visit.project_name_ar, 'project_name_en', v_visit.project_name_en )::text"))
  // BEFORE feeds the floor, every other non-conflicting visit the ceiling.
  assert.ok(FN.includes('IF v_visit.d2 <= p_entry_date THEN IF v_floor IS NULL OR v_visit.entry_at > v_floor THEN v_floor := v_visit.entry_at; END IF; IF v_visit.exit_at IS NOT NULL AND v_visit.exit_at > v_floor THEN v_floor := v_visit.exit_at; END IF; ELSE IF v_ceiling IS NULL OR v_visit.entry_at < v_ceiling THEN v_ceiling := v_visit.entry_at; END IF; END IF;'))
  // Nothing is written before the overlap and the gap are decided.
  assert.ok(FN.indexOf("RAISE EXCEPTION 'visit_overlap'") < FN.indexOf('INSERT INTO public.entry_exit_logs'))
  assert.ok(FN.indexOf("RAISE EXCEPTION 'visit_no_gap'") < FN.indexOf('INSERT INTO public.entry_exit_logs'))
})

test('the instants are fitted between the unit movements, NULL bounds in their own IF', () => {
  for (const piece of [
    "v_base_entry := (p_entry_date + time '12:00') AT TIME ZONE 'Asia/Riyadh';",
    "IF p_exit_date = p_entry_date THEN v_base_exit := v_base_entry + interval '1 minute'; ELSE v_base_exit := (p_exit_date + time '12:00') AT TIME ZONE 'Asia/Riyadh'; END IF;",
    "v_entry_at := v_base_entry; IF v_floor IS NOT NULL AND v_floor + interval '1 minute' > v_entry_at THEN v_entry_at := v_floor + interval '1 minute'; END IF;",
    // The workshop exit of the entry day.
    "WHERE w.equipment_id = p_equipment_id AND w.movement_context = 'workshop' AND w.recorded_at < v_entry_at ORDER BY w.recorded_at DESC, w.id DESC LIMIT 1; IF FOUND AND v_ws.movement_type = 'entry' THEN",
    "AND n.movement_context = 'workshop' AND (n.recorded_at, n.id) > (v_ws.recorded_at, v_ws.id) ORDER BY n.recorded_at, n.id LIMIT 1;",
    "IF FOUND AND (v_ws_exit_at AT TIME ZONE 'Asia/Riyadh')::date = p_entry_date THEN v_ws_bound := v_ws_exit_at + interval '1 minute';",
    // The cap and the exit.
    "v_cap := now(); IF v_ceiling IS NOT NULL AND v_ceiling - interval '1 minute' < v_cap THEN v_cap := v_ceiling - interval '1 minute'; END IF;",
    "v_exit_at := v_base_exit; IF p_exit_date = p_entry_date AND v_entry_at + interval '1 minute' > v_exit_at THEN v_exit_at := v_entry_at + interval '1 minute'; END IF; IF v_exit_at > v_cap THEN v_exit_at := v_cap; END IF;",
    // Squeezed: the entry pulled back within its bounds, then the exit pushed.
    "IF v_entry_at >= v_exit_at THEN v_entry_at := LEAST(v_base_entry, v_exit_at - interval '1 minute');",
    "IF v_ws_bound IS NOT NULL AND v_ws_bound > v_entry_at THEN v_entry_at := v_ws_bound; END IF; IF v_entry_at >= v_exit_at THEN v_exit_at := LEAST(v_cap, v_entry_at + interval '1 minute'); END IF; END IF;",
    // The final check.
    "IF NOT ( v_entry_at < v_exit_at AND (v_entry_at AT TIME ZONE 'Asia/Riyadh')::date = p_entry_date AND (v_exit_at AT TIME ZONE 'Asia/Riyadh')::date = p_exit_date ) THEN RAISE EXCEPTION 'visit_no_gap'",
  ]) {
    assert.ok(FN.includes(piece), piece)
  }
  // The only GREATEST / LEAST take two non-NULL operands.
  assert.ok(!FN.includes('GREATEST('))
  assert.equal(FN.split('LEAST(').length - 1, 2)
})

test('the two inserts: marker, entry, exit work_completed, marker cleared', () => {
  const set = "PERFORM set_config('app.past_site_visit', p_equipment_id::text, true);"
  const clear = "PERFORM set_config('app.past_site_visit', '', true);"
  const entry = FN.indexOf("'entry', 'site', 'manual', p_driver_id, p_company_id, p_project_id, v_code, v_notes, v_entry_at ) RETURNING id INTO v_entry_id;")
  const exit = FN.indexOf("'exit', 'site', 'manual', 'work_completed', v_notes, v_exit_at ) RETURNING id INTO v_exit_id;")
  assert.ok(FN.indexOf(set) > 0 && FN.indexOf(set) < entry)
  assert.ok(entry > 0 && exit > entry)
  assert.ok(FN.indexOf(clear) > exit)
  assert.ok(FN.includes('RETURN QUERY SELECT v_entry_id, v_exit_id;'))
  assert.equal(FN.split('INSERT INTO public.entry_exit_logs(').length - 1, 2)
  assert.ok(!FN.includes('movement_notices'))
  assert.ok(!FN.includes("'maintenance'"))
})

test('enforce_movement_sequence is 0195 verbatim plus the marker', () => {
  const old = norm(fn(strip(M0195), 'enforce_movement_sequence'))
  const assign = "v_past_visit := COALESCE( NEW.movement_context = 'site' AND current_setting('app.past_site_visit', true) = NEW.equipment_id::text AND public.has_permission('movements.site.add_past_visit'), false ); "
  assert.ok(SEQ.includes(assign))
  assert.ok(SEQ.includes("IF NOT public.has_permission('movements.site.create') AND NOT v_past_visit THEN RAISE EXCEPTION 'foreman role required';"))
  assert.ok(SEQ.includes("AND NOT public.has_permission('movements.exit_cross_context') AND NOT v_past_visit AND public.movement_scope_allows("))
  // The ENTRY of a past visit may precede a later ENTRY (its EXIT follows in
  // the same call): the one relaxation of the alternation check.
  const beforeLater = " AND NOT (v_past_visit AND NEW.movement_type = 'entry')"
  assert.ok(
    SEQ.includes(
      `OR (v_after IS NOT NULL AND v_after = NEW.movement_type${beforeLater}) THEN RAISE EXCEPTION 'sequence would be invalid';`,
    ),
  )
  const back = SEQ
    .replace('v_past_visit boolean; ', '')
    .replace(assign, '')
    .replace(beforeLater, '')
    .split(' AND NOT v_past_visit').join('')
  assert.equal(back, old)
  assert.match(CODE, /REVOKE ALL ON FUNCTION public\.enforce_movement_sequence\(\)\s+FROM PUBLIC, anon, authenticated;/)
})

test('enforce_site_entry_driver is 0156 verbatim plus the marker', () => {
  const old = norm(fn(strip(M0156), 'enforce_site_entry_driver'))
  const extra = `IF ${MARKER} AND public.has_permission('movements.site.add_past_visit') THEN RETURN NEW; END IF; `
  assert.ok(DRV.includes(extra))
  assert.equal(DRV.replace(extra, ''), old)
  assert.match(CODE, /REVOKE ALL ON FUNCTION public\.enforce_site_entry_driver\(\)\s+FROM PUBLIC, anon, authenticated;/)
})

test('only the two trigger functions and the new function are (re-)created; no policy', () => {
  const created = [...CODE.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(/g)].map((m) => m[1]).sort()
  assert.deepEqual(created, ['add_past_site_visit', 'enforce_movement_sequence', 'enforce_site_entry_driver'])
  assert.ok(!/POLICY/.test(CODE))
  assert.ok(!/CREATE TRIGGER/.test(CODE))
})

test('the closing guard and the schema reload', () => {
  const guard = norm(CODE.slice(CODE.lastIndexOf('DO $$')))
  for (const piece of [
    "WHERE key = 'movements.site.add_past_visit' AND enforced_in = 'database' AND NOT scoped",
    "WHERE role_key = 'admin' AND permission_key = 'movements.site.add_past_visit'",
    `to_regprocedure('${SIG}') IS NULL`,
    `has_function_privilege( 'anon', '${SIG}', 'EXECUTE' )`,
    "position('app.past_site_visit' IN pg_get_functiondef('public.enforce_movement_sequence()'::regprocedure)) = 0",
    "position('app.past_site_visit' IN pg_get_functiondef('public.enforce_site_entry_driver()'::regprocedure)) = 0",
  ]) {
    assert.ok(guard.includes(piece), piece)
  }
  assert.match(SQL.trimEnd(), /NOTIFY pgrst, 'reload schema';$/)
})

test('no later migration re-creates the 0197 objects', () => {
  for (const f of FILES.filter((x) => x > FILE)) {
    const text = strip(read(f))
    for (const re of [
      /FUNCTION public\.add_past_site_visit\(/,
      /FUNCTION public\.enforce_movement_sequence\(/,
      /FUNCTION public\.enforce_site_entry_driver\(/,
    ]) {
      assert.ok(!re.test(text), `${f}: ${re}`)
    }
  }
})
