// Roles stage 4c-2 (owner 2026-10-27, «اهم شي مايتغير شي على المستخدمين»):
// migration 0156 drops profiles.role and everything that still mentioned it,
// with no change for anybody. The Edge Functions and the screens stop
// reading or sending it first.
//
// Source checks only (no database connection).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const MIGRATIONS = path.join(root, 'supabase', 'migrations')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')
const MIGRATION = '20261028110000_0156_drop_legacy_role.sql'
const sql = read('supabase', 'migrations', MIGRATION)
const code = sql.replace(/--[^\n]*/g, '')
const flat = code.replace(/\s+/g, ' ')

// --- The functions 0156 re-creates, and where their previous body lives -----

const RECREATED = {
  change_active_movement_driver: '0127',
  classify_workshop_entry: '0127',
  enforce_site_entry_driver: '0127',
  enforce_site_exit_purpose: '0127',
  get_last_movement: '0127',
  prepare_movement_exit_notice: '0127',
  quick_create_driver: '0127',
  quick_create_foreman_equipment: '0127',
  quick_create_lessor_by_name: '0127',
  quick_create_workshop_equipment: '0135',
  request_workshop_arrival_notice: '0127',
  search_entry_equipment: '0127',
  search_site_exit_equipment: '0127',
  search_workshop_equipment: '0127',
  update_entry_contractor_code: '0127',
  get_admin_availability_by_type: '0127',
  get_admin_entries_series: '0127',
  get_admin_entries_yearly: '0127',
  get_admin_fleet_equipment: '0127',
  get_admin_fleet_state: '0127',
  get_admin_foreman_discipline: '0127',
  get_admin_foreman_recent_movements: '0127',
  get_admin_owner_state_matrix: '0127',
}

const DROPPED = [
  'set_roles_system_enabled_0126(boolean, integer)',
  'admin_roles_system_offenders()',
  'admin_roles_system_preview()',
  'legacy_role_permissions(text)',
  'current_user_role()',
]

const files = fs
  .readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()

/** Every `CREATE [OR REPLACE] FUNCTION public.<name>(` statement of a text,
 *  up to the `$$;` that closes its body. */
