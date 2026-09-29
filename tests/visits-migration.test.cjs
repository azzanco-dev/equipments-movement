const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0106 recreates `movement_visits` with two appended columns.
// `CREATE OR REPLACE VIEW` only accepts a definition whose existing columns
// keep their names, order and types, so these tests prove the new definition
// is 0099's verbatim plus the appended tail, and that the security options and
// grants are repeated.

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations')
const read = (name) => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')

const V0099 = read('20260922150000_0099_profile_names.sql')
const V0106 = read('20260930100000_0106_movement_visits_contractor_code.sql')

/** The `movement_visits` statement of a migration, comments stripped. */
function visitsView(sql) {
  const start = sql.indexOf('CREATE OR REPLACE VIEW public.movement_visits')
  assert.ok(start >= 0, 'movement_visits is recreated')
  const end = sql.indexOf("WHERE p.movement_type = 'entry';", start)
  assert.ok(end > start, 'the view keeps its entry-only predicate')
  return sql
    .slice(start, end)
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter(Boolean)
    .join(' ')
}

function between(text, from, to) {
  const start = text.indexOf(from)
  const end = text.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `${from} ... ${to}`)
  return text.slice(start, end)
}

/** Output column names, in order, of the view's final select list. */
function outputColumns(view) {
  const list = between(view, 'SELECT p.id AS entry_id', ' FROM paired p').slice(
    'SELECT '.length,
  )
  // Split on top-level commas only (CASE / GREATEST contain their own).
  const columns = []
  let depth = 0
  let current = ''
  for (const char of list) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      columns.push(current.trim())
      current = ''
    } else current += char
  }
  columns.push(current.trim())
  return columns.map((column) => {
    const alias = /\bAS\s+(\w+)$/i.exec(column)
    if (alias) return alias[1]
    return column.split('.').pop()
  })
}

test('0106 only appends columns to the 0099 view', () => {
  const before = outputColumns(visitsView(V0099))
  const after = outputColumns(visitsView(V0106))
  assert.deepEqual(after.slice(0, before.length), before)
  assert.deepEqual(after.slice(before.length), [
    'contractor_equipment_code',
    'equipment_ownership_status',
  ])
  assert.equal(before[before.length - 1], 'duration_minutes')
})

test('0106 keeps every 0099 select expression verbatim', () => {
  const before = between(
    visitsView(V0099),
    'SELECT p.id AS entry_id',
    ' FROM paired p',
  )
  const after = between(
    visitsView(V0106),
    'SELECT p.id AS entry_id',
    ' FROM paired p',
  )
  assert.ok(after.startsWith(before), 'the old select list is a prefix')
  assert.equal(
    after.slice(before.length),
    ', p.contractor_equipment_code, e.ownership_status AS equipment_ownership_status',
  )
})

test('0106 keeps the pairing window and the joins unchanged', () => {
  const before = visitsView(V0099)
  const after = visitsView(V0106)
  // The CTE gains one internal column; the window itself is untouched.
  assert.equal(
    between(after, 'WITH paired AS', ' LEAD(l.id)'),
    between(before, 'WITH paired AS', ' LEAD(l.id)').replace(
      'l.recorded_at,',
      'l.recorded_at, l.contractor_equipment_code,',
    ),
  )
  assert.equal(
    between(after, ' LEAD(l.id)', ' SELECT p.id'),
    between(before, ' LEAD(l.id)', ' SELECT p.id'),
  )
  assert.match(after, /ORDER BY l\.recorded_at, l\.id/)
  assert.equal(
    after.slice(after.indexOf(' FROM paired p')),
    before.slice(before.indexOf(' FROM paired p')),
  )
})

test('0106 repeats security_invoker, the grants and the comment', () => {
  assert.match(
    V0106,
    /CREATE OR REPLACE VIEW public\.movement_visits\s+WITH \(security_invoker = true\)/,
  )
  assert.match(
    V0106,
    /REVOKE ALL ON public\.movement_visits FROM PUBLIC, anon;/,
  )
  assert.match(
    V0106,
    /GRANT SELECT ON public\.movement_visits TO authenticated;/,
  )
  assert.match(V0106, /COMMENT ON VIEW public\.movement_visits IS/)
  assert.doesNotMatch(V0106, /SECURITY DEFINER/i)
})
