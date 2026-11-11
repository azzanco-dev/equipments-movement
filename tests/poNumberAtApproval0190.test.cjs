const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0190 (owner decisions 2026-11-11): «الحين المفروض انه رقم الPO
// مايصدر الا اذا جاء الاعتماد», «اعتمد, وبرضه اشتغل على القديم … فممكن تلغي
// الارقام من المسودات, بحيث لو صار اعتماد ينشى لها رقم po», «اعادة ترقيم
// المعتمدة», «po العملاء ممكن مايكون له رقم». A supplier PO carries a draft
// reference DRAFT-#### until its first approval issues PO-YYYYMM####; a
// client PO created without the client's number takes CPO-####.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

const SQL = read(
  'supabase',
  'migrations',
  '20261111110000_0190_po_number_at_approval.sql',
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
  return CODE.slice(start, CODE.indexOf('AS $$', start))
}

/** The backfill: from the temporary mapping table to the guard's end. */
const BACKFILL = CODE.slice(
  CODE.indexOf('CREATE TEMPORARY TABLE supplier_po_renumber_0190'),
  CODE.indexOf('CREATE TABLE public.client_po_ref_sequence'),
)

const CALLABLE = [
  'create_supplier_po',
  'approve_supplier_po',
  'approve_equipment_card_pricing',
  'create_client_po',
]
const COUNTERS = ['next_supplier_po_draft_ref', 'next_client_po_ref']

test('the two CHECKs: two shapes, and an approved PO is always numbered', () => {
  assert.match(
    CODE,
    /ALTER TABLE public\.supplier_pos\s+DROP CONSTRAINT supplier_pos_number_format;/,
  )
  assert.match(
    CODE,
    /ADD CONSTRAINT supplier_pos_number_format CHECK \(\s*po_number ~ '\^PO-\[0-9\]\{10,\}\$'\s+OR po_number ~ '\^DRAFT-\[0-9\]\{4,\}\$'\s*\)/,
  )
  assert.match(
    CODE,
    /ADD CONSTRAINT supplier_pos_approved_numbered CHECK \(\s*approval_status <> 'approved'\s+OR po_number ~ '\^PO-\[0-9\]\{10,\}\$'\s*\)/,
  )
  // Dropped before the renumbering, re-added after it.
  assert.ok(
    CODE.indexOf('DROP CONSTRAINT supplier_pos_number_format') <
      CODE.indexOf('UPDATE public.supplier_pos p'),
  )
  assert.ok(
    CODE.indexOf('ADD CONSTRAINT supplier_pos_number_format') >
      CODE.lastIndexOf('UPDATE public.supplier_pos p'),
  )
})

test('the two counter tables are hardened like supplier_po_sequence (0173)', () => {
  for (const table of [
    'supplier_po_draft_sequence',
    'client_po_ref_sequence',
  ]) {
    assert.match(
      CODE,
      new RegExp(
        `CREATE TABLE public\\.${table} \\(\\s+singleton boolean PRIMARY KEY DEFAULT true\\s+CONSTRAINT ${table}_singleton CHECK \\(singleton\\),\\s+last_seq integer NOT NULL DEFAULT 0\\s+CONSTRAINT ${table}_last_seq_check CHECK \\(last_seq >= 0\\)\\s+\\);`,
      ),
      table,
    )
    assert.match(
      CODE,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`),
    )
    assert.match(
      CODE,
      new RegExp(
        `REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated;`,
      ),
    )
    assert.doesNotMatch(CODE, new RegExp(`CREATE POLICY [^;]*${table}`))
    assert.doesNotMatch(CODE, new RegExp(`GRANT [^;]*public\\.${table}\\b`))
  }
  // The draft counter starts at the OLD official sequence, read in A1 before
  // the backfill overwrites it.
  const seed = CODE.indexOf('INSERT INTO public.supplier_po_draft_sequence')
  assert.ok(seed >= 0)
  assert.match(
    CODE.slice(seed, CODE.indexOf(';', seed)),
    /SELECT true, s\.last_seq\s+FROM public\.supplier_po_sequence s/,
  )
  assert.ok(seed < CODE.indexOf('UPDATE public.supplier_po_sequence'))
  assert.match(
    CODE,
    /INSERT INTO public\.client_po_ref_sequence \(singleton, last_seq\) VALUES \(true, 0\);/,
  )
})

test('the counter functions: references, no EXECUTE for anyone', () => {
  assert.match(
    body('next_supplier_po_draft_ref'),
    /UPDATE public\.supplier_po_draft_sequence\s+SET last_seq = last_seq \+ 1/,
  )
  assert.match(
    body('next_supplier_po_draft_ref'),
    /RETURN 'DRAFT-' \|\| lpad\(v_seq::text, 4, '0'\);/,
  )
  assert.match(
    body('next_client_po_ref'),
    /UPDATE public\.client_po_ref_sequence\s+SET last_seq = last_seq \+ 1/,
  )
  assert.match(
    body('next_client_po_ref'),
    /RETURN 'CPO-' \|\| lpad\(v_seq::text, 4, '0'\);/,
  )
  for (const name of COUNTERS) {
    assert.match(
      head(name),
      /SECURITY DEFINER\s+SET search_path = public, pg_temp/,
      name,
    )
    assert.match(
      CODE,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(\\)\\s+FROM PUBLIC, anon, authenticated;`,
      ),
      name,
    )
    assert.doesNotMatch(
      CODE,
      new RegExp(`GRANT [^;]*public\\.${name}\\b`),
      name,
    )
    assert.match(
      CODE,
      new RegExp(`COMMENT ON FUNCTION public\\.${name}\\(\\) IS`),
      name,
    )
  }
  // next_supplier_po_number keeps its body and grants: only the comment.
  assert.doesNotMatch(
    CODE,
    /FUNCTION public\.next_supplier_po_number\(\)\s+RETURNS/,
  )
  assert.doesNotMatch(CODE, /(GRANT|REVOKE)[^;]*next_supplier_po_number/)
  assert.match(
    CODE,
    /COMMENT ON FUNCTION public\.next_supplier_po_number\(\) IS\s+'0173\/0190: [^;]*FIRST approval/,
  )
})

