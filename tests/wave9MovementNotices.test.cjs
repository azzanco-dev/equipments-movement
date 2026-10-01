const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Guards wave 9: WhatsApp notices between the workshop and the site foremen
// (migration 0110, the UltraMsg sender, the fixed templates and the two API
// routes). The database is the authoritative place for who is notified, so a
// change that drops one of these properties must fail here.
const root = path.join(__dirname, '..')

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8')
}

const MIGRATION = '20261001100000_0110_movement_notices.sql'
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

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// SQL with `--` comments and single-quoted literals removed, so structural
// checks are not fooled by text inside them.
function code(source) {
  return source
    .split('\n')
    .map((line) => line.replace(/'(?:[^']|'')*'/g, "''").replace(/--.*$/, ''))
    .join('\n')
}

const setMobile = functionBody(sql, 'admin_set_user_mobile')
const payload = functionBody(sql, 'movement_notice_payload')
const request = functionBody(sql, 'request_workshop_arrival_notice')
const prepare = functionBody(sql, 'prepare_movement_exit_notice')
const complete = functionBody(sql, 'complete_movement_notice')

// The notices' own per-equipment key, never the sequence trigger's: inserting
// a notice key-share locks the entry row, and the 0108 functions lock that row
// before the trigger's key, which would be an ABBA deadlock.
const LOCK = (variable) =>
  new RegExp(
    `PERFORM pg_advisory_xact_lock\\(\\s+hashtextextended\\('movement_notice:' \\|\\| ${escape(variable)}::text, 0\\)\\s+\\);`,
  )

const RETURN_COLUMNS = [
  'notice_id',
  'notice_kind',
  'recipient_name',
  'recipient_mobile',
  'equipment_code',
  'equipment_type',
  'project_name_ar',
  'project_name_en',
  'company_name_ar',
  'company_name_en',
  'sender_name',
]

function returnColumns(body) {
  const start = body.indexOf('RETURNS TABLE(') + 'RETURNS TABLE('.length
  return body
    .slice(start, body.indexOf(')\nLANGUAGE', start))
    .split(',')
    .map((column) => column.trim().split(/\s+/)[0])
}

// --- Migration: structure ----------------------------------------------------

