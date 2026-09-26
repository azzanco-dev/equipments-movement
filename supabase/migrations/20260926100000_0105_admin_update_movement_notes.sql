-- Owner feedback 2026-09-26: "ليش فيه فورمين منفصلين؟ خليهم واحد".
--
-- The movement detail page had two admin edit forms: the full correction of
-- 0068 (`admin_update_movement`) and the note/driver dialog of 0104
-- (`admin_update_movement_details`). They become ONE dialog with ONE save
-- path, so every field of the correction is written atomically by a single
-- function call.
--
-- 1. `public.admin_update_movement` keeps its eight 0068 parameters in the
--    same order and gains `p_notes text DEFAULT NULL` LAST. Because the
--    signature changes, the old signature is dropped first: leaving it next
--    to the new one would make PostgREST named-argument calls ambiguous.
--      * `p_notes` NULL keeps the stored note (a caller that does not know
--        about notes never erases one); any other value is trimmed, an empty
--        value clears the note (NULL) and more than 1000 characters is
--        rejected with `movement_notes_too_long`, exactly like 0104.
--      * Every 0068 validation stays: admin only (fail closed), required
--        equipment/supervisor/time, `future_time`, company AND project for a
--        site movement, the per-equipment advisory locks with the sequence
--        trigger's key, the (recorded_at, id) visit pairing, the inherited
--        site facts copied onto the paired row, and the `invalid_sequence`
--        re-check after the time or the equipment moved.
--      * Driver rules are the reviewed ones of 0104 (they replace 0068's
--        "only when no driver yet" rule, which made a wrong driver on a
--        closed visit impossible to correct):
--          - a NULL or unchanged `p_driver_id` leaves the driver untouched;
--          - workshop movements have no driver (`driver_not_supported`);
--          - an unknown driver is `invalid_driver`;
--          - a site ENTRY whose visit is still OPEN keeps its immutable
--            entry driver: `open_visit_driver_change`, the append-only
--            `change_active_movement_driver` (0040/0067) is the only path;
--          - a closed visit's ENTRY and an EXIT row are corrected in place,
--            `driver_name` being read from `public.drivers`, never trusted
--            from the caller.
--      * The contractor code keeps the 50-character limit of 0093
--        (`contractor_code_too_long`) whenever the admin changes it.
--    Audit: the AFTER UPDATE trigger `audit_entry_exit_logs` (0069/0070)
--    records every changed column, `notes` included, with the admin as the
--    actor (SECURITY DEFINER does not change `auth.uid()`).
--
-- 2. `public.admin_update_movement_details` (0104) is dropped; nothing calls
--    it any more.
--
-- 3. `public.admin_delete_movement` (0104) is recreated with the same
--    signature and body except for one runtime bug: `v_fields := v_fields ||
--    'movement_driver_changes'` resolves the untyped literal as a text[]
--    array literal and fails with "malformed array literal". Every element
--    append now uses `array_append(..., '...'::text)`.

-- ---------------------------------------------------------------------------
-- 1. One admin correction path, notes included
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid);

