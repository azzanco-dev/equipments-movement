// Migration 0134 (security audit run-1, group C "permission catalogue gaps",
// owner review 2026-10-18): five leads closed, plus the UI follow-through.
//
//   C-11  equipment.change_code enforced by a BEFORE UPDATE OF code trigger
//         (em:equipment:change_code:db_unenforced); the Excel update reports
//         a refused code change per row.
//   C-12  movements.import requires movements.edit_delete and
//         import_movement_rows checks it per row for a foreign supervisor
//         (em:import_movement_rows:supervisor_id:edit_delete-bypass).
//   C-13  movement_audit_logs_admin_select follows the movements.read scope
//         for non-admins; movements.activity requires movements.read
//         (em:movement_audit_logs:select:unscoped-movements.activity).
//   C-14  entry_exit_logs.company_id / project_id: ON DELETE RESTRICT
//         (em:fk:entry_exit_logs:company_project:on_delete_set_null).
//   C-15  equipment.lessor_id / project_id: ON DELETE RESTRICT
//         (em:fk:equipment:lessor_id:on_delete_set_null).
//
// Source checks only, like the rest of the suite: the re-created functions
// are compared with their 0127 definitions so that nothing but the documented
// clauses changed, the catalogue updates and the policy are pinned, the three
// list screens map the 23503 refusal to a safe message, the equipment form
// maps the trigger token to the code field, and the translation keys exist in
// both languages (new Arabic copy without hamza alif).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261018110000_0134_permission_gap_hardening.sql'
const BASE_0127 = '20261011140000_0127_permission_keys_in_policies.sql'
const PREVIOUS = '20261018100000_0133_photo_storage_policy_hardening.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const sql = read('supabase', 'migrations', MIGRATION)
const sql0127 = read('supabase', 'migrations', BASE_0127)
const stripped = sql.replace(/--[^\n]*/g, '')

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** SQL without `--` comments, whitespace collapsed: for exact comparisons. */
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** `CREATE [OR REPLACE] FUNCTION public.<name>(` up to `\n$$;`. */
function fn(source, name) {
  const match = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${escape(name)}\\(`,
  ).exec(source)
  assert.ok(match, `missing function ${name}`)
  const end = source.indexOf('\n$$;', match.index)
  assert.ok(end > match.index, `unterminated function ${name}`)
  return source.slice(match.index, end + 4)
}

/** `CREATE POLICY <name> ON <table> ... ;` up to the first `\n);`. */
function policy(source, name, table) {
  const match = new RegExp(
    `CREATE POLICY ${escape(name)} ON ${escape(table)}\\b`,
  ).exec(source)
  assert.ok(match, `missing policy ${name} on ${table}`)
  const end = source.indexOf('\n);', match.index)
  assert.ok(end > match.index, `unterminated policy ${name}`)
  return source.slice(match.index, end + 3)
}

const HAMZA_ALIF = /[أإآ]/

test('0134 is the single 0134 migration, right after 0133', () => {
  // 0135 followed on the same day, so "newest" is no longer asserted; the
  // "not redefined before 0134" test below still guards the baselines.
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0134 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0134_/.test(file)).length, 1)
})

test('the 0127 baselines compared below were not redefined before 0134', () => {
  const between = migrations.filter(
    (file) => file > BASE_0127 && file < MIGRATION,
  )
  for (const file of between) {
    const text = read('supabase', 'migrations', file)
    assert.doesNotMatch(
      text,
      /FUNCTION public\.(?:update_equipment_from_excel|import_movement_rows)\(/,
      `${file} redefines a function 0134 re-creates from 0127`,
    )
    assert.doesNotMatch(text, /POLICY movement_audit_logs_admin_select\b/, file)
    assert.doesNotMatch(
      text,
      /CONSTRAINT (?:entry_exit_logs_(?:company|project)_id_fkey|equipment_(?:lessor|project)_id_fkey)\b/,
      file,
    )
  }
})

// ---------------------------------------------------------------------------
// C-14 / C-15
// ---------------------------------------------------------------------------
test('C-14/C-15: the four foreign keys are re-created under their names with ON DELETE RESTRICT', () => {
  const keys = [
    [
      'entry_exit_logs',
      'entry_exit_logs_company_id_fkey',
      'company_id',
      'companies',
    ],
    [
      'entry_exit_logs',
      'entry_exit_logs_project_id_fkey',
      'project_id',
      'projects',
    ],
    ['equipment', 'equipment_lessor_id_fkey', 'lessor_id', 'lessors'],
    ['equipment', 'equipment_project_id_fkey', 'project_id', 'projects'],
  ]
  for (const [table, name, column, target] of keys) {
    assert.match(
      stripped,
      new RegExp(
        `ALTER TABLE public\\.${table}\\s+DROP CONSTRAINT ${name},\\s+ADD CONSTRAINT ${name}\\s+FOREIGN KEY \\(${column}\\) REFERENCES public\\.${target}\\(id\\) ON DELETE RESTRICT;`,
      ),
      `${name} is RESTRICT`,
    )
    assert.match(
      sql,
      new RegExp(
        `COMMENT ON CONSTRAINT ${name} ON public\\.${table} IS\\s+'0134 \\(C-1[45]\\)`,
      ),
    )
  }
  // No other referential action is introduced or left behind (the constraint
  // comments mention the old action in words only, so compare the code: the
  // four ADD CONSTRAINT clauses and nothing else).
  const code = stripped.replace(/'[^']*'/g, "''")
  assert.doesNotMatch(
    code,
    /ON DELETE (?:SET NULL|CASCADE|NO ACTION|SET DEFAULT)/,
  )
  assert.equal((code.match(/ON DELETE RESTRICT/g) ?? []).length, 4)
  assert.equal((code.match(/ADD CONSTRAINT/g) ?? []).length, 4)
  // The dialogs the comment refers to exist and promise this behaviour.
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'dialogDescCompanyDelete',
    'dialogDescProjectDelete',
    'dialogDescLessorDelete',
  ])
    assert.equal(
      (translations.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length,
      2,
      key,
    )
})

