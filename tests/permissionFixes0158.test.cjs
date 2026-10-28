// Migration 0158 (review of the roles system, 2026-10-28): permission scope
// fixes for custom roles, with no change for the six original roles («اهم شي
// مايتغير شي على المستخدمين»).
//
// Source checks only (no database connection): every re-created object is
// compared with its previous latest definition, so that nothing but the
// documented change differs.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const MIGRATIONS = path.join(root, 'supabase', 'migrations')
const read = (file) =>
  fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const MIGRATION = '20261028140000_0158_permission_scope_fixes.sql'
const sql = read(path.join(MIGRATIONS, MIGRATION))

const files = fs
  .readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()
const before = files.slice(0, files.indexOf(MIGRATION))

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** SQL without `--` comments, whitespace collapsed. */
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Every `CREATE [OR REPLACE] FUNCTION public.<name>(` of a text, up to the
 *  `$$;` closing its body. */
function definitions(text, name) {
  const out = []
  const re = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${escape(name)}\\(`,
    'g',
  )
  for (const match of text.matchAll(re)) {
    const open = text.indexOf('$$', match.index)
    const close = text.indexOf('$$;', open + 2)
    out.push(text.slice(match.index, close + 3))
  }
  return out
}

/** `CREATE POLICY <name> ON <table> ... ;` up to the first `\n);`. */
function policies(text, name, table) {
  const out = []
  const re = new RegExp(
    `CREATE POLICY "?${escape(name)}"? ON ${escape(table)}\\b`,
    'g',
  )
  for (const match of text.matchAll(re)) {
    const end = text.indexOf('\n);', match.index)
    out.push(text.slice(match.index, end + 3))
  }
  return out
}

/** The last definition before 0158, with the migration it comes from. */
function previous(kind, name, table) {
  for (const file of [...before].reverse()) {
    const text = read(path.join(MIGRATIONS, file))
    const found =
      kind === 'function' ? definitions(text, name) : policies(text, name, table)
    if (found.length) return { file, text: found[found.length - 1] }
  }
  return null
}

function current(kind, name, table) {
  const found =
    kind === 'function' ? definitions(sql, name) : policies(sql, name, table)
  assert.equal(found.length, 1, `0158 defines ${name} once`)
  return found[0]
}

// --- Order -------------------------------------------------------------------

test('0158 follows 0157', () => {
  assert.match(files[files.indexOf(MIGRATION) - 1], /_0157_/)
})

test('the previous definitions are the ones the migration names', () => {
  const expected = {
    get_last_movement: '0156',
    classify_workshop_entry: '0156',
    get_admin_foreman_discipline: '0156',
    get_admin_foreman_recent_movements: '0156',
    get_entry_report_summary: '0102',
  }
  for (const [name, number] of Object.entries(expected)) {
    const prev = previous('function', name)
    assert.ok(prev, name)
    assert.match(prev.file, new RegExp(`_${number}_`), name)
    assert.match(sql, new RegExp(`-- ${name} — latest ${number}\\.`), name)
  }
  assert.match(previous('policy', 'select_profiles', 'public.profiles').file, /_0151_/)
  assert.match(
    previous('policy', 'update_entry_exit_photos', 'public.entry_exit_photos').file,
    /_0127_/,
  )
  assert.match(
    previous('policy', 'delete_entry_exit_photos', 'public.entry_exit_photos').file,
    /_0127_/,
  )
  assert.match(previous('policy', 'delete_log_photos', 'storage.objects').file, /_0133_/)
})

// --- Shared rules for the new SECURITY DEFINER helpers -------------------------

for (const [name, signature] of [
  ['profile_is_workshop_user', 'uuid'],
  ['can_delete_any_log_photo', 'text'],
]) {
  test(`${name}: STABLE SECURITY DEFINER, fixed search_path, authenticated only`, () => {
    const definition = norm(current('function', name))
    assert.match(definition, /RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS/)
    assert.match(
      sql,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(${signature}\\) FROM PUBLIC, anon;\\nGRANT EXECUTE ON FUNCTION public\\.${name}\\(${signature}\\) TO authenticated;`,
      ),
    )
    assert.match(sql, new RegExp(`COMMENT ON FUNCTION public\\.${name}\\(${signature}\\) IS`))
  })
}

