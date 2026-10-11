// Wave 22A (migration 0127): every policy and function moved from role names
// to permission keys, as data. tests/wave22Roles.test.cjs reads it to check
// that 0127 is each latest definition verbatim plus exactly these
// replacements, and that every replacement is equivalent for the six legacy
// roles under the frozen mapping of 0126 (legacy_role_permissions).
//
// `equivalence` lists, per decision the replacement touches, the OLD
// behaviour per legacy role (hand-transcribed from the old predicate) and the
// NEW behaviour computed from the mapping (`p.has(key)`, `p.scope(key)`;
// scope is 'all' for a granted unscoped key and null when not granted).

const WORKSHOP_ROLES = [
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
]
const ALL_ROLES = ['admin', 'supervisor', ...WORKSHOP_ROLES, 'monitor']
const among = (roles) => (role) => roles.includes(role)

/** A boolean gate: the same roles pass before and after. */
const gate = (label, roles, check) => ({ label, old: among(roles), new: check })

/** Movement row classes of a scope with the user's own rows always in. */
const rowClass = (scope, none) => (scope == null ? none : scope)

// --- Functions --------------------------------------------------------------

const ADMIN_HOME_FROM =
  "  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN"
const ADMIN_HOME_TO = "  IF NOT public.has_permission('home.admin') THEN"
const adminHome = (name, signature, source) => ({
  name,
  signature,
  source,
  callable: true,
  keys: ['home.admin'],
  replacements: [[ADMIN_HOME_FROM, ADMIN_HOME_TO]],
  equivalence: [
    gate('admin or monitor', ['admin', 'monitor'], (p) => p.has('home.admin')),
  ],
})

