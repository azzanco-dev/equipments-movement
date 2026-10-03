const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// EM-196: equipment code change history (migration 0114) and its UI helpers.

function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(__dirname, '..', 'src', 'lib', `${name}.ts`)
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
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const history = loadLibModule('equipmentCodeHistory')
const plain = (value) => JSON.parse(JSON.stringify(value))

const sql = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20261003110000_0114_equipment_code_changes.sql',
  ),
  'utf8',
)

function functionBody(name) {
  const match = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`,
  ).exec(sql)
  assert.ok(match, `missing function: ${name}`)
  const end = sql.indexOf('\n$$;', match.index)
  assert.ok(end > match.index, `unterminated function: ${name}`)
  return sql.slice(match.index, end)
}

test('a code change ignores case and surrounding spaces', () => {
  assert.equal(history.isEquipmentCodeChanged('A115', 'F84'), true)
  assert.equal(history.isEquipmentCodeChanged('A115', ' a115 '), false)
  assert.equal(history.isEquipmentCodeChanged('A115', '   '), false)
})

test('the owner notice appears only when the prefix suggests another owner', () => {
  assert.equal(
    history.ownerSuggestedByNewCode('alazani', 'F84'),
    'third_party_f',
  )
  assert.equal(history.ownerSuggestedByNewCode('alazani', 'A200'), null)
  assert.equal(history.ownerSuggestedByNewCode('alazani', 'TK9'), 'takween')
  assert.equal(
    history.ownerSuggestedByNewCode('takween', 'X1'),
    'external_supplier',
  )
})

test('previous codes: distinct, newest first, Saudi day, current code hidden', () => {
  const entries = history.previousCodeEntries(
    [
      {
        id: '1',
        equipment_id: 'e',
        old_code: 'A115',
        new_code: 'F84',
        // 22:30 UTC is already 21/09 in Saudi time.
        changed_at: '2026-09-20T22:30:00Z',
        reason: null,
      },
      {
        id: '2',
        equipment_id: 'e',
        old_code: 'U001',
        new_code: 'A115',
        changed_at: '2026-09-01T08:00:00Z',
        reason: 'x',
      },
    ],
    'F84',
  )
  assert.deepEqual(plain(entries), [
    { code: 'A115', until: '21/09/2026' },
    { code: 'U001', until: '01/09/2026' },
  ])

  // Given back its own previous code: that code is current, not previous.
  const back = history.previousCodeEntries(
    [
      {
        id: '3',
        equipment_id: 'e',
        old_code: 'F84',
        new_code: 'A115',
        changed_at: '2026-09-25T08:00:00Z',
        reason: null,
      },
      {
        id: '1',
        equipment_id: 'e',
        old_code: 'A115',
        new_code: 'F84',
        changed_at: '2026-09-20T08:00:00Z',
        reason: null,
      },
    ],
    'a115',
  )
  assert.deepEqual(plain(back), [{ code: 'F84', until: '25/09/2026' }])
  assert.deepEqual(plain(history.previousCodeEntries([], 'A1')), [])
})

test('search helpers', () => {
  assert.equal(
    history.matchedPreviousCode({ matched_previous_code: true }),
    true,
  )
  assert.equal(history.matchedPreviousCode({ code: 'A1' }), false)
  assert.equal(history.matchedPreviousCode(null), false)
  assert.equal(history.codeMatchesTerm('F84', 'f8'), true)
  assert.equal(history.codeMatchesTerm('F84', 'A115'), false)
  assert.deepEqual(
    plain(
      history.distinctEquipmentIds([
        { equipment_id: 'a' },
        { equipment_id: 'a' },
        { equipment_id: 'b' },
      ]),
    ),
    ['a', 'b'],
  )
  assert.equal(history.previousCodeOrPart([]), null)
  assert.equal(history.previousCodeOrPart(['a', 'b']), 'id.in.(a,b)')
  assert.equal(
    history.isPreviousCodeError({ message: 'equipment_code_previously_used' }),
    true,
  )
  assert.equal(
    history.isPreviousCodeError({
      message:
        'duplicate key value violates unique constraint "idx_equipment_code"',
    }),
    false,
  )
})

test('0114: the history table is append-only for clients', () => {
  assert.match(sql, /CREATE TABLE public\.equipment_code_changes/)
  assert.match(
    sql,
    /ALTER TABLE public\.equipment_code_changes ENABLE ROW LEVEL SECURITY/,
  )
  assert.match(
    sql,
    /REVOKE ALL ON public\.equipment_code_changes FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    sql,
    /GRANT SELECT ON public\.equipment_code_changes TO authenticated;/,
  )
  assert.doesNotMatch(
    sql,
    /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*equipment_code_changes/,
  )
  assert.doesNotMatch(
    sql,
    /CREATE POLICY [^;]*ON public\.equipment_code_changes\s+FOR (INSERT|UPDATE|DELETE|ALL)/,
  )
  assert.match(sql, /char_length\(reason\) BETWEEN 1 AND 500/)
  assert.match(sql, /\(upper\(btrim\(old_code\)\)\)/)
})

test("0114: triggers record every change and guard reuse of another unit's code", () => {
  assert.match(
    sql,
    /AFTER UPDATE OF code ON public\.equipment\s+FOR EACH ROW\s+WHEN \(OLD\.code IS DISTINCT FROM NEW\.code\)/,
  )
  assert.match(sql, /BEFORE INSERT OR UPDATE OF code ON public\.equipment/)
  const guard = functionBody('guard_equipment_code_history')
  assert.match(guard, /SECURITY DEFINER/)
  assert.match(guard, /SET search_path = public, pg_temp/)
  assert.match(guard, /c\.equipment_id <> NEW\.id/)
  assert.match(
    guard,
    /'equipment_code_previously_used'\s+USING ERRCODE = '23505'/,
  )
  assert.match(
    guard,
    /pg_advisory_xact_lock\(hashtextextended\('equipment_code:'/,
  )
  const writer = functionBody('record_equipment_code_change')
  assert.match(
    writer,
    /current_setting\('app\.equipment_code_change_reason', true\)/,
  )
  assert.match(writer, /auth\.uid\(\)/)
  const rpc = functionBody('admin_change_equipment_code')
  assert.match(rpc, /SECURITY INVOKER/)
  assert.match(rpc, /public\.is_admin\(\)/)
  assert.match(rpc, /set_config\('app\.equipment_code_change_reason'/)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.admin_change_equipment_code\(uuid, text, text\) FROM PUBLIC, anon;/,
  )
})

test('0114: the three selectors keep 0102 behaviour and add previous codes', () => {
  for (const [name, roleCheck] of [
    ['search_entry_equipment', "v_role NOT IN ('admin', 'supervisor')"],
    ['search_site_exit_equipment', "v_role NOT IN ('admin', 'supervisor')"],
    [
      'search_workshop_equipment',
      "v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager')",
    ],
  ]) {
    assert.match(
      sql,
      new RegExp(
        `DROP FUNCTION IF EXISTS public\\.${name}\\(text, text, text\\);`,
      ),
    )
    const body = functionBody(name)
    assert.ok(body.includes(roleCheck), `${name}: role check`)
    assert.match(body, /SECURITY DEFINER/)
    assert.match(body, /e\.is_active\s+AND e\.status = 'active'/)
    assert.match(body, /ORDER BY e\.code\s+LIMIT 20;/)
    assert.match(body, /matched_previous_code boolean\n\)/)
    assert.match(body, /\) AS matched_previous_code/)
    assert.match(body, /c\.old_code ILIKE '%' \|\| v_term \|\| '%'/)
    assert.match(
      sql,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\(text, text, text\\) TO authenticated;`,
      ),
    )
  }
  assert.ok(
    functionBody('search_site_exit_equipment').includes(
      'AND (v_is_admin OR last_movement.supervisor_id = auth.uid())',
    ),
  )
})

test('new Arabic copy has no hamza or madda on alif', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'i18n', 'translations.ts'),
    'utf8',
  )
  const start = source.indexOf('// wave-10-code-history — start')
  const end = source.indexOf('// wave-10-code-history — end', start)
  assert.ok(start > 0 && end > start)
  assert.doesNotMatch(source.slice(start, end), /[أإآ]/)
})
