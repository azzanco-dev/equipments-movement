// Migration 0187 (owner 2026-11-09, «حذف المعدة بشرط مفتوح ومسودة»): a unit
// is removed from a supplier PO while the PO is open and a draft; the card
// goes with the line when nothing else uses it.
//
// Static checks of the migration, the wrapper, the dialog and the page.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const migrationsDir = path.join(root, 'supabase', 'migrations')
const migrations = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
const MIGRATION = '20261109110000_0187_remove_supplier_po_equipment.sql'
const raw = read('supabase', 'migrations', MIGRATION)
const sql = norm(raw)

test('the migration is the 0187 file', () => {
  assert.ok(migrations.includes(MIGRATION))
})

test('the function: definer, fixed search_path, purchasing.manage first', () => {
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.remove_supplier_po_equipment\( p_line_id uuid, p_note text DEFAULT NULL \) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$\$/,
  )
  assert.match(sql, /BEGIN PERFORM public\.assert_purchasing_manage\(\);/)
})

test('the guards and their tokens, line then PO locked', () => {
  const lineLock = sql.indexOf(
    'FROM public.supplier_po_equipment l WHERE l.id = p_line_id FOR UPDATE',
  )
  const poLock = sql.indexOf(
    'FROM public.supplier_pos p WHERE p.id = v_line.supplier_po_id FOR UPDATE',
  )
  const cardLock = sql.indexOf(
    'FROM public.equipment_cards c WHERE c.id = v_line.equipment_card_id FOR UPDATE',
  )
  assert.ok(lineLock > 0 && poLock > lineLock && cardLock > poLock)
  assert.match(sql, /RAISE EXCEPTION 'invalid_line' USING ERRCODE = '22023'/)
  assert.match(
    sql,
    /IF v_po\.status <> 'open' THEN RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000'/,
  )
  assert.match(
    sql,
    /IF v_po\.approval_status <> 'draft' THEN RAISE EXCEPTION 'po_approved_locked' USING ERRCODE = '55000'/,
  )
  assert.match(
    sql,
    /IF char_length\(v_note\) > 500 THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023'/,
  )
  // The unit's advisory key, before the card lock (add_supplier_po_equipment's).
  const advisory = sql.indexOf(
    'pg_advisory_xact_lock(hashtextextended(v_equipment_id::text, 0))',
  )
  assert.ok(advisory > poLock && advisory < cardLock)
})

test('the delete, the event and the return', () => {
  assert.match(
    sql,
    /DELETE FROM public\.supplier_po_equipment WHERE id = v_line\.id;/,
  )
  assert.match(
    sql,
    /INSERT INTO public\.supplier_po_events \(supplier_po_id, event_type, payload, actor_id\) VALUES \( v_po\.id, 'equipment_removed', jsonb_build_object\( 'line_id', v_line\.id, 'equipment_id', v_card\.equipment_id, 'equipment_code', v_code, 'card_id', v_card\.id, 'price', v_line\.price, 'rate_unit', v_line\.rate_unit, 'line_note', v_line\.note, 'note', v_note, 'card_kept', NOT v_card_deleted \), auth\.uid\(\) \);/,
  )
  assert.match(
    sql,
    /RETURN jsonb_build_object\( 'line_id', v_line\.id, 'card_id', v_card\.id, 'card_deleted', v_card_deleted \);/,
  )
})

test('the card goes only when nothing else uses it', () => {
  const start = sql.indexOf("IF v_card.pricing_status = 'draft'")
  const end = sql.indexOf(
    'DELETE FROM public.equipment_cards WHERE id = v_card.id;',
  )
  assert.ok(start > 0 && end > start)
  const cond = sql.slice(start, end)
  assert.match(cond, /AND v_card\.client_price IS NULL/)
  for (const table of [
    'supplier_po_equipment',
    'client_po_equipment',
    'equipment_card_months',
    'equipment_card_events',
  ])
    assert.match(
      cond,
      new RegExp(
        `NOT EXISTS \\( SELECT 1 FROM public\\.${table} \\w+ WHERE \\w+\\.equipment_card_id = v_card\\.id \\)`,
      ),
      table,
    )
  // The line is deleted before the check, so "no supplier line" means none left.
  assert.ok(
    sql.indexOf(
      'DELETE FROM public.supplier_po_equipment WHERE id = v_line.id;',
    ) < start,
  )
})

test('revoke and grant, a comment', () => {
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.remove_supplier_po_equipment\(uuid, text\) FROM PUBLIC, anon;/,
  )
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.remove_supplier_po_equipment\(uuid, text\) TO authenticated;/,
  )
  assert.match(
    sql,
    /COMMENT ON FUNCTION public\.remove_supplier_po_equipment\(uuid, text\) IS/,
  )
})