test('0110 is a new migration ordered after 0109 and is balanced', () => {
  const files = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const at0109 = files.findIndex((file) => file.includes('_0109_'))
  const at0110 = files.indexOf(MIGRATION)
  assert.ok(at0109 >= 0 && at0110 > at0109)

  const stripped = code(sql)
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

test('0110 is notifications only: the movement table and its rules are untouched', () => {
  const stripped = code(sql)
  assert.ok(!/ALTER TABLE public\.entry_exit_logs/.test(stripped))
  assert.ok(!/ON public\.entry_exit_logs\b(?!\()/.test(stripped))
  assert.ok(!/TRIGGER/.test(stripped))
  assert.ok(!/FUNCTION public\.enforce_movement_sequence/.test(stripped))
  assert.ok(!/FUNCTION public\.admin_(update|delete)_movement/.test(stripped))
  // No function writes a movement.
  assert.ok(
    !/(INSERT INTO|UPDATE|DELETE FROM) public\.entry_exit_logs/.test(stripped),
  )
  // Profile RLS is not redesigned.
  assert.ok(!/POLICY[^;]*ON public\.profiles/.test(stripped))
  assert.ok(!/(GRANT|REVOKE)[^;]*ON (TABLE )?public\.profiles/.test(stripped))
})

test('every SECURITY DEFINER function fixes its search_path', () => {
  const stripped = code(sql)
  const definers = stripped.match(
    /SECURITY DEFINER\s+SET search_path = [^\n]+/g,
  )
  assert.equal(definers?.length, 4)
  for (const clause of definers)
    assert.match(clause, /SET search_path = public, pg_temp$/)
  assert.equal((stripped.match(/SECURITY DEFINER/g) ?? []).length, 4)
})

test('client functions are revoked from PUBLIC/anon and granted to authenticated', () => {
  for (const signature of [
    'public.admin_set_user_mobile(uuid, text)',
    'public.request_workshop_arrival_notice(uuid)',
    'public.prepare_movement_exit_notice(uuid)',
    'public.complete_movement_notice(uuid, text, text, text)',
  ]) {
    assert.match(
      sql,
      new RegExp(
        `REVOKE ALL ON FUNCTION ${escape(signature)}\\s+FROM PUBLIC, anon;`,
      ),
      `missing REVOKE for ${signature}`,
    )
    assert.match(
      sql,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION ${escape(signature)}\\s+TO authenticated;`,
      ),
      `missing GRANT for ${signature}`,
    )
  }
})

test('the payload helper is internal: no definer rights, no client grant', () => {
  assert.ok(!payload.includes('SECURITY DEFINER'))
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.movement_notice_payload\(uuid\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.ok(!/GRANT[^;]*public\.movement_notice_payload/.test(sql))
  assert.deepEqual(returnColumns(payload), RETURN_COLUMNS)
})

// --- Migration: profiles.mobile_number ---------------------------------------

test('profiles.mobile_number is nullable, format-checked and admin-written', () => {
  assert.match(
    sql,
    /ALTER TABLE public\.profiles\s+ADD COLUMN IF NOT EXISTS mobile_number text;/,
  )
  assert.match(
    sql,
    /ADD CONSTRAINT profiles_mobile_number_format\s+CHECK \(mobile_number IS NULL OR mobile_number ~ '\^\\\+\?\[0-9\]\{8,15\}\$'\);/,
  )
  assert.match(
    setMobile,
    /IF auth\.uid\(\) IS NULL OR public\.is_admin\(\) IS NOT TRUE THEN\s+RAISE EXCEPTION 'admin_required'\s+USING ERRCODE = '42501'/,
  )
  assert.match(setMobile, /RAISE EXCEPTION 'invalid_mobile'/)
  assert.match(
    setMobile,
    /IF NOT FOUND THEN\s+RAISE EXCEPTION 'user_not_found'/,
  )
  assert.match(setMobile, /v_mobile !~ '\^\\\+\?\[0-9\]\{8,15\}\$'/)
  // The admin check comes before anything is read or written.
  assert.ok(
    setMobile.indexOf("RAISE EXCEPTION 'admin_required'") <
      setMobile.indexOf('UPDATE public.profiles'),
  )
  // No client UPDATE grant on the new column (0014 allows full_name only).
  assert.ok(!/GRANT UPDATE/.test(code(sql)))
})

test('mobile_number never enters the profile_names view', () => {
  assert.ok(!/\bVIEW\b/.test(code(sql)), '0110 must not create a view')
  const dir = path.join(root, 'supabase', 'migrations')
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    const pattern =
      /CREATE (?:OR REPLACE )?VIEW public\.profile_names[\s\S]*?;/g
    for (const view of source.match(pattern) ?? [])
      assert.ok(!view.includes('mobile'), `${file} exposes a mobile number`)
  }
})

// --- Migration: the log table ------------------------------------------------

test('movement_notices is read-only for clients', () => {
  assert.match(
    sql,
    /ALTER TABLE public\.movement_notices ENABLE ROW LEVEL SECURITY;/,
  )
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.movement_notices FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    sql,
    /GRANT SELECT ON TABLE public\.movement_notices TO authenticated;/,
  )
  const stripped = code(sql)
  const grants = stripped.match(/GRANT [^;]*public\.movement_notices[^;]*;/g)
  assert.equal(grants?.length, 1, 'SELECT must be the only table grant')
  assert.ok(!/TO anon/.test(stripped))
  // Exactly one policy, and it is a SELECT policy.
  const policies = stripped.match(/CREATE POLICY[^;]*;/g)
  assert.equal(policies?.length, 1)
  assert.match(
    policies[0],
    /ON public\.movement_notices\s+FOR SELECT TO authenticated USING \(/,
  )
  assert.ok(!/FOR (INSERT|UPDATE|DELETE|ALL)\b/.test(stripped))
  assert.ok(!/USING \(\s*true\s*\)/i.test(stripped))
})

test('the SELECT policy is admin, sender, recipient, and workshop roles for arrivals', () => {
  const start = sql.indexOf('CREATE POLICY "select_movement_notices"')
  const policy = sql.slice(start, sql.indexOf('\n);', start))
  assert.match(policy, /public\.is_admin\(\)/)
  assert.match(policy, /OR sender_id = auth\.uid\(\)/)
  assert.match(policy, /OR recipient_id = auth\.uid\(\)/)
  assert.match(
    policy,
    /kind = 'workshop_arrival'\s+AND public\.current_user_role\(\) IN \(\s+'workshop', 'assistant_workshop_manager', 'workshop_manager'\s+\)/,
  )
  assert.ok(!policy.includes('monitor'))
  assert.ok(!policy.includes('supervisor'))
})

test('the table keeps the agreed columns, checks and delete behaviour', () => {
  const start = sql.indexOf(
    'CREATE TABLE IF NOT EXISTS public.movement_notices',
  )
  const table = sql.slice(start, sql.indexOf('\n);', start))
  assert.match(
    table,
    /kind text NOT NULL\s+CHECK \(kind IN \('workshop_arrival', 'site_exit', 'workshop_exit'\)\)/,
  )
  assert.match(
    table,
    /status text NOT NULL DEFAULT 'pending'\s+CHECK \(status IN \('pending', 'sent', 'failed', 'no_mobile', 'not_configured'\)\)/,
  )
  // admin_delete_movement (0108) must keep working: the log survives the
  // deleted movement instead of blocking it.
  for (const column of ['entry_log_id', 'movement_id'])
    assert.match(
      table,
      new RegExp(
        `${column} uuid REFERENCES public\\.entry_exit_logs\\(id\\) ON DELETE SET NULL`,
      ),
    )
  for (const column of ['sender_id', 'recipient_id'])
    assert.match(
      table,
      new RegExp(
        `${column} uuid REFERENCES auth\\.users\\(id\\) ON DELETE SET NULL`,
      ),
    )
  assert.match(
    table,
    /error_code text\s+CHECK \(error_code IS NULL OR error_code ~ '\^\[a-z0-9_\]\{1,40\}\$'\)/,
  )
  // The log holds no phone number and no message text.
  assert.ok(!/mobile|phone|body|message text/i.test(code(table)))
})

test('automatic notices are idempotent per movement and kind', () => {
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS movement_notices_movement_kind_key\s+ON public\.movement_notices \(movement_id, kind\)\s+WHERE movement_id IS NOT NULL;/,
  )
  assert.match(
    prepare,
    /ON CONFLICT DO NOTHING\s+RETURNING id INTO v_notice_id;\s+IF v_notice_id IS NULL THEN RETURN; END IF;/,
  )
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS movement_notices_entry_kind_created_idx\s+ON public\.movement_notices \(entry_log_id, kind, created_at DESC, id DESC\);/,
  )
})

// --- Migration: notice 1 -----------------------------------------------------

test('notice 1: the role check fails closed and the recipient comes from the database', () => {
  assert.match(
    request,
    /IF auth\.uid\(\) IS NULL\s+OR v_role IS NULL\s+OR v_role NOT IN \('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager'\) THEN\s+RAISE EXCEPTION 'notice_role_required'\s+USING ERRCODE = '42501'/,
  )
  // The only argument is the equipment: no recipient, number or text.
  assert.match(
    request,
    /^CREATE OR REPLACE FUNCTION public\.request_workshop_arrival_notice\(p_equipment_id uuid\)\s+RETURNS TABLE\(/,
  )
  assert.deepEqual(returnColumns(request), RETURN_COLUMNS)
  assert.match(
    request,
    /'workshop_arrival', v_last\.equipment_id, v_last\.id, NULL,\s+auth\.uid\(\), v_last\.supervisor_id, 'pending'/,
  )
  // Authorisation happens before the lock and before anything is written.
  assert.ok(
    request.indexOf("RAISE EXCEPTION 'notice_role_required'") <
      request.search(LOCK('p_equipment_id')),
  )
})

test('notice 1: the unit must be inside a site, read under the trigger lock', () => {
  const lockAt = request.search(LOCK('p_equipment_id'))
  const readAt = request.indexOf('SELECT l.* INTO v_last')
  assert.ok(lockAt > 0 && readAt > lockAt)
  // The latest movement of the equipment, across both contexts.
  assert.match(
    request,
    /SELECT l\.\* INTO v_last\s+FROM public\.entry_exit_logs l\s+WHERE l\.equipment_id = p_equipment_id\s+ORDER BY l\.recorded_at DESC, l\.id DESC\s+LIMIT 1;/,
  )
  assert.match(
    request,
    /IF NOT FOUND\s+OR v_last\.movement_type IS DISTINCT FROM 'entry'\s+OR v_last\.movement_context IS DISTINCT FROM 'site' THEN\s+RAISE EXCEPTION 'equipment_not_on_site'/,
  )
})

test('notice 1: a repeat is refused for 10 minutes and attempts are capped whatever their status', () => {
  assert.match(
    request,
    /WHERE n\.entry_log_id = v_last\.id\s+AND n\.kind = 'workshop_arrival'\s+AND n\.created_at > now\(\) - interval '10 minutes'\s+AND \(\s+n\.status IN \('sent', 'pending'\)\s+OR \(n\.status = 'failed' AND n\.error_code = 'timeout'\)\s+\)/,
  )
  // The status is written with the sender's own token, so it must not be the
  // only limit: three attempts per entry in 10 minutes, whatever their status.
  assert.match(
    request,
    /SELECT count\(\*\)\s+FROM public\.movement_notices n\s+WHERE n\.entry_log_id = v_last\.id\s+AND n\.kind = 'workshop_arrival'\s+AND n\.created_at > now\(\) - interval '10 minutes'\s+\) >= 3 THEN\s+RAISE EXCEPTION 'notice_recently_sent'/,
  )
  // No notice function takes the sequence trigger's key.
  assert.ok(
    !/pg_advisory_xact_lock\(hashtextextended\([a-z_.]+::text, 0\)\)/.test(sql),
  )
  // The check runs under the lock and before the insert.
  assert.ok(
    request.search(LOCK('p_equipment_id')) <
      request.indexOf("RAISE EXCEPTION 'notice_recently_sent'"),
  )
  assert.ok(
    request.indexOf("RAISE EXCEPTION 'notice_recently_sent'") <
      request.indexOf('INSERT INTO public.movement_notices'),
  )
})

// --- Migration: notices 2 and 3 ----------------------------------------------

test('notices 2/3: only the recorder or an admin, fail closed', () => {
  assert.match(
    prepare,
    /v_allowed := FOUND\s+AND auth\.uid\(\) IS NOT NULL\s+AND v_role IS NOT NULL\s+AND \(v_role = 'admin' OR v_log\.supervisor_id = auth\.uid\(\)\);\s+IF v_allowed IS NOT TRUE THEN\s+RAISE EXCEPTION 'movement_not_accessible'\s+USING ERRCODE = '42501'/,
  )
  assert.match(
    prepare,
    /IF v_log\.movement_type IS DISTINCT FROM 'exit' THEN\s+RAISE EXCEPTION 'movement_not_exit'/,
  )
  // "Nothing to send" is never an error: those are the only two raises.
  assert.equal((prepare.match(/RAISE EXCEPTION/g) ?? []).length, 2)
  assert.match(
    prepare,
    /^CREATE OR REPLACE FUNCTION public\.prepare_movement_exit_notice\(p_movement_id uuid\)\s+RETURNS TABLE\(/,
  )
  assert.deepEqual(returnColumns(prepare), RETURN_COLUMNS)
})

test('notices 2/3: the chain is walked in the global (recorded_at, id) order under the lock', () => {
  const lockAt = prepare.search(LOCK('v_log.equipment_id'))
  assert.ok(lockAt > prepare.indexOf("RAISE EXCEPTION 'movement_not_exit'"))
  // Only a freshly saved exit is prepared, so old exits cannot be replayed.
  assert.match(
    prepare,
    /IF v_log\.created_at < now\(\) - interval '10 minutes' THEN RETURN; END IF;/,
  )
  assert.ok(lockAt < prepare.indexOf('SELECT l.* INTO v_closed_entry'))
  // The entry the exit closed: exactly the trigger's v_last_entry probe.
  assert.match(
    prepare,
    /SELECT l\.\* INTO v_closed_entry\s+FROM public\.entry_exit_logs l\s+WHERE l\.equipment_id = v_log\.equipment_id\s+AND l\.movement_type = 'entry'\s+AND \(l\.recorded_at, l\.id\) < \(v_log\.recorded_at, v_log\.id\)\s+ORDER BY l\.recorded_at DESC, l\.id DESC\s+LIMIT 1;/,
  )
  // Every probe of the chain orders by id after recorded_at.
  const probes = prepare.match(/ORDER BY l\.recorded_at DESC[^\n]*/g)
  assert.equal(probes?.length, 3)
  for (const probe of probes)
    assert.equal(probe, 'ORDER BY l.recorded_at DESC, l.id DESC')
  // No probe is restricted to one context: the sequence is global.
  assert.ok(!/AND l\.movement_context =/.test(prepare))
})

test('notice 2: a site exit notifies the latest officer who reported the entry', () => {
  const branch = prepare.slice(
    prepare.indexOf("IF v_log.movement_context = 'site' THEN"),
    prepare.indexOf('ELSE\n    -- Notice 3'),
  )
  assert.ok(branch.length > 0)
  assert.match(
    branch,
    /IF v_closed_entry\.movement_context IS DISTINCT FROM 'site' THEN RETURN; END IF;/,
  )
  // Any attempt counts: there is no status predicate.
  assert.match(
    branch,
    /SELECT n\.sender_id INTO v_recipient\s+FROM public\.movement_notices n\s+WHERE n\.entry_log_id = v_closed_entry\.id\s+AND n\.kind = 'workshop_arrival'\s+ORDER BY n\.created_at DESC, n\.id DESC\s+LIMIT 1;\s+IF NOT FOUND OR v_recipient IS NULL THEN RETURN; END IF;/,
  )
  assert.ok(!branch.includes('n.status'))
  assert.match(branch, /v_kind := 'site_exit';/)
})

test('notice 3: a workshop exit notifies the foreman the unit left from', () => {
  const branch = prepare.slice(
    prepare.indexOf('ELSE\n    -- Notice 3'),
    prepare.indexOf('-- One automatic notice per exit and kind'),
  )
  assert.ok(branch.length > 0)
  assert.match(
    branch,
    /IF v_closed_entry\.movement_context IS DISTINCT FROM 'workshop' THEN RETURN; END IF;/,
  )
  // The movement immediately before the workshop entry, whatever its type.
  assert.match(
    branch,
    /SELECT l\.\* INTO v_previous\s+FROM public\.entry_exit_logs l\s+WHERE l\.equipment_id = v_log\.equipment_id\s+AND \(l\.recorded_at, l\.id\) < \(v_closed_entry\.recorded_at, v_closed_entry\.id\)\s+ORDER BY/,
  )
  assert.match(
    branch,
    /IF NOT FOUND\s+OR v_previous\.movement_type IS DISTINCT FROM 'exit'\s+OR v_previous\.movement_context IS DISTINCT FROM 'site' THEN\s+RETURN;/,
  )
  assert.match(
    branch,
    /AND l\.movement_type = 'entry'\s+AND \(l\.recorded_at, l\.id\) < \(v_previous\.recorded_at, v_previous\.id\)/,
  )
  assert.match(
    branch,
    /IF NOT FOUND OR v_site_entry\.movement_context IS DISTINCT FROM 'site' THEN\s+RETURN;/,
  )
  assert.match(branch, /v_recipient := v_site_entry\.supervisor_id;/)
  // Independent of notice 1: the branch never reads the notices table.
  assert.ok(!branch.includes('movement_notices'))
})

// --- Migration: completion ---------------------------------------------------

test('a notice is completed once, by its sender, with a safe code', () => {
  assert.match(
    complete,
    /IF p_status IS NULL\s+OR p_status NOT IN \('sent', 'failed', 'no_mobile', 'not_configured'\) THEN\s+RAISE EXCEPTION 'invalid_notice_status'/,
  )
  assert.match(
    complete,
    /WHERE n\.id = p_notice_id\s+AND n\.sender_id = auth\.uid\(\)\s+AND n\.status = 'pending';\s+IF NOT FOUND THEN\s+RAISE EXCEPTION 'notice_not_pending'/,
  )
  assert.match(complete, /completed_at = now\(\)/)
  assert.match(
    complete,
    /IF v_error_code !~ '\^\[a-z0-9_\]\{1,40\}\$' THEN\s+v_error_code := 'unknown';/,
  )
  assert.match(complete, /IF auth\.uid\(\) IS NULL THEN\s+RAISE EXCEPTION/)
})

// --- Pure helpers ------------------------------------------------------------

// Loads a src/lib module (and its `@/lib/...` imports) into one sandbox, so a
// test can supply `fetch`, `process.env` and `console` to the server modules.
function createLoader(globals = {}) {
  const cache = new Map()
  const sandbox = vm.createContext({ ...globals })
  function load(name) {
    if (cache.has(name)) return cache.get(name)
    const file = path.join(root, 'src', 'lib', `${name}.ts`)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText
    const exports = {}
    cache.set(name, exports)
    const wrapper = vm.runInContext(
      `(function (exports, require) {${output}\n})`,
      sandbox,
      { filename: file },
    )
    wrapper(exports, (requested) => {
      const match = /^@\/lib\/(.+)$/.exec(requested)
      if (match) return load(match[1])
      throw new Error(`Unexpected module: ${requested}`)
    })
    return exports
  }
  return load
}

test('the number normaliser produces the international form or null', () => {
  const { normalizeWhatsAppNumber, waMeUrl } = createLoader()('whatsappNumber')
  for (const [input, expected] of [
    ['0512345678', '+966512345678'],
    ['512345678', '+966512345678'],
    ['966512345678', '+966512345678'],
    ['+966512345678', '+966512345678'],
    ['00966512345678', '+966512345678'],
    ['9660512345678', '+966512345678'],
    ['+966 0512345678', '+966512345678'],
    [' 051-234 5678 ', '+966512345678'],
    ['+966 51 234 5678', '+966512345678'],
    ['٠٥١٢٣٤٥٦٧٨', '+966512345678'],
    ['+14155552671', '+14155552671'],
    ['201001234567', '+201001234567'],
    ['0020 100 123 4567', '+201001234567'],
  ])
    assert.equal(normalizeWhatsAppNumber(input), expected, input)
  for (const input of [
    null,
    undefined,
    '',
    '   ',
    '12345',
    '+1234567',
    '1234567890123456',
    '0112345678',
    'abc0512345678',
    '+96651234567x',
    '05123456789',
  ])
    assert.equal(normalizeWhatsAppNumber(input), null, String(input))

  assert.equal(
    waMeUrl('0512345678', 'مرحبا A&B #1'),
    `https://wa.me/966512345678?text=${encodeURIComponent('مرحبا A&B #1')}`,
  )
  assert.equal(waMeUrl('12', 'x'), null)
  assert.equal(waMeUrl(null, 'x'), null)
})

test('the three templates are fixed, short, bilingual and follow the Arabic rule', () => {
  const { MOVEMENT_NOTICE_KINDS, movementNoticeMessage, isMovementNoticeKind } =
    createLoader()('movementNoticeMessages')
  assert.deepEqual(
    [...MOVEMENT_NOTICE_KINDS],
    ['workshop_arrival', 'site_exit', 'workshop_exit'],
  )
  assert.equal(isMovementNoticeKind('site_exit'), true)
  assert.equal(isMovementNoticeKind('other'), false)
  assert.equal(isMovementNoticeKind(null), false)

  const facts = {
    equipmentCode: 'TK-104',
    equipmentType: 'Excavator',
    projectNameAr: 'PROJECT-AR',
    projectNameEn: 'PROJECT-EN',
    companyNameAr: 'COMPANY-AR',
    companyNameEn: 'COMPANY-EN',
    senderName: 'OFFICER',
  }
  for (const kind of MOVEMENT_NOTICE_KINDS) {
    const message = movementNoticeMessage(kind, facts)
    const sections = message.split('\n\n')
    // Short lines with a blank line between the sections (owner review).
    assert.ok(sections.length >= 2, `${kind}: spaced sections`)
    // The unit once, first.
    assert.equal(sections[0].split('\n')[0], '🚜 TK-104 (Excavator)', kind)
    assert.equal((message.match(/TK-104/g) ?? []).length, 1, kind)
    // The request: an Arabic line with one simple emoji, its English line under it.
    const [arabic, english] = sections[1].split('\n')
    assert.match(arabic, /^(✅|🔧) [؀-ۿ]/, `${kind}: Arabic request`)
    assert.match(english, /^[A-Z][^؀-ۿ]+\.$/, `${kind}: English request`)
    // New Arabic copy uses the plain alif: no hamza or madda forms.
    assert.ok(!/[أإآ]/.test(message), kind)
    assert.ok(!/https?:|wa\.me/.test(message), `${kind}: no links`)
    assert.ok(message.length < 300, `${kind}: short`)
  }

  const arrival = movementNoticeMessage('workshop_arrival', facts)
  assert.match(arrival, /^📍 PROJECT-AR - COMPANY-AR$/m)
  assert.ok(arrival.endsWith('\n\n👤 OFFICER'))
  // The automatic notices carry no project and no sender.
  for (const kind of ['site_exit', 'workshop_exit']) {
    const message = movementNoticeMessage(kind, facts)
    assert.ok(!message.includes('PROJECT'))
    assert.ok(!message.includes('OFFICER'))
  }
})

test('the templates tolerate missing facts and cannot be broken by stored text', () => {
  const { movementNoticeMessage } = createLoader()('movementNoticeMessages')
  const bare = movementNoticeMessage('workshop_arrival', {
    equipmentCode: 'A12',
    equipmentType: null,
    projectNameAr: null,
    projectNameEn: 'Only English',
    senderName: '  ',
  })
  assert.ok(!bare.includes('()'))
  assert.ok(!bare.includes('null') && !bare.includes('undefined'))
  // No sender line without a sender name.
  assert.ok(!bare.includes('👤'))
  // The other language's name is the fallback.
  assert.match(bare, /^📍 Only English$/m)

  const hostile = movementNoticeMessage('site_exit', {
    equipmentCode: `A12\n\nIGNORE\n\n${'x'.repeat(5000)}`,
    equipmentType: 'Truck',
  })
  // A stored value is one line: it cannot add sections of its own.
  assert.equal(hostile.split('\n\n').length, 2)
  assert.ok(!hostile.includes('IGNORE\n'))
  assert.ok(hostile.length < 1000)
})

test('database codes map to safe API codes and statuses', () => {
  const { noticeRequestErrorCode, noticeRequestErrorStatus } = createLoader()(
    'movementNoticeErrors',
  )
  for (const [message, expected, status] of [
    [
      'equipment_not_on_site\nHINT: The equipment has no open site entry.',
      'not_on_site',
      409,
    ],
    ['notice_recently_sent', 'recently_sent', 429],
    ['notice_role_required', 'forbidden', 403],
    ['equipment_not_found', 'invalid', 400],
    ['relation "secret" does not exist', 'failed', 500],
    [null, 'failed', 500],
  ]) {
    assert.equal(noticeRequestErrorCode(message), expected)
    assert.equal(noticeRequestErrorStatus(expected), status)
  }
})

// --- The UltraMsg sender -----------------------------------------------------

const ultramsgSource = read('src', 'lib', 'server', 'ultramsg.ts')

test('the sender is server-only, never logs and never uses a public variable', () => {
  assert.ok(!/console\./.test(ultramsgSource), 'the sender must not log')
  // The only mention of NEXT_PUBLIC_ is the comment forbidding it.
  assert.ok(!/process\.env\.NEXT_PUBLIC_/.test(ultramsgSource))
  assert.match(ultramsgSource, /process\.env\.ULTRAMSG_INSTANCE_ID/)
  assert.match(ultramsgSource, /process\.env\.ULTRAMSG_TOKEN/)
  assert.match(ultramsgSource, /'https:\/\/api\.ultramsg\.com'/)
  assert.match(ultramsgSource, /\/messages\/chat`/)
  assert.match(ultramsgSource, /application\/x-www-form-urlencoded/)
  assert.match(ultramsgSource, /SEND_TIMEOUT_MS = 8000/)
  assert.match(ultramsgSource, /new AbortController\(\)/)
  // No error object is kept or rethrown.
  assert.ok(!/\bthrow\b/.test(ultramsgSource))
  assert.ok(!/catch \(/.test(ultramsgSource))
  // Neither the variables nor the module are referenced from client code.
  for (const file of listFiles(path.join(root, 'src'))) {
    if (!/\.(ts|tsx)$/.test(file)) continue
    const relative = path.relative(root, file).replace(/\\/g, '/')
    if (relative.startsWith('src/lib/server/')) continue
    const source = fs.readFileSync(file, 'utf8')
    assert.ok(!source.includes('ULTRAMSG_'), `${relative} reads the gateway`)
    assert.ok(
      !source.includes('@/lib/server/'),
      `${relative} imports a server-only module`,
    )
  }
})

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? listFiles(full) : [full]
  })
}

const TOKEN = 'unit-test-token-value'

// A sandbox with a scripted `fetch`. Nothing here reaches the network.
function gateway({ env, respond, abortImmediately = false } = {}) {
  const calls = []
  const logs = []
  const record = (...args) => logs.push(JSON.stringify(args))
  const load = createLoader({
    process: {
      env: env ?? { ULTRAMSG_INSTANCE_ID: 'instance1', ULTRAMSG_TOKEN: TOKEN },
    },
    console: { error: record, warn: record, log: record, info: record },
    URLSearchParams,
    AbortController,
    clearTimeout,
    setTimeout: abortImmediately
      ? (callback) => {
          callback()
          return 0
        }
      : setTimeout,
    fetch: async (url, init) => {
      calls.push({ url, init })
      if (init.signal.aborted) throw new Error(`aborted ${url} ${init.body}`)
      return respond(url, init)
    },
  })
  return { load, calls, logs }
}

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body }
}

test('the sender posts the documented request and reports success', async () => {
  const { load, calls, logs } = gateway({
    respond: () => jsonResponse({ sent: 'true', message: 'ok', id: 9021 }),
  })
  const { sendWhatsAppText, isWhatsAppGatewayConfigured } =
    load('server/ultramsg')
  assert.equal(isWhatsAppGatewayConfigured(), true)
  const result = await sendWhatsAppText('+966512345678', 'hello')
  assert.deepEqual({ ...result }, { status: 'sent', providerMessageId: '9021' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.ultramsg.com/instance1/messages/chat')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(
    calls[0].init.headers['Content-Type'],
    'application/x-www-form-urlencoded',
  )
  const form = new URLSearchParams(calls[0].init.body)
  assert.deepEqual(
    [...form.keys()].sort(),
    ['body', 'to', 'token'],
    'exactly the three documented fields',
  )
  assert.equal(form.get('to'), '+966512345678')
  assert.equal(form.get('body'), 'hello')
  assert.equal(form.get('token'), TOKEN)
  // The token travels in the body, never in the URL.
  assert.ok(!calls[0].url.includes(TOKEN))
  assert.deepEqual(logs, [])
})

test('the sender never throws and maps every failure to a short code', async () => {
  const cases = [
    [
      { respond: () => jsonResponse({ error: 'Wrong token' }) },
      'provider_error',
    ],
    [{ respond: () => jsonResponse({ sent: 'false' }) }, 'provider_error'],
    [
      { respond: () => jsonResponse({ sent: true, error: 'x' }) },
      'provider_error',
    ],
    [{ respond: () => jsonResponse('nope') }, 'provider_error'],
    [{ respond: () => jsonResponse({ sent: 'true' }, false) }, 'http_error'],
    [
      {
        respond: () => ({
          ok: true,
          json: async () => {
            throw new Error('not json')
          },
        }),
      },
      'provider_error',
    ],
    [
      {
        respond: () => {
          throw new Error(`connect failed token=${TOKEN}`)
        },
      },
      'network_error',
    ],
    [
      { respond: () => jsonResponse({ sent: 'true' }), abortImmediately: true },
      'timeout',
    ],
  ]
  for (const [options, expected] of cases) {
    const { load, logs } = gateway(options)
    const result = await load('server/ultramsg').sendWhatsAppText(
      '+966512345678',
      'hello',
    )
    assert.deepEqual({ ...result }, { status: 'failed', errorCode: expected })
    assert.deepEqual(logs, [])
  }

  // `sent: true` without a usable id is still a success.
  const plain = gateway({ respond: () => jsonResponse({ sent: true }) })
  assert.deepEqual(
    {
      ...(await plain
        .load('server/ultramsg')
        .sendWhatsAppText('+966512345678', 'x')),
    },
    { status: 'sent' },
  )
})

test('the sender does nothing when it is not configured or the number is unusable', async () => {
  for (const env of [
    {},
    { ULTRAMSG_INSTANCE_ID: 'instance1' },
    { ULTRAMSG_TOKEN: TOKEN },
    { ULTRAMSG_INSTANCE_ID: '  ', ULTRAMSG_TOKEN: TOKEN },
    { ULTRAMSG_INSTANCE_ID: 'a/../b', ULTRAMSG_TOKEN: TOKEN },
  ]) {
    const { load, calls } = gateway({ env, respond: () => jsonResponse({}) })
    const module = load('server/ultramsg')
    assert.equal(module.isWhatsAppGatewayConfigured(), false)
    assert.deepEqual(
      { ...(await module.sendWhatsAppText('+966512345678', 'x')) },
      { status: 'not_configured' },
    )
    assert.equal(calls.length, 0)
  }
  const { load, calls } = gateway({ respond: () => jsonResponse({}) })
  assert.deepEqual(
    { ...(await load('server/ultramsg').sendWhatsAppText('0512345678', 'x')) },
    { status: 'failed', errorCode: 'invalid_number' },
  )
  assert.equal(calls.length, 0)
})

// --- Orchestration -----------------------------------------------------------

function fakeSupabase(results = {}) {
  const rpcCalls = []
  return {
    rpcCalls,
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      const result = results[name]
      if (result instanceof Error) throw result
      return result ?? { data: null, error: null }
    },
  }
}

const MOBILE = '0512345678'
const noticeRow = (overrides = {}) => ({
  notice_id: 'n-1',
  notice_kind: 'workshop_arrival',
  recipient_name: 'Foreman',
  recipient_mobile: MOBILE,
  equipment_code: 'TK-104',
  equipment_type: 'Excavator',
  project_name_ar: 'PROJECT-AR',
  project_name_en: 'PROJECT-EN',
  company_name_ar: 'COMPANY-AR',
  company_name_en: 'COMPANY-EN',
  sender_name: 'OFFICER',
  ...overrides,
})

function assertNothingSensitive(logs) {
  for (const line of logs) {
    assert.ok(!line.includes(TOKEN), 'a log line carries the token')
    assert.ok(!line.includes('512345678'), 'a log line carries a number')
    assert.ok(!line.includes('TK-104'), 'a log line carries message text')
    assert.ok(!line.includes('api.ultramsg.com'), 'a log line carries the URL')
  }
}

test('a delivered notice is completed as sent with no fallback link', async () => {
  const { load, calls, logs } = gateway({
    respond: () => jsonResponse({ sent: 'true', id: 'abc-1' }),
  })
  const { deliverMovementNotice, parseMovementNoticeRow } = load(
    'server/movementNotices',
  )
  const supabase = fakeSupabase()
  const delivery = await deliverMovementNotice(
    supabase,
    parseMovementNoticeRow([noticeRow()]),
  )
  assert.deepEqual(
    { ...delivery },
    { status: 'sent', recipientName: 'Foreman', fallbackUrl: null },
  )
  assert.equal(
    new URLSearchParams(calls[0].init.body).get('to'),
    '+966512345678',
  )
  assert.equal(supabase.rpcCalls.length, 1)
  assert.equal(supabase.rpcCalls[0].name, 'complete_movement_notice')
  assert.deepEqual(
    { ...supabase.rpcCalls[0].args },
    {
      p_notice_id: 'n-1',
      p_status: 'sent',
      p_provider_message_id: 'abc-1',
      p_error_code: null,
    },
  )
  assert.deepEqual(logs, [])
})

test('a failed or unconfigured send is logged safely and offers the wa.me fallback', async () => {
  for (const [options, status, errorCode] of [
    [
      { respond: () => jsonResponse({ error: `bad ${TOKEN}` }) },
      'failed',
      'provider_error',
    ],
    [{ env: {}, respond: () => jsonResponse({}) }, 'not_configured', null],
  ]) {
    const { load, logs } = gateway(options)
    const { deliverMovementNotice, parseMovementNoticeRow } = load(
      'server/movementNotices',
    )
    const supabase = fakeSupabase()
    const delivery = await deliverMovementNotice(
      supabase,
      parseMovementNoticeRow([noticeRow()]),
    )
    assert.equal(delivery.status, status)
    assert.equal(delivery.recipientName, 'Foreman')
    assert.match(delivery.fallbackUrl, /^https:\/\/wa\.me\/966512345678\?text=/)
    // The fallback carries exactly the text the gateway would have sent.
    const { movementNoticeMessage } = load('movementNoticeMessages')
    assert.equal(
      decodeURIComponent(delivery.fallbackUrl.split('?text=')[1]),
      movementNoticeMessage('workshop_arrival', {
        equipmentCode: 'TK-104',
        equipmentType: 'Excavator',
        projectNameAr: 'PROJECT-AR',
        projectNameEn: 'PROJECT-EN',
        companyNameAr: 'COMPANY-AR',
        companyNameEn: 'COMPANY-EN',
        senderName: 'OFFICER',
      }),
    )
    assert.deepEqual(
      { ...supabase.rpcCalls[0].args },
      {
        p_notice_id: 'n-1',
        p_status: status,
        p_provider_message_id: null,
        p_error_code: errorCode,
      },
    )
    assert.equal(logs.length, 1)
    assert.ok(logs[0].includes('n-1'))
    assertNothingSensitive(logs)
  }
})

test('a recipient without a usable number is completed as no_mobile without sending', async () => {
  for (const mobile of [null, '', '123']) {
    const { load, calls } = gateway({ respond: () => jsonResponse({}) })
    const { deliverMovementNotice, parseMovementNoticeRow } = load(
      'server/movementNotices',
    )
    const supabase = fakeSupabase()
    const delivery = await deliverMovementNotice(
      supabase,
      parseMovementNoticeRow([noticeRow({ recipient_mobile: mobile })]),
    )
    assert.deepEqual(
      { ...delivery },
      { status: 'no_mobile', recipientName: 'Foreman', fallbackUrl: null },
    )
    assert.equal(calls.length, 0)
    assert.equal(supabase.rpcCalls[0].args.p_status, 'no_mobile')
  }
})

test('the automatic notice never throws, whatever fails', async () => {
  // Nothing to send: zero rows.
  {
    const { load, calls, logs } = gateway({ respond: () => jsonResponse({}) })
    const supabase = fakeSupabase({
      prepare_movement_exit_notice: { data: [], error: null },
    })
    await load('server/movementNotices').sendMovementExitNotice(supabase, 'm-1')
    assert.equal(supabase.rpcCalls.length, 1)
    assert.deepEqual({ ...supabase.rpcCalls[0].args }, { p_movement_id: 'm-1' })
    assert.equal(calls.length, 0)
    assert.deepEqual(logs, [])
  }
  // The database refuses, the client throws, the completion throws.
  for (const results of [
    {
      prepare_movement_exit_notice: {
        data: null,
        error: { message: `secret ${TOKEN}` },
      },
    },
    { prepare_movement_exit_notice: new Error(`boom ${TOKEN}`) },
    {
      prepare_movement_exit_notice: {
        data: [noticeRow({ notice_kind: 'site_exit' })],
        error: null,
      },
      complete_movement_notice: new Error(`boom ${TOKEN}`),
    },
    {
      prepare_movement_exit_notice: {
        data: [noticeRow({ notice_kind: 'not_a_kind' })],
        error: null,
      },
    },
  ]) {
    const { load, logs } = gateway({
      respond: () => {
        throw new Error(`down ${TOKEN}`)
      },
    })
    const supabase = fakeSupabase(results)
    await assert.doesNotReject(
      load('server/movementNotices').sendMovementExitNotice(supabase, 'm-1'),
    )
    assertNothingSensitive(logs)
  }
})

test('the orchestration never logs a raw error, a number or a text', () => {
  const source = read('src', 'lib', 'server', 'movementNotices.ts')
  const logged = source.match(/console\.\w+\([^)]*\)/g) ?? []
  assert.ok(logged.length > 0)
  for (const call of logged) {
    assert.match(
      call,
      /^console\.error\('[A-Za-z ]+', \{\s+(noticeId|movementId)/,
    )
    assert.ok(
      !/error\b(?!')|message|mobile|\bto\b/i.test(
        call.replace(/^console\.error/, ''),
      ),
    )
  }
  assert.ok(!/catch \(/.test(source), 'no error object is kept')
})

// --- The API routes ----------------------------------------------------------

test('the movement route schedules the exit notice with after(), without awaiting it', () => {
  const route = read('app', 'api', 'movements', 'route.ts')
  assert.match(route, /import \{ after, NextResponse \} from 'next\/server'/)
  assert.match(
    route,
    /import \{ sendMovementExitNotice \} from '@\/lib\/server\/movementNotices'/,
  )
  assert.match(
    route,
    /if \(movementType === 'exit'\) \{\s+const savedMovementId: string = insertedLog\.id\s+try \{\s+after\(\(\) => sendMovementExitNotice\(supabase, savedMovementId\)\)\s+\} catch \{/,
  )
  assert.ok(!/await sendMovementExitNotice/.test(route))
  assert.ok(!/await after\(/.test(route))
  // Scheduled only once the row exists, and before any photo work that may
  // return early.
  const insertFailedAt = route.indexOf("console.error('Movement insert failed'")
  const scheduledAt = route.indexOf('after(() => sendMovementExitNotice')
  const photosAt = route.indexOf('if (pendingPaths.length) {')
  assert.ok(insertFailedAt > 0 && scheduledAt > insertFailedAt)
  assert.ok(photosAt > scheduledAt)
  assert.equal((route.match(/sendMovementExitNotice\(/g) ?? []).length, 1)
  // Next.js really exports after().
  assert.match(
    read('node_modules', 'next', 'server.d.ts'),
    /export \{ after \} from 'next\/dist\/server\/after'/,
  )
})

test('the workshop-arrival route authenticates, sends no recipient and hides raw errors', () => {
  const route = read(
    'app',
    'api',
    'notifications',
    'workshop-arrival',
    'route.ts',
  )
  assert.match(
    route,
    /if \(!authorization\?\.startsWith\('Bearer '\)\) \{\s+return NextResponse\.json\(\{ error: 'unauthorized' \}, \{ status: 401 \}\)/,
  )
  assert.match(route, /supabase\.auth\.getClaims\(accessToken\)/)
  assert.match(route, /Authorization: `Bearer \$\{accessToken\}`/)
  assert.ok(!/SERVICE_ROLE/i.test(route))
  // The only thing forwarded to the database is the equipment id.
  assert.match(
    route,
    /supabase\.rpc\(\s+'request_workshop_arrival_notice',\s+\{ p_equipment_id: equipmentId \},\s+\)/,
  )
  assert.equal((route.match(/\.rpc\(/g) ?? []).length, 1)
  // A raw PostgreSQL message is only ever mapped, never returned or logged.
  assert.equal((route.match(/error\.message/g) ?? []).length, 1)
  assert.match(route, /noticeRequestErrorCode\(error\.message\)/)
  assert.ok(!/console\.error\([^)]*\berror\b[^')]*\)/.test(route))
  assert.match(route, /deliverMovementNotice\(supabase, row\)/)
  assert.match(route, /export const runtime = 'nodejs'/)
})

test('.env.example lists the gateway variables as placeholders only', () => {
  const example = read('.env.example')
  assert.match(example, /^ULTRAMSG_INSTANCE_ID=instance00000\r?$/m)
  assert.match(example, /^ULTRAMSG_TOKEN=your-ultramsg-token\r?$/m)
  assert.ok(!/NEXT_PUBLIC_ULTRAMSG/.test(example))
})
