// Nested workshop stays, screen side (owner 2026-11-14): a project visit stays
// open until work is completed; a workshop entry / exit is a stop nested in it.
// The database decides every rule (migrations of the same change); these tests
// cover the pure mirror the form uses, the messages, the API route and the
// removal of «ابلاغ الفورمان».

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

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
      Date,
      require(request) {
        const match =
          /^@\/lib\/(.+)$/.exec(request) ?? /^\.\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const presence = loadLibModule('equipmentPresence')
const stateLib = loadLibModule('equipmentState')
const errors = loadLibModule('movementErrors')
const { movementSaveErrorKey } = loadLibModule('movementSaveErrors')

const place = (siteOpen, workshopOpen, lastMovementId = 'm-1') => ({
  siteOpen,
  workshopOpen,
  lastMovementId,
})
const keyOf = (decision) => (decision.allowed ? null : decision.messageKey)

// --- The decision ----------------------------------------------------------------

test('a project entry is refused while a project visit is open or the unit is in the workshop', () => {
  const mode = 'site_entry'
  assert.deepEqual({ ...presence.decideMovement(place(false, false), mode) }, {
    allowed: true,
  })
  assert.equal(keyOf(presence.decideMovement(place(true, false), mode)), 'entryBlockedMsg')
  // Both open: the open project visit is the older fact and is named first.
  assert.equal(keyOf(presence.decideMovement(place(true, true), mode)), 'entryBlockedMsg')
  assert.equal(
    keyOf(presence.decideMovement(place(false, true), mode)),
    'entryBlockedInWorkshopMsg',
  )
  // A unit that never moved may enter.
  assert.equal(presence.decideMovement(place(false, false, null), mode).allowed, true)
})

test('a project exit needs an open project visit, inside the workshop or not', () => {
  const mode = 'site_exit'
  assert.equal(presence.decideMovement(place(true, false), mode).allowed, true)
  assert.equal(presence.decideMovement(place(true, true), mode).allowed, true)
  assert.equal(keyOf(presence.decideMovement(place(false, false), mode)), 'exitBlockedMsg')
  // Inside the workshop with no open project visit: nothing to close.
  assert.equal(keyOf(presence.decideMovement(place(false, true), mode)), 'exitBlockedMsg')
  assert.equal(
    keyOf(presence.decideMovement(place(false, false, null), mode)),
    'exitNoPreviousMsg',
  )
})

test('a workshop entry is refused only while the unit is inside the workshop', () => {
  const mode = 'workshop_entry'
  assert.equal(presence.decideMovement(place(false, false), mode).allowed, true)
  // The project visit may be open: the workshop stop is nested in it.
  assert.equal(presence.decideMovement(place(true, false), mode).allowed, true)
  assert.equal(
    keyOf(presence.decideMovement(place(false, true), mode)),
    'workshopEntryBlockedMsg',
  )
  assert.equal(
    keyOf(presence.decideMovement(place(true, true), mode)),
    'workshopEntryBlockedMsg',
  )
  assert.equal(presence.decideMovement(place(false, false, null), mode).allowed, true)
})

test('a workshop exit needs the unit inside the workshop', () => {
  const mode = 'workshop_exit'
  assert.equal(presence.decideMovement(place(false, true), mode).allowed, true)
  // Back in the open project visit: no new project entry, just this exit.
  assert.equal(presence.decideMovement(place(true, true), mode).allowed, true)
  assert.equal(
    keyOf(presence.decideMovement(place(true, false), mode)),
    'workshopExitBlockedMsg',
  )
  assert.equal(
    keyOf(presence.decideMovement(place(false, false), mode)),
    'workshopExitBlockedMsg',
  )
  assert.equal(
    keyOf(presence.decideMovement(place(false, false, null), mode)),
    'exitNoPreviousMsg',
  )
})

test('presenceMode joins the form context and the movement type', () => {
  assert.equal(presence.presenceMode(false, 'entry'), 'site_entry')
  assert.equal(presence.presenceMode(false, 'exit'), 'site_exit')
  assert.equal(presence.presenceMode(true, 'entry'), 'workshop_entry')
  assert.equal(presence.presenceMode(true, 'exit'), 'workshop_exit')
})

// --- The presence row ---------------------------------------------------------------

test('the presence parser reads one row and fails closed on a malformed one', () => {
  const row = {
    state: 'maintenance',
    site_open: true,
    workshop_open: true,
    site_entry_id: 's-1',
    site_entry_at: '2026-09-01T08:00:00Z',
    site_supervisor_name: 'Ali',
    site_project_name_ar: 'مشروع',
    site_driver_name: 'Omar',
    site_driver_mobile_number: '0501234567',
    site_contractor_equipment_code: 'C-1',
    workshop_purpose: 'maintenance',
    last_movement_id: 'm-9',
    last_movement_type: 'entry',
    last_movement_context: 'workshop',
    last_movement_at: '2026-10-03T08:00:00Z',
  }
  for (const data of [row, [row]]) {
    const parsed = presence.parseEquipmentPresence(data)
    assert.equal(parsed.siteOpen, true)
    assert.equal(parsed.workshopOpen, true)
    assert.equal(parsed.state, 'maintenance')
    assert.equal(parsed.siteSupervisorName, 'Ali')
    assert.equal(parsed.siteDriverMobileNumber, '0501234567')
    assert.equal(parsed.lastMovementAt, '2026-10-03T08:00:00Z')
    assert.equal(parsed.siteCompanyNameAr, null)
  }
  for (const bad of [
    null,
    undefined,
    [],
    'x',
    42,
    {},
    { site_open: true },
    { site_open: 'true', workshop_open: false },
    { site_open: true, workshop_open: null },
  ])
    assert.equal(presence.parseEquipmentPresence(bad), null)
  // An unknown state is dropped, not shown.
  assert.equal(
    presence.parseEquipmentPresence({
      site_open: false,
      workshop_open: false,
      state: 'sold',
    }).state,
    null,
  )
})

test('the state of a unit follows the open visits: the workshop first', () => {
  const f = stateLib.equipmentStateFromPresence
  assert.equal(f({ workshop_open: false, site_open: false }), 'available')
  assert.equal(f({ workshop_open: false, site_open: true }), 'working')
  assert.equal(
    f({ workshop_open: true, workshop_purpose: 'maintenance', site_open: true }),
    'maintenance',
  )
  assert.equal(f({ workshop_open: true, workshop_purpose: 'parking' }), 'parking')
  assert.equal(
    f({ workshop_open: true, workshop_purpose: 'out_of_service', site_open: false }),
    'out_of_service',
  )
  assert.equal(
    f({ workshop_open: true, workshop_purpose: null, site_open: true }),
    'unclassified',
  )
  assert.equal(f(null), 'available')
  assert.equal(f(undefined), 'available')
  // The old latest-movement mirror stays for the inquiry screen.
  assert.equal(
    stateLib.equipmentStateFromMovement({ movement_type: 'exit', movement_context: 'workshop' }),
    'available',
  )
})

// --- Errors -----------------------------------------------------------------------------

test('equipment_in_workshop and the two exit tokens are state conflicts (409)', () => {
  assert.equal(
    errors.movementErrorCode('equipment_in_workshop\nHINT: The equipment is inside the workshop.'),
    'equipment_in_workshop',
  )
  // The longer token is matched first.
  assert.equal(
    errors.movementErrorCode('exit_equipment_in_workshop'),
    'exit_equipment_in_workshop',
  )
  assert.ok(errors.MOVEMENT_ERROR_CODES.includes('equipment_in_workshop'))
  for (const code of [
    'equipment_in_workshop',
    'exit_equipment_in_workshop',
    'exit_equipment_on_site',
  ])
    assert.equal(errors.movementErrorStatus(code), 409, code)
  // Permission failures stay 403.
  for (const code of ['exit_not_entry_owner', 'workshop_exit_owner', 'access_denied'])
    assert.equal(errors.movementErrorStatus(code), 403, code)
  assert.equal(
    movementSaveErrorKey('equipment_in_workshop', true),
    'entryBlockedInWorkshopMsg',
  )
})

// --- Messages ----------------------------------------------------------------------------

function translationBlocks() {
  const source = read('src', 'i18n', 'translations.ts')
  const ar = source.slice(source.indexOf('ar: {'), source.indexOf('\n  en: {'))
  const en = source.slice(source.indexOf('\n  en: {'))
  return { ar, en }
}

test('the new messages exist in both languages and use the plain alif', () => {
  const { ar, en } = translationBlocks()
  const keys = [
    'entryBlockedInWorkshopMsg',
    'workshopEntryBlockedMsg',
    'workshopExitBlockedMsg',
    'movementTiedToProject',
    'movementTiedToProjectUnnamed',
    'workshopEntryNestedNotice',
    'workshopEntryNestedNoticeNoForeman',
    'workshopEntryNestedNoticeNoProject',
    'workshopEntryNestedNoticeBare',
    'siteExitWhileInWorkshopNotice',
  ]
  for (const key of keys) {
    for (const block of [ar, en]) {
      const match = new RegExp(`\\n    ${key}:\\s*(['"])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1,`).exec(block)
      assert.ok(match, key)
      if (block === ar) assert.ok(!/[أإآ]/.test(match[2]), key)
    }
  }
  assert.match(
    ar,
    /entryBlockedInWorkshopMsg:\s*'المعدة داخل الورشة حاليا\. سجل خروجها من الورشة اولا، ثم سجل دخولها للمشروع\.'/,
  )
  assert.match(
    ar,
    /siteExitWhileInWorkshopNotice:\s*'المعدة داخل الورشة حاليا\. تسجيل الخروج ينهي زيارة المشروع فقط، وتبقى المعدة في الورشة\.'/,
  )
  assert.match(
    ar,
    /workshopEntryNestedNotice:\s*'المعدة تابعة لمشروع \{project\} \(الفورمان: \{foreman\}\)\. زيارة المشروع تبقى قائمة ولا تحتاج تسجيل خروج، وسيصل الفورمان اشعار بدخولها الورشة\.'/,
  )
  // The old rule ("the last movement was an entry") is no longer stated.
  assert.ok(!/entryBlockedMsg:\s*'[^']*آخر حركة/.test(ar))
  assert.ok(!/entryBlockedMsg:\s*["']Cannot register a new entry because the equipment.s last movement/.test(en))
  assert.match(en, /entryBlockedMsg:\s*'Cannot register a new entry because the equipment has an open project visit/)
})

test('the removed notify-foreman strings are gone from both languages', () => {
  const { ar, en } = translationBlocks()
  for (const key of [
    'notifyForemanTitle',
    'notifyForeman',
    'refreshEquipmentStatus',
    'noticeAgoNow',
  ])
    for (const block of [ar, en])
      assert.ok(!new RegExp(`\\n    ${key}:`).test(block), key)
})

// --- The form ---------------------------------------------------------------------------

test('the form reads the presence once and decides with the pure function', () => {
  const form = read('src', 'components', 'EntryExitForm.tsx')
  assert.match(form, /supabase\.rpc\('get_equipment_presence', \{\s+p_equipment_id: eq\.id,\s+\}\)/)
  assert.ok(!/get_last_movement/.test(form))
  assert.match(form, /parseEquipmentPresence\(data\)/)
  assert.match(
    form,
    /decideMovement\(\s+next,\s+presenceMode\(workshopMode, isEntry \? 'entry' : 'exit'\),\s+\)/,
  )
  // A failed or malformed read is a visible error, never "no data".
  assert.match(form, /if \(!next\) \{[\s\S]*?setSaveError\(t\('saveFailed'\)\)/)
  // The time bump still uses the unit's latest movement overall.
  assert.match(form, /presence\?\.lastMovementAt,/)
})

test('the form shows the two nested-stay notices and no notify-foreman panel', () => {
  const form = read('src', 'components', 'EntryExitForm.tsx')
  assert.ok(!/NotifyForeman|notifyForeman|workshopArrivalNotice/.test(form))
  assert.match(
    form,
    /const nestedWorkshopEntry =\s+workshopMode &&\s+isEntry &&\s+!validationError &&\s+!loadingMovement &&\s+presence\?\.siteOpen === true/,
  )
  assert.match(
    form,
    /const siteExitInWorkshop =\s+siteExitMode &&\s+!validationError &&\s+!loadingMovement &&\s+presence\?\.workshopOpen === true/,
  )
  assert.match(form, /\{nestedWorkshopEntry && presence && \(\s+<Notice tone="info">/)
  assert.match(form, /<Notice tone="info">\{t\('siteExitWhileInWorkshopNotice'\)\}<\/Notice>/)
  // The last-entry summary shows the OPEN project visit, not the latest movement.
  assert.match(form, /recordedAt=\{presence\?\.siteEntryAt\}/)
  assert.match(form, /driverMobile=\{presence\?\.siteDriverMobileNumber\}/)
  assert.match(form, /contractorCode=\{presence\?\.siteContractorEquipmentCode\}/)
  assert.match(form, /presence\?\.siteProjectNameAr/)
})

test('the status card shows the real place from the presence row', () => {
  const card = read('src', 'components', 'movement', 'MovementStatusCard.tsx')
  assert.match(card, /presence: EquipmentPresence \| null/)
  assert.ok(!/import type \{[^}]*LastMovement/.test(card))
  assert.match(card, /presence\.workshopOpen\s+\? 'workshop'/)
  assert.match(card, /t\('movementTiedToProject'\)\.replace\('\{project\}', projectName\)/)
})

// --- The route and the notices ------------------------------------------------------------

test('a new project exit carries work_completed only; the notice follows every movement but a project entry', () => {
  const route = read('app', 'api', 'movements', 'route.ts')
  assert.match(
    route,
    /\(!isExitPurpose\(exitPurpose\) \|\|\s+\(isSiteExit && exitPurpose !== 'work_completed'\)\)/,
  )
  assert.match(route, /error: 'exit_purpose_required'/)
  assert.match(route, /if \(!isSiteEntry\) \{/)
  assert.ok(!/prepare_movement_exit_notice|sendMovementExitNotice/.test(route))
  // No sequence pre-check in the route: the database decides.
  assert.ok(!/get_equipment_presence|get_last_movement/.test(route))
  const notices = read('src', 'lib', 'server', 'movementNotices.ts')
  assert.match(notices, /supabase\.rpc\('prepare_movement_notice', \{/)
  assert.ok(!/prepare_movement_exit_notice/.test(notices))
})

test('the notify-foreman permission flag left the form actions', () => {
  const actions = read('src', 'lib', 'actionPermissions.ts')
  assert.ok(!/notifyForeman/.test(actions))
})
