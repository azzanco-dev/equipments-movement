const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Guards migration 0113 (owner decision 2026-10-03): users' mobile numbers
// move out of `profiles`, where the `monitor` role could read them through
// `select_profiles`, into `profile_contacts`, readable by an admin and by the
// user himself only.
const root = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

const MIGRATION = '20261003100000_0113_profile_contacts.sql'
const sql = read('supabase', 'migrations', MIGRATION)

// SQL with `--` comments and single-quoted literals removed, so structural
// checks are not fooled by text inside them.
function code(source) {
  return source
    .split('\n')
    .map((line) => line.replace(/'(?:[^']|'')*'/g, "''").replace(/--.*$/, ''))
    .join('\n')
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

const stripped = code(sql)
const setMobile = functionBody(sql, 'admin_set_user_mobile')
const payload = functionBody(sql, 'movement_notice_payload')

test('0113 is a single new migration', () => {
  const files = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  assert.ok(files.includes(MIGRATION))
  assert.equal(files.filter((file) => /_0113_/.test(file)).length, 1)
})

test('profile_contacts: one optional, format-checked number per profile', () => {
  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS public\.profile_contacts \(\s+user_id uuid PRIMARY KEY REFERENCES public\.profiles\(id\) ON DELETE CASCADE,/,
  )
  assert.match(
    sql,
    /mobile_number text NULL\s+CONSTRAINT profile_contacts_mobile_number_format\s+CHECK \(mobile_number IS NULL OR mobile_number ~ '\^\\\+\?\[0-9\]\{8,15\}\$'\),/,
  )
  assert.match(sql, /updated_at timestamptz NOT NULL DEFAULT now\(\)/)
})

test('profile_contacts is readable by an admin or the user himself only', () => {
  assert.match(
    sql,
    /ALTER TABLE public\.profile_contacts ENABLE ROW LEVEL SECURITY;/,
  )
  const policies = [...stripped.matchAll(/CREATE POLICY[\s\S]*?;/g)].map(
    (m) => m[0],
  )
  assert.equal(policies.length, 1, 'exactly one policy')
  const [policy] = policies
  assert.match(
    policy,
    /ON public\.profile_contacts\s+FOR SELECT TO authenticated USING \(\s+public\.is_admin\(\)\s+OR user_id = auth\.uid\(\)\s+\);/,
  )
  // The monitor, the foremen and the workshop roles are not readers.
  assert.doesNotMatch(
    policy,
    /monitor|supervisor|workshop|current_user_role|true\b/,
  )
})

test('clients cannot write profile_contacts', () => {
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.profile_contacts FROM PUBLIC, anon, authenticated;\s+GRANT SELECT ON TABLE public\.profile_contacts TO authenticated;/,
  )
  assert.doesNotMatch(
    stripped,
    /GRANT (?:ALL|INSERT|UPDATE|DELETE)[^;]*profile_contacts/,
  )
  assert.doesNotMatch(stripped, /FOR (?:INSERT|UPDATE|DELETE|ALL)\b/)
  assert.doesNotMatch(stripped, /GRANT[^;]*\banon\b/)
})

test('the existing numbers are copied before the column is dropped', () => {
  const copy = stripped.search(
    /INSERT INTO public\.profile_contacts \(user_id, mobile_number\)\s+SELECT p\.id, p\.mobile_number\s+FROM public\.profiles p\s+WHERE p\.mobile_number IS NOT NULL/,
  )
  const drop = stripped.search(
    /ALTER TABLE public\.profiles\s+DROP COLUMN IF EXISTS mobile_number;/,
  )
  assert.ok(copy > 0, 'copy statement')
  assert.ok(drop > copy, 'the column is dropped after the copy')
  assert.match(
    stripped,
    /ALTER TABLE public\.profiles\s+DROP CONSTRAINT IF EXISTS profiles_mobile_number_format;/,
  )
  // The payload helper no longer reading the column is replaced first.
  assert.ok(stripped.indexOf('FUNCTION public.movement_notice_payload') < drop)
  assert.ok(stripped.indexOf('FUNCTION public.admin_set_user_mobile') < drop)
})