CREATE FUNCTION public.admin_update_movement(
  p_movement_id uuid,
  p_equipment_id uuid,
  p_supervisor_id uuid,
  p_recorded_at timestamptz,
  p_company_id uuid,
  p_project_id uuid,
  p_contractor_equipment_code text,
  p_driver_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log public.entry_exit_logs;
  v_pair public.entry_exit_logs;
  v_driver_name text;
  v_driver_changed boolean := false;
  v_has_later boolean;
  v_code text;
  v_notes text;
  v_bad boolean;
BEGIN
  -- Fail closed: no session, no profile or a non-admin role is rejected.
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may edit a movement.';
  END IF;

  SELECT l.* INTO v_log
  FROM public.entry_exit_logs l
  WHERE l.id = p_movement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'movement_not_found'
      USING HINT = 'No movement matches this identifier.';
  END IF;

  IF p_equipment_id IS NULL OR p_supervisor_id IS NULL OR p_recorded_at IS NULL THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;
  IF p_recorded_at > now() THEN
    RAISE EXCEPTION 'future_time';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.equipment e WHERE e.id = p_equipment_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_supervisor_id) THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;
  IF v_log.movement_context = 'site' AND (p_company_id IS NULL OR p_project_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;

  v_code := NULLIF(btrim(p_contractor_equipment_code), '');
  IF v_log.movement_context = 'site'
     AND v_code IS DISTINCT FROM v_log.contractor_equipment_code
     AND char_length(v_code) > 50 THEN
    RAISE EXCEPTION 'contractor_code_too_long'
      USING HINT = 'The contractor equipment code is limited to 50 characters.';
  END IF;

  -- NULL keeps the stored note; an empty value clears it.
  IF p_notes IS NULL THEN
    v_notes := v_log.notes;
  ELSE
    v_notes := NULLIF(btrim(p_notes), '');
    IF v_notes IS NOT NULL AND char_length(v_notes) > 1000 THEN
      RAISE EXCEPTION 'movement_notes_too_long'
        USING HINT = 'The note is limited to 1000 characters.';
    END IF;
  END IF;

  -- Same key as enforce_movement_sequence(): serialise against concurrent
  -- movements of the old and, when it changes, the new equipment.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_log.equipment_id::text || ':' || v_log.movement_context, 0)
  );
  IF p_equipment_id <> v_log.equipment_id THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_equipment_id::text || ':' || v_log.movement_context, 0)
    );
  END IF;

  -- Resolve the existing visit pair before changing time/equipment.
  IF v_log.movement_type = 'entry' THEN
    SELECT l.* INTO v_pair
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id
      AND l.movement_context = v_log.movement_context
      AND l.movement_type = 'exit'
      AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)
    ORDER BY l.recorded_at, l.id
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT l.* INTO v_pair
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id
      AND l.movement_context = v_log.movement_context
      AND l.movement_type = 'entry'
      AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF p_driver_id IS NOT NULL AND p_driver_id IS DISTINCT FROM v_log.driver_id THEN
    IF v_log.movement_context <> 'site' THEN
      RAISE EXCEPTION 'driver_not_supported'
        USING HINT = 'Workshop movements are recorded without a driver.';
    END IF;

    SELECT d.full_name INTO v_driver_name
    FROM public.drivers d
    WHERE d.id = p_driver_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_driver'
        USING HINT = 'The selected driver does not exist.';
    END IF;

    IF v_log.movement_type = 'entry' THEN
      -- Decided on the stored (pre-edit) position, under the lock above.
      SELECT EXISTS (
        SELECT 1
        FROM public.entry_exit_logs l
        WHERE l.equipment_id = v_log.equipment_id
          AND l.movement_context = v_log.movement_context
          AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)
      ) INTO v_has_later;

      IF NOT v_has_later THEN
        RAISE EXCEPTION 'open_visit_driver_change'
          USING HINT = 'Use change_active_movement_driver while the visit is open.';
      END IF;
    END IF;

    v_driver_changed := true;
  END IF;

  UPDATE public.entry_exit_logs l SET
    equipment_id = p_equipment_id,
    supervisor_id = p_supervisor_id,
    recorded_at = p_recorded_at,
    company_id = CASE WHEN l.movement_context = 'site' THEN p_company_id ELSE NULL END,
    project_id = CASE WHEN l.movement_context = 'site' THEN p_project_id ELSE NULL END,
    contractor_equipment_code = CASE WHEN l.movement_context = 'site' THEN v_code ELSE NULL END,
    driver_id = CASE WHEN v_driver_changed THEN p_driver_id ELSE l.driver_id END,
    driver_name = CASE WHEN v_driver_changed THEN v_driver_name ELSE l.driver_name END,
    notes = v_notes
  WHERE l.id = p_movement_id;

  -- Visit identity and inherited site facts stay consistent on both rows.
  IF v_pair.id IS NOT NULL THEN
    UPDATE public.entry_exit_logs l SET
      equipment_id = p_equipment_id,
      company_id = CASE WHEN l.movement_context = 'site' THEN p_company_id ELSE NULL END,
      project_id = CASE WHEN l.movement_context = 'site' THEN p_project_id ELSE NULL END,
      contractor_equipment_code = CASE WHEN l.movement_context = 'site' THEN v_code ELSE NULL END
    WHERE l.id = v_pair.id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT movement_type,
        lag(movement_type) OVER (PARTITION BY equipment_id, movement_context ORDER BY recorded_at, id) AS prev,
        row_number() OVER (PARTITION BY equipment_id, movement_context ORDER BY recorded_at, id) AS rn
      FROM public.entry_exit_logs
      WHERE equipment_id IN (v_log.equipment_id, p_equipment_id)
    ) s
    WHERE (s.rn = 1 AND s.movement_type <> 'entry') OR s.prev = s.movement_type
  ) INTO v_bad;
  IF v_bad THEN
    RAISE EXCEPTION 'invalid_sequence';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text) IS
  'Admin-only correction of one movement in one transaction: equipment, supervisor, recorded_at, site company/project/contractor code (copied to the paired visit row), driver and notes. Re-checks the ENTRY/EXIT sequence ordered by (recorded_at, id). An open site visit keeps its immutable entry driver: change_active_movement_driver is the only path there. p_notes NULL keeps the note, empty clears it. Audited by the audit_entry_exit_logs trigger.';