// --- A. select_profiles ----------------------------------------------------------

test('A: profile_is_workshop_user reads the active assigned role, workshop.create, never admin', () => {
  const body = norm(current('function', 'profile_is_workshop_user'))
  assert.match(
    body,
    /SELECT p_profile_id IS NOT NULL AND EXISTS \( SELECT 1 FROM public\.profile_roles pr JOIN public\.roles r ON r\.key = pr\.role_key AND r\.is_active JOIN public\.role_permissions rp ON rp\.role_key = pr\.role_key AND rp\.permission_key = 'movements\.workshop\.create' WHERE pr\.profile_id = p_profile_id AND pr\.role_key <> 'admin' \);/,
  )
})

test('A: select_profiles is 0151 with the RLS-bound EXISTS replaced by the helper', () => {
  const prev = norm(previous('policy', 'select_profiles', 'public.profiles').text)
  const next = norm(current('policy', 'select_profiles', 'public.profiles'))
  const oldExists =
    "AND EXISTS ( SELECT 1 FROM public.profile_roles pr WHERE pr.profile_id = profiles.id AND pr.role_key IN ('workshop', 'assistant_workshop_manager', 'workshop_manager') )"
  assert.ok(prev.includes(oldExists))
  assert.equal(
    next,
    prev.replace(oldExists, 'AND public.profile_is_workshop_user(profiles.id)'),
  )
})

// --- B. entry_exit_photos -------------------------------------------------------

test('B: update/delete_entry_exit_photos keep the uploader rule and bind delete_any to the write scope', () => {
  const branch =
    "(SELECT public.has_permission('movements.photos.manage')) AND ( (uploaded_by = auth.uid() AND public.can_access_movement(entry_exit_log_id)) OR ( (SELECT public.has_permission('movements.photos.delete_any')) AND public.can_write_movement_photos(entry_exit_log_id) ) )"
  const update = norm(current('policy', 'update_entry_exit_photos', 'public.entry_exit_photos'))
  assert.equal(
    update,
    `CREATE POLICY update_entry_exit_photos ON public.entry_exit_photos FOR UPDATE TO authenticated USING ( ${branch} ) WITH CHECK ( ${branch} );`,
  )
  const remove = norm(current('policy', 'delete_entry_exit_photos', 'public.entry_exit_photos'))
  assert.equal(
    remove,
    `CREATE POLICY delete_entry_exit_photos ON public.entry_exit_photos FOR DELETE TO authenticated USING ( ${branch} );`,
  )
  // 0127 had the same three keys and the read helper on every row.
  const prev = norm(previous('policy', 'delete_entry_exit_photos', 'public.entry_exit_photos').text)
  assert.ok(
    prev.includes(
      "AND public.can_access_movement(entry_exit_log_id) AND (uploaded_by = auth.uid() OR (SELECT public.has_permission('movements.photos.delete_any')))",
    ),
  )
})

// --- C. Storage delete_log_photos ----------------------------------------------

test('C: delete_log_photos carries every 0133 branch for callers without delete_any', () => {
  const prev = norm(previous('policy', 'delete_log_photos', 'storage.objects').text)
  const next = norm(current('policy', 'delete_log_photos', 'storage.objects'))
  // The four read branches of 0133, verbatim.
  const start = prev.indexOf('EXISTS ( SELECT 1 FROM public.entry_exit_photos photo')
  const endMarker = 'AND name = ANY(pending.file_paths) )'
  const end = prev.lastIndexOf(endMarker) + endMarker.length
  assert.ok(start > 0 && end > start)
  const reads = prev.slice(start, end)
  const notReferenced =
    'NOT EXISTS ( SELECT 1 FROM public.entry_exit_photos p WHERE p.file_path = storage.objects.name )'
  assert.ok(prev.includes(notReferenced))
  assert.equal(
    next,
    "CREATE POLICY delete_log_photos ON storage.objects FOR DELETE TO authenticated USING ( bucket_id = 'log-photos' AND (SELECT public.has_permission('movements.photos.manage')) AND ( ( (SELECT public.has_permission('movements.photos.delete_any')) AND public.can_delete_any_log_photo(name) ) OR ( (storage.foldername(name))[1] = auth.uid()::text AND " +
      notReferenced +
      ' AND ( ' +
      reads +
      ' ) ) ) );',
  )
})

