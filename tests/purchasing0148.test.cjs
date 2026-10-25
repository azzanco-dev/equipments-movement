// Migration 0148 (owner 2026-10-25, «اضف شرط نفس تاريخ الدخول»): every unit
// of one supplier PO entered the project on the SAME Saudi day, and that day
// is the PO's start date. New additions only; existing lines stay.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261025100000_0148_supplier_po_same_entry_day.sql'
const PREVIOUS = '20261024100000_0147_purchasing_site_units.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const sql = norm(read('supabase', 'migrations', MIGRATION))

/** One statement of a migration, from its first words to the next `$$;`. */
const fn = (source, head) => {
  const start = source.indexOf(head)
  assert.ok(start >= 0, head)
  return source.slice(start, source.indexOf('$$;', source.indexOf('$$', start) + 2) + 3)
}

test('0148 is the single 0148 migration, right after 0147', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0148 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0148_/.test(file)).length, 1)
})

test('add_supplier_po_equipment: the 0138 body plus the entry-day check', () => {
  const before = norm(
    read('supabase', 'migrations', '20261020100000_0138_supplier_po_party_and_optional_price.sql'),
  )
  const head = 'CREATE OR REPLACE FUNCTION public.add_supplier_po_equipment('
  const check =
    "IF v_entry_date <> v_po.start_date THEN RAISE EXCEPTION 'entry_date_mismatch' USING ERRCODE = '55000', HINT = 'The equipment entered the project on a day other than the PO start date.'; END IF; "
  const body = fn(sql, head)
  assert.ok(body.includes(check), 'the 0148 check')
  // Verbatim otherwise.
  assert.equal(body.replace(check, ''), fn(before, head))
  // The day is the Saudi day of the open entry, after the advisory key.
  assert.ok(
    body.indexOf('pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0))') <
      body.indexOf("v_entry_date := (v_last.recorded_at AT TIME ZONE 'Asia/Riyadh')::date;"),
  )
  assert.ok(body.indexOf('v_entry_date := (v_last') < body.indexOf("'entry_date_mismatch'"))
  assert.match(body, /SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(body, /PERFORM public\.assert_purchasing_manage\(\);/)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.add_supplier_po_equipment\(uuid, uuid, numeric, text\) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\.add_supplier_po_equipment\(uuid, uuid, numeric, text\) TO authenticated;/,
  )
})

