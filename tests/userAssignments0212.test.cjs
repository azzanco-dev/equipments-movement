const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// «اسناد الشركات والمشاريع» as a task of its own (migration 0212, owner
// 2026-11-24: «نبغى نخلي اسنادات الشركات والمشاريع للمستخدمين مهمة منفصلة عن
// صفحة المستخدم، لانها ممكن تنسند لادوار غير الادمن»; design approved in
// Figma, «اعتمد وابني»): a Settings page over the view user_assignment_list,
// the key users.assignments, one dialog shared with the user page.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const plain = (value) => JSON.parse(JSON.stringify(value))
const MIGRATION = read(
  'supabase',
  'migrations',
  '20261124100000_0212_user_assignments_permission.sql',
)

const lib = (() => {
  const source = path.join(ROOT, 'src', 'lib', 'foremanAssignments.ts')
  const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    Map,
    Set,
    Array,
    require(request) {
      if (request === '@/lib/localizedName')
        return {
          localizedName: (lang, ar, en) => (lang === 'en' && en ? en : ar),
        }
      return {}
    },
  })
  return exports
})()

test('0212: the key, held by the admin, not admin only', () => {
  assert.match(
    MIGRATION,
    /'users\.assignments', 'users',\s+'المستخدمون: اسناد الشركات والمشاريع'/,
  )
  assert.match(MIGRATION, /false, NULL, '\{\}', false, 'database', 715/)
  assert.match(
    MIGRATION,
    /VALUES \('admin', 'users\.assignments', NULL\)\s+ON CONFLICT \(role_key, permission_key\) DO NOTHING/,
  )
  assert.match(MIGRATION, /users\.assignments must not be admin only/)
})