test('the event type is already in the latest CHECK (0174), not re-created', () => {
  const withCheck = migrations.filter((file) =>
    read('supabase', 'migrations', file).includes(
      'ADD CONSTRAINT supplier_po_events_type_check',
    ),
  )
  const latest = withCheck[withCheck.length - 1]
  assert.equal(latest, '20261104110000_0174_equipment_card_pricing.sql')
  const body = norm(read('supabase', 'migrations', latest))
  const at = body.indexOf('ADD CONSTRAINT supplier_po_events_type_check')
  const list = /event_type IN \(([^)]+)\)/.exec(body.slice(at))[1]
  assert.ok(list.includes("'equipment_removed'"))
  assert.ok(!raw.includes('supplier_po_events_type_check CHECK'))
})

test('the 0146 touch trigger fires on DELETE', () => {
  const touch = norm(
    read(
      'supabase',
      'migrations',
      '20261022160000_0146_supplier_po_updated_at.sql',
    ),
  )
  assert.match(
    touch,
    /CREATE TRIGGER supplier_po_equipment_touch_po AFTER INSERT OR UPDATE OR DELETE ON public\.supplier_po_equipment/,
  )
})

test('the wrapper names the RPC and its parameters', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(
    data,
    /export async function removeSupplierPoEquipment\(input: \{\s*lineId: string\s*note: string\s*\}\): Promise<RpcResult<RemovedSupplierPoLine>>/,
  )
  assert.match(
    data,
    /supabase\.rpc\('remove_supplier_po_equipment', \{\s*p_line_id: input\.lineId,\s*p_note: input\.note\.trim\(\) \|\| null,\s*\}\)/,
  )
  assert.match(data, /case 'equipment_removed': \{[\s\S]*?payload\.note/)
})

test('the dialog: danger button, the card line, the note schema', () => {
  const dialog = read(
    'src',
    'components',
    'purchasing',
    'RemoveEquipmentDialog.tsx',
  )
  assert.match(dialog, /removeSupplierPoEquipment\(/)
  assert.match(dialog, /variant="danger"/)
  assert.match(dialog, /supplierPoRemoveLineCardNote/)
  assert.match(dialog, /supplierPoRemoveLineFormSchema/)
  assert.match(dialog, /supplierPoFormMessage\(result\.error\)/)
  const validation = read('src', 'lib', 'formValidation.ts')
  assert.match(
    validation,
    /export const supplierPoRemoveLineFormSchema = supplierPoLineFormSchema\.pick\(\{\s*note: true,\s*\}\)/,
  )
})

test('the page offers «حذف» only on a draft PO for purchasing.manage', () => {
  const page = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  // 0189: no open / closed state — a manager, a draft.
  assert.match(page, /const showActions = canManage/)
  assert.match(
    page,
    /const removable = showActions && po\.approval_status === 'draft'/,
  )
  assert.match(
    page,
    /\{removable && \(\s*<Button[\s\S]*?onClick=\{\(\) => setRemoving\(line\)\}/,
  )
  assert.match(page, /<RemoveEquipmentDialog\s+line=\{removing\}/)
  assert.match(
    page,
    /toast\(\{ title: t\('supplierPoRemovedToast'\), tone: 'success' \}\)/,
  )
})

test('labels and messages in both languages, no hamza on alif', () => {
  const purchasing = read('src', 'lib', 'purchasing.ts')
  assert.match(
    purchasing,
    /equipment_removed: 'supplierPoEventEquipmentRemoved'/,
  )
  assert.match(purchasing, /invalid_line: 'supplierPoErrorInvalidLine'/)
  // 0189 retired po_closed (a PO is never closed).
  assert.doesNotMatch(purchasing, /po_closed: /)
  assert.match(
    purchasing,
    /po_approved_locked: 'supplierPoErrorApprovedLocked'/,
  )
  const sales = read('src', 'lib', 'sales.ts')
  assert.match(sales, /equipment_removed: 'supplierPoEventEquipmentRemoved'/)

  const translations = read('src', 'i18n', 'translations.ts')
  const keys = [
    'supplierPoRemoveLine',
    'supplierPoRemoveLineTitle',
    'supplierPoRemoveLineDesc',
    'supplierPoRemoveLineCardNote',
    'supplierPoRemoveLineNote',
    'supplierPoRemovedToast',
    'supplierPoEventEquipmentRemoved',
  ]
  for (const key of keys) {
    const matches = [
      ...translations.matchAll(
        new RegExp(`\\b${key}:\\s*\\n?\\s*'([^']*)'`, 'g'),
      ),
    ]
    assert.equal(matches.length, 2, key)
    assert.ok(/[؀-ۿ]/.test(matches[0][1]), `${key} ar`)
    assert.ok(!/[؀-ۿ]/.test(matches[1][1]), `${key} en`)
    assert.ok(!/[أإآ]/.test(matches[0][1]), `${key} hamza`)
  }
  assert.ok(
    !/[أإآ]/.test(
      read('src', 'components', 'purchasing', 'RemoveEquipmentDialog.tsx'),
    ),
  )
})
