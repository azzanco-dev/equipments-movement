const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-10-29: «263 في اسطول الموردين، 241 في داخل المشاريع للموردين»
// → «منتهية» (`rental_ended`) for supplier units: automatic on a project
// exit, active again on any entry, out of the fleet figures; «حول ال 22».

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const file = fs.readdirSync(MIGRATIONS).find((name) => /_0163_/.test(name))
const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

test('0163 is the only 0163 and comes after both 0162s', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
  assert.equal(files.filter((f) => /_0163_/.test(f)).length, 1)
  for (const f of files.filter((f) => /_016[12]_/.test(f))) assert.ok(file > f)
})

test('the status value, for supplier units only', () => {
  assert.match(code, /CHECK \(status IN \('active', 'sold', 'rental_ended'\)\)/)
  assert.match(
    code,
    /equipment_rental_ended_external_check\s+CHECK \(status <> 'rental_ended' OR ownership_status = 'external_supplier'\)/,
  )
})

test('never «منتهية» while inside a project or the workshop', () => {
  const guard = code.slice(
    code.indexOf('FUNCTION public.guard_equipment_rental_ended'),
  )
  assert.match(guard, /ORDER BY l\.recorded_at DESC, l\.id DESC/)
  assert.match(
    guard,
    /IF v_type = 'entry' THEN\s+RAISE EXCEPTION 'equipment_inside_cannot_end'/,
  )
  assert.match(code, /BEFORE INSERT OR UPDATE OF status ON public\.equipment/)
})

test('the latest movement decides: a project exit ends, any entry restores', () => {
  const sync = code.slice(
    code.indexOf('FUNCTION public.sync_equipment_rental_status'),
    code.indexOf('FUNCTION public.equipment_rental_lifecycle'),
  )
  assert.match(sync, /SECURITY DEFINER/)
  assert.match(sync, /SET search_path = public, pg_temp/)
  assert.match(sync, /v_owner IS DISTINCT FROM 'external_supplier'/)
  assert.match(sync, /ORDER BY l\.recorded_at DESC, l\.id DESC\s+LIMIT 1/)
  assert.match(
    sync,
    /v_status = 'active' AND v_type = 'exit' AND v_context = 'site' THEN\s+UPDATE public\.equipment SET status = 'rental_ended'/,
  )
  assert.match(
    sync,
    /v_status = 'rental_ended' AND v_type = 'entry' THEN\s+UPDATE public\.equipment SET status = 'active', is_active = true/,
  )
  assert.match(
    code,
    /AFTER INSERT OR DELETE OR UPDATE OF movement_type, movement_context, recorded_at, equipment_id\s+ON public\.entry_exit_logs/,
  )
  assert.match(
    code,
    /REVOKE ALL ON FUNCTION public\.sync_equipment_rental_status\(uuid\) FROM PUBLIC, anon, authenticated;/,
  )
})

test('the entry searches offer «منتهية» units; the Excel update accepts it', () => {
  assert.match(
    code,
    /WHERE \(\(e\.is_active AND e\.status = 'active'\) OR e\.status = 'rental_ended'\)/,
  )
  assert.match(
    code,
    /OR \(p_movement_type = 'entry' AND e\.status = 'rental_ended'\)/,
  )
  assert.match(
    code,
    /IF v_status NOT IN \('active', 'sold', 'rental_ended'\) THEN/,
  )
  // The 0134 per-row code-change check is carried over.
  assert.match(
    code,
    /AND NOT public\.has_permission\('equipment\.change_code'\)/,
  )
})

test('the backfill: active supplier units whose latest movement left a project', () => {
  const backfill = code.slice(code.indexOf('DO $$'))
  assert.match(backfill, /e\.ownership_status = 'external_supplier'/)
  assert.match(backfill, /e\.status = 'active'\s+AND e\.is_active/)
  assert.match(backfill, /= 'exit:site';/)
  assert.match(code, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('the screens: offered for «مالك اخر», shown instead of «متاحة»', () => {
  const badge = read(
    'src',
    'components',
    'equipment',
    'EquipmentStateBadge.tsx',
  )
  assert.match(badge, /if \(assetStatus === 'rental_ended'\)/)
  for (const [file, pattern] of [
    [
      ['src', 'screens', 'equipment', 'EquipmentTable.tsx'],
      /assetStatus=\{row\.status\}/,
    ],
    [
      ['src', 'screens', 'EquipmentDetail.tsx'],
      /assetStatus=\{equipment\.status\}/,
    ],
    [
      ['src', 'screens', 'inquiry', 'EquipmentInquiryScreen.tsx'],
      /assetStatus=\{equipment\.status\}/,
    ],
  ])
    assert.match(read(...file), pattern, file.join('/'))
  const dialog = read('src', 'screens', 'equipment', 'EquipmentFormDialog.tsx')
  assert.match(dialog, /equipmentStatusesFor\(form\.ownership_status\)/)
  assert.match(
    dialog,
    /status !== 'external_supplier' && next\.status === 'rental_ended'/,
  )
  const validation = read('src', 'lib', 'formValidation.ts')
  assert.match(
    validation,
    /form\.status === 'rental_ended' &&\s+form\.ownership_status !== 'external_supplier'/,
  )
  const translations = read('src', 'i18n', 'translations.ts')
  assert.match(translations, /equipmentStatusRentalEnded: 'منتهية'/)
  for (const line of translations
    .split('\n')
    .filter((l) => /RentalEnded|InsideCannotEnd/.test(l)))
    assert.doesNotMatch(line, /[أإآ]/)
})
