const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// `companyProject.ts` is pure: its only import is a type, erased on transpile.
function loadCompanyProject() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'companyProject.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(
    code,
    {
      exports,
      require(request) {
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const { companyProjectNames } = loadCompanyProject()

const names = (lang, row) => ({ ...companyProjectNames(lang, row) })

const SITE_ROW = {
  company_id: 'c1',
  company_name_ar: 'شركة',
  company_name_en: 'Company',
  project_id: 'p1',
  project_name_ar: 'مشروع',
  project_name_en: 'Project',
}

test('the cell shows the company and the project in the interface language', () => {
  assert.deepEqual(names('ar', SITE_ROW), { company: 'شركة', project: 'مشروع' })
  assert.deepEqual(names('en', SITE_ROW), {
    company: 'Company',
    project: 'Project',
  })
})

test('a missing name falls back to the other language', () => {
  assert.deepEqual(
    names('en', { ...SITE_ROW, company_name_en: null, project_name_en: '  ' }),
    { company: 'شركة', project: 'مشروع' },
  )
})

test('only one side is returned when the row has only one', () => {
  assert.deepEqual(
    names('ar', { ...SITE_ROW, project_id: null, project_name_ar: null }),
    { company: 'شركة', project: null },
  )
  assert.deepEqual(names('ar', { ...SITE_ROW, company_id: null }), {
    company: null,
    project: 'مشروع',
  })
})

test('a workshop row has neither, so the cell shows its placeholder', () => {
  assert.deepEqual(names('ar', { company_id: null, project_id: null }), {
    company: null,
    project: null,
  })
  assert.deepEqual(names('ar', {}), { company: null, project: null })
  // An id whose record has no name at all is treated as missing too.
  assert.deepEqual(names('ar', { company_id: 'c1', project_id: 'p1' }), {
    company: null,
    project: null,
  })
})

test('the cell renders one line, two lines, or the muted dash', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'src',
      'components',
      'data-list',
      'CompanyProjectCell.tsx',
    ),
    'utf8',
  )
  assert.match(source, /const primary = company \?\? project/)
  assert.match(
    source,
    /if \(!primary\) return <span className="text-muted">—<\/span>/,
  )
  // The project is the second line only when there is a company above it.
  assert.match(source, /const secondary = company \? project : null/)
})
