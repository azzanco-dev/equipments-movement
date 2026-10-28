// wave 24 (actions by permissions) — the in-screen action and data decisions
// that used to compare `profiles.role` now read the permissions
// (src/lib/actionPermissions.ts, src/lib/homeScope.ts).
//
// With the frozen legacy_role_permissions mapping, for each of the six roles
// every READY decision must be IDENTICAL to the role rule it replaced. Those
// rules are transcribed below from the screens at d68a08d (`before*`).
//
// Roles stage 4a (2026-10-27): there is no role fallback any more. While the
// permissions load or after a failed load nothing is granted (fail closed).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

function loadLib(name) {
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(
    code,
    {
      exports,
      require(request) {
        throw new Error(`Unexpected runtime import: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

const actions = loadLib('actionPermissions')
const homeScope = loadLib('homeScope')
const gallery = loadLib('movementPhotoGallery')
const nav = loadLib('navPermissions')

// --- The frozen legacy mapping (latest body: 0126, recreated by 0130) -------

const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const migrationTexts = fs
  .readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => read('supabase', 'migrations', name))

function legacyMapping() {
  let body = null
  for (const sql of migrationTexts) {
    const re =
      /CREATE OR REPLACE FUNCTION public\.legacy_role_permissions\(p_role text\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g
    for (const match of sql.matchAll(re)) body = match[1]
  }
  assert.ok(body, 'legacy_role_permissions is defined')
  const mapping = new Map()
  for (const [, role, key, , scope] of body.matchAll(
    /\('(\w+)', '([\w.]+)', (NULL|'(\w+)')\)/g,
  )) {
    if (!mapping.has(role)) mapping.set(role, new Map())
    mapping.get(role).set(key, scope ?? 'all')
  }
  return mapping
}

function catalogueKeys() {
  const keys = new Set()
  for (const sql of migrationTexts)
    for (const insert of sql.matchAll(
      /INSERT INTO public\.permissions \([\s\S]*?\) VALUES([\s\S]*?);\n/g,
    ))
      for (const row of insert[1].matchAll(/^\s*\('([\w.]+)', '(\w+)',/gm))
        keys.add(row[1])
  for (const sql of migrationTexts)
    for (const [, key] of sql.matchAll(
      /DELETE FROM public\.permissions\s+WHERE key = '([\w.]+)'/g,
    ))
      keys.delete(key)
  return keys
}

/** A seeded custom role of 0126 (`role_permissions` seed rows). */
function seededRole(roleKey) {
  const sql = read(
    'supabase',
    'migrations',
    '20261011130000_0126_roles_and_permissions.sql',
  )
  const map = new Map()
  const re = new RegExp(`\\('${roleKey}', '([\\w.]+)', (NULL|'(\\w+)')\\)`, 'g')
  for (const [, key, , scope] of sql.matchAll(re)) map.set(key, scope ?? 'all')
  return map
}

const LEGACY = legacyMapping()
const CATALOGUE = catalogueKeys()
const ROLES = [
  'admin',
  'supervisor',
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
  'monitor',
]
const ready = (entries) => ({
  status: 'ready',
  permissions: entries instanceof Map ? entries : new Map(entries),
})
const LOADING = { status: 'loading', permissions: new Map() }
const FAILED = { status: 'error', permissions: new Map() }
const legacyState = (role) => ready(LEGACY.get(role) ?? new Map())

// --- The role rules at d68a08d, transcribed ---------------------------------

const isWorkshopRole = (role) =>
  role === 'workshop' ||
  role === 'assistant_workshop_manager' ||
  role === 'workshop_manager'

// src/screens/MovementDetail.tsx
function beforeMovementDetail(role, row) {
  const isWorkshopMovement = row.context === 'workshop'
  const linkedLog = row.isEntry && !row.visitOpen
  return {
    editDelete: role === 'admin',
    changeDriver: role === 'admin' || (role === 'supervisor' && row.own),
    editContractorCode:
      role === 'supervisor' &&
      row.isEntry &&
      !isWorkshopMovement &&
      !linkedLog &&
      row.own,
    addPhotos:
      role === 'admin' ||
      (role !== 'monitor' && role != null && row.own) ||
      (isWorkshopRole(role) && isWorkshopMovement),
  }
}
function beforeSkeleton(role) {
  return {
    context: isWorkshopRole(role) ? 'workshop' : 'site',
    adminMenu: role === 'admin',
    canUpload: role !== 'monitor',
  }
}
// src/components/EntryExitForm.tsx (+ EquipmentStep's `isAdmin`)
function beforeForm(role) {
  const workshopMode = isWorkshopRole(role)
  return {
    workshopMode,
    exitAnyVisit: role === 'admin',
    notifyForeman: workshopMode || role === 'admin',
  }
}
// src/screens/HomeScreen.tsx: scope from the role; the managers' embedded
// log classified, the pending list was theirs, the own card never classified.
function beforeHome(role) {
  const scope =
    role === 'workshop_manager' || role === 'assistant_workshop_manager'
      ? 'all_contexts'
      : role === 'workshop'
        ? 'workshop'
        : 'own_site'
  const managerMode = scope === 'all_contexts'
  return {
    scope,
    logClassify: managerMode,
    pendingList: managerMode,
    cardClassify: false,
  }
}
// The admin-only decisions (EquipmentFormDialog's `isAdmin`,
// EquipmentLocationCard, Layout + WhatsAppStatusAlert, the users screens
// reachable by the admin only).
const beforeAdminOnly = (role) => role === 'admin'
// canRemoveSavedPhoto at d68a08d: monitor never, admin always, anybody else
// his own uploads.
function beforeCanRemove(role, userId, photo) {
  if (role === 'monitor') return false
  if (role === 'admin') return true
  return Boolean(userId) && photo.uploaded_by === userId
}

// The home as HomeScreen derives it now (no prop from App.tsx).
function homeNow(state) {
  const scope = homeScope.resolveHomeMovementsScope(state)
  const managerMode = scope === 'all_contexts'
  const workshopMode = scope === 'workshop' || managerMode
  const embeddedLog =
    managerMode || scope === 'site_all' || scope === 'workshop_all'
  const holdsClassify = actions.homeActions(state).classifyWorkshopEntries
  const canClassify = workshopMode && holdsClassify
  return {
    scope,
    // 2026-10-28: the embedded log classifies for a holder of the key (the
    // managers, and a wider foreman home of a custom role).
    logClassify:
      embeddedLog && holdsClassify && (workshopMode || embeddedLog),
    pendingList: canClassify,
    cardClassify: !managerMode && canClassify,
  }
}

const ROWS = []
for (const own of [true, false])
  for (const context of ['site', 'workshop'])
    for (const isEntry of [true, false])
      for (const visitOpen of isEntry ? [true, false] : [false])
        ROWS.push({ own, context, isEntry, visitOpen })

const ME = 'user-me'
const OTHER = 'user-other'
const PHOTOS = [
  { uploaded_by: ME },
  { uploaded_by: OTHER },
  { uploaded_by: null },
]

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]))
}

// --- The keys exist ----------------------------------------------------------

test('every key the decisions read is in the permission catalogue', () => {
  const source = read('src', 'lib', 'actionPermissions.ts')
  const used = new Set(
    [...source.matchAll(/permissions\.(?:has|get)\('([\w.]+)'\)/g)].map(
      (match) => match[1],
    ),
  )
  for (const key of read('src', 'lib', 'homeScope.ts').matchAll(
    /permissions\.(?:has|get)\('([\w.]+)'\)/g,
  ))
    used.add(key[1])
  assert.ok(used.size >= 15, `${used.size} keys`)
  for (const key of used) assert.ok(CATALOGUE.has(key), key)
  assert.ok(!CATALOGUE.has('map.view'), 'map.view was retired by 0130')
})

// --- Ready with the legacy mapping: identical to the role rules -------------

for (const role of ROLES) {
  test(`${role}: the movement detail decisions are unchanged`, () => {
    const state = legacyState(role)
    for (const row of ROWS) {
      const now = actions.movementDetailActions(state, row)
      assert.deepEqual(
        pick(now, [
          'editDelete',
          'changeDriver',
          'editContractorCode',
          'addPhotos',
        ]),
        beforeMovementDetail(role, row),
        JSON.stringify(row),
      )
    }
    // Photo removal: the decided viewer gives the same remove buttons as the
    // old role rule of canRemoveSavedPhoto.
    const removal = actions.movementDetailActions(state, ROWS[0]).photoRemoval
    const viewer = actions.photoViewerFor(removal, ME)
    for (const photo of PHOTOS)
      assert.equal(
        gallery.canRemoveSavedPhoto(photo, viewer),
        beforeCanRemove(role, ME, photo),
        JSON.stringify(photo),
      )
    assert.deepEqual(
      plain(actions.movementSkeletonShape(state)),
      beforeSkeleton(role),
    )
  })

  test(`${role}: the movement form decisions are unchanged`, () => {
    const state = legacyState(role)
    const now = actions.movementFormActions(state)
    assert.deepEqual(
      pick(now, ['workshopMode', 'exitAnyVisit', 'notifyForeman']),
      beforeForm(role),
    )
    const permissions = LEGACY.get(role)
    const opensForm = nav.canOpenPage(permissions, 'movements/new')
    if (!opensForm) {
      // Only the monitor: no create key, the form never opens for him.
      assert.equal(role, 'monitor')
      return
    }
    // The quick-create controls had no role check: everybody who opened the
    // form saw the equipment button, and the site form the driver and
    // supplier options (the workshop form has neither field).
    assert.equal(now.quickCreateEquipment, true)
    if (!now.workshopMode) {
      assert.equal(now.quickCreateDriver, true)
      assert.equal(now.quickCreateLessor, true)
    }
  })

  test(`${role}: the field home decisions are unchanged`, () => {
    assert.deepEqual(homeNow(legacyState(role)), beforeHome(role))
    // App.tsx's scope (planShell) and the home's own agree.
    const plan = nav.planShell(legacyState(role))
    if (plan.homeScope)
      assert.equal(
        plan.homeScope,
        homeScope.resolveHomeMovementsScope(legacyState(role)),
      )
  })

  test(`${role}: the admin-only cards and fields are unchanged`, () => {
    const state = legacyState(role)
    const expected = beforeAdminOnly(role)
    assert.deepEqual(plain(actions.equipmentFormActions(state)), {
      trackerLink: expected,
      changeCode: expected,
    })
    assert.deepEqual(plain(actions.equipmentListActions(state)), {
      create: expected,
      edit: expected,
      importRows: expected,
    })
    assert.deepEqual(plain(actions.usersActions(state)), {
      manage: expected,
    })
    assert.equal(actions.canSeeIntegrationsStatus(state), expected)
    assert.equal(actions.canViewEquipmentLocation(state), expected)
  })
}

// --- Loading / failed load: nothing is granted (roles stage 4a) -------------

const NOTHING_DETAIL = {
  editDelete: false,
  changeDriver: false,
  editContractorCode: false,
  addPhotos: false,
  photoRemoval: 'none',
}

test('while loading or after a failed load nothing is granted', () => {
  // Even a state that (wrongly) carries a full map: only 'ready' counts.
  const full = LEGACY.get('admin')
  for (const state of [
    LOADING,
    FAILED,
    { status: 'loading', permissions: full },
    { status: 'error', permissions: full },
  ]) {
    for (const row of ROWS)
      assert.deepEqual(
        plain(actions.movementDetailActions(state, row)),
        NOTHING_DETAIL,
      )
    for (const photo of PHOTOS)
      assert.equal(
        gallery.canRemoveSavedPhoto(
          photo,
          actions.photoViewerFor(
            actions.movementDetailActions(state, ROWS[0]).photoRemoval,
            ME,
          ),
        ),
        false,
      )
    // The skeleton: the neutral site shape without any action.
    assert.deepEqual(plain(actions.movementSkeletonShape(state)), {
      context: 'site',
      adminMenu: false,
      canUpload: false,
    })
    assert.deepEqual(plain(actions.movementFormActions(state)), {
      workshopMode: false,
      exitAnyVisit: false,
      notifyForeman: false,
      quickCreateEquipment: false,
      quickCreateDriver: false,
      quickCreateLessor: false,
    })
    // The narrowest home list, no classification.
    assert.deepEqual(homeNow(state), {
      scope: 'own_site',
      logClassify: false,
      pendingList: false,
      cardClassify: false,
    })
    assert.deepEqual(plain(actions.equipmentFormActions(state)), {
      trackerLink: false,
      changeCode: false,
    })
    assert.deepEqual(plain(actions.equipmentListActions(state)), {
      create: false,
      edit: false,
      importRows: false,
    })
    assert.equal(actions.usersActions(state).manage, false)
    assert.equal(actions.canSeeIntegrationsStatus(state), false)
    assert.equal(actions.canViewEquipmentLocation(state), false)
  }
})

test('once ready the permissions decide; an empty role gets nothing', () => {
  // An admin profile whose (custom) role holds nothing gets nothing.
  const empty = ready([])
  const detail = actions.movementDetailActions(empty, ROWS[0])
  assert.deepEqual(plain(detail), NOTHING_DETAIL)
  assert.equal(actions.usersActions(empty).manage, false)
  assert.equal(actions.canSeeIntegrationsStatus(empty), false)
  assert.equal(actions.canViewEquipmentLocation(empty), false)
  assert.equal(homeScope.resolveHomeMovementsScope(empty), 'own_site')
})

// --- Custom roles ------------------------------------------------------------

test('custom role foreman_lead (0126 seed): its scopes widen the foreman', () => {
  const permissions = seededRole('foreman_lead')
  assert.ok(permissions.size > 5, 'the seed rows are parsed')
  const state = ready(permissions)
  const othersSiteEntry = {
    own: false,
    context: 'site',
    isEntry: true,
    visitOpen: true,
  }
  const othersWorkshopEntry = { ...othersSiteEntry, context: 'workshop' }
  const ownSiteEntry = { ...othersSiteEntry, own: true }

  const other = actions.movementDetailActions(state, othersSiteEntry)
  assert.equal(other.changeDriver, true) // driver_change scope all
  assert.equal(other.addPhotos, true) // photos.manage scope site
  assert.equal(other.editContractorCode, false) // own entries only
  assert.equal(other.editDelete, false)
  assert.equal(other.photoRemoval, 'own')
  assert.equal(
    actions.movementDetailActions(state, othersWorkshopEntry).addPhotos,
    false,
  )
  assert.equal(
    actions.movementDetailActions(state, ownSiteEntry).editContractorCode,
    true,
  )

  const form = actions.movementFormActions(state)
  assert.equal(form.workshopMode, false)
  assert.equal(form.exitAnyVisit, true) // site.create scope all
  assert.equal(form.notifyForeman, false)
  assert.equal(form.quickCreateEquipment, true) // scope site, site form
  assert.equal(form.quickCreateDriver, true)
  assert.equal(form.quickCreateLessor, true)

  // Owner 2026-10-28: its movements.read scope (site) is wider than its own
  // rows, so the foreman home embeds the log on «المشاريع».
  assert.deepEqual(homeNow(state), {
    scope: 'site_all',
    logClassify: false,
    pendingList: false,
    cardClassify: false,
  })
  assert.equal(actions.canViewEquipmentLocation(state), true)
  assert.equal(actions.canSeeIntegrationsStatus(state), false)
  assert.deepEqual(plain(actions.equipmentFormActions(state)), {
    trackerLink: false,
    changeCode: false,
  })
})

test('a custom workshop role with the classify key classifies on its own card', () => {
  const state = ready([
    ['home.workshop', 'workshop'],
    ['movements.workshop.create', 'all'],
    ['movements.workshop.classify', 'all'],
    ['movements.photos.manage', 'workshop'],
    ['equipment.quick_create', 'site'],
  ])
  assert.deepEqual(homeNow(state), {
    scope: 'workshop',
    logClassify: false,
    pendingList: true,
    cardClassify: true,
  })
  const form = actions.movementFormActions(state)
  assert.equal(form.workshopMode, true)
  // Its quick-create scope is the site's: no button in the workshop form.
  assert.equal(form.quickCreateEquipment, false)
  assert.equal(form.notifyForeman, false)
})

test('scopes are mirrored for display', () => {
  const site = { own: false, context: 'site' }
  const workshop = { own: false, context: 'workshop' }
  const own = { own: true, context: 'workshop' }
  assert.equal(actions.scopeAllowsMovement('all', workshop), true)
  assert.equal(actions.scopeAllowsMovement('own', site), false)
  assert.equal(actions.scopeAllowsMovement('own', own), true)
  assert.equal(actions.scopeAllowsMovement('site', site), true)
  assert.equal(actions.scopeAllowsMovement('site', workshop), false)
  assert.equal(actions.scopeAllowsMovement('companies', site), true)
  assert.equal(actions.scopeAllowsMovement('workshop', workshop), true)
  assert.equal(actions.scopeAllowsMovement('workshop', site), false)
  assert.equal(actions.scopeAllowsMovement(null, own), false)
  assert.equal(actions.scopeAllowsMovement(undefined, own), false)
})

// --- Sources -----------------------------------------------------------------

const SCREENS = {
  'src/screens/MovementDetail.tsx': 'movementDetailActions',
  'src/screens/HomeScreen.tsx': 'homeActions',
  'src/screens/AdminUsers.tsx': 'usersActions',
  'src/screens/UserDetail.tsx': 'usersActions',
  'src/screens/equipment/EquipmentFormDialog.tsx': 'equipmentFormActions',
  'src/screens/equipment/EquipmentListScreen.tsx': 'equipmentListActions',
  'src/screens/EquipmentDetail.tsx': 'equipmentListActions',
  'src/components/EntryExitForm.tsx': 'movementFormActions',
  'src/components/Layout.tsx': 'canSeeIntegrationsStatus',
  'src/components/WhatsAppGatewayStatus.tsx': 'canSeeIntegrationsStatus',
  'src/components/afaqy/EquipmentLocationCard.tsx': 'canViewEquipmentLocation',
  'src/components/admin-home/AfaqySection.tsx': 'canViewEquipmentLocation',
}

test('the screens decide through actionPermissions, never by comparing the role', () => {
  for (const [file, helper] of Object.entries(SCREENS)) {
    const source = read(...file.split('/'))
    assert.match(
      source,
      new RegExp(
        `import \\{[^}]*\\b${helper}\\b[^}]*\\} from '@/lib/actionPermissions'`,
      ),
      file,
    )
    assert.match(source, /usePermissions\(\)/, file)
    assert.doesNotMatch(source, /profile\??\.role\s*[!=]==?/, file)
    // A bare `role` compared to a legacy role (the EDITED user's `user.role`
    // on the user page is data, not the signed-in user's decision).
    assert.doesNotMatch(
      source,
      /(?<![\w.])role\s*[!=]==?\s*'(admin|supervisor|workshop|assistant_workshop_manager|workshop_manager|monitor)'/,
      file,
    )
    // Roles stage 4a: the signed-in user's role is not read at all, not
    // even as a fallback handed to the deciding helper.
    assert.doesNotMatch(source, /profile\??\.role\b/, file)
  }
})

test('the props-driven movement components read no role', () => {
  const dir = path.join(ROOT, 'src', 'components', 'movement')
  for (const name of fs.readdirSync(dir)) {
    const source = read('src', 'components', 'movement', name)
    assert.doesNotMatch(source, /useAuth\(\)/, name)
    assert.doesNotMatch(source, /\.role\s*[!=]==/, name)
  }
  const step = read('src', 'components', 'movement', 'EquipmentStep.tsx')
  assert.match(step, /exitAnyVisit: boolean/)
  assert.match(step, /siteExitMode && !exitAnyVisit/)
  assert.match(step, /isEntry && onAddEquipment &&/)
  const quick = read('src', 'components', 'movement', 'QuickEquipmentForm.tsx')
  assert.match(quick, /onCreateLessor\?: \(query: string\) => void/)
})

test('roles stage 4a: one switch, no legacy role rule left', () => {
  const lib = read('src', 'lib', 'actionPermissions.ts')
  assert.match(
    lib,
    /return state\.status === 'ready' \? state\.permissions : NOTHING_GRANTED/,
  )
  assert.match(lib, /return byPermissions\(grantedPermissions\(state\)\)/)
  assert.doesNotMatch(lib, /export function legacy\w+/)
  assert.doesNotMatch(lib, /\bbyRole\b|\bLegacyRole\b|\bisWorkshopRole\b/)
  const scope = read('src', 'lib', 'homeScope.ts')
  assert.doesNotMatch(scope, /export function homeMovementsScope\(/)
  assert.match(
    scope,
    /\? homeMovementsScopeFromPermissions\(state\.permissions\)\s+: 'own_site'/,
  )
  const gallery = read('src', 'lib', 'movementPhotoGallery.ts')
  assert.doesNotMatch(gallery, /viewer\.role/)
})

test('the movement form wires each decision', () => {
  const form = read('src', 'components', 'EntryExitForm.tsx')
  // 2026-10-28: the workshop home may force the workshop form
  // (`forceWorkshopForm`, tests/permissionFixes1028.test.cjs); otherwise the
  // decision of movementFormActions.
  assert.match(
    form,
    /const workshopMode = forcedWorkshopForm \|\| formActions\.workshopMode/,
  )
  assert.match(form, /const canNotifyForeman = formActions\.notifyForeman/)
  assert.match(form, /exitAnyVisit=\{formActions\.exitAnyVisit\}/)
  assert.match(
    form,
    /forcedWorkshopForm && !formActions\.workshopMode\s*\?[\s\S]*?: formActions\.quickCreateEquipment/,
  )
  assert.match(form, /quickCreateEquipment\s*\?\s*\(\) =>/)
  assert.match(form, /formActions\.quickCreateLessor\s*\?/)
  assert.match(form, /formActions\.quickCreateDriver\s*\?/)
})

test('the equipment form locks the code without equipment.change_code', () => {
  const dialog = read('src', 'screens', 'equipment', 'EquipmentFormDialog.tsx')
  assert.match(
    dialog,
    /const codeLocked = equipment !== null && !canChangeCode/,
  )
  assert.match(dialog, /readOnly=\{codeLocked\}/)
  assert.match(dialog, /\{canLinkTracker && \(/)
  assert.doesNotMatch(dialog, /\bisAdmin\b/)
})

test('the new copy exists in Arabic and English, without hamza', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...source.matchAll(
      /\/\/ wave-24-actions — start\n([\s\S]*?)\/\/ wave-24-actions — end/g,
    ),
  ].map((match) => match[1])
  assert.equal(blocks.length, 2)
  const keys = (block) =>
    [...block.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]).sort()
  assert.deepEqual(keys(blocks[0]), keys(blocks[1]))
  assert.ok(keys(blocks[0]).includes('equipmentCodeChangeNotAllowed'))
  assert.doesNotMatch(blocks[0], /[أإآ]/)
  // Each block sits right after the roles page block.
  assert.equal(
    (
      source.match(
        /\/\/ wave-24-roles-page — end\n\s*\/\/ wave-24-actions — start/g,
      ) ?? []
    ).length,
    2,
  )
})

test('equipment add / edit / import follow their own keys once ready', () => {
  const keys = (...names) => names.map((name) => [name, null])
  // The purchasing role of 2026-10-25 reads equipment without editing it:
  // no edit button, so no save the update policy silently refuses.
  assert.deepEqual(
    plain(
      actions.equipmentListActions(
        ready(keys('equipment.read', 'equipment.location.view')),
      ),
    ),
    { create: false, edit: false, importRows: false },
  )
  assert.deepEqual(
    plain(
      actions.equipmentListActions(
        ready(keys('equipment.read', 'equipment.edit')),
      ),
    ),
    { create: false, edit: true, importRows: false },
  )
  assert.deepEqual(
    plain(actions.equipmentListActions(ready(keys('equipment.create')))),
    { create: true, edit: false, importRows: false },
  )
})
