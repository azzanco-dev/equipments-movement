const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Guards the security properties of the wave-8 migrations 0108 and 0109. The
// database is the only authoritative place for these rules, so a change that
// drops one of them must fail here rather than in production.
const root = path.join(__dirname, '..')

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8')
}

const sql0108 = read(
  'supabase',
  'migrations',
  '20260930140000_0108_movement_sequence_security.sql',
)
const sql0109 = read(
  'supabase',
  'migrations',
  '20260930150000_0109_photo_and_quick_create_security.sql',
)

function functionBody(source, name) {
  const match = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`,
  ).exec(source)
  assert.ok(match, `missing function: ${name}`)
  const end = source.indexOf('\n$$;', match.index)
  assert.ok(end > match.index, `unterminated function: ${name}`)
  return source.slice(match.index, end)
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// SQL with `--` comments and single-quoted literals removed, so structural
// checks are not fooled by text inside them.
function code(source) {
  return source
    .split('\n')
    .map((line) => line.replace(/'(?:[^']|'')*'/g, "''").replace(/--.*$/, ''))
    .join('\n')
}

const TRIGGER_LOCK =
  /PERFORM pg_advisory_xact_lock\(hashtextextended\((?:NEW|v_log|v_entry)\.equipment_id::text, 0\)\);/

const trigger = functionBody(sql0108, 'enforce_movement_sequence')
const violations = functionBody(sql0108, 'movement_sequence_violations')
const update = functionBody(sql0108, 'admin_update_movement')
const remove = functionBody(sql0108, 'admin_delete_movement')
const driverChange = functionBody(sql0108, 'change_active_movement_driver')

test('both migrations are structurally balanced', () => {
  for (const [name, source] of [
    ['0108', sql0108],
    ['0109', sql0109],
  ]) {
    const stripped = code(source)
    assert.equal(
      (stripped.match(/\$\$/g) ?? []).length % 2,
      0,
      `${name}: unbalanced dollar quotes`,
    )
    let depth = 0
    for (const char of stripped) {
      if (char === '(') depth += 1
      if (char === ')') depth -= 1
      assert.ok(depth >= 0, `${name}: unbalanced parentheses`)
    }
    assert.equal(depth, 0, `${name}: unbalanced parentheses`)
    // Every IF opened in a plpgsql body is closed. `END IF` contains one IF
    // token itself, and `DROP ... IF EXISTS` is DDL, not a block.
    const count = (pattern) => (stripped.match(pattern) ?? []).length
    const closed = count(/\bEND IF;/g)
    const opened = count(/\bIF\b/g) - closed - count(/\bDROP \w+ IF EXISTS\b/g)
    assert.ok(closed > 0)
    assert.equal(opened, closed, `${name}: IF / END IF mismatch`)
    assert.equal(
      count(/\bLOOP\b/g),
      2 * count(/\bEND LOOP;/g),
      `${name}: LOOP / END LOOP mismatch`,
    )
    // One THEN per IF / ELSIF / CASE WHEN (`EXIT WHEN` has none).
    assert.equal(
      count(/\bTHEN\b/g),
      opened +
        count(/\bELSIF\b/g) +
        count(/\bWHEN\b/g) -
        count(/\bEXIT WHEN\b/g),
      `${name}: IF / THEN mismatch`,
    )
  }
})

test('no existing migration was edited: the wave-8 files are new and ordered last', () => {
  const files = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const at0107 = files.findIndex((file) => file.includes('_0107_'))
  const at0108 = files.findIndex((file) => file.includes('_0108_'))
  const at0109 = files.findIndex((file) => file.includes('_0109_'))
  assert.ok(at0107 >= 0 && at0108 > at0107 && at0109 > at0108)
})

test('every SECURITY DEFINER function of the batch fixes its search_path', () => {
  for (const source of [code(sql0108), code(sql0109)]) {
    const definers = source.match(
      /SECURITY DEFINER\s+SET search_path = [^\n]+/g,
    )
    assert.ok(definers && definers.length > 0)
    for (const clause of definers)
      assert.match(clause, /SET search_path = public, pg_temp$/)
    assert.equal(
      (source.match(/SECURITY DEFINER/g) ?? []).length,
      definers.length,
      'a SECURITY DEFINER function has no fixed search_path',
    )
  }
})

test('client-callable functions are revoked from PUBLIC/anon and granted to authenticated', () => {
  for (const [source, signature] of [
    [
      sql0108,
      'public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text)',
    ],
    [sql0108, 'public.admin_delete_movement(uuid)'],
    [sql0108, 'public.change_active_movement_driver(uuid, uuid, text)'],
    [sql0109, 'public.classify_workshop_entry(uuid, text)'],
    [sql0109, 'public.quick_create_workshop_equipment(text, text, text)'],
    [sql0109, 'public.quick_create_lessor_by_name(text)'],
    [sql0109, 'public.quick_create_foreman_equipment(text, text, text, uuid)'],
    [sql0109, 'public.get_last_movement(uuid, text)'],
    [sql0109, 'public.quick_create_driver(text, text)'],
    [sql0109, 'public.can_write_movement_photos(uuid)'],
  ]) {
    assert.match(
      source,
      new RegExp(
        `REVOKE ALL ON FUNCTION ${escape(signature)}\\s+FROM PUBLIC, anon;`,
      ),
      `missing REVOKE for ${signature}`,
    )
    assert.match(
      source,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION ${escape(signature)}\\s+TO authenticated;`,
      ),
      `missing GRANT for ${signature}`,
    )
  }
})