test('admin_set_user_mobile keeps its contract and upserts profile_contacts', () => {
  assert.match(
    setMobile,
    /public\.admin_set_user_mobile\(\s+p_user_id uuid,\s+p_mobile_number text\s+\)\s+RETURNS void\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/,
  )
  assert.match(
    setMobile,
    /IF auth\.uid\(\) IS NULL OR public\.is_admin\(\) IS NOT TRUE THEN\s+RAISE EXCEPTION 'admin_required'\s+USING ERRCODE = '42501'/,
  )
  assert.match(setMobile, /v_mobile !~ '\^\\\+\?\[0-9\]\{8,15\}\$'/)
  assert.match(setMobile, /RAISE EXCEPTION 'invalid_mobile'/)
  assert.match(
    setMobile,
    /NOT EXISTS \(SELECT 1 FROM public\.profiles p WHERE p\.id = p_user_id\) THEN\s+RAISE EXCEPTION 'user_not_found'/,
  )
  assert.match(
    setMobile,
    /INSERT INTO public\.profile_contacts \(user_id, mobile_number, updated_at\)\s+VALUES \(p_user_id, v_mobile, now\(\)\)\s+ON CONFLICT \(user_id\) DO UPDATE/,
  )
  assert.doesNotMatch(setMobile, /UPDATE public\.profiles/)
  // The admin check comes before anything is read or written.
  assert.ok(
    setMobile.indexOf("RAISE EXCEPTION 'admin_required'") <
      setMobile.indexOf('INSERT INTO public.profile_contacts'),
  )
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.admin_set_user_mobile\(uuid, text\)\s+FROM PUBLIC, anon;\s+GRANT EXECUTE ON FUNCTION public\.admin_set_user_mobile\(uuid, text\)\s+TO authenticated;/,
  )
})

test('movement_notice_payload reads the recipient mobile from profile_contacts', () => {
  const columns = payload
    .match(/RETURNS TABLE\(([\s\S]*?)\)\s+LANGUAGE/)[1]
    .split(',')
    .map((column) => column.trim().split(/\s+/)[0])
  assert.deepEqual(columns, [
    'notice_id',
    'notice_kind',
    'recipient_name',
    'recipient_mobile',
    'equipment_code',
    'equipment_type',
    'project_name_ar',
    'project_name_en',
    'company_name_ar',
    'company_name_en',
    'sender_name',
  ])
  assert.match(payload, /LANGUAGE sql\s+SET search_path = public, pg_temp/)
  assert.doesNotMatch(payload, /SECURITY DEFINER/)
  assert.match(
    payload,
    /LEFT JOIN public\.profile_contacts rc ON rc\.user_id = n\.recipient_id/,
  )
  assert.match(payload, /rc\.mobile_number,/)
  assert.doesNotMatch(payload, /\br\.mobile_number/)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.movement_notice_payload\(uuid\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.doesNotMatch(stripped, /GRANT[^;]*movement_notice_payload/)
})

test('0113 fails fast on locks and reloads the API schema', () => {
  assert.match(sql, /^SET LOCAL lock_timeout = '5s';$/m)
  assert.ok(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"))
  assert.doesNotMatch(stripped, /\bVIEW\b/)
  assert.doesNotMatch(stripped, /DROP[^;]*\bCASCADE\b/)
})

test('no later migration or code reads profiles.mobile_number', () => {
  const dir = path.join(root, 'supabase', 'migrations')
  for (const file of fs.readdirSync(dir).filter((f) => f > MIGRATION)) {
    const source = code(fs.readFileSync(path.join(dir, file), 'utf8'))
    assert.doesNotMatch(
      source,
      /profiles[\s\S]{0,40}\bmobile_number|\br\.mobile_number/,
      file,
    )
  }
  // The user page reads the new table; the client never writes it directly.
  const page = read('src', 'screens', 'UserDetail.tsx')
  assert.doesNotMatch(
    page,
    /\.from\('profiles'\)\s+\.select\('mobile_number'\)/,
  )
  assert.doesNotMatch(
    page,
    /\.from\('profile_contacts'\)\s+\.(?:insert|update|upsert|delete)\(/,
  )
})
