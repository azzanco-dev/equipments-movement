const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Guards the UI half of wave 9: the "notify the foreman" panel of the workshop
// ENTRY form and the admin-maintained mobile number on the user page. The
// database and the API route (migration 0110) stay authoritative; these tests
// keep the client honest about what it sends, shows and never shows.
const root = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

function load(...parts) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(read(...parts), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports },
  )
  return exports
}

const notice = load('src', 'lib', 'workshopArrivalNotice.ts')
const mobile = load('src', 'lib', 'userMobile.ts')
const plain = (value) => JSON.parse(JSON.stringify(value))

test('a 200 answer maps to its status, name and a wa.me link only', () => {
  assert.deepEqual(
    plain(
      notice.parseArrivalNoticeResponse(200, {
        status: 'sent',
        recipientName: ' Ali ',
        fallbackUrl: 'https://wa.me/966500000000?text=x',
      }),
    ),
    // A sent message needs no manual fallback.
    { ok: true, status: 'sent', recipientName: 'Ali', fallbackUrl: null },
  )
  assert.deepEqual(
    plain(
      notice.parseArrivalNoticeResponse(200, {
        status: 'failed',
        recipientName: 'Ali',
        fallbackUrl: 'https://wa.me/966500000000?text=x',
      }),
    ),
    {
      ok: true,
      status: 'failed',
      recipientName: 'Ali',
      fallbackUrl: 'https://wa.me/966500000000?text=x',
    },
  )
  for (const url of [
    'javascript:alert(1)',
    'https://evil.example/wa.me/',
    'http://wa.me/966500000000',
    42,
    null,
  ])
    assert.equal(
      notice.parseArrivalNoticeResponse(200, {
        status: 'not_configured',
        recipientName: 'Ali',
        fallbackUrl: url,
      }).fallbackUrl,
      null,
      String(url),
    )
  assert.deepEqual(
    plain(notice.parseArrivalNoticeResponse(200, { status: 'no_mobile' })),
    { ok: true, status: 'no_mobile', recipientName: '', fallbackUrl: null },
  )
  // An unknown status is a failure, never a silent success.
  assert.deepEqual(
    plain(notice.parseArrivalNoticeResponse(200, { status: 'queued' })),
    { ok: false, error: 'failed' },
  )
})

test('an error answer maps to a safe code and never to raw text', () => {
  const cases = [
    [409, { error: 'not_on_site' }, 'not_on_site'],
    [429, { error: 'recently_sent' }, 'recently_sent'],
    [403, { error: 'forbidden' }, 'forbidden'],
    [400, { error: 'invalid' }, 'invalid'],
    [401, { error: 'unauthorized' }, 'unauthorized'],
    [500, { error: 'failed' }, 'failed'],
    // No usable body: the HTTP status decides.
    [409, null, 'not_on_site'],
    [429, 'Too many', 'recently_sent'],
    [401, {}, 'unauthorized'],
    [403, {}, 'forbidden'],
    [400, {}, 'invalid'],
    [502, { error: 'ERROR: relation "x" does not exist' }, 'failed'],
    [500, { error: 'select * from profiles' }, 'failed'],
  ]
  for (const [status, body, expected] of cases)
    assert.deepEqual(
      plain(notice.parseArrivalNoticeResponse(status, body)),
      { ok: false, error: expected },
      `${status} ${JSON.stringify(body)}`,
    )
})

function fakeAuth({ token = 'token-1', refreshed = 'token-2' } = {}) {
  const calls = { refresh: 0 }
  return {
    calls,
    auth: {
      getSession: async () => ({
        data: { session: token ? { access_token: token } : null },
      }),
      refreshSession: async () => {
        calls.refresh += 1
        return refreshed
          ? { data: { session: { access_token: refreshed } }, error: null }
          : { data: { session: null }, error: { message: 'expired' } }
      },
    },
  }
}

