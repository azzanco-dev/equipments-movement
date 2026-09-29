const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Guards migration 0107 (the admin home's fleet mini tables). The database is
// the authoritative place for the role check and the view's shape, so a change
// that drops one of them must fail here rather than in production.
function migration(file) {
  return fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', file),
    'utf8',
  )
}

const sql0102 = migration('20260923100000_0102_equipment_status.sql')
const sql = migration('20260930120000_0107_admin_fleet_equipment.sql')

function viewBody(source) {
  const start = source.indexOf(
    'CREATE OR REPLACE VIEW public.admin_equipment_state',
  )
  assert.ok(start >= 0, 'missing admin_equipment_state')
  const end = source.indexOf(') m ON true;', start)
  assert.ok(end > start, 'unterminated admin_equipment_state')
  return source.slice(start, end)
}

/** The output column names of the view's top-level SELECT list, in order. */
function viewColumns(body) {
  const select = body.slice(
    body.indexOf('SELECT'),
    body.indexOf('FROM public.equipment e'),
  )
  return select
    .replace(/--[^\n]*/g, '')
    .replace(/CASE[\s\S]*?END AS state/, 'state')
    .replace(/^SELECT/, '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const alias = / AS (\w+)$/.exec(part)
      return alias ? alias[1] : part.replace(/^\w+\./, '')
    })
}

function functionBody(source, name) {
  const match = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`,
  ).exec(source)
  assert.ok(match, `missing function: ${name}`)
  const end = source.indexOf('\n$$;', match.index)
  assert.ok(end > match.index, `unterminated function: ${name}`)
  return source.slice(match.index, end)
}

test('0107 only appends columns to admin_equipment_state', () => {
  const before = viewColumns(viewBody(sql0102))
  const after = viewColumns(viewBody(sql))
  assert.deepEqual(before.slice(-1), ['status'])
  // CREATE OR REPLACE VIEW allows new columns at the end only: every 0102
  // column keeps its name and position.
  assert.deepEqual(after.slice(0, before.length), before)
  assert.deepEqual(after.slice(before.length), [
    'last_movement_id',
    'last_company_id',
    'last_project_id',
  ])
  // The latest movement is still picked deterministically.
  assert.match(
    viewBody(sql),
    /ORDER BY l\.recorded_at DESC, l\.id DESC\s+LIMIT 1/,
  )
})

test('the view stays security_invoker and closed to anon', () => {
  assert.match(
    sql,
    /CREATE OR REPLACE VIEW public\.admin_equipment_state\s+WITH \(security_invoker = true\)/,
  )
  assert.match(
    sql,
    /REVOKE ALL ON public\.admin_equipment_state FROM PUBLIC, anon;/,
  )
  assert.match(
    sql,
    /GRANT SELECT ON public\.admin_equipment_state TO authenticated;/,
  )
})

test('get_admin_fleet_equipment fails closed and validates every argument', () => {
  const body = functionBody(sql, 'get_admin_fleet_equipment')
  assert.match(body, /SECURITY INVOKER/)
  assert.doesNotMatch(body, /SECURITY DEFINER/)
  assert.match(body, /SET search_path = public, pg_temp/)
  // A NULL role (no profile row) must be rejected explicitly.
  assert.match(
    body,
    /IF v_role IS NULL OR v_role NOT IN \('admin', 'monitor'\) THEN/,
  )
  assert.match(
    body,
    /p_state NOT IN \('inside_site', 'workshop', 'available'\)/,
  )
  assert.match(body, /p_state <> 'workshop'/)
  assert.match(
    body,
    /p_purpose NOT IN \('maintenance', 'parking', 'unclassified'\)/,
  )
  assert.match(body, /public\.admin_home_owner_filter\(p_owners\)/)
  assert.match(body, /LEAST\(GREATEST\(COALESCE\(p_limit, 7\), 1\), 500\)/)
  assert.match(body, /GREATEST\(COALESCE\(p_offset, 0\), 0\)/)
  assert.match(body, /s\.is_active\s+AND s\.status = 'active'/)
  assert.match(body, /count\(\*\) OVER \(\)::int AS total_count/)
  assert.match(body, /ORDER BY s\.last_movement_at DESC NULLS LAST, s\.id/)
})

test('get_admin_fleet_equipment is granted to authenticated only', () => {
  const signature =
    'public.get_admin_fleet_equipment(text, text[], text, int, int)'
  const flat = sql.replace(/\s+/g, ' ')
  assert.ok(
    flat.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon;`),
  )
  assert.ok(
    flat.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`),
  )
  assert.ok(flat.includes(`COMMENT ON FUNCTION ${signature} IS`))
})

test('the outside-equipment function it replaces is dropped', () => {
  assert.match(
    sql,
    /DROP FUNCTION IF EXISTS public\.get_admin_outside_equipment\(text\[\], int, int\);/,
  )
})