test('create_supplier_po inherits the rule: its latest body adds every unit through add', () => {
  const latest = norm(
    read('supabase', 'migrations', '20261020110000_0139_supplier_po_is_internal_default.sql'),
  )
  assert.match(
    latest,
    /FOR v_item IN SELECT value FROM jsonb_array_elements\(COALESCE\(p_equipment, '\[\]'::jsonb\)\) LOOP PERFORM public\.add_supplier_po_equipment\( v_id,/,
  )
  // No later migration re-creates create_supplier_po.
  const createLatest = '20261020110000_0139_supplier_po_is_internal_default.sql'
  for (const file of migrations.filter((name) => name > createLatest))
    assert.doesNotMatch(
      read('supabase', 'migrations', file),
      /CREATE (OR REPLACE )?FUNCTION public\.create_supplier_po\(/,
      file,
    )
  assert.match(sql, /COMMENT ON FUNCTION public\.create_supplier_po\(uuid, text, uuid, uuid, date, text, jsonb\) IS '0136\/0138\/0139\/0148:/)
})

test('update_supplier_po: the 0142 body plus the locked start date', () => {
  const before = norm(read('supabase', 'migrations', '20261022100000_0142_supplier_po_update.sql'))
  const head = 'CREATE OR REPLACE FUNCTION public.update_supplier_po('
  const body = fn(sql, head)
  const start = body.indexOf('IF p_start_date <> v_po.start_date AND EXISTS (')
  const end = body.indexOf('END IF;', start) + 'END IF; '.length
  assert.ok(start > 0, 'the 0148 block')
  const block = body.slice(start, end)
  // Only a CHANGED start date is checked, against every current line's
  // entry day (the card's period_from when the entry link is gone).
  assert.match(block, /FROM public\.supplier_po_equipment l JOIN public\.equipment_cards c ON c\.id = l\.equipment_card_id LEFT JOIN public\.entry_exit_logs el ON el\.id = c\.entry_log_id WHERE l\.supplier_po_id = p_po_id/)
  assert.match(block, /COALESCE\(\(el\.recorded_at AT TIME ZONE 'Asia\/Riyadh'\)::date, c\.period_from\) <> p_start_date/)
  assert.match(block, /RAISE EXCEPTION 'po_start_date_locked' USING ERRCODE = '55000'/)
  // Verbatim otherwise, after the PO row lock.
  assert.equal(body.slice(0, start) + body.slice(end), fn(before, head))
  assert.ok(body.indexOf('FOR UPDATE;') < start)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.update_supplier_po\(uuid, date, text\) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\.update_supplier_po\(uuid, date, text\) TO authenticated;/,
  )
})

test('purchasing_site_units: the 0147 view plus the same-day party PO', () => {
  const before = norm(read('supabase', 'migrations', PREVIOUS))
  const view = (source) =>
    source.slice(
      source.indexOf('CREATE OR REPLACE VIEW public.purchasing_site_units'),
      source.indexOf("AND v.movement_context = 'site';") + 30,
    )
  const condition = "AND p.start_date = (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date "
  assert.ok(view(sql).includes(`WHERE po.id IS NULL AND p.status = 'open' AND p.company_id = v.company_id AND p.project_id = v.project_id ${condition}`))
  assert.equal(view(sql).replace(condition, ''), view(before))
  assert.match(sql, /WITH \(security_invoker = true\)/)
  assert.match(sql, /REVOKE ALL ON public\.purchasing_site_units FROM PUBLIC, anon; GRANT SELECT ON public\.purchasing_site_units TO authenticated;/)
})

test('the tokens map to field messages in Arabic and English', () => {
  const lib = read('src', 'lib', 'purchasing.ts')
  for (const token of ['entry_date_mismatch', 'po_start_date_locked'])
    assert.match(lib, new RegExp(`^  '${token}', // 0148`, 'm'), token)
  assert.match(lib, /match: 'entry_date_mismatch',\s+field: 'start_date',\s+key: 'supplierPoErrorEntryDateMismatch'/)
  assert.match(lib, /match: 'entry_date_mismatch',\s+field: 'equipment_id',\s+key: 'supplierPoErrorEntryDateMismatch'/)
  assert.match(lib, /match: 'po_start_date_locked',\s+field: 'start_date',\s+key: 'supplierPoErrorStartDateLocked'/)
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'supplierPoErrorEntryDateMismatch',
    'supplierPoErrorStartDateLocked',
    'supplierPoStartDateLockedHint',
    'supplierPoStartDateFollowsEntry',
    'supplierPoOtherEntryDay',
    'supplierPoEquipmentSameDayHint',
    'supplierPoStartDateHint',
  ]) {
    const matches =
      translations.match(
        new RegExp(`^    ${key}:\\s*\\n?\\s*('[^'\\n]*'|"[^"\\n]*"),$`, 'gm'),
      ) ?? []
    assert.equal(matches.length, 2, key)
    // New Arabic copy: plain alif only.
    assert.doesNotMatch(matches[0], /[أإآ]/, key)
  }
})

test('the dialogs: same-day units, the start date follows them or is locked', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(data, /export function visitEntryDay\(visit: Pick<PartyOpenVisit, 'entry_at'>\): string \{\s+return saudiDateKey\(visit\.entry_at\)/)
  const loader = data.slice(data.indexOf('export function equipmentAtProjectOptionLoader'))
  assert.match(loader, /\.gte\('entry_at', saudiDayStart\(options\.entryDay\)\)\s+\.lt\('entry_at', saudiDayStart\(nextDay\)\)/)

  const add = read('src', 'components', 'purchasing', 'AddEquipmentDialog.tsx')
  assert.match(add, /entryDay: po\.start_date,/)
  assert.match(add, /hint=\{t\('supplierPoEquipmentSameDayHint'\)\}/)

  const create = read('src', 'components', 'purchasing', 'CreateSupplierPoDialog.tsx')
  assert.match(create, /return first \? visitEntryDay\(first\) : null/)
  assert.match(create, /!line && pickedDay !== null && visitEntryDay\(visit\) !== pickedDay/)
  assert.match(create, /disabled=\{otherDay\}/)
  assert.match(create, /disabled=\{pickedDay !== null\}/)
  assert.match(create, /current\.start_date === pickedDay/)
  assert.doesNotMatch(create, /dateTouched|suggestStartDate/)

  const edit = read('src', 'components', 'purchasing', 'EditSupplierPoDialog.tsx')
  assert.match(edit, /disabled=\{hasLines\}/)
  assert.match(edit, /hint=\{hasLines \? t\('supplierPoStartDateLockedHint'\) : undefined\}/)
  assert.match(edit, /SUPPLIER_PO_EDIT_FIELD_RULES/)
  const detail = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  assert.match(detail, /<EditSupplierPoDialog\s+po=\{po\}\s+hasLines=\{lines\.length > 0\}/)

  // «المعدات في المشاريع»: the «+» says «اضافة الى SPO…» only for the
  // party PO the view returns (same day), and the add dialog filters on it.
  const screen = read('src', 'screens', 'purchasing', 'SiteUnitsScreen.tsx')
  assert.match(screen, /start_date: saudiDateKey\(existing\.entry_at\),/)
  assert.match(screen, /\{row\.party_po_id \? \(\s+<>\s+\{t\('siteUnitsAddTo'\)\}/)
})
