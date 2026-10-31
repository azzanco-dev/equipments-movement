const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-10-31: «ليش مايكون تعديل السائق من خانة تعديل الحركة للادمن يغير
// السائق مباشرة», «لو حركة فيه 3 سائقين تغيروا وابغى اغير السائق الثاني كيف»
// → the admin corrects any driver of a visit chain in place (0166).

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const file = fs.readdirSync(MIGRATIONS).find((name) => /_0166_/.test(name))
const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

function loadLib(name) {
  const source = read('src', 'lib', `${name}.ts`)
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(output, { exports, require: () => ({}) })
  return exports
}

test('0166 is the only 0166 and comes after 0165', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
  assert.equal(files.filter((f) => /_0166_/.test(f)).length, 1)
  for (const f of files.filter((f) => /_016[0-5]_/.test(f))) assert.ok(file > f)
})

test('the admin correction key, fail closed, definer with a fixed path', () => {
  assert.match(
    code,
    /auth\.uid\(\) is null or not public\.has_permission\('movements\.edit_delete'\)/,
  )
  assert.match(code, /security definer\s+set search_path = public, pg_temp/)
  assert.match(
    code,
    /revoke all on function public\.admin_correct_visit_driver\(uuid, uuid, uuid\) from public, anon;/,
  )
  assert.match(
    code,
    /grant execute on function public\.admin_correct_visit_driver\(uuid, uuid, uuid\) to authenticated;/,
  )
})

test('row lock first, then the sequence advisory key', () => {
  const lock = code.indexOf('for update;')
  const advisory = code.indexOf(
    "pg_advisory_xact_lock(hashtextextended(v_entry.equipment_id::text, 0))",
  )
  assert.ok(lock > 0 && advisory > lock)
  assert.match(code, /l\.movement_type = 'entry'\s+and l\.movement_context = 'site'/)
})

test('one link replaced, its next change starts from it', () => {
  // The entry driver (p_change_id NULL) or the new driver of one change.
  assert.match(code, /if p_change_id is null then/)
  assert.match(code, /set driver_id = v_new_id,\s+driver_name = v_new_name/)
  assert.match(code, /set new_driver_id = v_new_id,\s+new_driver_name = v_new_name/)
  assert.equal(
    (code.match(/set previous_driver_id = v_new_id,\s+previous_driver_name = v_new_name/g) || []).length,
    2,
  )
  // Deterministic chain order, id after the time.
  assert.match(code, /order by f\.changed_at, f\.id/)
  assert.match(code, /\(n\.changed_at, n\.id\) > \(v_change\.changed_at, v_change\.id\)/)
  assert.match(code, /order by c\.changed_at desc, c\.id desc/)
  // A change of another visit is refused.
  assert.match(code, /c\.entry_log_id = p_entry_log_id\s+for update;\s+if not found then\s+raise exception 'driver_change_not_found'/)
  assert.match(code, /raise exception 'driver_unchanged'/)
  assert.match(code, /raise exception 'invalid_driver_id'/)
})

test('a change to the same driver goes, the exit follows the last driver', () => {
  assert.match(
    code,
    /delete from public\.movement_driver_changes c\s+where c\.entry_log_id = p_entry_log_id\s+and c\.previous_driver_id = c\.new_driver_id;/,
  )
  assert.match(code, /\(l\.recorded_at, l\.id\) > \(v_entry\.recorded_at, v_entry\.id\)\s+order by l\.recorded_at, l\.id/)
  assert.match(code, /v_exit\.driver_id is not distinct from v_old_last/)
  assert.match(code, /v_exit\.movement_context = 'site'/)
})

test('a corrected change row is audited as driver_change', () => {
  assert.match(code, /insert into public\.movement_audit_logs/)
  assert.match(code, /array\['driver_change'\]/)
  assert.match(
    read('src', 'screens', 'MovementActivity.tsx'),
    /driver_change: t\('driverCorrectionAuditField'\)/,
  )
})

test('error tokens map to messages, never raw text', () => {
  const { driverCorrectionError } = loadLib('driverCorrection')
  const cases = [
    ['P0001: driver_unchanged', 'driverChangeSameDriver', 'driver_id'],
    ['invalid_driver_id', 'movementAdminInvalidDriver', 'driver_id'],
    ['admin_required', 'movementAdminAccessDenied', null],
    ['driver_change_not_found', 'driverCorrectionStale', null],
    ['something else', 'driverCorrectionFailed', null],
    [undefined, 'driverCorrectionFailed', null],
  ]
  for (const [message, key, target] of cases) {
    const result = driverCorrectionError(message)
    assert.equal(result.key, key)
    assert.equal(result.target, target)
  }
})

test('the movement page and the edit dialog correct through 0166', () => {
  const detail = read('src', 'screens', 'MovementDetail.tsx')
  assert.match(detail, /const canCorrectDriver = canEditMovement && Boolean\(driverEntryId\)/)
  assert.match(detail, /<DriverCorrectionDialog/)
  assert.match(detail, /setDriverCorrection\(\{ changeId: null, name: entryDriverName \}\)/)
  assert.match(detail, /changeId: change\.id,/)
  // The genuine swap stays the append-only path.
  assert.match(detail, /'change_active_movement_driver'/)

  const dialog = read('src', 'components', 'movement', 'MovementEditDialog.tsx')
  assert.doesNotMatch(dialog, /change_active_movement_driver'/)
  assert.match(dialog, /correctVisitDriver\(supabase, \{/)
  assert.match(dialog, /changeId: driverChangeId,/)
  assert.match(
    read('src', 'lib', 'driverCorrection.ts'),
    /client\.rpc\('admin_correct_visit_driver'/,
  )
})

test('the new Arabic copy has no hamza or madda alif', () => {
  const translations = read('src', 'i18n', 'translations.ts')
  const ar = translations.slice(0, translations.indexOf('  en: {'))
  for (const key of [
    'driverCorrectionTitle',
    'driverCorrectionDesc',
    'driverCorrectionCurrent',
    'driverCorrectionNew',
    'driverCorrectionAction',
    'driverCorrectionFailed',
    'driverCorrectionStale',
    'driverCorrectionAuditField',
    'movementEditOpenVisitDriverHint',
    'movementEditDriverPartial',
  ]) {
    const match = new RegExp(`${key}:\\s*'([^']*)'`).exec(ar)
    assert.ok(match, key)
    assert.doesNotMatch(match[1], /[أإآ]/, key)
  }
})