test('trigger functions and the internal helper are not executable by clients', () => {
  for (const [source, signature] of [
    [sql0108, 'public.enforce_movement_sequence()'],
    [sql0108, 'public.movement_sequence_violations(uuid)'],
    [sql0109, 'public.protect_movement_photo_identity()'],
    [sql0109, 'public.enforce_movement_photo_path()'],
  ]) {
    assert.match(
      source,
      new RegExp(
        `REVOKE ALL ON FUNCTION ${escape(signature)}\\s+FROM PUBLIC, anon, authenticated;`,
      ),
      `missing REVOKE for ${signature}`,
    )
    assert.ok(
      !new RegExp(`GRANT[^;]*${escape(signature)}`).test(source),
      `${signature} must not be granted`,
    )
  }
})

// --- H1 / M4 / M8: the sequence trigger -----------------------------------

test('H1: a cross-context exit is reserved to admins in BOTH directions', () => {
  const guard = trigger.slice(
    trigger.indexOf('IF NOT public.is_admin() THEN'),
    trigger.indexOf('NEW.company_id := v_last_entry.company_id;'),
  )
  assert.ok(guard.length > 0, 'the admin exemption must wrap both branches')
  assert.match(
    guard,
    /IF NEW\.movement_context = 'site' THEN\s+IF v_last_entry\.movement_context IS DISTINCT FROM 'site' THEN\s+RAISE EXCEPTION 'exit_equipment_in_workshop'\s+USING ERRCODE = '42501'/,
  )
  assert.match(
    guard,
    /IF v_last_entry\.supervisor_id IS DISTINCT FROM auth\.uid\(\) THEN\s+RAISE EXCEPTION 'exit_not_entry_owner'\s+USING ERRCODE = '42501'/,
  )
  assert.match(
    guard,
    /ELSE\s+IF v_last_entry\.movement_context IS DISTINCT FROM 'workshop' THEN\s+RAISE EXCEPTION 'exit_equipment_on_site'\s+USING ERRCODE = '42501'/,
  )
})

test('M4: the trigger role checks fail closed on a missing profile', () => {
  assert.match(
    trigger,
    /IF v_role IS NULL\s+OR v_role NOT IN \('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager'\) THEN\s+RAISE EXCEPTION 'workshop role required'/,
  )
  assert.match(
    trigger,
    /IF v_role IS NULL OR v_role NOT IN \('admin', 'supervisor'\) THEN\s+RAISE EXCEPTION 'foreman role required'/,
  )
  // No NULL-unsafe role check is left anywhere in the batch.
  for (const source of [sql0108, sql0109]) {
    const unsafe = code(source)
      .split('\n')
      .filter(
        (line, index, lines) =>
          /\bv_role NOT IN\b/.test(line) &&
          !/v_role IS NULL/.test(line) &&
          !/v_role IS NULL/.test(lines[index - 1] ?? '') &&
          !/auth\.uid\(\) IS NULL/.test(lines[index - 2] ?? ''),
      )
    assert.deepEqual(unsafe, [])
  }
})