test('0212: the writer takes either key and locks the own and the admin accounts', () => {
  const body = MIGRATION.slice(
    MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.admin_set_profile_assignments('),
    MIGRATION.indexOf('REVOKE ALL ON FUNCTION public.admin_set_profile_assignments'),
  )
  assert.match(
    body,
    /public\.has_permission\('users\.manage'\) IS NOT TRUE\s+AND public\.has_permission\('users\.assignments'\) IS NOT TRUE/,
  )
  assert.match(body, /RAISE EXCEPTION 'users_manage_required'/)
  assert.match(
    body,
    /v_caller_admin := public\.is_admin\(\) IS TRUE\s+AND public\.has_permission\('settings\.roles'\) IS TRUE/,
  )
  assert.match(body, /IF p_profile_id = auth\.uid\(\) THEN\s+RAISE EXCEPTION 'cannot_change_own_assignments' USING ERRCODE = '55000'/)
  assert.match(body, /IF public\.profile_is_admin_user\(p_profile_id\) THEN\s+RAISE EXCEPTION 'admin_role_admin_only' USING ERRCODE = '42501'/)
  // The guards come after the row lock and before anything is written.
  assert.ok(body.indexOf('FOR UPDATE') < body.indexOf('cannot_change_own_assignments'))
  assert.ok(body.indexOf('cannot_change_own_assignments') < body.indexOf('INSERT INTO public.profile_companies'))
  // 0176 verbatim otherwise: the same checks and the same order of writes.
  for (const token of ['invalid_profile', 'invalid_company', 'invalid_project', 'project_company_not_assigned'])
    assert.ok(body.includes(`'${token}'`), token)
  assert.match(MIGRATION, /REVOKE ALL ON FUNCTION public\.admin_set_profile_assignments\(uuid, uuid\[\], uuid\[\]\) FROM PUBLIC, anon;/)
  assert.match(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.admin_set_profile_assignments\(uuid, uuid\[\], uuid\[\]\) TO authenticated;/)
})

test('0212: the view returns rows only to the two keys, never an admin', () => {
  const view = MIGRATION.slice(
    MIGRATION.indexOf('CREATE OR REPLACE VIEW public.user_assignment_list'),
    MIGRATION.indexOf('REVOKE ALL ON public.user_assignment_list'),
  )
  assert.match(view, /WITH \(security_invoker = false\)/)
  assert.match(view, /WHERE pr\.role_key IS DISTINCT FROM 'admin'/)
  assert.match(
    view,
    /\(SELECT public\.has_permission\('users\.manage'\)\)\s+OR \(SELECT public\.has_permission\('users\.assignments'\)\)/,
  )
  assert.match(view, /rp\.permission_key = 'movements\.site\.create'/)
  assert.match(MIGRATION, /REVOKE ALL ON public\.user_assignment_list FROM PUBLIC, anon;/)
  assert.match(MIGRATION, /GRANT SELECT ON public\.user_assignment_list TO authenticated;/)
  // Every column the screen selects is a column of the view.
  for (const column of lib.USER_ASSIGNMENT_LIST_SELECT.split(','))
    assert.match(view, new RegExp(`(AS |\\.)${column}[,\\n]`), column)
  // The search column exists too.
  assert.match(view, /AS full_name_search/)
  // No policy of an existing table is widened.
  assert.doesNotMatch(MIGRATION, /CREATE POLICY|DROP POLICY/)
})

test('the lock rule: the admin edits anyone, nobody else his own or an admin', () => {
  const lock = (callerIsAdmin, callerId, targetId, targetIsAdmin) =>
    lib.assignmentsLockOf({ callerIsAdmin, callerId, targetId, targetIsAdmin })
  assert.equal(lock(true, 'a', 'a', true), null)
  assert.equal(lock(false, 'a', 'a', false), 'own')
  assert.equal(lock(false, 'a', 'b', true), 'admin')
  assert.equal(lock(false, 'a', 'b', false), null)
  const can = (keys) => (key) => keys.includes(key)
  assert.equal(lib.canManageAssignments(can(['users.manage'])), true)
  assert.equal(lib.canManageAssignments(can(['users.assignments'])), true)
  assert.equal(lib.canManageAssignments(can(['users.read'])), false)
})

test('the 0212 tokens become their own messages', () => {
  assert.equal(lib.assignmentSaveMessage({ message: 'cannot_change_own_assignments', code: '55000' }), 'userAssignmentsOwnLocked')
  assert.equal(lib.assignmentSaveMessage({ message: 'admin_role_admin_only', code: '42501' }), 'userAssignmentsAdminLocked')
  assert.equal(lib.assignmentSaveMessage({ message: 'users_manage_required', code: '42501' }), 'foremanAssignmentsNotAllowed')
})

test('rows ↔ dialog values: companies by name, projects under their company', () => {
  const rows = [
    {
      company_id: 'c1',
      company_name_ar: 'ب',
      company_name_en: 'B',
      project_ids: ['p2', 'p1'],
      project_names_ar: ['مشروع 2', 'مشروع 1'],
      project_names_en: [null, 'P1'],
    },
    {
      company_id: 'c2',
      company_name_ar: 'ا',
      company_name_en: null,
      project_ids: [],
      project_names_ar: [],
      project_names_en: [],
    },
  ]
  const value = lib.assignmentsFromRows(rows, 'ar')
  assert.deepEqual(plain(value.companies.map((c) => [c.value, c.label])), [
    ['c1', 'ب'],
    ['c2', 'ا'],
  ])
  assert.deepEqual(plain(value.projects.map((p) => p.value)), ['p1', 'p2'])
  const back = plain(lib.rowsFromAssignments(value))
  assert.deepEqual(back.map((row) => row.company_id), ['c2', 'c1'])
  assert.deepEqual(back[1].project_ids, ['p1', 'p2'])
  assert.deepEqual(back[0].project_ids, [])
  // The change key ignores the order.
  assert.equal(
    lib.assignmentsKey(value),
    lib.assignmentsKey({
      companies: [...value.companies].reverse(),
      projects: [...value.projects].reverse(),
    }),
  )
})

test('the page: Settings card and route, gates, trail and title', () => {
  const nav = read('src', 'lib', 'navPermissions.ts')
  assert.match(
    nav,
    /'settings\/assignments': \[\s+\{ key: 'users\.manage' \},\s+\{ key: 'users\.assignments' \},\s+\]/,
  )
  assert.match(nav, /\{ key: 'users\.manage' \},\s+\{ key: 'users\.assignments' \},\s+\],\s+\},\s+\]/)
  const settings = read('src', 'screens', 'AdminSettings.tsx')
  assert.match(settings, /const showAssignments = pathname === '\/settings\/assignments'/)
  assert.match(settings, /\{opens\('settings\/assignments'\) && \(/)
  assert.match(settings, /router\.push\('\/settings\/assignments'\)/)
  assert.match(settings, /<UserAssignmentsSettings \/>/)
  assert.match(read('src', 'lib', 'pageTrail.ts'), /'settings\/assignments': \{ parents: \[SETTINGS\], name: 'userAssignments' \}/)
  assert.match(read('src', 'lib', 'pageTitle.ts'), /'settings\/assignments': \{\s+kind: 'sub',\s+name: 'userAssignments'/)
})

test('the list: the view, the overlap company filter, the default filter', () => {
  const screen = read('src', 'components', 'assignments', 'UserAssignmentsSettings.tsx')
  assert.match(screen, /\.from\('user_assignment_list'\)/)
  assert.match(screen, /query\.overlaps\('company_ids', companies\)/)
  assert.match(screen, /\.filter\(\(key\) => !USER_ASSIGNMENT_COLUMN_FILTERS\.has\(key\)\)/)
  assert.match(screen, /<ErrorState\s+description=\{t\('userAssignmentsLoadError'\)\}/)
  assert.match(screen, /className="hidden md:block"/)
  assert.match(screen, /className="space-y-3 md:hidden"/)
  const configs = read('src', 'lib', 'listConfigs.ts')
  assert.match(configs, /defaultFilters: \[USER_ASSIGNMENTS_DEFAULT_FILTER\]/)
  assert.match(configs, /field: 'records_projects',\s+operator: 'eq',\s+value: 'true'/)
})

test('the user page: the summary, the dialog, no fields in the form', () => {
  const page = read('src', 'screens', 'UserDetail.tsx')
  assert.match(page, /<AssignmentLines rows=\{assignmentRows\} \/>/)
  assert.match(page, /<UserAssignmentsDialog/)
  assert.match(page, /\{t\('userAssignmentsEdit'\)\}/)
  assert.doesNotMatch(page, /label=\{t\('assignedCompanies'\)\}/)
  assert.doesNotMatch(page, /label=\{t\('assignedProjects'\)\}/)
  // The role no longer clears the companies.
  assert.doesNotMatch(page, /changeCompanies\(\[\]\)/)
})

test('the copy, both languages, no hamza on the alif', () => {
  const tr = read('src', 'i18n', 'translations.ts')
  const blocks = tr.match(/\/\/ user assignments — start[\s\S]*?\/\/ user assignments — end/g)
  assert.equal(blocks.length, 2)
  assert.doesNotMatch(blocks[0], /[أإآ]/)
  const keys = (block) => [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort()
  assert.deepEqual(keys(blocks[0]), keys(blocks[1]))
  assert.doesNotMatch(MIGRATION.match(/'المستخدمون:[^']*'/)[0], /[أإآ]/)
})
