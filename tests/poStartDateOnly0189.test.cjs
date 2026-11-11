const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0189 (owner decisions 2026-11-10 / 2026-11-11, «اعتمد ونفذ»):
// «خلينا نشيل القيد هذا بحيث يسمح بانشاء po مورد للمعدة حتى لو المعدة لها po
// مفتوح», «خلنا نلغي اغلاق الامر, ومفتوح او مغلق شيلها, يصير نحط تاريخ بداية
// للPO المورد فقط, وحتى المعدة نشيل منها البداية والنهاية ومفتوح», «وبرضه
// الكرت حاليا الغي القيد حق المعدة لها كرت مفتوح». A supplier PO is its start
// date and its approval; a card is the unit's visit.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const exists = (...parts) => fs.existsSync(path.join(ROOT, ...parts))

const SQL = read(
  'supabase',
  'migrations',
  '20261111100000_0189_po_start_date_only.sql',
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

/** The SELECT of one view of the migration. */
function view(name) {
  const head = `CREATE VIEW public.${name}\nWITH (security_invoker = true)\nAS\n`
  const start = CODE.indexOf(head)
  assert.ok(start >= 0, `${name} is in the migration`)
  return CODE.slice(
    start + head.length,
    CODE.indexOf('COMMENT ON VIEW', start),
  )
}

const FUNCTIONS = [
  'add_supplier_po_equipment',
  'update_supplier_po',
  'update_supplier_po_equipment',
  'update_supplier_po_equipment_price',
  'remove_supplier_po_equipment',
  'approve_supplier_po',
  'return_supplier_po_approval',
  'approve_equipment_card_pricing',
  'return_equipment_card_pricing',
  'record_equipment_card_month',
  'add_client_po_equipment',
]
const VIEWS = [
  'sales_equipment_cards',
  'sales_card_months',
  'sales_card_month_slots',
  'purchasing_po_units',
  'sales_po_units',
  'purchasing_site_visits',
  'purchasing_site_units',
]

test('the state and the period are dropped, with everything that read them', () => {
  assert.match(
    CODE,
    /ALTER TABLE public\.supplier_pos\s+DROP CONSTRAINT supplier_pos_closed_at_check,\s+DROP CONSTRAINT supplier_pos_status_check,\s+DROP COLUMN status,\s+DROP COLUMN closed_at;/,
  )
  assert.match(
    CODE,
    /ALTER TABLE public\.equipment_cards\s+DROP CONSTRAINT equipment_cards_no_overlap,\s+DROP CONSTRAINT equipment_cards_period_check,\s+DROP COLUMN period_from,\s+DROP COLUMN period_to;/,
  )
  // The two indexes that carried a dropped column get a successor.
  assert.match(
    CODE,
    /CREATE INDEX supplier_pos_start_date_idx\s+ON public\.supplier_pos \(start_date DESC, id DESC\);/,
  )
  assert.match(
    CODE,
    /CREATE INDEX equipment_cards_equipment_idx\s+ON public\.equipment_cards \(equipment_id, created_at DESC\);/,
  )
  // The «one open PO per card» trigger, closing, and the manual card end.
  for (const statement of [
    'DROP TRIGGER supplier_po_equipment_single_open ON public.supplier_po_equipment;',
    'DROP FUNCTION public.enforce_supplier_po_equipment_single_open();',
    'DROP FUNCTION public.close_supplier_po(uuid);',
    'DROP FUNCTION public.end_equipment_card(uuid, date, text);',
    'DROP FUNCTION public.reopen_equipment_card(uuid, text);',
    'DROP VIEW public.sales_cards_awaiting_end;',
  ])
    assert.ok(CODE.includes(statement), statement)
  // Every view that read a dropped column is dropped BEFORE the columns go
  // and re-created after.
  const alter = CODE.indexOf('ALTER TABLE public.supplier_pos')
  for (const name of VIEWS) {
    const drop = CODE.indexOf(`DROP VIEW public.${name};`)
    const create = CODE.indexOf(`CREATE VIEW public.${name}\n`)
    assert.ok(drop >= 0 && drop < alter, `${name} dropped first`)
    assert.ok(create > alter, `${name} re-created after`)
    assert.match(
      CODE,
      new RegExp(
        `REVOKE ALL ON public\\.${name} FROM PUBLIC, anon;\\s+GRANT SELECT ON public\\.${name} TO authenticated;`,
      ),
      `${name} grants`,
    )
  }
  // The client PO keeps its own open / closed state: untouched tables.
  assert.doesNotMatch(CODE, /ALTER TABLE public\.client_pos/)
})

test('no function reads the supplier PO status or the card period any more', () => {
  for (const name of FUNCTIONS) {
    const text = body(name)
    assert.doesNotMatch(text, /period_from|period_to/, `${name}: period`)
    assert.doesNotMatch(text, /card_overlap|exclusion_violation/, `${name}: overlap`)
    assert.doesNotMatch(text, /'po_closed'|closed_at|v_status/, `${name}: closing`)
    // The client PO's own status is the only one left (add_client_po_equipment).
    if (name !== 'add_client_po_equipment')
      assert.doesNotMatch(
        text,
        /\b(v_po|sp|sp2|p)\.status\b/,
        `${name}: supplier status`,
      )
    assert.match(
      CODE,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\)\\s+FROM PUBLIC, anon;\\s+GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s+TO authenticated;`,
      ),
      `${name} grants`,
    )
    const head = CODE.slice(
      CODE.search(
        new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`),
      ),
    ).slice(0, 700)
    assert.match(head, /SECURITY DEFINER\s+SET search_path = public, pg_temp/, name)
  }
  // The guard at the end re-checks it in the database (plpgsql does not
  // check column names when a function is created).
  assert.match(
    CODE,
    /p\.prosrc ~ 'equipment_cards'\s+AND p\.prosrc ~ '\\mperiod_\(from\|to\)\\M';/,
  )
  assert.match(CODE, /0189: functions still read the supplier PO status: %/)
})

