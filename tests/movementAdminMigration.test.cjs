const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Guards the security and invariant properties of migration 0104. The database
// is the only authoritative place for these rules, so a change that drops one
// of them must fail here rather than in production.
const sql = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20260923120000_0104_admin_edit_delete_movement.sql',
  ),
  'utf8',
)

function functionBody(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  assert.ok(start >= 0, `missing function: ${name}`)
  const end = sql.indexOf('\n$$;', start)
  assert.ok(end > start, `unterminated function: ${name}`)
  return sql.slice(start, end)
}

const update = functionBody('admin_update_movement_details')
const remove = functionBody('admin_delete_movement')

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
  for (const signature of [
    'public.admin_update_movement_details(uuid, text, uuid, text)',
    'public.admin_delete_movement(uuid)',
  ]) {
    assert.ok(
      sql.includes(`REVOKE ALL ON FUNCTION ${signature}`) ||
        sql.includes(`REVOKE ALL ON FUNCTION ${signature}\n`),
      `missing REVOKE for ${signature}`,
    )
    assert.ok(
      sql.includes(`GRANT EXECUTE ON FUNCTION ${signature}`),
      `missing GRANT for ${signature}`,
    )
  }
  assert.equal((sql.match(/FROM PUBLIC, anon/g) ?? []).length >= 2, true)
})

test('the edit writes only notes, driver_id and driver_name', () => {
  const statement = update.slice(
    update.indexOf('UPDATE public.entry_exit_logs'),
  )
  assert.match(statement, /SET notes =/)
  assert.match(statement, /driver_id = CASE/)
  assert.match(statement, /driver_name = CASE/)
  for (const column of [
    'recorded_at =',
    'movement_type =',
    'movement_context =',
    'equipment_id =',
    'company_id =',
    'project_id =',
    'contractor_equipment_code =',
    'supervisor_id =',
  ]) {
    assert.ok(!statement.includes(column), `edit must not write ${column}`)
  }
})

test('an open site visit keeps the append-only driver path', () => {
  assert.match(update, /RAISE EXCEPTION 'open_visit_driver_change'/)
  assert.match(update, /driver_not_supported/)
})

test('both functions take the same advisory-lock key as the sequence trigger', () => {
  for (const body of [update, remove]) {
    assert.match(
      body,
      /pg_advisory_xact_lock\(\s*hashtextextended\(v_log\.equipment_id::text \|\| ':' \|\| v_log\.movement_context, 0\)\s*\)/,
    )
  }
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
  const guard = functionBody('protect_workshop_required_photo')
  assert.match(guard, /current_setting\('app\.movement_delete', true\)/)
  assert.match(
    guard,
    /NOT EXISTS \(\s*SELECT 1 FROM public\.entry_exit_logs l WHERE l\.id = OLD\.entry_exit_log_id\s*\)/,
  )
  // The original rule is still raised for a live workshop movement.
  assert.match(guard, /RAISE EXCEPTION 'workshop movement requires one photo'/)
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
  // No other storage policy is touched by this migration.
  for (const policyName of [
    'select_log_photos',
    'insert_log_photos',
    'update_log_photos',
  ]) {
    assert.ok(!sql.includes(policyName), `0104 must not touch ${policyName}`)
  }
})
