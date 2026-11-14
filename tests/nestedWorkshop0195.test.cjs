const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0195 (owner decisions 2026-11-14, «اعتمد على الثلاثة»): «نبغى
// نلغي الزامية اخراج المعدة في حال الدخول للورشة فقط», «لو كان الخروج فقط عند
// انتهاء العمل كذا بيحل مشكلة التكرار». A workshop stay is nested inside an
// open project visit: the chain is per context, a site ENTRY waits for the
// workshop exit (R1), an EXIT keeps its sent context.

const ROOT = path.join(__dirname, '..')
const DIR = path.join(ROOT, 'supabase', 'migrations')
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
const FILE = '20261114120000_0195_nested_workshop_visits.sql'
const fileOf = (n) => {
  const f = FILES.filter((x) => x.includes(`_${n}_`))
  assert.equal(f.length, 1, `one ${n} migration`)
  return f[0]
}
const read = (file) => fs.readFileSync(path.join(DIR, file), 'utf8')
const SQL = read(FILE)

/** Without `--` comments. */
const strip = (s) => s.replace(/--[^\n]*/g, '')
const squash = (s) => s.replace(/\s+/g, ' ').trim()
const norm = (s) => squash(strip(s))
const CODE = strip(SQL)

/** The whole CREATE … $$; of one function (any case). */
function fn(code, name) {
  const start = code.search(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, 'i'),
  )
  assert.ok(start >= 0, `${name} is there`)
  const open = code.toLowerCase().indexOf('as $$', start)
  return code.slice(start, code.indexOf('$$;', open + 5) + 3)
}
/** The whole CREATE … VIEW … ; of one view. */
function view(code, name) {
  const start = code.search(new RegExp(`CREATE (?:OR REPLACE )?VIEW public\\.${name}\\b`))
  assert.ok(start >= 0, `${name} is there`)
  return code.slice(start, code.indexOf(';\n', start) + 1)
}
/** The latest definition before 0195 (the last migration that creates it). */
function latestBefore(kind, name) {
  const re = new RegExp(`CREATE (?:OR REPLACE )?${kind} public\\.${name}\\b`, 'i')
  const prev = FILES.filter((f) => f < FILE && re.test(strip(read(f))))
  assert.ok(prev.length > 0, `${name} existed`)
  return prev[prev.length - 1]
}
/** Replace one occurrence of `from` (normalised) by `to` (normalised). */
function swap(text, from, to) {
  const a = norm(from)
  const n = text.split(a).length - 1
  assert.equal(n, 1, `expected once: ${a.slice(0, 100)}`)
  return text.replace(a, norm(to))
}
const nowFn = (name) => norm(fn(CODE, name))
const prevFn = (name, file) => norm(fn(strip(read(file)), name))

test('0195 is the single 0195 migration, after 0194, LF only', () => {
  assert.equal(FILES.filter((f) => /_0195_/.test(f)).length, 1)
  assert.ok(FILE > '20261114100000_0194_po_free_start_date.sql')
  assert.ok(!SQL.includes('\r'))
  // New Arabic text carries no alif with hamza or madda.
  assert.ok(!/[أإآ]/.test(SQL))
})

test('the header quotes the owner and names the rollout', () => {
  for (const q of [
    'اعتمد على الثلاثة',
    'نبغى نلغي الزامية اخراج المعدة في حال الدخول للورشة فقط',
    'لو كان\n--   الخروج فقط عند انتهاء العمل كذا بيحل مشكلة التكرار',
  ]) {
    assert.ok(SQL.includes(q), q)
  }
  assert.match(SQL, /Rollout: apply 0195 \(then 0196\) BEFORE deploying the screens/)
  assert.match(SQL, /idx_entry_exit_logs_equipment_context_time/)
  assert.ok(!/CREATE INDEX/.test(CODE), 'no index is added')
})

test('the previous latest definitions are the ones the migration names', () => {
  const cases = [
    ['FUNCTION', 'enforce_movement_sequence', '0155'],
    ['FUNCTION', 'movement_sequence_violations', '0108'],
    ['FUNCTION', 'equipment_state', '0125'],
    ['VIEW', 'admin_equipment_state', '0129'],
    ['FUNCTION', 'admin_update_movement', '0186'],
    ['FUNCTION', 'admin_delete_movement', '0133'],
    ['FUNCTION', 'admin_correct_visit_driver', '0166'],
    ['FUNCTION', 'update_entry_contractor_code', '0156'],
    ['FUNCTION', 'search_site_exit_equipment', '0156'],
    ['FUNCTION', 'search_entry_equipment', '0163'],
    ['FUNCTION', 'search_workshop_equipment', '0163'],
    ['FUNCTION', 'sync_equipment_rental_status', '0163'],
    ['FUNCTION', 'guard_equipment_rental_ended', '0163'],
    ['VIEW', 'driver_equipment_summary', '0092'],
    ['VIEW', 'purchasing_site_visits', '0194'],
    ['VIEW', 'purchasing_site_units', '0194'],
    ['FUNCTION', 'get_admin_fleet_equipment', '0156'],
  ]
  for (const [kind, name, n] of cases) {
    assert.equal(latestBefore(kind, name), fileOf(n), name)
    assert.ok(SQL.includes(`${name}: latest ${n}`) || SQL.includes(`${name} (latest ${n})`), `${name} cites ${n}`)
  }
})

