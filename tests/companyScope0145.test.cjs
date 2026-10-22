// Migration 0145 (owner 2026-10-22, «رجع كل شي اول»): the company scope of
// 0143/0144 is undone — every policy and function back to its previous
// definition, the 0143 objects dropped. What stays is the entry form: its
// company and project selectors are filtered by the user's linked companies
// (`useMovementFormOptions`), client side, no RLS.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261022140000_0145_undo_company_scope.sql'
const PREVIOUS = '20261022130000_0144_company_scope_projects.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const sql = read('supabase', 'migrations', MIGRATION)
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const body = norm(sql)

/** The USING clause of a SELECT policy in a migration, normalised. */
function usingOf(text, name) {
  const match = new RegExp(
    `CREATE POLICY "?${name}"? ON (?:public\\.)?\\w+ FOR SELECT TO authenticated USING \\(([\\s\\S]*?)\\);`,
  ).exec(norm(text))
  assert.ok(match, `missing policy ${name}`)
  return match[1].trim()
}

function fnBody(text, name) {
  const source = norm(text)
  const match = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(([\\s\\S]*?)\\$\\$;`).exec(source)
  assert.ok(match, `missing function ${name}`)
  return match[0]
}

test('0145 is the single 0145 migration, right after 0144', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0145 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0145_/.test(file)).length, 1)
})

test('every policy 0143/0144 changed is back to its previous USING clause', () => {
  const sql0127 = read('supabase', 'migrations', '20261011140000_0127_permission_keys_in_policies.sql')
  const sql0136 = read('supabase', 'migrations', '20261018130000_0136_purchasing_supplier_pos.sql')
  assert.equal(usingOf(sql, 'select_companies'), 'true')
  assert.equal(usingOf(sql, 'select_projects'), 'true')
  assert.equal(usingOf(sql, 'select_entry_exit_logs'), usingOf(sql0127, 'select_entry_exit_logs'))
  for (const name of ['select_supplier_pos', 'select_equipment_cards', 'select_supplier_po_equipment', 'select_supplier_po_events'])
    assert.equal(usingOf(sql, name), usingOf(sql0136, name), name)
  // Nothing of 0143 remains in any policy.
  assert.doesNotMatch(
    body.replace(/DROP FUNCTION IF EXISTS public\.\w+\([^)]*\);/g, ''),
    /scoped_company_ids|company_in_scope|company_links_required|profile_holds_permission/,
  )
})

test('movement_scope_allows is the 0126 body again', () => {
  const sql0126 = read('supabase', 'migrations', '20261011130000_0126_roles_and_permissions.sql')
  const strip = (text) => text.replace(/\s+/g, ' ')
  assert.equal(strip(fnBody(sql, 'movement_scope_allows')), strip(fnBody(sql0126, 'movement_scope_allows')))
})

test('the 0143 triggers and functions are dropped, nothing else is created', () => {
  for (const statement of [
    'DROP TRIGGER IF EXISTS enforce_site_entry_company_scope ON public.entry_exit_logs;',
    'DROP FUNCTION IF EXISTS public.enforce_site_entry_company_scope();',
    'DROP TRIGGER IF EXISTS enforce_company_assignment_target ON public.profile_companies;',
    'DROP FUNCTION IF EXISTS public.enforce_company_assignment_target();',
    'DROP FUNCTION IF EXISTS public.profile_holds_permission(uuid, text);',
    'DROP FUNCTION IF EXISTS public.company_in_scope(uuid);',
    'DROP FUNCTION IF EXISTS public.scoped_company_ids();',
    'DROP FUNCTION IF EXISTS public.company_links_required();',
  ])
    assert.ok(body.includes(statement), statement)
  const created = [...body.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(/g)].map((m) => m[1])
  assert.deepEqual(created, ['movement_scope_allows'])
  assert.doesNotMatch(body, /CREATE TRIGGER|CREATE TABLE|ALTER TABLE|INSERT INTO|DELETE FROM|is_admin\(\)/)
  // The drops come after the policies that used the functions were replaced.
  assert.ok(body.indexOf('DROP FUNCTION IF EXISTS public.scoped_company_ids()') > body.lastIndexOf('CREATE POLICY'))
})

test('the client keeps no trace of the scope: no token, no admin-only field change', () => {
  assert.doesNotMatch(read('src', 'lib', 'movementErrors.ts'), /company_not_in_scope/)
  assert.doesNotMatch(read('src', 'lib', 'movementSaveErrors.ts'), /company_not_in_scope/)
  assert.doesNotMatch(read('src', 'i18n', 'translations.ts'), /companyNotInScope/)
  const page = read('src', 'screens', 'UserDetail.tsx')
  assert.match(page, /\{legacyRoleToSave === 'supervisor' && \(\s*<Field\s+label=\{t\('assignedCompanies'\)\}/)
  assert.match(read('supabase', 'functions', 'manage-user', 'index.ts'), /if \(role === 'supervisor' && companyIds\.length > 0\) \{/)
})

test('the entry form filters its company and project selectors by the linked companies', () => {
  const hook = read('src', 'components', 'movement', 'useMovementFormOptions.ts')
  // The user's own links, read once through RLS (profile_id = auth.uid());
  // the id comes from the form (the movement components read no auth).
  assert.doesNotMatch(hook, /useAuth/)
  assert.match(read('src', 'components', 'EntryExitForm.tsx'), /useMovementFormOptions\(\{ userId: user\?\.id \?\? null \}\)/)
  assert.match(hook, /\.from\('profile_companies'\)\s+\.select\('company_id'\)\s+\.eq\('profile_id', userId\)/)
  // Companies: only the linked ones while there are any.
  assert.match(hook, /if \(assignedCompanyIds\.length\)\s+request = request\.in\('id', assignedCompanyIds\)/)
  // Projects: those company_projects links to the linked companies, server side.
  assert.match(hook, /\.select\('id,name_ar,name_en,company_projects!inner\(company_id\)'\)\s+\.in\('company_projects\.company_id', assignedCompanyIds\)/)
  // Still at most 20 rows, still searched on the server.
  assert.equal((hook.match(/\.limit\(20\)/g) ?? []).length, 6)
  assert.doesNotMatch(hook, /\.filter\(\(/)
  // The hint on the user page says what the links do.
  const translations = read('src', 'i18n', 'translations.ts')
  const line = translations.split('\n').find((l) => /assignedCompaniesHelp:/.test(l)) ?? ''
  const next = translations.split('\n')[translations.split('\n').indexOf(line) + 1] ?? ''
  assert.match(`${line}${next}`, /نموذج/)
  assert.doesNotMatch(next, /[أإآ]/)
})
