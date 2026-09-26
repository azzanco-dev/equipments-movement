const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Guards the security and invariant properties of migrations 0104 and 0105.
// The database is the only authoritative place for these rules, so a change
// that drops one of them must fail here rather than in production.
function migration(file) {
  return fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', file),
    'utf8',
  )
}

const sql = migration('20260923120000_0104_admin_edit_delete_movement.sql')
const sql0105 = migration('20260926100000_0105_admin_update_movement_notes.sql')

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

// 0105 holds the live definition of both admin functions.
const update = functionBody(sql0105, 'admin_update_movement')
const remove = functionBody(sql0105, 'admin_delete_movement')

const UPDATE_SIGNATURE =
  'public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text)'
const DELETE_SIGNATURE = 'public.admin_delete_movement(uuid)'

test('both functions are SECURITY DEFINER with a fixed search_path', () => {
  for (const body of [update, remove]) {
    assert.match(body, /SECURITY DEFINER/)
    assert.match(body, /SET search_path = public, pg_temp/)
  }
})

test('both functions check is_admin() fail-closed', () => {
  for (const body of [update, remove]) {
    assert.match(
      body,
      /IF auth\.uid\(\) IS NULL OR NOT public\.is_admin\(\) THEN\s+RAISE EXCEPTION 'admin_required'/,
    )
  }
})