test('1: the trigger is 0155 with the per-context chain, R1 and no swap', () => {
  const now = nowFn('enforce_movement_sequence')
  let exp = prevFn('enforce_movement_sequence', fileOf('0155'))
  exp = swap(exp, 'v_last_entry record; v_sent_context text; v_entry_context text;', 'v_last_entry record; v_other_last text;')
  // The 0155 swap block goes.
  const swapBlock = exp.match(/IF NEW\.movement_type = 'exit' THEN PERFORM pg_advisory_xact_lock[\s\S]*?NEW\.movement_context := v_entry_context; END IF; END IF; /)
  assert.ok(swapBlock, 'the 0155 swap is found')
  exp = exp.replace(swapBlock[0], '')
  exp = swap(exp, `SELECT l.movement_type INTO v_before FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
    ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;
    SELECT l.movement_type INTO v_after FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id AND (l.recorded_at, l.id) > (NEW.recorded_at, NEW.id)
    ORDER BY l.recorded_at, l.id LIMIT 1;`, `SELECT l.movement_type INTO v_before FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id AND l.movement_context = NEW.movement_context
      AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
    ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;
    SELECT l.movement_type INTO v_after FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id AND l.movement_context = NEW.movement_context
      AND (l.recorded_at, l.id) > (NEW.recorded_at, NEW.id)
    ORDER BY l.recorded_at, l.id LIMIT 1;
    SELECT l.movement_type INTO v_other_last FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id AND l.movement_context <> NEW.movement_context
      AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
    ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;
    IF NEW.movement_type = 'exit' AND v_before IS DISTINCT FROM 'entry' AND v_other_last = 'entry' THEN
      IF NEW.movement_context = 'site' THEN
        RAISE EXCEPTION 'exit_equipment_in_workshop' USING ERRCODE = '55000',
          HINT = 'The equipment has no open site visit and is inside the workshop.';
      END IF;
      RAISE EXCEPTION 'exit_equipment_on_site' USING ERRCODE = '55000',
        HINT = 'The equipment has no open workshop visit and is inside a site.';
    END IF;
    IF NEW.movement_context = 'site' AND NEW.movement_type = 'entry' AND v_other_last = 'entry' THEN
      RAISE EXCEPTION 'equipment_in_workshop' USING ERRCODE = '55000',
        HINT = 'The equipment is inside the workshop; record its workshop exit first.';
    END IF;`)
  exp = swap(exp, `IF NEW.movement_type = 'exit' AND v_before IS NULL THEN
    RAISE EXCEPTION 'no prior entry found for this equipment'; END IF;`, `IF NEW.movement_type = 'exit' AND v_before IS NULL THEN
    RAISE EXCEPTION 'no prior entry found for this equipment'; END IF;
    IF NEW.movement_context = 'workshop' AND NEW.movement_type = 'entry' AND EXISTS (
      SELECT 1 FROM public.entry_exit_logs s
      WHERE s.equipment_id = NEW.equipment_id AND s.movement_context = 'site' AND s.movement_type = 'entry'
        AND (s.recorded_at, s.id) > (NEW.recorded_at, NEW.id)
        AND NOT EXISTS (
          SELECT 1 FROM public.entry_exit_logs w
          WHERE w.equipment_id = NEW.equipment_id AND w.movement_context = 'workshop'
            AND (w.recorded_at, w.id) > (NEW.recorded_at, NEW.id)
            AND (w.recorded_at, w.id) < (s.recorded_at, s.id) )
    ) THEN RAISE EXCEPTION 'sequence would be invalid'; END IF;`)
  exp = swap(exp, `SELECT l.* INTO v_last_entry FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id AND l.movement_type = 'entry'`, `SELECT l.* INTO v_last_entry FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id AND l.movement_context = NEW.movement_context
      AND l.movement_type = 'entry'`)
  assert.equal(now, exp)
  // Every kept token is still there; the swap is gone.
  for (const t of [
    "'sequence would be invalid'",
    "'no prior entry found for this equipment'",
    "'workshop role required'",
    "'foreman role required'",
    "'exit_not_entry_owner'",
    'pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0))',
    "current_setting('app.movement_excel_import', true)",
  ]) {
    assert.ok(now.includes(t), t)
  }
  assert.ok(!now.includes('v_entry_context'))
  assert.ok(!now.includes('NEW.movement_context :='))
  // R1 and the state tokens are checked before the generic neighbour rule.
  assert.ok(now.indexOf("'equipment_in_workshop'") < now.indexOf("'sequence would be invalid'"))
  assert.ok(now.indexOf("'exit_equipment_in_workshop'") < now.indexOf("'sequence would be invalid'"))
  assert.match(CODE, /REVOKE ALL ON FUNCTION public\.enforce_movement_sequence\(\)\s+FROM PUBLIC, anon, authenticated;/)
  assert.ok(!/CREATE TRIGGER/.test(CODE), 'no trigger is re-created')
})

