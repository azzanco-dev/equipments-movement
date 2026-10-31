// Migration 0167 and «حسب المعدات» of the PO list (owner 2026-10-31): one
// row per unit on a supplier PO with its PO number, read through the
// security_invoker view `purchasing_po_units`.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261031120000_0167_purchasing_po_units_view.sql'

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

test('0167 is the single 0167 migration, right after 0166', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0167 present')
  assert.match(migrations[at - 1], /_0166_/)
  assert.equal(migrations.filter((file) => /_0167_/.test(file)).length, 1)
})

test('the view: one row per PO line, read as the caller, select only', () => {
  assert.match(
    sql,
    /CREATE OR REPLACE VIEW public\.purchasing_po_units WITH \(security_invoker = true\) AS/,
  )
  assert.match(
    sql,
    /FROM public\.supplier_po_equipment l JOIN public\.supplier_pos p ON p\.id = l\.supplier_po_id JOIN public\.equipment_cards c ON c\.id = l\.equipment_card_id LEFT JOIN public\.equipment e ON e\.id = c\.equipment_id LEFT JOIN public\.lessors ls ON ls\.id = p\.lessor_id LEFT JOIN public\.companies co ON co\.id = p\.company_id LEFT JOIN public\.projects pr ON pr\.id = p\.project_id;/,
  )
  assert.match(
    sql,
    /REVOKE ALL ON public\.purchasing_po_units FROM PUBLIC, anon;/,
  )
  assert.match(
    sql,
    /GRANT SELECT ON public\.purchasing_po_units TO authenticated;/,
  )
  assert.match(sql, /COMMENT ON VIEW public\.purchasing_po_units IS/)
  // Read-only: no definer, no function, no trigger, no write, no policy.
  assert.doesNotMatch(
    sql,
    /SECURITY DEFINER|CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|CREATE POLICY|INSERT INTO|UPDATE public|DELETE FROM/,
  )
})

test('the flattened columns the screen selects', () => {
  for (const column of [
    'l.id AS line_id',
    'l.price',
    // 0157: the LINE's price unit.
    'l.rate_unit',
    'l.note AS line_note',
    'l.created_at AS line_created_at',
    'l.updated_at',
    '(l.price IS NOT NULL) AS is_priced',
    'p.id AS supplier_po_id',
    'p.po_number',
    'p.status AS po_status',
    'p.approval_status',
    'p.start_date',
    'p.lessor_id',
    'p.owner_class',
    // 0140's party_class(supplier_pos), inlined.
    "COALESCE(p.owner_class, 'external_supplier') AS party_class",
    'ls.name AS lessor_name',
    'ls.is_internal AS lessor_is_internal',
    'p.company_id',
    'co.name_ar AS company_name_ar',
    'co.name_en AS company_name_en',
    'p.project_id',
    'pr.name_ar AS project_name_ar',
    'pr.name_en AS project_name_en',
    'c.equipment_id',
    'e.code AS equipment_code',
    'e.type AS equipment_type',
    'e.type_search AS equipment_type_search',
    'e.plate_number AS equipment_plate_number',
    'e.plate_digits AS equipment_plate_digits',
    'e.chassis_number AS equipment_chassis_number',
    'e.ownership_status AS equipment_ownership_status',
    'c.period_from AS card_period_from',
    'c.period_to AS card_period_to',
  ])
    assert.ok(
      sql.includes(`${column},`) || sql.includes(`${column} FROM`),
      column,
    )
  // The computed column of 0140 is the same expression.
  const party = norm(
    read(
      'supabase',
      'migrations',
      '20261020120000_0140_supplier_po_party_class.sql',
    ),
  )
  assert.match(
    party,
    /SELECT COALESCE\(po\.owner_class, 'external_supplier'\);/,
  )
})

test('the select of the screen names only columns of the view', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  const select = /export const PO_UNITS_SELECT =\s+'([^']+)'/.exec(data)
  assert.ok(select, 'PO_UNITS_SELECT')
  for (const column of select[1].split(','))
    assert.match(sql, new RegExp(`(AS |\\.)${column}[, ]`), column)
  // The config's search, filter and sort fields are columns of the view too.
  const configs = read('src', 'lib', 'listConfigs.ts')
  const config = configs.slice(
    configs.indexOf('export const poUnitsListConfig'),
    configs.indexOf('export const supplierPosListConfig'),
  )
  const fields = [
    ...config.matchAll(/^\s{4}'(\w+)',$/gm),
    ...config.matchAll(/^\s{6}key: '(\w+)',$/gm),
    ...config.matchAll(/\{ key: '(\w+)', label:/g),
  ].map((m) => m[1])
  assert.ok(fields.length >= 15)
  for (const field of fields)
    assert.match(sql, new RegExp(`(AS |\\.)${field}[, ]`), field)
})

test('new Arabic copy uses the plain alif', () => {
  assert.doesNotMatch(raw, /[أإآ]/)
  assert.doesNotMatch(
    read('src', 'screens', 'purchasing', 'PoUnitsList.tsx'),
    /[أإآ]/,
  )
})
