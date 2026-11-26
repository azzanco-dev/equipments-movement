const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0214 (owner 2026-11-26, «فيه معدات قديمة ابغاك تحذفها, بس تاكد
// ماعليها عمليات»): since 0168 every delete of a unit failed, because the
// audit trigger wrote the deleted unit's id into equipment_audit_logs.

const ROOT = path.join(__dirname, '..')
const SQL = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20261126100000_0214_equipment_audit_delete.sql'),
  'utf8',
)
const CODE = SQL.replace(/--[^\n]*/g, '')

test('0214: a DELETE writes its audit row without the gone unit id', () => {
  assert.match(CODE, /IF TG_OP = 'DELETE' THEN\s+v_equipment_id := NULL;\s+v_equipment_code := OLD\.code;/)
  assert.doesNotMatch(CODE, /v_equipment_id := OLD\.id/)
  assert.match(CODE, /v_equipment_id := NEW\.id;/)
})

test('0214: the function keeps its definer settings and stays closed to clients', () => {
  assert.match(CODE, /CREATE OR REPLACE FUNCTION public\.audit_equipment_change\(\)/)
  assert.match(CODE, /SECURITY DEFINER/)
  assert.match(CODE, /SET search_path TO 'public', 'pg_temp'/)
  assert.match(CODE, /REVOKE ALL ON FUNCTION public\.audit_equipment_change\(\) FROM PUBLIC, anon, authenticated;/)
  assert.doesNotMatch(CODE, /DROP TRIGGER/)
})