test('a card is the visit: found by its entry, created without a period', () => {
  for (const name of ['add_supplier_po_equipment', 'add_client_po_equipment']) {
    const text = body(name)
    assert.match(
      text,
      /SELECT c\.id INTO v_card_id\s+FROM public\.equipment_cards c\s+WHERE c\.equipment_id = p_equipment_id\s+AND c\.company_id = v_po\.company_id\s+AND c\.project_id = v_po\.project_id\s+AND c\.entry_log_id = v_entry\.id\s+ORDER BY c\.created_at, c\.id\s+LIMIT 1;/,
      `${name}: the card of the entry`,
    )
    assert.match(text, /entry_log_id\s*\) VALUES \(/, `${name}: linked to the entry`)
    // The unit's advisory key still serialises it against the movements.
    assert.match(
      text,
      /pg_advisory_xact_lock\(hashtextextended\(p_equipment_id::text, 0\)\)/,
      name,
    )
  }
  const add = body('add_supplier_po_equipment')
  // The entry-day rule of 0148 stays: the PO's start date is the entry day.
  assert.match(
    add,
    /\(l\.recorded_at AT TIME ZONE 'Asia\/Riyadh'\)::date = v_po\.start_date/,
  )
  assert.match(add, /RAISE EXCEPTION 'entry_date_mismatch'/)
  // An approved PO stays locked; the one uniqueness left is per PO.
  assert.match(add, /RAISE EXCEPTION 'po_approved_locked'/)
  assert.match(
    add,
    /WHEN unique_violation THEN\s+RAISE EXCEPTION 'equipment_already_on_po'/,
  )
  assert.doesNotMatch(add, /equipment_already_on_open_po/)
  // The start-date lock reads each line's card entry.
  assert.match(
    body('update_supplier_po'),
    /JOIN public\.entry_exit_logs el ON el\.id = c\.entry_log_id\s+WHERE l\.supplier_po_id = p_po_id\s+AND \(el\.recorded_at AT TIME ZONE 'Asia\/Riyadh'\)::date <> p_start_date/,
  )
})