const FUNCTION_REWRITES = [
  {
    name: 'can_access_movement',
    signature: 'uuid',
    source: '0098',
    callable: true,
    keys: ['movements.read'],
    replacements: [
      [
        `        l.supervisor_id = auth.uid()
        OR public.is_admin()
        OR public.current_user_role() = 'monitor'
        OR public.current_user_role() IN (
          'workshop', 'assistant_workshop_manager', 'workshop_manager'
        )`,
        `        l.supervisor_id = auth.uid()
        OR public.movement_scope_allows(
          public.permission_scope('movements.read'),
          l.supervisor_id,
          l.movement_context,
          l.company_id
        )`,
      ],
    ],
    equivalence: [
      {
        label: 'rows readable (own always)',
        old: (role) =>
          ['admin', 'monitor', ...WORKSHOP_ROLES].includes(role)
            ? 'all'
            : 'own',
        new: (p) => rowClass(p.scope('movements.read'), 'own'),
      },
    ],
  },
  {
    name: 'can_write_movement_photos',
    signature: 'uuid',
    source: '0109',
    callable: true,
    keys: ['movements.photos.manage'],
    replacements: [
      [
        `      AND (
        me.role = 'admin'
        OR (
          me.role IN ('supervisor', 'workshop', 'assistant_workshop_manager', 'workshop_manager')
          AND l.supervisor_id = auth.uid()
        )
        OR (
          me.role IN ('workshop', 'assistant_workshop_manager', 'workshop_manager')
          AND l.movement_context = 'workshop'
        )
      )`,
        `      AND public.movement_scope_allows(
        public.permission_scope('movements.photos.manage'),
        l.supervisor_id,
        l.movement_context,
        l.company_id
      )`,
      ],
    ],
    equivalence: [
      {
        label: 'movements whose photos may be written',
        old: (role) =>
          role === 'admin'
            ? 'all'
            : role === 'supervisor'
              ? 'own'
              : WORKSHOP_ROLES.includes(role)
                ? 'workshop'
                : 'none',
        new: (p) => rowClass(p.scope('movements.photos.manage'), 'none'),
      },
    ],
  },
  {
    name: 'enforce_movement_sequence',
    signature: '',
    source: '0125',
    callable: false,
    keys: [
      'movements.workshop.create',
      'movements.site.create',
      'movements.import',
      'movements.exit_cross_context',
    ],
    replacements: [
      [
        `    IF v_role IS NULL
       OR v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager') THEN
      RAISE EXCEPTION 'workshop role required';`,
        `    IF NOT public.has_permission('movements.workshop.create') THEN
      RAISE EXCEPTION 'workshop role required';`,
      ],
      [
        `    IF v_role IS NULL OR v_role NOT IN ('admin', 'supervisor') THEN
      RAISE EXCEPTION 'foreman role required';`,
        `    IF NOT public.has_permission('movements.site.create') THEN
      RAISE EXCEPTION 'foreman role required';`,
      ],
      [
        `        IF current_setting('app.movement_excel_import', true) = 'true'
           AND v_role = 'admin' THEN`,
        `        IF current_setting('app.movement_excel_import', true) = 'true'
           AND public.has_permission('movements.import') THEN`,
      ],
      [
        `    IF NOT public.is_admin() THEN
      IF NEW.movement_context = 'site' THEN`,
        `    IF NOT public.has_permission('movements.exit_cross_context') THEN
      IF NEW.movement_context = 'site' THEN`,
      ],
      [
        `        IF v_last_entry.supervisor_id IS DISTINCT FROM auth.uid() THEN`,
        `        IF public.movement_scope_allows(
             public.permission_scope('movements.site.create'),
             v_last_entry.supervisor_id,
             v_last_entry.movement_context,
             v_last_entry.company_id
           ) IS NOT TRUE THEN`,
      ],
    ],
    equivalence: [
      gate('workshop movement', ['admin', ...WORKSHOP_ROLES], (p) =>
        p.has('movements.workshop.create'),
      ),
      gate('site movement', ['admin', 'supervisor'], (p) =>
        p.has('movements.site.create'),
      ),
      gate('Excel import driver-name exemption', ['admin'], (p) =>
        p.has('movements.import'),
      ),
      gate('exempt from the exit context/owner rules', ['admin'], (p) =>
        p.has('movements.exit_cross_context'),
      ),
      {
        // Reached only by a site recorder without the exemption.
        label: 'site exit closes which entries',
        roles: ['supervisor'],
        old: () => 'own',
        new: (p) => rowClass(p.scope('movements.site.create'), 'none'),
      },
    ],
  },
  {
    name: 'change_active_movement_driver',
    signature: 'uuid, uuid, text',
    source: '0108',
    callable: true,
    keys: ['movements.site.driver_change'],
    replacements: [
      [
        `  v_allowed := FOUND AND (
    v_role = 'admin'
    OR (v_role = 'supervisor' AND v_entry.supervisor_id = auth.uid())
  );`,
        `  v_allowed := FOUND AND public.movement_scope_allows(
    public.permission_scope('movements.site.driver_change'),
    v_entry.supervisor_id,
    v_entry.movement_context,
    v_entry.company_id
  );`,
      ],
    ],
    equivalence: [
      {
        label: 'entries whose driver may change',
        old: (role) =>
          role === 'admin' ? 'all' : role === 'supervisor' ? 'own' : 'none',
        new: (p) => rowClass(p.scope('movements.site.driver_change'), 'none'),
      },
    ],
  },
  {
    name: 'update_entry_contractor_code',
    signature: 'uuid, text',
    source: '0093',
    callable: true,
    keys: ['movements.site.contractor_code'],
    replacements: [
      [
        `  IF v_role IS DISTINCT FROM 'supervisor' THEN`,
        `  IF NOT public.has_permission('movements.site.contractor_code') THEN`,
      ],
    ],
    equivalence: [
      gate('foreman only', ['supervisor'], (p) =>
        p.has('movements.site.contractor_code'),
      ),
    ],
  },
  {
    name: 'classify_workshop_entry',
    signature: 'uuid, text',
    source: '0125',
    callable: true,
    keys: ['movements.workshop.classify'],
    replacements: [
      [
        `  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'workshop_manager', 'assistant_workshop_manager') THEN
    RAISE EXCEPTION 'workshop manager required';`,
        `  IF NOT public.has_permission('movements.workshop.classify') THEN
    RAISE EXCEPTION 'workshop manager required';`,
      ],
    ],
    equivalence: [
      gate(
        'classify',
        ['admin', 'workshop_manager', 'assistant_workshop_manager'],
        (p) => p.has('movements.workshop.classify'),
      ),
    ],
  },
  {
    name: 'request_workshop_arrival_notice',
    signature: 'uuid',
    source: '0110',
    callable: true,
    keys: ['movements.notify_foreman'],
    replacements: [
      [
        `  IF auth.uid() IS NULL
     OR v_role IS NULL
     OR v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager') THEN`,
        `  IF auth.uid() IS NULL
     OR NOT public.has_permission('movements.notify_foreman') THEN`,
      ],
    ],
    equivalence: [
      gate('notify the foreman', ['admin', ...WORKSHOP_ROLES], (p) =>
        p.has('movements.notify_foreman'),
      ),
    ],
  },
  {
    name: 'prepare_movement_exit_notice',
    signature: 'uuid',
    source: '0110',
    callable: true,
    keys: ['movements.edit_delete'],
    replacements: [
      [
        `    AND (v_role = 'admin' OR v_log.supervisor_id = auth.uid());`,
        `    AND (public.has_permission('movements.edit_delete') OR v_log.supervisor_id = auth.uid());`,
      ],
    ],
    equivalence: [
      gate("any recorder's exit", ['admin'], (p) =>
        p.has('movements.edit_delete'),
      ),
    ],
  },
  ...[
    [
      'admin_update_movement',
      'uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text',
    ],
    ['admin_delete_movement', 'uuid'],
  ].map(([name, signature]) => ({
    name,
    signature,
    source: '0108',
    callable: true,
    keys: ['movements.edit_delete'],
    replacements: [
      [
        '  IF auth.uid() IS NULL OR NOT public.is_admin() THEN',
        "  IF auth.uid() IS NULL OR NOT public.has_permission('movements.edit_delete') THEN",
      ],
    ],
    equivalence: [
      gate('admin only', ['admin'], (p) => p.has('movements.edit_delete')),
    ],
  })),
  ...['prepare_movement_import', 'import_movement_rows'].map((name) => ({
    name,
    signature: 'jsonb',
    source: '0063',
    callable: true,
    keys: ['movements.import'],
    replacements: [
      [
        '  IF NOT public.is_admin() THEN',
        "  IF NOT public.has_permission('movements.import') THEN",
      ],
    ],
    equivalence: [
      gate('admin only', ['admin'], (p) => p.has('movements.import')),
    ],
  })),
  ...[
    ['search_workshop_opening_candidates', 'text'],
    ['add_workshop_opening_balance', 'uuid'],
  ].map(([name, signature]) => ({
    name,
    signature,
    source: '0041',
    callable: true,
    keys: ['movements.import'],
    replacements: [
      [
        "  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin required'; END IF;",
        "  IF NOT public.has_permission('movements.import') THEN RAISE EXCEPTION 'admin required'; END IF;",
      ],
    ],
    equivalence: [
      gate('admin only', ['admin'], (p) => p.has('movements.import')),
    ],
  })),
  {
    name: 'enforce_site_exit_purpose',
    signature: '',
    source: '0115',
    callable: false,
    keys: ['movements.import'],
    replacements: [
      [
        `    IF current_setting('app.movement_excel_import', true) = 'true'
       AND v_role = 'admin' THEN`,
        `    IF current_setting('app.movement_excel_import', true) = 'true'
       AND public.has_permission('movements.import') THEN`,
      ],
    ],
    equivalence: [
      gate('Excel import exemption', ['admin'], (p) =>
        p.has('movements.import'),
      ),
    ],
  },
  {
    name: 'enforce_site_entry_driver',
    signature: '',
    source: '0120',
    callable: false,
    keys: ['movements.import'],
    replacements: [
      [
        `  IF current_setting('app.movement_excel_import', true) = 'true'
     AND v_role = 'admin' THEN`,
        `  IF current_setting('app.movement_excel_import', true) = 'true'
     AND public.has_permission('movements.import') THEN`,
      ],
    ],
    equivalence: [
      gate('Excel import exemption', ['admin'], (p) =>
        p.has('movements.import'),
      ),
    ],
  },
  {
    name: 'search_entry_equipment',
    signature: 'text, text, text',
    source: '0116',
    callable: true,
    keys: ['movements.site.create'],
    replacements: [
      [
        `  IF v_role IS NULL OR v_role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION 'foreman role required';`,
        `  IF NOT public.has_permission('movements.site.create') THEN
    RAISE EXCEPTION 'foreman role required';`,
      ],
    ],
    equivalence: [
      gate('site recorder', ['admin', 'supervisor'], (p) =>
        p.has('movements.site.create'),
      ),
    ],
  },
  {
    name: 'search_site_exit_equipment',
    signature: 'text, text, text',
    source: '0116',
    callable: true,
    keys: ['movements.site.create', 'movements.exit_cross_context'],
    replacements: [
      [
        `  IF v_role IS NULL OR v_role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION 'foreman role required';`,
        `  IF NOT public.has_permission('movements.site.create') THEN
    RAISE EXCEPTION 'foreman role required';`,
      ],
      [
        `  v_is_admin := v_role = 'admin';`,
        `  v_is_admin := public.has_permission('movements.exit_cross_context')
    OR public.permission_scope('movements.site.create') = 'all';`,
      ],
    ],
    equivalence: [
      gate('site recorder', ['admin', 'supervisor'], (p) =>
        p.has('movements.site.create'),
      ),
      gate(
        'lists every open site visit',
        ['admin'],
        (p) =>
          p.has('movements.exit_cross_context') ||
          p.scope('movements.site.create') === 'all',
      ),
    ],
  },
  {
    name: 'search_workshop_equipment',
    signature: 'text, text, text',
    source: '0116',
    callable: true,
    keys: ['movements.workshop.create'],
    replacements: [
      [
        `  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager') THEN
    RAISE EXCEPTION 'workshop role required';`,
        `  IF NOT public.has_permission('movements.workshop.create') THEN
    RAISE EXCEPTION 'workshop role required';`,
      ],
    ],
    equivalence: [
      gate('workshop recorder', ['admin', ...WORKSHOP_ROLES], (p) =>
        p.has('movements.workshop.create'),
      ),
    ],
  },
  {
    name: 'get_last_movement',
    signature: 'uuid, text',
    source: '0109',
    callable: true,
    keys: [
      'movements.read',
      'movements.site.create',
      'movements.workshop.create',
    ],
    replacements: [
      [
        `  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'supervisor', 'workshop', 'assistant_workshop_manager', 'workshop_manager', 'monitor') THEN
    RAISE EXCEPTION 'authenticated role required';`,
        `  IF NOT (
    public.has_permission('movements.read')
    OR public.has_permission('movements.site.create')
    OR public.has_permission('movements.workshop.create')
  ) THEN
    RAISE EXCEPTION 'authenticated role required';`,
      ],
    ],
    equivalence: [
      gate(
        'any known role',
        ALL_ROLES,
        (p) =>
          p.has('movements.read') ||
          p.has('movements.site.create') ||
          p.has('movements.workshop.create'),
      ),
    ],
  },
  {
    name: 'quick_create_foreman_equipment',
    signature: 'text, text, text, uuid',
    source: '0109',
    callable: true,
    keys: ['equipment.quick_create'],
    replacements: [
      [
        `  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'supervisor')
     OR (v_plate IS NULL AND v_chassis IS NULL)`,
        `  IF COALESCE(public.permission_scope('equipment.quick_create'), '') NOT IN ('all', 'site')
     OR (v_plate IS NULL AND v_chassis IS NULL)`,
      ],
    ],
    equivalence: [
      gate('project form quick create', ['admin', 'supervisor'], (p) =>
        ['all', 'site'].includes(p.scope('equipment.quick_create')),
      ),
    ],
  },
  {
    name: 'quick_create_workshop_equipment',
    signature: 'text, text, text',
    source: '0109',
    callable: true,
    keys: ['equipment.quick_create'],
    replacements: [
      [
        `  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager')
     OR p_numbering_status NOT IN ('numbered', 'unnumbered')`,
        `  IF COALESCE(public.permission_scope('equipment.quick_create'), '') NOT IN ('all', 'workshop')
     OR p_numbering_status NOT IN ('numbered', 'unnumbered')`,
      ],
    ],
    equivalence: [
      gate('workshop form quick create', ['admin', ...WORKSHOP_ROLES], (p) =>
        ['all', 'workshop'].includes(p.scope('equipment.quick_create')),
      ),
    ],
  },
  {
    name: 'quick_create_lessor_by_name',
    signature: 'text',
    source: '0109',
    callable: true,
    keys: ['lessors.quick_create'],
    replacements: [
      [
        `  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'supervisor')
     OR v_name = ''`,
        `  IF NOT public.has_permission('lessors.quick_create')
     OR v_name = ''`,
      ],
    ],
    equivalence: [
      gate('quick supplier', ['admin', 'supervisor'], (p) =>
        p.has('lessors.quick_create'),
      ),
    ],
  },
  {
    name: 'quick_create_driver',
    signature: 'text, text, uuid',
    source: '0119',
    callable: true,
    keys: ['drivers.quick_create'],
    replacements: [
      [
        `  IF auth.uid() IS NULL
     OR v_role IS NULL
     OR v_role NOT IN ('admin', 'supervisor') THEN`,
        `  IF auth.uid() IS NULL
     OR NOT public.has_permission('drivers.quick_create') THEN`,
      ],
    ],
    equivalence: [
      gate('quick driver', ['admin', 'supervisor'], (p) =>
        p.has('drivers.quick_create'),
      ),
    ],
  },
  {
    name: 'update_equipment_from_excel',
    signature: 'jsonb',
    source: '0125',
    callable: true,
    keys: ['equipment.import'],
    replacements: [
      [
        '  IF auth.uid() IS NULL OR NOT public.is_admin() THEN',
        "  IF auth.uid() IS NULL OR NOT public.has_permission('equipment.import') THEN",
      ],
    ],
    equivalence: [
      gate('admin only', ['admin'], (p) => p.has('equipment.import')),
    ],
  },
  {
    name: 'admin_change_equipment_code',
    signature: 'uuid, text, text',
    source: '0114',
    callable: true,
    keys: ['equipment.change_code'],
    replacements: [
      [
        '  IF auth.uid() IS NULL OR NOT public.is_admin() THEN',
        "  IF auth.uid() IS NULL OR NOT public.has_permission('equipment.change_code') THEN",
      ],
    ],
    equivalence: [
      gate('admin only', ['admin'], (p) => p.has('equipment.change_code')),
    ],
  },
  {
    name: 'get_equipment_attention_report',
    signature: 'integer, integer, text, text[]',
    source: '0102',
    callable: true,
    keys: ['reports.view', 'movements.read'],
    replacements: [
      [
        '  IF auth.uid() IS NULL OR NOT public.is_admin() THEN',
        `  IF auth.uid() IS NULL
     OR public.permission_scope('reports.view') IS DISTINCT FROM 'all'
     OR public.permission_scope('movements.read') IS DISTINCT FROM 'all' THEN`,
      ],
    ],
    equivalence: [
      gate(
        'admin only',
        ['admin'],
        (p) =>
          p.scope('reports.view') === 'all' &&
          p.scope('movements.read') === 'all',
      ),
    ],
  },
  {
    name: 'get_all_equipment_last_movement',
    signature: '',
    source: '0027',
    callable: true,
    keys: ['equipment.read', 'movements.read'],
    replacements: [
      [
        '  WHERE public.is_admin()',
        `  WHERE public.has_permission('equipment.read')
    AND public.permission_scope('movements.read') = 'all'`,
      ],
    ],
    equivalence: [
      gate(
        'admin only',
        ['admin'],
        (p) => p.has('equipment.read') && p.scope('movements.read') === 'all',
      ),
    ],
  },
  adminHome('get_admin_foreman_discipline', 'timestamptz, timestamptz', '0094'),
  adminHome(
    'get_admin_entries_series',
    'timestamptz, timestamptz, text[], text',
    '0095',
  ),
  adminHome('get_admin_entries_yearly', 'integer, text[], text', '0095'),
  adminHome('get_admin_foreman_recent_movements', 'integer', '0095'),
  adminHome('get_admin_owner_state_matrix', 'text[]', '0102'),
  adminHome('get_admin_fleet_state', 'text[]', '0125'),
  adminHome(
    'get_admin_availability_by_type',
    'text[], text, integer, integer',
    '0125',
  ),
  adminHome(
    'get_admin_fleet_equipment',
    'text, text[], text, integer, integer, text',
    '0125',
  ),
  {
    name: 'admin_set_user_mobile',
    signature: 'uuid, text',
    source: '0113',
    callable: true,
    keys: ['users.manage'],
    replacements: [
      [
        '  IF auth.uid() IS NULL OR public.is_admin() IS NOT TRUE THEN',
        "  IF auth.uid() IS NULL OR public.has_permission('users.manage') IS NOT TRUE THEN",
      ],
    ],
    equivalence: [gate('admin only', ['admin'], (p) => p.has('users.manage'))],
  },
  {
    name: 'admin_set_user_role',
    signature: 'uuid, text',
    source: '0079',
    callable: true,
    keys: ['users.manage'],
    replacements: [
      [
        '  IF NOT public.is_admin() THEN',
        "  IF NOT public.has_permission('users.manage') THEN",
      ],
      [
        `
  UPDATE public.profiles
  SET role = p_role`,
        `
  IF public.roles_system_enabled() THEN
    RAISE EXCEPTION 'roles_system_active_use_assignment'
      USING ERRCODE = '55000',
            HINT = 'The roles system is active: change the user''s role assignment instead of the account role.';
  END IF;

  UPDATE public.profiles
  SET role = p_role`,
      ],
    ],
    equivalence: [
      gate('admin only', ['admin'], (p) => p.has('users.manage')),
      {
        // The new refusal only exists while the flag is on.
        label: 'no new refusal while the roles system is inactive',
        old: () => false,
        new: () => false,
      },
    ],
  },
]