test('2: movement_sequence_violations counts per context plus R1, still internal', () => {
  const now = nowFn('movement_sequence_violations')
  assert.match(now, /LANGUAGE sql SET search_path = public, pg_temp AS \$\$/)
  assert.ok(!/SECURITY DEFINER/.test(now))
  assert.match(now, /lag\(l\.movement_type\) OVER \( PARTITION BY l\.movement_context ORDER BY l\.recorded_at, l\.id \) AS prev/)
  assert.match(now, /row_number\(\) OVER \( PARTITION BY l\.movement_context ORDER BY l\.recorded_at, l\.id \) AS rn/)
  assert.match(now, /WHERE \(s\.rn = 1 AND s\.movement_type <> 'entry'\) OR s\.prev = s\.movement_type OR \( s\.movement_context = 'site' AND s\.movement_type = 'entry' AND \(/)
  assert.match(now, /AND w\.movement_context = 'workshop' AND \(w\.recorded_at, w\.id\) < \(s\.recorded_at, s\.id\) ORDER BY w\.recorded_at DESC, w\.id DESC LIMIT 1 \) = 'entry'/)
  assert.match(CODE, /REVOKE ALL ON FUNCTION public\.movement_sequence_violations\(uuid\)\s+FROM PUBLIC, anon, authenticated;/)
  assert.ok(!/GRANT [^;]*movement_sequence_violations/.test(CODE))
})

test('3: one pure state rule; equipment_state reads the two open visits', () => {
  const pure = nowFn('equipment_state_from_presence')
  assert.match(pure, /\( p_workshop_open boolean, p_workshop_purpose text, p_site_open boolean \) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp/)
  assert.match(pure, /WHEN COALESCE\(p_workshop_open, false\) THEN CASE p_workshop_purpose WHEN 'maintenance' THEN 'maintenance' WHEN 'parking' THEN 'parking' WHEN 'out_of_service' THEN 'out_of_service' ELSE 'unclassified' END WHEN COALESCE\(p_site_open, false\) THEN 'working' ELSE 'available' END/)
  assert.match(CODE, /GRANT EXECUTE ON FUNCTION\s+public\.equipment_state_from_presence\(boolean, text, boolean\) TO authenticated;/)
  const st = nowFn('equipment_state')
  const head = prevFn('equipment_state', fileOf('0125')).split(' AS $$')[0]
  assert.ok(st.startsWith(head + ' AS $$'), 'signature, STABLE, SECURITY INVOKER, search_path kept')
  assert.ok(!st.includes('equipment_state_from_movement'))
  assert.match(st, /SELECT public\.equipment_state_from_presence\( w\.movement_type IS NOT DISTINCT FROM 'entry', w\.workshop_purpose, s\.movement_type IS NOT DISTINCT FROM 'entry' \)/)
  assert.match(st, /AND l\.movement_context = 'workshop' ORDER BY l\.recorded_at DESC, l\.id DESC LIMIT 1 \) w ON true/)
  assert.match(st, /AND l\.movement_context = 'site' ORDER BY l\.recorded_at DESC, l\.id DESC LIMIT 1 \) s ON true/)
  // equipment_state_from_movement stays in place (not dropped, not re-created).
  assert.ok(!/(DROP|CREATE)[^;]*FUNCTION public\.equipment_state_from_movement/.test(CODE))
})

