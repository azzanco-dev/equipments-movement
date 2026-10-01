const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Guards wave 10: the purpose of a SITE exit (migration 0111, the movement
// API, the form and the detail page). The database is the authoritative place
// for the rule, so a change that drops one of these properties must fail here.
const root = path.join(__dirname, '..')

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8')
}

const MIGRATION = '20261001120000_0111_exit_purpose.sql'
const sql = read('supabase', 'migrations', MIGRATION)

function functionBody(source, name) {
  const match = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`,
  ).exec(source)
  assert.ok(match, `missing function: ${name}`)
  const end = source.indexOf('\n$$;', match.index)
  assert.ok(end > match.index, `unterminated function: ${name}`)
  return source.slice(match.index, end)
}

// SQL with `--` comments removed (literals kept: the checks assert on them).
function withoutComments(source) {
  return source
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

const stripped = withoutComments(sql)
// The database requirement is held back until the new form is live (see the
// rollout note in 0111); it is still guarded here so it is ready to promote.
const PENDING = read(
  'supabase',
  'pending',
  '0112_require_site_exit_purpose.sql',
)
const pendingStripped = withoutComments(PENDING)
const trigger = functionBody(PENDING, 'enforce_site_exit_purpose')

// --- Migration ---------------------------------------------------------------

test('0111 is a new migration ordered after 0110 and is balanced', () => {
  const files = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const at0110 = files.findIndex((file) => file.includes('_0110_'))
  const at0111 = files.indexOf(MIGRATION)
  assert.ok(at0110 >= 0 && at0111 > at0110)
  assert.equal((stripped.match(/\$\$/g) ?? []).length % 2, 0)
  let depth = 0
  for (const char of stripped) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    assert.ok(depth >= 0, 'unbalanced parentheses')
  }
  assert.equal(depth, 0, 'unbalanced parentheses')
  assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('the column is nullable with an allowlist and a site-exit-only check', () => {
  assert.match(
    stripped,
    /ALTER TABLE public\.entry_exit_logs\s+ADD COLUMN IF NOT EXISTS exit_purpose text;/,
  )
  assert.ok(!/exit_purpose text NOT NULL/.test(stripped))
  assert.ok(!/exit_purpose text DEFAULT/.test(stripped))
  assert.match(
    stripped,
    /CHECK \(exit_purpose IS NULL OR exit_purpose IN \('maintenance', 'work_completed'\)\)/,
  )
  assert.match(
    stripped,
    /CHECK \(\s+exit_purpose IS NULL\s+OR \(movement_type = 'exit' AND movement_context = 'site'\)\s+\)/,
  )
})

test('0111 itself adds no trigger, so the live form keeps working when it is applied', () => {
  assert.ok(!/CREATE TRIGGER/.test(stripped))
  assert.ok(!/FUNCTION public\.enforce_site_exit_purpose/.test(stripped))
  assert.match(sql, /supabase\/pending\/0112_require_site_exit_purpose\.sql/)
})

test('the big sequence trigger and the admin functions are not redefined', () => {
  for (const name of [
    'enforce_movement_sequence',
    'admin_update_movement',
    'admin_delete_movement',
    'import_movement_rows',
  ])
    assert.ok(
      !new RegExp(`FUNCTION public\\.${name}\\(`).test(stripped),
      `0111 must not redefine ${name}`,
    )
  assert.ok(!/movement_log_search/.test(stripped))
  assert.ok(!/CREATE (OR REPLACE )?VIEW/.test(stripped))
})

test('the trigger function is hygienic and not executable by clients', () => {
  assert.match(trigger, /RETURNS trigger/)
  assert.match(trigger, /SET search_path = public, pg_temp/)
  assert.match(
    pendingStripped,
    /REVOKE ALL ON FUNCTION public\.enforce_site_exit_purpose\(\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.ok(
    !/GRANT [^;]*enforce_site_exit_purpose/.test(pendingStripped),
    'no grant on the trigger function',
  )
})

test('the trigger is BEFORE INSERT and fires after the sequence trigger', () => {
  assert.match(
    pendingStripped,
    /CREATE TRIGGER enforce_site_exit_purpose\s+BEFORE INSERT ON public\.entry_exit_logs\s+FOR EACH ROW EXECUTE FUNCTION public\.enforce_site_exit_purpose\(\);/,
  )
  // Same timing and event fire in name order: the sequence trigger first.
  assert.ok('enforce_movement_sequence' < 'enforce_site_exit_purpose')
})

test('entries and workshop rows never keep a purpose', () => {
  assert.match(
    trigger,
    /IF NEW\.movement_type IS DISTINCT FROM 'exit'\s+OR NEW\.movement_context IS DISTINCT FROM 'site' THEN\s+NEW\.exit_purpose := NULL;\s+RETURN NEW;/,
  )
})

test('a site exit without a purpose raises the stable code, except the admin import', () => {
  const body = withoutComments(trigger)
  assert.match(body, /IF NEW\.exit_purpose IS NULL THEN/)
  assert.match(
    body,
    /SELECT p\.role INTO v_role FROM public\.profiles p WHERE p\.id = auth\.uid\(\);/,
  )
  // Exactly the 0108 (M8) predicate: the import marker AND an admin caller.
  assert.match(
    body,
    /IF current_setting\('app\.movement_excel_import', true\) = 'true'\s+AND v_role = 'admin' THEN\s+RETURN NEW;/,
  )
  assert.match(body, /RAISE EXCEPTION 'exit_purpose_required'/)
  // The exemption is checked before the raise, and nothing else exempts.
  assert.ok(
    body.indexOf('app.movement_excel_import') <
      body.indexOf("RAISE EXCEPTION 'exit_purpose_required'"),
  )
  assert.equal((body.match(/current_setting\(/g) ?? []).length, 1)
  // The import marker is still set by the import function it exempts.
  assert.match(
    read(
      'supabase',
      'migrations',
      '20260829133000_0063_optional_driver_for_movement_import.sql',
    ),
    /PERFORM set_config\('app\.movement_excel_import', 'true', true\);/,
  )
})

// --- Shared helper, error mapping ---------------------------------------------

function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(root, 'src', 'lib', `${name}.ts`)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    output,
    {
      exports,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

test('the allowlist matches the database check exactly', () => {
  const { EXIT_PURPOSES, isExitPurpose, exitPurposeLabelKey } =
    loadLibModule('exitPurpose')
  assert.deepEqual([...EXIT_PURPOSES], ['maintenance', 'work_completed'])
  assert.equal(isExitPurpose('maintenance'), true)
  assert.equal(isExitPurpose('work_completed'), true)
  for (const bad of ['', 'parking', 'MAINTENANCE', null, undefined, 1])
    assert.equal(isExitPurpose(bad), false)
  assert.equal(exitPurposeLabelKey('maintenance'), 'exitPurposeMaintenance')
  assert.equal(
    exitPurposeLabelKey('work_completed'),
    'exitPurposeWorkCompleted',
  )
  assert.equal(exitPurposeLabelKey(null), null)
})

test('the database code maps to 400 and to a translated message', () => {
  const { movementErrorCode, movementErrorStatus, MOVEMENT_ERROR_CODES } =
    loadLibModule('movementErrors')
  const { movementSaveErrorKey } = loadLibModule('movementSaveErrors')
  assert.equal(
    movementErrorCode(
      'exit_purpose_required\nHINT: Choose the purpose of the site exit: maintenance or work_completed.',
    ),
    'exit_purpose_required',
  )
  for (const code of ['exit_purpose_required', 'invalid_exit_purpose']) {
    assert.ok(MOVEMENT_ERROR_CODES.includes(code))
    assert.equal(movementErrorStatus(code), 400)
  }
  assert.equal(
    movementSaveErrorKey('exit_purpose_required', false),
    'exitPurposeRequired',
  )
  assert.equal(
    movementSaveErrorKey('invalid_exit_purpose', false),
    'exitPurposeInvalid',
  )
  // Existing codes are untouched.
  assert.equal(movementErrorStatus('exit_not_entry_owner'), 403)
  assert.equal(movementErrorStatus('invalid_sequence'), 409)
})

// --- API -----------------------------------------------------------------------

test('the API allowlists the purpose and forwards it for site exits only', () => {
  const route = read('app', 'api', 'movements', 'route.ts')
  assert.match(route, /import \{ isExitPurpose \} from '@\/lib\/exitPurpose'/)
  // Multipart requests carry the field too.
  assert.match(route, /'recorded_at',\s+'exit_purpose',\s+\]\) \{/)
  assert.match(
    route,
    /const isSiteExit = movementType === 'exit' && movementContext === 'site'/,
  )
  assert.match(
    route,
    /if \(movementType === 'exit' && exitPurpose && !isExitPurpose\(exitPurpose\)\) \{\s+return NextResponse\.json\(\s+\{ error: 'invalid_exit_purpose' \},\s+\{ status: 400 \},/,
  )
  assert.match(
    route,
    /if \(isSiteExit && !exitPurpose\) \{\s+return NextResponse\.json\(\s+\{ error: 'exit_purpose_required' \},\s+\{ status: 400 \},/,
  )
  assert.match(route, /if \(isSiteExit\) payload\.exit_purpose = exitPurpose/)
  assert.equal((route.match(/payload\.exit_purpose/g) ?? []).length, 1)
  // The checks run before anything is inserted.
  assert.ok(
    route.indexOf("'exit_purpose_required'") <
      route.indexOf(".from('entry_exit_logs')"),
  )
})

// --- Form and detail page --------------------------------------------------------

test('the form shows a required purpose select on site exits only', () => {
  const form = read('src', 'components', 'EntryExitForm.tsx')
  assert.match(form, /const siteExitMode = !workshopMode && !isEntry/)
  assert.match(
    form,
    /\{siteExitMode && \(\s+<Field\s+label=\{t\('exitPurpose'\)\}\s+name="exit_purpose"\s+required/,
  )
  assert.match(form, /<Select\s+\{\.\.\.control\}\s+value=\{exitPurpose\}/)
  assert.match(form, /placeholder=\{t\('exitPurposePlaceholder'\)\}/)
  // No default selection, cleared on reset.
  assert.match(form, /useState<ExitPurpose \| ''>\(''\)/)
  assert.match(form, /setExitPurpose\(''\)/)
  // Submit is blocked with a field error, in the visual order of the form.
  assert.match(
    form,
    /exit_purpose:\s+siteExitMode && !exitPurpose \? 'exitPurposeRequired' : undefined,/,
  )
  assert.match(form, /'project',\s+'exit_purpose',\s+'recorded_at',/)
  assert.match(
    form,
    /if \(siteExitMode && exitPurpose\) payload\.exit_purpose = exitPurpose/,
  )
  // The field appears exactly once and never in the workshop/entry branches.
  assert.equal((form.match(/name="exit_purpose"/g) ?? []).length, 1)
})

test('the detail page shows the purpose on site exits with the dash for NULL', () => {
  const detail = read('src', 'screens', 'MovementDetail.tsx')
  assert.match(
    detail,
    /import \{ exitPurposeLabelKey \} from '@\/lib\/exitPurpose'/,
  )
  assert.match(
    detail,
    /\.\.\.\(!isWorkshopMovement && !isEntry\s+\? \[\s+\{\s+key: 'exitPurpose',/,
  )
  assert.match(detail, /label: t\('exitPurpose'\)/)
  // NULL reaches DescriptionList as null, which renders the muted dash.
  assert.match(detail, /value: exitPurposeKey \? t\(exitPurposeKey\) : null/)
  // The movement query selects every column of the row.
  assert.match(detail, /\.from\('entry_exit_logs'\)\s+\.select\(\s+'\*, /)
})

// --- Translations ------------------------------------------------------------------

test('the wave-10 strings exist in both languages and follow the Arabic rule', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = source.match(
    /\/\/ wave-10-exit-purpose — start[\s\S]*?\/\/ wave-10-exit-purpose — end/g,
  )
  assert.equal(blocks?.length, 2, 'one delimited block per language')
  for (const block of blocks)
    for (const key of [
      'exitPurpose',
      'exitPurposePlaceholder',
      'exitPurposeMaintenance',
      'exitPurposeWorkCompleted',
      'exitPurposeRequired',
      'exitPurposeInvalid',
    ])
      assert.match(block, new RegExp(`\\b${key}:`))
  const arabic = blocks.find((block) => /[؀-ۿ]/.test(block))
  assert.ok(arabic, 'the Arabic block is missing')
  assert.match(arabic, /exitPurpose: 'غرض الخروج'/)
  assert.match(arabic, /exitPurposeMaintenance: 'للصيانة'/)
  assert.match(arabic, /exitPurposeWorkCompleted: 'انتهاء عمل'/)
  // New Arabic copy uses the plain alif: no hamza or madda forms.
  assert.ok(!/[أإآ]/.test(arabic))
  const english = blocks.find((block) => block !== arabic)
  assert.match(english, /exitPurposeMaintenance: 'For maintenance'/)
  assert.match(english, /exitPurposeWorkCompleted: 'Work completed'/)
})