test('anon cannot execute either function and authenticated can', () => {
  for (const signature of [UPDATE_SIGNATURE, DELETE_SIGNATURE]) {
    assert.match(
      sql0105,
      new RegExp(
        `REVOKE ALL ON FUNCTION ${escape(signature)}\\s+FROM PUBLIC, anon;`,
      ),
      `missing REVOKE for ${signature}`,
    )
    assert.match(
      sql0105,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION ${escape(signature)}\\s+TO authenticated;`,
      ),
      `missing GRANT for ${signature}`,
    )
  }
})

test('0105 replaces the 0068 signature and adds p_notes last', () => {
  // The old eight-argument signature is dropped BEFORE the new one exists, so
  // PostgREST named-argument calls never meet two overloads.
  const dropAt = sql0105.indexOf(
    'DROP FUNCTION IF EXISTS public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid);',
  )
  const createAt = sql0105.indexOf(
    'CREATE FUNCTION public.admin_update_movement(',
  )
  assert.ok(dropAt >= 0, 'the 0068 signature must be dropped')
  assert.ok(createAt > dropAt, 'drop before create')
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
  assert.match(
    params,
    /p_driver_id uuid DEFAULT NULL,\s+p_notes text DEFAULT NULL\s*$/,
  )
})

test('0105 drops the separate note/driver function of 0104', () => {
  assert.match(
    sql0105,
    /DROP FUNCTION IF EXISTS public\.admin_update_movement_details\(uuid, text, uuid, text\);/,
  )
  // Nothing in the app still calls it.
  for (const file of [
    path.join('app', 'api', 'movements', '[id]', 'route.ts'),
    path.join('src', 'components', 'movement', 'MovementEditDialog.tsx'),
    path.join('src', 'screens', 'MovementDetail.tsx'),
    path.join('src', 'lib', 'movementAdmin.ts'),
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    assert.ok(
      !source.includes('admin_update_movement_details'),
      `${file} still calls the dropped function`,
    )
    assert.ok(
      !source.includes("action: 'details'"),
      `${file} still uses the removed PATCH action`,
    )
  }
})

test('the correction writes notes trimmed, empty as NULL, max 1000', () => {
  assert.match(update, /IF p_notes IS NULL THEN\s+v_notes := v_log\.notes;/)
  assert.match(update, /v_notes := NULLIF\(btrim\(p_notes\), ''\);/)
  assert.match(update, /char_length\(v_notes\) > 1000/)
  assert.match(update, /RAISE EXCEPTION 'movement_notes_too_long'/)
  const rowUpdate = update.slice(
    update.indexOf('UPDATE public.entry_exit_logs l SET'),
    update.indexOf('WHERE l.id = p_movement_id;'),
  )
  assert.match(rowUpdate, /notes = v_notes/)
  // The note belongs to this row only, never to the paired visit row.
  const pairUpdate = update.slice(
    update.indexOf('WHERE l.id = p_movement_id;'),
    update.indexOf('WHERE l.id = v_pair.id;'),
  )
  assert.ok(!pairUpdate.includes('notes ='))
})

test('the correction keeps every 0068 validation', () => {
  for (const token of [
    "RAISE EXCEPTION 'invalid_payload'",
    "RAISE EXCEPTION 'future_time'",
    "RAISE EXCEPTION 'invalid_sequence'",
    "RAISE EXCEPTION 'movement_not_found'",
  ])
    assert.ok(update.includes(token), `missing ${token}`)
  assert.match(
    update,
    /v_log\.movement_context = 'site' AND \(p_company_id IS NULL OR p_project_id IS NULL\)/,
  )
  // Deterministic pairing and sequence re-check by (recorded_at, id).
  assert.match(
    update,
    /PARTITION BY equipment_id, movement_context ORDER BY recorded_at, id/,
  )
  assert.match(
    update,
    /\(l\.recorded_at, l\.id\) > \(v_log\.recorded_at, v_log\.id\)/,
  )
  assert.match(
    update,
    /\(l\.recorded_at, l\.id\) < \(v_log\.recorded_at, v_log\.id\)/,
  )
  // Inherited site facts stay consistent on the paired row.
  assert.match(update, /WHERE l\.id = v_pair\.id;/)
  // The foreman limit of 0093 also holds for an admin-changed code.
  assert.match(update, /RAISE EXCEPTION 'contractor_code_too_long'/)
})

test('an open site visit keeps the append-only driver path', () => {
  assert.match(update, /RAISE EXCEPTION 'open_visit_driver_change'/)
  assert.match(update, /RAISE EXCEPTION 'driver_not_supported'/)
  assert.match(update, /RAISE EXCEPTION 'invalid_driver'/)
  // The stored name comes from drivers, never from the caller.
  assert.match(update, /SELECT d\.full_name INTO v_driver_name/)
  assert.match(
    update,
    /IF p_driver_id IS NOT NULL AND p_driver_id IS DISTINCT FROM v_log\.driver_id THEN/,
  )
})

test('both functions take the same advisory-lock key as the sequence trigger', () => {
  for (const body of [update, remove]) {
    assert.match(
      body,
      /pg_advisory_xact_lock\(\s*hashtextextended\(v_log\.equipment_id::text \|\| ':' \|\| v_log\.movement_context, 0\)\s*\)/,
    )
  }
})

test('0105 appends to text[] with array_append, never a bare literal', () => {
  // `v_fields || 'x'` parses 'x' as an array literal and fails at runtime.
  assert.ok(!/v_fields\s*:=\s*v_fields\s*\|\|\s*'/.test(remove))
  assert.ok(!/v_paths\s*:=\s*v_paths\s*\|\|/.test(remove))
  assert.match(
    remove,
    /v_fields := array_append\(v_fields, 'movement_driver_changes'::text\);/,
  )
  assert.match(
    remove,
    /v_fields := array_append\(v_fields, 'entry_exit_photos'::text\);/,
  )
  // Same signature and return type as 0104.
  assert.match(
    remove,
    /CREATE OR REPLACE FUNCTION public\.admin_delete_movement\(p_log_id uuid\)\s+RETURNS text\[\]/,
  )
})

test('the delete refuses any movement that is not the last of its sequence', () => {
  // Deterministic pairing: (recorded_at, id), never recorded_at alone.
  assert.match(
    remove,
    /AND \(l\.recorded_at, l\.id\) > \(v_log\.recorded_at, v_log\.id\)/,
  )
  assert.match(remove, /ORDER BY l\.recorded_at, l\.id/)
  assert.match(remove, /RAISE EXCEPTION 'entry_has_later_exit'/)
  assert.match(remove, /RAISE EXCEPTION 'movement_not_last'/)
})

test('the delete removes its dependants and audits them before the row goes', () => {
  const auditAt = remove.indexOf('INSERT INTO public.movement_audit_logs')
  const driverDeleteAt = remove.indexOf(
    'DELETE FROM public.movement_driver_changes',
  )
  const photoDeleteAt = remove.indexOf('DELETE FROM public.entry_exit_photos')
  const logDeleteAt = remove.indexOf('DELETE FROM public.entry_exit_logs')
  assert.ok(auditAt > 0 && driverDeleteAt > auditAt)
  assert.ok(photoDeleteAt > driverDeleteAt)
  assert.ok(logDeleteAt > photoDeleteAt)
  // The audit snapshot helper of 0070 is reused, not re-implemented.
  assert.match(remove, /public\.movement_audit_snapshot\(v_log\)/)
  // Storage paths, including the legacy single photo column, go back to the API.
  assert.match(remove, /RETURNS text\[\]/)
  assert.match(remove, /v_log\.photo_url/)
})

test('the workshop photo guard is only escaped while its movement is deleted', () => {
  const guard = functionBody(sql, 'protect_workshop_required_photo')
  assert.match(guard, /current_setting\('app\.movement_delete', true\)/)
  assert.match(
    guard,
    /NOT EXISTS \(\s*SELECT 1 FROM public\.entry_exit_logs l WHERE l\.id = OLD\.entry_exit_log_id\s*\)/,
  )
  // The original rule is still raised for a live workshop movement.
  assert.match(guard, /RAISE EXCEPTION 'workshop movement requires one photo'/)
  // 0105 leaves the guard alone.
  assert.ok(!/FUNCTION public\.protect_workshop_required_photo/.test(sql0105))
})

test('the storage delete policy adds an admin escape and nothing else', () => {
  const start = sql.indexOf('CREATE POLICY delete_log_photos')
  assert.ok(start > 0, 'the delete_log_photos policy is not recreated')
  const policy = sql.slice(start, sql.indexOf('\n);', start))
  // Still scoped to this bucket, still closed to monitor, uploader rule kept.
  assert.match(policy, /bucket_id = 'log-photos'/)
  assert.match(policy, /public\.current_user_role\(\) <> 'monitor'/)
  assert.match(
    policy,
    /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text OR public\.is_admin\(\)/,
  )
  // The row-reachability group keeps all four of its 0079 alternatives.
  assert.match(policy, /public\.entry_exit_photos photo/)
  assert.match(
    policy,
    /public\.can_access_movement\(public\.safe_uuid\(split_part\(name, '\/', 2\)\)\)/,
  )
  assert.match(policy, /movement\.photo_url = name/)
  assert.match(policy, /public\.pending_movement_photo_batches pending/)
  // …plus the admin escape for objects whose rows were just deleted.
  assert.match(policy, /AND \(\s*public\.is_admin\(\)/)
  // No other storage policy is touched by 0104 or 0105.
  for (const policyName of [
    'select_log_photos',
    'insert_log_photos',
    'update_log_photos',
    'delete_log_photos',
  ]) {
    if (policyName !== 'delete_log_photos')
      assert.ok(!sql.includes(policyName), `0104 must not touch ${policyName}`)
    assert.ok(
      !sql0105.includes(policyName),
      `0105 must not touch ${policyName}`,
    )
  }
})
