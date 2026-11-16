const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0199: quotations («عروض الاسعار»), the database layer. Owner
// decisions (approved with the Figma design): a price list for a client by
// equipment type (daily / monthly / mob-demob, no quantities or totals),
// costs with who bears them, terms copied from a template managed in
// Settings, draft → approved (number QT-YYYYMM#### at the first approval,
// draft reference QD-#### until then) → the client answer; «منتهي» computed;
// approval by the admin key sales.quotations.approve, self-approval allowed.

const ROOT = path.join(__dirname, '..')
const SQL = fs.readFileSync(
  path.join(
    ROOT,
    'supabase',
    'migrations',
    '20261116100000_0199_quotations.sql',
  ),
  'utf8',
)
/** The migration without its `--` comments. */
const CODE = SQL.replace(/--[^\n]*/g, '')
const HAMZA_ALIF = /[أإآ]/

/** The body of one function of the migration ($$ … $$). */
function body(name) {
  const start = CODE.search(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`),
  )
  assert.ok(start >= 0, `${name} is in the migration`)
  const open = CODE.indexOf('AS $$', start)
  const close = CODE.indexOf('$$;', open)
  return CODE.slice(open, close)
}

/** The header of one function (CREATE … up to AS $$). */
function head(name) {
  const start = CODE.search(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`),
  )
  assert.ok(start >= 0, `${name} is in the migration`)
  return CODE.slice(start, CODE.indexOf('AS $$', start))
}

/** One CREATE TABLE statement. */
function table(name) {
  const start = CODE.indexOf(`CREATE TABLE public.${name} (`)
  assert.ok(start >= 0, `${name} is created`)
  return CODE.slice(start, CODE.indexOf('\n);', start))
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The client-callable functions with their exact signatures. */
const CALLABLE = {
  save_quotation:
    'uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[]',
  approve_quotation: 'uuid',
  return_quotation_approval: 'uuid, text',
  set_quotation_outcome: 'uuid, text, text',
  delete_quotation: 'uuid',
  copy_quotation: 'uuid',
}
/** Internal helpers: no EXECUTE for any client role. */
const INTERNAL = {
  next_quotation_number: '',
  next_quotation_draft_ref: '',
  assert_quotation_approve: '',
  record_quotation_event: 'uuid, text, jsonb',
  quotation_price_value: 'jsonb',
  normalise_quotation_term_template: '',
}
const TABLES = [
  'quotation_term_templates',
  'quotations',
  'quotation_lines',
  'quotation_costs',
  'quotation_terms',
  'quotation_events',
  'quotation_number_sequence',
  'quotation_draft_sequence',
]
const DOCUMENT_TABLES = [
  'quotations',
  'quotation_lines',
  'quotation_costs',
  'quotation_terms',
  'quotation_events',
]

test('the key sales.quotations.approve, held by the admin role', () => {
  assert.match(
    CODE,
    /'sales\.quotations\.approve', 'sales',\s+'[^']+', '[^']+',\s+'[^']+',\s+'[^']+',\s+false, NULL, ARRAY\['sales\.view'\], false, 'database', \d+\s+\)\s+ON CONFLICT \(key\) DO NOTHING;/,
  )
  assert.match(
    CODE,
    /INSERT INTO public\.role_permissions \(role_key, permission_key, scope\)\s+VALUES \('admin', 'sales\.quotations\.approve', NULL\)\s+ON CONFLICT \(role_key, permission_key\) DO NOTHING;/,
  )
  // Only the admin role gets it.
  const grants = CODE.match(
    /\('[a-z_]+', 'sales\.quotations\.approve', NULL\)/g,
  )
  assert.deepEqual(grants, ["('admin', 'sales.quotations.approve', NULL)"])
})

test('the migration alters no existing object', () => {
  assert.doesNotMatch(CODE, /ALTER TABLE public\.(?!quotation)/)
  assert.doesNotMatch(CODE, /DROP (TABLE|FUNCTION|VIEW|POLICY|TRIGGER)/)
  for (const m of CODE.matchAll(
    /CREATE (?:OR REPLACE )?(?:FUNCTION|VIEW) public\.([a-z_]+)/g,
  )) {
    assert.match(m[1], /quotation/, `${m[1]} is a new object of the feature`)
  }
})