test('C: can_delete_any_log_photo binds every reference and path segment 2 to the write scope', () => {
  const body = norm(current('function', 'can_delete_any_log_photo'))
  assert.match(body, /p_name IS NOT NULL AND public\.has_permission\('movements\.photos\.delete_any'\)/)
  assert.match(
    body,
    /AND NOT EXISTS \( SELECT 1 FROM public\.entry_exit_photos photo WHERE photo\.file_path = p_name AND NOT public\.can_write_movement_photos\(photo\.entry_exit_log_id\) \)/,
  )
  assert.match(
    body,
    /AND NOT EXISTS \( SELECT 1 FROM public\.entry_exit_logs movement WHERE movement\.photo_url = p_name AND NOT public\.can_write_movement_photos\(movement\.id\) \)/,
  )
  assert.match(
    body,
    /AND \( public\.can_write_movement_photos\(public\.safe_uuid\(split_part\(p_name, '\/', 2\)\)\) OR NOT EXISTS \( SELECT 1 FROM public\.entry_exit_logs movement WHERE movement\.id = public\.safe_uuid\(split_part\(p_name, '\/', 2\)\) \) \), false \);/,
  )
  assert.match(body, /SELECT COALESCE\(/)
})

test('C: select_log_photos and update_log_photos are not redefined', () => {
  assert.doesNotMatch(norm(sql), /POLICY (?:select|update|insert)_log_photos\b/)
})

// --- D. get_last_movement ---------------------------------------------------------

test('D: get_last_movement keeps its signature, gate and query; details follow can_access_movement', () => {
  const prevText = previous('function', 'get_last_movement').text
  const nextText = current('function', 'get_last_movement')
  const prev = norm(prevText)
  const next = norm(nextText)
  // Signature, RETURNS TABLE and attributes.
  const header = (text) => text.slice(0, text.indexOf('AS $$'))
  assert.equal(header(next), header(prev))
  // The gate, verbatim.
  const gate = (text) =>
    text.slice(text.indexOf('IF NOT ('), text.indexOf("RAISE EXCEPTION 'invalid movement context'; END IF;"))
  assert.equal(gate(next), gate(prev))
  // The query: the 0156 one plus the id, with output aliases.
  const prevQuery = prev.slice(
    prev.indexOf('SELECT l.movement_type'),
    prev.indexOf('LIMIT 1;') + 'LIMIT 1'.length,
  )
  const innerStart = next.indexOf('SELECT l.id AS log_id,')
  const innerEnd = next.indexOf('LIMIT 1 ) m') + 'LIMIT 1'.length
  const inner = next
    .slice(innerStart, innerEnd)
    .replace('SELECT l.id AS log_id, ', 'SELECT ')
    .replace(/ AS [a-z_]+(?=,| FROM)/g, '')
  assert.equal(inner, prevQuery)
  assert.match(next, /\) m CROSS JOIN LATERAL \( SELECT public\.can_access_movement\(m\.log_id\) AS can_read \) acc; END;/)
  assert.match(
    next,
    /v_can_record := public\.has_permission\('movements\.site\.create'\) OR public\.has_permission\('movements\.workshop\.create'\);/,
  )
  // Column by column.
  const select = next.slice(next.indexOf('RETURN QUERY SELECT'), next.indexOf('FROM ( SELECT l.id'))
  const columns = select
    .replace('RETURN QUERY SELECT ', '')
    .trim()
    .split(/, (?=m\.|CASE)/)
    .map((column) => column.trim())
  assert.deepEqual(columns, [
    'm.movement_type',
    'm.movement_context',
    'm.workshop_purpose',
    'm.recorded_at',
    'CASE WHEN acc.can_read THEN m.supervisor_id END',
    'CASE WHEN acc.can_read OR v_can_record THEN m.supervisor_name END',
    'CASE WHEN acc.can_read THEN m.company_id END',
    'CASE WHEN acc.can_read THEN m.project_id END',
    'CASE WHEN acc.can_read OR v_can_record THEN m.project_name_ar END',
    'CASE WHEN acc.can_read OR v_can_record THEN m.project_name_en END',
    'CASE WHEN acc.can_read THEN m.contractor_equipment_code END',
    'CASE WHEN acc.can_read THEN m.driver_id END',
    'CASE WHEN acc.can_read THEN m.driver_name END',
    'CASE WHEN acc.can_read THEN m.driver_mobile_number END',
    'CASE WHEN acc.can_read THEN m.company_name_ar END',
    'CASE WHEN acc.can_read THEN m.company_name_en END',
  ])
})

