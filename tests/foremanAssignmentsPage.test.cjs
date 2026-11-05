const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Settings › «اسنادات الفورمينات» (owner 2026-11-05, «ابدا في صفحة
// الاسنادات») over migration 0176, and the movement form's project scope.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

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

const plain = (value) => JSON.parse(JSON.stringify(value))

const ROWS = [
  {
    profile_id: 'f1',
    company_id: 'c2',
    company_name_ar: 'ب شركة',
    company_name_en: 'B Co',
    project_ids: ['p1', 'p2'],
    project_names_ar: ['مشروع 1', 'مشروع 2'],
    project_names_en: ['P1', null],
  },
  {
    profile_id: 'f1',
    company_id: 'c1',
    company_name_ar: 'ا شركة',
    company_name_en: null,
    project_ids: [],
    project_names_ar: [],
    project_names_en: [],
  },
  {
    profile_id: 'f2',
    company_id: 'c1',
    company_name_ar: 'ا شركة',
    company_name_en: null,
    project_ids: [],
    project_names_ar: [],
    project_names_en: [],
  },
]

test('the view rows become one foreman’s companies with their projects', () => {
  const groups = lib.groupAssignments(ROWS)
  assert.equal(groups.get('f1').length, 2)
  assert.equal(groups.get('f2').length, 1)
  assert.deepEqual(plain(lib.assignmentsOf(groups.get('f1'), 'ar')), [
    { company: { value: 'c1', label: 'ا شركة' }, projects: [] },
    {
      company: { value: 'c2', label: 'ب شركة' },
      projects: [
        { value: 'p1', label: 'مشروع 1' },
        { value: 'p2', label: 'مشروع 2' },
      ],
    },
  ])
  // English falls back to the Arabic name where there is no English one.
  assert.equal(lib.assignmentsOf(groups.get('f1'), 'en')[1].projects[1].label, 'مشروع 2')
})

test('one save call carries every company and the narrowed projects once', () => {
  const items = lib.assignmentsOf(lib.groupAssignments(ROWS).get('f1'), 'ar')
  assert.deepEqual(plain(lib.assignmentPayload('f1', [...items, items[1]])), {
    p_profile_id: 'f1',
    p_company_ids: ['c1', 'c2'],
    p_project_ids: ['p1', 'p2'],
  })
  // A kept company keeps its projects, a new one starts with all of them,
  // a removed one leaves with its projects.
  const next = lib.withCompanies(items, [items[1].company, { value: 'c3', label: 'ج' }])
  assert.deepEqual(plain(next.map((item) => [item.company.value, item.projects.length])), [
    ['c2', 2],
    ['c3', 0],
  ])
})

test('the 0176 tokens become safe messages', () => {
  assert.equal(lib.assignmentSaveMessage({ message: 'users_manage_required' }), 'foremanAssignmentsNotAllowed')
  assert.equal(lib.assignmentSaveMessage({ code: '23503', message: 'project_company_not_assigned' }), 'foremanAssignmentsProjectOutside')
  assert.equal(lib.assignmentSaveMessage({ message: 'invalid_project' }), 'foremanAssignmentsStale')
  assert.equal(lib.assignmentSaveMessage({ message: 'boom' }), 'saveFailed')
})

test('the movement form scope: whole companies and narrowed projects', () => {
  assert.deepEqual(plain(lib.projectScopeOf(ROWS.slice(0, 2))), {
    wholeCompanyIds: ['c1'],
    projectIds: ['p1', 'p2'],
  })
  const hook = read('src', 'components', 'movement', 'useMovementFormOptions.ts')
  assert.match(hook, /projectScopeOf\(/)
})

test('the page: Settings card and route on users.manage, one bounded read per page', () => {
  const settings = read('src', 'screens', 'AdminSettings.tsx')
  assert.match(settings, /\{opens\('settings\/foreman-assignments'\) && \(/)
  assert.match(settings, /<ForemanAssignmentsSettings \/>/)
  assert.match(read('src', 'lib', 'navPermissions.ts'), /'settings\/foreman-assignments': \[\{ key: 'users\.manage' \}\]/)
  const page = read('src', 'components', 'foremanAssignments', 'ForemanAssignmentsSettings.tsx')
  assert.match(page, /foremanRoleKeys\(supabase\)/)
  assert.match(page, /\.from\('profile_names'\)\s+\.select\('id,full_name', \{ count: 'exact' \}\)\s+\.in\('role', roleKeys\)/)
  assert.match(page, /\.range\(/)
  assert.match(page, /\.from\('profile_assignments'\)\s+\.select\(PROFILE_ASSIGNMENTS_SELECT\)\s+\.in\(/)
  assert.match(page, /<ErrorState description=\{loadError\} onRetry=\{fetchRows\} \/>/)
  const dialog = read('src', 'components', 'foremanAssignments', 'ForemanAssignmentDialog.tsx')
  assert.match(dialog, /supabase\.rpc\(\s+'admin_set_profile_assignments',\s+assignmentPayload\(foreman\.id, items\),?\s+\)/)
  assert.match(dialog, /t\(assignmentSaveMessage\(saveError\)\)/)
  // Every picker is server-side, 20 at most.
  const loaders = read('src', 'lib', 'foremanAssignments.ts')
  assert.equal(loaders.match(/\.limit\(20\)/g).length, 2)
  assert.match(loaders, /\.eq\('company_projects\.company_id', companyId\)/)
})

test('the new copy, both languages, no hamza on the alif', () => {
  const tr = read('src', 'i18n', 'translations.ts')
  assert.equal(tr.match(/\/\/ foreman assignments — start/g).length, 2)
  const ar = /\/\/ foreman assignments — start[\s\S]*?\/\/ foreman assignments — end/.exec(tr)[0]
  assert.doesNotMatch(ar, /[أإآ]/)
})