test('M8: a driverless entry keeps a name only on the admin Excel import', () => {
  assert.match(
    trigger,
    /IF NEW\.driver_id IS NULL THEN[\s\S]*?IF current_setting\('app\.movement_excel_import', true\) = 'true'\s+AND v_role = 'admin' THEN\s+NEW\.driver_name := NULLIF\(btrim\(NEW\.driver_name\), ''\);\s+ELSE\s+NEW\.driver_name := NULL;\s+END IF;/,
  )
  // A supplied driver is still resolved against the master, never trusted.
  assert.match(
    trigger,
    /SELECT d\.full_name INTO NEW\.driver_name\s+FROM public\.drivers d\s+WHERE d\.id = NEW\.driver_id;\s+IF NOT FOUND THEN RAISE EXCEPTION 'invalid driver_id'; END IF;/,
  )
  // The API no longer forwards a client-supplied name at all.
  assert.ok(
    !read('app', 'api', 'movements', 'route.ts').includes(
      "value('driver_name')",
    ),
  )
})

test('the trigger keeps every 0103 rule', () => {
  for (const token of [
    "RAISE EXCEPTION 'invalid movement'",
    "RAISE EXCEPTION 'movement time cannot be in the future'",
    "RAISE EXCEPTION 'company_id is required for an entry'",
    "RAISE EXCEPTION 'project_id is required for an entry'",
    "RAISE EXCEPTION 'sequence would be invalid'",
    "RAISE EXCEPTION 'no prior entry found for this equipment'",
    'NEW.created_at := now();',
    'NEW.contractor_equipment_code := v_last_entry.contractor_equipment_code;',
    "SET operational_status = COALESCE(v_last_entry.previous_operational_status, 'operational')",
  ])
    assert.ok(trigger.includes(token), `missing ${token}`)
  assert.match(trigger, TRIGGER_LOCK)
  // Deterministic, global (no context predicate) probes in both directions.
  assert.match(
    trigger,
    /AND \(l\.recorded_at, l\.id\) < \(NEW\.recorded_at, NEW\.id\)\s+ORDER BY l\.recorded_at DESC, l\.id DESC/,
  )
  assert.match(
    trigger,
    /AND \(l\.recorded_at, l\.id\) > \(NEW\.recorded_at, NEW\.id\)\s+ORDER BY l\.recorded_at, l\.id/,
  )
  assert.ok(!/l\.movement_context = NEW\.movement_context/.test(trigger))
  // The site exit still inherits the latest current driver.
  assert.match(
    trigger,
    /FROM public\.movement_driver_changes c\s+WHERE c\.entry_log_id = v_last_entry\.id\s+ORDER BY c\.changed_at DESC, c\.id DESC/,
  )
})

// --- H2: admin correction and delete ---------------------------------------

test('H2: the admin functions and the driver change take the trigger lock key', () => {
  for (const body of [update, remove, driverChange]) {
    assert.match(body, TRIGGER_LOCK)
    // No per-context key is left.
    assert.ok(!/equipment_id::text \|\|/.test(code(body)))
    assert.ok(!code(body).includes('movement_context, 0'))
  }
})

test('H2: two equipment locks are taken in ascending uuid order', () => {
  const locks = update.slice(
    update.indexOf('IF p_equipment_id = v_log.equipment_id THEN'),
    update.indexOf('v_old_before :='),
  )
  assert.match(
    locks,
    /ELSIF p_equipment_id < v_log\.equipment_id THEN\s+PERFORM pg_advisory_xact_lock\(hashtextextended\(p_equipment_id::text, 0\)\);\s+PERFORM pg_advisory_xact_lock\(hashtextextended\(v_log\.equipment_id::text, 0\)\);\s+ELSE\s+PERFORM pg_advisory_xact_lock\(hashtextextended\(v_log\.equipment_id::text, 0\)\);\s+PERFORM pg_advisory_xact_lock\(hashtextextended\(p_equipment_id::text, 0\)\);/,
  )
})

test('H2: the sequence is counted globally per equipment by (recorded_at, id)', () => {
  assert.match(violations, /WHERE l\.equipment_id = p_equipment_id/)
  assert.equal(
    (violations.match(/OVER \(ORDER BY l\.recorded_at, l\.id\)/g) ?? []).length,
    2,
  )
  assert.ok(!violations.includes('movement_context'))
  assert.ok(!violations.includes('SECURITY DEFINER'))
  assert.match(
    violations,
    /WHERE \(s\.rn = 1 AND s\.movement_type <> 'entry'\)\s+OR s\.prev = s\.movement_type;/,
  )
})

