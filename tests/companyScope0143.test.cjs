// Migration 0143 (owner request 2026-10-22): a user with linked companies
// (`profile_companies`, 0058) sees only those companies' data — companies,
// project movements, purchasing — and records project entries for them
// only; a user without links is unrestricted; the administrator (a holder of
// users.manage) can never be linked.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261022120000_0143_company_scope.sql'
const PREVIOUS = '20261022100000_0142_supplier_po_update.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const sql = read('supabase', 'migrations', MIGRATION)
const stripped = sql.replace(/--[^\n]*/g, '')
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const body = norm(stripped)

function fn(name) {
  const match = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`).exec(sql)
  assert.ok(match, `missing function ${name}`)
  const end = sql.indexOf('\n$$;', match.index)
  assert.ok(end > match.index, `unterminated function ${name}`)
  return norm(sql.slice(match.index, end + 4))
}

function policy(name, table) {
  const match = new RegExp(
    `DROP POLICY IF EXISTS ${name} ON public\\.${table}; CREATE POLICY ${name} ON public\\.${table} FOR SELECT TO authenticated USING \\(([\\s\\S]*?)\\); COMMENT ON POLICY`,
  ).exec(body)
  assert.ok(match, `missing policy ${name}`)
  return match[1].trim()
}

// The one rule, as the policies spell it (evaluated once per statement).
const RULE = (column) =>
  `(SELECT public.scoped_company_ids()) IS NULL OR ${column} = ANY ((SELECT public.scoped_company_ids()))`

test('0143 is the single 0143 migration, right after 0142', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0143 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0143_/.test(file)).length, 1)
})

test('scoped_company_ids: NULL = unrestricted, no session = nothing', () => {
  const scoped = fn('scoped_company_ids')
  assert.match(scoped, /RETURNS uuid\[\] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(scoped, /WHEN auth\.uid\(\) IS NULL THEN ARRAY\[\]::uuid\[\]/)
  assert.match(scoped, /SELECT array_agg\(pc\.company_id\) FROM public\.profile_companies pc WHERE pc\.profile_id = auth\.uid\(\)/)
  const inScope = fn('company_in_scope')
  assert.match(inScope, /RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(inScope, /SELECT COALESCE\( \(SELECT s IS NULL OR p_company_id = ANY \(s\) FROM \(SELECT public\.scoped_company_ids\(\) AS s\) AS scope\), false \);/)
  for (const signature of ['scoped_company_ids()', 'company_in_scope(uuid)', 'profile_holds_permission(uuid, text)']) {
    const escaped = signature.replace(/[()]/g, '\\$&')
    assert.match(body, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC, anon;`), signature)
    assert.match(body, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped} TO authenticated;`), signature)
  }
})

test('companies, project movements and purchasing read through the rule', () => {
  assert.equal(policy('select_companies', 'companies'), RULE('id'))
  const logs = policy('select_entry_exit_logs', 'entry_exit_logs')
  assert.ok(logs.startsWith(`( movement_context <> 'site' OR ${RULE('company_id')} ) AND (`), logs)
  // The 0127 scope stays underneath; `companies` is now «project rows».
  assert.match(logs, /supervisor_id = auth\.uid\(\) OR CASE \(SELECT public\.permission_scope\('movements\.read'\)\) WHEN 'all' THEN true WHEN 'site' THEN movement_context = 'site' WHEN 'workshop' THEN movement_context = 'workshop' WHEN 'companies' THEN movement_context = 'site' ELSE false END/)
  assert.doesNotMatch(logs, /profile_companies/)
  for (const [name, table] of [['select_supplier_pos', 'supplier_pos'], ['select_equipment_cards', 'equipment_cards']])
    assert.equal(policy(name, table), `(SELECT public.has_permission('purchasing.view')) AND ( ${RULE('company_id')} )`)
  for (const [name, table] of [['select_supplier_po_equipment', 'supplier_po_equipment'], ['select_supplier_po_events', 'supplier_po_events']])
    assert.equal(
      policy(name, table),
      `(SELECT public.has_permission('purchasing.view')) AND EXISTS ( SELECT 1 FROM public.supplier_pos p WHERE p.id = supplier_po_id AND ( ${RULE('p.company_id')} ) )`,
    )
  // No policy tests a role.
  assert.doesNotMatch(body, /is_admin\(\)|current_user_role\(\)|\.role = '/)
})

test('movement_scope_allows carries the rule to every single-movement read', () => {
  const allows = fn('movement_scope_allows')
  assert.match(allows, /LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp/)
  assert.match(allows, /SELECT COALESCE\( \( p_movement_context IS DISTINCT FROM 'site' OR public\.company_in_scope\(p_company_id\) \) AND CASE WHEN p_scope IS NULL THEN false WHEN auth\.uid\(\) IS NOT NULL AND p_supervisor_id = auth\.uid\(\) THEN true WHEN p_scope = 'all' THEN true WHEN p_scope = 'site' THEN p_movement_context = 'site' WHEN p_scope = 'workshop' THEN p_movement_context = 'workshop' WHEN p_scope = 'companies' THEN p_movement_context = 'site' ELSE false END, false \);/)
  // Its callers of 0127 are not re-created: they pick the new body up.
  assert.doesNotMatch(stripped, /FUNCTION public\.(can_access_movement|can_write_movement_photos|change_active_movement_driver|enforce_movement_sequence)\(/)
})

test('a site entry outside the scope is refused by a small separate trigger', () => {
  const trigger = fn('enforce_site_entry_company_scope')
  assert.match(trigger, /RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(trigger, /IF NEW\.movement_type IS DISTINCT FROM 'entry' OR NEW\.movement_context IS DISTINCT FROM 'site' OR NEW\.company_id IS NULL THEN RETURN NEW; END IF;/)
  assert.match(trigger, /IF NOT public\.company_in_scope\(NEW\.company_id\) THEN RAISE EXCEPTION 'company_not_in_scope' USING ERRCODE = '42501'/)
  assert.doesNotMatch(trigger, /NEW\.\w+ :=/)
  assert.match(body, /REVOKE ALL ON FUNCTION public\.enforce_site_entry_company_scope\(\) FROM PUBLIC, anon, authenticated;/)
  assert.match(body, /CREATE TRIGGER enforce_site_entry_company_scope BEFORE INSERT ON public\.entry_exit_logs FOR EACH ROW EXECUTE FUNCTION public\.enforce_site_entry_company_scope\(\);/)
  // The client maps the token to a message of its own.
  const errors = read('src', 'lib', 'movementErrors.ts')
  assert.match(errors, /'company_not_in_scope',/)
  const mapper = errors.slice(errors.indexOf('export function movementErrorCode'))
  assert.ok(mapper.indexOf("'company_not_in_scope'") < mapper.indexOf('foreman role required'))
  const saveErrors = read('src', 'lib', 'movementSaveErrors.ts')
  assert.match(saveErrors, /company_not_in_scope: 'companyNotInScope'/)
  const translations = read('src', 'i18n', 'translations.ts')
  assert.equal((translations.match(/^\s+companyNotInScope:/gm) ?? []).length, 2)
})

test('the administrator can never be linked to companies', () => {
  const holds = fn('profile_holds_permission')
  assert.match(holds, /WHEN public\.roles_system_enabled\(\) THEN EXISTS \( SELECT 1 FROM public\.profile_roles pr JOIN public\.roles r ON r\.key = pr\.role_key AND r\.is_active JOIN public\.role_permissions rp ON rp\.role_key = pr\.role_key AND rp\.permission_key = p_key WHERE pr\.profile_id = p_profile_id \)/)
  assert.match(holds, /ELSE EXISTS \( SELECT 1 FROM public\.profiles p CROSS JOIN LATERAL public\.legacy_role_permissions\(p\.role\) AS m WHERE p\.id = p_profile_id AND m\.permission_key = p_key \)/)
  const trigger = fn('enforce_company_assignment_target')
  assert.match(trigger, /IF public\.profile_holds_permission\(NEW\.profile_id, 'users\.manage'\) THEN RAISE EXCEPTION 'admin_cannot_be_scoped' USING ERRCODE = '23514'/)
  assert.match(body, /REVOKE ALL ON FUNCTION public\.enforce_company_assignment_target\(\) FROM PUBLIC, anon, authenticated;/)
  assert.match(body, /CREATE TRIGGER enforce_company_assignment_target BEFORE INSERT ON public\.profile_companies FOR EACH ROW EXECUTE FUNCTION public\.enforce_company_assignment_target\(\);/)
  assert.match(body, /DELETE FROM public\.profile_companies pc WHERE public\.profile_holds_permission\(pc\.profile_id, 'users\.manage'\);/)
  // The only keys the migration names.
  assert.deepEqual(
    [...new Set([...stripped.matchAll(/'([a-z]+\.[a-z_.]+)'/g)].map((m) => m[1]))].sort(),
    ['movements.read', 'purchasing.view', 'users.manage'],
  )
})

test('0143 touches nothing else', () => {
  assert.doesNotMatch(stripped, /legacy_role_permissions\(p_role|CREATE TABLE|ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE public\./)
  const created = [...stripped.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(/g)].map((m) => m[1])
  assert.deepEqual(created, [
    'scoped_company_ids',
    'company_in_scope',
    'movement_scope_allows',
    'enforce_site_entry_company_scope',
    'profile_holds_permission',
    'enforce_company_assignment_target',
  ])
  const policies = [...stripped.matchAll(/CREATE POLICY (\w+) ON public\.(\w+)/g)].map((m) => `${m[2]}.${m[1]}`)
  assert.deepEqual(policies, [
    'companies.select_companies',
    'entry_exit_logs.select_entry_exit_logs',
    'supplier_pos.select_supplier_pos',
    'equipment_cards.select_equipment_cards',
    'supplier_po_equipment.select_supplier_po_equipment',
    'supplier_po_events.select_supplier_po_events',
  ])
})

test('the user page links companies to any role but the administrator', () => {
  const page = read('src', 'screens', 'UserDetail.tsx')
  assert.doesNotMatch(page, /=== 'supervisor'\s*\?\s*companies|!== 'supervisor'\)\s*setCompanies|legacyRoleToSave === 'supervisor'/)
  assert.match(page, /\{legacyRoleToSave !== 'admin' && \(\s*<Field\s+label=\{t\('assignedCompanies'\)\}/)
  assert.match(page, /company_ids:\s+savedRole !== 'admin'/)
  assert.match(page, /\.\.\.\(user\.role !== 'admin'\s+\? \[\s+\{\s+key: 'assignedCompanies'/)
  const edge = read('supabase', 'functions', 'manage-user', 'index.ts')
  assert.match(edge, /if \(role !== 'admin' && companyIds\.length > 0\) \{/)
  assert.doesNotMatch(edge, /role === 'supervisor' && companyIds/)
  // New Arabic copy: plain alif only.
  const translations = read('src', 'i18n', 'translations.ts')
  const arabic = translations.slice(0, translations.indexOf('en: {'))
  for (const line of arabic.split('\n').filter((l) => /^\s+(companyNotInScope|assignedCompaniesHelp):/.test(l) || /لا يرى المستخدم الا بيانات هذه الشركات/.test(l)))
    assert.doesNotMatch(line, /[أإآ]/, line)
})
