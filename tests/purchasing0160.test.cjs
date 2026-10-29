// Migration 0160 (owner 2026-10-28, EM-107): supplier POs start as a draft
// and are approved by a holder of `purchasing.approve` who did not create
// them, once every line is priced; an approved PO is locked (notes and
// closing stay); a draft's PDF is marked «مسودة - غير معتمد» (owner 2026-10-29).
//
// Source checks plus the pure helpers.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261028160000_0160_supplier_po_approval.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const raw = read('supabase', 'migrations', MIGRATION)
const sql = norm(raw)

/** One function of a migration, from its CREATE to the closing `$$;`. */
const fn = (source, head) => {
  const start = source.indexOf(head)
  assert.ok(start >= 0, head)
  return source.slice(start, source.indexOf('$$;', source.indexOf('$$', start) + 2) + 3)
}

/** Expected body: the source's, with each [from, to] applied once. */
const withAdditions = (body, additions) => {
  let out = body
  for (const [from, to] of additions) {
    assert.ok(out.includes(from), from)
    out = out.replace(from, () => to)
  }
  return out
}

function loadLib(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(root, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Intl,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLib(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

const LOCK =
  "IF v_po.approval_status = 'approved' THEN RAISE EXCEPTION 'po_approved_locked' USING ERRCODE = '55000', HINT = 'An approved PO is locked; close it and create a new one.'; END IF;"
const LINE_LOCK =
  "IF v_approval = 'approved' THEN RAISE EXCEPTION 'po_approved_locked' USING ERRCODE = '55000', HINT = 'An approved PO is locked; close it and create a new one.'; END IF;"

test('0160 is the single 0160 migration, after 0159', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0160 present')
  assert.match(migrations[at - 1], /_0159_/)
  assert.equal(migrations.filter((file) => /_0160_/.test(file)).length, 1)
})

test('the approval state: draft by default, approved with its time and approver', () => {
  assert.match(
    sql,
    /ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'draft' CONSTRAINT supplier_pos_approval_status_check CHECK \(approval_status IN \('draft', 'approved'\)\), ADD COLUMN IF NOT EXISTS approved_at timestamptz, ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public\.profiles\(id\) ON DELETE SET NULL;/,
  )
  assert.match(sql, /CHECK \(\(approval_status = 'approved'\) = \(approved_at IS NOT NULL\)\)/)
  // Every existing PO stays a draft: no data update of the state.
  assert.doesNotMatch(sql, /UPDATE public\.supplier_pos SET approval_status = 'approved' WHERE (?!id = p_po_id)/)
  // The 0149 event list plus `approved`.
  assert.match(
    sql,
    /event_type IN \( 'created', 'updated', 'equipment_added', 'price_changed', 'line_updated', 'card_changed', 'equipment_removed', 'approved', 'closed', 'reopened' \)/,
  )
})

test('the key: purchasing.approve, requires view, enforced in the database, held by admin', () => {
  assert.match(
    sql,
    /'purchasing\.approve', 'purchasing', 'المشتريات: اعتماد اوامر الشراء', 'Purchasing: approve purchase orders',/,
  )
  assert.match(sql, /false, NULL, ARRAY\['purchasing\.view'\], false, 'database', 1020 \) ON CONFLICT \(key\) DO NOTHING;/)
  assert.match(sql, /VALUES \('admin', 'purchasing\.approve', NULL\) ON CONFLICT \(role_key, permission_key\) DO NOTHING;/)
  // New Arabic copy: plain alif only.
  const insert = raw.slice(raw.indexOf("'purchasing.approve', 'purchasing'"), raw.indexOf('ON CONFLICT (key)'))
  assert.doesNotMatch(insert, /[أإآ]/)
})

test('approve_supplier_po: permission, open draft, not the creator, lines all priced', () => {
  const body = fn(sql, 'CREATE OR REPLACE FUNCTION public.approve_supplier_po(')
  assert.match(body, /SECURITY DEFINER SET search_path = public, pg_temp/)
  const order = [
    "IF auth.uid() IS NULL OR NOT public.has_permission('purchasing.approve') THEN RAISE EXCEPTION 'purchasing_approve_required' USING ERRCODE = '42501'",
    'WHERE p.id = p_po_id FOR UPDATE;',
    "RAISE EXCEPTION 'invalid_po'",
    "IF v_po.status <> 'open' THEN RAISE EXCEPTION 'po_closed'",
    "IF v_po.approval_status <> 'draft' THEN RAISE EXCEPTION 'po_not_draft'",
    "IF v_po.created_by IS NOT NULL AND v_po.created_by = auth.uid() THEN RAISE EXCEPTION 'po_self_approval' USING ERRCODE = '42501'",
    'SELECT count(*), count(*) FILTER (WHERE l.price IS NULL) INTO v_lines, v_unpriced',
    "IF v_lines = 0 THEN RAISE EXCEPTION 'po_has_no_lines'",
    "IF v_unpriced > 0 THEN RAISE EXCEPTION 'po_has_unpriced_lines'",
    "SET approval_status = 'approved', approved_at = now(), approved_by = auth.uid() WHERE id = p_po_id;",
    "p_po_id, 'approved', jsonb_build_object('line_count', v_lines), auth.uid()",
  ]
  let at = 0
  for (const piece of order) {
    const found = body.indexOf(piece, at)
    assert.ok(found >= at, piece)
    at = found
  }
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.approve_supplier_po\(uuid\) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\.approve_supplier_po\(uuid\) TO authenticated;/)
})