REVOKE ALL ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The separate note/driver function of 0104 is no longer used
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_update_movement_details(uuid, text, uuid, text);

-- ---------------------------------------------------------------------------
-- 3. admin_delete_movement: same body, typed array appends
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_movement(p_log_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log public.entry_exit_logs;
  v_later public.entry_exit_logs;
  v_paths text[] := '{}';
  v_changes jsonb := '[]'::jsonb;
  v_fields text[] := '{}';
  v_actor_name text;
  v_equipment_code text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may delete a movement.';
  END IF;

  SELECT l.* INTO v_log
  FROM public.entry_exit_logs l
  WHERE l.id = p_log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'movement_not_found'
      USING HINT = 'No movement matches this identifier.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_log.equipment_id::text || ':' || v_log.movement_context, 0)
  );

  SELECT l.* INTO v_later
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = v_log.equipment_id
    AND l.movement_context = v_log.movement_context
    AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)
  ORDER BY l.recorded_at, l.id
  LIMIT 1;

  IF FOUND THEN
    IF v_log.movement_type = 'entry' AND v_later.movement_type = 'exit' THEN
      RAISE EXCEPTION 'entry_has_later_exit'
        USING HINT = 'Delete the exit of this visit first.';
    END IF;
    RAISE EXCEPTION 'movement_not_last'
      USING HINT = 'Only the last movement of this equipment and context may be deleted.';
  END IF;

  SELECT COALESCE(array_agg(p.file_path ORDER BY p.sort_order, p.id), '{}')
  INTO v_paths
  FROM public.entry_exit_photos p
  WHERE p.entry_exit_log_id = p_log_id;

  IF NULLIF(btrim(v_log.photo_url), '') IS NOT NULL THEN
    v_paths := array_append(v_paths, btrim(v_log.photo_url)::text);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.changed_at, c.id), '[]'::jsonb)
  INTO v_changes
  FROM public.movement_driver_changes c
  WHERE c.entry_log_id = p_log_id;

  IF jsonb_array_length(v_changes) > 0 THEN
    v_fields := array_append(v_fields, 'movement_driver_changes'::text);
  END IF;
  IF cardinality(v_paths) > 0 THEN
    v_fields := array_append(v_fields, 'entry_exit_photos'::text);
  END IF;

  -- Extra audit row for the dependants the trigger never sees. The trigger
  -- then records the movement itself when the row below is deleted.
  IF cardinality(v_fields) > 0 THEN
    SELECT p.full_name INTO v_actor_name
    FROM public.profiles p WHERE p.id = auth.uid();
    SELECT e.code INTO v_equipment_code
    FROM public.equipment e WHERE e.id = v_log.equipment_id;

    INSERT INTO public.movement_audit_logs(
      movement_id, action, actor_id, actor_name, equipment_id, equipment_code,
      movement_type, movement_context, old_values, new_values, changed_fields
    ) VALUES (
      p_log_id, 'delete', auth.uid(), v_actor_name,
      v_log.equipment_id, v_equipment_code,
      v_log.movement_type, v_log.movement_context,
      jsonb_strip_nulls(jsonb_build_object(
        'movement', public.movement_audit_snapshot(v_log),
        'movement_driver_changes',
          CASE WHEN jsonb_array_length(v_changes) > 0 THEN v_changes END,
        'entry_exit_photos',
          CASE WHEN cardinality(v_paths) > 0 THEN to_jsonb(v_paths) END
      )),
      NULL,
      v_fields
    );
  END IF;

  DELETE FROM public.movement_driver_changes WHERE entry_log_id = p_log_id;

  -- Transaction-local marker read by protect_workshop_required_photo().
  PERFORM set_config('app.movement_delete', p_log_id::text, true);
  DELETE FROM public.entry_exit_photos WHERE entry_exit_log_id = p_log_id;

  DELETE FROM public.entry_exit_logs WHERE id = p_log_id;
  PERFORM set_config('app.movement_delete', '', true);

  RETURN v_paths;
END;
$$;

COMMENT ON FUNCTION public.admin_delete_movement(uuid) IS
  'Admin-only delete of one movement. Refuses any row that is not the last movement of its (equipment, movement_context) sequence ordered by (recorded_at, id), removes its driver-change and photo rows in the same transaction, records them in movement_audit_logs, and returns the Storage paths the API route deletes afterwards.';

REVOKE ALL ON FUNCTION public.admin_delete_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_movement(uuid) TO authenticated;