test('H2: a correction is refused only when it introduces a violation', () => {
  const beforeAt = update.indexOf(
    'v_old_before := public.movement_sequence_violations(v_log.equipment_id);',
  )
  const writeAt = update.indexOf('UPDATE public.entry_exit_logs l SET')
  const afterAt = update.indexOf(
    'v_old_after := public.movement_sequence_violations(v_log.equipment_id);',
  )
  assert.ok(beforeAt > 0 && writeAt > beforeAt && afterAt > writeAt)
  // The baseline is taken under the advisory lock.
  assert.ok(beforeAt > update.search(TRIGGER_LOCK))
  assert.match(
    update,
    /IF v_old_after > v_old_before OR v_new_after > v_new_before THEN\s+RAISE EXCEPTION 'invalid_sequence';/,
  )
  // The per-context window of 0105 is gone.
  assert.ok(!update.includes('PARTITION BY equipment_id, movement_context'))
})

test('H2: the correction keeps every 0105 validation and its signature', () => {
  for (const token of [
    "RAISE EXCEPTION 'admin_required'",
    "RAISE EXCEPTION 'movement_not_found'",
    "RAISE EXCEPTION 'invalid_payload'",
    "RAISE EXCEPTION 'future_time'",
    "RAISE EXCEPTION 'contractor_code_too_long'",
    "RAISE EXCEPTION 'movement_notes_too_long'",
    "RAISE EXCEPTION 'driver_not_supported'",
    "RAISE EXCEPTION 'invalid_driver'",
    "RAISE EXCEPTION 'open_visit_driver_change'",
    'notes = v_notes',
    'WHERE l.id = v_pair.id;',
  ])
    assert.ok(update.includes(token), `missing ${token}`)
  assert.match(
    update,
    /IF auth\.uid\(\) IS NULL OR NOT public\.is_admin\(\) THEN\s+RAISE EXCEPTION 'admin_required'/,
  )
  const params = update.slice(
    update.indexOf('(') + 1,
    update.indexOf(') RETURNS'),
  )
  assert.deepEqual(
    params.split(',').map((param) => param.trim().split(/\s+/)[0]),
    [
      'p_movement_id',
      'p_equipment_id',
      'p_supervisor_id',
      'p_recorded_at',
      'p_company_id',
      'p_project_id',
      'p_contractor_equipment_code',
      'p_driver_id',
      'p_notes',
    ],
  )
  // Same signature as 0105, so it is replaced in place: no second overload.
  assert.ok(!sql0108.includes('DROP FUNCTION'))
})

test('H2: editing a workshop row never blanks the site facts of its pair', () => {
  const pairUpdate = update.slice(
    update.indexOf('IF v_pair.id IS NOT NULL THEN'),
    update.indexOf('WHERE l.id = v_pair.id;'),
  )
  for (const column of [
    ['company_id', 'p_company_id'],
    ['project_id', 'p_project_id'],
    ['contractor_equipment_code', 'v_code'],
  ])
    assert.match(
      pairUpdate,
      new RegExp(
        `${column[0]} = CASE\\s+WHEN l\\.movement_context <> 'site' THEN NULL\\s+WHEN v_log\\.movement_context = 'site' THEN ${column[1]}\\s+ELSE l\\.${column[0]}\\s+END`,
      ),
    )
  assert.ok(!pairUpdate.includes('notes ='))
})

test('H2: the delete checks its global neighbours and keeps its codes', () => {
  // Both neighbour probes are per equipment only, ordered by (recorded_at, id).
  const probes = remove.slice(
    remove.indexOf('SELECT l.movement_type INTO v_earlier_type'),
    remove.indexOf('IF v_has_later THEN'),
  )
  assert.ok(!probes.includes('movement_context'))
  assert.match(
    probes,
    /AND \(l\.recorded_at, l\.id\) < \(v_log\.recorded_at, v_log\.id\)\s+ORDER BY l\.recorded_at DESC, l\.id DESC/,
  )
  assert.match(
    probes,
    /AND \(l\.recorded_at, l\.id\) > \(v_log\.recorded_at, v_log\.id\)\s+ORDER BY l\.recorded_at, l\.id/,
  )
  assert.match(
    remove,
    /IF v_gap_invalid AND NOT v_row_invalid THEN\s+IF v_log\.movement_type = 'entry' AND v_later\.movement_type = 'exit' THEN\s+RAISE EXCEPTION 'entry_has_later_exit'[\s\S]*?RAISE EXCEPTION 'movement_not_last'/,
  )
  // The check runs under the lock and before anything is removed.
  assert.ok(remove.search(TRIGGER_LOCK) < remove.indexOf('v_gap_invalid :='))
  assert.ok(
    remove.indexOf("RAISE EXCEPTION 'movement_not_last'") <
      remove.indexOf('DELETE FROM public.movement_driver_changes'),
  )
})