test('return_supplier_po_approval: an approver puts an approved PO back to draft', () => {
  assert.match(
    CODE,
    /CREATE FUNCTION public\.return_supplier_po_approval\(\s+p_po_id uuid,\s+p_note text DEFAULT NULL\s+\)\s+RETURNS void/,
  )
  const text = body('return_supplier_po_approval')
  assert.match(
    text,
    /IF auth\.uid\(\) IS NULL OR NOT public\.has_permission\('purchasing\.approve'\) THEN\s+RAISE EXCEPTION 'purchasing_approve_required'\s+USING ERRCODE = '42501'/,
  )
  assert.match(text, /WHERE p\.id = p_po_id\s+FOR UPDATE;/)
  assert.match(text, /RAISE EXCEPTION 'invalid_po' USING ERRCODE = '22023'/)
  assert.match(
    text,
    /IF v_po\.approval_status <> 'approved' THEN\s+RAISE EXCEPTION 'po_not_approved'\s+USING ERRCODE = '55000'/,
  )
  assert.match(
    text,
    /IF char_length\(v_note\) > 500 THEN\s+RAISE EXCEPTION 'invalid_note'/,
  )
  assert.match(
    text,
    /SET approval_status = 'draft',\s+approved_at = NULL,\s+approved_by = NULL\s+WHERE id = p_po_id;/,
  )
  assert.match(
    text,
    /p_po_id, 'approval_returned',\s+jsonb_build_object\(\s+'via', 'manual',\s+'note', v_note,\s+'approved_at', v_po\.approved_at,\s+'approved_by', v_po\.approved_by\s+\)/,
  )
  // The lock hints point to it instead of «close it and create a new one».
  assert.doesNotMatch(CODE, /close it and create a new one/)
  assert.match(CODE, /An approved PO is locked; return it to draft first\./)
})

test('card pricing follows the card\'s LATEST supplier PO', () => {
  for (const name of [
    'approve_equipment_card_pricing',
    'return_equipment_card_pricing',
  ])
    assert.match(
      body(name),
      /WHERE sl\.equipment_card_id = p_card_id\s+ORDER BY sp\.created_at DESC, sp\.id DESC\s+LIMIT 1/,
      name,
    )
  const approve = body('approve_equipment_card_pricing')
  assert.match(approve, /RAISE EXCEPTION 'card_pricing_no_supplier_line'/)
  assert.match(approve, /RAISE EXCEPTION 'card_pricing_no_supplier_price'/)
  // The linkage of 0174 stays: every card of the PO approved → the PO too.
  assert.match(approve, /IF v_po\.approval_status = 'draft' THEN/)
  assert.match(approve, /'via', 'card_pricing'/)
  assert.match(
    body('return_equipment_card_pricing'),
    /IF v_po_found AND v_po\.approval_status = 'approved' THEN/,
  )
})