// --- Policies ---------------------------------------------------------------
// `using` / `check` are the new predicates as written in 0127. `atoms` are
// the replacements that turn the OLD predicate into the new one (compared
// with all whitespace removed); `count` is how often an atom occurs.

const hasKey = (key) => `(SELECT public.has_permission('${key}'))`
const IS_ADMIN = 'public.is_admin()'
const NOT_MONITOR = "public.current_user_role() <> 'monitor'"

/** A master-data policy whose only role test is is_admin(). */
const adminPolicy = (table, name, cmd, source, key) => {
  const usesUsing = cmd !== 'INSERT'
  const usesCheck = cmd === 'INSERT' || cmd === 'UPDATE'
  return {
    table,
    name,
    cmd,
    source,
    keys: [key],
    using: usesUsing ? hasKey(key) : null,
    check: usesCheck ? hasKey(key) : null,
    atoms: [[IS_ADMIN, hasKey(key)]],
    equivalence: [gate('admin only', ['admin'], (p) => p.has(key))],
  }
}

const crud = (table, source, keys, names = {}) => [
  adminPolicy(
    table,
    names.insert ?? `insert_${table}`,
    'INSERT',
    source,
    keys.insert,
  ),
  adminPolicy(
    table,
    names.update ?? `update_${table}`,
    'UPDATE',
    source,
    keys.update,
  ),
  adminPolicy(
    table,
    names.delete ?? `delete_${table}`,
    'DELETE',
    source,
    keys.delete,
  ),
]

