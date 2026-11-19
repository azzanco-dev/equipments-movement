const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// The daily WhatsApp reminder of installment due dates (migration 0205):
// the pure message builder of src/lib/installmentReminder.ts with made-up
// rows, then static checks of the migration, the server module, the cron
// route and vercel.json. No network, no database.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

function loadLib(name) {
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const exports = {}
  vm.runInNewContext(
    code,
    {
      exports,
      Math,
      Number,
      String,
      Array,
      Map,
      require(request) {
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const lib = loadLib('installmentReminder')
const DAY = '2026-11-19'

function item(overrides) {
  return {
    bucket: 'overdue',
    contractNumber: 'INS-0003',
    description: 'شيول كاتربلر',
    financierName: 'بنك الراجحي',
    seq: 1,
    dueDate: '2026-11-16',
    remainingAmount: 12500,
    daysUntilDue: -3,
    ...(overrides ?? {}),
  }
}

const MIGRATION = read(
  'supabase',
  'migrations',
  '20261119120000_0205_installment_reminder.sql',
)
const SERVER = read('src', 'lib', 'server', 'installmentReminder.ts')
const ROUTE = read('app', 'api', 'cron', 'installment-reminder', 'route.ts')
const LIB = read('src', 'lib', 'installmentReminder.ts')

test('the agreed message: sections in order, no link line', () => {
  const message = lib.buildInstallmentReminderMessage({
    day: DAY,
    items: [
      item(),
      item({
        bucket: 'tomorrow',
        contractNumber: 'INS-0007',
        description: 'رافعة',
        financierName: 'وكالة',
        dueDate: '2026-11-20',
        remainingAmount: 1234567,
        daysUntilDue: 1,
      }),
      item({
        bucket: 'tomorrow',
        contractNumber: 'INS-0008',
        description: 'حفار',
        financierName: 'وكالة',
        dueDate: '2026-11-20',
        remainingAmount: 4000.5,
        daysUntilDue: 1,
      }),
    ],
  })
  assert.equal(
    message,
    [
      'تذكير الاقساط - 19/11/2026',
      '',
      'متاخرة (1):',
      '• INS-0003 - شيول كاتربلر - بنك الراجحي - 12,500 ريال - متاخر 3 ايام',
      '',
      'مستحقة غدا (2):',
      '• INS-0007 - رافعة - وكالة - 1,234,567 ريال',
      '• INS-0008 - حفار - وكالة - 4,000.50 ريال',
    ].join('\n'),
  )
})

test('nothing to say gives no message; an empty section is left out', () => {
  assert.equal(lib.buildInstallmentReminderMessage({ day: DAY, items: [] }), null)
  const message = lib.buildInstallmentReminderMessage({
    day: DAY,
    items: [item({ bucket: 'tomorrow', daysUntilDue: 1, dueDate: '2026-11-20' })],
  })
  assert.ok(!message.includes('متاخرة'))
  assert.ok(message.includes('مستحقة غدا (1):'))
  // Only two sections exist: nothing of today and nothing 7 days ahead.
  assert.deepEqual(Object.keys(lib.INSTALLMENT_REMINDER_SECTION_TITLES), ['overdue', 'tomorrow'])
  assert.doesNotMatch(LIB, /اليوم|7 ايام/)
})

test('the message carries no link (owner 2026-11-19)', () => {
  const message = lib.buildInstallmentReminderMessage({ day: DAY, items: [item()] })
  assert.ok(!message.includes('الرابط'))
  assert.doesNotMatch(message, /https?:/)
  assert.equal(lib.reminderLink, undefined)
  assert.doesNotMatch(SERVER, /resolveAppBaseUrl|appBaseUrl/)
})

test('one line per contract: its rows added up, the oldest days, most overdue first', () => {
  const message = lib.buildInstallmentReminderMessage({
    day: DAY,
    items: [
      item({ contractNumber: 'INS-0001', dueDate: '2026-11-18', daysUntilDue: -1, remainingAmount: 100 }),
      item({ contractNumber: 'INS-0002', dueDate: '2026-10-19', daysUntilDue: -31, remainingAmount: 1000, seq: 1 }),
      item({ contractNumber: 'INS-0002', dueDate: '2026-11-17', daysUntilDue: -2, remainingAmount: 1000.25, seq: 2 }),
    ],
  })
  const lines = message.split('\n')
  assert.equal(lines[2], 'متاخرة (2):')
  assert.equal(
    lines[3],
    '• INS-0002 - شيول كاتربلر - بنك الراجحي - 2,000.25 ريال - قسطين - متاخر 31 يوم',
  )
  assert.equal(
    lines[4],
    '• INS-0001 - شيول كاتربلر - بنك الراجحي - 100 ريال - متاخر يوم',
  )
})

test('a long section is cut with «و N اخرى» and the text stays short', () => {
  const many = Array.from({ length: 30 }, (_, index) =>
    item({
      contractNumber: `INS-${String(index + 1).padStart(4, '0')}`,
      description: 'عنوان طويل '.repeat(20),
      daysUntilDue: -(index + 1),
    }),
  )
  const message = lib.buildInstallmentReminderMessage({
    day: DAY,
    items: many,
  })
  assert.ok(message.includes('متاخرة (30):'))
  assert.ok(message.includes(`و ${30 - lib.INSTALLMENT_REMINDER_MAX_LINES} اخرى`))
  assert.ok(message.length <= lib.INSTALLMENT_REMINDER_MAX_LENGTH)
  // A title is cut on one line.
  assert.ok(message.includes('…'))
  const bullets = message.split('\n').filter((line) => line.startsWith('• '))
  assert.equal(bullets.length, lib.INSTALLMENT_REMINDER_MAX_LINES)

  const huge = Array.from({ length: 2 }, (_, b) =>
    Array.from({ length: 40 }, (_, index) =>
      item({
        bucket: ['overdue', 'tomorrow'][b],
        contractNumber: `INS-${b}${String(index).padStart(3, '0')}`,
        description: 'ب'.repeat(80),
        financierName: 'ج'.repeat(80),
        daysUntilDue: b === 0 ? -5 : 1,
      }),
    ),
  ).flat()
  const shortened = lib.buildInstallmentReminderMessage({ day: DAY, items: huge })
  assert.ok(shortened.length <= lib.INSTALLMENT_REMINDER_MAX_LENGTH)
})

test('data never breaks a line', () => {
  const message = lib.buildInstallmentReminderMessage({
    day: DAY,
    items: [item({ description: 'سطر\nثاني\t  ثالث', financierName: ' بنك\nالبلاد ' })],
  })
  assert.ok(message.includes('• INS-0003 - سطر ثاني ثالث - بنك البلاد - 12,500 ريال'))
})

test('the words and numbers', () => {
  assert.deepEqual(
    [1, 2, 3, 10, 11, 45].map(lib.reminderDaysWords),
    ['يوم', 'يومين', '3 ايام', '10 ايام', '11 يوم', '45 يوم'],
  )
  assert.deepEqual(
    [2, 3, 10, 12].map(lib.reminderInstallmentsWords),
    ['قسطين', '3 اقساط', '10 اقساط', '12 قسط'],
  )
  assert.equal(lib.reminderAmountLabel(0), '0')
  assert.equal(lib.reminderAmountLabel(999), '999')
  assert.equal(lib.reminderAmountLabel(1000), '1,000')
  assert.equal(lib.reminderAmountLabel(12500.5), '12,500.50')
  assert.equal(lib.reminderAmountLabel(0.1 + 0.2), '0.30')
  assert.equal(lib.reminderDayLabel('2026-01-05'), '05/01/2026')
  assert.equal(lib.reminderMoreLabel(4), 'و 4 اخرى')
})

test('Latin digits and no alif with hamza or madda in the template', () => {
  const message = lib.buildInstallmentReminderMessage({
    day: DAY,
    items: [
      item({ description: 'شيول', financierName: 'جهة' }),
      item({ bucket: 'tomorrow', contractNumber: 'INS-0006', description: 'رافعة', financierName: 'جهة', daysUntilDue: 1, dueDate: '2026-11-20' }),
    ],
  })
  assert.doesNotMatch(message, /[٠-٩۰-۹]/)
  assert.doesNotMatch(message, /[أإآ]/)
  const templateStrings = [
    lib.INSTALLMENT_REMINDER_TITLE,
    lib.INSTALLMENT_REMINDER_CURRENCY,
    ...Object.values(lib.INSTALLMENT_REMINDER_SECTION_TITLES),
    lib.reminderMoreLabel(3),
    lib.reminderDaysWords(5),
    lib.reminderInstallmentsWords(4),
  ]
  for (const value of templateStrings) assert.doesNotMatch(value, /[أإآ]/)
  // Nothing in the lib source itself either.
  assert.doesNotMatch(LIB, /[أإآ]/)
})

test('the payload parser keeps valid rows only', () => {
  assert.equal(lib.parseInstallmentReminder(null), null)
  assert.equal(lib.parseInstallmentReminder({ day: 'today' }), null)
  const parsed = lib.parseInstallmentReminder({
    day: DAY,
    items: [
      {
        bucket: 'overdue',
        contract_number: 'INS-0001',
        description: 'x',
        financier_name: 'y',
        seq: 2,
        due_date: '2026-11-10',
        remaining_amount: '1500.00',
        days_until_due: -9,
      },
      { bucket: 'later', contract_number: 'INS-0002', remaining_amount: 1, days_until_due: 9, due_date: DAY },
      { bucket: 'tomorrow', contract_number: '', remaining_amount: 1, days_until_due: 1, due_date: DAY },
      { bucket: 'today', contract_number: 'INS-0009', remaining_amount: 1, days_until_due: 0, due_date: DAY },
    ],
    recipients: [
      { log_id: 'abc', name: 'عمر', mobile: ' 0500000000 ' },
      { log_id: 'def', name: 'x', mobile: null },
      { name: 'no id' },
    ],
    skipped: 1,
  })
  assert.equal(parsed.items.length, 1)
  assert.equal(parsed.items[0].remainingAmount, 1500)
  assert.equal(parsed.items[0].seq, 2)
  assert.deepEqual(
    JSON.parse(JSON.stringify(parsed.recipients)),
    [
      { logId: 'abc', name: 'عمر', mobile: '0500000000' },
      { logId: 'def', name: 'x', mobile: null },
    ],
  )
  assert.equal(parsed.skipped, 1)
})

// --- static checks -------------------------------------------------------------

test('0205: the tables are closed to clients, the log readable by the admin', () => {
  for (const table of [
    'installment_reminder_recipients',
    'installment_reminder_config',
    'installment_reminder_log',
  ]) {
    assert.match(MIGRATION, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`))
    assert.match(
      MIGRATION,
      new RegExp(`REVOKE ALL ON TABLE public\\.${table}\\s+FROM PUBLIC, anon, authenticated`),
    )
  }
  assert.match(MIGRATION, /GRANT SELECT ON TABLE public\.installment_reminder_log TO authenticated/)
  assert.match(
    MIGRATION,
    /USING \(\(SELECT public\.has_permission\('installments\.view'\)\)\)/,
  )
  assert.doesNotMatch(MIGRATION, /is_admin\(/)
  // No phone column and no message text in the log or the recipients.
  const log = MIGRATION.slice(
    MIGRATION.indexOf('CREATE TABLE public.installment_reminder_log'),
    MIGRATION.indexOf('COMMENT ON TABLE public.installment_reminder_log'),
  )
  assert.doesNotMatch(log, /mobile_number|message_text|\bbody\b/)
  assert.match(log, /CONSTRAINT installment_reminder_log_once_a_day UNIQUE \(profile_id, reminder_day\)/)
  // The one recipient, by id; no phone number anywhere in the file.
  assert.match(MIGRATION, /288433b5-8285-458e-af6c-97ba7ea833c0/)
  assert.doesNotMatch(MIGRATION, /\+?9665\d{8}|05\d{8}/)
  // Every new editable table carries updated_at with the trigger.
  assert.match(MIGRATION, /installment_reminder_recipients_updated_at\s+BEFORE UPDATE/)
  assert.match(MIGRATION, /installment_reminder_config_updated_at\s+BEFORE UPDATE/)
})

test('0205: the secret is stored as a hash only and checked first', () => {
  assert.match(MIGRATION, /key_hash ~ '\^\[0-9a-f\]\{64\}\$'/)
  assert.match(MIGRATION, /encode\(sha256\(convert_to\(p_key, 'UTF8'\)\), 'hex'\) <> v_hash/)
  // The seeded hash is 64 hex characters; the secret itself is in no file.
  assert.match(MIGRATION, /VALUES \(true, '[0-9a-f]{64}'\)/)
  for (const file of [MIGRATION, SERVER, ROUTE, LIB, read('vercel.json')]) {
    assert.doesNotMatch(file, /CRON_SECRET\s*=\s*\S/)
  }
  for (const fn of ['prepare_installment_reminder', 'complete_installment_reminder']) {
    const start = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`)
    const body = MIGRATION.slice(start, MIGRATION.indexOf('$$;', start))
    assert.match(body, /SECURITY DEFINER/)
    assert.match(body, /SET search_path = public, pg_temp/)
    const firstStatement = body.slice(body.indexOf('BEGIN')).split(';')[0]
    assert.match(firstStatement, /PERFORM public\.assert_installment_reminder_key\(p_key\)/)
  }
  assert.match(
    MIGRATION,
    /REVOKE ALL ON FUNCTION public\.assert_installment_reminder_key\(text\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.doesNotMatch(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.assert_installment_reminder_key/)
  assert.match(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.prepare_installment_reminder\(text\) TO anon;/)
  assert.match(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.complete_installment_reminder\(text, uuid, text, text, text\)\s+TO anon;/)
  assert.doesNotMatch(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.(prepare|complete)_installment_reminder[^;]*authenticated/)
})

test('0205: active contracts, unpaid rows, overdue and due tomorrow only, once a day', () => {
  const start = MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.prepare_installment_reminder(')
  const body = MIGRATION.slice(start, MIGRATION.indexOf('$$;', start))
  assert.match(body, /v_day := public\.saudi_today\(\)/)
  assert.match(body, /c\.status = 'active'/)
  assert.match(body, /s\.paid_amount < s\.amount/)
  assert.match(body, /s\.due_date < v_day OR s\.due_date = v_day \+ 1/)
  assert.doesNotMatch(body, /v_day \+ 7|'today'|'soon'/)
  // The claim is one statement that skips a row already sent or pending.
  const claims = body.match(/WHERE l\.status NOT IN \('sent', 'pending'\)/g) ?? []
  assert.equal(claims.length, 2)
  assert.match(body, /ON CONFLICT \(profile_id, reminder_day\) DO UPDATE/)
  assert.match(body, /WHERE rr\.is_active/)
  // The mobile comes from profile_contacts at send time.
  assert.match(body, /LEFT JOIN public\.profile_contacts pc ON pc\.user_id = rr\.profile_id/)

  const cstart = MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.complete_installment_reminder(')
  const complete = MIGRATION.slice(cstart, MIGRATION.indexOf('$$;', cstart))
  assert.match(complete, /AND l\.status = 'pending'/)
  assert.match(complete, /p_status NOT IN \('sent', 'failed', 'no_mobile', 'not_configured'\)/)
})

test('the route: the Vercel Cron secret, no service key, a count summary only', () => {
  assert.match(ROUTE, /export async function GET\(/)
  assert.match(ROUTE, /export const dynamic = 'force-dynamic'/)
  assert.match(ROUTE, /process\.env\.CRON_SECRET/)
  assert.match(ROUTE, /`Bearer \$\{secret\}`/)
  assert.match(ROUTE, /timingSafeEqual/)
  assert.match(ROUTE, /status: 401/)
  for (const source of [ROUTE, SERVER]) {
    assert.doesNotMatch(source, /SERVICE_ROLE|service_role/i)
    assert.doesNotMatch(source, /NEXT_PUBLIC_CRON|NEXT_PUBLIC_ULTRAMSG/)
  }
  assert.match(SERVER, /NEXT_PUBLIC_SUPABASE_ANON_KEY/)
  assert.match(SERVER, /'prepare_installment_reminder'/)
  assert.match(SERVER, /'complete_installment_reminder'/)
  assert.match(SERVER, /sendWhatsAppText\(to, message\)/)
  // Never logs a number, the text or the secret.
  for (const call of SERVER.match(/console\.error\([^)]*\)/gs) ?? []) {
    assert.doesNotMatch(call, /mobile|message|secret|\bto\b/)
  }
})

test('vercel.json: one Vercel schedule at 09:00 Riyadh time, GET, no legacy crons', () => {
  const config = JSON.parse(read('vercel.json'))
  // A cron entry beside the schedule would run the route twice a day.
  assert.equal(config.crons, undefined)
  assert.deepEqual(config.schedules, {
    'installment-reminder': {
      schedule: '0 9 * * *',
      timezone: 'Asia/Riyadh',
      path: '/api/cron/installment-reminder',
      // The route exports GET only; a schedule path defaults to POST.
      requestMethod: 'GET',
    },
  })
  assert.match(ROUTE, /export\s+(async\s+)?function\s+GET\b|export\s+const\s+GET\b/)
})