test('quotation_term_templates: written directly under RLS like banks', () => {
  const t = table('quotation_term_templates')
  assert.match(
    t,
    /title_ar text NOT NULL[^,]*CHECK \(char_length\(btrim\(title_ar\)\) BETWEEN 1 AND 120\)/,
  )
  assert.match(
    t,
    /title_en text NOT NULL[^,]*CHECK \(char_length\(btrim\(title_en\)\) BETWEEN 1 AND 120\)/,
  )
  assert.match(
    t,
    /body_ar text NOT NULL[^,]*CHECK \(char_length\(btrim\(body_ar\)\) BETWEEN 1 AND 1000\)/,
  )
  assert.match(
    t,
    /body_en text NOT NULL[^,]*CHECK \(char_length\(btrim\(body_en\)\) BETWEEN 1 AND 1000\)/,
  )
  assert.match(t, /position integer NOT NULL DEFAULT 0/)
  assert.match(t, /is_default boolean NOT NULL DEFAULT true/)
  assert.match(
    t,
    /created_by uuid DEFAULT auth\.uid\(\) REFERENCES public\.profiles\(id\) ON DELETE SET NULL/,
  )
  assert.match(t, /updated_at timestamptz NOT NULL DEFAULT now\(\)/)

  const trig = body('normalise_quotation_term_template')
  for (const col of ['title_ar', 'title_en', 'body_ar', 'body_en']) {
    assert.match(trig, new RegExp(`NEW\\.${col} := btrim\\(NEW\\.${col}\\);`))
  }
  assert.match(
    trig,
    /IF NEW\.position IS NULL OR NEW\.position <= 0 THEN\s+SELECT COALESCE\(max\(t\.position\), 0\) \+ 1 INTO NEW\.position/,
  )
  assert.match(
    CODE,
    /CREATE TRIGGER quotation_term_templates_normalise\s+BEFORE INSERT OR UPDATE ON public\.quotation_term_templates/,
  )

  assert.match(
    CODE,
    /CREATE POLICY select_quotation_term_templates ON public\.quotation_term_templates\s+FOR SELECT TO authenticated\s+USING \(\(SELECT public\.has_permission\('sales\.view'\)\)\);/,
  )
  for (const op of ['insert', 'update', 'delete']) {
    const start = CODE.indexOf(`CREATE POLICY ${op}_quotation_term_templates`)
    assert.ok(start >= 0, `${op} policy`)
    assert.match(
      CODE.slice(start, CODE.indexOf(';', start)),
      /has_permission\('sales\.quotations\.approve'\)/,
    )
  }
  // No seed rows.
  assert.doesNotMatch(CODE, /INSERT INTO public\.quotation_term_templates/)
})

test('quotations: number shapes, states, the outcome CHECKs, indexes', () => {
  const t = table('quotations')
  assert.match(
    t,
    /company_id uuid NOT NULL REFERENCES public\.companies\(id\) ON DELETE RESTRICT/,
  )
  assert.match(
    t,
    /project_id uuid REFERENCES public\.projects\(id\) ON DELETE RESTRICT/,
  )
  assert.match(
    t,
    /quote_number text NOT NULL UNIQUE\s+CONSTRAINT quotations_number_format\s+CHECK \(quote_number ~ '\^QT-\[0-9\]\{10,\}\$' OR quote_number ~ '\^QD-\[0-9\]\{4,\}\$'\)/,
  )
  assert.match(
    t,
    /status text NOT NULL DEFAULT 'draft'\s+CONSTRAINT quotations_status_check CHECK \(status IN \('draft', 'approved'\)\)/,
  )
  assert.match(t, /CHECK \(char_length\(notes\) <= 1000\)/)
  assert.match(t, /CHECK \(valid_until >= issue_date\)/)
  assert.match(
    t,
    /CHECK \(\(status = 'approved'\) = \(approved_at IS NOT NULL\)\)/,
  )
  assert.match(
    t,
    /quotations_approved_numbered\s+CHECK \(status <> 'approved' OR quote_number ~ '\^QT-'\)/,
  )
  assert.match(t, /CHECK \(outcome IN \('accepted', 'rejected'\)\)/)
  assert.match(t, /CHECK \(char_length\(outcome_note\) <= 500\)/)
  assert.match(t, /CHECK \(outcome IS NULL OR status = 'approved'\)/)
  assert.match(t, /CHECK \(\(outcome IS NULL\) = \(outcome_at IS NULL\)\)/)
  assert.match(CODE, /ON public\.quotations \(company_id\)/)
  assert.match(CODE, /ON public\.quotations \(updated_at DESC\)/)
  assert.match(
    CODE,
    /ON public\.quotations USING gin \(quote_number extensions\.gin_trgm_ops\)/,
  )
})

