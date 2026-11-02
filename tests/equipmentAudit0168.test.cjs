const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-11-02: a unit (A028) was set to «مباعة» and nobody could tell who
// did it → «خلنا نسوي سجل تعديلات المعدات، يكون ضمن النشاط». Migration 0168
// is the database side: an append-only audit of public.equipment written by a
// SECURITY DEFINER trigger, readable with the movement log's key. These are
// static guards of the migration text; the database is the only authority.

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
const file = files.find((name) => /_0168_/.test(name))
assert.ok(file, 'migration 0168 exists')
const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')

function functionBody(name) {
  const match = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\(`,
  ).exec(sql)
  assert.ok(match, `missing function: ${name}`)
  const end = sql.indexOf('\n$$;', match.index)
  assert.ok(end > match.index, `unterminated function: ${name}`)
  return sql.slice(match.index, end)
}

const trigger = functionBody('audit_equipment_change')
const display = functionBody('equipment_audit_display')

test('0168 is the only 0168 and comes after 0167', () => {
  assert.equal(files.filter((f) => /_0168_/.test(f)).length, 1)
  const file0167 = files.find((f) => /_0167_/.test(f))
  assert.ok(file0167)
  assert.ok(file > file0167, 'the 0168 timestamp sorts after 0167')
  // 0169 (client POs) and 0170 (the activity_log view) follow it since
  // 2026-11-02; 0168 only has to be the first after 0167.
  assert.equal(files.filter((f) => f > file0167)[0], file)
})

test('the table has the audit columns and no updated_at', () => {
  const start = sql.indexOf('CREATE TABLE public.equipment_audit_logs (')
  assert.ok(start > 0)
  const block = sql.slice(start, sql.indexOf(');', start))
  assert.match(block, /id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY/)
  assert.match(
    block,
    /equipment_id uuid REFERENCES public\.equipment\(id\) ON DELETE SET NULL/,
  )
  assert.match(block, /equipment_code text/)
  assert.match(
    block,
    /action text NOT NULL CHECK \(action IN \('create', 'update', 'delete'\)\)/,
  )
  assert.match(
    block,
    /actor_id uuid REFERENCES public\.profiles\(id\) ON DELETE SET NULL/,
  )
  assert.match(block, /actor_name text/)
  assert.match(block, /old_values jsonb/)
  assert.match(block, /new_values jsonb/)
  assert.match(block, /changed_fields text\[\] NOT NULL DEFAULT '\{\}'/)
  assert.match(block, /created_at timestamptz NOT NULL DEFAULT now\(\)/)
  // Append-only: no updated_at, no update_updated_at trigger (AGENTS.md).
  assert.doesNotMatch(block, /updated_at/)
  assert.doesNotMatch(sql, /update_updated_at/)
})

test('the indexes mirror the movement log', () => {
  assert.match(
    sql,
    /CREATE INDEX equipment_audit_logs_created_id_idx\s+ON public\.equipment_audit_logs\(created_at DESC, id DESC\)/,
  )
  assert.match(
    sql,
    /CREATE INDEX equipment_audit_logs_actor_created_idx\s+ON public\.equipment_audit_logs\(actor_id, created_at DESC, id DESC\)/,
  )
  assert.match(
    sql,
    /CREATE INDEX equipment_audit_logs_equipment_created_idx\s+ON public\.equipment_audit_logs\(equipment_id, created_at DESC, id DESC\)/,
  )
})

test('RLS: read for movements.activity, no write policy, grants like 0069', () => {
  assert.match(
    sql,
    /ALTER TABLE public\.equipment_audit_logs ENABLE ROW LEVEL SECURITY/,
  )
  assert.match(
    sql,
    /CREATE POLICY equipment_audit_logs_activity_select\s+ON public\.equipment_audit_logs\s+FOR SELECT TO authenticated\s+USING \(\(SELECT public\.has_permission\('movements\.activity'\)\)\)/,
  )
  const policies = [...sql.matchAll(/CREATE POLICY/g)]
  assert.equal(policies.length, 1, 'one policy: SELECT only')
  assert.doesNotMatch(sql, /FOR (INSERT|UPDATE|DELETE) TO authenticated/)
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.equipment_audit_logs FROM PUBLIC, anon, authenticated;\s+GRANT SELECT ON TABLE public\.equipment_audit_logs TO authenticated;/,
  )
  // The comment keeps the door open for a dedicated key later.
  assert.match(sql, /dedicated key/i)
})

test('the trigger fires after every insert, update and delete of equipment', () => {
  assert.match(
    sql,
    /CREATE TRIGGER audit_equipment\s+AFTER INSERT OR UPDATE OR DELETE ON public\.equipment\s+FOR EACH ROW EXECUTE FUNCTION public\.audit_equipment_change\(\)/,
  )
  // Every row, not a column list: a change through any path is recorded.
  assert.doesNotMatch(sql, /AFTER INSERT OR UPDATE OF/)
})

test('both functions are SECURITY DEFINER with a fixed search_path and no public execute', () => {
  for (const body of [trigger, display]) {
    assert.match(body, /SECURITY DEFINER/)
    assert.match(body, /SET search_path = public, pg_temp/)
  }
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.audit_equipment_change\(\) FROM PUBLIC, anon, authenticated/,
  )
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.equipment_audit_display\(jsonb, text\[\]\) FROM PUBLIC, anon, authenticated/,
  )
})

test('the actor comes from auth.uid() and profile_names; a NULL actor is recorded', () => {
  assert.match(
    trigger,
    /SELECT full_name INTO v_actor_name\s+FROM public\.profile_names\s+WHERE id = auth\.uid\(\)/,
  )
  assert.doesNotMatch(trigger, /IF auth\.uid\(\) IS NULL THEN\s+RETURN/)
  assert.match(trigger, /auth\.uid\(\),\s+v_actor_name/)
})

test('the derived and normalised columns are skipped, nothing else', () => {
  const start = trigger.indexOf('c_skipped CONSTANT text[] := ARRAY[')
  assert.ok(start > 0)
  const list = trigger.slice(start, trigger.indexOf('];', start))
  const skipped = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(skipped, [
    'id',
    'created_at',
    'updated_at',
    'plate_digits',
    'plate_letters_en',
    'numbering_status',
    'type_search',
  ])
  // The snapshot is the whole row minus that list, so a column added later
  // is audited without touching the function.
  assert.match(trigger, /v_old_raw := to_jsonb\(OLD\) - c_skipped/)
  assert.match(trigger, /v_new_raw := to_jsonb\(NEW\) - c_skipped/)
  // What a person changes stays audited.
  for (const column of ['status', 'ownership_status', 'code', 'is_active'])
    assert.ok(!skipped.includes(column), `${column} is audited`)
})

test('an UPDATE that changes nothing writes no row; only changed keys are stored', () => {
  assert.match(
    trigger,
    /IF v_old_raw -> v_key IS DISTINCT FROM v_new_raw -> v_key THEN\s+v_changed := array_append\(v_changed, v_key\)/,
  )
  assert.match(
    trigger,
    /IF cardinality\(v_changed\) = 0 THEN\s+RETURN NEW;\s+END IF/,
  )
  assert.match(
    trigger,
    /public\.equipment_audit_display\(v_old_raw, v_changed\)/,
  )
  assert.match(
    trigger,
    /public\.equipment_audit_display\(v_new_raw, v_changed\)/,
  )
  assert.match(display, /WHERE entry\.key = ANY \(p_keys\)/)
  // The two foreign keys are stored as names (0070's model).
  assert.match(display, /WHEN 'lessor_id' THEN/)
  assert.match(display, /WHEN 'project_id' THEN/)
})

test('the code snapshot survives the deletion of the unit', () => {
  assert.match(trigger, /v_equipment_code := OLD\.code/)
  assert.match(trigger, /v_equipment_code := NEW\.code/)
  assert.match(
    trigger,
    /CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END/,
  )
})

test('no backfill: the migration writes no audit rows itself', () => {
  const outsideFunctions = sql
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/--[^\n]*/g, '')
  assert.doesNotMatch(
    outsideFunctions,
    /INSERT INTO public\.equipment_audit_logs/,
  )
})