test('4: admin_equipment_state keeps its columns and appends the open site visit', () => {
  const now = norm(view(CODE, 'admin_equipment_state'))
  const before = norm(view(strip(read(fileOf('0129'))), 'admin_equipment_state'))
  const cols = (v) => v.slice(v.indexOf(' AS SELECT ') + 11, v.indexOf(' FROM public.equipment e'))
  const beforeCols = cols(before)
  const nowCols = cols(now)
  const expected = beforeCols
    .replace(
      'public.equipment_state_from_movement( m.movement_type, m.movement_context, m.workshop_purpose ) AS equipment_state',
      "public.equipment_state_from_presence( m.movement_type = 'entry' AND m.movement_context = 'workshop', m.workshop_purpose, s.id IS NOT NULL ) AS equipment_state",
    ) +
    ', s.id AS site_entry_id, s.recorded_at AS site_entry_at, s.company_id AS site_company_id, s.project_id AS site_project_id'
  assert.equal(nowCols, expected)
  assert.match(now, /WITH \(security_invoker = true\)/)
  // The current movement: the open workshop entry, else the open site entry,
  // else the latest of the two contexts' latest rows.
  assert.match(now, /ORDER BY \(cur\.movement_type = 'entry' AND cur\.movement_context = 'workshop'\) DESC, \(cur\.movement_type = 'entry'\) DESC, cur\.recorded_at DESC, cur\.id DESC LIMIT 1 \) m ON true/)
  assert.equal((now.match(/ORDER BY l\.recorded_at DESC, l\.id DESC LIMIT 1/g) || []).length, 3)
  assert.match(now, /AND l\.movement_context = 'site' ORDER BY l\.recorded_at DESC, l\.id DESC LIMIT 1 \) s ON s\.movement_type = 'entry';$/)
  assert.match(CODE, /REVOKE ALL ON public\.admin_equipment_state FROM PUBLIC, anon;/)
  assert.match(CODE, /GRANT SELECT ON public\.admin_equipment_state TO authenticated;/)
  assert.match(CODE, /COMMENT ON VIEW public\.admin_equipment_state IS/)
})

test('5: get_equipment_presence: the contract signature, the gate and masking of get_last_movement', () => {
  const now = nowFn('get_equipment_presence')
  assert.match(
    now,
    /get_equipment_presence\(p_equipment_id uuid\) RETURNS TABLE\( state text, site_open boolean, workshop_open boolean, site_entry_id uuid, site_entry_at timestamptz, site_supervisor_id uuid, site_supervisor_name text, site_company_id uuid, site_company_name_ar text, site_company_name_en text, site_project_id uuid, site_project_name_ar text, site_project_name_en text, site_contractor_equipment_code text, site_driver_id uuid, site_driver_name text, site_driver_mobile_number text, workshop_entry_id uuid, workshop_entry_at timestamptz, workshop_purpose text, workshop_supervisor_id uuid, workshop_supervisor_name text, last_movement_id uuid, last_movement_type text, last_movement_context text, last_movement_at timestamptz \) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$\$/,
  )
  const last = prevFn('get_last_movement', fileOf('0158'))
  const gate = "IF NOT ( public.has_permission('movements.read') OR public.has_permission('movements.site.create') OR public.has_permission('movements.workshop.create') ) THEN RAISE EXCEPTION 'authenticated role required'; END IF;"
  const record = "v_can_record := public.has_permission('movements.site.create') OR public.has_permission('movements.workshop.create');"
  for (const piece of [gate, record]) {
    assert.ok(last.includes(piece), `get_last_movement: ${piece}`)
    assert.ok(now.includes(piece), piece)
  }
  assert.match(now, /public\.can_access_movement\(s\.id\) AS site_read, public\.can_access_movement\(w\.id\) AS workshop_read, public\.can_access_movement\(lm\.id\) AS last_read/)
  assert.ok(now.includes('CASE WHEN acc.site_read OR (s.id IS NOT NULL AND v_can_record) THEN pr.name_ar END'))
  assert.ok(now.includes('CASE WHEN acc.site_read THEN co.name_ar END'))
  assert.ok(now.includes('CASE WHEN acc.site_read THEN COALESCE(c.new_driver_id, s.driver_id) END'))
  assert.match(now, /WHERE x\.entry_log_id = s\.id ORDER BY x\.changed_at DESC, x\.id DESC LIMIT 1 \) c ON true/)
  assert.match(now, /AND l\.movement_context = 'workshop' ORDER BY l\.recorded_at DESC, l\.id DESC LIMIT 1 \) w ON w\.movement_type = 'entry'/)
  assert.match(now, /AND l\.movement_context = 'site' ORDER BY l\.recorded_at DESC, l\.id DESC LIMIT 1 \) s ON s\.movement_type = 'entry'/)
  assert.match(now, /public\.equipment_state_from_presence\( w\.id IS NOT NULL, w\.workshop_purpose, s\.id IS NOT NULL \)/)
  assert.match(CODE, /REVOKE ALL ON FUNCTION public\.get_equipment_presence\(uuid\) FROM PUBLIC, anon;/)
  assert.match(CODE, /GRANT EXECUTE ON FUNCTION public\.get_equipment_presence\(uuid\) TO authenticated;/)
  // get_last_movement is left exactly as it is.
  assert.ok(!/FUNCTION public\.get_last_movement\(/.test(CODE))
})

