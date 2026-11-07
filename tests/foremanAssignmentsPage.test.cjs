const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// A foreman's projects (migration 0176) on the user page: owner 2026-11-05,
// «مانحتاج صفحة الاسنادات، نقدر نسويها في صفحة المستخدم نفسه، يكون حقل ثاني
// مشابه للشركات، والقائمة الي فيه هي المشاريع الي في الشركات المسنودة».
// The Settings page built the same day is gone; the movement form follows
// the projects.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const has = (text, piece) => assert.ok(text.includes(piece), piece)

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
    company_name_ar: 'ب',
    company_name_en: null,
    project_ids: ['p2', 'p1'],
    project_names_ar: ['مشروع 2', 'مشروع 1'],
    project_names_en: [null, 'P1'],
  },
  {
    profile_id: 'f1',
    company_id: 'c1',
    company_name_ar: 'ا',
    company_name_en: null,
    project_ids: [],
    project_names_ar: [],
    project_names_en: [],
  },
]

test('the saved projects come from the view, by name, with their companies', () => {
  const projects = lib.assignedProjectsOf(ROWS, 'ar')
  assert.deepEqual(plain(projects.map((p) => [p.value, p.label, p.company_ids])), [
    ['p1', 'مشروع 1', ['c2']],
    ['p2', 'مشروع 2', ['c2']],
  ])
  assert.equal(lib.assignedProjectsOf(ROWS, 'en')[0].label, 'P1')
  // A company taken off the field takes its projects with it.
  assert.deepEqual(plain(lib.projectsWithinCompanies(projects, ['c1'])), [])
  assert.equal(lib.projectsWithinCompanies(projects, ['c1', 'c2']).length, 2)
})

test('the 0176 tokens become safe messages', () => {
  assert.equal(lib.assignmentSaveMessage({ message: 'users_manage_required' }), 'foremanAssignmentsNotAllowed')
  assert.equal(lib.assignmentSaveMessage({ message: 'project_company_not_assigned' }), 'foremanAssignmentsProjectOutside')
  assert.equal(lib.assignmentSaveMessage({ message: 'invalid_project' }), 'foremanAssignmentsStale')
  assert.equal(lib.assignmentSaveMessage({ message: 'boom' }), 'userProjectsSaveFailed')
})

test('the movement form scope: whole companies and narrowed projects', () => {
  assert.deepEqual(plain(lib.projectScopeOf(ROWS)), {
    wholeCompanyIds: ['c1'],
    projectIds: ['p2', 'p1'],
  })
  has(read('src', 'components', 'movement', 'useMovementFormOptions.ts'), 'projectScopeOf(rows)')
})

test('the user page: a projects field under the companies, saved in one call', () => {
  const page = read('src', 'screens', 'UserDetail.tsx')
  has(page, "label={t('assignedProjects')}")
  has(page, '{companiesApply && companies.length > 0 && (')
  // Its options are the projects of the chosen companies (server side, 20).
  has(page, 'companiesProjectLoader(')
  const loader = read('src', 'lib', 'foremanAssignments.ts')
  has(loader, ".in('company_projects.company_id', Array.from(companyIds))")
  has(loader, '.limit(20)')
  // Read from the view, written by the 0176 function, apart from manage-user.
  has(page, ".from('profile_assignments')")
  has(page, "'admin_set_profile_assignments'")
  has(page, 'setError(t(assignmentSaveMessage(projectsError)))')
  // A projects-only change does not rewrite the record through manage-user.
  has(page, '!mobileChanged && !assignStep && !projectsChanged')
  // Removing a company drops its projects; the field follows the companies.
  has(page, 'projectsWithinCompanies(')
  has(page, 'key={companyIdsKey}')
  // A failed read locks the field and offers a retry, never an empty list.
  has(page, "disabled={projectsState !== 'loaded'}")
  has(page, "t('assignedProjectsLoadError')")
  has(page, "key: 'assignedProjects'")
})

test('a later save never drops the projects (owner 2026-11-07, «تختفي المشاريع»)', () => {
  // manage-user changes only the companies that changed: deleting every
  // link fired the 0176 prune trigger, which removed all the projects.
  const fn = read('supabase', 'functions', 'manage-user', 'index.ts')
  assert.match(fn, /const removedIds = \[\.\.\.currentIds\]\.filter\(\(id\) => !keptIds\.has\(id\)\)/)
  assert.match(fn, /const addedIds = companyIds\.filter\(\(id\) => !currentIds\.has\(id\)\)/)
  assert.match(fn, /\.delete\(\)\s*\.eq\('profile_id', userId\)\s*\.in\('company_id', removedIds\)/)
  assert.doesNotMatch(fn, /\.delete\(\)\s*\.eq\('profile_id', userId\)\s*if/)
  // The user page writes the projects again after every save of the record
  // with the companies field, and saves nothing while nothing changed.
  const page = read('src', 'screens', 'UserDetail.tsx')
  assert.match(
    page,
    /const rewriteProjects =\s+saveMain && companiesApply && projectsState === 'loaded'\s+if \(projectsChanged \|\| rewriteProjects\) \{/,
  )
  assert.match(page, /disabled=\{!hasUnsavedChanges\}\s+onClick=\{handleSave\}/)
})

test('the Settings page is gone', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'components', 'foremanAssignments')))
  for (const file of [
    ['src', 'screens', 'AdminSettings.tsx'],
    ['src', 'lib', 'navPermissions.ts'],
    ['src', 'lib', 'pageTitle.ts'],
    ['src', 'App.tsx'],
  ])
    assert.doesNotMatch(read(...file), /foreman-assignments/)
})

test('the copy, both languages, no hamza on the alif', () => {
  const tr = read('src', 'i18n', 'translations.ts')
  const blocks = tr.match(/\/\/ foreman assignments — start[\s\S]*?\/\/ foreman assignments — end/g)
  assert.equal(blocks.length, 2)
  assert.doesNotMatch(blocks[0], /[أإآ]/)
  const keys = (block) => [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort()
  assert.deepEqual(keys(blocks[0]), keys(blocks[1]))
})
