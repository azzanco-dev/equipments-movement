-- Migration 0134: permission-catalogue gaps (security audit run-1, group C).
--
-- Source: the source-only security audit of 2026-10-18 (run-1 at 33ce47b),
-- group C "permission catalogue gaps", reviewed by the product owner on
-- 2026-10-18 and approved as one separate task; the design choices were left
-- to the auditor. Five leads are closed here. Every object that is touched is
-- re-created from its latest definition with only the documented clauses
-- changed; nothing else is redefined, and legacy_role_permissions (the frozen
-- mapping of 0130) is NOT touched.
--
--   C-11  em:equipment:change_code:db_unenforced
--         equipment.change_code was only checked inside
--         admin_change_equipment_code; a holder of equipment.edit (policy
--         update_equipment) or equipment.import (update_equipment_from_excel,
--         SECURITY DEFINER) could still renumber a unit. A BEFORE UPDATE OF
--         code trigger now refuses a real code change without the key, and
--         the Excel update reports it per row instead of 'update_failed'.
--   C-12  em:import_movement_rows:supervisor_id:edit_delete-bypass
--         the catalogue lists "record a movement in another user's name"
--         under movements.edit_delete (and insert_entry_exit_logs enforces
--         exactly that), but movements.import did not require it and
--         import_movement_rows attributed rows to any supervisor_id. The key
--         now requires movements.edit_delete and the function checks it per
--         row whenever the row's supervisor differs from the caller.
--   C-13  em:movement_audit_logs:select:unscoped-movements.activity
--         movement_audit_logs_admin_select admitted every audit row (a full
--         snapshot of every movement ever recorded) to any holder of
--         movements.activity, with no movements.read scope. A holder now
--         sees only the rows of movements that pass the caller's
--         movements.read scope (scope 'all' reads every row, a narrower
--         scope goes through can_access_movement); rows of deleted movements
--         are readable by scope 'all' only. movements.activity requires
--         movements.read in the catalogue.
--   C-14  em:fk:entry_exit_logs:company_project:on_delete_set_null
--   C-15  em:fk:equipment:lessor_id:on_delete_set_null
--         deleting a company, project or supplier silently NULLed the
--         reference on every movement / equipment row (ON DELETE SET NULL),
--         a write outside RLS that only movements.edit_delete /
--         equipment.edit should be able to make. The four foreign keys are
--         now ON DELETE RESTRICT: the delete is refused while any row refers
--         to the record, which is what the delete dialogs have promised all
--         along (translations dialogDescCompanyDelete, dialogDescProjectDelete,
--         dialogDescLessorDelete).
--
-- Production facts verified read-only before writing (2026-10-18): the four
-- constraint names below are the live ones; no referencing row is orphaned,
-- so the RESTRICT constraints validate; in the live catalogue only the admin
-- role holds movements.import or movements.activity, so no existing role is
-- invalidated by the two new `requires` entries.

-- ===========================================================================
-- C-14 / C-15  Referential actions: SET NULL -> RESTRICT
-- ===========================================================================
-- Constraint names are the production names (entry_exit_logs_*_fkey from
-- 0010, equipment_*_fkey from 0001). Each is dropped and re-added in one
-- statement under the same name, so nothing that names the constraint
-- changes. ON DELETE RESTRICT makes the referenced row's DELETE fail with
-- SQLSTATE 23503 while a reference exists; the list screens map that code to
-- a safe message (C-14/C-15 UI follow-through).

-- em:fk:entry_exit_logs:company_project:on_delete_set_null
ALTER TABLE public.entry_exit_logs
  DROP CONSTRAINT entry_exit_logs_company_id_fkey,
  ADD CONSTRAINT entry_exit_logs_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;

ALTER TABLE public.entry_exit_logs
  DROP CONSTRAINT entry_exit_logs_project_id_fkey,
  ADD CONSTRAINT entry_exit_logs_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT entry_exit_logs_company_id_fkey ON public.entry_exit_logs IS
  '0134 (C-14): ON DELETE RESTRICT (was SET NULL since 0010). A company referenced by a movement cannot be deleted; movement rows change only through the movements.edit_delete functions.';
