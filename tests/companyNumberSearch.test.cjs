const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// «ترقيم الشركة» in the inquiry search (owner 2026-10-27: «خليه ترقيم اخر
// حركة مشروع»): a unit matches only on its latest project movement's
// company number. Made-up rows, no network.
const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

function load(name) {
  const file = path.join(root, 'src', 'lib', `${name}.ts`)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInContext(`(function (exports, require) {${output}\n})`, vm.createContext({}), {
    filename: file,
  })(exports, (requested) => {
    throw new Error(`Unexpected module: ${requested}`)
  })
  return exports
}

const search = load('companyNumberSearch')
const plain = (value) => JSON.parse(JSON.stringify(value))
const row = (equipment, code, at, id = `${equipment}-${at}`) => ({
  equipment_id: equipment,
  contractor_equipment_code: code,
  recorded_at: `2026-${at}T08:00:00+00:00`,
  id,
})

test('one candidate per unit: its newest matching project movement', () => {
  const candidates = search.companyNumberCandidates([
    row('a', 'CR-17', '10-20'),
    row('b', 'CR-170', '10-18'),
    row('a', 'CR-17', '05-01'),
  ])
  assert.deepEqual(
    plain(candidates.map((candidate) => [candidate.equipment_id, candidate.recorded_at.slice(5, 10)])),
    [
      ['a', '10-20'],
      ['b', '10-18'],
    ],
  )
})

test('a unit that moved on to another number no longer matches', () => {
  const candidates = [row('a', 'CR-17', '06-01'), row('b', 'cr-17', '07-01'), row('c', 'CR-17', '08-01')]
  const later = [
    // a: a newer project movement with another number.
    row('a', 'SAL-5', '09-01'),
    // b: its exit after the entry inherits the same number.
    row('b', 'CR-17', '07-20'),
  ]
  const matches = search.confirmLatestCompanyNumbers(candidates, later, 'cr-17')
  assert.deepEqual(plain([...matches.entries()]), [
    ['b', 'CR-17'],
    ['c', 'CR-17'],
  ])
})

test('the screen joins the matches and shows the number', () => {
  const screen = read('src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx')
  assert.match(screen, /fetchCompanyNumberMatches\(supabase, term, signal\)/)
  assert.match(screen, /\.\.\.previous\.ids, \.\.\.company\.matches\.keys\(\)/)
  assert.match(screen, /supervisor_name,contractor_equipment_code,driver_name,exit_purpose,driver_full_name'/)
  assert.match(screen, /key: 'companyNumber',/)
  const lib = read('src', 'lib', 'companyNumberSearch.ts')
  assert.match(lib, /\.eq\('movement_context', 'site'\)\s+\.ilike\('contractor_equipment_code'/)
  assert.match(read('src', 'components', 'inquiry', 'InquirySearch.tsx'), /suggestion\.matched_company_number/)
  assert.match(read('src', 'components', 'inquiry', 'InquiryNow.tsx'), /open\.entry\?\.contractor_equipment_code/)
})