test('D: the clients read only the state fields from the inquiry call', () => {
  const inquiry = read(
    path.join(root, 'src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx'),
  )
  const call = inquiry.indexOf(".rpc('get_last_movement'")
  assert.ok(call > 0)
  const use = inquiry.slice(call, inquiry.indexOf('equipmentStateFromMovement(latest)', call))
  assert.match(use, /movement_type: string \| null\s+movement_context: string \| null\s+workshop_purpose: string \| null\s+\}/)
})

// --- E. classify_workshop_entry ---------------------------------------------------

test('E: classify_workshop_entry is 0156 plus the read check after the row lock', () => {
  const prev = norm(previous('function', 'classify_workshop_entry').text)
  const next = norm(current('function', 'classify_workshop_entry'))
  const added =
    " IF NOT public.can_access_movement(v_entry.id) THEN RAISE EXCEPTION 'workshop manager required'; END IF;"
  assert.ok(next.includes(`IF NOT FOUND THEN RAISE EXCEPTION 'workshop entry not found'; END IF;${added}`))
  assert.equal(next.replace(added, ''), prev)
})

// --- F. foreman names from profile_names -----------------------------------------

for (const name of [
  'get_admin_foreman_discipline',
  'get_admin_foreman_recent_movements',
]) {
  test(`F: ${name} is 0156 with profiles swapped for profile_names`, () => {
    const prev = norm(previous('function', name).text)
    const next = norm(current('function', name))
    assert.ok(prev.includes('LEFT JOIN public.profiles pr ON pr.id ='))
    assert.equal(
      next,
      prev.replace('LEFT JOIN public.profiles pr', 'LEFT JOIN public.profile_names pr'),
    )
    assert.doesNotMatch(next, /public\.profiles\b/)
  })
}

// --- F + G. get_entry_report_summary ----------------------------------------------

test('G: get_entry_report_summary is 0102 plus reports.view, its scope and profile_names', () => {
  const prev = norm(previous('function', 'get_entry_report_summary').text)
  const next = norm(current('function', 'get_entry_report_summary'))
  const declared = ' v_scope text;'
  const gate =
    " v_scope := public.permission_scope('reports.view'); IF v_scope IS NULL THEN RAISE EXCEPTION 'reports_view_required' USING ERRCODE = '42501'; END IF;"
  const scope =
    " IF v_scope <> 'all' AND v_context IS DISTINCT FROM v_scope THEN RAISE EXCEPTION 'reports_context_out_of_scope' USING ERRCODE = '42501'; END IF;"
  assert.ok(next.includes(`v_result jsonb;${declared} BEGIN${gate} v_owners :=`))
  assert.ok(
    next.includes(
      `RAISE EXCEPTION 'unknown movement context' USING ERRCODE = '22023'; END IF;${scope} WITH entries AS`,
    ),
  )
  assert.equal(
    next.replace(declared, '').replace(gate, '').replace(scope, ''),
    prev.replace('LEFT JOIN public.profiles pr', 'LEFT JOIN public.profile_names pr'),
  )
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION\n  public\.get_entry_report_summary\(timestamptz, timestamptz, text\[\], text\)\n  FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION\n  public\.get_entry_report_summary\(timestamptz, timestamptz, text\[\], text\)\n  TO authenticated;/,
  )
})

