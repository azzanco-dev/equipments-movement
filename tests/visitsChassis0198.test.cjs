const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-11-15: «اضف الشاصي مكان اللوحة في حال مافي رقم لوحة، واضف البحث
// بالشاصي». Migration 0198 appends the chassis to `movement_visits`; the visits
// tables select it, show it where the plate stands and search it.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const FILE = '20261115120000_0198_visits_chassis_number.sql'
const SQL = read('supabase', 'migrations', FILE)
const M0191 = read('supabase', 'migrations', '20261111120000_0191_visits_last_created_at.sql')

const strip = (s) => s.replace(/--[^\n]*/g, '')
const squash = (s) => s.replace(/\s+/g, ' ').trim()
const viewOf = (sql) => {
  const code = strip(sql)
  const start = code.indexOf('CREATE OR REPLACE VIEW public.movement_visits')
  assert.ok(start >= 0, 'movement_visits is recreated')
  return squash(code.slice(start, code.indexOf("WHERE p.movement_type = 'entry';", start)))
}

test('0198 is the only 0198, LF only', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /_0198_/.test(f))
  assert.deepEqual(files, [FILE])
  assert.ok(!SQL.includes('\r'))
})

test('the view is 0191 verbatim plus the chassis as the last column', () => {
  const added = ', e.chassis_number AS equipment_chassis_number FROM paired p'
  const now = viewOf(SQL)
  assert.ok(now.includes(`) AS last_created_at${added}`))
  assert.equal(now.replace(added, ' FROM paired p'), viewOf(M0191))
})

test('the view keeps its security and its grants', () => {
  const code = strip(SQL)
  assert.match(code, /CREATE OR REPLACE VIEW public\.movement_visits\s+WITH \(security_invoker = true\)/)
  assert.match(code, /REVOKE ALL ON public\.movement_visits FROM PUBLIC, anon;/)
  assert.match(code, /GRANT SELECT ON public\.movement_visits TO authenticated;/)
  assert.match(code, /NOTIFY pgrst, 'reload schema';/)
  // Nothing else is created, dropped or altered.
  assert.equal((code.match(/CREATE /g) ?? []).length, 1)
  assert.ok(!/\bDROP\b|\bALTER\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/.test(code))
})

test('no later migration re-creates the view without the chassis', () => {
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x > FILE)) {
    const code = strip(read('supabase', 'migrations', f))
    if (/VIEW public\.movement_visits\b/.test(code))
      assert.ok(code.includes('equipment_chassis_number'), f)
  }
})

test('the visits lists select and search the chassis', () => {
  const s = read('src', 'lib', 'visitsList.ts')
  const select = s.slice(s.indexOf('export const EQUIPMENT_VISITS_SELECT'))
  assert.match(select.slice(0, select.indexOf('\n\n')), /,equipment_chassis_number'/)
  const fields = s.slice(s.indexOf('export const VISIT_SEARCH_FIELDS'))
  const list = fields.slice(0, fields.indexOf('] as const'))
  assert.match(list, /'equipment_plate_number',[\s\S]*'equipment_chassis_number',/)
  assert.match(s, /equipment_chassis_number\?: string \| null/)
  // The placeholder names it, in both languages, with a plain alif.
  assert.match(s, /او لوحة او شاصي/)
  assert.match(s, /plate or chassis/)
})

test('the table shows the plate, else the chassis', () => {
  const table = read('src', 'components', 'visits', 'VisitsTable.tsx')
  assert.match(table, /<EquipmentIdentifierTag row=\{visit\} \/>/)
  const id = read('src', 'lib', 'equipmentIdentifier.ts')
  assert.match(id, /const plate = row\.equipment_plate_number\?\.trim\(\)\s+if \(plate\) return plate/)
  assert.match(id, /const chassis = row\.equipment_chassis_number\?\.trim\(\)/)
})
