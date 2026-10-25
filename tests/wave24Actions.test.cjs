// wave 24 (actions by permissions) — the in-screen action and data decisions
// that used to compare `profiles.role` now read the permissions
// (src/lib/actionPermissions.ts, src/lib/homeScope.ts), with the role as the
// fallback ONLY while the permissions load or after a failed load.
//
// With the roles system OFF, current_permissions() answers from the frozen
// legacy_role_permissions(profiles.role) mapping, so for each of the six roles
// every decision must be IDENTICAL to the role rule it replaces. Those rules
// are transcribed below from the screens at d68a08d (`before*`), independent
// of the `legacy*` copies kept in actionPermissions.ts.
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

// The home as HomeScreen derives it now (no prop from App.tsx).
function homeNow(state, role) {
  const scope = homeScope.resolveHomeMovementsScope(state, role)
  const managerMode = scope === 'all_contexts'
  const workshopMode = scope === 'workshop' || managerMode
  const canClassify =
    workshopMode && actions.homeActions(state, role).classifyWorkshopEntries
  return {
    scope,
    logClassify: managerMode && canClassify,
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

// --- Roles system OFF: identical to the role rules ---------------------------

for (const role of ROLES) {
  test(`${role}: the movement detail decisions are unchanged`, () => {
    const state = legacyState(role)
    for (const row of ROWS) {
      const now = actions.movementDetailActions(state, role, row)
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
    // old viewer { userId, role } through canRemoveSavedPhoto.
    const removal = actions.movementDetailActions(
      state,
      role,
      ROWS[0],
    ).photoRemoval
    const viewer = actions.photoViewerFor(removal, ME)
    for (const photo of PHOTOS)
      assert.equal(
        gallery.canRemoveSavedPhoto(photo, viewer),
        gallery.canRemoveSavedPhoto(photo, { userId: ME, role }),
        JSON.stringify(photo),
      )
    assert.deepEqual(
      plain(actions.movementSkeletonShape(state, role)),
      beforeSkeleton(role),
    )
  })

  test(`${role}: the movement form decisions are unchanged`, () => {
    const state = legacyState(role)
    const now = actions.movementFormActions(state, role)
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
    assert.deepEqual(homeNow(legacyState(role), role), beforeHome(role))
    // App.tsx's scope (planShell) and the home's own agree.
    const plan = nav.planShell(legacyState(role), role)
    if (plan.homeScope)
      assert.equal(
        plan.homeScope,
        homeScope.resolveHomeMovementsScope(legacyState(role), role),
      )
  })

  test(`${role}: the admin-only cards and fields are unchanged`, () => {
    const state = legacyState(role)
    const expected = beforeAdminOnly(role)
    assert.deepEqual(plain(actions.equipmentFormActions(state, role)), {
      trackerLink: expected,
      changeCode: expected,
    })
    assert.deepEqual(plain(actions.equipmentListActions(state, role)), {
      create: expected,
      edit: expected,
      importRows: expected,
    })
    assert.deepEqual(plain(actions.usersActions(state, role)), {
      manage: expected,
    })
    assert.equal(actions.canSeeIntegrationsStatus(state, role), expected)
    assert.equal(actions.canViewEquipmentLocation(state, role), expected)
  })
}

// --- Loading / failed load: the role rule, exactly today's behaviour --------

test('while loading or after a failed load the role decides', () => {
  for (const state of [LOADING, FAILED])
    for (const role of [...ROLES, null, undefined, 'unknown_role']) {
      for (const row of ROWS)
        assert.deepEqual(
          pick(actions.movementDetailActions(state, role, row), [
            'editDelete',
            'changeDriver',
            'editContractorCode',
            'addPhotos',
          ]),
          beforeMovementDetail(role, row),
        )
      const removal = actions.movementDetailActions(
        state,
        role,
        ROWS[0],
      ).photoRemoval
      for (const photo of PHOTOS)
        assert.equal(
          gallery.canRemoveSavedPhoto(
            photo,
            actions.photoViewerFor(removal, ME),
          ),
          gallery.canRemoveSavedPhoto(photo, { userId: ME, role }),
        )
      assert.deepEqual(
        plain(actions.movementSkeletonShape(state, role)),
        beforeSkeleton(role),
      )
      const form = actions.movementFormActions(state, role)
      assert.deepEqual(
        pick(form, ['workshopMode', 'exitAnyVisit', 'notifyForeman']),
        beforeForm(role),
      )
      assert.equal(form.quickCreateEquipment, true)
      assert.equal(form.quickCreateDriver, true)
      assert.equal(form.quickCreateLessor, true)
      assert.deepEqual(homeNow(state, role), beforeHome(role))
      const adminOnly = beforeAdminOnly(role)
      assert.deepEqual(plain(actions.equipmentFormActions(state, role)), {
        trackerLink: adminOnly,
        changeCode: adminOnly,
      })
      assert.deepEqual(plain(actions.equipmentListActions(state, role)), {
        create: adminOnly,
        edit: adminOnly,
        importRows: adminOnly,
      })
      assert.equal(actions.usersActions(state, role).manage, adminOnly)
      assert.equal(actions.canSeeIntegrationsStatus(state, role), adminOnly)
      assert.equal(actions.canViewEquipmentLocation(state, role), adminOnly)
    }
})

test('once ready the permissions decide, whatever the legacy role says', () => {
  // An admin profile whose (custom) role holds nothing gets nothing.
  const empty = ready([])
  const detail = actions.movementDetailActions(empty, 'admin', ROWS[0])
  assert.deepEqual(plain(detail), {
    editDelete: false,
    changeDriver: false,
    editContractorCode: false,
    addPhotos: false,
    photoRemoval: 'none',
  })
  assert.equal(actions.usersActions(empty, 'admin').manage, false)
  assert.equal(actions.canSeeIntegrationsStatus(empty, 'admin'), false)
  assert.equal(actions.canViewEquipmentLocation(empty, 'admin'), false)
  assert.equal(
    homeScope.resolveHomeMovementsScope(empty, 'workshop_manager'),
    'own_site',
  )
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

  const other = actions.movementDetailActions(
    state,
    'supervisor',
    othersSiteEntry,
  )
  assert.equal(other.changeDriver, true) // driver_change scope all
  assert.equal(other.addPhotos, true) // photos.manage scope site
  assert.equal(other.editContractorCode, false) // own entries only
  assert.equal(other.editDelete, false)
  assert.equal(other.photoRemoval, 'own')
  assert.equal(
    actions.movementDetailActions(state, 'supervisor', othersWorkshopEntry)
      .addPhotos,
    false,
  )
  assert.equal(
    actions.movementDetailActions(state, 'supervisor', ownSiteEntry)
      .editContractorCode,
    true,
  )

  const form = actions.movementFormActions(state, 'supervisor')
  assert.equal(form.workshopMode, false)
  assert.equal(form.exitAnyVisit, true) // site.create scope all
  assert.equal(form.notifyForeman, false)
  assert.equal(form.quickCreateEquipment, true) // scope site, site form
  assert.equal(form.quickCreateDriver, true)
  assert.equal(form.quickCreateLessor, true)

  assert.deepEqual(homeNow(state, 'supervisor'), {
    scope: 'own_site',
    logClassify: false,
    pendingList: false,
    cardClassify: false,
  })
  assert.equal(actions.canViewEquipmentLocation(state, 'supervisor'), true)
  assert.equal(actions.canSeeIntegrationsStatus(state, 'supervisor'), false)
  assert.deepEqual(plain(actions.equipmentFormActions(state, 'supervisor')), {
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
  assert.deepEqual(homeNow(state, 'workshop'), {
    scope: 'workshop',
    logClassify: false,
    pendingList: true,
    cardClassify: true,
  })
  const form = actions.movementFormActions(state, 'workshop')
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
  'src/components/EntryExitForm.tsx': 'movementFormActions',
  'src/components/Layout.tsx': 'canSeeIntegrationsStatus',
  'src/components/WhatsAppGatewayStatus.tsx': 'canSeeIntegrationsStatus',
  'src/components/afaqy/EquipmentLocationCard.tsx': 'canViewEquipmentLocation',
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
    // The role is only handed to the deciding helper as its fallback.
    for (const match of source.matchAll(/profile\??\.role/g)) {
      const line = source.slice(
        source.lastIndexOf('\n', match.index) + 1,
        source.indexOf('\n', match.index),
      )
      assert.match(
        line,
        /(Actions|Shape|Scope|canSee\w+|canView\w+|legacyRoleLabelKey)\(\s*(permissionState|usePermissions\(\))?,?\s*profile\?\.role/,
        `${file}: ${line.trim()}`,
      )
    }
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

test('the legacy rules are read only through the fallback switch', () => {
  const lib = read('src', 'lib', 'actionPermissions.ts')
  assert.match(
    lib,
    /return state\.status === 'ready'\s+\? byPermissions\(state\.permissions\)\s+: byRole\(role\)/,
  )
  const legacyNames = [...lib.matchAll(/export function (legacy\w+)/g)].map(
    (match) => match[1],
  )
  assert.ok(legacyNames.length >= 4)
  const sources = Object.keys(SCREENS).map((file) => read(...file.split('/')))
  for (const name of legacyNames)
    for (const source of sources) assert.ok(!source.includes(name), name)
})

test('the movement form wires each decision', () => {
  const form = read('src', 'components', 'EntryExitForm.tsx')
  assert.match(form, /const workshopMode = formActions\.workshopMode/)
  assert.match(form, /const canNotifyForeman = formActions\.notifyForeman/)
  assert.match(form, /exitAnyVisit=\{formActions\.exitAnyVisit\}/)
  assert.match(form, /formActions\.quickCreateEquipment\s*\?/)
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
        'monitor',
      ),
    ),
    { create: false, edit: false, importRows: false },
  )
  assert.deepEqual(
    plain(
      actions.equipmentListActions(
        ready(keys('equipment.read', 'equipment.edit')),
        'monitor',
      ),
    ),
    { create: false, edit: true, importRows: false },
  )
  assert.deepEqual(
    plain(actions.equipmentListActions(ready(keys('equipment.create')), 'admin')),
    { create: true, edit: false, importRows: false },
  )
})
