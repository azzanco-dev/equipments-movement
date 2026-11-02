// Migration 0170 (owner 2026-11-02): `activity_log`, the one list of the
// rebuilt activity page — movement_audit_logs UNION ALL equipment_audit_logs
// (0168) in one shape, read as the caller.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261102130000_0170_activity_log_view.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const raw = read('supabase', 'migrations', MIGRATION)
const sql = norm(raw)

test('0170 is the single 0170 migration, after 0168', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0170 present')
  assert.equal(migrations.filter((file) => /_0170_/.test(file)).length, 1)
  assert.ok(
    migrations.slice(0, at).some((file) => /_0168_/.test(file)),
    '0168 (equipment_audit_logs) comes first',
  )
  // The sibling session's 0169 keeps its own timestamp; ours is 13:00.
  assert.doesNotMatch(MIGRATION, /20261102120000/)
})

test('the view: both logs unioned into one shape, read as the caller, select only', () => {
  assert.match(
    sql,
    /CREATE OR REPLACE VIEW public\.activity_log WITH \(security_invoker = true\) AS/,
  )
  assert.match(sql, /FROM public\.movement_audit_logs m UNION ALL SELECT/)
  assert.match(sql, /FROM public\.equipment_audit_logs e;/)
  assert.match(sql, /'m:' \|\| m\.id::text AS id, 'movement'::text AS kind/)
  assert.match(sql, /'e:' \|\| e\.id::text AS id, 'equipment'::text AS kind/)
  assert.match(sql, /REVOKE ALL ON public\.activity_log FROM PUBLIC, anon;/)
  assert.match(sql, /GRANT SELECT ON public\.activity_log TO authenticated;/)
  assert.match(sql, /COMMENT ON VIEW public\.activity_log IS/)
  // Read-only: no definer, no function, no trigger, no write, no policy of
  // its own (the two tables' policies decide).
  assert.doesNotMatch(
    sql,
    /SECURITY DEFINER|CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|CREATE POLICY|INSERT INTO|UPDATE public|DELETE FROM|ALTER TABLE/,
  )
})

test('the same column list on both sides, in the same order', () => {
  const columns = [
    'id',
    'kind',
    'source_id',
    'record_id',
    'action',
    'actor_id',
    'actor_name',
    'equipment_id',
    'equipment_code',
    'movement_type',
    'movement_context',
    'changed_fields',
    'old_values',
    'new_values',
    'created_at',
  ]
  const [movement, equipment] = sql
    .split('UNION ALL')
    .map((half) => half.slice(half.indexOf('SELECT') + 6, half.indexOf('FROM')))
  const names = (half) =>
    half
      .split(/,(?![^(]*\))/)
      .map((entry) => entry.trim())
      .map((entry) => entry.replace(/^.*\sAS\s+/, '').replace(/^\w\./, ''))
  assert.deepEqual(names(movement), columns)
  assert.deepEqual(names(equipment), columns)
  // The movement is the record of a movement row, the unit of an equipment
  // row; a unit has no movement type or context.
  assert.match(sql, /m\.movement_id AS record_id/)
  assert.match(sql, /e\.equipment_id AS record_id/)
  assert.match(
    sql,
    /NULL::text AS movement_type, NULL::text AS movement_context/,
  )
})

test('the screen selects exactly the view columns', () => {
  const lib = read('src', 'lib', 'activityLog.ts')
  const select = lib.match(/ACTIVITY_LOG_SELECT =\s*'([^']+)'/)[1]
  assert.equal(
    select,
    'id,kind,source_id,record_id,action,actor_id,actor_name,equipment_id,equipment_code,movement_type,movement_context,changed_fields,old_values,new_values,created_at',
  )
  const screen = read('src', 'screens', 'ActivityScreen.tsx')
  assert.match(screen, /\.from\('activity_log'\)/)
  assert.match(screen, /\.select\(ACTIVITY_LOG_SELECT, \{ count: 'exact' \}\)/)
})
