const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0200: quotations without states. Owner 2026-11-17, «طيب مايحتاج
// التصنيف او الدورة, شيلها»: a quotation is a plain document — no draft /
// approved / accepted / rejected / expired, no approval, no client answer.
// The official number QT-YYYYMM#### is issued at CREATION, a quotation is
// always editable and deletable by sales.manage, a deleted number is never
// reused (quotation_deletions keeps what it was), and the key
// sales.quotations.approve gates the terms template only. 0199 stays as it
// was applied; tests/quotations0199.test.cjs keeps reading the 0199 file.

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const FILE = '20261117100000_0200_quotations_no_lifecycle.sql'
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8')
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

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The three writers that remain, with their exact signatures. */
const WRITERS = {
  save_quotation:
    'uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[]',
  delete_quotation: 'uuid',
  copy_quotation: 'uuid',
}
/** The functions of the lifecycle and of the draft reference. */
const DROPPED = {
  approve_quotation: 'uuid',
  return_quotation_approval: 'uuid, text',
  set_quotation_outcome: 'uuid, text, text',
  assert_quotation_approve: '',
  next_quotation_draft_ref: '',
}
const STATE_COLUMNS = [
  'status',
  'approved_at',
  'approved_by',
  'outcome',
  'outcome_at',
  'outcome_by',
  'outcome_note',
]
/** What no remaining body or view may read. */
const GONE =
  /\b(status|approved_at|approved_by|outcome|outcome_at|outcome_by|outcome_note|next_quotation_draft_ref|quotation_draft_sequence|assert_quotation_approve|approve_quotation|return_quotation_approval|set_quotation_outcome)\b/