test('6: admin_update_movement is 0186 with the same-context pair', () => {
  const now = nowFn('admin_update_movement')
  let exp = prevFn('admin_update_movement', fileOf('0186')).replace(
    'CREATE FUNCTION public.admin_update_movement(',
    'CREATE OR REPLACE FUNCTION public.admin_update_movement(',
  )
  const pairBlock = exp.match(/IF v_log\.movement_type = 'entry' THEN SELECT l\.id, l\.movement_type INTO v_adjacent_id[\s\S]*?END IF; END IF; (?=IF p_driver_id IS NOT NULL)/)
  assert.ok(pairBlock, 'the 0186 pair block is found')
  exp = exp.replace(pairBlock[0], norm(`IF v_log.movement_type = 'entry' THEN
      SELECT l.id, l.movement_type INTO v_adjacent_id, v_adjacent_type FROM public.entry_exit_logs l
      WHERE l.equipment_id = v_log.equipment_id AND l.movement_context = v_log.movement_context
        AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)
      ORDER BY l.recorded_at, l.id LIMIT 1;
      IF v_adjacent_type IS NOT DISTINCT FROM 'exit' THEN
        SELECT l.* INTO v_pair FROM public.entry_exit_logs l WHERE l.id = v_adjacent_id FOR UPDATE;
      END IF;
    ELSE
      SELECT l.id, l.movement_type INTO v_adjacent_id, v_adjacent_type FROM public.entry_exit_logs l
      WHERE l.equipment_id = v_log.equipment_id AND l.movement_context = v_log.movement_context
        AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)
      ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;
      IF v_adjacent_type IS NOT DISTINCT FROM 'entry' THEN
        SELECT l.* INTO v_pair FROM public.entry_exit_logs l WHERE l.id = v_adjacent_id FOR UPDATE;
      END IF;
    END IF;`) + ' ')
  assert.equal(now, exp)
  for (const t of ["'invalid_sequence'", "'open_visit_driver_change'", "'exit_purpose_not_allowed'", 'movement_sequence_violations(p_equipment_id)']) {
    assert.ok(now.includes(t), t)
  }
  const sig = String.raw`admin_update_movement\(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text, text\)`
  assert.match(CODE, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon;`))
  assert.match(CODE, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated;`))
  assert.match(CODE, new RegExp(`COMMENT ON FUNCTION public\\.${sig} IS`))
})

test('7: admin_delete_movement is 0133 with per-context neighbours and the nesting rule', () => {
  const now = nowFn('admin_delete_movement')
  let exp = prevFn('admin_delete_movement', fileOf('0133'))
  exp = swap(exp, `SELECT l.movement_type INTO v_earlier_type FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)`, `SELECT l.movement_type INTO v_earlier_type FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id AND l.movement_context = v_log.movement_context
      AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)`)
  exp = swap(exp, `SELECT l.* INTO v_later FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)`, `SELECT l.* INTO v_later FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id AND l.movement_context = v_log.movement_context
      AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)`)
  exp = swap(exp, `SELECT COALESCE(array_agg(p.file_path ORDER BY p.sort_order, p.id), '{}')`, `IF v_log.movement_context = 'workshop' AND v_log.movement_type = 'exit'
      AND v_has_earlier AND v_earlier_type = 'entry'
      AND EXISTS (
        SELECT 1 FROM public.entry_exit_logs s
        WHERE s.equipment_id = v_log.equipment_id AND s.movement_context = 'site'
          AND s.movement_type = 'entry' AND (s.recorded_at, s.id) > (v_log.recorded_at, v_log.id)
          AND ( NOT v_has_later OR (s.recorded_at, s.id) < (v_later.recorded_at, v_later.id) )
      ) THEN
      RAISE EXCEPTION 'movement_not_last' USING HINT = 'A later project entry depends on this workshop exit.';
    END IF;
    SELECT COALESCE(array_agg(p.file_path ORDER BY p.sort_order, p.id), '{}')`)
  assert.equal(now, exp)
  for (const t of ["'entry_has_later_exit'", "'movement_not_last'", "'admin_required'", 'pg_advisory_xact_lock(hashtextextended(v_log.equipment_id::text, 0))']) {
    assert.ok(now.includes(t), t)
  }
  assert.match(CODE, /REVOKE ALL ON FUNCTION public\.admin_delete_movement\(uuid\) FROM PUBLIC, anon;/)
  assert.match(CODE, /GRANT EXECUTE ON FUNCTION public\.admin_delete_movement\(uuid\) TO authenticated;/)
})