test('create_supplier_po takes a draft reference, never the official number', () => {
  const b = body('create_supplier_po')
  assert.match(b, /v_number := public\.next_supplier_po_draft_ref\(\);/)
  assert.doesNotMatch(b, /next_supplier_po_number/)
  // The created event keeps the key po_number.
  assert.match(b, /'created',\s+jsonb_build_object\(\s+'po_number', v_number,/)
  // The 0157 signature, parameters and defaults kept.
  assert.match(
    head('create_supplier_po'),
    /create_supplier_po\(\s+p_lessor_id uuid,\s+p_owner_class text,\s+p_company_id uuid,\s+p_project_id uuid,\s+p_start_date date,\s+p_notes text DEFAULT NULL,\s+p_equipment jsonb DEFAULT '\[\]'::jsonb\s+\)/,
  )
  assert.match(b, /PERFORM public\.assert_purchasing_manage\(\);/)
  assert.match(b, /PERFORM public\.add_supplier_po_equipment\(/)
})

test('approve_supplier_po issues the number only in place of a draft reference', () => {
  const b = body('approve_supplier_po')
  assert.match(
    b,
    /IF v_po\.po_number ~ '\^DRAFT-\[0-9\]\{4,\}\$' THEN\s+v_draft_ref := v_po\.po_number;\s+v_number := public\.next_supplier_po_number\(\);\s+ELSE\s+v_number := v_po\.po_number;\s+END IF;/,
  )
  assert.equal(b.match(/next_supplier_po_number/g).length, 1)
  assert.match(
    b,
    /approved_by = auth\.uid\(\),\s+po_number = v_number\s+WHERE id = p_po_id;/,
  )
  assert.match(
    b,
    /jsonb_build_object\('line_count', v_lines, 'po_number', v_number\)/,
  )
  assert.match(
    b,
    /WHEN v_draft_ref IS NOT NULL THEN jsonb_build_object\('draft_ref', v_draft_ref\)/,
  )
  // The 0189 checks stay, and the number comes after all of them.
  for (const token of [
    'purchasing_approve_required',
    'invalid_po',
    'po_not_draft',
    'po_self_approval',
    'po_has_no_lines',
    'po_has_unpriced_lines',
  ]) {
    assert.ok(b.indexOf(`'${token}'`) >= 0, token)
    assert.ok(
      b.indexOf(`'${token}'`) < b.indexOf('next_supplier_po_number'),
      token,
    )
  }
  assert.match(b, /FOR UPDATE;/)
})

test('approve_equipment_card_pricing issues the number when its linkage approves the PO', () => {
  const b = body('approve_equipment_card_pricing')
  assert.match(
    b,
    /v_po_number := v_po\.po_number;\s+IF v_po_approved AND v_po\.po_number ~ '\^DRAFT-\[0-9\]\{4,\}\$' THEN\s+v_draft_ref := v_po\.po_number;\s+v_po_number := public\.next_supplier_po_number\(\);\s+END IF;/,
  )
  assert.equal(b.match(/next_supplier_po_number/g).length, 1)
  // Decided before the card event, which carries the final number.
  assert.ok(
    b.indexOf('next_supplier_po_number') < b.indexOf("'pricing_approved'"),
  )
  assert.match(b, /'supplier_po_number', v_po_number,/)
  assert.doesNotMatch(b, /'supplier_po_number', v_po\.po_number/)
  assert.match(
    b,
    /approved_by = auth\.uid\(\),\s+po_number = v_po_number\s+WHERE id = v_po\.id;/,
  )
  assert.match(
    b,
    /'via', 'card_pricing',\s+'card_id', p_card_id,\s+'line_count', v_line_count,\s+'po_number', v_po_number\s+\)/,
  )
  assert.match(
    b,
    /WHEN v_draft_ref IS NOT NULL THEN jsonb_build_object\('draft_ref', v_draft_ref\)/,
  )
  // Locks: the card row, then the PO row.
  const cardLock = b.indexOf(
    'FROM public.equipment_cards c\n  WHERE c.id = p_card_id\n  FOR UPDATE',
  )
  const poLock = b.indexOf('WHERE p.id = v_line.supplier_po_id\n  FOR UPDATE')
  assert.ok(cardLock >= 0 && poLock > cardLock)
  // The 0189 rule of the latest PO's line stays.
  assert.match(b, /ORDER BY sp\.created_at DESC, sp\.id DESC/)
})

test('the return functions are not re-created: a returned PO keeps its number', () => {
  assert.doesNotMatch(CODE, /FUNCTION public\.return_supplier_po_approval\(/)
  assert.doesNotMatch(CODE, /FUNCTION public\.return_equipment_card_pricing\(/)
})

test('the backfill: numbered by first approval, drafts keep their digits', () => {
  // The numbered set: approved now OR with an approved event.
  assert.match(
    BACKFILL,
    /WHERE p\.approval_status = 'approved'\s+OR EXISTS \(\s+SELECT 1\s+FROM public\.supplier_po_events e\s+WHERE e\.supplier_po_id = p\.id\s+AND e\.event_type = 'approved'\s+\)/,
  )
  // Ordered by the first approval (earliest approved event, else approved_at), then id.
  assert.match(
    BACKFILL,
    /COALESCE\(\s+\(SELECT min\(e\.created_at\)\s+FROM public\.supplier_po_events e\s+WHERE e\.supplier_po_id = p\.id\s+AND e\.event_type = 'approved'\),\s+p\.approved_at\s+\) AS approved_first/,
  )
  assert.match(
    BACKFILL,
    /'PO-'\s+\|\| to_char\(f\.approved_first AT TIME ZONE 'Asia\/Riyadh', 'YYYYMM'\)\s+\|\| lpad\(\(row_number\(\) OVER \(ORDER BY f\.approved_first, f\.id\)\)::text, 4, '0'\)/,
  )
  // The others: DRAFT- + the sequence digits of the current number.
  assert.match(
    BACKFILL,
    /ELSE 'DRAFT-' \|\| substring\(p\.po_number FROM '\^PO-\[0-9\]\{6\}\(\[0-9\]\{4,\}\)\$'\)/,
  )
})

test('the backfill: collision-free under UNIQUE, updated_at untouched, events', () => {
  const disable = BACKFILL.indexOf(
    'ALTER TABLE public.supplier_pos DISABLE TRIGGER supplier_pos_updated_at;',
  )
  const enable = BACKFILL.indexOf(
    'ALTER TABLE public.supplier_pos ENABLE TRIGGER supplier_pos_updated_at;',
  )
  const tmp = BACKFILL.indexOf("SET po_number = 'TMP0190-' || p.id::text")
  const final = BACKFILL.indexOf('SET po_number = r.new_number')
  assert.ok(disable >= 0 && tmp > disable && final > tmp && enable > final)
  // Only the rows whose number changes are touched.
  assert.equal(
    BACKFILL.match(/AND r\.new_number IS DISTINCT FROM r\.old_number;/g).length,
    2,
  )
  // One renumbered event per changed PO, with the reason and no actor.
  assert.match(
    BACKFILL,
    /'renumbered',\s+jsonb_build_object\(\s+'old_number', r\.old_number,\s+'new_number', r\.new_number,\s+'reason', 'number_at_approval'\s+\),\s+NULL\s+FROM supplier_po_renumber_0190 r\s+WHERE r\.new_number IS DISTINCT FROM r\.old_number;/,
  )
  assert.match(BACKFILL, /DROP TABLE supplier_po_renumber_0190;/)
})

test('the backfill sets both counters', () => {
  assert.match(
    BACKFILL,
    /UPDATE public\.supplier_po_sequence\s+SET last_seq = \(\s+SELECT count\(\*\)\s+FROM public\.supplier_pos p\s+WHERE p\.po_number ~ '\^PO-\[0-9\]\{10,\}\$'\s+\)/,
  )
  assert.match(
    BACKFILL,
    /UPDATE public\.supplier_po_draft_sequence\s+SET last_seq = GREATEST\(\s+last_seq,\s+COALESCE\(\(\s+SELECT max\(substring\(p\.po_number FROM 7\)::integer\)/,
  )
})

test('the final guard aborts on any broken invariant', () => {
  const guard = BACKFILL.slice(BACKFILL.lastIndexOf('DO $$'))
  assert.match(
    guard,
    /approval_status = 'approved'\s+AND po_number !~ '\^PO-\[0-9\]\{10,\}\$'/,
  )
  assert.match(guard, /count\(DISTINCT d\.seq\)/)
  assert.match(
    guard,
    /v_min IS DISTINCT FROM 1 OR v_max IS DISTINCT FROM v_count/,
  )
  assert.match(guard, /v_seq IS DISTINCT FROM v_count/)
  assert.match(
    guard,
    /never-approved supplier PO\(s\) still hold an official number/,
  )
  assert.match(guard, /match neither PO-… nor DRAFT-…/)
  assert.equal(guard.match(/RAISE EXCEPTION/g).length, 4)
  // The guard comes after the CHECKs are added: it is the end of section A.
  assert.ok(
    CODE.indexOf('ADD CONSTRAINT supplier_pos_approved_numbered') <
      CODE.indexOf(
        guard.slice(0, 40),
        CODE.indexOf('supplier_pos_approved_numbered'),
      ),
  )
})

test('create_client_po: a blank number takes CPO-####, the other refusals stay', () => {
  const b = body('create_client_po')
  assert.match(
    b,
    /IF v_number IS NOT NULL AND char_length\(v_number\) > 60 THEN\s+RAISE EXCEPTION 'invalid_po_number'/,
  )
  assert.doesNotMatch(b, /IF v_number IS NULL OR char_length/)
  assert.match(
    b,
    /LOOP\s+v_number := public\.next_client_po_ref\(\);\s+EXIT WHEN NOT EXISTS \(\s+SELECT 1 FROM public\.client_pos p\s+WHERE p\.company_id = p_company_id\s+AND upper\(btrim\(p\.po_number\)\) = upper\(v_number\)\s+\);\s+END LOOP;/,
  )
  // A given number that the client already uses is still refused.
  assert.equal(b.match(/'duplicate_po_number'/g).length, 2)
  assert.match(b, /WHEN unique_violation THEN/)
  // The 0169 signature and defaults kept.
  assert.match(
    head('create_client_po'),
    /create_client_po\(\s+p_company_id uuid,\s+p_project_id uuid,\s+p_po_number text,\s+p_issue_date date,\s+p_expiry_date date DEFAULT NULL,\s+p_standard_hours integer DEFAULT 260,\s+p_notes text DEFAULT NULL,\s+p_equipment jsonb DEFAULT '\[\]'::jsonb\s+\)/,
  )
  assert.match(b, /PERFORM public\.assert_sales_manage\(\);/)
  // No client backfill.
  assert.doesNotMatch(CODE, /UPDATE public\.client_pos/)
})

test('every callable function: definer, fixed search_path, the same grants', () => {
  for (const name of CALLABLE) {
    assert.match(
      head(name),
      /SECURITY DEFINER\s+SET search_path = public, pg_temp/,
      name,
    )
    assert.match(
      CODE,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\)\\s+FROM PUBLIC, anon;\\s+GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s+TO authenticated;`,
      ),
      name,
    )
    assert.match(
      CODE,
      new RegExp(`COMMENT ON FUNCTION public\\.${name}\\(`),
      name,
    )
  }
  assert.equal(
    CODE.match(/CREATE (?:OR REPLACE )?FUNCTION/g).length,
    CALLABLE.length + COUNTERS.length,
  )
  assert.doesNotMatch(CODE, /GRANT [^;]* TO (anon|PUBLIC)\b/)
})

test('no new permission key, no policy, no hamza in the new copy', () => {
  assert.doesNotMatch(CODE, /INSERT INTO public\.permissions/)
  assert.doesNotMatch(CODE, /\b(CREATE|ALTER|DROP) POLICY\b/)
  assert.doesNotMatch(CODE, HAMZA_ALIF)
})
