const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// 0186 (owner 2026-11-09, «اضف تعديل غرض الخروج للادمن في مربع التعديل»): the
// admin corrects the purpose of a project exit in the movement edit dialog.

const root = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const MIGRATION = '20261109100000_0186_admin_edit_exit_purpose.sql'
const sql = read('supabase', 'migrations', MIGRATION)
const stripped = sql.replace(/--[^\n]*/g, '')
const SIG9 = 'uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text'
const SIG10 = `${SIG9}, text`
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function loadLibModule(name, cache = new Map()) {
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
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        if (request === 'zod') return require('zod')
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

function functionBody(source, name) {
  const start = source.indexOf(`FUNCTION public.${name}(`)
  assert.ok(start >= 0, name)
  const open = source.indexOf('$$', start)
  return source.slice(open, source.indexOf('$$;', open + 2))
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------
test('0186 drops the nine-argument signature before creating the ten', () => {
  const drop = stripped.indexOf(
    `DROP FUNCTION IF EXISTS public.admin_update_movement(${SIG9});`,
  )
  const create = stripped.indexOf(
    'CREATE FUNCTION public.admin_update_movement(',
  )
  assert.ok(drop >= 0, 'drop of the 0127 signature')
  assert.ok(create > drop, 'created after the drop')
  assert.doesNotMatch(
    stripped,
    /CREATE OR REPLACE FUNCTION public\.admin_update_movement\(/,
  )
  assert.match(
    stripped,
    /p_notes text DEFAULT NULL,\s+p_exit_purpose text DEFAULT NULL\s+\) RETURNS void/,
  )
})

test('the ten-argument function keeps its definer rules and grants', () => {
  const body = functionBody(stripped, 'admin_update_movement')
  assert.match(
    stripped,
    /CREATE FUNCTION public\.admin_update_movement\([\s\S]*?SECURITY DEFINER\s+SET search_path = public, pg_temp/,
  )
  assert.match(body, /has_permission\('movements\.edit_delete'\)/)
  assert.match(body, /pg_advisory_xact_lock\(hashtextextended\(/)
  assert.match(
    stripped,
    new RegExp(
      `REVOKE ALL ON FUNCTION public\\.admin_update_movement\\(${escape(SIG10)}\\) FROM PUBLIC, anon;`,
    ),
  )
  assert.match(
    stripped,
    new RegExp(
      `GRANT EXECUTE ON FUNCTION public\\.admin_update_movement\\(${escape(SIG10)}\\) TO authenticated;`,
    ),
  )
  assert.match(
    stripped,
    new RegExp(
      `COMMENT ON FUNCTION public\\.admin_update_movement\\(${escape(SIG10)}\\) IS`,
    ),
  )
  assert.match(stripped, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('the purpose is checked and written for a site exit only', () => {
  const body = functionBody(stripped, 'admin_update_movement')
  assert.match(
    body,
    /IF p_exit_purpose IS NOT NULL THEN\s+IF v_log\.movement_context IS DISTINCT FROM 'site'\s+OR v_log\.movement_type IS DISTINCT FROM 'exit' THEN\s+RAISE EXCEPTION 'exit_purpose_not_allowed'\s+USING ERRCODE = '22023'/,
  )
  assert.match(
    body,
    /IF p_exit_purpose NOT IN \('maintenance', 'work_completed'\) THEN\s+RAISE EXCEPTION 'invalid_exit_purpose'\s+USING ERRCODE = '22023'/,
  )
  assert.match(
    body,
    /exit_purpose = CASE\s+WHEN l\.movement_context = 'site' AND l\.movement_type = 'exit'\s+THEN COALESCE\(p_exit_purpose, l\.exit_purpose\)\s+ELSE l\.exit_purpose\s+END/,
  )
})

test('the rest of the 0127 body is carried over verbatim', () => {
  const before = functionBody(
    read(
      'supabase',
      'migrations',
      '20261011140000_0127_permission_keys_in_policies.sql',
    ).slice(
      read(
        'supabase',
        'migrations',
        '20261011140000_0127_permission_keys_in_policies.sql',
      ).indexOf('CREATE OR REPLACE FUNCTION public.admin_update_movement('),
    ),
    'admin_update_movement',
  )
  const after = functionBody(sql, 'admin_update_movement')
  const without0186 = after
    .replace(/\n {2}-- 0186:[\s\S]*?\n {2}END IF;\n\n/, '\n')
    .replace(/,\n {4}exit_purpose = CASE[\s\S]*?\n {4}END\n/, '\n')
  assert.equal(without0186, before)
})

test('the audit trigger records a changed exit purpose', () => {
  const snapshot = functionBody(stripped, 'movement_audit_snapshot')
  const audit = functionBody(stripped, 'audit_movement_change')
  assert.match(snapshot, /'exit_purpose', p_log\.exit_purpose/)
  assert.match(audit, /'exit_purpose', OLD\.exit_purpose/)
  assert.match(audit, /'exit_purpose', NEW\.exit_purpose/)
  assert.match(
    stripped,
    /REVOKE ALL ON FUNCTION public\.audit_movement_change\(\) FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    stripped,
    /REVOKE ALL ON FUNCTION public\.movement_audit_snapshot\(public\.entry_exit_logs\) FROM PUBLIC, anon, authenticated;/,
  )
  // The activity log already reads the field.
  const activity = read('src', 'lib', 'activityLog.ts')
  assert.match(activity, /exit_purpose: 'exitPurpose'/)
  assert.match(activity, /work_completed: 'exitPurposeWorkCompleted'/)
})

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
test('the PATCH route validates and forwards the purpose', () => {
  const route = read('app', 'api', 'movements', '[id]', 'route.ts')
  assert.match(route, /import \{ isExitPurpose \} from '@\/lib\/exitPurpose'/)
  assert.match(
    route,
    /if \(exitPurpose !== null && !isExitPurpose\(exitPurpose\)\)\s+return NextResponse\.json\(\s+\{ error: 'invalid_exit_purpose' \},\s+\{ status: 400 \},/,
  )
  assert.match(route, /p_exit_purpose: exitPurpose,/)
  const validation = route.indexOf("{ error: 'invalid_exit_purpose' }")
  const rpc = route.indexOf("rpc('admin_update_movement'")
  assert.ok(validation >= 0 && validation < rpc, 'validated before the RPC')
})

test('the database tokens map to safe 400 codes and messages', () => {
  const { movementAdminErrorCode, movementAdminErrorStatus } =
    loadLibModule('movementErrors')
  const { movementAdminErrorKey, movementEditFieldErrors } =
    loadLibModule('movementAdmin')
  assert.equal(
    movementAdminErrorCode('invalid_exit_purpose', 'update'),
    'invalid_exit_purpose',
  )
  assert.equal(
    movementAdminErrorCode('exit_purpose_not_allowed', 'update'),
    'exit_purpose_not_allowed',
  )
  assert.equal(movementAdminErrorStatus('invalid_exit_purpose'), 400)
  assert.equal(movementAdminErrorStatus('exit_purpose_not_allowed'), 400)
  assert.deepEqual(
    { ...movementEditFieldErrors('invalid_exit_purpose') },
    { exit_purpose: 'exitPurposeInvalid' },
  )
  assert.equal(movementEditFieldErrors('exit_purpose_not_allowed'), null)
  assert.equal(
    movementAdminErrorKey('exit_purpose_not_allowed'),
    'movementEditExitPurposeNotAllowed',
  )
})

// ---------------------------------------------------------------------------
// Dialog helpers
// ---------------------------------------------------------------------------
const NOW = new Date('2026-11-09T12:00:00Z')
const base = {
  equipment_id: 'e',
  supervisor_id: 's',
  movement_date: '2026-11-01',
  company_id: 'c',
  project_id: 'p',
  contractor_code: '',
  driver_id: 'd',
  notes: '',
  exit_purpose: 'maintenance',
}

test('a site exit requires a valid purpose; other rows ignore it', () => {
  const { validateMovementEdit } = loadLibModule('movementAdmin')
  const errors = (values, siteExit) => ({
    ...validateMovementEdit(values, 'site', NOW, false, siteExit),
  })
  assert.deepEqual(errors(base, true), {})
  assert.deepEqual(errors({ ...base, exit_purpose: '' }, true), {
    exit_purpose: 'exitPurposeRequired',
  })
  assert.deepEqual(errors({ ...base, exit_purpose: 'parking' }, true), {
    exit_purpose: 'exitPurposeInvalid',
  })
  assert.deepEqual(errors({ ...base, exit_purpose: '' }, false), {})
})

test('a changed purpose counts as a change and is sent only then', () => {
  const { movementEditUnchanged, buildMovementEditPayload } =
    loadLibModule('movementAdmin')
  const changed = { ...base, exit_purpose: 'work_completed' }
  assert.equal(movementEditUnchanged(base, base), true)
  assert.equal(movementEditUnchanged(changed, base), false)
  const params = {
    context: 'site',
    originalRecordedAt: '2026-11-01T08:00:00.000Z',
    currentDriverId: 'd',
    driverMode: 'admin',
    siteExit: true,
    originalExitPurpose: 'maintenance',
    now: NOW,
  }
  assert.equal(
    buildMovementEditPayload(changed, params).exit_purpose,
    'work_completed',
  )
  assert.ok(!('exit_purpose' in buildMovementEditPayload(base, params)))
  assert.ok(
    !(
      'exit_purpose' in
      buildMovementEditPayload(changed, { ...params, siteExit: false })
    ),
  )
})

test('the dialog shows the purpose field for a site exit only', () => {
  const dialog = read('src', 'components', 'movement', 'MovementEditDialog.tsx')
  assert.match(
    dialog,
    /const siteExit = site && movement\.movement_type === 'exit'/,
  )
  assert.match(
    dialog,
    /\{siteExit && \(\s+<Field\s+label=\{t\('exitPurpose'\)\}\s+name="exit_purpose"\s+required/,
  )
  assert.match(dialog, /options=\{EXIT_PURPOSES\.map\(/)
  assert.match(
    dialog,
    /siteExit,\s+originalExitPurpose: initial\.exit_purpose,/,
  )
  assert.match(
    dialog,
    /validateMovementEdit\(\s*values,\s*context,\s*undefined,\s*keepDriver,\s*siteExit,\s*\)/,
  )
})

test('the new copy exists in both languages without hamza on alif', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const [, ar, en] = source.split(/\n {2}(?:ar|en): \{\n/)
  assert.match(ar, /movementEditExitPurposeNotAllowed: '([^']+)'/)
  assert.match(en, /movementEditExitPurposeNotAllowed:\s+'[^']+'/)
  const arabic = /movementEditExitPurposeNotAllowed: '([^']+)'/.exec(ar)[1]
  assert.doesNotMatch(arabic, /[أإآ]/)
  assert.doesNotMatch(sql, /[أإآ]/)
})