test('8-10: the driver correction, the contractor code and the site exit picker read the SITE chain', () => {
  const cor = nowFn('admin_correct_visit_driver')
  assert.equal(cor, swap(prevFn('admin_correct_visit_driver', fileOf('0166')), `where l.equipment_id = v_entry.equipment_id
      and (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id)`, `where l.equipment_id = v_entry.equipment_id
      and l.movement_context = 'site'
      and (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id)`))
  assert.match(CODE, /revoke all on function public\.admin_correct_visit_driver\(uuid, uuid, uuid\) from public, anon;/)
  assert.match(CODE, /grant execute on function public\.admin_correct_visit_driver\(uuid, uuid, uuid\) to authenticated;/)

  const ucc = nowFn('update_entry_contractor_code')
  assert.equal(ucc, swap(prevFn('update_entry_contractor_code', fileOf('0156')), `WHERE l.equipment_id = v_entry.equipment_id
      AND (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id) ) THEN RAISE EXCEPTION 'visit_is_closed'`, `WHERE l.equipment_id = v_entry.equipment_id
      AND l.movement_context = 'site'
      AND (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id) ) THEN RAISE EXCEPTION 'visit_is_closed'`))
  assert.match(CODE, /GRANT EXECUTE ON FUNCTION public\.update_entry_contractor_code\(uuid, text\) TO authenticated;/)

  const sse = nowFn('search_site_exit_equipment')
  assert.equal(sse, swap(prevFn('search_site_exit_equipment', fileOf('0156')), `SELECT l.movement_type, l.movement_context, l.supervisor_id FROM public.entry_exit_logs l
      WHERE l.equipment_id = e.id ORDER BY`, `SELECT l.movement_type, l.movement_context, l.supervisor_id FROM public.entry_exit_logs l
      WHERE l.equipment_id = e.id AND l.movement_context = 'site' ORDER BY`))
  assert.ok(sse.includes('AND (v_is_admin OR last_movement.supervisor_id = auth.uid())'))
  assert.match(CODE, /GRANT EXECUTE ON FUNCTION public\.search_site_exit_equipment\(text, text, text\) TO authenticated;/)
})

test('11: the entry pickers take the state badge from the current movement', () => {
  const current = `LEFT JOIN LATERAL (
    SELECT cur.movement_type, cur.movement_context, cur.recorded_at,
           cur.workshop_purpose, cur.company_id, cur.project_id
    FROM (
      ( SELECT l.id, l.movement_type, l.movement_context, l.recorded_at, l.workshop_purpose, l.company_id, l.project_id
        FROM public.entry_exit_logs l WHERE l.equipment_id = e.id AND l.movement_context = 'workshop'
        ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1 )
      UNION ALL
      ( SELECT l.id, l.movement_type, l.movement_context, l.recorded_at, l.workshop_purpose, l.company_id, l.project_id
        FROM public.entry_exit_logs l WHERE l.equipment_id = e.id AND l.movement_context = 'site'
        ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1 )
    ) cur
    ORDER BY (cur.movement_type = 'entry' AND cur.movement_context = 'workshop') DESC,
             (cur.movement_type = 'entry') DESC, cur.recorded_at DESC, cur.id DESC
    LIMIT 1
  ) last_movement ON true`
  const old = `LEFT JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.recorded_at, l.workshop_purpose, l.company_id, l.project_id
    FROM public.entry_exit_logs l WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1
  ) last_movement ON true`
  for (const name of ['search_entry_equipment', 'search_workshop_equipment']) {
    assert.equal(nowFn(name), swap(prevFn(name, fileOf('0163')), old, current), name)
    assert.match(CODE, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(text, text, text\\) FROM PUBLIC, anon;`))
    assert.match(CODE, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(text, text, text\\) TO authenticated;`))
  }
  // The workshop EXIT list still reads the latest WORKSHOP movement.
  assert.ok(nowFn('search_workshop_equipment').includes("p_movement_type = 'exit' AND last_workshop_movement.movement_type = 'entry'"))
})

test('12: the rental status follows both open visits', () => {
  const syn = nowFn('sync_equipment_rental_status')
  let exp = prevFn('sync_equipment_rental_status', fileOf('0163'))
  exp = swap(exp, 'v_type text; v_context text; BEGIN', 'v_type text; v_context text; v_site_type text; v_workshop_type text; BEGIN')
  exp = swap(exp, `IF v_status = 'active' AND v_type = 'exit' AND v_context = 'site' THEN
    UPDATE public.equipment SET status = 'rental_ended' WHERE id = p_equipment_id;
    ELSIF v_status = 'rental_ended' AND v_type = 'entry' THEN`, `SELECT l.movement_type INTO v_site_type FROM public.entry_exit_logs l
    WHERE l.equipment_id = p_equipment_id AND l.movement_context = 'site'
    ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;
    SELECT l.movement_type INTO v_workshop_type FROM public.entry_exit_logs l
    WHERE l.equipment_id = p_equipment_id AND l.movement_context = 'workshop'
    ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;
    IF v_status = 'active' AND v_type = 'exit' AND v_context = 'site'
       AND v_workshop_type IS DISTINCT FROM 'entry' THEN
    UPDATE public.equipment SET status = 'rental_ended' WHERE id = p_equipment_id;
    ELSIF v_status = 'rental_ended' AND (v_site_type = 'entry' OR v_workshop_type = 'entry') THEN`)
  assert.equal(syn, exp)
  assert.match(CODE, /REVOKE ALL ON FUNCTION public\.sync_equipment_rental_status\(uuid\) FROM PUBLIC, anon, authenticated;/)

  const grd = nowFn('guard_equipment_rental_ended')
  let g = prevFn('guard_equipment_rental_ended', fileOf('0163'))
  g = swap(g, 'DECLARE v_type text; BEGIN', 'DECLARE v_type text; v_workshop_type text; BEGIN')
  g = swap(g, `SELECT l.movement_type INTO v_type FROM public.entry_exit_logs l WHERE l.equipment_id = NEW.id
    ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1; IF v_type = 'entry' THEN`, `SELECT l.movement_type INTO v_type FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.id AND l.movement_context = 'site'
    ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;
    SELECT l.movement_type INTO v_workshop_type FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.id AND l.movement_context = 'workshop'
    ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;
    IF v_type = 'entry' OR v_workshop_type = 'entry' THEN`)
  assert.equal(grd, g)
  assert.ok(grd.includes("RAISE EXCEPTION 'equipment_inside_cannot_end' USING ERRCODE = '23514'"))
  assert.match(CODE, /REVOKE ALL ON FUNCTION public\.guard_equipment_rental_ended\(\) FROM PUBLIC, anon;/)
})