test('H2: the delete keeps its cleanup, audit and return shape', () => {
  assert.match(
    remove,
    /CREATE OR REPLACE FUNCTION public\.admin_delete_movement\(p_log_id uuid\)\s+RETURNS text\[\]/,
  )
  const auditAt = remove.indexOf('INSERT INTO public.movement_audit_logs')
  const driverDeleteAt = remove.indexOf(
    'DELETE FROM public.movement_driver_changes',
  )
  const photoDeleteAt = remove.indexOf('DELETE FROM public.entry_exit_photos')
  const logDeleteAt = remove.indexOf('DELETE FROM public.entry_exit_logs')
  assert.ok(auditAt > 0 && driverDeleteAt > auditAt)
  assert.ok(photoDeleteAt > driverDeleteAt && logDeleteAt > photoDeleteAt)
  assert.match(remove, /public\.movement_audit_snapshot\(v_log\)/)
  assert.match(
    remove,
    /set_config\('app\.movement_delete', p_log_id::text, true\)/,
  )
  assert.match(
    remove,
    /array_append\(v_paths, btrim\(v_log\.photo_url\)::text\)/,
  )
  assert.match(remove, /RETURN v_paths;/)
})

// The rule the two checks implement, replayed on plain arrays so the intent
// is pinned down independently of the SQL text.
function sequenceViolations(types) {
  return types.filter(
    (type, index) =>
      (index === 0 && type !== 'entry') || types[index - 1] === type,
  ).length
}

function deleteIntroducesViolation(types, index) {
  const rest = types.filter((_, position) => position !== index)
  return sequenceViolations(rest) > sequenceViolations(types)
}

// Mirrors the branch structure of admin_delete_movement.
function deleteRefusedBySql(types, index) {
  const row = types[index]
  const later = types[index + 1]
  const earlier = types[index - 1]
  if (later === undefined) return false
  const gapInvalid =
    earlier !== undefined ? earlier === later : later !== 'entry'
  const rowInvalid =
    earlier !== undefined
      ? earlier === row || later === row
      : row !== 'entry' || later === row
  return gapInvalid && !rowInvalid
}

test('H2: the delete branches equal "the violation count grows" for every chain', () => {
  const kinds = ['entry', 'exit']
  for (let length = 1; length <= 6; length += 1) {
    for (let mask = 0; mask < 2 ** length; mask += 1) {
      const types = Array.from(
        { length },
        (_, position) => kinds[(mask >> position) & 1],
      )
      for (let index = 0; index < length; index += 1)
        assert.equal(
          deleteRefusedBySql(types, index),
          deleteIntroducesViolation(types, index),
          `${types.join(',')} @ ${index}`,
        )
    }
  }
  // The audit's example: site ENTRY, site EXIT, workshop ENTRY. Deleting the
  // site EXIT would leave ENTRY -> ENTRY and is refused; the last row may go.
  assert.equal(deleteRefusedBySql(['entry', 'exit', 'entry'], 1), true)
  assert.equal(deleteRefusedBySql(['entry', 'exit', 'entry'], 2), false)
  // A legacy duplicate may be removed: the chain only gets better.
  assert.equal(deleteRefusedBySql(['entry', 'entry', 'exit'], 0), false)
})

// --- H3: driver change -------------------------------------------------------

test('H3: only an admin or the entry foreman may change the driver', () => {
  assert.ok(
    !code(driverChange).includes('can_access_movement'),
    'the read helper must not authorise a write',
  )
  assert.match(
    driverChange,
    /v_allowed := FOUND AND \(\s+v_role = 'admin'\s+OR \(v_role = 'supervisor' AND v_entry\.supervisor_id = auth\.uid\(\)\)\s+\);\s+IF v_allowed IS NOT TRUE THEN\s+RAISE EXCEPTION 'entry_not_accessible'\s+USING ERRCODE = '42501'/,
  )
  assert.match(
    driverChange,
    /IF auth\.uid\(\) IS NULL THEN\s+RAISE EXCEPTION 'entry_not_accessible'/,
  )
  // Authorisation happens before the lock and before anything is written.
  assert.ok(
    driverChange.indexOf('IF v_allowed IS NOT TRUE THEN') <
      driverChange.search(TRIGGER_LOCK),
  )
})

