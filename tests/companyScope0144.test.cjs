// Migration 0144 (owner 2026-10-22, completing 0143): a user with linked
// companies reads only the projects company_projects links to them.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261022130000_0144_company_scope_projects.sql'
const PREVIOUS = '20261022120000_0143_company_scope.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const sql = read('supabase', 'migrations', MIGRATION)
const body = sql
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')
  .trim()

test('0144 is the single 0144 migration, right after 0143', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0144 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0144_/.test(file)).length, 1)
})

test('projects read through company_projects under the company scope', () => {
  assert.match(
    body,
    /DROP POLICY IF EXISTS select_projects ON public\.projects; CREATE POLICY select_projects ON public\.projects FOR SELECT TO authenticated USING \( \(SELECT public\.scoped_company_ids\(\)\) IS NULL OR EXISTS \( SELECT 1 FROM public\.company_projects cp WHERE cp\.project_id = projects\.id AND cp\.company_id = ANY \(\(SELECT public\.scoped_company_ids\(\)\)::uuid\[\]\) \) \);/,
  )
  // Only that policy; no function, no role test, no write policy touched.
  assert.equal((body.match(/CREATE POLICY/g) ?? []).length, 1)
  assert.doesNotMatch(body, /CREATE (OR REPLACE )?FUNCTION|is_admin\(\)|current_user_role\(\)|\.role = '|FOR (INSERT|UPDATE|DELETE)/)
})