test('13: driver_equipment_summary reads the latest SITE movement', () => {
  const now = norm(view(CODE, 'driver_equipment_summary'))
  const before = norm(view(strip(read(fileOf('0092'))), 'driver_equipment_summary'))
  assert.equal(now, swap(before, `WHERE l.equipment_id = attributed.equipment_id ORDER BY l.recorded_at DESC, l.id DESC`, `WHERE l.equipment_id = attributed.equipment_id AND l.movement_context = 'site' ORDER BY l.recorded_at DESC, l.id DESC`))
  assert.match(now, /WITH \(security_invoker = true\)/)
  assert.match(CODE, /GRANT SELECT ON public\.driver_equipment_summary TO authenticated;/)
})

test('14: the two purchasing views are 0194 plus a trailing in_workshop', () => {
  const join = `LEFT JOIN LATERAL (
    SELECT wl.movement_type FROM public.entry_exit_logs wl
    WHERE wl.equipment_id = v.equipment_id AND wl.movement_context = 'workshop'
    ORDER BY wl.recorded_at DESC, wl.id DESC LIMIT 1
  ) ws_now ON v.is_open`
  const col = "(v.is_open AND ws_now.movement_type IS NOT DISTINCT FROM 'entry') AS in_workshop"
  const cases = [
    ['purchasing_site_visits', 'v.entry_created_at FROM public.movement_visits v', `v.entry_created_at, ${col} FROM public.movement_visits v`, ") project_cpo ON true WHERE v.movement_context = 'site';", `) project_cpo ON true ${join} WHERE v.movement_context = 'site';`],
    ['purchasing_site_units', 'project_cpo.po_number AS project_client_po_number FROM public.movement_visits v', `project_cpo.po_number AS project_client_po_number, ${col} FROM public.movement_visits v`, ') project_cpo ON true WHERE v.is_open', `) project_cpo ON true ${join} WHERE v.is_open`],
  ]
  for (const [name, a, a2, b, b2] of cases) {
    const now = norm(view(CODE, name))
    const before = norm(view(strip(read(fileOf('0194'))), name))
    assert.equal(now, swap(swap(before, a, a2), b, b2), name)
    assert.match(now, /WITH \(security_invoker = true\)/)
    assert.ok(now.endsWith(name === 'purchasing_site_units' ? "WHERE v.is_open AND v.movement_context = 'site';" : "WHERE v.movement_context = 'site';"))
    assert.match(CODE, new RegExp(`REVOKE ALL ON public\\.${name} FROM PUBLIC, anon;`))
    assert.match(CODE, new RegExp(`GRANT SELECT ON public\\.${name} TO authenticated;`))
    assert.match(CODE, new RegExp(`COMMENT ON VIEW public\\.${name} IS`))
  }
})