test('H3: the history stays append-only and a closed visit rejects a change', () => {
  assert.match(driverChange, /RAISE EXCEPTION 'visit_is_closed'/)
  assert.match(driverChange, /RAISE EXCEPTION 'invalid_driver_id'/)
  assert.match(driverChange, /RAISE EXCEPTION 'driver_unchanged'/)
  assert.match(
    driverChange,
    // Row lock before the advisory lock, the 0093 order.
    /AND movement_type = 'entry'\s+AND movement_context = 'site'\s+FOR UPDATE;/,
  )
  assert.match(driverChange, /INSERT INTO public\.movement_driver_changes/)
  assert.ok(!/UPDATE public\./.test(driverChange))
  assert.ok(!/DELETE FROM/.test(driverChange))
  assert.ok(
    driverChange.search(TRIGGER_LOCK) <
      driverChange.indexOf("RAISE EXCEPTION 'visit_is_closed'"),
  )
})

// --- M4: user deletion and fail-closed role checks ---------------------------

test('M4: the uploader link is RESTRICT and added without a blind validation', () => {
  assert.match(
    sql0109,
    /ADD CONSTRAINT entry_exit_photos_uploaded_by_fkey\s+FOREIGN KEY \(uploaded_by\) REFERENCES public\.profiles\(id\)\s+ON DELETE RESTRICT\s+NOT VALID;/,
  )
  assert.match(
    sql0109,
    /IF v_found THEN\s+ALTER TABLE public\.entry_exit_photos\s+VALIDATE CONSTRAINT entry_exit_photos_uploaded_by_fkey;/,
  )
  assert.ok(!/ON DELETE CASCADE/.test(code(sql0109)))
  // The old constraint is found in the catalog, not assumed by name.
  assert.match(sql0109, /FROM pg_constraint c/)
  assert.match(sql0109, /a\.attname = 'uploaded_by'/)
})

test('M4: every listed function rejects a missing profile', () => {
  for (const [name, roles] of [
    [
      'classify_workshop_entry',
      "'admin', 'workshop_manager', 'assistant_workshop_manager'",
    ],
    [
      'quick_create_workshop_equipment',
      "'admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager'",
    ],
    ['quick_create_lessor_by_name', "'admin', 'supervisor'"],
    ['quick_create_foreman_equipment', "'admin', 'supervisor'"],
    [
      'get_last_movement',
      "'admin', 'supervisor', 'workshop', 'assistant_workshop_manager', 'workshop_manager', 'monitor'",
    ],
  ]) {
    const body = functionBody(sql0109, name)
    assert.match(
      body,
      new RegExp(
        `IF v_role IS NULL\\s+OR v_role NOT IN \\(${escape(roles)}\\)`,
      ),
      `${name} is not fail-closed`,
    )
  }
  // The leftover NULL-unsafe overload of 0049 is removed.
  assert.match(
    sql0109,
    /DROP FUNCTION IF EXISTS public\.quick_create_foreman_equipment\(text, text, uuid\);/,
  )
})

test('M4: get_last_movement keeps its 0091 columns', () => {
  const body = functionBody(sql0109, 'get_last_movement')
  const columns = body
    .slice(body.indexOf('RETURNS TABLE(') + 14, body.indexOf(')\nLANGUAGE'))
    .split(',')
    .map((column) => column.trim().split(/\s+/)[0])
  assert.deepEqual(columns, [
    'movement_type',
    'movement_context',
    'workshop_purpose',
    'recorded_at',
    'supervisor_id',
    'supervisor_name',
    'company_id',
    'project_id',
    'project_name_ar',
    'project_name_en',
    'contractor_equipment_code',
    'driver_id',
    'driver_name',
    'driver_mobile_number',
    'company_name_ar',
    'company_name_en',
  ])
})

test('M4: the Users screen maps a refused delete to a safe message', () => {
  const screen = read('src', 'screens', 'AdminUsers.tsx')
  assert.match(
    screen,
    /error\.code === '23503' \? 'userDeleteHasRecords' : 'userDeleteError'/,
  )
  assert.ok(!/setLoadError\(error\.message\)/.test(screen))
})

// --- M5: quick-create ---------------------------------------------------------