test('quotation_lines: a type once, three optional prices, at least one', () => {
  const t = table('quotation_lines')
  assert.match(
    t,
    /quotation_id uuid NOT NULL REFERENCES public\.quotations\(id\) ON DELETE CASCADE/,
  )
  assert.match(
    t,
    /equipment_type text NOT NULL\s+REFERENCES public\.equipment_types\(name\) ON UPDATE CASCADE ON DELETE RESTRICT/,
  )
  for (const col of ['daily_price', 'monthly_price', 'mob_demob_price']) {
    assert.match(
      t,
      new RegExp(
        `${col} numeric\\(12, 2\\)\\s+CONSTRAINT [a-z_]+ CHECK \\(${col} IS NULL OR ${col} >= 0\\)`,
      ),
    )
  }
  assert.match(
    t,
    /CHECK \(daily_price IS NOT NULL OR monthly_price IS NOT NULL OR mob_demob_price IS NOT NULL\)/,
  )
  assert.match(t, /CHECK \(char_length\(note\) <= 500\)/)
  assert.match(t, /UNIQUE \(quotation_id, equipment_type\)/)
  assert.doesNotMatch(t, /quantity|total/)
  assert.match(CODE, /ON public\.quotation_lines \(quotation_id, position\)/)
})

test('quotation_costs, quotation_terms and quotation_events', () => {
  const costs = table('quotation_costs')
  assert.match(costs, /CHECK \(char_length\(btrim\(name\)\) BETWEEN 1 AND 80\)/)
  assert.match(costs, /CHECK \(borne_by IN \('client', 'lessor'\)\)/)
  assert.match(CODE, /ON public\.quotation_costs \(quotation_id, position\)/)

  const terms = table('quotation_terms')
  assert.match(
    terms,
    /template_id uuid REFERENCES public\.quotation_term_templates\(id\) ON DELETE SET NULL/,
  )
  assert.match(terms, /BETWEEN 1 AND 120\)[\s\S]*BETWEEN 1 AND 1000\)/)
  assert.match(CODE, /ON public\.quotation_terms \(quotation_id, position\)/)

  const events = table('quotation_events')
  assert.match(events, /seq bigint GENERATED ALWAYS AS IDENTITY/)
  assert.match(
    events,
    /event_type IN \(\s+'created', 'updated', 'approved', 'approval_returned',\s+'outcome_set', 'outcome_cleared'\s+\)/,
  )
  assert.match(events, /actor_name text/)
  assert.doesNotMatch(events, /updated_at/)
  assert.match(
    CODE,
    /ON public\.quotation_events \(quotation_id, created_at, seq\)/,
  )
})

test('every editable table has updated_at with update_updated_at()', () => {
  for (const name of [
    'quotation_term_templates',
    'quotations',
    'quotation_lines',
    'quotation_costs',
    'quotation_terms',
  ]) {
    assert.match(table(name), /updated_at timestamptz NOT NULL DEFAULT now\(\)/)
    assert.match(
      CODE,
      new RegExp(
        `BEFORE UPDATE ON public\\.${name}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.update_updated_at\\(\\);`,
      ),
      name,
    )
  }
})

test('RLS: on everywhere, sales.view reads, no write policy on the document', () => {
  for (const name of TABLES) {
    assert.match(
      CODE,
      new RegExp(`ALTER TABLE public\\.${name} ENABLE ROW LEVEL SECURITY;`),
      name,
    )
  }
  for (const name of DOCUMENT_TABLES) {
    assert.match(
      CODE,
      new RegExp(
        `CREATE POLICY select_${name} ON public\\.${name}\\s+FOR SELECT TO authenticated\\s+USING \\(\\(SELECT public\\.has_permission\\('sales\\.view'\\)\\)\\);`,
      ),
      name,
    )
    assert.doesNotMatch(
      CODE,
      new RegExp(
        `CREATE POLICY [a-z_]+ ON public\\.${name}\\s+FOR (INSERT|UPDATE|DELETE|ALL)`,
      ),
      name,
    )
  }
  assert.match(
    CODE,
    /REVOKE ALL ON TABLE\s+public\.quotations, public\.quotation_lines, public\.quotation_costs,\s+public\.quotation_terms, public\.quotation_events\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    CODE,
    /GRANT SELECT ON TABLE\s+public\.quotations, public\.quotation_lines, public\.quotation_costs,\s+public\.quotation_terms, public\.quotation_events\s+TO authenticated;/,
  )
})