test('15: get_admin_fleet_equipment is 0156 plus four trailing columns, dropped first and re-granted', () => {
  const now = nowFn('get_admin_fleet_equipment')
  let exp = prevFn('get_admin_fleet_equipment', fileOf('0156'))
  exp = swap(exp, 'last_exit_purpose text, is_new boolean )', 'last_exit_purpose text, is_new boolean, site_company_name_ar text, site_company_name_en text, site_project_name_ar text, site_project_name_en text )')
  exp = swap(exp, `s.is_new FROM public.admin_equipment_state s
    LEFT JOIN public.companies c ON c.id = s.last_company_id
    LEFT JOIN public.projects p ON p.id = s.last_project_id`, `s.is_new,
    sc.name_ar AS site_company_name_ar, sc.name_en AS site_company_name_en,
    sp.name_ar AS site_project_name_ar, sp.name_en AS site_project_name_en
    FROM public.admin_equipment_state s
    LEFT JOIN public.companies c ON c.id = s.last_company_id
    LEFT JOIN public.projects p ON p.id = s.last_project_id
    LEFT JOIN public.companies sc ON sc.id = s.site_company_id
    LEFT JOIN public.projects sp ON sp.id = s.site_project_id`)
  assert.equal(now, exp)
  const sig = String.raw`get_admin_fleet_equipment\(text, text\[\], text, integer, integer, text\)`
  assert.match(CODE, new RegExp(`DROP FUNCTION IF EXISTS public\\.${sig};`))
  assert.ok(CODE.indexOf('DROP FUNCTION IF EXISTS public.get_admin_fleet_equipment') < CODE.indexOf('CREATE OR REPLACE FUNCTION public.get_admin_fleet_equipment'))
  assert.match(CODE, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon;`))
  assert.match(CODE, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated;`))
  assert.equal((CODE.match(/DROP (FUNCTION|VIEW)/g) || []).length, 1, 'nothing else is dropped')
})

test('every new or re-created SECURITY DEFINER function has a fixed search_path', () => {
  const re = /CREATE OR REPLACE FUNCTION public\.(\w+)\(/gi
  for (const m of CODE.matchAll(re)) {
    const def = norm(fn(CODE, m[1]))
    if (/SECURITY DEFINER/i.test(def)) {
      assert.match(def, /SET search_path = public(, pg_temp)?/i, m[1])
    }
  }
  // The pickers keep their 0156 / 0163 search_path exactly.
  assert.match(nowFn('search_entry_equipment'), /SECURITY DEFINER SET search_path = public AS \$\$/)
})

test('left exactly as they are', () => {
  for (const name of [
    'get_last_movement',
    'request_workshop_arrival_notice',
    'prepare_movement_exit_notice',
    'change_active_movement_driver',
    'classify_workshop_entry',
    'enforce_site_exit_purpose',
    'import_movement_rows',
    'guard_movement_with_po',
    'equipment_state_from_movement',
    'equipment_rental_lifecycle',
  ]) {
    assert.ok(!new RegExp(`FUNCTION public\\.${name}\\(`, 'i').test(CODE), name)
  }
  assert.ok(!/VIEW public\.movement_visits\b/.test(CODE))
  assert.ok(!/VIEW public\.sales_/.test(CODE))
  assert.ok(!/\b(INSERT INTO|UPDATE public\.|DELETE FROM)\b/.test(CODE.replace(/AS \$\$[\s\S]*?\$\$;/g, '')), 'no stored row changes outside function bodies')
})

test('the closing guard and the schema reload', () => {
  const guard = CODE.slice(CODE.lastIndexOf('DO $$'))
  for (const piece of [
    "position('v_entry_context' IN v_def) > 0",
    "to_regprocedure('public.equipment_state_from_presence(boolean, text, boolean)') IS NULL",
    "to_regprocedure('public.get_equipment_presence(uuid)') IS NULL",
    "'PARTITION BY l.movement_context'",
    "column_name IN ('site_entry_id', 'site_entry_at', 'site_company_id', 'site_project_id')",
    "column_name = 'in_workshop'",
    "'site_project_name_ar' IN pg_get_function_result",
  ]) {
    assert.ok(guard.includes(piece), piece)
  }
  assert.match(SQL.trimEnd(), /NOTIFY pgrst, 'reload schema';$/)
})

test('no later migration re-creates the 0195 objects', () => {
  const later = FILES.filter((f) => f > FILE)
  for (const f of later) {
    const text = strip(read(f))
    for (const re of [
      /FUNCTION public\.enforce_movement_sequence\(/i,
      /FUNCTION public\.movement_sequence_violations\(/i,
      /FUNCTION public\.equipment_state_from_presence\(/i,
      /FUNCTION public\.equipment_state\(/i,
      /FUNCTION public\.get_equipment_presence\(/i,
      /FUNCTION public\.admin_update_movement\(/i,
      /FUNCTION public\.admin_delete_movement\(/i,
      /FUNCTION public\.admin_correct_visit_driver\(/i,
      /FUNCTION public\.update_entry_contractor_code\(/i,
      /FUNCTION public\.search_site_exit_equipment\(/i,
      /FUNCTION public\.search_entry_equipment\(/i,
      /FUNCTION public\.search_workshop_equipment\(/i,
      /FUNCTION public\.sync_equipment_rental_status\(/i,
      /FUNCTION public\.guard_equipment_rental_ended\(/i,
      /FUNCTION public\.get_admin_fleet_equipment\(/i,
      /VIEW public\.admin_equipment_state\b/,
      /VIEW public\.driver_equipment_summary\b/,
      /VIEW public\.purchasing_site_visits\b/,
      /VIEW public\.purchasing_site_units\b/,
    ]) {
      assert.ok(!re.test(text), `${f}: ${re}`)
    }
  }
})