test('the months of a card are those of its visit', () => {
  const text = body('record_equipment_card_month')
  assert.match(
    text,
    /SELECT c\.entry_log_id, c\.created_at INTO v_entry_log_id, v_card_created_at\s+FROM public\.equipment_cards c\s+WHERE c\.id = p_card_id\s+FOR UPDATE;/,
  )
  // From the entry's Saudi month to the month of the exit that closes it —
  // the next movement of the unit in the entry's context, (recorded_at, id).
  assert.match(
    text,
    /v_month_from := date_trunc\('month', v_entry\.recorded_at AT TIME ZONE 'Asia\/Riyadh'\)::date;/,
  )
  assert.match(
    text,
    /WHERE n\.equipment_id = v_entry\.equipment_id\s+AND n\.movement_context = v_entry\.movement_context\s+AND \(n\.recorded_at, n\.id\) > \(v_entry\.recorded_at, v_entry\.id\)\s+ORDER BY n\.recorded_at, n\.id\s+LIMIT 1;/,
  )
  assert.match(text, /IF FOUND AND v_next_type = 'exit' THEN/)
  // A card whose entry row is gone: the month it was created.
  assert.match(
    text,
    /v_month_from := date_trunc\('month', v_card_created_at AT TIME ZONE 'Asia\/Riyadh'\)::date;/,
  )
  assert.match(text, /RAISE EXCEPTION 'month_outside_card'/)
  assert.match(text, /RAISE EXCEPTION 'month_in_future'/)
  const slots = view('sales_card_month_slots')
  assert.match(
    slots,
    /date_trunc\('month', COALESCE\(sc\.entry_at, sc\.created_at\) AT TIME ZONE 'Asia\/Riyadh'\),\s+LEAST\(\s+date_trunc\('month', COALESCE\(sc\.exit_at, now\(\)\) AT TIME ZONE 'Asia\/Riyadh'\),\s+date_trunc\('month', now\(\) AT TIME ZONE 'Asia\/Riyadh'\)\s+\),/,
  )
})

test('the views: no period, no supplier status, the visit and the PO start date instead', () => {
  for (const name of VIEWS) {
    const text = view(name)
    // (`v.is_open` of purchasing_site_units is the VISIT's, not a card's.)
    assert.doesNotMatch(text, /period_from|period_to|AS is_open|sc\.is_open/, name)
    assert.doesNotMatch(text, /supplier_po_status|sp2\.status/, name)
  }
  const cards = view('sales_equipment_cards')
  // The exit that closes the card's entry, in the chain's own order.
  assert.match(
    cards,
    /CASE WHEN nx\.movement_type = 'exit' THEN nx\.recorded_at END AS exit_at,/,
  )
  assert.match(
    cards,
    /WHERE n\.equipment_id = el\.equipment_id\s+AND n\.movement_context = el\.movement_context\s+AND \(n\.recorded_at, n\.id\) > \(el\.recorded_at, el\.id\)\s+ORDER BY n\.recorded_at, n\.id\s+LIMIT 1\s+\) nx ON true/,
  )
  assert.match(cards, /\(sp\.supplier_po_id IS NOT NULL\) AS has_supplier_po,/)
  assert.match(cards, /sp\.supplier_po_start_date\s+FROM public\.equipment_cards c/)
  // The supplier side = the card's latest PO; the client side keeps «the
  // open PO first».
  assert.match(
    cards,
    /WHERE sl\.equipment_card_id = c\.id\s+ORDER BY sp2\.created_at DESC, sp2\.id DESC\s+LIMIT 1\s+\) sp ON true/,
  )
  assert.match(
    cards,
    /ORDER BY \(p\.status = 'open'\) DESC, p\.created_at DESC, p\.id DESC\s+LIMIT 1\s+\) cl ON true/,
  )
  // The margin rule of 0185 is untouched.
  assert.match(cards, /AND sp\.supplier_rate_unit = c\.client_price_unit/)
  assert.match(view('purchasing_po_units'), /c\.id AS equipment_card_id\s+FROM/)
  // The supplier list's view has no status; the client list's view keeps
  // the CLIENT PO's own.
  assert.doesNotMatch(view('purchasing_po_units'), /po_status/)
  assert.match(view('sales_po_units'), /p\.status AS po_status,/)
  for (const name of ['sales_card_months', 'sales_card_month_slots'])
    assert.match(view(name), /sc\.entry_at,\s+sc\.exit_at,/, name)
})