COMMENT ON CONSTRAINT entry_exit_logs_project_id_fkey ON public.entry_exit_logs IS
  '0134 (C-14): ON DELETE RESTRICT (was SET NULL since 0010). A project referenced by a movement cannot be deleted; movement rows change only through the movements.edit_delete functions.';

-- em:fk:equipment:lessor_id:on_delete_set_null
ALTER TABLE public.equipment
  DROP CONSTRAINT equipment_lessor_id_fkey,
  ADD CONSTRAINT equipment_lessor_id_fkey
    FOREIGN KEY (lessor_id) REFERENCES public.lessors(id) ON DELETE RESTRICT;

-- Same root cause, same table (the audit's C-14 note on equipment.project_id):
-- a companies_projects.edit holder must not rewrite equipment rows either.
ALTER TABLE public.equipment
  DROP CONSTRAINT equipment_project_id_fkey,
  ADD CONSTRAINT equipment_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT equipment_lessor_id_fkey ON public.equipment IS
  '0134 (C-15): ON DELETE RESTRICT (was SET NULL since 0001). A supplier referenced by equipment cannot be deleted; equipment rows change only under equipment.edit.';
COMMENT ON CONSTRAINT equipment_project_id_fkey ON public.equipment IS
  '0134 (C-15): ON DELETE RESTRICT (was SET NULL since 0001). A project referenced by equipment cannot be deleted; equipment rows change only under equipment.edit.';

-- ===========================================================================
-- C-11  equipment.change_code enforced on the column itself
-- ===========================================================================
-- em:equipment:change_code:db_unenforced
--
-- A "code change" is what 0114 defines: a difference beyond case and
-- surrounding spaces (the same test record_equipment_code_change uses to
-- decide whether a history row is written). The trigger fires before
-- guard_equipment_code_history (alphabetical order of BEFORE triggers), so a
-- caller without the key is refused before any advisory lock is taken.
--
-- has_permission() evaluates auth.uid(), i.e. the CALLER, also inside
-- SECURITY DEFINER functions: admin_change_equipment_code (SECURITY INVOKER,
-- already checks the key itself) and update_equipment_from_excel (SECURITY
-- DEFINER, equipment.import) keep working for holders of the key. A session
-- without a user (no JWT) has no permission and is refused like every other
-- permission-checked trigger of this schema.
--
-- The error token is stable so the client can map it to the code field:
-- SQLSTATE 42501, MESSAGE equipment_code_change_not_allowed.

CREATE OR REPLACE FUNCTION public.enforce_equipment_code_change_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF upper(btrim(OLD.code)) IS DISTINCT FROM upper(btrim(NEW.code))
     AND NOT public.has_permission('equipment.change_code') THEN
    RAISE EXCEPTION 'equipment_code_change_not_allowed'
      USING ERRCODE = '42501',
            DETAIL = 'Changing the equipment code needs the permission equipment.change_code.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_equipment_code_change_permission()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_equipment_code_change_permission() IS
  '0134 (C-11): BEFORE UPDATE OF code on equipment. A real code change (beyond case and spaces, as 0114 defines it) needs equipment.change_code whatever the write path: the admin RPC, the update_equipment policy or the Excel update. Raises equipment_code_change_not_allowed (42501).';

DROP TRIGGER IF EXISTS enforce_equipment_code_change_permission ON public.equipment;
CREATE TRIGGER enforce_equipment_code_change_permission
  BEFORE UPDATE OF code ON public.equipment
  FOR EACH ROW
  WHEN (OLD.code IS DISTINCT FROM NEW.code)
  EXECUTE FUNCTION public.enforce_equipment_code_change_permission();

-- update_equipment_from_excel: latest 0127, verbatim except two additions
-- marked "0134 (C-11)": the explicit per-row check before the UPDATE (so the
-- row fails with its own status, never the whole batch) and the matching
-- error_code in the per-row EXCEPTION mapping. The trigger above is the
-- backstop behind this check.
CREATE OR REPLACE FUNCTION public.update_equipment_from_excel(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_equipment public.equipment;
  v_results jsonb := '[]'::jsonb;
  v_id uuid;
  v_version timestamptz;
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('equipment.import') THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'invalid_update_rows';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_id := (v_row->>'record_id')::uuid;
      v_version := (v_row->>'record_version')::timestamptz;
      SELECT * INTO v_equipment FROM public.equipment WHERE id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'record_not_found'; END IF;
      IF v_equipment.updated_at IS DISTINCT FROM v_version THEN
        RAISE EXCEPTION 'record_changed';
      END IF;
      IF NULLIF(btrim(v_row->>'code'), '') IS NULL OR NULLIF(btrim(v_row->>'type'), '') IS NULL THEN
        RAISE EXCEPTION 'required_value_missing';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.equipment_types et WHERE et.name = btrim(v_row->>'type')) THEN
        RAISE EXCEPTION 'equipment_type_not_found';
      END IF;

      -- 0134 (C-11): a changed code needs equipment.change_code; the row gets
      -- its own status and the other rows of the batch still go through.
      IF upper(btrim(v_equipment.code)) IS DISTINCT FROM upper(btrim(v_row->>'code'))
         AND NOT public.has_permission('equipment.change_code') THEN
        RAISE EXCEPTION 'equipment_code_change_not_allowed';
      END IF;

      -- Absent or blank keeps the current status; anything else must be one of
      -- the two known values (0125: active or sold).
      v_status := COALESCE(
        NULLIF(btrim(v_row->>'status'), ''),
        v_equipment.status
      );
      IF v_status NOT IN ('active', 'sold') THEN
        RAISE EXCEPTION 'invalid_equipment_status';
      END IF;

      UPDATE public.equipment SET
        code = btrim(v_row->>'code'),
        type = btrim(v_row->>'type'),
        plate_number = NULLIF(btrim(v_row->>'plate_number'), ''),
        ownership_status = (v_row->>'ownership_status')::text,
        status = v_status,
        project_id = NULLIF(v_row->>'project_id', '')::uuid,
        lessor_id = CASE WHEN v_row->>'ownership_status' = 'external_supplier'
          THEN NULLIF(v_row->>'lessor_id', '')::uuid ELSE NULL END,
        brand = NULLIF(btrim(v_row->>'brand'), ''),
        model = NULLIF(btrim(v_row->>'model'), ''),
        manufacture_year = NULLIF(v_row->>'manufacture_year', '')::integer,
        chassis_number = NULLIF(btrim(v_row->>'chassis_number'), ''),
        registration_type = NULLIF(v_row->>'registration_type', '')::text,
        last_maintenance_date = NULLIF(v_row->>'last_maintenance_date', '')::date,
        registration_expiry = NULLIF(v_row->>'registration_expiry', '')::date,
        insurance_expiry = NULLIF(v_row->>'insurance_expiry', '')::date,
        master_data_complete = true
      WHERE id = v_id;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'record_id', v_id, 'status', 'updated'
      ));
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'record_id', v_row->>'record_id', 'status', 'error',
        'error_code', CASE
          WHEN SQLERRM LIKE '%record_not_found%' THEN 'record_not_found'
          WHEN SQLERRM LIKE '%record_changed%' THEN 'record_changed'
          WHEN SQLERRM LIKE '%required_value_missing%' THEN 'required_value_missing'
          WHEN SQLERRM LIKE '%equipment_type_not_found%' THEN 'equipment_type_not_found'
          WHEN SQLERRM LIKE '%equipment_code_change_not_allowed%' THEN 'equipment_code_change_not_allowed'
          WHEN SQLERRM LIKE '%invalid_equipment_status%' THEN 'invalid_equipment_status'
          WHEN SQLERRM LIKE '%invalid_plate_number%' THEN 'invalid_plate_number'
          ELSE 'update_failed' END
      ));
    END;
  END LOOP;
  RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.update_equipment_from_excel(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_equipment_from_excel(jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_equipment_from_excel(jsonb) IS
  '0134 (C-11): 0127 verbatim plus the per-row equipment.change_code check (status equipment_code_change_not_allowed for a changed code without the key). Gate: equipment.import.';

-- ===========================================================================
-- C-12  movements.import requires movements.edit_delete
-- ===========================================================================
-- em:import_movement_rows:supervisor_id:edit_delete-bypass
--
-- Catalogue: admin_set_role_permissions (0126) refuses a role that holds a
-- key without every key in its `requires`, so from now on a role cannot hold
-- movements.import without movements.edit_delete. Existing roles are not
-- re-validated by this UPDATE; in production only admin holds the key and it
-- holds movements.edit_delete too. The seeded roles of 0126 are untouched
-- (none of them holds movements.import).
UPDATE public.permissions
SET requires = array_append(requires, 'movements.edit_delete')
WHERE key = 'movements.import'
  AND NOT ('movements.edit_delete' = ANY(requires));

-- import_movement_rows: latest 0127, verbatim except the per-row check marked
-- "0134 (C-12)" and its error mapping: a row attributed to another user
-- (supervisor_id present and different from the caller) is refused without
-- movements.edit_delete, the rule insert_entry_exit_logs applies to every
-- other insert path. Rows without a supervisor still fall back to the caller.
CREATE OR REPLACE FUNCTION public.import_movement_rows(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_result jsonb := '[]'::jsonb;
  v_mode text;
  v_entry_at timestamptz;
  v_exit_at timestamptz;
  v_entry_id uuid;
  v_exit_id uuid;
  v_error text;
BEGIN
  IF NOT public.has_permission('movements.import') THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'invalid_import_rows';
  END IF;

  PERFORM set_config('app.movement_excel_import', 'true', true);

  FOR v_row IN
    SELECT value
    FROM jsonb_array_elements(p_rows)
    ORDER BY COALESCE(NULLIF(value->>'entry_date', ''), NULLIF(value->>'exit_date', '')),
             NULLIF(value->>'row_number', '')::integer
  LOOP
    v_entry_id := NULL;
    v_exit_id := NULL;
    v_error := NULL;
    BEGIN
      v_mode := v_row->>'mode';
      IF v_mode NOT IN ('entry', 'exit', 'both') THEN RAISE EXCEPTION 'invalid_mode'; END IF;
      IF NULLIF(v_row->>'equipment_id', '') IS NULL THEN RAISE EXCEPTION 'equipment_required'; END IF;

      -- 0134 (C-12): recording in another user's name is movements.edit_delete
      -- (the insert_entry_exit_logs rule), also through the import.
      IF NULLIF(v_row->>'supervisor_id', '') IS NOT NULL
         AND (v_row->>'supervisor_id')::uuid IS DISTINCT FROM auth.uid()
         AND NOT public.has_permission('movements.edit_delete') THEN
        RAISE EXCEPTION 'supervisor_not_allowed';
      END IF;

      IF v_mode IN ('entry', 'both') THEN
        v_entry_at := ((v_row->>'entry_date')::date + time '12:00') AT TIME ZONE 'Asia/Riyadh';
        INSERT INTO public.entry_exit_logs(
          equipment_id, supervisor_id, movement_type, movement_context,
          registration_method, driver_id, driver_name, company_id, project_id,
          contractor_equipment_code, notes, recorded_at
        ) VALUES (
          (v_row->>'equipment_id')::uuid,
          COALESCE(NULLIF(v_row->>'supervisor_id', '')::uuid, auth.uid()),
          'entry', 'site', 'manual',
          (v_row->>'driver_id')::uuid,
          COALESCE(
            NULLIF(btrim(v_row->>'driver_label'), ''),
            NULLIF(btrim(v_row->>'driver_name'), '')
          ),
          (v_row->>'company_id')::uuid,
          (v_row->>'project_id')::uuid,
          NULLIF(btrim(v_row->>'contractor_equipment_code'), ''),
          NULLIF(btrim(v_row->>'notes'), ''),
          v_entry_at
        ) RETURNING id INTO v_entry_id;
      END IF;

      IF v_mode IN ('exit', 'both') THEN
        v_exit_at := ((v_row->>'exit_date')::date + time '12:00') AT TIME ZONE 'Asia/Riyadh';
        IF v_mode = 'both' AND v_exit_at <= v_entry_at THEN
          v_exit_at := v_entry_at + interval '1 minute';
        END IF;
        INSERT INTO public.entry_exit_logs(
          equipment_id, supervisor_id, movement_type, movement_context,
          registration_method, notes, recorded_at
        ) VALUES (
          (v_row->>'equipment_id')::uuid,
          COALESCE(NULLIF(v_row->>'supervisor_id', '')::uuid, auth.uid()),
          'exit', 'site', 'manual',
          NULLIF(btrim(v_row->>'notes'), ''),
          v_exit_at
        ) RETURNING id INTO v_exit_id;
      END IF;

      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'row_number', v_row->>'row_number',
        'success', true,
        'entry_id', v_entry_id,
        'exit_id', v_exit_id
      ));
    EXCEPTION WHEN OTHERS THEN
      v_error := CASE
        WHEN SQLERRM LIKE '%supervisor_not_allowed%' THEN 'supervisor_not_allowed'
        WHEN SQLERRM LIKE '%sequence would be invalid%' THEN 'invalid_sequence'
        WHEN SQLERRM LIKE '%no prior entry%' THEN 'no_prior_entry'
        WHEN SQLERRM LIKE '%future%' THEN 'future_date'
        WHEN SQLERRM LIKE '%violates foreign key%' THEN 'invalid_relation'
        ELSE 'import_failed'
      END;
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'row_number', v_row->>'row_number',
        'success', false,
        'error', v_error
      ));
    END;
  END LOOP;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.import_movement_rows(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_movement_rows(jsonb) TO authenticated;

COMMENT ON FUNCTION public.import_movement_rows(jsonb) IS
  '0134 (C-12): 0127 verbatim plus the per-row rule that a row attributed to another user needs movements.edit_delete (error supervisor_not_allowed). Gate: movements.import, which now requires movements.edit_delete.';

-- ===========================================================================
-- C-13  movements.activity follows the movements.read scope
-- ===========================================================================
-- em:movement_audit_logs:select:unscoped-movements.activity
UPDATE public.permissions
SET requires = array_append(requires, 'movements.read')
WHERE key = 'movements.activity'
  AND NOT ('movements.read' = ANY(requires));

-- movement_audit_logs_admin_select: latest 0127. The key test is kept; the
-- holder additionally needs the audited movement to pass the caller's
-- movements.read scope. A movements.read scope of 'all' (the admin's under
-- both mappings) reads every row, including the rows of a deleted movement,
-- exactly as it could read every movement; any narrower scope goes through
-- can_access_movement(movement_id) (0127), the one definition of the
-- per-movement scope: true only when an entry_exit_logs row with that id
-- exists and the caller recorded it or his permission_scope('movements.read')
-- allows it. So the rows of a deleted movement are visible to the 'all'
-- scope only. No role name is tested (the 0127 rule: policies decide by
-- permission keys only); the scope is evaluated once per statement.
DROP POLICY IF EXISTS movement_audit_logs_admin_select ON public.movement_audit_logs;
CREATE POLICY movement_audit_logs_admin_select ON public.movement_audit_logs
FOR SELECT TO authenticated
USING (
  (SELECT public.has_permission('movements.activity'))
  AND (
    (SELECT public.permission_scope('movements.read')) = 'all'
    OR public.can_access_movement(movement_id)
  )
);
COMMENT ON POLICY movement_audit_logs_admin_select ON public.movement_audit_logs IS
  '0134 (C-13): movements.activity (0127) AND the audited movement passes the caller''s movements.read scope (scope all reads every row, a narrower scope goes through can_access_movement). Rows of deleted movements are readable by scope all only.';

NOTIFY pgrst, 'reload schema';