test('the counters: one row each, no client access, the two formats', () => {
  for (const name of [
    'quotation_number_sequence',
    'quotation_draft_sequence',
  ]) {
    assert.match(
      CODE,
      new RegExp(
        `CREATE TABLE public\\.${name} \\(\\s+singleton boolean PRIMARY KEY DEFAULT true\\s+CONSTRAINT ${name}_singleton CHECK \\(singleton\\),\\s+last_seq integer NOT NULL DEFAULT 0`,
      ),
    )
    assert.match(
      CODE,
      new RegExp(
        `REVOKE ALL ON TABLE public\\.${name} FROM PUBLIC, anon, authenticated;`,
      ),
    )
    assert.match(
      CODE,
      new RegExp(
        `INSERT INTO public\\.${name} \\(singleton, last_seq\\) VALUES \\(true, 0\\);`,
      ),
    )
    assert.doesNotMatch(CODE, new RegExp(`CREATE POLICY [^;]*${name}`))
  }
  assert.match(
    body('next_quotation_number'),
    /RETURN 'QT-'\s+\|\| to_char\(now\(\) AT TIME ZONE 'Asia\/Riyadh', 'YYYYMM'\)\s+\|\| lpad\(v_seq::text, 4, '0'\);/,
  )
  assert.match(
    body('next_quotation_draft_ref'),
    /RETURN 'QD-' \|\| lpad\(v_seq::text, 4, '0'\);/,
  )
})