test('G: the entry report still sends its context (the admin holds reports.view all)', () => {
  const screen = read(path.join(root, 'src', 'screens', 'EntryReports.tsx'))
  assert.match(screen, /\.rpc\('get_entry_report_summary', \{[\s\S]*?p_context: context,/)
})

// --- H. Catalogue text --------------------------------------------------------------

test('H: the three descriptions are updated behind an existence guard, without hamza', () => {
  const code = norm(sql)
  assert.match(
    code,
    /IF \( SELECT count\(\*\) FROM public\.permissions WHERE key IN \('home\.foreman', 'movements\.exit_cross_context', 'inquiry\.view'\) \) <> 3 THEN RAISE EXCEPTION/,
  )
  for (const key of ['home.foreman', 'movements.exit_cross_context', 'inquiry.view']) {
    const match = new RegExp(
      `UPDATE public\\.permissions SET description_ar = '([^']+)', description_en = '([^']+)' WHERE key = '${escape(key)}';`,
    ).exec(code)
    assert.ok(match, key)
    assert.doesNotMatch(match[1], /[أإآ]/, `${key}: no alif with hamza or madda`)
    assert.match(match[1], /[؀-ۿ]/, `${key}: Arabic text`)
    assert.match(match[2], /^[\x20-\x7E]+$/, `${key}: English text`)
  }
  assert.doesNotMatch(code, /[أإآ]/, 'no alif with hamza or madda in the SQL')
})

// --- I. The unused function ------------------------------------------------------

test('I: get_all_equipment_last_movement() is dropped and nothing calls it', () => {
  assert.match(sql, /\nDROP FUNCTION IF EXISTS public\.get_all_equipment_last_movement\(\);\n/)
  const prev = previous('function', 'get_all_equipment_last_movement')
  assert.match(prev.file, /_0127_/)
  assert.match(prev.text, /FUNCTION public\.get_all_equipment_last_movement\(\)\n/)
  const roots = ['src', 'app', path.join('supabase', 'functions')]
  const stack = roots.map((dir) => path.join(root, dir))
  while (stack.length) {
    const entry = stack.pop()
    if (!fs.existsSync(entry)) continue
    if (fs.statSync(entry).isDirectory()) {
      for (const child of fs.readdirSync(entry)) stack.push(path.join(entry, child))
    } else if (/\.(ts|tsx|js|cjs|mjs)$/.test(entry)) {
      assert.doesNotMatch(read(entry), /get_all_equipment_last_movement/, entry)
    }
  }
})

// --- Nothing else ------------------------------------------------------------------

test('0158 re-creates only the objects it documents and ends with a schema reload', () => {
  const code = sql.replace(/--[^\n]*/g, '')
  const functions = [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)]
    .map((match) => match[1])
    .sort()
  assert.deepEqual(functions, [
    'can_delete_any_log_photo',
    'classify_workshop_entry',
    'get_admin_foreman_discipline',
    'get_admin_foreman_recent_movements',
    'get_entry_report_summary',
    'get_last_movement',
    'profile_is_workshop_user',
  ])
  const policyNames = [...code.matchAll(/CREATE POLICY ([a-z_]+) ON/g)]
    .map((match) => match[1])
    .sort()
  assert.deepEqual(policyNames, [
    'delete_entry_exit_photos',
    'delete_log_photos',
    'select_profiles',
    'update_entry_exit_photos',
  ])
  for (const definition of definitions(sql, 'classify_workshop_entry')
    .concat(definitions(sql, 'get_last_movement'))
    .concat(definitions(sql, 'profile_is_workshop_user'))
    .concat(definitions(sql, 'can_delete_any_log_photo'))) {
    assert.match(definition, /SECURITY DEFINER\nSET search_path = public, pg_temp\n/)
  }
  assert.doesNotMatch(code, /ALTER TABLE|DROP POLICY IF EXISTS (?!select_profiles|update_entry_exit_photos|delete_entry_exit_photos|delete_log_photos)/)
  assert.doesNotMatch(code, /set_roles_system_enabled|role_permissions \(|INSERT INTO/)
  assert.match(code, /NOTIFY pgrst, 'reload schema';\s*$/)
})