test('the request carries the bearer token and only the equipment id', async () => {
  const client = fakeAuth()
  const seen = []
  const outcome = await notice.requestWorkshopArrivalNotice(
    client,
    'equipment-1',
    async (url, init) => {
      seen.push({ url, init })
      return {
        status: 200,
        json: async () => ({ status: 'sent', recipientName: 'Ali' }),
      }
    },
  )
  assert.equal(outcome.ok, true)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, '/api/notifications/workshop-arrival')
  assert.equal(seen[0].init.method, 'POST')
  assert.equal(seen[0].init.headers.Authorization, 'Bearer token-1')
  // No recipient, phone number or message text ever leaves the client.
  assert.equal(seen[0].init.body, '{"equipmentId":"equipment-1"}')
  assert.equal(client.calls.refresh, 0)
})

test('a 401 refreshes the session once and retries', async () => {
  const client = fakeAuth()
  const tokens = []
  const outcome = await notice.requestWorkshopArrivalNotice(
    client,
    'equipment-1',
    async (_url, init) => {
      tokens.push(init.headers.Authorization)
      return tokens.length === 1
        ? { status: 401, json: async () => ({ error: 'unauthorized' }) }
        : { status: 200, json: async () => ({ status: 'no_mobile' }) }
    },
  )
  assert.deepEqual(tokens, ['Bearer token-1', 'Bearer token-2'])
  assert.equal(client.calls.refresh, 1)
  assert.equal(outcome.status, 'no_mobile')

  const expired = await notice.requestWorkshopArrivalNotice(
    fakeAuth({ refreshed: null }),
    'equipment-1',
    async () => ({ status: 401, json: async () => ({}) }),
  )
  assert.deepEqual(plain(expired), { ok: false, error: 'unauthorized' })
})

test('no session, a network failure and a broken body never throw', async () => {
  let called = false
  const noSession = await notice.requestWorkshopArrivalNotice(
    fakeAuth({ token: null }),
    'equipment-1',
    async () => {
      called = true
      return { status: 200, json: async () => ({}) }
    },
  )
  assert.deepEqual(plain(noSession), { ok: false, error: 'unauthorized' })
  assert.equal(called, false)

  const offline = await notice.requestWorkshopArrivalNotice(
    fakeAuth(),
    'equipment-1',
    async () => {
      throw new Error('offline')
    },
  )
  assert.deepEqual(plain(offline), { ok: false, error: 'network' })

  const html = await notice.requestWorkshopArrivalNotice(
    fakeAuth(),
    'equipment-1',
    async () => ({
      status: 500,
      json: async () => {
        throw new Error('not json')
      },
    }),
  )
  assert.deepEqual(plain(html), { ok: false, error: 'failed' })
})

// A tiny PostgREST stand-in: records each query and answers per table.
function fakeTables(answers) {
  const queries = []
  return {
    queries,
    from(table) {
      const query = { table, select: null, filters: [], order: [], limit: null }
      queries.push(query)
      const builder = {
        select(columns) {
          query.select = columns
          return builder
        },
        eq(column, value) {
          query.filters.push([column, value])
          return builder
        },
        order(column, options) {
          query.order.push([column, options.ascending])
          return builder
        },
        limit(count) {
          query.limit = count
          return builder
        },
        then(resolve, reject) {
          return Promise.resolve(answers[table]).then(resolve, reject)
        },
      }
      return builder
    },
  }
}