function definitions(text, name) {
  const out = []
  const re = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`,
    'g',
  )
  for (const match of text.matchAll(re)) {
    const open = text.indexOf('$$', match.index)
    const close = text.indexOf('$$;', open + 2)
    out.push(text.slice(match.index, close + 3))
  }
  return out
}

/** The last definition of `name` in the migrations before 0156. */
function previousDefinition(name) {
  for (const file of files.slice(0, files.indexOf(MIGRATION)).reverse()) {
    const found = definitions(
      fs.readFileSync(path.join(MIGRATIONS, file), 'utf8').replace(/\r\n/g, '\n'),
      name,
    )
    if (found.length) return { file, text: found[found.length - 1] }
  }
  return null
}

/** The previous body without the legacy role read, as 0156 must carry it. */
function withoutRoleRead(text) {
  return text
    .replace(/^\s*v_role text( := public\.current_user_role\(\))?;\n/m, '')
    .replace(
      /^\s*SELECT (p\.)?role INTO v_role FROM public\.profiles( p)? WHERE (p\.)?id = auth\.uid\(\);\n/m,
      '',
    )
    .replace(
      /^\s*SELECT p\.role INTO v_role\n\s*FROM public\.profiles p\n\s*WHERE p\.id = auth\.uid\(\);\n/m,
      '',
    )
    .replace(
      'AND v_role IS NOT NULL',
      'AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid())',
    )
    .replace(/\bDECLARE\s+BEGIN\b/, 'BEGIN')
}

const normalise = (text) => text.replace(/\s+/g, ' ').trim()

// --- The guard regex of section G, mirrored in JavaScript --------------------

const stripCode = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'/g, '')
const DROPPED_NAMES =
  /\b(current_user_role|legacy_role_permissions|admin_roles_system_offenders|admin_roles_system_preview|set_roles_system_enabled_0126)\b/i
const guardHits = (body) =>
  /\brole\b/i.test(stripCode(body)) || DROPPED_NAMES.test(stripCode(body))
const bodyOf = (definition) => {
  const open = definition.indexOf('$$')
  return definition.slice(open + 2, definition.lastIndexOf('$$'))
}

// --- Tests ---------------------------------------------------------------------

test('0156 follows 0155', () => {
  assert.match(files[files.indexOf(MIGRATION) - 1], /_0155_/)
})

test('the start guard: the system is on, every legacy admin holds an assignment', () => {
  const guard = flat.slice(0, flat.indexOf('CREATE OR REPLACE FUNCTION'))
  assert.match(guard, /^ ?DO \$\$/)
  assert.match(guard, /IF NOT public\.roles_system_enabled\(\) THEN RAISE EXCEPTION/)
  assert.match(
    guard,
    /FROM public\.profiles p WHERE p\.role = 'admin' AND NOT EXISTS \( SELECT 1 FROM public\.profile_roles pr WHERE pr\.profile_id = p\.id \);/,
  )
  assert.match(guard, /IF v_missing > 0 THEN RAISE EXCEPTION/)
  assert.match(
    guard,
    /IF NOT EXISTS \( SELECT 1 FROM public\.profile_roles pr WHERE pr\.role_key = 'admin' \) THEN RAISE EXCEPTION/,
  )
})

test('the check, the index and the column are dropped after everything else', () => {
  const dropCheck = flat.indexOf(
    'ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;',
  )
  const dropIndex = flat.indexOf('DROP INDEX IF EXISTS public.idx_profiles_role;')
  const dropColumn = flat.indexOf('ALTER TABLE public.profiles DROP COLUMN role;')
  assert.ok(dropCheck > 0 && dropIndex > dropCheck && dropColumn > dropIndex)
  // Nothing is created after the column goes, but the final guard.
  const after = flat.slice(dropColumn)
  assert.doesNotMatch(after, /CREATE (OR REPLACE )?FUNCTION/)
  assert.match(after, /DO \$\$/)
  // Never CASCADE: a view or policy still using the column must stop it.
  assert.doesNotMatch(flat, /CASCADE/)
  // The flag is never written.
  assert.doesNotMatch(flat, /UPDATE public\.app_settings|INSERT INTO public\.app_settings/)
})

test('exactly the expected functions are re-created, each from its previous body minus the role read', () => {
  const created = [
    ...code.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(/g),
  ].map((m) => m[1])
  assert.deepEqual(
    created.sort(),
    [...Object.keys(RECREATED), 'handle_new_user', 'set_roles_system_enabled'].sort(),
  )
  for (const [name, source] of Object.entries(RECREATED)) {
    const previous = previousDefinition(name)
    assert.ok(previous, name)
    assert.match(previous.file, new RegExp(`_${source}_`), `${name} source`)
    // The header comment names the same source.
    assert.match(sql, new RegExp(`-- ${name} — latest ${source}\\.\\n`), name)
    const [now] = definitions(sql, name)
    assert.ok(now, name)
    assert.equal(
      normalise(now),
      normalise(withoutRoleRead(previous.text)),
      `${name} is its ${source} body minus the role read`,
    )
    // And that previous body really had a role read to remove.
    assert.notEqual(normalise(previous.text), normalise(now), name)
    assert.doesNotMatch(now, /\bv_role\b|current_user_role|\.role\b/, name)
  }
})

test('prepare_movement_exit_notice keeps "the caller has a profile"', () => {
  const [now] = definitions(sql, 'prepare_movement_exit_notice')
  assert.match(
    now,
    /v_allowed := FOUND\n\s+AND auth\.uid\(\) IS NOT NULL\n\s+AND EXISTS \(SELECT 1 FROM public\.profiles p WHERE p\.id = auth\.uid\(\)\)\n/,
  )
})

test('every re-created SECURITY DEFINER keeps its fixed search_path', () => {
  for (const name of Object.keys(RECREATED)) {
    const [now] = definitions(sql, name)
    const previous = previousDefinition(name).text
    for (const clause of [/SECURITY (DEFINER|INVOKER)/, /SET search_path = [^\n]+/]) {
      assert.equal(now.match(clause)?.[0], previous.match(clause)?.[0], name)
    }
  }
})

test('new accounts get a profile without a role', () => {
  const [fn] = definitions(sql, 'handle_new_user')
  assert.match(
    normalise(fn),
    /INSERT INTO public\.profiles\(id, full_name\) VALUES \( NEW\.id, COALESCE\(NEW\.raw_user_meta_data->>'full_name', NEW\.email\) \);/,
  )
  assert.doesNotMatch(fn, /\brole\b|raw_app_meta_data/)
  assert.match(fn, /SECURITY DEFINER\nSET search_path = public\n/)
  assert.match(
    flat,
    /REVOKE ALL ON FUNCTION public\.handle_new_user\(\) FROM PUBLIC, anon, authenticated;/,
  )
})

test('set_roles_system_enabled keeps its gate and its refusal, and answers the same shape', () => {
  const [fn] = definitions(sql, 'set_roles_system_enabled')
  const body = normalise(fn)
  assert.match(
    body,
    /IF auth\.uid\(\) IS NULL OR public\.is_admin\(\) IS NOT TRUE OR public\.has_permission\('settings\.roles'\) IS NOT TRUE THEN RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501'/,
  )
  assert.match(
    body,
    /IF p_enabled IS NOT TRUE THEN RAISE EXCEPTION 'roles_system_permanent' USING ERRCODE = '55000'/,
  )
  assert.match(
    body,
    /RETURN jsonb_build_object\( 'enabled', public\.roles_system_enabled\(\), 'changed', false, 'reason', NULL, 'offenders', '\[\]'::jsonb, 'preview_rows', NULL \);/,
  )
  assert.doesNotMatch(fn, /_0126|app_settings|offenders\(\)|preview\(\)/)
  assert.match(
    flat,
    /REVOKE ALL ON FUNCTION public\.set_roles_system_enabled\(boolean, integer\) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\.set_roles_system_enabled\(boolean, integer\) TO authenticated;/,
  )
})

test('what only served the legacy column is dropped', () => {
  for (const signature of DROPPED)
    assert.ok(
      flat.includes(`DROP FUNCTION IF EXISTS public.${signature};`),
      signature,
    )
  // Dropped after the wrapper stopped calling the renamed 0126 body.
  assert.ok(
    flat.indexOf('DROP FUNCTION IF EXISTS public.set_roles_system_enabled_0126') >
      flat.indexOf('CREATE OR REPLACE FUNCTION public.set_roles_system_enabled('),
  )
})

test('the end guard scans functions, views and policies with the mirrored regex', () => {
  const guard = sql.slice(sql.indexOf('-- G. Guard'))
  assert.match(guard, /column_name = 'role'/)
  // The exact patterns mirrored by `stripCode` / `guardHits` above.
  assert.ok(guard.includes("regexp_replace(f.prosrc, '--[^\\n]*', '', 'g')"))
  assert.ok(guard.includes("'/\\*.*?\\*/', '', 'g'"))
  assert.ok(guard.includes("'''[^'']*''', '', 'g'"))
  assert.ok(guard.includes("s.code ~* '\\yrole\\y'"))
  assert.ok(
    guard.includes(
      "s.code ~* '\\y(current_user_role|legacy_role_permissions|admin_roles_system_offenders|admin_roles_system_preview|set_roles_system_enabled_0126)\\y'",
    ),
  )
  assert.match(guard, /n\.nspname = 'public'/)
  assert.match(guard, /l\.lanname IN \('plpgsql', 'sql'\)/)
  assert.match(guard, /FROM pg_views v/)
  assert.ok(guard.includes("'\\yAS\\s+role\\y', '', 'gi'"))
  assert.match(guard, /FROM pg_policies p/)
})

test('the guard regex flags every previous body and none of the new ones', () => {
  for (const name of Object.keys(RECREATED)) {
    assert.equal(guardHits(bodyOf(previousDefinition(name).text)), true, name)
    assert.equal(guardHits(bodyOf(definitions(sql, name)[0])), false, name)
  }
  for (const name of ['handle_new_user', 'current_user_role', 'set_roles_system_enabled'])
    assert.equal(guardHits(bodyOf(previousDefinition(name).text)), true, name)
  for (const name of ['handle_new_user', 'set_roles_system_enabled'])
    assert.equal(guardHits(bodyOf(definitions(sql, name)[0])), false, name)
  // No false positive on role_key, roles, v_role of type roles, p_role_key,
  // or messages such as 'foreman role required'.
  for (const name of [
    'admin_assign_profile_role',
    'admin_upsert_role',
    'admin_delete_role',
    'admin_set_role_permissions',
    'permission_scope',
    'current_permissions',
    'is_admin',
    'enforce_movement_sequence',
  ]) {
    const previous = previousDefinition(name)
    assert.ok(previous, name)
    assert.equal(guardHits(bodyOf(previous.text)), false, name)
  }
  assert.equal(guardHits("RAISE EXCEPTION 'foreman role required';"), false)
  assert.equal(guardHits('SELECT p.role INTO v_x FROM public.profiles p;'), true)
  assert.equal(guardHits('INSERT INTO public.profiles(id, full_name, role)'), true)
  assert.equal(guardHits('-- profiles.role was here\nSELECT 1;'), false)
})

test('the migration parses as plain SQL statements in order', () => {
  // A cheap sanity check; the libpg-query parse runs outside the repo.
  assert.equal((sql.match(/^DO \$\$$/gm) ?? []).length, 2)
  assert.ok(sql.trimEnd().endsWith('$$;'))
})

// --- Edge Functions ------------------------------------------------------------

test('manage-user no longer selects the role; create-user sends none', () => {
  const manage = read('supabase', 'functions', 'manage-user', 'index.ts')
  assert.match(
    manage,
    /\.select\('id,full_name,created_at,must_change_password'\)/,
  )
  assert.doesNotMatch(manage, /full_name,role|'role'|\.role\b|body\.role/)
  const create = read('supabase', 'functions', 'create-user', 'index.ts')
  assert.match(create, /app_metadata: \{ admin_created: true \}/)
  assert.doesNotMatch(create, /role: 'monitor'/)
})

// --- The client ----------------------------------------------------------------

const OUT_OF_SCOPE = [
  /^src\/screens\/Extracting\.tsx$/,
  /^src\/components\/extracting\//,
  /^src\/lib\/extracting\//,
  /^app\/api\/extracting\//,
  /^app\/components\/page\.tsx$/,
  /^app\/po-test\//,
  /^app\/design-lab\//,
  // The /ui-kit mockups keep their own sample data.
  /^src\/screens\/ui-kit\//,
]

function sourceFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel)
  }
  return out
}

test('nothing in src/ or app/ reads the legacy role', () => {
  const LEGACY = [
    /\b(profile|user|loadedUser|currentUser|callerProfile|targetProfile)\??\.role\b/,
    /Profile\['role'\]/,
    /full_name,role\b|,role,/,
    /\b(legacyRoleFor|legacyRoleAfter|legacyRoleChangeBlocked|NARROWEST_LEGACY_ROLE)\b/,
    /'(admin_roles_system_offenders|admin_roles_system_preview|current_user_role|legacy_role_permissions|set_roles_system_enabled)'/,
  ]
  const checked = [...sourceFiles('src'), ...sourceFiles('app')].filter(
    (file) => !OUT_OF_SCOPE.some((pattern) => pattern.test(file)),
  )
  assert.ok(checked.length > 100)
  for (const file of checked) {
    // `profile_names.role` is the ASSIGNED role since 0152, not the column.
    const source = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/profile_names[!\w]*\([^)]*\)/g, '')
    for (const pattern of LEGACY)
      assert.doesNotMatch(source, pattern, `${file} reads the legacy role`)
  }
})

test('the profile type keeps an optional, deprecated role for the extracting screen only', () => {
  const types = read('src', 'lib', 'types.ts')
  const profile = types.slice(
    types.indexOf('export interface Profile {'),
    types.indexOf('}', types.indexOf('export interface Profile {')),
  )
  assert.match(profile, /@deprecated[\s\S]*role\?: string/)
  assert.doesNotMatch(profile, /role: UserRole/)
  assert.doesNotMatch(types, /RolesSystemOffender|RolesSystemToggleResult/)
  // The profile is read without naming the column.
  const auth = read('src', 'auth', 'AuthContext.tsx')
  assert.doesNotMatch(auth, /select\([^)]*\brole\b/)
})

test('the user forms validate a chosen role key, not a legacy value', () => {
  const forms = read('src', 'lib', 'formValidation.ts')
  const add = forms.slice(forms.indexOf('export const userFormSchema'))
  assert.match(
    add.slice(0, add.indexOf('})')),
    /role: requiredText\('userRoleRequired'\),/,
  )
  const edit = forms.slice(forms.indexOf('export const userEditFormSchema'))
  assert.match(edit.slice(0, edit.indexOf('})')), /role: z\.string\(\),/)
  const userForm = read('src', 'lib', 'userForm.ts')
  assert.match(userForm, /export interface UserFormValues \{[\s\S]*?role: string\n/)
  assert.match(userForm, /export interface UserEditFormValues \{[\s\S]*?role: string\n/)
  assert.match(userForm, /export function roleBadge\(roleKey: string\)/)
  const translations = read('src', 'i18n', 'translations.ts')
  const keys = translations.match(/^ {4}userRoleRequired: '[^']+',$/gm) ?? []
  assert.equal(keys.length, 2)
  assert.doesNotMatch(keys[0], /[أإآ]/)
})
