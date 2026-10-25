// Migration 0147 and «المعدات في المشاريع» (owner 2026-10-24): every unit
// inside a project now with its open SPO, or «اضافة الى PO» — to the open PO
// of its party there when one exists, else a new PO with the unit ticked.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261024100000_0147_purchasing_site_units.sql'
const PREVIOUS = '20261022160000_0146_supplier_po_updated_at.sql'

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

test('0147 is the single 0147 migration, right after 0146', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0147 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0147_/.test(file)).length, 1)
})

test('the view: open site visits, read as the caller, select only', () => {
  assert.match(
    sql,
    /CREATE OR REPLACE VIEW public\.purchasing_site_units WITH \(security_invoker = true\) AS/,
  )
  assert.match(sql, /FROM public\.movement_visits v/)
  assert.match(sql, /WHERE v\.is_open AND v\.movement_context = 'site';/)
  assert.match(sql, /REVOKE ALL ON public\.purchasing_site_units FROM PUBLIC, anon;/)
  assert.match(sql, /GRANT SELECT ON public\.purchasing_site_units TO authenticated;/)
  // Read-only: no function, no trigger, no write.
  assert.doesNotMatch(sql, /CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|INSERT INTO|UPDATE public|DELETE FROM/)
})

test('the unit\'s open PO there, else its party\'s open PO there', () => {
  // The PO the unit sits on: its card, an open PO, the same company and project.
  assert.match(
    sql,
    /WHERE c\.equipment_id = v\.equipment_id AND p\.status = 'open' AND p\.company_id = v\.company_id AND p\.project_id = v\.project_id ORDER BY p\.created_at DESC, p\.id DESC LIMIT 1 \) po ON true/,
  )
  assert.match(sql, /\(po\.id IS NOT NULL\) AS has_po/)
  // Only without one: the party's open PO there (lessor or owner class).
  assert.match(sql, /WHERE po\.id IS NULL AND p\.status = 'open'/)
  assert.match(
    sql,
    /v\.equipment_ownership_status = 'external_supplier' AND p\.lessor_id IS NOT NULL AND p\.lessor_id = v\.equipment_lessor_id/,
  )
  assert.match(
    sql,
    /v\.equipment_ownership_status <> 'external_supplier' AND p\.owner_class = v\.equipment_ownership_status/,
  )
  assert.match(sql, /party_po\.id AS party_po_id, party_po\.po_number AS party_po_number/)
})

test('the page reads the view server-side and adds through the existing dialogs', () => {
  const screen = read('src', 'screens', 'purchasing', 'SiteUnitsScreen.tsx')
  assert.match(screen, /\.from\('purchasing_site_units'\)/)
  assert.match(screen, /\.select\(SITE_UNITS_SELECT, \{ count: 'exact' \}\)/)
  assert.match(screen, /\.range\(/)
  assert.match(screen, /buildSearchFilter\(\s+siteUnitsListConfig\.searchFields,/)
  assert.match(screen, /applyListFilters\(/)
  // Deterministic paging after the chosen sort.
  assert.match(screen, /\.order\('entry_id', \{ ascending: true \}\)/)
  // No direct write: the dialogs call the purchasing functions.
  assert.doesNotMatch(screen, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/)
  // The party's open PO when there is one, else a new PO with the unit.
  assert.match(screen, /if \(row\.party_po_id\) \{\s+setTarget\(\{ kind: 'existing', row \}\)/)
  assert.match(screen, /kind: 'new',\s+preset: \{/)
  assert.match(screen, /<AddEquipmentDialog[\s\S]*?initialUnit=\{existingUnit\}/)
  assert.match(screen, /<CreateSupplierPoDialog[\s\S]*?preset=\{target\?\.kind === 'new' \? target\.preset : null\}/)
  // The add needs purchasing.manage; readers see the state only.
  assert.match(screen, /const canManage = can\('purchasing\.manage'\)/)
  // Tiles: coloured by state with a light border of the same tone
  // (2026-10-25), no badge, two columns.
  assert.match(screen, /const tone = row\.has_po \? 'success' : 'warning'/)
  assert.match(screen, /backgroundColor: `var\(--\$\{tone\}-soft\)`/)
  assert.match(screen, /borderColor: `color-mix\(in srgb, var\(--\$\{tone\}\) 25%, transparent\)`/)
  assert.match(screen, /className="flex flex-col gap-3 rounded-xl border p-3 text-\[13px\]"/)
  assert.doesNotMatch(screen, /<Badge/)
  // Two columns on every width (owner 2026-10-25).
  assert.match(screen, /grid grid-cols-2 gap-2/)
  assert.doesNotMatch(screen, /sm:grid-cols-3|lg:grid-cols-4|xl:grid-cols-4/)
})

test('the dialogs take the preset only when they open', () => {
  const add = read('src', 'components', 'purchasing', 'AddEquipmentDialog.tsx')
  assert.match(add, /initialUnit = null,/)
  assert.match(add, /setForm\(\{ \.\.\.EMPTY_FORM, equipment_id: initialUnit\?\.value \?\? '' \}\)/)
  const create = read('src', 'components', 'purchasing', 'CreateSupplierPoDialog.tsx')
  assert.match(create, /export interface CreateSupplierPoPreset \{/)
  assert.match(create, /preset = null,/)
  assert.match(create, /setPicked\(preset \? \{ \[preset\.equipmentId\]: \{ price: '', note: '' \} \} : \{\}\)/)
})

test('the list config allowlists its filters and sorts, units without a PO first', () => {
  const source = read('src', 'lib', 'listConfigs.ts')
  const start = source.indexOf('export const siteUnitsListConfig')
  assert.ok(start > 0)
  const config = source.slice(start)
  assert.match(config, /defaultSort: 'has_po',\s+defaultDirection: 'asc',/)
  const keys = [...config.matchAll(/^\s{6}key: '(\w+)',$/gm)].map((m) => m[1])
  assert.deepEqual(keys, [
    'has_po',
    'equipment_ownership_status',
    'company_id',
    'project_id',
    'entry_supervisor_id',
  ])
  assert.match(config, /SUPPLIER_FILTER_FIELD,/)
  assert.doesNotMatch(config, /pageSizeOptions/)
})

test('the route, the sidebar section and the translations', () => {
  const nav = read('src', 'lib', 'navPermissions.ts')
  assert.match(nav, /\{ key: 'purchasing\/units', requires: \[\{ key: 'purchasing\.view' \}\] \}/)
  assert.match(nav, /if \(second === 'units'\) return 'purchasing\/units'/)
  const app = read('src', 'App.tsx')
  assert.match(app, /'purchasing\/units': 'siteUnits',/)
  assert.match(app, /page === 'purchasing\/units' && \(\s+<SiteUnitsScreen/)
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of ['siteUnits', 'siteUnitsAddToPo', 'siteUnitsNoPo', 'siteUnitsHasPo']) {
    const matches = translations.match(new RegExp(`^    ${key}: '([^']*)',$`, 'gm')) ?? []
    assert.equal(matches.length, 2, key)
    // New Arabic copy: plain alif only.
    assert.doesNotMatch(matches[0], /[أإآ]/, key)
  }
})