test('the earlier notice is read for the open site entry, newest first', async () => {
  const client = fakeTables({
    entry_exit_logs: {
      data: [
        { id: 'entry-1', movement_type: 'entry', movement_context: 'site' },
      ],
      error: null,
    },
    movement_notices: {
      data: [
        {
          id: 'notice-1',
          status: 'sent',
          created_at: '2026-10-01T10:00:00Z',
          sender_id: 'user-1',
        },
      ],
      error: null,
    },
    profile_names: {
      data: [{ id: 'user-1', full_name: ' Sara ' }],
      error: null,
    },
  })
  const result = await notice.loadLatestArrivalNotice(client, 'equipment-1')
  assert.deepEqual(plain(result), {
    failed: false,
    notice: {
      id: 'notice-1',
      status: 'sent',
      createdAt: '2026-10-01T10:00:00Z',
      senderId: 'user-1',
      senderName: 'Sara',
    },
  })
  const [logs, notices, names] = client.queries
  assert.equal(logs.select, 'id,movement_type,movement_context')
  assert.deepEqual(logs.filters, [['equipment_id', 'equipment-1']])
  // Deterministic: (recorded_at, id), both descending.
  assert.deepEqual(logs.order, [
    ['recorded_at', false],
    ['id', false],
  ])
  assert.equal(logs.limit, 1)
  assert.equal(notices.select, 'id,status,created_at,sender_id')
  assert.deepEqual(notices.filters, [
    ['kind', 'workshop_arrival'],
    ['entry_log_id', 'entry-1'],
  ])
  assert.deepEqual(notices.order[0], ['created_at', false])
  assert.equal(notices.limit, 1)
  // The name comes from the name-only view, never from `profiles`.
  assert.equal(names.table, 'profile_names')
  assert.equal(names.select, 'id,full_name')
})

test('a unit that is not on a site has no notice to show', async () => {
  for (const data of [
    [],
    [{ id: 'x', movement_type: 'exit', movement_context: 'site' }],
    [{ id: 'x', movement_type: 'entry', movement_context: 'workshop' }],
  ]) {
    const client = fakeTables({ entry_exit_logs: { data, error: null } })
    assert.deepEqual(
      plain(await notice.loadLatestArrivalNotice(client, 'equipment-1')),
      { failed: false, notice: null },
    )
    assert.equal(client.queries.length, 1)
  }
})

test('a failed lookup is reported as failed, not as "never notified"', async () => {
  const broken = fakeTables({
    entry_exit_logs: { data: null, error: { message: 'boom' } },
  })
  assert.deepEqual(
    plain(await notice.loadLatestArrivalNotice(broken, 'equipment-1')),
    { failed: true, notice: null },
  )
  // Before migration 0110 the table does not exist yet.
  const missingTable = fakeTables({
    entry_exit_logs: {
      data: [
        { id: 'entry-1', movement_type: 'entry', movement_context: 'site' },
      ],
      error: null,
    },
    movement_notices: { data: null, error: { message: 'missing' } },
  })
  assert.deepEqual(
    plain(await notice.loadLatestArrivalNotice(missingTable, 'equipment-1')),
    { failed: true, notice: null },
  )
  // An unreadable sender name does not hide the notice itself.
  const noName = fakeTables({
    entry_exit_logs: {
      data: [
        { id: 'entry-1', movement_type: 'entry', movement_context: 'site' },
      ],
      error: null,
    },
    movement_notices: {
      data: [
        { id: 'n', status: 'failed', created_at: 'x', sender_id: 'user-1' },
      ],
      error: null,
    },
    profile_names: { data: null, error: { message: 'boom' } },
  })
  const result = await notice.loadLatestArrivalNotice(noName, 'equipment-1')
  assert.equal(result.failed, false)
  assert.equal(result.notice.senderName, null)
})

test('only a sent or pending notice counts as delivered', () => {
  assert.equal(notice.arrivalNoticeDelivered('sent'), true)
  assert.equal(notice.arrivalNoticeDelivered('pending'), true)
  for (const status of ['failed', 'no_mobile', 'not_configured', ''])
    assert.equal(notice.arrivalNoticeDelivered(status), false, status)
})

test('noticeAge reports the largest whole unit and never a negative', () => {
  const now = Date.parse('2026-10-01T12:00:00Z')
  const at = (iso) => plain(notice.noticeAge(iso, now))
  assert.deepEqual(at('2026-10-01T11:59:30Z'), { unit: 'now' })
  assert.deepEqual(at('2026-10-01T11:53:00Z'), { unit: 'minutes', count: 7 })
  assert.deepEqual(at('2026-10-01T11:00:01Z'), { unit: 'minutes', count: 59 })
  assert.deepEqual(at('2026-10-01T09:00:00Z'), { unit: 'hours', count: 3 })
  assert.deepEqual(at('2026-09-29T11:00:00Z'), { unit: 'days', count: 2 })
  // Clock skew and an unreadable value read as "just now".
  assert.deepEqual(at('2026-10-01T12:05:00Z'), { unit: 'now' })
  assert.deepEqual(at('not a date'), { unit: 'now' })
})