test('M5: unused quick-create functions are dropped and the driver one is role-limited', () => {
  assert.match(
    sql0109,
    /DROP FUNCTION IF EXISTS public\.quick_create_lessor\(text, text\);/,
  )
  assert.match(
    sql0109,
    /DROP FUNCTION IF EXISTS public\.quick_create_equipment\(text, uuid\);/,
  )
  const body = functionBody(sql0109, 'quick_create_driver')
  assert.match(
    body,
    /IF auth\.uid\(\) IS NULL\s+OR v_role IS NULL\s+OR v_role NOT IN \('admin', 'supervisor'\) THEN\s+RAISE EXCEPTION 'quick_driver_not_allowed'\s+USING ERRCODE = '42501'/,
  )
  assert.match(body, /RAISE EXCEPTION 'invalid_quick_driver'/)
  // The dropped functions are not called by the application.
  const callers = ['src', 'app']
    .flatMap((dir) => listFiles(path.join(root, dir)))
    .filter((file) => /\.(ts|tsx)$/.test(file))
  for (const file of callers) {
    const source = fs.readFileSync(file, 'utf8')
    assert.ok(
      !/rpc\(\s*'quick_create_(lessor|equipment)'/.test(source),
      `${file} still calls a dropped function`,
    )
  }
})

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? listFiles(full) : [full]
  })
}

// --- M6 / M7: photos ---------------------------------------------------------