// ---------------------------------------------------------------------------
// C-11
// ---------------------------------------------------------------------------
test('C-11: a BEFORE UPDATE OF code trigger requires equipment.change_code', () => {
  const body = fn(sql, 'enforce_equipment_code_change_permission')
  assert.match(
    body,
    /RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/,
  )
  assert.equal(
    norm(body.slice(body.indexOf('BEGIN'))),
    norm(`BEGIN
  IF upper(btrim(OLD.code)) IS DISTINCT FROM upper(btrim(NEW.code))
     AND NOT public.has_permission('equipment.change_code') THEN
    RAISE EXCEPTION 'equipment_code_change_not_allowed'
      USING ERRCODE = '42501',
            DETAIL = 'Changing the equipment code needs the permission equipment.change_code.';
  END IF;
  RETURN NEW;
END;
$$;`),
  )
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.enforce_equipment_code_change_permission\(\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    sql,
    /DROP TRIGGER IF EXISTS enforce_equipment_code_change_permission ON public\.equipment;\s+CREATE TRIGGER enforce_equipment_code_change_permission\s+BEFORE UPDATE OF code ON public\.equipment\s+FOR EACH ROW\s+WHEN \(OLD\.code IS DISTINCT FROM NEW\.code\)\s+EXECUTE FUNCTION public\.enforce_equipment_code_change_permission\(\);/,
  )
  // It fires before the 0114 reuse guard (BEFORE triggers run in name order).
  assert.ok(
    'enforce_equipment_code_change_permission' < 'guard_equipment_code_history',
  )
})

test('C-11: update_equipment_from_excel is 0127 verbatim plus the per-row code-change check', () => {
  const before = norm(fn(sql0127, 'update_equipment_from_excel'))
  const after = norm(fn(sql, 'update_equipment_from_excel'))
  const anchor =
    norm(`-- Absent or blank keeps the current status; anything else must be one of
      -- the two known values (0125: active or sold).
      v_status := COALESCE(`)
  const check =
    norm(`IF upper(btrim(v_equipment.code)) IS DISTINCT FROM upper(btrim(v_row->>'code'))
         AND NOT public.has_permission('equipment.change_code') THEN
        RAISE EXCEPTION 'equipment_code_change_not_allowed';
      END IF;`)
  const oldStatus =
    "WHEN SQLERRM LIKE '%equipment_type_not_found%' THEN 'equipment_type_not_found' WHEN SQLERRM LIKE '%invalid_equipment_status%'"
  const newStatus =
    "WHEN SQLERRM LIKE '%equipment_type_not_found%' THEN 'equipment_type_not_found' WHEN SQLERRM LIKE '%equipment_code_change_not_allowed%' THEN 'equipment_code_change_not_allowed' WHEN SQLERRM LIKE '%invalid_equipment_status%'"
  assert.ok(before.includes(anchor), 'the 0127 status block')
  assert.ok(before.includes(oldStatus), 'the 0127 error mapping')
  const expected = before
    .replace(anchor, `${check} ${anchor}`)
    .replace(oldStatus, newStatus)
  assert.equal(after, expected)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.update_equipment_from_excel\(jsonb\) FROM PUBLIC, anon;\s+GRANT EXECUTE ON FUNCTION public\.update_equipment_from_excel\(jsonb\) TO authenticated;/,
  )
})