test('splitAroundName isolates the name placeholder', () => {
  assert.deepEqual(
    plain(notice.splitAroundName('تم ابلاغ {name} عبر واتساب')),
    {
      before: 'تم ابلاغ ',
      after: ' عبر واتساب',
      hasName: true,
    },
  )
  assert.deepEqual(plain(notice.splitAroundName('تم الابلاغ')), {
    before: 'تم الابلاغ',
    after: '',
    hasName: false,
  })
})

test('the mobile helpers mirror admin_set_user_mobile', () => {
  assert.equal(mobile.normalizeUserMobileInput(' 050-123 4567 '), '0501234567')
  assert.equal(mobile.normalizeUserMobileInput(null), '')
  assert.equal(mobile.normalizeUserMobileInput('   '), '')
  for (const value of ['', '0501234567', '+966501234567', '12345678'])
    assert.equal(mobile.isValidUserMobile(value), true, value)
  for (const value of [
    '1234567',
    '+',
    '05012345ab',
    '1234567890123456',
    '++9665',
  ])
    assert.equal(mobile.isValidUserMobile(value), false, value)

  // The client rule is the one the migration enforces.
  const sql = read(
    'supabase',
    'migrations',
    '20261001100000_0110_movement_notices.sql',
  )
  assert.ok(sql.includes("v_mobile !~ '^\\+?[0-9]{8,15}$'"))
  assert.match(
    read('src', 'lib', 'userMobile.ts'),
    /\/\^\\\+\?\[0-9\]\{8,15\}\$\//,
  )

  assert.equal(
    mobile.userMobileErrorCode('invalid_mobile (A mobile number is 8 to 15…)'),
    'invalid_mobile',
  )
  assert.equal(mobile.userMobileErrorCode('admin_required'), 'admin_required')
  assert.equal(mobile.userMobileErrorCode('user_not_found'), 'user_not_found')
  assert.equal(
    mobile.userMobileErrorCode(
      'Could not find the function public.admin_set_user_mobile',
    ),
    'failed',
  )
  assert.equal(mobile.userMobileErrorCode(null), 'failed')
})