test('the PO of a visit: its own card, else a PO that started by its entry day', () => {
  for (const name of ['purchasing_site_visits', 'purchasing_site_units']) {
    const text = view(name)
    assert.match(
      text,
      /WHERE c\.equipment_id = v\.equipment_id\s+AND p\.company_id = v\.company_id\s+AND p\.project_id = v\.project_id\s+AND \(\s+c\.entry_log_id IS NOT DISTINCT FROM v\.entry_id\s+OR p\.start_date <= \(v\.entry_at AT TIME ZONE 'Asia\/Riyadh'\)::date\s+\)\s+ORDER BY \(c\.entry_log_id IS NOT DISTINCT FROM v\.entry_id\) DESC,\s+p\.start_date DESC, p\.created_at DESC, p\.id DESC\s+LIMIT 1\s+\) po ON true/,
      name,
    )
    // The PO a unit can join: the party's DRAFT there that starts on the
    // visit's entry day — no status.
    assert.match(
      text,
      /WHERE po\.id IS NULL\s+AND p\.company_id = v\.company_id\s+AND p\.project_id = v\.project_id\s+AND p\.start_date = \(v\.entry_at AT TIME ZONE 'Asia\/Riyadh'\)::date\s+AND p\.approval_status = 'draft'/,
      name,
    )
    // Exactly the two client-side reads keep `p.status = 'open'`.
    assert.equal((text.match(/p\.status = 'open'/g) ?? []).length, 2, name)
  }
  assert.match(
    view('purchasing_site_visits'),
    /CASE WHEN v\.exit_id IS NULL THEN 'inside' ELSE 'exited' END AS visit_state,\s+v\.exit_at,\s+v\.exit_purpose/,
  )
  assert.match(
    view('purchasing_site_units'),
    /WHERE v\.is_open\s+AND v\.movement_context = 'site';/,
  )
})

