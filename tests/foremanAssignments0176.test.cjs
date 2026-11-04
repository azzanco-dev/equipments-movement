const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-11-03 (EM-261): «ربط الفورمينات بالشركات والمشاريع, مش بس
// الشركات, وتكون عبر صفحة تسمى مثلا صفحة اسنادات الفورمينات» → 0176, the
// database layer: `profile_projects` narrows a linked company to some of its
// projects (no rows = all), `admin_set_profile_assignments` is the one writer
// and `profile_assignments` the read helper. Company links (0058 / 0145)
// are unchanged: they restrict no read and no write.

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const file = fs.readdirSync(MIGRATIONS).find((name) => /_0176_/.test(name))
const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

const between = (from, to) => {
  const start = code.indexOf(from)
  assert.notEqual(start, -1, from)
  const end = to ? code.indexOf(to, start) : code.length
  assert.notEqual(end, -1, to)
  return code.slice(start, end)
}

test('0176 is the only 0176 and comes after 0174 (and 0175 when present)', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
  assert.equal(files.filter((f) => /_0176_/.test(f)).length, 1)
  assert.equal(file, '20261104140000_0176_foreman_project_assignments.sql')
  for (const f of files.filter((f) => /_017[45]_/.test(f))) assert.ok(file > f, f)
})

test('profile_projects: the table, its primary key and index', () => {
  const table = between('CREATE TABLE public.profile_projects', 'ALTER TABLE public.profile_projects')
  assert.match(
    table,
    /profile_id uuid NOT NULL REFERENCES public\.profiles\(id\) ON DELETE CASCADE/,
  )
  assert.match(
    table,
    /project_id uuid NOT NULL REFERENCES public\.projects\(id\) ON DELETE CASCADE/,
  )
  assert.match(table, /created_at timestamptz NOT NULL DEFAULT now\(\)/)
  assert.match(table, /PRIMARY KEY \(profile_id, project_id\)/)
  assert.match(
    table,
    /CREATE INDEX profile_projects_project_id_idx\s+ON public\.profile_projects\(project_id\)/,
  )
  // A link table keeps created_at only (no updated_at, no trigger).
  assert.doesNotMatch(table, /updated_at/)
})

test('profile_projects: RLS mirrors profile_companies — SELECT only', () => {
  assert.match(code, /ALTER TABLE public\.profile_projects ENABLE ROW LEVEL SECURITY;/)
  assert.match(code, /GRANT SELECT ON public\.profile_projects TO authenticated;/)
  assert.doesNotMatch(code, /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON public\.profile_projects/)
  // The 0127 select_profile_companies rule, verbatim.
  assert.match(
    code,
    /CREATE POLICY select_profile_projects ON public\.profile_projects\s+FOR SELECT TO authenticated\s+USING \(\s+profile_id = auth\.uid\(\) OR \(SELECT public\.has_permission\('users\.manage'\)\)\s+\);/,
  )
  // No client write path: exactly one policy, and it is the SELECT one.
  const policies = code.match(/CREATE POLICY [^\n]+ ON public\.profile_projects[^;]*;/g) || []
  assert.equal(policies.length, 1)
  assert.doesNotMatch(code, /CREATE POLICY [^\n]+ ON public\.profile_projects\s+FOR (INSERT|UPDATE|DELETE|ALL)/)
  // Nothing of profile_companies' own policies is touched.
  assert.doesNotMatch(code, /POLICY [^\n]*ON public\.profile_companies/)
})