test('C-11: admin_change_equipment_code is not redefined and still checks the key itself', () => {
  assert.doesNotMatch(
    stripped,
    /FUNCTION public\.admin_change_equipment_code\(/,
  )
  assert.match(
    fn(sql0127, 'admin_change_equipment_code'),
    /NOT public\.has_permission\('equipment\.change_code'\)/,
  )
})

// ---------------------------------------------------------------------------
// C-12
// ---------------------------------------------------------------------------
test('C-12: movements.import requires movements.edit_delete in the catalogue', () => {
  assert.match(
    stripped,
    /UPDATE public\.permissions\s+SET requires = array_append\(requires, 'movements\.edit_delete'\)\s+WHERE key = 'movements\.import'\s+AND NOT \('movements\.edit_delete' = ANY\(requires\)\);/,
  )
})

test('C-12: import_movement_rows is 0127 verbatim plus the foreign-supervisor rule', () => {
  const before = norm(fn(sql0127, 'import_movement_rows'))
  const after = norm(fn(sql, 'import_movement_rows'))
  const anchor = norm(`IF v_mode IN ('entry', 'both') THEN
        v_entry_at :=`)
  const check = norm(`IF NULLIF(v_row->>'supervisor_id', '') IS NOT NULL
         AND (v_row->>'supervisor_id')::uuid IS DISTINCT FROM auth.uid()
         AND NOT public.has_permission('movements.edit_delete') THEN
        RAISE EXCEPTION 'supervisor_not_allowed';
      END IF;`)
  const oldCase =
    "v_error := CASE WHEN SQLERRM LIKE '%sequence would be invalid%'"
  const newCase =
    "v_error := CASE WHEN SQLERRM LIKE '%supervisor_not_allowed%' THEN 'supervisor_not_allowed' WHEN SQLERRM LIKE '%sequence would be invalid%'"
  assert.ok(before.includes(anchor), 'the 0127 entry block')
  assert.ok(before.includes(oldCase), 'the 0127 error mapping')
  const expected = before
    .replace(anchor, `${check} ${anchor}`)
    .replace(oldCase, newCase)
  assert.equal(after, expected)
  // The rule mirrors the insert policy every other path goes through.
  assert.match(
    sql0127,
    /CREATE POLICY insert_entry_exit_logs ON public\.entry_exit_logs\s+FOR INSERT TO authenticated\s+WITH CHECK \(\s+supervisor_id = auth\.uid\(\) OR \(SELECT public\.has_permission\('movements\.edit_delete'\)\)\s+\);/,
  )
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.import_movement_rows\(jsonb\) FROM PUBLIC, anon;\s+GRANT EXECUTE ON FUNCTION public\.import_movement_rows\(jsonb\) TO authenticated;/,
  )
})

// ---------------------------------------------------------------------------
// C-13
// ---------------------------------------------------------------------------
test('C-13: movements.activity requires movements.read in the catalogue', () => {
  assert.match(
    stripped,
    /UPDATE public\.permissions\s+SET requires = array_append\(requires, 'movements\.read'\)\s+WHERE key = 'movements\.activity'\s+AND NOT \('movements\.read' = ANY\(requires\)\);/,
  )
})

