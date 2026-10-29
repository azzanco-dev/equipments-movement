// Migration 0162 (owner 2026-10-29): created_at / updated_at on the four
// editable tables that missed one — entry_exit_logs.updated_at (backfilled
// from the movement audit), the roles trigger, lessor_contacts.created_at and
// profile_contacts.created_at with its trigger. Every backfill runs before
// the trigger that would move updated_at to now().
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261029120000_0162_timestamps_completion.sql'
const PREVIOUS = '20261029100000_0161_admin_supplier_site_counts.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const sql = norm(read('supabase', 'migrations', MIGRATION))

const trigger = (name, table) =>
  `CREATE TRIGGER ${name} BEFORE UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();`

test('0162 is the single 0162 migration, right after 0161', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0162 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0162_/.test(file)).length, 1)
})

test('entry_exit_logs.updated_at is added, backfilled from the audit, then required, then triggered', () => {
  const add = sql.indexOf(
    'ALTER TABLE public.entry_exit_logs ADD COLUMN IF NOT EXISTS updated_at timestamptz;',
  )
  const fill = sql.indexOf('UPDATE public.entry_exit_logs l SET updated_at = COALESCE(')
  const required = sql.indexOf(
    'ALTER TABLE public.entry_exit_logs ALTER COLUMN updated_at SET DEFAULT now(), ALTER COLUMN updated_at SET NOT NULL;',
  )
  const trig = sql.indexOf(trigger('trg_entry_exit_logs_updated_at', 'entry_exit_logs'))
  assert.ok(add >= 0 && add < fill && fill < required && required < trig)
  assert.match(
    sql,
    /COALESCE\( \(SELECT max\(a\.created_at\) FROM public\.movement_audit_logs a WHERE a\.movement_id = l\.id AND a\.action = 'update'\), l\.created_at \)/,
  )
})

test('roles gets the updated_at trigger', () => {
  assert.ok(sql.includes(trigger('roles_updated_at', 'roles')))
})

test('lessor_contacts.created_at is copied from updated_at with its trigger off', () => {
  const add = sql.indexOf(
    'ALTER TABLE public.lessor_contacts ADD COLUMN IF NOT EXISTS created_at timestamptz;',
  )
  const off = sql.indexOf(
    'ALTER TABLE public.lessor_contacts DISABLE TRIGGER lessor_contacts_updated_at;',
  )
  const fill = sql.indexOf(
    'UPDATE public.lessor_contacts SET created_at = updated_at WHERE created_at IS NULL;',
  )
  const on = sql.indexOf(
    'ALTER TABLE public.lessor_contacts ENABLE TRIGGER lessor_contacts_updated_at;',
  )
  const required = sql.indexOf(
    'ALTER TABLE public.lessor_contacts ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN created_at SET NOT NULL;',
  )
  assert.ok(add >= 0 && add < off && off < fill && fill < on && on < required)
})

test('profile_contacts.created_at is copied from updated_at before its new trigger', () => {
  const add = sql.indexOf(
    'ALTER TABLE public.profile_contacts ADD COLUMN IF NOT EXISTS created_at timestamptz;',
  )
  const fill = sql.indexOf(
    'UPDATE public.profile_contacts SET created_at = updated_at WHERE created_at IS NULL;',
  )
  const required = sql.indexOf(
    'ALTER TABLE public.profile_contacts ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN created_at SET NOT NULL;',
  )
  const trig = sql.indexOf(trigger('profile_contacts_updated_at', 'profile_contacts'))
  assert.ok(add >= 0 && add < fill && fill < required && required < trig)
})

test('the migration only adds columns and triggers: no function, view or policy', () => {
  assert.doesNotMatch(sql, /CREATE (OR REPLACE )?(FUNCTION|VIEW)|POLICY|DROP (COLUMN|TABLE|FUNCTION|VIEW)/)
})