test('BEFORE INSERT: the project must belong to a linked company', () => {
  const fn = between(
    'FUNCTION public.enforce_profile_project_company()',
    'FUNCTION public.prune_profile_projects_on_company_unlink()',
  )
  assert.match(fn, /RETURNS trigger/)
  assert.match(fn, /SECURITY DEFINER/)
  assert.match(fn, /SET search_path = public, pg_temp/)
  assert.match(fn, /FROM public\.company_projects cp\s+JOIN public\.profile_companies pc/)
  assert.match(fn, /pc\.profile_id = NEW\.profile_id/)
  assert.match(fn, /cp\.project_id = NEW\.project_id/)
  assert.match(
    fn,
    /RAISE EXCEPTION 'project_company_not_assigned'\s+USING ERRCODE = '23503'/,
  )
  assert.match(
    fn,
    /REVOKE ALL ON FUNCTION public\.enforce_profile_project_company\(\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    fn,
    /CREATE TRIGGER enforce_profile_project_company\s+BEFORE INSERT ON public\.profile_projects\s+FOR EACH ROW EXECUTE FUNCTION public\.enforce_profile_project_company\(\);/,
  )
})

test('AFTER DELETE on profile_companies: the project rows never dangle', () => {
  const fn = between(
    'FUNCTION public.prune_profile_projects_on_company_unlink()',
    'FUNCTION public.admin_set_profile_assignments(',
  )
  assert.match(fn, /RETURNS trigger/)
  assert.match(fn, /SECURITY DEFINER/)
  assert.match(fn, /SET search_path = public, pg_temp/)
  assert.match(fn, /DELETE FROM public\.profile_projects pp\s+WHERE pp\.profile_id = OLD\.profile_id/)
  assert.match(fn, /cp\.company_id = OLD\.company_id/)
  // Kept when another linked company still carries the project.
  assert.match(
    fn,
    /AND NOT EXISTS \(\s+SELECT 1\s+FROM public\.company_projects cp\s+JOIN public\.profile_companies pc/,
  )
  assert.match(
    fn,
    /REVOKE ALL ON FUNCTION public\.prune_profile_projects_on_company_unlink\(\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    fn,
    /CREATE TRIGGER prune_profile_projects_on_company_unlink\s+AFTER DELETE ON public\.profile_companies\s+FOR EACH ROW EXECUTE FUNCTION public\.prune_profile_projects_on_company_unlink\(\);/,
  )
})

test('admin_set_profile_assignments: the one writer', () => {
  const fn = between(
    'CREATE OR REPLACE FUNCTION public.admin_set_profile_assignments(',
    'CREATE OR REPLACE VIEW public.profile_assignments',
  )
  assert.match(
    fn,
    /admin_set_profile_assignments\(\s+p_profile_id uuid,\s+p_company_ids uuid\[\],\s+p_project_ids uuid\[\]\s+\)\s+RETURNS void\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/,
  )
  assert.match(
    fn,
    /IF auth\.uid\(\) IS NULL\s+OR public\.has_permission\('users\.manage'\) IS NOT TRUE THEN\s+RAISE EXCEPTION 'users_manage_required'\s+USING ERRCODE = '42501'/,
  )
  assert.match(fn, /FROM public\.profiles p\s+WHERE p\.id = p_profile_id\s+FOR UPDATE;/)
  assert.match(fn, /RAISE EXCEPTION 'invalid_profile' USING ERRCODE = '22023'/)
  assert.match(fn, /RAISE EXCEPTION 'invalid_company' USING ERRCODE = '22023'/)
  assert.match(fn, /RAISE EXCEPTION 'invalid_project' USING ERRCODE = '22023'/)
  assert.match(
    fn,
    /AND cp\.company_id = ANY \(v_company_ids\)[\s\S]*RAISE EXCEPTION 'project_company_not_assigned'\s+USING ERRCODE = '23503'/,
  )
  // Replace both sets: insert the missing, delete the rest, in the order
  // the two triggers need (companies in, companies out, projects out,
  // projects in).
  const steps = [
    fn.indexOf('INSERT INTO public.profile_companies (profile_id, company_id)'),
    fn.indexOf('DELETE FROM public.profile_companies pc'),
    fn.indexOf('DELETE FROM public.profile_projects pp'),
    fn.indexOf('INSERT INTO public.profile_projects (profile_id, project_id)'),
  ]
  for (const i of steps) assert.notEqual(i, -1)
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b))
  assert.match(fn, /AND pc\.company_id <> ALL \(v_company_ids\);/)
  assert.match(fn, /AND pp\.project_id <> ALL \(v_project_ids\);/)
  assert.match(fn, /ON CONFLICT \(profile_id, company_id\) DO NOTHING;/)
  assert.match(fn, /ON CONFLICT \(profile_id, project_id\) DO NOTHING;/)
  assert.match(
    fn,
    /REVOKE ALL ON FUNCTION public\.admin_set_profile_assignments\(uuid, uuid\[\], uuid\[\]\) FROM PUBLIC, anon;/,
  )
  assert.match(
    fn,
    /GRANT EXECUTE ON FUNCTION public\.admin_set_profile_assignments\(uuid, uuid\[\], uuid\[\]\) TO authenticated;/,
  )
})

test('profile_assignments: security_invoker, one row per user × company', () => {
  const view = between('CREATE OR REPLACE VIEW public.profile_assignments', 'NOTIFY pgrst')
  assert.match(view, /WITH \(security_invoker = true\)/)
  for (const column of [
    'pc.profile_id',
    'pc.company_id',
    'co.name_ar AS company_name_ar',
    'co.name_en AS company_name_en',
    'AS project_ids',
    'AS project_names_ar',
    'AS project_names_en',
  ])
    assert.ok(view.includes(column), column)
  // Empty array = all the company's projects.
  assert.match(view, /COALESCE\(np\.project_ids, ARRAY\[\]::uuid\[\]\) AS project_ids/)
  // The three arrays share one order.
  assert.equal((view.match(/ORDER BY pr\.name_ar, pr\.id/g) || []).length, 3)
  assert.match(view, /FROM public\.profile_companies pc\s+JOIN public\.companies co ON co\.id = pc\.company_id/)
  assert.match(view, /JOIN public\.company_projects cp\s+ON cp\.project_id = pp\.project_id\s+AND cp\.company_id = pc\.company_id/)
  assert.match(view, /GRANT SELECT ON public\.profile_assignments TO authenticated;/)
  assert.match(code, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('nothing else: no RLS scoping by the links, no manage-user change', () => {
  assert.doesNotMatch(code, /entry_exit_logs|movement_visits|select_companies|select_projects/)
  assert.doesNotMatch(sql, /[أإآ]/)
})