test('the screens read no status, no closing and no period', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.doesNotMatch(
    data,
    /SupplierPoStatus\b|period_from|period_to|closed_at|po_status|close_supplier_po/,
  )
  assert.match(
    data,
    /supabase\.rpc\('return_supplier_po_approval', \{\s+p_po_id: input\.poId,\s+p_note: input\.note\.trim\(\) \|\| null,/,
  )
  const sales = read('src', 'lib', 'salesData.ts')
  assert.doesNotMatch(
    sales,
    /period_from|period_to|supplier_po_status|end_equipment_card|reopen_equipment_card|sales_cards_awaiting_end/,
  )
  // No column this migration ADDS is read by a listed page, so the screens
  // work before and after it (the rollout applies 0189 after the deploy).
  for (const name of ['EQUIPMENT_CARDS_SELECT', 'CARD_PRICES_SELECT']) {
    const line = sales.slice(sales.indexOf(`export const ${name} = \``))
    const select = line.slice(0, line.indexOf('\n'))
    assert.doesNotMatch(select, /exit_at|supplier_po_start_date|is_open/, name)
  }
  assert.doesNotMatch(data, /equipment_card_id,equipment_id,equipment_code/)
  for (const file of [
    ['src', 'screens', 'purchasing', 'SupplierPoDetail.tsx'],
    ['src', 'screens', 'purchasing', 'SupplierPosListScreen.tsx'],
    ['src', 'screens', 'purchasing', 'PoUnitsList.tsx'],
    ['src', 'components', 'purchasing', 'EquipmentPurchasingCard.tsx'],
    ['src', 'components', 'purchasing', 'SupplierPoPrintSheet.tsx'],
    ['src', 'components', 'purchasing', 'SupplierPoLinesPanel.tsx'],
    ['src', 'components', 'purchasing', 'SupplierPoStatusBadge.tsx'],
    ['src', 'screens', 'sales', 'CardPricesScreen.tsx'],
    ['src', 'screens', 'sales', 'EquipmentCardsScreen.tsx'],
    ['src', 'screens', 'sales', 'EquipmentCardDetail.tsx'],
    ['src', 'components', 'sales', 'EquipmentSalesCard.tsx'],
    ['src', 'components', 'sales', 'ClientPoLinesPanel.tsx'],
  ]) {
    const code = read(...file).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(
      code,
      /period_from|period_to|<SupplierPoStatusBadge|po_status|supplier_po_status|\.closed_at|equipmentCardStatus|EquipmentCardStatusBadge/,
      file.join('/'),
    )
  }
  for (const gone of [
    ['src', 'components', 'purchasing', 'CloseSupplierPoDialog.tsx'],
    ['src', 'components', 'sales', 'EndCardDialog.tsx'],
    ['src', 'lib', 'cardsAwaitingEnd.ts'],
  ])
    assert.ok(!exists(...gone), gone.join('/'))
  // The PDF: the state is the approval alone; every line starts on the
  // PO's start date.
  const sheet = read(
    'src',
    'components',
    'purchasing',
    'SupplierPoPrintSheet.tsx',
  )
  assert.match(sheet, /const lineStart = formatDate\(po\.start_date\)/)
  assert.match(sheet, /<bdi dir="ltr">\{lineStart\}<\/bdi>/)
  // The card page shows the visit, from the movements.
  const card = read('src', 'screens', 'sales', 'EquipmentCardDetail.tsx')
  assert.match(card, /const visitLabel = card\.entry_at/)
  assert.match(
    card,
    /t\(visit\.is_open \? 'siteUnitsInside' : 'siteUnitsExited'\)/,
  )
  assert.match(card, /is_open: slot\.exit_at === null/)
})

test('the lists: no status filter, sort or default on the supplier side', () => {
  const configs = read('src', 'lib', 'listConfigs.ts')
  const slice = (name) => {
    const start = configs.indexOf(`export const ${name}`)
    assert.ok(start >= 0, name)
    const next = configs.indexOf('export const', start + 1)
    return configs.slice(start, next > 0 ? next : undefined)
  }
  for (const name of ['poUnitsListConfig', 'supplierPosListConfig'])
    assert.doesNotMatch(
      slice(name),
      /key: 'status'|key: 'po_status'|defaultFilters|supplierPoStatusOpen/,
      name,
    )
  const cards = slice('equipmentCardsListConfig')
  assert.match(cards, /defaultSort: 'entry_at',\s+defaultDirection: 'desc',/)
  assert.doesNotMatch(cards, /is_open|period_from/)
  const prices = slice('cardPricesListConfig')
  assert.doesNotMatch(prices, /is_open|defaultFilters/)
  // The client PO lists keep their open / closed filter and default.
  assert.match(slice('clientPosListConfig'), /key: 'status'/)
  assert.match(slice('clientPoUnitsListConfig'), /id: 'default-po-status'/)
  assert.match(
    slice('clientPoUnitsListConfig'),
    /\{ key: 'issue_date', label: 'clientPoIssueDate' \}/,
  )
})

test('the copy: Arabic and English, no hamza on alif', () => {
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'supplierPoReturn',
    'supplierPoReturnConfirmTitle',
    'supplierPoReturnConfirmDesc',
    'supplierPoReturnConfirmButton',
    'supplierPoReturnNote',
    'supplierPoReturnedToast',
    'supplierPoErrorAlreadyOnPo',
    'supplierPoErrorNotApproved',
    'supplierPoApprovedLockedNotice',
    'supplierPoErrorApprovedLocked',
    'supplierPoApproveConfirmDesc',
  ]) {
    const matches = [
      ...translations.matchAll(
        new RegExp(`^    ${key}:\\s*\\n?\\s*'([^'\\n]*)',$`, 'gm'),
      ),
    ]
    assert.equal(matches.length, 2, key)
    assert.ok(/[؀-ۿ]/.test(matches[0][1]), `${key} ar`)
    assert.ok(!/[؀-ۿ]/.test(matches[1][1]), `${key} en`)
    assert.doesNotMatch(matches[0][1], HAMZA_ALIF, key)
    // Nothing tells the user to close a PO any more.
    assert.doesNotMatch(matches[0][1], /اقفله|الاغلاق/, key)
    assert.doesNotMatch(matches[1][1], /close it|closing/i, key)
  }
})