test('the panel is offered to workshop roles and the admin on an ENTRY only', () => {
  const form = read('src', 'components', 'EntryExitForm.tsx')
  // `workshopMode` is the three workshop roles; since 2026-10-03 the admin
  // also gets the panel in his site ENTRY form. A foreman (supervisor) and a
  // monitor never reach it.
  assert.match(
    form,
    /const canNotifyForeman = workshopMode \|\| profile\?\.role === 'admin'/,
  )
  assert.doesNotMatch(
    form.match(/const canNotifyForeman =[^\r\n]*/)[0],
    /supervisor|monitor/,
  )
  assert.match(
    form,
    /const workshopMode =\s+profile\?\.role === 'workshop' \|\|\s+profile\?\.role === 'assistant_workshop_manager' \|\|\s+profile\?\.role === 'workshop_manager'\r?\n/,
  )
  assert.match(
    form,
    /const notifyForemanMovement =\s+canNotifyForeman &&\s+isEntry &&\s+selected &&\s+lastMovementFor === selected\.id &&\s+lastMovement\?\.movement_type === 'entry' &&\s+lastMovement\.movement_context === 'site'/,
  )
  assert.match(form, /\{notifyForemanMovement && \(\s+<NotifyForemanPanel/)
  // The panel replaces the generic blocked-entry message, for both.
  assert.match(form, /\{validationError && !notifyForemanMovement && \(/)
  assert.match(form, /onRefresh=\{\(\) => checkLastMovement\(selected\)\}/)
  // The blocked save itself is untouched: the database rule still decides.
  assert.match(form, /!!validationError \|\|/)

  const panel = read('src', 'components', 'movement', 'NotifyForemanPanel.tsx')
  assert.match(panel, /target="_blank"\s+rel="noopener noreferrer"/)
  assert.match(panel, /loading=\{sending\}/)
  assert.match(panel, /<bdi>\{name\}<\/bdi>/)
  // Shared components and tokens only.
  assert.match(panel, /from '@\/components\/ui'/)
  assert.doesNotMatch(
    panel,
    /\b(bg|text|border)-(gray|slate|zinc|neutral|red|amber|green|emerald)-\d/,
  )
  assert.doesNotMatch(panel, /tracking-|uppercase/)
  // No recipient, number or text is chosen on the client.
  assert.doesNotMatch(panel, /mobile_number|wa\.me/)
})

test('the user page reads and writes the mobile apart from the record', () => {
  const page = read('src', 'screens', 'UserDetail.tsx')
  // Since 0113 the number lives in `profile_contacts` (admin or self only).
  assert.match(
    page,
    /\.from\('profile_contacts'\)\s+\.select\('mobile_number'\)\s+\.eq\('user_id', userId\)\s+\.maybeSingle\(\)/,
  )
  assert.doesNotMatch(
    page,
    /\.from\('profiles'\)\s+\.select\('mobile_number'\)/,
  )
  assert.match(
    page,
    /supabase\.rpc\(\s*'admin_set_user_mobile',\s*\{ p_user_id: userId, p_mobile_number: nextMobile \},/,
  )
  assert.match(page, /type="tel"\s+inputMode="tel"\s+dir="ltr"/)
  assert.match(page, /disabled=\{mobileState !== 'loaded'\}/)
  // The record is saved first; the number only after it, and only on change.
  assert.ok(
    page.indexOf("action: 'update'") < page.indexOf("'admin_set_user_mobile'"),
  )
  const types = read('src', 'lib', 'types.ts')
  assert.match(
    types,
    /export interface ProfileContact \{\s+user_id: string\s+mobile_number: string \| null/,
  )
  // The number is no longer a profile field.
  const profileType = types.match(
    /export interface Profile \{[\s\S]*?\r?\n\}/,
  )[0]
  assert.doesNotMatch(profileType, /mobile/)
  // The number never joins the name-only lookup.
  assert.doesNotMatch(
    read('src', 'components', 'details', 'profileNames.ts'),
    /mobile/,
  )
})

test('the wave-9 notice strings exist in both languages, plain alif in Arabic', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = source.match(
    /\/\/ wave-9-notices — start[\s\S]*?\/\/ wave-9-notices — end/g,
  )
  assert.equal(blocks?.length, 2, 'one delimited block per language')
  const keys = (block) =>
    [...block.matchAll(/^ {4}(\w+):/gm)].map((match) => match[1]).sort()
  assert.deepEqual(keys(blocks[0]), keys(blocks[1]))
  for (const key of [
    'notifyForeman',
    'refreshEquipmentStatus',
    'notifyForemanSent',
    'notifyForemanNotSent',
    'notifyForemanOpenWhatsapp',
    'notifyForemanNoMobile',
    'notifyForemanErrNotOnSite',
    'notifyForemanErrRecentlySent',
    'notifyForemanPrevious',
    'userMobileHint',
    'userMobileInvalid',
  ])
    assert.ok(keys(blocks[0]).includes(key), key)
  const arabic = blocks.find((block) => /[؀-ۿ]/.test(block))
  assert.ok(arabic, 'the Arabic block is missing')
  assert.ok(!/[أإآ]/.test(arabic))
  assert.match(arabic, /notifyForeman: 'ابلاغ الفورمان'/)
  assert.match(arabic, /notifyForemanSent: 'تم ابلاغ \{name\} عبر واتساب'/)
  assert.match(arabic, /notifyForemanOpenWhatsapp: 'فتح واتساب'/)
  assert.match(arabic, /refreshEquipmentStatus: 'تحديث الحالة'/)
  assert.match(
    arabic,
    /notifyForemanPrevious: 'تم الابلاغ \{ago\} بواسطة \{name\}'/,
  )
  assert.match(arabic, /noticeAgoMinutes: 'قبل \{count\} دقيقة'/)
})