test('M6: a photo row can only change its sort_order', () => {
  assert.match(
    sql0109,
    /REVOKE UPDATE ON TABLE public\.entry_exit_photos FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    sql0109,
    /GRANT UPDATE \(sort_order\) ON TABLE public\.entry_exit_photos TO authenticated;/,
  )
  const guard = functionBody(sql0109, 'protect_movement_photo_identity')
  for (const column of ['entry_exit_log_id', 'file_path', 'uploaded_by'])
    assert.ok(
      guard.includes(`NEW.${column} IS DISTINCT FROM OLD.${column}`),
      `${column} is not protected`,
    )
  assert.ok(!guard.includes('sort_order'))
  assert.match(guard, /RAISE EXCEPTION 'photo_update_not_allowed'/)
  assert.match(
    sql0109,
    /CREATE TRIGGER protect_movement_photo_identity_trigger\s+BEFORE UPDATE ON public\.entry_exit_photos\s+FOR EACH ROW EXECUTE FUNCTION public\.protect_movement_photo_identity\(\);/,
  )
  // Nothing in the application updates the table.
  for (const file of ['src', 'app']
    .flatMap((dir) => listFiles(path.join(root, dir)))
    .filter((name) => /\.(ts|tsx)$/.test(name))) {
    const source = fs.readFileSync(file, 'utf8')
    assert.ok(
      !/from\('entry_exit_photos'\)\s*\.update\(/.test(source),
      `${file} updates entry_exit_photos`,
    )
  }
})

test('M6: a new photo row is bound to the upload path convention', () => {
  const body = functionBody(sql0109, 'enforce_movement_photo_path')
  assert.match(body, /cardinality\(v_parts\) <> 3/)
  assert.match(
    body,
    /public\.safe_uuid\(v_parts\[1\]\) IS DISTINCT FROM NEW\.uploaded_by/,
  )
  assert.match(body, /v_folder = NEW\.entry_exit_log_id/)
  assert.match(
    body,
    /WHERE pending\.id = v_folder\s+AND pending\.uploaded_by = NEW\.uploaded_by\s+AND NEW\.file_path = ANY\(pending\.file_paths\)/,
  )
  assert.match(
    sql0109,
    /CREATE TRIGGER enforce_movement_photo_path_trigger\s+BEFORE INSERT ON public\.entry_exit_photos\s+FOR EACH ROW EXECUTE FUNCTION public\.enforce_movement_photo_path\(\);/,
  )
  // The convention the trigger enforces is the one every upload path writes.
  const movementFolder =
    /`\$\{[\w.]+\}\/\$\{[\w.]+\}\/\$\{crypto\.randomUUID\(\)\}-/
  for (const file of [
    ['app', 'api', 'movements', 'route.ts'],
    ['app', 'api', 'movements', '[id]', 'photos', 'route.ts'],
    ['app', 'api', 'movements', 'photo-uploads', 'route.ts'],
    ['src', 'lib', 'movementPhotoUpload.ts'],
  ])
    assert.match(read(...file), movementFolder, file.join('/'))
})

test('M7: attaching photos uses a write rule, not the read rule', () => {
  const body = functionBody(sql0109, 'can_write_movement_photos')
  assert.match(body, /JOIN public\.profiles me ON me\.id = auth\.uid\(\)/)
  assert.match(body, /me\.role = 'admin'/)
  assert.match(
    body,
    /me\.role IN \('supervisor', 'workshop', 'assistant_workshop_manager', 'workshop_manager'\)\s+AND l\.supervisor_id = auth\.uid\(\)/,
  )
  assert.match(
    body,
    /me\.role IN \('workshop', 'assistant_workshop_manager', 'workshop_manager'\)\s+AND l\.movement_context = 'workshop'/,
  )
  assert.ok(!body.includes("'monitor'"))

  const rowPolicy = sql0109.slice(
    sql0109.indexOf('CREATE POLICY "insert_entry_exit_photos"'),
    sql0109.indexOf('DROP POLICY IF EXISTS insert_log_photos'),
  )
  assert.match(rowPolicy, /public\.current_user_role\(\) <> 'monitor'/)
  assert.match(rowPolicy, /uploaded_by = auth\.uid\(\)/)
  assert.match(
    rowPolicy,
    /public\.can_write_movement_photos\(entry_exit_log_id\)/,
  )
  assert.ok(!code(rowPolicy).includes('can_access_movement'))

  const start = sql0109.indexOf('CREATE POLICY insert_log_photos')
  const storagePolicy = sql0109.slice(start, sql0109.indexOf('\n);', start))
  assert.match(storagePolicy, /bucket_id = 'log-photos'/)
  assert.match(storagePolicy, /public\.current_user_role\(\) <> 'monitor'/)
  assert.match(
    storagePolicy,
    /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/,
  )
  assert.match(
    storagePolicy,
    /public\.can_write_movement_photos\(public\.safe_uuid\(split_part\(name, '\/', 2\)\)\)/,
  )
  // The staging branch for photos uploaded before the movement exists stays.
  assert.match(storagePolicy, /pending\.uploaded_by = auth\.uid\(\)/)
  assert.match(storagePolicy, /pending\.expires_at > now\(\)/)
  assert.ok(!storagePolicy.includes('can_access_movement'))
  // Read access (0098) and the other storage policies are not touched.
  for (const policy of [
    'select_log_photos',
    'update_log_photos',
    'delete_log_photos',
    'select_entry_exit_photos',
    'select_entry_exit_logs',
  ])
    assert.ok(!code(sql0109).includes(policy), `0109 must not touch ${policy}`)
  assert.ok(!/FUNCTION public\.can_access_movement/.test(sql0109))
})

// --- Error codes reach the UI as safe messages --------------------------------

function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(root, 'src', 'lib', `${name}.ts`)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    output,
    {
      exports,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

test('H1: the new exit code maps to 403 and to a translated message', () => {
  const { movementErrorCode, movementErrorStatus, MOVEMENT_ERROR_CODES } =
    loadLibModule('movementErrors')
  const { movementSaveErrorKey } = loadLibModule('movementSaveErrors')
  assert.equal(
    movementErrorCode(
      'exit_equipment_on_site\nHINT: The equipment is inside a site; a workshop exit cannot close a site entry.',
    ),
    'exit_equipment_on_site',
  )
  assert.ok(MOVEMENT_ERROR_CODES.includes('exit_equipment_on_site'))
  assert.equal(movementErrorStatus('exit_equipment_on_site'), 403)
  assert.equal(
    movementSaveErrorKey('exit_equipment_on_site', false),
    'workshopExitEquipmentOnSite',
  )
  // The existing site-side codes are untouched.
  assert.equal(
    movementErrorCode('exit_equipment_in_workshop'),
    'exit_equipment_in_workshop',
  )
  assert.equal(
    movementErrorCode('exit_not_entry_owner'),
    'exit_not_entry_owner',
  )
})

test('the wave-8 strings exist in both languages and follow the Arabic rule', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = source.match(
    /\/\/ wave-8-security — start[\s\S]*?\/\/ wave-8-security — end/g,
  )
  assert.equal(blocks?.length, 2, 'one delimited block per language')
  for (const block of blocks)
    for (const key of ['userDeleteHasRecords', 'workshopExitEquipmentOnSite'])
      assert.match(block, new RegExp(`\\b${key}:`))
  const arabic = blocks.find((block) => /[؀-ۿ]/.test(block))
  assert.ok(arabic, 'the Arabic block is missing')
  // New Arabic copy uses the plain alif: no hamza or madda forms.
  assert.ok(!/[أإآ]/.test(arabic))
})