test('0200 is a forward migration after 0199, which is not edited', () => {
  const files = fs.readdirSync(MIGRATIONS).sort()
  const i199 = files.indexOf('20261116100000_0199_quotations.sql')
  assert.ok(i199 >= 0, '0199 is still there')
  assert.ok(files.indexOf(FILE) > i199, '0200 sorts after 0199')
  // 0199 still describes the lifecycle it shipped with.
  const sql199 = fs.readFileSync(path.join(MIGRATIONS, files[i199]), 'utf8')
  assert.match(sql199, /CREATE OR REPLACE FUNCTION public\.approve_quotation\(/)
  // 0200 refuses to run without it.
  assert.match(
    CODE,
    /to_regclass\('public\.quotations'\) IS NULL[\s\S]*?RAISE EXCEPTION '0200: migration 0199 \(quotations\) is not applied'/,
  )
  assert.match(SQL, /مايحتاج التصنيف او الدورة, شيلها/)
})

test('the lifecycle functions and the draft reference are dropped', () => {
  for (const [name, args] of Object.entries(DROPPED)) {
    assert.match(
      CODE,
      new RegExp(`DROP FUNCTION IF EXISTS public\\.${name}\\(${esc(args)}\\);`),
      `${name} is dropped`,
    )
    assert.doesNotMatch(
      CODE,
      new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`),
      `${name} is not re-created`,
    )
  }
  assert.match(CODE, /DROP TABLE IF EXISTS public\.quotation_draft_sequence;/)
  // The official counter and its function stay (comments only).
  assert.doesNotMatch(
    CODE,
    /DROP TABLE IF EXISTS public\.quotation_number_sequence/,
  )
  assert.doesNotMatch(
    CODE,
    /CREATE (?:OR REPLACE )?FUNCTION public\.next_quotation_number\(/,
  )
  // The view goes before the columns it reads, and comes back later.
  assert.ok(
    CODE.indexOf('DROP VIEW IF EXISTS public.quotation_list;') <
      CODE.indexOf('DROP COLUMN IF EXISTS status'),
  )
})

test('quotations: the state columns and their CHECKs go, one number shape', () => {
  for (const column of STATE_COLUMNS) {
    assert.match(
      CODE,
      new RegExp(`DROP COLUMN IF EXISTS ${column}[,;]`),
      `${column} is dropped`,
    )
  }
  for (const check of [
    'quotations_approved_at_check',
    'quotations_approved_numbered',
    'quotations_outcome_approved_check',
    'quotations_outcome_at_check',
    'quotations_status_check',
    'quotations_outcome_check',
    'quotations_outcome_note_check',
  ]) {
    assert.match(CODE, new RegExp(`DROP CONSTRAINT IF EXISTS ${check}[,;]`))
  }
  // The number is the official one only.
  assert.match(
    CODE,
    /ADD CONSTRAINT quotations_number_format\s+CHECK \(quote_number ~ '\^QT-\[0-9\]\{10,\}\$'\);/,
  )
  assert.doesNotMatch(CODE, /\^QD-/)
  // Nothing else of the document is dropped.
  for (const kept of [
    'quotation_lines',
    'quotation_costs',
    'quotation_terms',
    'quotation_events',
    'quotation_term_templates',
  ]) {
    assert.doesNotMatch(CODE, new RegExp(`DROP TABLE[^;]*public\\.${kept}\\b`))
    assert.doesNotMatch(CODE, new RegExp(`ALTER TABLE public\\.${kept}\\b`))
  }
})

test('a row under a draft reference is converted in creation order', () => {
  const start = CODE.indexOf(
    'ALTER TABLE public.quotations DISABLE TRIGGER quotations_updated_at;',
  )
  const end = CODE.indexOf(
    'ALTER TABLE public.quotations ENABLE TRIGGER quotations_updated_at;',
  )
  assert.ok(start >= 0 && end > start, 'updated_at does not move')
  const block = CODE.slice(start, end)
  assert.match(block, /WHERE q\.quote_number !~ '\^QT-\[0-9\]\{10,\}\$'/)
  assert.match(block, /ORDER BY q\.created_at, q\.id/)
  // The same global counter, the Saudi month of the row's creation.
  assert.match(
    block,
    /UPDATE public\.quotation_number_sequence\s+SET last_seq = last_seq \+ 1\s+WHERE singleton\s+RETURNING last_seq INTO v_seq;/,
  )
  assert.match(
    block,
    /'QT-'\s+\|\| to_char\(r\.created_at AT TIME ZONE 'Asia\/Riyadh', 'YYYYMM'\)\s+\|\| lpad\(v_seq::text, 4, '0'\)/,
  )
  assert.match(block, /'reason', 'number_at_creation'/)
  assert.match(block, /'old_number', r\.quote_number/)
  // The conversion happens before the format CHECK is tightened.
  assert.ok(end < CODE.indexOf('ADD CONSTRAINT quotations_number_format'))
})

test('the key stays and is relabelled to the terms template only', () => {
  assert.match(
    CODE,
    /UPDATE public\.permissions\s+SET name_ar = 'المبيعات: قالب شروط عروض الاسعار',\s+name_en = 'Sales: quotation terms template',[\s\S]*?WHERE key = 'sales\.quotations\.approve';/,
  )
  // No new key, no grant change, no policy change of the template.
  assert.doesNotMatch(CODE, /INSERT INTO public\.permissions/)
  assert.doesNotMatch(CODE, /INSERT INTO public\.role_permissions/)
  assert.doesNotMatch(
    CODE,
    /DELETE FROM public\.(permissions|role_permissions)/,
  )
  assert.doesNotMatch(CODE, /POLICY \w+ ON public\.quotation_term_templates/)
})

test('quotation_deletions: append-only, read by sales.view, no client write', () => {
  const start = CODE.indexOf('CREATE TABLE public.quotation_deletions (')
  assert.ok(start >= 0)
  const table = CODE.slice(start, CODE.indexOf('\n);', start))
  for (const column of [
    'quotation_id uuid NOT NULL',
    'quote_number text NOT NULL',
    'lines jsonb NOT NULL',
    'costs jsonb NOT NULL',
    'terms jsonb NOT NULL',
    'events jsonb NOT NULL',
    'deleted_by uuid',
    'deleted_by_name text',
    'created_at timestamptz NOT NULL DEFAULT now()',
  ]) {
    assert.ok(table.includes(column), column)
  }
  // No foreign key (the quotation is gone) and no updated_at (append-only).
  assert.doesNotMatch(table, /REFERENCES/)
  assert.doesNotMatch(table, /updated_at/)
  assert.match(
    CODE,
    /ALTER TABLE public\.quotation_deletions ENABLE ROW LEVEL SECURITY;/,
  )
  assert.match(
    CODE,
    /CREATE POLICY select_quotation_deletions ON public\.quotation_deletions\s+FOR SELECT TO authenticated\s+USING \(\(SELECT public\.has_permission\('sales\.view'\)\)\);/,
  )
  assert.equal(
    (CODE.match(/CREATE POLICY \w+ ON public\.quotation_deletions/g) || [])
      .length,
    1,
    'a SELECT policy only',
  )
  assert.match(
    CODE,
    /REVOKE ALL ON TABLE public\.quotation_deletions FROM PUBLIC, anon, authenticated;\s+GRANT SELECT ON TABLE public\.quotation_deletions TO authenticated;/,
  )
})

test('definer hygiene of the three writers', () => {
  for (const [name, args] of Object.entries(WRITERS)) {
    const h = head(name)
    assert.match(h, /SECURITY DEFINER/, `${name} is a definer`)
    assert.match(h, /SET search_path = public, pg_temp/, `${name} search_path`)
    assert.match(
      CODE,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(${esc(args)}\\)\\s+FROM PUBLIC, anon;`,
      ),
      `${name} is revoked from PUBLIC and anon`,
    )
    assert.match(
      CODE,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\(${esc(args)}\\)\\s+TO authenticated;`,
      ),
      `${name} is granted to authenticated`,
    )
    const b = body(name)
    // The gate first, then the quotation row lock where a row is named.
    assert.match(
      b,
      /^AS \$\$\s+DECLARE[\s\S]*?BEGIN\s+PERFORM public\.assert_sales_manage\(\);/,
      `${name} checks sales.manage first`,
    )
    assert.doesNotMatch(b, GONE, `${name} reads nothing that was dropped`)
  }
})

test('save_quotation: the number at creation, any quotation is edited', () => {
  const h = head('save_quotation')
  // The 0199 parameters, unchanged (the screens call it the same way).
  assert.match(
    h,
    /p_id uuid,\s+p_company_id uuid,\s+p_project_id uuid,\s+p_issue_date date,\s+p_valid_until date,\s+p_notes text,\s+p_lines jsonb,\s+p_costs jsonb,\s+p_term_template_ids uuid\[\],\s+p_keep_term_ids uuid\[\] DEFAULT NULL\s+\)\s+RETURNS uuid/,
  )
  const b = body('save_quotation')
  // The official number, taken only after every validation.
  const number = b.indexOf('v_number := public.next_quotation_number();')
  assert.ok(number > 0)
  for (const token of [
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
  ]) {
    const at = b.indexOf(`RAISE EXCEPTION '${token}'`)
    assert.ok(at >= 0, `${token} is raised`)
    assert.ok(at < number, `${token} is checked before a number is taken`)
  }
  // An existing quotation is locked and edited whatever it is.
  assert.match(
    b,
    /IF p_id IS NOT NULL THEN\s+SELECT \* INTO v_q\s+FROM public\.quotations q\s+WHERE q\.id = p_id\s+FOR UPDATE;\s+IF NOT FOUND THEN\s+RAISE EXCEPTION 'invalid_quotation' USING ERRCODE = '22023';\s+END IF;\s+END IF;/,
  )
  assert.doesNotMatch(b, /quotation_approved_locked/)
  // The number of an edited quotation never changes.
  const update = b.slice(
    b.indexOf('UPDATE public.quotations'),
    b.indexOf('DELETE FROM public.quotation_lines'),
  )
  assert.doesNotMatch(update, /quote_number/)
  // The kept-terms rule of 0199 stays.
  assert.match(
    b,
    /DELETE FROM public\.quotation_terms\s+WHERE quotation_id = p_id AND NOT \(id = ANY \(v_keep_ids\)\);/,
  )
  // Only the two events that remain.
  assert.match(b, /record_quotation_event\(\s+v_id, 'created',/)
  assert.match(b, /record_quotation_event\(\s+v_id, 'updated',/)
})

test('delete_quotation: any quotation, recorded first, the counter untouched', () => {
  const b = body('delete_quotation')
  assert.doesNotMatch(b, /quotation_number_issued|quotation_approved_locked/)
  assert.doesNotMatch(b, /quote_number [!~]/)
  const record = b.indexOf('INSERT INTO public.quotation_deletions')
  const del = b.indexOf('DELETE FROM public.quotations WHERE id = p_id;')
  assert.ok(
    record > 0 && del > record,
    'the record is written before the delete',
  )
  assert.ok(b.indexOf('FOR UPDATE') < record, 'the row is locked first')
  for (const source of [
    'public.quotation_lines l',
    'public.quotation_costs c',
    'public.quotation_terms t',
    'public.quotation_events e',
  ]) {
    assert.ok(b.includes(`FROM ${source}`), `${source} is copied`)
  }
  assert.match(b, /auth\.uid\(\), v_actor_name/)
  // A deleted number is never reused: the sequence is not touched.
  assert.doesNotMatch(b, /quotation_number_sequence/)
})

test('copy_quotation: a new official number, dated today', () => {
  const b = body('copy_quotation')
  assert.match(b, /v_number := public\.next_quotation_number\(\);/)
  assert.match(b, /v_today \+ \(v_src\.valid_until - v_src\.issue_date\)/)
  assert.match(b, /'copied_from_number', v_src\.quote_number/)
  assert.ok(
    b.indexOf('FOR UPDATE') < b.indexOf('next_quotation_number'),
    'the source row is locked before the counter',
  )
})

test('quotation_list: security_invoker, no state, the grants', () => {
  const start = CODE.indexOf('CREATE VIEW public.quotation_list')
  assert.ok(start >= 0)
  const view = CODE.slice(start, CODE.indexOf(') ln ON true;', start))
  assert.match(view, /WITH \(security_invoker = true\)/)
  assert.doesNotMatch(view, GONE)
  assert.doesNotMatch(view, /\bstate\b|approved_by_name|\bCASE\b/)
  const columns = view
    .slice(view.indexOf('SELECT') + 6, view.indexOf('FROM public.quotations q'))
    .split(',\n')
    .map((c) =>
      c
        .trim()
        .split(/\s+AS\s+/)
        .pop()
        .replace(/^(q|ln)\./, ''),
    )
  assert.deepEqual(columns, [
    'id',
    'company_id',
    'project_id',
    'quote_number',
    'issue_date',
    'valid_until',
    'notes',
    'created_by',
    'created_at',
    'updated_at',
    'company_name_ar',
    'company_name_en',
    'project_name_ar',
    'project_name_en',
    'created_by_name',
    'line_count',
    'type_names',
  ])
  assert.match(
    CODE,
    /REVOKE ALL ON public\.quotation_list FROM PUBLIC, anon;\s+GRANT SELECT ON public\.quotation_list TO authenticated;/,
  )
})

test('the closing guard aborts if something of the lifecycle is left', () => {
  const guard = CODE.slice(CODE.lastIndexOf('DO $$'))
  for (const name of Object.keys(DROPPED)) {
    assert.ok(guard.includes(`'public.${name}(`), `${name} is checked gone`)
  }
  assert.match(
    guard,
    /to_regclass\('public\.quotation_draft_sequence'\) IS NOT NULL/,
  )
  for (const column of [...STATE_COLUMNS, 'state', 'approved_by_name']) {
    assert.ok(guard.includes(`'${column}'`), `${column} is checked gone`)
  }
  assert.match(guard, /q\.quote_number !~ '\^QT-\[0-9\]\{10,\}\$'/)
  assert.match(guard, /p\.prosrc ~ v_gone/)
  assert.match(
    guard,
    /pg_get_viewdef\('public\.quotation_list'::regclass\) ~ v_gone/,
  )
  assert.match(guard, /has_function_privilege\('anon', v_fn, 'EXECUTE'\)/)
  assert.match(
    guard,
    /NOT has_function_privilege\('authenticated', v_fn, 'EXECUTE'\)/,
  )
  assert.match(guard, /c\.relrowsecurity/)
  assert.match(guard, /'public\.quotation_deletions'/)
  assert.match(guard, /name_ar = 'المبيعات: قالب شروط عروض الاسعار'/)
  assert.match(CODE, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('tokens are whole messages, and no hamza in the Arabic copy', () => {
  const raised = new Set(
    [...CODE.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((m) => m[1]),
  )
  assert.deepEqual([...raised].sort(), [
    'duplicate_equipment_type',
    'invalid_borne_by',
    'invalid_company',
    'invalid_cost_name',
    'invalid_costs',
    'invalid_dates',
    'invalid_equipment_type',
    'invalid_lines',
    'invalid_note',
    'invalid_notes',
    'invalid_project',
    'invalid_quotation',
    'invalid_terms',
    'line_has_no_price',
    'quotation_has_no_lines',
  ])
  // The Arabic the migration STORES (the key's label and description, and
  // the label once more in the closing guard).
  const stored = [...CODE.matchAll(/(?:name_ar|description_ar) = '([^']+)'/g)]
  assert.equal(stored.length, 3)
  for (const [, text] of stored) {
    assert.doesNotMatch(text, HAMZA_ALIF)
  }
})