test('C-13: the audit policy keeps the key and adds the movements.read scope', () => {
  const text = policy(
    sql,
    'movement_audit_logs_admin_select',
    'public.movement_audit_logs',
  )
  assert.equal(
    norm(text),
    norm(`CREATE POLICY movement_audit_logs_admin_select ON public.movement_audit_logs
FOR SELECT TO authenticated
USING (
  (SELECT public.has_permission('movements.activity'))
  AND (
    (SELECT public.permission_scope('movements.read')) = 'all'
    OR public.can_access_movement(movement_id)
  )
);`),
  )
  // Permission keys only, no role name (the 0127 rule wave22Roles pins).
  assert.doesNotMatch(text, /is_admin\(\)|current_user_role\(\)/)
  assert.match(
    sql,
    /DROP POLICY IF EXISTS movement_audit_logs_admin_select ON public\.movement_audit_logs;/,
  )
  assert.match(
    sql,
    /COMMENT ON POLICY movement_audit_logs_admin_select ON public\.movement_audit_logs IS\s+'0134 \(C-13\)/,
  )
  // can_access_movement (0127) is the movements.read scope of one movement
  // and is false when the entry_exit_logs row no longer exists.
  assert.match(
    fn(sql0127, 'can_access_movement'),
    /FROM public\.entry_exit_logs l\s+WHERE l\.id = p_movement_id\s+AND \(\s+l\.supervisor_id = auth\.uid\(\)\s+OR public\.movement_scope_allows\(\s+public\.permission_scope\('movements\.read'\)/,
  )
  // movement_id is the column of 0069.
  assert.match(
    read(
      'supabase',
      'migrations',
      '20260831143000_0069_movement_audit_logs.sql',
    ),
    /CREATE TABLE public\.movement_audit_logs \(\s+id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\s+movement_id uuid NOT NULL,/,
  )
})

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------
test('0134 redefines nothing else and leaves the frozen legacy mapping alone', () => {
  assert.doesNotMatch(stripped, /legacy_role_permissions/)
  assert.doesNotMatch(stripped, /set_roles_system_enabled|roles_system/)
  for (const name of [
    'admin_set_role_permissions',
    'has_permission',
    'permission_scope',
    'can_access_movement',
    'is_admin',
    'enforce_movement_sequence',
    'guard_equipment_code_history',
    'record_equipment_code_change',
    'admin_change_equipment_code',
    'admin_update_movement',
    'admin_delete_movement',
  ]) {
    assert.doesNotMatch(
      stripped,
      new RegExp(`FUNCTION public\\.${name}\\(`),
      `${name} must not be redefined by 0134`,
    )
  }
  for (const name of [
    'update_equipment',
    'delete_companies',
    'delete_projects',
    'delete_lessors',
    'insert_entry_exit_logs',
  ])
    assert.doesNotMatch(stripped, new RegExp(`CREATE POLICY ${name}\\b`), name)
  // Only the two catalogue rows above are written.
  assert.equal((stripped.match(/UPDATE public\.permissions/g) ?? []).length, 2)
  assert.doesNotMatch(
    stripped,
    /INSERT INTO public\.(?:permissions|roles|role_permissions)/,
  )
  assert.doesNotMatch(stripped, /DELETE FROM/)
  assert.match(stripped, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('no later migration redefines the 0134 objects', () => {
  for (const file of migrations.filter((file) => file > MIGRATION)) {
    const text = read('supabase', 'migrations', file)
    assert.doesNotMatch(
      text,
      /POLICY movement_audit_logs_admin_select\b/,
      `${file} redefines the audit policy after 0134; carry the scope clause over and update this test`,
    )
    assert.doesNotMatch(
      text,
      /FUNCTION public\.(?:enforce_equipment_code_change_permission|update_equipment_from_excel|import_movement_rows)\(/,
      `${file} redefines a 0134 function; carry the 0134 checks over and update this test`,
    )
    assert.doesNotMatch(
      text,
      /CONSTRAINT (?:entry_exit_logs_(?:company|project)_id_fkey|equipment_(?:lessor|project)_id_fkey)\b[\s\S]*?ON DELETE (?:SET NULL|CASCADE)/,
      `${file} weakens a 0134 foreign key`,
    )
  }
})

// ---------------------------------------------------------------------------
// UI follow-through
// ---------------------------------------------------------------------------
test('the three list screens map a 23503 refusal to a safe message', () => {
  const screens = [
    [
      'src/screens/companies/CompaniesListScreen.tsx',
      'companies',
      'companyDeleteBlocked',
    ],
    [
      'src/screens/projects/ProjectsListScreen.tsx',
      'projects',
      'projectDeleteBlocked',
    ],
    [
      'src/screens/lessors/LessorsListScreen.tsx',
      'lessors',
      'lessorDeleteBlocked',
    ],
  ]
  for (const [file, table, key] of screens) {
    const text = read(file)
    assert.match(
      text,
      /import \{ databaseErrorKind \} from '@\/lib\/formValidation'/,
      file,
    )
    assert.match(
      text,
      new RegExp(
        // 2026-10-28: the delete reads its rows back and answers a policy
        // refusal first (tests/masterDataActions.test.cjs).
        `\\.from\\('${table}'\\)\\s+\\.delete\\(\\)\\s+\\.eq\\('id', \\w+\\.id\\)\\s+\\.select\\('id'\\)\\s+if \\(refusedByPolicy\\(error, data\\)\\) \\{[\\s\\S]*?return\\s+\\}\\s+if \\(error\\) \\{[\\s\\S]*?setLoadError\\(\\s+t\\(\\s+databaseErrorKind\\(error\\) === 'foreignKey'\\s+\\? '${key}'\\s+: 'deleteFailed',\\s+\\),\\s+\\)\\s+return\\s+\\}`,
      ),
      `${file} surfaces the refused delete`,
    )
    assert.doesNotMatch(text, /console\.error\(error\)/, file)
  }
  // 23503 is the foreign-key kind of the shared helper.
  assert.match(read('src/lib/formValidation.ts'), /'23503': 'foreignKey',/)
})

test('the equipment form maps the trigger token to the code field', () => {
  const rules = read('src/lib/equipmentForm.ts')
  assert.match(
    rules,
    /\{\s+on: 'raised',\s+match: 'equipment_code_change_not_allowed',\s+field: 'code',\s+key: 'equipmentCodeChangeForbidden',\s+\}/,
  )
  // The rule sits in the equipment form's own list, which the dialog applies
  // through equipmentSaveFieldErrors -> mapDatabaseErrorToField.
  const start = rules.indexOf('export const EQUIPMENT_DATABASE_RULES')
  const end = rules.indexOf('export function equipmentSaveFieldErrors')
  assert.ok(start > 0 && end > start)
  assert.ok(
    rules.slice(start, end).includes('equipment_code_change_not_allowed'),
  )
  assert.match(
    rules.slice(end),
    /return mapDatabaseErrorToField\(error, EQUIPMENT_DATABASE_RULES\)/,
  )
  const dialog = read('src/screens/equipment/EquipmentFormDialog.tsx')
  assert.match(dialog, /equipmentSaveFieldErrors\(saveError\)/)
  assert.match(dialog, /error=\{errors\.code && t\(errors\.code\)\}/)
})

test('the translation keys exist in both languages, Arabic without hamza alif', () => {
  const source = read('src/i18n/translations.ts')
  const blocks = [
    ...source.matchAll(
      /\/\/ audit-0134 — start\n([\s\S]*?)\/\/ audit-0134 — end/g,
    ),
  ].map((match) => match[1])
  // Two blocks per language: the delete messages and the code-field message.
  assert.equal(blocks.length, 4)
  const keys = [
    'companyDeleteBlocked',
    'projectDeleteBlocked',
    'lessorDeleteBlocked',
    'deleteFailed',
    'equipmentCodeChangeForbidden',
    'movementImportError_supervisor_not_allowed',
  ]
  for (const key of keys)
    assert.equal(
      (source.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length,
      2,
      `${key} in both languages`,
    )
  const arabic = blocks.filter((block) => /[؀-ۿ]/.test(block))
  assert.equal(arabic.length, 2)
  for (const block of arabic) assert.ok(!HAMZA_ALIF.test(block), block)
  assert.match(
    source,
    /lessorDeleteBlocked: 'لا يمكن حذف المورد لانه مرتبط بمعدات\.'/,
  )
  assert.match(
    source,
    /equipmentCodeChangeForbidden: 'لا تملك صلاحية تغيير كود المعدة\.'/,
  )
  const importKey = source.match(
    /movementImportError_supervisor_not_allowed:\s+'([^']+)'/,
  )
  assert.ok(importKey && !HAMZA_ALIF.test(importKey[1]))
})