test('the writers: their latest bodies plus the lock of an approved PO', () => {
  const m0157 = norm(read('supabase', 'migrations', '20261028120000_0157_supplier_po_rate_unit.sql'))
  const m0138 = norm(read('supabase', 'migrations', '20261020100000_0138_supplier_po_party_and_optional_price.sql'))
  const m0148 = norm(read('supabase', 'migrations', '20261025100000_0148_supplier_po_same_entry_day.sql'))

  const add = 'CREATE OR REPLACE FUNCTION public.add_supplier_po_equipment('
  assert.equal(
    fn(sql, add),
    withAdditions(fn(m0157, add), [
      [
        "IF v_po.status <> 'open' THEN RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000'; END IF;",
        `IF v_po.status <> 'open' THEN RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000'; END IF; ${LOCK}`,
      ],
    ]),
  )

  const line = 'CREATE OR REPLACE FUNCTION public.update_supplier_po_equipment('
  assert.equal(
    fn(sql, line),
    withAdditions(fn(m0157, line), [
      ['v_rate_unit text; BEGIN', 'v_rate_unit text; v_approval text; BEGIN'],
      ['SELECT p.status INTO v_status', 'SELECT p.status, p.approval_status INTO v_status, v_approval'],
      [
        "IF v_status <> 'open' THEN RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000'; END IF;",
        `IF v_status <> 'open' THEN RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000'; END IF; ${LINE_LOCK}`,
      ],
    ]),
  )

  const price = 'CREATE OR REPLACE FUNCTION public.update_supplier_po_equipment_price('
  assert.equal(
    fn(sql, price),
    withAdditions(fn(m0138, price), [
      ['v_equipment_id uuid; BEGIN', 'v_equipment_id uuid; v_approval text; BEGIN'],
      ['SELECT p.status INTO v_status', 'SELECT p.status, p.approval_status INTO v_status, v_approval'],
      [
        "IF v_status <> 'open' THEN RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000'; END IF;",
        `IF v_status <> 'open' THEN RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000'; END IF; ${LINE_LOCK}`,
      ],
    ]),
  )

  // update_supplier_po: only a CHANGED start date is refused; notes stay.
  const po = 'CREATE OR REPLACE FUNCTION public.update_supplier_po('
  assert.equal(
    fn(sql, po),
    withAdditions(fn(m0148, po), [
      [
        'IF p_start_date <> v_po.start_date AND EXISTS (',
        "IF v_po.approval_status = 'approved' AND p_start_date <> v_po.start_date THEN RAISE EXCEPTION 'po_approved_locked' USING ERRCODE = '55000', HINT = 'An approved PO is locked; close it and create a new one.'; END IF; IF p_start_date <> v_po.start_date AND EXISTS (",
      ],
    ]),
  )

  // close_supplier_po and create_supplier_po are not touched.
  assert.doesNotMatch(sql, /FUNCTION public\.(close_supplier_po|create_supplier_po)\(/)
  for (const sig of [
    'add_supplier_po_equipment\\(uuid, uuid, numeric, text, text\\)',
    'update_supplier_po_equipment\\(uuid, numeric, text, text\\)',
    'update_supplier_po_equipment_price\\(uuid, numeric\\)',
    'update_supplier_po\\(uuid, date, text\\)',
  ])
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated;`), sig)
})

test('the site units view offers a party PO only while it is a draft', () => {
  const before = norm(read('supabase', 'migrations', '20261025100000_0148_supplier_po_same_entry_day.sql'))
  const view = (source) =>
    source.slice(
      source.indexOf('CREATE OR REPLACE VIEW public.purchasing_site_units'),
      source.indexOf("AND v.movement_context = 'site';") + 30,
    )
  const condition = "AND p.approval_status = 'draft' "
  assert.ok(view(sql).includes(`AND p.start_date = (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date ${condition}`))
  assert.equal(view(sql).replace(condition, ''), view(before))
})

test('the pure helpers: why approval cannot run, and the list badge', () => {
  const lib = loadLib('purchasing')
  const po = { status: 'open', approval_status: 'draft', created_by: 'creator' }
  const priced = [{ price: 100 }, { price: '50' }]
  assert.equal(lib.supplierPoApprovalBlocker(po, priced, 'approver'), null)
  assert.equal(lib.supplierPoApprovalBlocker({ ...po, status: 'closed' }, priced, 'approver'), 'supplierPoErrorClosed')
  assert.equal(lib.supplierPoApprovalBlocker({ ...po, approval_status: 'approved' }, priced, 'approver'), 'supplierPoErrorNotDraft')
  assert.equal(lib.supplierPoApprovalBlocker(po, priced, 'creator'), 'supplierPoApproveBlockedSelf')
  assert.equal(lib.supplierPoApprovalBlocker(po, [], 'approver'), 'supplierPoApproveBlockedNoLines')
  assert.equal(lib.supplierPoApprovalBlocker(po, [{ price: null }, { price: 5 }], 'approver'), 'supplierPoApproveBlockedUnpriced')
  // A PO whose creator is gone can be approved by anyone holding the key.
  assert.equal(lib.supplierPoApprovalBlocker({ ...po, created_by: null }, priced, 'approver'), null)

  assert.deepEqual(plain(lib.supplierPoApprovalListBadge({ status: 'open', approval_status: 'approved' })), {
    key: 'supplierPoApprovalApproved',
    tone: 'info',
  })
  assert.deepEqual(plain(lib.supplierPoApprovalListBadge({ status: 'open', approval_status: 'draft' })), {
    key: 'supplierPoApprovalPending',
    tone: 'warning',
  })
  assert.deepEqual(plain(lib.supplierPoApprovalListBadge({ status: 'closed', approval_status: 'draft' })), {
    key: 'supplierPoApprovalDraft',
    tone: 'neutral',
  })
  for (const token of [
    'purchasing_approve_required',
    'po_not_draft',
    'po_self_approval',
    'po_has_no_lines',
    'po_has_unpriced_lines',
    'po_approved_locked',
  ]) {
    assert.ok(lib.SUPPLIER_PO_ERROR_TOKENS.includes(token), token)
    assert.ok(token in lib.SUPPLIER_PO_FORM_MESSAGES, token)
  }
})

test('the screens: approve for approvers, locked when approved, a draft PDF marked as a draft', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(data, /SUPPLIER_PO_SELECT = `id,po_number,lessor_id,owner_class,is_internal,company_id,project_id,start_date,status,closed_at,approval_status,approved_at,approved_by,/)
  assert.match(data, /supabase\.rpc\('approve_supplier_po', \{ p_po_id: poId \}\)/)

  const detail = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  assert.match(detail, /const canApprove = can\('purchasing\.approve'\)/)
  assert.match(detail, /const editable = showActions && !approved/)
  // Owner 2026-10-29: a draft exports too, marked as a draft on every page.
  assert.doesNotMatch(detail, /exportBlockedReason=/)
  const sheet = read('src', 'components', 'purchasing', 'SupplierPoPrintSheet.tsx')
  assert.match(sheet, /const draft = po\.approval_status !== 'approved'/)
  assert.match(sheet, /draft \? ar\('supplierPoApprovalDraft'\) : null,/)
  // Version 4 of the owner's PDF reviews, approved 2026-10-29: bilingual
  // whatever the screen language (Arabic, then English), no watermark,
  // status badge, creator, creation time, note column, «مفتوح» or app name;
  // the header is the logo, «امر شراء / Purchase Order» with the project,
  // and the PO number, issue date and state; the buyer and the supplier
  // side by side; «وصف المعدة» (code + plate or chassis, type under) ·
  // «تاريخ البداية» · «الوحدة» · price; the totals in a box with light
  // leader lines; the terms in both languages; no browser header or footer.
  assert.match(sheet, /const ar = \(key: TranslationKey\) => translations\.ar\[key\]/)
  assert.match(sheet, /const en = \(key: TranslationKey\) => translations\.en\[key\]/)
  assert.match(sheet, /dir="rtl"\s+lang="ar"/)
  assert.doesNotMatch(
    sheet,
    /useI18n|fixed inset-0|SUPPLIER_PO_STATUS_BADGE|printGeneratedAt|createdBy|supplierPoCreatedAt|supplierPoLineNote|equipmentPurchasingOpenEnd|appName|supplierPoEquipment'|supplierPoDraftWatermark|text-left/,
  )
  assert.match(sheet, /ar\('supplierPoPrintTitleAr'\)[\s\S]*en\('supplierPoPrintTitleEn'\)[\s\S]*\{project\}/)
  assert.match(sheet, /key: 'supplierPoNumber'[\s\S]*key: 'supplierPoPrintIssueDate'[\s\S]*key: 'supplierPoPrintStatus'/)
  assert.match(sheet, /draft \? 'supplierPoApprovalDraft' : 'supplierPoApprovalApproved'/)
  assert.match(sheet, /<Inline k="supplierPoPrintBuyer" \/>[\s\S]*<Stacked k="supplierPoPrintBuyerName" \/>[\s\S]*<Inline k="supplierPoSupplier" \/>/)
  assert.match(
    sheet,
    /'supplierPoPrintUnitDescription',\s+'supplierPoStartDate',\s+'supplierPoPrintUnit',\s+'supplierPoPrice',/,
  )
  assert.match(sheet, /const identifier = unit \? plateOrChassis\(unit\) : null/)
  assert.match(sheet, /<dl className="m-0 w-full max-w-\[80mm\] space-y-2 rounded border p-3">/)
  assert.match(sheet, /<span aria-hidden="true" className="min-w-3 flex-1 border-b" \/>/)
  assert.match(sheet, /<Stacked k="supplierPoPrintBeforeVat" \/>[\s\S]*<Stacked text=\{vatLabel\} \/>[\s\S]*<Stacked k="supplierPoPrintTotal" \/>/)
  assert.match(sheet, /<li key=\{key\}>\{ar\(key\)\}<\/li>[\s\S]*<li key=\{key\}>\{en\(key\)\}<\/li>/)
  assert.match(sheet, /@page \{ size: A4 portrait; margin: 0; \}/)
  assert.match(sheet, /<Price value=\{line\.price\} \/>/)
  assert.match(sheet, /showUnit=\{mixedUnits\}/)
  assert.match(detail, /canApprove && open && !approved \? \(\) => setApproveOpen\(true\) : undefined/)
  assert.match(detail, /approveBlockedReason=\{approveBlocker\}/)
  assert.match(detail, /\{editable && addButton\}/)
  assert.match(detail, /\{editable && \(\s+<Button\s+size="sm"\s+variant="outline"/)
  assert.match(detail, /t\('supplierPoApprovedLockedNotice'\)/)
  assert.match(detail, /<SupplierPoApprovalBadge po=\{po\} \/>/)
  assert.doesNotMatch(detail, /\{showActions && addButton\}/)

  const menu = read('src', 'components', 'purchasing', 'SupplierPoOptionsMenu.tsx')
  assert.match(menu, /disabled=\{busy \|\| Boolean\(exportBlockedReason\)\}/)
  assert.match(menu, /disabled=\{busy \|\| Boolean\(approveBlockedReason\)\}/)

  const dialog = read('src', 'components', 'purchasing', 'ApproveSupplierPoDialog.tsx')
  assert.match(dialog, /await approveSupplierPo\(po\.id\)/)
  assert.match(dialog, /setMessage\(supplierPoFormMessage\(result\.error\)\)/)

  const list = read('src', 'screens', 'purchasing', 'SupplierPosListScreen.tsx')
  assert.match(list, /key: 'approval_status',\s+header: t\('supplierPoApproval'\),\s+sortable: true,/)
  assert.match(list, /<SupplierPoApprovalBadge po=\{row\} list size="sm" \/>/)
  const configs = read('src', 'lib', 'listConfigs.ts')
  const po = configs.slice(configs.indexOf('export const supplierPosListConfig'), configs.indexOf('export const siteUnitsListConfig'))
  assert.match(po, /key: 'approval_status',\s+label: 'supplierPoApproval',\s+type: 'select',\s+operators: \['eq', 'neq'\],/)
  assert.match(po, /\{ key: 'approval_status', label: 'supplierPoApproval' \}/)
})

test('the labels, Arabic and English, plain alif', () => {
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'supplierPoApproval',
    'supplierPoApprovalDraft',
    'supplierPoApprovalApproved',
    'supplierPoApprovalPending',
    'supplierPoApprove',
    'supplierPoApproveConfirmTitle',
    'supplierPoApproveConfirmDesc',
    'supplierPoApprovedLockedNotice',
    'supplierPoApproveBlockedUnpriced',
    'supplierPoApproveBlockedNoLines',
    'supplierPoApproveBlockedSelf',
    'supplierPoErrorApproveRequired',
    'supplierPoErrorNotDraft',
    'supplierPoErrorApprovedLocked',
    'supplierPoApprovedAt',
    'supplierPoApprovedBy',
    'supplierPoEventApproved',
  ]) {
    const matches =
      translations.match(
        new RegExp(`^    ${key}:\\s*\\n?\\s*('[^'\\n]*'|"[^"\\n]*"),$`, 'gm'),
      ) ?? []
    assert.equal(matches.length, 2, key)
    assert.doesNotMatch(matches[0], /[أإآ]/, key)
  }
})
