-- 0125: one derived equipment state (wave 20).
--
-- Owner decisions 2026-10-11. The equipment had two "states" that could
-- disagree: the manual `equipment.operational_status` (تعمل / تحت الصيانة /
-- متوقفة), typed in the equipment form and the Excel files and half-maintained
-- by the workshop classification, and the state the admin home derives from
-- the latest movement. From now on there is ONE state, «الحالة», derived in
-- the database from the unit's LATEST movement across both contexts (one
-- chain per unit, ordered by `(recorded_at, id)`):
--
--   latest movement                         state            label
--   ---------------------------------------  ---------------  -------------
--   site ENTRY                               working          تعمل
--   site EXIT or workshop EXIT               available        متاحة
--   workshop ENTRY, purpose maintenance      maintenance      صيانة
--   workshop ENTRY, purpose parking          parking          وقوف
--   workshop ENTRY, purpose out_of_service   out_of_service   خارج الخدمة
--   workshop ENTRY, not classified yet       unclassified     غير مصنفة
--   no movement at all                       available        متاحة, plus
--                                                             is_new (جديدة)
--
-- Reclassifying an open workshop entry changes the state at once, because the
-- state is read from that entry's `workshop_purpose`. Sold units are a
-- separate matter: the asset status `equipment.status`.
--
-- ===========================================================================
-- 1. What changes
-- ===========================================================================
--   a. `entry_exit_logs.workshop_purpose` gains a third value,
--      `out_of_service` (خارج الخدمة). Only the classification function writes
--      the column (the movement API and forms never send it).
--   b. The manual operational status is RETIRED. The database stops writing
--      `equipment.operational_status`: `classify_workshop_entry` no longer sets
--      it to `maintenance`, the sequence trigger no longer restores it on a
--      workshop exit, and the Excel update no longer copies it. The column and
--      `entry_exit_logs.previous_operational_status` stay in the schema,
--      unused (no drop: an older client may still read them, and dropping
--      data is not needed to retire a field). The column was NOT NULL with
--      no default (0001); it now gets DEFAULT 'operational', so the form and
--      the Excel import, which stop sending it, keep inserting. The
--      quick-create functions and `equipment_current_state`
--      (0071, read by no screen) are not recreated: they only insert the
--      default or pass the stale value through.
--   c. The asset status `equipment.status` becomes `active` / `sold` only;
--      `scrapped` and `rented_out` leave the CHECK. The owner confirmed no
--      row carries them; a guard still RAISEs a clear message, naming the
--      count, instead of failing on the constraint if one does.
--   d. The derived state is served in two shapes:
--        * `admin_equipment_state` (the admin home's shared view) gains
--          `equipment_state` and `is_new`, APPENDED. Its existing `state`
--          column (the admin home's own vocabulary: inside_site,
--          workshop_maintenance, ...) keeps its name and meaning and gains
--          the value `workshop_out_of_service`; without it an out-of-service
--          unit would fall into `workshop_unclassified`. The new column is
--          named `equipment_state` because `state` is taken.
--        * Two PostgREST COMPUTED FIELDS on `equipment`,
--          `equipment_state(equipment)` and `equipment_is_new(equipment)`,
--          for the equipment list, its export and the detail page. They are
--          selected, filtered and sorted like columns
--          (`select=...,equipment_state&equipment_state=eq.working`), so the
--          list keeps reading `equipment` with its embeds, its search and its
--          server-side paging unchanged; a new view would have duplicated
--          every equipment column and moved the list, its embeds and its
--          exports onto it. This is the smaller change.
--      Both shapes call ONE mapping function,
--      `equipment_state_from_movement(type, context, purpose)`, so the
--      mapping above has exactly one definition.
--   e. The admin home functions that count or allowlist workshop purposes
--      learn `out_of_service`, so it is counted separately and never merged
--      into «غير مصنفة».
--
-- ===========================================================================
-- 2. Recreated objects (each body copied verbatim from its latest migration)
-- ===========================================================================
--   `entry_exit_logs_workshop_purpose_check`   latest: 0047. Same rule
--       (only a workshop ENTRY carries a purpose) with `out_of_service` added
--       to the allowed values.
--   `equipment_status_check`                   latest: 0102. Now
--       ('active', 'sold'), behind the guard described in 1c.
--   `public.classify_workshop_entry(uuid, text)` latest: 0109. Verbatim
--       (SECURITY DEFINER, fixed search_path, the fail-closed role check for
--       admin / workshop_manager / assistant_workshop_manager, the row lock,
--       the open-entry check, REVOKE / GRANT) except:
--         * the purpose allowlist gains 'out_of_service';
--         * the `v_current_status` variable, now unused, is removed;
--         * for an OPEN entry, the three branches that read and wrote
--           `equipment.operational_status` and
--           `entry_exit_logs.previous_operational_status` become one
--           `UPDATE ... SET workshop_purpose = p_purpose`. The closed-entry
--           branch is unchanged (it already cleared
--           previous_operational_status). The NULL-purpose behaviour of the
--           0109 check (`NULL NOT IN (...)` does not raise) is kept as is.
--   `public.enforce_movement_sequence()`       latest: 0108. Verbatim except
--       ONE statement removed: the `IF ... END IF` that restored
--       `equipment.operational_status` from the closed workshop entry's
--       `previous_operational_status` on an exit after a maintenance visit
--       (introduced in 0040, last in 0108). Locks, role checks, chain rules,
--       the M8 driver handling and the context rules are byte-for-byte
--       0108's; tests/wave20State.test.cjs compares the two bodies.
--   `public.update_equipment_from_excel(jsonb)` latest: 0102. Verbatim
--       except: the `operational_status = ...` assignment is removed (an old
--       workbook that still carries the column is accepted and the value is
--       ignored), and the status allowlist is ('active', 'sold').
--   `public.admin_equipment_state`             latest: 0118. Verbatim plus
--       the `workshop_out_of_service` branch in `state` (before the
--       unclassified fallback) and TWO columns APPENDED after
--       `last_exit_purpose`:
--         equipment_state   the mapping above applied to the latest movement
--                           the view already picks;
--         is_new            true when the unit has no movement at all.
--   `public.get_admin_fleet_state(text[])`      latest: 0102. Verbatim except
--       `workshop_out_of_service` joins the three `in_workshop` unions and a
--       `workshop_out_of_service` count is added to the result object.
--   `public.get_admin_availability_by_type(text[], text, int, int)`
--       latest: 0102. Verbatim except the `in_workshop` union.
--   `public.get_workshop_home_stats()`          latest: 0102. Verbatim plus
--       two keys, `out_of_service` and `out_of_service_yesterday`, next to
--       the maintenance and parking counts.
--   `public.get_admin_fleet_equipment(text, text[], text, int, int, text)`
--       latest: 0121. Verbatim except: p_purpose accepts 'out_of_service',
--       the workshop union and `'workshop_' || p_purpose` cover
--       `workshop_out_of_service`, the workshop-purpose sort ranks
--       maintenance, parking, out_of_service, then unclassified, and ONE OUT
--       column `is_new` is APPENDED (the «جديدة» mark of the «المتاحة» table).
--       A new OUT column changes the result type, which CREATE OR REPLACE
--       cannot do, so the function is dropped and created again inside this
--       migration with the same argument list (as 0118 and 0121 did); REVOKE,
--       GRANT and COMMENT are repeated.
--   Not recreated: `get_admin_owner_state_matrix` groups by `state` and
--   returns the new value by itself; `get_admin_outside_equipment` reads
--   `state = 'available'`, unchanged; `get_equipment_attention_report` does
--   not look at the purpose; the movement views and `get_last_movement` pass
--   the purpose through.
--
-- New objects:
--   `public.equipment_state_from_movement(text, text, text)` IMMUTABLE SQL,
--       the mapping above. A NULL type (no movement) is 'available'.
--   `public.equipment_state(public.equipment)`  STABLE SQL, SECURITY
--       INVOKER: the mapping applied to the unit's latest movement.
--   `public.equipment_is_new(public.equipment)` STABLE SQL, SECURITY
--       INVOKER: true when the unit has no movement at all.
--   All three: fixed search_path, EXECUTE revoked from PUBLIC/anon and
--   granted to `authenticated` (the invoker view and PostgREST call them as
--   the signed-in user).
--
-- ===========================================================================
-- 3. Security
-- ===========================================================================
--   No grant is widened and no role check is relaxed. The two recreated
--   SECURITY DEFINER functions keep their checks verbatim. The view stays
--   security_invoker; the new computed fields are SECURITY INVOKER, so
--   entry_exit_logs RLS decides which movements they see: an admin or a
--   monitor (the equipment list and detail are admin screens) sees every
--   movement and therefore the true state. The inquiry, which foremen use,
--   derives its state from `get_last_movement` (SECURITY DEFINER, 0109) with
--   the same mapping on the client (`equipmentStateFromMovement`).
--
-- ===========================================================================
-- 4. Compatibility with the deployed UI (rollout: this migration first, then
--    the UI)
-- ===========================================================================
--   * The live equipment form and Excel import still send
--     `operational_status`; the column still exists, so their writes keep
--     working. The live Excel update still sends it; the function now ignores
--     it.
--   * The live UI offers sold / scrapped / rented out. Saving scrapped or
--     rented out is rejected by the new CHECK (the owner confirmed nobody uses
--     them); active and sold keep working.
--   * The view gains columns at the end only, and `state` only gains a value
--     no live client can produce (the live classification menu offers
--     maintenance and parking), so every live select is unaffected.
--   * `get_admin_fleet_state` and `get_workshop_home_stats` gain JSON keys,
--     which the live parsers ignore.
--   * `get_admin_fleet_equipment`: same name and argument types, so the live
--     five- and six-argument named calls resolve to it; the extra `is_new`
--     key is ignored by the live `parseFleetEquipmentRows`.
--   * The new UI selects `equipment_state` / `equipment_is_new` and offers
--     `out_of_service`, so it must be deployed AFTER this migration.
--
-- ===========================================================================
-- 5. Indexes
-- ===========================================================================
--   None. The latest-movement lookups use
--   `idx_entry_exit_logs_equipment_time (equipment_id, recorded_at, id)`
--   (0043), exactly like the view. Filtering the equipment list by state
--   evaluates the computed field once per equipment row (one index probe
--   each) over a table of a few thousand rows, the same cost the admin home
--   view already pays; no index can hold a value that depends on another
--   table.

-- ===========================================================================
-- 1. The asset status: active / sold only
-- ===========================================================================
-- The owner confirmed no row is scrapped or rented out. Should one exist, the
-- migration stops here with a message that says what to fix, instead of the
-- bare constraint violation the ADD CONSTRAINT below would raise.
DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.equipment
  WHERE status NOT IN ('active', 'sold');
  IF v_count > 0 THEN
    RAISE EXCEPTION
      '0125: % equipment row(s) still have status scrapped or rented_out; set them to active or sold before applying this migration',
      v_count;
  END IF;
END;
$$;

ALTER TABLE public.equipment
  DROP CONSTRAINT IF EXISTS equipment_status_check;
ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_status_check
  CHECK (status IN ('active', 'sold'));

COMMENT ON COLUMN public.equipment.status IS
  'Equipment asset status: active (in the fleet) or sold (since 0125; '
  'scrapped and rented_out were retired). Only ''active'' counts as part of '
  'the fleet, and every fleet predicate is (is_active AND status = '
  '''active''). The operational state is not stored: it is derived from the '
  'latest movement (equipment_state, migration 0125).';

-- The retired column is NOT NULL with no default (0001). The new form and
-- Excel import no longer send it, so an insert takes this neutral default
-- instead of failing. Existing values are left as they are.
ALTER TABLE public.equipment
  ALTER COLUMN operational_status SET DEFAULT 'operational';

COMMENT ON COLUMN public.equipment.operational_status IS
  'RETIRED in 0125: no longer shown, imported or written by the database. '
  'The equipment state is derived from the latest movement '
  '(public.equipment_state / admin_equipment_state.equipment_state). Kept, '
  'unused, for compatibility.';

COMMENT ON COLUMN public.entry_exit_logs.previous_operational_status IS
  'RETIRED in 0125: classify_workshop_entry and the sequence trigger no '
  'longer read or write it. Kept, unused, for compatibility.';

-- ===========================================================================
-- 2. The workshop purpose: maintenance / parking / out_of_service
-- ===========================================================================
-- 0047's rule verbatim (only a workshop ENTRY carries a purpose) with the
-- third value. Every existing row satisfies it, since the allowed set only
-- grows.
ALTER TABLE public.entry_exit_logs
  DROP CONSTRAINT IF EXISTS entry_exit_logs_workshop_purpose_check;
ALTER TABLE public.entry_exit_logs
  ADD CONSTRAINT entry_exit_logs_workshop_purpose_check
  CHECK (
    workshop_purpose IS NULL
    OR (
      movement_context = 'workshop'
      AND movement_type = 'entry'
      AND workshop_purpose IN ('maintenance', 'parking', 'out_of_service')
    )
  );

COMMENT ON COLUMN public.entry_exit_logs.workshop_purpose IS
  'Classification of a workshop ENTRY: maintenance (صيانة), parking (وقوف) '
  'or out_of_service (خارج الخدمة, since 0125); NULL until classified and on '
  'every other row. Written only by classify_workshop_entry.';

-- ===========================================================================
-- 3. Workshop classification (0109's body; the operational status retired)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.classify_workshop_entry(p_entry_log_id uuid, p_purpose text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_entry public.entry_exit_logs;
  v_is_open boolean;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'workshop_manager', 'assistant_workshop_manager') THEN
    RAISE EXCEPTION 'workshop manager required';
  END IF;
  IF p_purpose NOT IN ('maintenance', 'parking', 'out_of_service') THEN
    RAISE EXCEPTION 'invalid workshop purpose';
  END IF;

  SELECT * INTO v_entry
  FROM public.entry_exit_logs
  WHERE id = p_entry_log_id
    AND movement_context = 'workshop'
    AND movement_type = 'entry'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workshop entry not found'; END IF;

  v_is_open := NOT EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_entry.equipment_id
      AND (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id)
  );
  IF NOT v_is_open THEN
    UPDATE public.entry_exit_logs
    SET workshop_purpose = p_purpose, previous_operational_status = NULL
    WHERE id = v_entry.id;
    RETURN;
  END IF;

  -- 0125: an open entry only records its purpose. The equipment state is
  -- derived from this row (equipment_state_from_movement), so nothing
  -- else is written: operational_status and previous_operational_status
  -- are retired.
  UPDATE public.entry_exit_logs
  SET workshop_purpose = p_purpose
  WHERE id = v_entry.id;
END;
$$;

REVOKE ALL ON FUNCTION public.classify_workshop_entry(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classify_workshop_entry(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.classify_workshop_entry(uuid, text) IS
  'Sets the purpose of a workshop ENTRY: maintenance, parking or '
  'out_of_service (0125). Admin, workshop_manager and '
  'assistant_workshop_manager only. Since 0125 it writes nothing else: the '
  'equipment state is derived from the latest movement, so reclassifying an '
  'open entry changes the state at once.';

-- ===========================================================================
-- 4. Sequence trigger (0108's body; one statement removed)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before text;
  v_after text;
  v_last_entry record;
  v_role text;
BEGIN
  NEW.created_at := now();
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  IF NEW.movement_type NOT IN ('entry', 'exit')
     OR NEW.movement_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'invalid movement';
  END IF;
  IF NEW.recorded_at > now() THEN
    RAISE EXCEPTION 'movement time cannot be in the future';
  END IF;

  IF NEW.movement_context = 'workshop' THEN
    -- Fail closed: a missing profile (NULL role) is rejected too, because
    -- `NULL NOT IN (...)` alone evaluates to NULL and would not raise.
    IF v_role IS NULL
       OR v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager') THEN
      RAISE EXCEPTION 'workshop role required';
    END IF;
    NEW.company_id := NULL;
    NEW.project_id := NULL;
    NEW.contractor_equipment_code := NULL;
    NEW.driver_id := NULL;
    NEW.driver_name := NULL;
  ELSE
    IF v_role IS NULL OR v_role NOT IN ('admin', 'supervisor') THEN
      RAISE EXCEPTION 'foreman role required';
    END IF;
    IF NEW.movement_type = 'entry' THEN
      IF NEW.company_id IS NULL THEN RAISE EXCEPTION 'company_id is required for an entry'; END IF;
      IF NEW.project_id IS NULL THEN RAISE EXCEPTION 'project_id is required for an entry'; END IF;
      -- Owner decision 2026-09-23: a site ENTRY may be registered without a
      -- driver. A supplied `driver_id` is resolved against the driver master
      -- so the `driver_name` snapshot can never be forged.
      IF NEW.driver_id IS NULL THEN
        -- A driverless entry stores NULL in both columns. A name without an
        -- id is kept only for the admin Excel import (0063), the one path
        -- that legitimately writes one.
        IF current_setting('app.movement_excel_import', true) = 'true'
           AND v_role = 'admin' THEN
          NEW.driver_name := NULLIF(btrim(NEW.driver_name), '');
        ELSE
          NEW.driver_name := NULL;
        END IF;
      ELSE
        SELECT d.full_name INTO NEW.driver_name
        FROM public.drivers d
        WHERE d.id = NEW.driver_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'invalid driver_id'; END IF;
      END IF;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));
  SELECT l.movement_type INTO v_before
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
  SELECT l.movement_type INTO v_after
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND (l.recorded_at, l.id) > (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at, l.id
  LIMIT 1;

  IF (v_before IS NOT NULL AND v_before = NEW.movement_type)
     OR (v_after IS NOT NULL AND v_after = NEW.movement_type) THEN
    RAISE EXCEPTION 'sequence would be invalid';
  END IF;
  IF NEW.movement_type = 'exit' AND v_before IS NULL THEN
    RAISE EXCEPTION 'no prior entry found for this equipment';
  END IF;

  IF NEW.movement_type = 'exit' THEN
    SELECT l.* INTO v_last_entry
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id
      AND l.movement_type = 'entry'
      AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'no prior entry found for this equipment'; END IF;

    -- Owner decisions 2026-09-17, 2026-09-19 and 2026-09-30: an EXIT closes
    -- an ENTRY of its OWN context only, and a site exit only for the foreman
    -- who opened the visit. Admins are exempt from both.
    IF NOT public.is_admin() THEN
      IF NEW.movement_context = 'site' THEN
        IF v_last_entry.movement_context IS DISTINCT FROM 'site' THEN
          RAISE EXCEPTION 'exit_equipment_in_workshop'
            USING ERRCODE = '42501',
                  HINT = 'The equipment is inside the workshop; a site exit cannot close a workshop entry.';
        END IF;
        IF v_last_entry.supervisor_id IS DISTINCT FROM auth.uid() THEN
          RAISE EXCEPTION 'exit_not_entry_owner'
            USING ERRCODE = '42501',
                  HINT = 'Only the foreman who registered the entry, or an admin, may register this exit.';
        END IF;
      ELSE
        IF v_last_entry.movement_context IS DISTINCT FROM 'workshop' THEN
          RAISE EXCEPTION 'exit_equipment_on_site'
            USING ERRCODE = '42501',
                  HINT = 'The equipment is inside a site; a workshop exit cannot close a site entry.';
        END IF;
      END IF;
    END IF;

    NEW.company_id := v_last_entry.company_id;
    NEW.project_id := v_last_entry.project_id;
    NEW.contractor_equipment_code := v_last_entry.contractor_equipment_code;
    IF NEW.movement_context = 'site' THEN
      -- Both branches may assign NULL: since 2026-09-23 the open visit may
      -- have been opened without a driver, and an exit that inherits NULL is
      -- correct rather than an error.
      SELECT c.new_driver_id, c.new_driver_name INTO NEW.driver_id, NEW.driver_name
      FROM public.movement_driver_changes c
      WHERE c.entry_log_id = v_last_entry.id
      ORDER BY c.changed_at DESC, c.id DESC
      LIMIT 1;
      IF NOT FOUND THEN
        NEW.driver_id := v_last_entry.driver_id;
        NEW.driver_name := v_last_entry.driver_name;
      END IF;
    END IF;
    -- 0125: the operational_status restore that stood here is removed; the
    -- equipment state is derived from the latest movement instead.
  END IF;
  RETURN NEW;
END;
$$;

-- A trigger function is never called directly (0025). Repeated so the state
-- is explicit in the file that holds the live definition.
REVOKE ALL ON FUNCTION public.enforce_movement_sequence()
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 5. The Excel update (0102's body; no operational status, two statuses)
-- ===========================================================================
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
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
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

-- ===========================================================================
-- 6. The one state mapping, and the two computed fields on `equipment`
-- ===========================================================================
-- The only definition of the mapping. NULL type means "no movement at all".
CREATE OR REPLACE FUNCTION public.equipment_state_from_movement(
  p_movement_type text,
  p_movement_context text,
  p_workshop_purpose text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_movement_type IS NULL THEN 'available'
    WHEN p_movement_type <> 'entry' THEN 'available'
    WHEN p_movement_context = 'workshop' THEN
      CASE p_workshop_purpose
        WHEN 'maintenance' THEN 'maintenance'
        WHEN 'parking' THEN 'parking'
        WHEN 'out_of_service' THEN 'out_of_service'
        ELSE 'unclassified'
      END
    ELSE 'working'
  END
$$;

REVOKE ALL ON FUNCTION
  public.equipment_state_from_movement(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.equipment_state_from_movement(text, text, text) TO authenticated;

COMMENT ON FUNCTION public.equipment_state_from_movement(text, text, text) IS
  'The equipment state of a unit whose LATEST movement has this type, '
  'context and workshop purpose: site entry = working; any exit = available; '
  'workshop entry = maintenance, parking, out_of_service or unclassified; no '
  'movement (NULL type) = available. The single definition shared by '
  'admin_equipment_state and the equipment_state computed field (0125).';

-- PostgREST computed field: `select=...,equipment_state`, filterable and
-- sortable like a column. SECURITY INVOKER, so entry_exit_logs RLS applies.
CREATE OR REPLACE FUNCTION public.equipment_state(p_equipment public.equipment)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT public.equipment_state_from_movement(
        l.movement_type, l.movement_context, l.workshop_purpose
      )
      FROM public.entry_exit_logs l
      WHERE l.equipment_id = p_equipment.id
      ORDER BY l.recorded_at DESC, l.id DESC
      LIMIT 1
    ),
    public.equipment_state_from_movement(NULL, NULL, NULL)
  )
$$;

REVOKE ALL ON FUNCTION public.equipment_state(public.equipment)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_state(public.equipment)
  TO authenticated;

COMMENT ON FUNCTION public.equipment_state(public.equipment) IS
  'Computed field: the equipment state (working, available, maintenance, '
  'parking, out_of_service, unclassified) from the unit''s latest movement '
  'across both contexts, ordered by (recorded_at DESC, id DESC). SECURITY '
  'INVOKER, so entry_exit_logs RLS decides which movements are seen (0125).';

CREATE OR REPLACE FUNCTION public.equipment_is_new(p_equipment public.equipment)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = p_equipment.id
  )
$$;

REVOKE ALL ON FUNCTION public.equipment_is_new(public.equipment)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_is_new(public.equipment)
  TO authenticated;

COMMENT ON FUNCTION public.equipment_is_new(public.equipment) IS
  'Computed field: true when the unit has no movement at all (shown as '
  '«جديدة» next to its available state). SECURITY INVOKER (0125).';

-- ===========================================================================
-- 7. The admin home's shared state view (0118's definition, two columns
--    appended)
-- ===========================================================================
CREATE OR REPLACE VIEW public.admin_equipment_state
WITH (security_invoker = true)
AS
SELECT
  e.id,
  e.code,
  e.type,
  e.ownership_status,
  e.is_active,
  m.recorded_at AS last_movement_at,
  m.movement_type AS last_movement_type,
  m.movement_context AS last_movement_context,
  m.workshop_purpose AS last_workshop_purpose,
  CASE
    WHEN m.id IS NULL THEN 'available'
    WHEN m.movement_type <> 'entry' THEN 'available'
    WHEN m.movement_context = 'workshop'
      AND m.workshop_purpose = 'maintenance' THEN 'workshop_maintenance'
    WHEN m.movement_context = 'workshop'
      AND m.workshop_purpose = 'parking' THEN 'workshop_parking'
    WHEN m.movement_context = 'workshop'
      AND m.workshop_purpose = 'out_of_service' THEN 'workshop_out_of_service'
    WHEN m.movement_context = 'workshop' THEN 'workshop_unclassified'
    ELSE 'inside_site'
  END AS state,
  e.status,
  -- Appended in 0107. They describe the same latest movement as the columns
  -- above; all three are NULL for equipment that has never moved.
  m.id AS last_movement_id,
  m.company_id AS last_company_id,
  m.project_id AS last_project_id,
  -- Appended in 0118: the site exit purpose (0111) of that same latest
  -- movement; NULL unless it is a site exit recorded with a purpose.
  m.exit_purpose AS last_exit_purpose,
  -- Appended in 0125: the one equipment state (working, available,
  -- maintenance, parking, out_of_service, unclassified) of that same
  -- latest movement, and whether the unit has never moved.
  public.equipment_state_from_movement(
    m.movement_type, m.movement_context, m.workshop_purpose
  ) AS equipment_state,
  (m.id IS NULL) AS is_new
FROM public.equipment e
LEFT JOIN LATERAL (
  SELECT
    l.id,
    l.movement_type,
    l.movement_context,
    l.workshop_purpose,
    l.recorded_at,
    l.company_id,
    l.project_id,
    l.exit_purpose
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = e.id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1
) m ON true;

REVOKE ALL ON public.admin_equipment_state FROM PUBLIC, anon;
GRANT SELECT ON public.admin_equipment_state TO authenticated;

COMMENT ON VIEW public.admin_equipment_state IS
  'Every equipment row with the state derived from its latest movement across '
  'both contexts, ordered by (recorded_at DESC, id DESC). security_invoker, '
  'so equipment and entry_exit_logs RLS stay authoritative. Shared by the '
  'admin home functions so "current state" has exactly one definition. '
  'Carries both is_active and status; the fleet predicate is '
  '(is_active AND status = ''active''). last_movement_id, last_company_id and '
  'last_project_id (0107) identify that same latest movement; '
  'last_exit_purpose (0118) is its site exit purpose, if any. Since 0125 '
  'state also yields workshop_out_of_service, and equipment_state / is_new '
  'are the one equipment state (equipment_state_from_movement) and whether '
  'the unit has never moved.';

-- ===========================================================================
-- 8. The admin home counts (0102's bodies; out_of_service counted)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_admin_fleet_state(
  p_owners text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_owners text[];
  v_result jsonb;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  WITH scoped AS (
    SELECT s.ownership_status, s.type, s.state, s.last_movement_at
    FROM public.admin_equipment_state s
    WHERE s.is_active AND s.status = 'active'
      AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
  ),
  owners AS (
    SELECT jsonb_agg(row_to_json(o)::jsonb ORDER BY o.total DESC, o.owner) AS v
    FROM (
      SELECT
        c.ownership_status AS owner,
        count(*)::int AS total,
        count(*) FILTER (WHERE c.state = 'inside_site')::int AS inside_sites,
        count(*) FILTER (WHERE c.state IN (
          'workshop_maintenance', 'workshop_parking', 'workshop_out_of_service',
          'workshop_unclassified'
        ))::int AS in_workshop,
        count(*) FILTER (WHERE c.state = 'available')::int AS available
      FROM scoped c
      GROUP BY c.ownership_status
    ) o
  ),
  types AS (
    SELECT jsonb_agg(row_to_json(y)::jsonb ORDER BY y.total DESC, y.type) AS v
    FROM (
      SELECT
        c.type,
        count(*)::int AS total,
        count(*) FILTER (WHERE c.state = 'inside_site')::int AS inside_sites,
        count(*) FILTER (WHERE c.state IN (
          'workshop_maintenance', 'workshop_parking', 'workshop_out_of_service',
          'workshop_unclassified'
        ))::int AS in_workshop,
        count(*) FILTER (WHERE c.state = 'available')::int AS available
      FROM scoped c
      GROUP BY c.type
      ORDER BY count(*) DESC, c.type
      LIMIT 30
    ) y
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM scoped),
    'inside_sites',
      (SELECT count(*) FILTER (WHERE state = 'inside_site')::int FROM scoped),
    'in_workshop',
      (SELECT count(*) FILTER (WHERE state IN (
        'workshop_maintenance', 'workshop_parking', 'workshop_out_of_service',
          'workshop_unclassified'
      ))::int FROM scoped),
    'workshop_maintenance',
      (SELECT count(*) FILTER (WHERE state = 'workshop_maintenance')::int
       FROM scoped),
    'workshop_parking',
      (SELECT count(*) FILTER (WHERE state = 'workshop_parking')::int
       FROM scoped),
    'workshop_out_of_service',
      (SELECT count(*) FILTER (WHERE state = 'workshop_out_of_service')::int
       FROM scoped),
    'workshop_unclassified',
      (SELECT count(*) FILTER (WHERE state = 'workshop_unclassified')::int
       FROM scoped),
    'available',
      (SELECT count(*) FILTER (WHERE state = 'available')::int FROM scoped),
    'idle_30', (SELECT count(*) FILTER (
      WHERE last_movement_at IS NULL
        OR last_movement_at < now() - interval '30 days')::int FROM scoped),
    'idle_60', (SELECT count(*) FILTER (
      WHERE last_movement_at IS NULL
        OR last_movement_at < now() - interval '60 days')::int FROM scoped),
    'idle_90', (SELECT count(*) FILTER (
      WHERE last_movement_at IS NULL
        OR last_movement_at < now() - interval '90 days')::int FROM scoped),
    'never_moved',
      (SELECT count(*) FILTER (WHERE last_movement_at IS NULL)::int
       FROM scoped),
    'by_owner', COALESCE((SELECT v FROM owners), '[]'::jsonb),
    'by_type', COALESCE((SELECT v FROM types), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_fleet_state(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_fleet_state(text[]) TO authenticated;

COMMENT ON FUNCTION public.get_admin_fleet_state(text[]) IS
  'Admin home: how many fleet equipment (is_active AND status = ''active'') '
  'are inside sites, in the workshop (split maintenance / parking / out of '
  'service (0125) / not classified) and available right now, the 30/60/90-day '
  'no-movement breakdown, and the same counts per owner and per equipment '
  'type. p_owners is a validated list of ownership_status values; NULL or '
  'empty means every owner. SECURITY INVOKER plus an admin/monitor role check.';

CREATE OR REPLACE FUNCTION public.get_admin_availability_by_type(
  p_owners text[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  type text,
  inside_sites int,
  in_workshop int,
  available int,
  total int,
  total_count int
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 500);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_owners text[];
  v_term text;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);
  v_term := NULLIF(
    btrim(translate(left(COALESCE(p_search, ''), 80), '%_' || chr(92), '')),
    ''
  );

  RETURN QUERY
  SELECT
    grouped.type,
    grouped.inside_sites,
    grouped.in_workshop,
    grouped.available,
    grouped.total,
    count(*) OVER ()::int AS total_count
  FROM (
    SELECT
      s.type AS type,
      count(*) FILTER (WHERE s.state = 'inside_site')::int AS inside_sites,
      count(*) FILTER (WHERE s.state IN (
        'workshop_maintenance', 'workshop_parking', 'workshop_out_of_service',
          'workshop_unclassified'
      ))::int AS in_workshop,
      count(*) FILTER (WHERE s.state = 'available')::int AS available,
      count(*)::int AS total
    FROM public.admin_equipment_state s
    WHERE s.is_active AND s.status = 'active'
      AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
      AND (v_term IS NULL OR s.type ILIKE '%' || v_term || '%')
    GROUP BY s.type
  ) grouped
  ORDER BY grouped.total DESC, grouped.type
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_admin_availability_by_type(text[], text, int, int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_admin_availability_by_type(text[], text, int, int)
  TO authenticated;

COMMENT ON FUNCTION
  public.get_admin_availability_by_type(text[], text, int, int) IS
  'Admin home: one page of the per-type availability - how many fleet units '
  '(is_active AND status = ''active'') of each equipment type are inside '
  'sites, in the workshop (every purpose, out_of_service included since 0125) '
  'and available, and the type total - biggest type first. p_search is a '
  'wildcard-stripped ILIKE on the type and applies across every page; every '
  'row carries total_count, the number of matching types. p_limit is clamped '
  'to 1..500, p_offset to >= 0 and p_owners is validated. SECURITY INVOKER '
  'plus an admin/monitor role check.';

-- ===========================================================================
-- 9. The workshop home stats (0102's body; two keys added)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_workshop_home_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH today AS (
  SELECT date_trunc('day', now() AT TIME ZONE INTERVAL '+03:00')
           AT TIME ZONE INTERVAL '+03:00' AS starts
),
fleet_movements AS (
  SELECT l.id, l.equipment_id, l.movement_type, l.workshop_purpose,
         l.recorded_at
  FROM public.entry_exit_logs l
  JOIN public.equipment e ON e.id = l.equipment_id
  WHERE l.movement_context = 'workshop'
    AND e.is_active
    AND e.status = 'active'
),
latest AS (
  SELECT DISTINCT ON (m.equipment_id)
    m.id, m.equipment_id, m.movement_type, m.workshop_purpose, m.recorded_at
  FROM fleet_movements m
  ORDER BY m.equipment_id, m.recorded_at DESC, m.id DESC
),
inside AS (
  SELECT id, equipment_id, workshop_purpose, recorded_at
  FROM latest
  WHERE movement_type = 'entry'
),
latest_yesterday AS (
  SELECT DISTINCT ON (m.equipment_id)
    m.equipment_id, m.movement_type, m.workshop_purpose
  FROM fleet_movements m, today
  WHERE m.recorded_at < today.starts
  ORDER BY m.equipment_id, m.recorded_at DESC, m.id DESC
),
inside_yesterday AS (
  SELECT equipment_id, workshop_purpose
  FROM latest_yesterday
  WHERE movement_type = 'entry'
),
pending AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'equipment_id', p.equipment_id,
      'equipment_code', e.code,
      'equipment_type', e.type,
      'recorded_at', p.recorded_at
    )
    ORDER BY p.recorded_at DESC, p.id DESC
  ) AS value
  FROM (
    SELECT id, equipment_id, recorded_at
    FROM inside
    WHERE workshop_purpose IS NULL
    ORDER BY recorded_at DESC, id DESC
    LIMIT 10
  ) p
  LEFT JOIN public.equipment e ON e.id = p.equipment_id
)
SELECT jsonb_build_object(
  'inside_now', (SELECT count(*)::int FROM inside),
  'maintenance',
    (SELECT count(*)::int FROM inside WHERE workshop_purpose = 'maintenance'),
  'parking',
    (SELECT count(*)::int FROM inside WHERE workshop_purpose = 'parking'),
  'out_of_service',
    (SELECT count(*)::int FROM inside
     WHERE workshop_purpose = 'out_of_service'),
  'pending_classification',
    (SELECT count(*)::int FROM inside WHERE workshop_purpose IS NULL),
  'inside_yesterday', (SELECT count(*)::int FROM inside_yesterday),
  'maintenance_yesterday',
    (SELECT count(*)::int FROM inside_yesterday
     WHERE workshop_purpose = 'maintenance'),
  'parking_yesterday',
    (SELECT count(*)::int FROM inside_yesterday
     WHERE workshop_purpose = 'parking'),
  'out_of_service_yesterday',
    (SELECT count(*)::int FROM inside_yesterday
     WHERE workshop_purpose = 'out_of_service'),
  'pending', COALESCE((SELECT value FROM pending), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.get_workshop_home_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workshop_home_stats() TO authenticated;

COMMENT ON FUNCTION public.get_workshop_home_stats() IS
  'Workshop home stats: fleet equipment (is_active AND status = ''active'') '
  'whose latest visible workshop movement is an ENTRY, split into maintenance '
  '/ parking / out of service (0125) / not classified yet, the same counts as '
  'of the start of today (Saudi midnight) for the change since yesterday, '
  'plus the latest 10 unclassified open entries as `pending`. SECURITY '
  'INVOKER, so entry_exit_logs RLS stays authoritative.';

-- ===========================================================================
-- 10. One page of the equipment in one fleet state (0121's body, the new
--     purpose, one OUT column appended)
-- ===========================================================================
-- The result type gains a column, which CREATE OR REPLACE cannot change: the
-- function is dropped and created again in this same transaction with the
-- same argument list.
DROP FUNCTION IF EXISTS public.get_admin_fleet_equipment(text, text[], text, int, int, text);

CREATE FUNCTION public.get_admin_fleet_equipment(
  p_state text,
  p_owners text[] DEFAULT NULL,
  p_purpose text DEFAULT NULL,
  p_limit int DEFAULT 7,
  p_offset int DEFAULT 0,
  p_sort text DEFAULT NULL
)
RETURNS TABLE(
  total_count int,
  id uuid,
  code text,
  type text,
  ownership_status text,
  state text,
  since timestamptz,
  last_movement_id uuid,
  last_movement_type text,
  last_movement_context text,
  workshop_purpose text,
  company_name_ar text,
  company_name_en text,
  project_name_ar text,
  project_name_en text,
  last_exit_purpose text,
  is_new boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  -- 500 is the largest page size the shared list system offers, and the
  -- Excel export walks the function in pages of 500.
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 7), 1), 500);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_owners text[];
  v_states text[];
  -- 0121: the requested order; NULL is the order the tables always had.
  v_sort text := COALESCE(p_sort, 'last_movement_desc');
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_state IS NULL
     OR p_state NOT IN ('inside_site', 'workshop', 'available') THEN
    RAISE EXCEPTION 'unknown fleet state' USING ERRCODE = '22023';
  END IF;
  IF p_purpose IS NOT NULL THEN
    IF p_state <> 'workshop' THEN
      RAISE EXCEPTION 'a workshop purpose requires the workshop state'
        USING ERRCODE = '22023';
    END IF;
    IF p_purpose NOT IN (
      'maintenance', 'parking', 'out_of_service', 'unclassified'
    ) THEN
      RAISE EXCEPTION 'unknown workshop purpose' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- 0121: allowlisted, like p_state and p_purpose.
  IF v_sort NOT IN (
    'last_movement_desc', 'last_movement_asc',
    'code_asc', 'code_desc',
    'type_asc', 'type_desc',
    'owner_asc', 'owner_desc',
    'company_asc', 'company_desc',
    'workshop_purpose_asc', 'workshop_purpose_desc',
    'exit_purpose_asc', 'exit_purpose_desc'
  ) THEN
    RAISE EXCEPTION 'unknown fleet sort' USING ERRCODE = '22023';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  -- The `state` values of `admin_equipment_state` this request covers.
  -- "workshop" is the union of the three workshop states, exactly as the
  -- "في الورشة الان" card counts it.
  v_states := CASE
    WHEN p_state = 'workshop' AND p_purpose IS NULL THEN ARRAY[
      'workshop_maintenance', 'workshop_parking', 'workshop_out_of_service',
      'workshop_unclassified'
    ]
    WHEN p_state = 'workshop' THEN ARRAY['workshop_' || p_purpose]
    ELSE ARRAY[p_state]
  END;

  RETURN QUERY
  SELECT
    -- Window functions are evaluated before LIMIT / OFFSET, so this is the
    -- size of the whole filtered set and is identical on every returned row.
    count(*) OVER ()::int AS total_count,
    s.id,
    s.code,
    s.type,
    s.ownership_status,
    s.state,
    -- The latest movement's time: the entry for a unit inside a site or in
    -- the workshop, the exit for an available one, NULL if it never moved.
    s.last_movement_at AS since,
    s.last_movement_id,
    s.last_movement_type,
    s.last_movement_context,
    s.last_workshop_purpose AS workshop_purpose,
    c.name_ar AS company_name_ar,
    c.name_en AS company_name_en,
    p.name_ar AS project_name_ar,
    p.name_en AS project_name_en,
    -- 0118: appended. The purpose of the site exit that made a unit
    -- available; NULL for every other row.
    s.last_exit_purpose,
    -- 0125: appended. True for a unit that has never moved (the «جديدة»
    -- mark); only the available table can contain one.
    s.is_new
  FROM public.admin_equipment_state s
  LEFT JOIN public.companies c ON c.id = s.last_company_id
  LEFT JOIN public.projects p ON p.id = s.last_project_id
  WHERE s.is_active
    AND s.status = 'active'
    AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
    AND s.state = ANY(v_states)
  -- 0121: the requested column first. Each term is NULL on every row unless
  -- it is the requested one, so exactly one of them orders the rows; empty
  -- values go last in both directions.
  ORDER BY
    CASE WHEN v_sort = 'code_asc' THEN s.code END ASC NULLS LAST,
    CASE WHEN v_sort = 'code_desc' THEN s.code END DESC NULLS LAST,
    CASE WHEN v_sort = 'type_asc' THEN s.type END ASC NULLS LAST,
    CASE WHEN v_sort = 'type_desc' THEN s.type END DESC NULLS LAST,
    CASE WHEN v_sort = 'owner_asc' THEN array_position(
      ARRAY[
        'alazani', 'takween', 'third_party_f', 'third_party_partnership_b',
        'external_supplier'
      ],
      s.ownership_status
    ) END ASC NULLS LAST,
    CASE WHEN v_sort = 'owner_desc' THEN array_position(
      ARRAY[
        'alazani', 'takween', 'third_party_f', 'third_party_partnership_b',
        'external_supplier'
      ],
      s.ownership_status
    ) END DESC NULLS LAST,
    CASE WHEN v_sort = 'company_asc' THEN c.name_ar END ASC NULLS LAST,
    CASE WHEN v_sort = 'company_asc' THEN p.name_ar END ASC NULLS LAST,
    CASE WHEN v_sort = 'company_desc' THEN c.name_ar END DESC NULLS LAST,
    CASE WHEN v_sort = 'company_desc' THEN p.name_ar END DESC NULLS LAST,
    CASE WHEN v_sort = 'workshop_purpose_asc' THEN COALESCE(
      array_position(
        ARRAY['maintenance', 'parking', 'out_of_service'],
        s.last_workshop_purpose
      ),
      4
    ) END ASC NULLS LAST,
    CASE WHEN v_sort = 'workshop_purpose_desc' THEN COALESCE(
      array_position(
        ARRAY['maintenance', 'parking', 'out_of_service'],
        s.last_workshop_purpose
      ),
      4
    ) END DESC NULLS LAST,
    CASE WHEN v_sort = 'exit_purpose_asc' THEN s.last_exit_purpose END ASC NULLS LAST,
    CASE WHEN v_sort = 'exit_purpose_desc' THEN s.last_exit_purpose END DESC NULLS LAST,
    CASE WHEN v_sort = 'last_movement_asc' THEN s.last_movement_at END ASC NULLS LAST,
  -- Most recent movement first, and equipment that has never moved last (it
  -- has no date to sort by). `id` breaks ties so paging is deterministic and
  -- a row can never appear on two pages or on none.
    s.last_movement_at DESC NULLS LAST, s.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_admin_fleet_equipment(text, text[], text, int, int, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_admin_fleet_equipment(text, text[], text, int, int, text)
  TO authenticated;

COMMENT ON FUNCTION
  public.get_admin_fleet_equipment(text, text[], text, int, int, text) IS
  'Admin home: one page of the active equipment (is_active AND status = '
  '''active'') in one fleet state - inside_site, workshop (optionally one '
  'purpose: maintenance, parking, out_of_service (0125) or unclassified) or '
  'available - with the company and project of its latest movement. Ordered '
  'by the latest movement descending with never-moved rows last, and every '
  'row carries total_count, the size of the whole filtered set. p_state and '
  'p_purpose are allowlisted, p_limit is clamped to 1..500, p_offset to >= 0 '
  'and p_owners is validated. SECURITY INVOKER plus an admin/monitor role '
  'check. last_exit_purpose (0118) is the site exit purpose of the latest '
  'movement, if any. p_sort (0121) is an allowlisted order (last_movement, '
  'code, type, owner, company, workshop_purpose or exit_purpose, each _asc or '
  '_desc; NULL = last_movement_desc); every order ends with id. is_new '
  '(0125) is true for a unit that has never moved.';

NOTIFY pgrst, 'reload schema';