const same = (key) => ({ insert: key, update: key, delete: key })

const PHOTO_WRITE_EQUIVALENCE = [
  gate('not monitor', ['admin', 'supervisor', ...WORKSHOP_ROLES], (p) =>
    p.has('movements.photos.manage'),
  ),
]
const PHOTO_ANY_EQUIVALENCE = [
  ...PHOTO_WRITE_EQUIVALENCE,
  gate("anyone's photo", ['admin'], (p) =>
    p.has('movements.photos.delete_any'),
  ),
]

const MOVEMENT_READ_CASE = `CASE (SELECT public.permission_scope('movements.read'))
    WHEN 'all' THEN true
    WHEN 'site' THEN movement_context = 'site'
    WHEN 'workshop' THEN movement_context = 'workshop'
    WHEN 'companies' THEN
      movement_context = 'site'
      AND company_id IN (
        SELECT pc.company_id
        FROM public.profile_companies pc
        WHERE pc.profile_id = auth.uid()
      )
    ELSE false
  END`

const POLICY_REWRITES = [
  {
    table: 'public.entry_exit_logs',
    name: 'select_entry_exit_logs',
    cmd: 'SELECT',
    source: '0098',
    keys: ['movements.read'],
    using: `supervisor_id = auth.uid()
  OR ${MOVEMENT_READ_CASE}`,
    check: null,
    atoms: [
      [
        `public.is_admin()
    OR public.current_user_role() = 'monitor'
    OR public.current_user_role() IN (
      'workshop', 'assistant_workshop_manager', 'workshop_manager'
    )`,
        MOVEMENT_READ_CASE,
      ],
    ],
    equivalence: [
      {
        label: 'rows readable (own always)',
        old: (role) =>
          ['admin', 'monitor', ...WORKSHOP_ROLES].includes(role)
            ? 'all'
            : 'own',
        new: (p) => rowClass(p.scope('movements.read'), 'own'),
      },
    ],
  },
  {
    table: 'public.entry_exit_logs',
    name: 'insert_entry_exit_logs',
    cmd: 'INSERT',
    source: '0004',
    keys: ['movements.edit_delete'],
    using: null,
    check: `supervisor_id = auth.uid() OR ${hasKey('movements.edit_delete')}`,
    atoms: [[IS_ADMIN, hasKey('movements.edit_delete')]],
    equivalence: [
      gate("in another user's name", ['admin'], (p) =>
        p.has('movements.edit_delete'),
      ),
    ],
  },
  {
    table: 'public.entry_exit_photos',
    name: 'insert_entry_exit_photos',
    cmd: 'INSERT',
    source: '0109',
    keys: ['movements.photos.manage'],
    using: null,
    check: `${hasKey('movements.photos.manage')}
  AND uploaded_by = auth.uid()
  AND public.can_write_movement_photos(entry_exit_log_id)`,
    atoms: [[NOT_MONITOR, hasKey('movements.photos.manage')]],
    equivalence: PHOTO_WRITE_EQUIVALENCE,
  },
  ...['update', 'delete'].map((verb) => {
    const predicate = `${hasKey('movements.photos.manage')}
  AND public.can_access_movement(entry_exit_log_id)
  AND (uploaded_by = auth.uid() OR ${hasKey('movements.photos.delete_any')})`
    return {
      table: 'public.entry_exit_photos',
      name: `${verb}_entry_exit_photos`,
      cmd: verb.toUpperCase(),
      source: '0072',
      keys: ['movements.photos.manage', 'movements.photos.delete_any'],
      using: predicate,
      check: verb === 'update' ? predicate : null,
      atoms: [
        [NOT_MONITOR, hasKey('movements.photos.manage')],
        [IS_ADMIN, hasKey('movements.photos.delete_any')],
      ],
      equivalence: PHOTO_ANY_EQUIVALENCE,
    }
  }),
  {
    table: 'storage.objects',
    name: 'insert_log_photos',
    cmd: 'INSERT',
    source: '0109',
    keys: ['movements.photos.manage'],
    using: null,
    check: `bucket_id = 'log-photos'
  AND ${hasKey('movements.photos.manage')}
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    public.can_write_movement_photos(public.safe_uuid(split_part(name, '/', 2)))
    OR EXISTS (
      SELECT 1
      FROM public.pending_movement_photo_batches pending
      WHERE pending.id = public.safe_uuid(split_part(name, '/', 2))
        AND pending.uploaded_by = auth.uid()
        AND pending.expires_at > now()
        AND name = ANY(pending.file_paths)
    )
  )`,
    atoms: [[NOT_MONITOR, hasKey('movements.photos.manage')]],
    equivalence: PHOTO_WRITE_EQUIVALENCE,
  },
  (() => {
    const predicate = `bucket_id = 'log-photos'
  AND ${hasKey('movements.photos.manage')}
  AND ((storage.foldername(name))[1] = auth.uid()::text OR ${hasKey('movements.photos.delete_any')})`
    return {
      table: 'storage.objects',
      name: 'update_log_photos',
      cmd: 'UPDATE',
      source: '0072',
      keys: ['movements.photos.manage', 'movements.photos.delete_any'],
      using: predicate,
      check: predicate,
      atoms: [
        [NOT_MONITOR, hasKey('movements.photos.manage')],
        [IS_ADMIN, hasKey('movements.photos.delete_any')],
      ],
      equivalence: PHOTO_ANY_EQUIVALENCE,
    }
  })(),
  {
    table: 'storage.objects',
    name: 'delete_log_photos',
    cmd: 'DELETE',
    source: '0104',
    keys: ['movements.photos.manage', 'movements.photos.delete_any'],
    using: `bucket_id = 'log-photos'
  AND ${hasKey('movements.photos.manage')}
  AND ((storage.foldername(name))[1] = auth.uid()::text OR ${hasKey('movements.photos.delete_any')})
  AND (
    ${hasKey('movements.photos.delete_any')}
    OR EXISTS (
      SELECT 1
      FROM public.entry_exit_photos photo
      WHERE photo.file_path = name
        AND public.can_access_movement(photo.entry_exit_log_id)
    )
    OR public.can_access_movement(public.safe_uuid(split_part(name, '/', 2)))
    OR EXISTS (
      SELECT 1
      FROM public.entry_exit_logs movement
      WHERE movement.photo_url = name
        AND public.can_access_movement(movement.id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.pending_movement_photo_batches pending
      WHERE pending.id = public.safe_uuid(split_part(name, '/', 2))
        AND pending.uploaded_by = auth.uid()
        AND name = ANY(pending.file_paths)
    )
  )`,
    check: null,
    atoms: [
      [NOT_MONITOR, hasKey('movements.photos.manage')],
      [IS_ADMIN, hasKey('movements.photos.delete_any'), 2],
    ],
    equivalence: PHOTO_ANY_EQUIVALENCE,
  },
  {
    table: 'public.pending_movement_photo_batches',
    name: 'insert_own_pending_movement_photo_batches',
    cmd: 'INSERT',
    source: '0079',
    keys: ['movements.photos.manage'],
    using: null,
    check: `uploaded_by = auth.uid()
  AND ${hasKey('movements.photos.manage')}
  AND expires_at > now()`,
    atoms: [[NOT_MONITOR, hasKey('movements.photos.manage')]],
    equivalence: PHOTO_WRITE_EQUIVALENCE,
  },
  {
    table: 'public.movement_notices',
    name: 'select_movement_notices',
    cmd: 'SELECT',
    source: '0110',
    keys: ['settings.integrations', 'movements.notify_foreman'],
    using: `${hasKey('settings.integrations')}
  OR sender_id = auth.uid()
  OR recipient_id = auth.uid()
  OR (
    kind = 'workshop_arrival'
    AND ${hasKey('movements.notify_foreman')}
  )`,
    check: null,
    atoms: [
      [IS_ADMIN, hasKey('settings.integrations')],
      [
        `public.current_user_role() IN (
      'workshop', 'assistant_workshop_manager', 'workshop_manager'
    )`,
        hasKey('movements.notify_foreman'),
      ],
    ],
    equivalence: [
      {
        label: 'notices readable besides own',
        old: (role) =>
          role === 'admin'
            ? 'all'
            : WORKSHOP_ROLES.includes(role)
              ? 'workshop_arrival'
              : 'own',
        new: (p) =>
          p.has('settings.integrations')
            ? 'all'
            : p.has('movements.notify_foreman')
              ? 'workshop_arrival'
              : 'own',
      },
    ],
  },
  {
    table: 'public.profiles',
    name: 'select_profiles',
    cmd: 'SELECT',
    source: '0076',
    keys: ['users.read'],
    using: `auth.uid() = id
  OR (SELECT public.permission_scope('users.read')) = 'all'
  OR (
    (SELECT public.permission_scope('users.read')) = 'workshop'
    AND role IN ('workshop', 'assistant_workshop_manager', 'workshop_manager')
  )`,
    check: null,
    atoms: [
      [
        `public.is_admin()
    OR public.current_user_role() = 'monitor'`,
        `(SELECT public.permission_scope('users.read')) = 'all'`,
      ],
      [
        `public.current_user_role() IN ('workshop', 'assistant_workshop_manager', 'workshop_manager')`,
        `(SELECT public.permission_scope('users.read')) = 'workshop'`,
      ],
    ],
    equivalence: [
      {
        label: 'profiles readable besides own',
        old: (role) =>
          ['admin', 'monitor'].includes(role)
            ? 'all'
            : WORKSHOP_ROLES.includes(role)
              ? 'workshop'
              : 'own',
        new: (p) => rowClass(p.scope('users.read'), 'own'),
      },
    ],
  },
  adminPolicy(
    'public.profiles',
    'insert_profiles',
    'INSERT',
    '0004',
    'users.manage',
  ),
  {
    ...adminPolicy(
      'public.profiles',
      'update_profiles',
      'UPDATE',
      '0004',
      'users.manage',
    ),
    using: `auth.uid() = id OR ${hasKey('users.manage')}`,
    check: `auth.uid() = id OR ${hasKey('users.manage')}`,
  },
  adminPolicy(
    'public.profiles',
    'delete_profiles',
    'DELETE',
    '0004',
    'users.manage',
  ),
  {
    ...adminPolicy(
      'public.profile_contacts',
      'select_profile_contacts',
      'SELECT',
      '0113',
      'users.manage',
    ),
    using: `${hasKey('users.manage')}
  OR user_id = auth.uid()`,
  },
  {
    ...adminPolicy(
      'public.profile_projects',
      'select_profile_projects',
      'SELECT',
      '0052',
      'users.manage',
    ),
    using: `profile_id = auth.uid() OR ${hasKey('users.manage')}`,
  },
  ...crud('public.profile_projects', '0052', same('users.manage'), {
    insert: 'insert_profile_projects',
    update: 'update_profile_projects',
    delete: 'delete_profile_projects',
  }),
  {
    ...adminPolicy(
      'public.profile_companies',
      'select_profile_companies',
      'SELECT',
      '0058',
      'users.manage',
    ),
    using: `profile_id = auth.uid() OR ${hasKey('users.manage')}`,
  },
  ...crud('public.profile_companies', '0058', same('users.manage'), {
    insert: 'insert_profile_companies',
    update: 'update_profile_companies',
    delete: 'delete_profile_companies',
  }),
  adminPolicy(
    'public.movement_audit_logs',
    'movement_audit_logs_admin_select',
    'SELECT',
    '0069',
    'movements.activity',
  ),
  ...crud(
    'public.equipment',
    '0004',
    {
      insert: 'equipment.create',
      update: 'equipment.edit',
      delete: 'equipment.delete',
    },
    {
      insert: 'insert_equipment',
      update: 'update_equipment',
      delete: 'delete_equipment',
    },
  ),
  ...crud('public.projects', '0004', same('companies_projects.edit'), {
    insert: 'insert_projects',
    update: 'update_projects',
    delete: 'delete_projects',
  }),
  ...crud('public.companies', '0018', same('companies_projects.edit'), {
    insert: 'insert_companies',
    update: 'update_companies',
    delete: 'delete_companies',
  }),
  ...crud('public.company_projects', '0029', same('companies_projects.edit'), {
    insert: 'insert_company_projects',
    update: 'update_company_projects',
    delete: 'delete_company_projects',
  }),
  ...crud('public.lessors', '0004', same('lessors.edit'), {
    insert: 'insert_lessors',
    update: 'update_lessors',
    delete: 'delete_lessors',
  }),
  ...crud(
    'public.drivers',
    '0033',
    {
      insert: 'drivers.create',
      update: 'drivers.edit',
      delete: 'drivers.delete',
    },
    {
      insert: 'insert_drivers',
      update: 'update_drivers',
      delete: 'delete_drivers',
    },
  ),
  ...crud('public.equipment_types', '0039', same('settings.equipment_types'), {
    insert: 'insert_equipment_types',
    update: 'update_equipment_types',
    delete: 'delete_equipment_types',
  }),
]

module.exports = {
  ALL_ROLES,
  WORKSHOP_ROLES,
  FUNCTION_REWRITES,
  POLICY_REWRITES,
}