test('definer hygiene: search_path, REVOKE, GRANT only to the callable', () => {
  for (const [name, sig] of Object.entries(CALLABLE)) {
    assert.match(
      head(name),
      /SECURITY DEFINER\s+SET search_path = public, pg_temp/,
      name,
    )
    assert.match(
      CODE,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(${esc(sig)}\\)\\s+FROM PUBLIC, anon;`,
      ),
      name,
    )
    assert.match(
      CODE,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\(${esc(sig)}\\)\\s+TO authenticated;`,
      ),
      name,
    )
    assert.match(
      CODE,
      new RegExp(`COMMENT ON FUNCTION public\\.${name}\\(${esc(sig)}\\) IS`),
      name,
    )
  }
  for (const [name, sig] of Object.entries(INTERNAL)) {
    assert.match(head(name), /SET search_path = public, pg_temp/, name)
    assert.match(
      CODE,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(${esc(sig)}\\)\\s+FROM PUBLIC, anon, authenticated;`,
      ),
      name,
    )
    assert.doesNotMatch(
      CODE,
      new RegExp(`GRANT [^;]*public\\.${name}\\b`),
      name,
    )
  }
})

test('the gates: sales.manage writes, the approve key approves and returns', () => {
  for (const name of [
    'save_quotation',
    'set_quotation_outcome',
    'delete_quotation',
    'copy_quotation',
  ]) {
    assert.match(
      body(name),
      /^AS \$\$[\s\S]*?BEGIN\s+PERFORM public\.assert_sales_manage\(\);/,
      name,
    )
  }
  for (const name of ['approve_quotation', 'return_quotation_approval']) {
    assert.match(
      body(name),
      /BEGIN\s+PERFORM public\.assert_quotation_approve\(\);/,
      name,
    )
  }
  assert.match(
    body('assert_quotation_approve'),
    /IF auth\.uid\(\) IS NULL OR NOT public\.has_permission\('sales\.quotations\.approve'\) THEN\s+RAISE EXCEPTION 'quotation_approve_required'\s+USING ERRCODE = '42501'/,
  )
})

test('save_quotation: every token, the draft reference after the checks', () => {
  const b = body('save_quotation')
  const tokens22023 = [
    'invalid_quotation',
    'invalid_company',
    'invalid_project',
    'invalid_dates',
    'invalid_notes',
    'quotation_has_no_lines',
    'invalid_lines',
    'invalid_equipment_type',
    'duplicate_equipment_type',
    'line_has_no_price',
    'invalid_note',
    'invalid_costs',
    'invalid_cost_name',
    'invalid_borne_by',
    'invalid_terms',
  ]
  for (const token of tokens22023) {
    assert.match(
      b,
      new RegExp(`RAISE EXCEPTION '${token}'\\s+USING ERRCODE = '22023'`),
      token,
    )
  }
  assert.match(
    b,
    /RAISE EXCEPTION 'quotation_approved_locked'\s+USING ERRCODE = '55000'/,
  )
  assert.match(
    body('quotation_price_value'),
    /RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023'/,
  )
  assert.match(b, /quotation_price_value\(v_item->'daily_price'\)/)
  assert.match(b, /quotation_price_value\(v_item->'monthly_price'\)/)
  assert.match(b, /quotation_price_value\(v_item->'mob_demob_price'\)/)
  assert.match(
    body('quotation_price_value'),
    /IF jsonb_typeof\(p_value\) <> 'number' THEN[\s\S]*IF v_price < 0 OR v_price > 9999999999\.99 THEN/,
  )

  // The row lock comes first; the draft reference only after the last check.
  assert.ok(b.indexOf('FOR UPDATE') < b.indexOf("'invalid_company'"))
  assert.ok(
    b.indexOf('next_quotation_draft_ref()') > b.lastIndexOf("'invalid_terms'"),
  )
  // Lines and costs are replaced wholesale. Of the terms, the stored copies
  // named in p_keep_term_ids stay exactly as they are (an edit never
  // refreshes a term from the template); the template rows no kept copy
  // stands for are copied with their CURRENT texts; one order for both.
  assert.match(
    b,
    /DELETE FROM public\.quotation_lines WHERE quotation_id = p_id;/,
  )
  assert.match(
    b,
    /DELETE FROM public\.quotation_costs WHERE quotation_id = p_id;/,
  )
  assert.match(
    b,
    /DELETE FROM public\.quotation_terms\s+WHERE quotation_id = p_id AND NOT \(id = ANY \(v_keep_ids\)\);/,
  )
  assert.match(
    b,
    /IF p_id IS NULL OR array_position\(p_keep_term_ids, NULL\) IS NOT NULL THEN\s+RAISE EXCEPTION 'invalid_terms'/,
  )
  assert.match(
    b,
    /WHERE k\.quotation_id = p_id AND k\.id = ANY \(v_keep_ids\);/,
  )
  assert.match(
    b,
    /FROM public\.quotation_term_templates t\s+WHERE t\.id = ANY \(v_term_ids\)\s+AND NOT EXISTS \(\s+SELECT 1 FROM public\.quotation_terms k\s+WHERE k\.quotation_id = v_id AND k\.template_id = t\.id/,
  )
  assert.match(
    b,
    /row_number\(\) OVER \(ORDER BY \(t\.id IS NULL\), t\.position, k\.position, k\.id\)/,
  )
  assert.match(SQL, /p_keep_term_ids uuid\[\] DEFAULT NULL/)
  assert.match(b, /updated_at = now\(\)/)
  assert.match(
    b,
    /'created',\s+jsonb_build_object\('quote_number', v_number, 'line_count', v_line_count\)/,
  )
  assert.match(
    b,
    /'updated',\s+jsonb_build_object\('line_count', v_line_count\)/,
  )
})

test('approve_quotation: number at the first approval, no self-approval rule', () => {
  const b = body('approve_quotation')
  assert.match(head('approve_quotation'), /RETURNS text/)
  assert.match(b, /RAISE EXCEPTION 'invalid_quotation' USING ERRCODE = '22023'/)
  assert.match(
    b,
    /RAISE EXCEPTION 'quotation_not_draft'\s+USING ERRCODE = '55000'/,
  )
  assert.match(
    b,
    /RAISE EXCEPTION 'quotation_has_no_lines'\s+USING ERRCODE = '55000'/,
  )
  assert.match(
    b,
    /IF v_q\.quote_number ~ '\^QD-\[0-9\]\{4,\}\$' THEN\s+v_draft_ref := v_q\.quote_number;\s+v_number := public\.next_quotation_number\(\);/,
  )
  // The quotation row before the counter.
  assert.ok(b.indexOf('FOR UPDATE') < b.indexOf('next_quotation_number()'))
  assert.match(b, /quote_number = v_number/)
  assert.match(b, /jsonb_build_object\('draft_ref', v_draft_ref\)/)
  assert.doesNotMatch(b, /self_approval|created_by = auth\.uid\(\)/)
  assert.match(b, /RETURN v_number;/)
})

test('return, outcome, delete and copy', () => {
  const ret = body('return_quotation_approval')
  assert.match(ret, /'quotation_not_approved'\s+USING ERRCODE = '55000'/)
  assert.match(ret, /RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023'/)
  assert.match(ret, /SET status = 'draft',[\s\S]*outcome = NULL/)
  assert.doesNotMatch(ret, /quote_number =/)
  assert.match(ret, /'approval_returned'/)

  const out = body('set_quotation_outcome')
  assert.match(out, /'quotation_not_approved'\s+USING ERRCODE = '55000'/)
  assert.match(out, /RAISE EXCEPTION 'invalid_outcome' USING ERRCODE = '22023'/)
  assert.match(out, /'outcome_cleared'/)
  assert.match(out, /'outcome_set'/)

  const del = body('delete_quotation')
  assert.match(del, /'quotation_approved_locked'\s+USING ERRCODE = '55000'/)
  assert.match(
    del,
    /IF v_q\.quote_number !~ '\^QD-\[0-9\]\{4,\}\$' THEN\s+RAISE EXCEPTION 'quotation_number_issued'\s+USING ERRCODE = '55000'/,
  )
  assert.match(del, /DELETE FROM public\.quotations WHERE id = p_id;/)

  const copy = body('copy_quotation')
  assert.match(head('copy_quotation'), /RETURNS uuid/)
  assert.ok(
    copy.indexOf('FOR UPDATE') < copy.indexOf('next_quotation_draft_ref()'),
  )
  assert.match(copy, /v_today \+ \(v_src\.valid_until - v_src\.issue_date\)/)
  assert.match(
    copy,
    /SELECT v_id, t\.template_id, t\.title_ar, t\.title_en, t\.body_ar, t\.body_en, t\.position\s+FROM public\.quotation_terms t/,
  )
  assert.match(
    copy,
    /'copied_from', v_src\.id,\s+'copied_from_number', v_src\.quote_number/,
  )
})

test('quotation_list: security_invoker, the state, the type names, grants', () => {
  const start = CODE.indexOf('CREATE OR REPLACE VIEW public.quotation_list')
  assert.ok(start >= 0)
  const view = CODE.slice(start, CODE.indexOf(';', start))
  assert.match(view, /WITH \(security_invoker = true\)/)
  for (const col of [
    'company_name_ar',
    'company_name_en',
    'project_name_ar',
    'project_name_en',
    'created_by_name',
    'approved_by_name',
    'state',
    'line_count',
    'type_names',
  ]) {
    assert.match(view, new RegExp(`\\b${col}\\b`), col)
  }
  assert.match(
    view,
    /WHEN q\.outcome = 'accepted' THEN 'accepted'\s+WHEN q\.outcome = 'rejected' THEN 'rejected'\s+WHEN q\.status = 'approved'\s+AND q\.valid_until < \(now\(\) AT TIME ZONE 'Asia\/Riyadh'\)::date THEN 'expired'/,
  )
  assert.match(
    view,
    /string_agg\(l\.equipment_type, '، ' ORDER BY l\.position, l\.id\)/,
  )
  assert.match(view, /public\.profile_names/)
  assert.match(CODE, /REVOKE ALL ON public\.quotation_list FROM PUBLIC, anon;/)
  assert.match(CODE, /GRANT SELECT ON public\.quotation_list TO authenticated;/)
})

test('the closing guard: key, admin, EXECUTE of anon / PUBLIC, RLS', () => {
  const start = CODE.lastIndexOf('DO $$')
  const guard = CODE.slice(start)
  assert.match(guard, /key = 'sales\.quotations\.approve'/)
  assert.match(guard, /role_key = 'admin'/)
  assert.match(guard, /has_function_privilege\('anon', v_fn, 'EXECUTE'\)/)
  assert.match(guard, /a\.grantee = 0/)
  assert.match(
    guard,
    /has_function_privilege\('authenticated', v_fn, 'EXECUTE'\)/,
  )
  assert.match(guard, /relrowsecurity/)
  for (const [name, sig] of Object.entries({ ...CALLABLE, ...INTERNAL })) {
    assert.ok(guard.includes(`'public.${name}(${sig})'`), name)
  }
  for (const name of TABLES) {
    assert.ok(guard.includes(`'public.${name}'`), name)
  }
})

test('every token raised is a whole message, and no hamza in Arabic copy', () => {
  for (const m of CODE.matchAll(/RAISE EXCEPTION '([^']*)'/g)) {
    if (m[1].startsWith('0199:')) continue
    assert.match(m[1], /^[a-z_]+$/, m[1])
  }
  assert.doesNotMatch(SQL, HAMZA_ALIF)
})
