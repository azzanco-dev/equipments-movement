-- 0186: the admin corrects the purpose of a project (site) exit.
--
-- Owner 2026-11-09, «اضف تعديل غرض الخروج للادمن في مربع التعديل»: until now
-- nothing could change `entry_exit_logs.exit_purpose` (0111 / 0115) after the
-- exit was saved; the BEFORE INSERT trigger enforce_site_exit_purpose only
-- checks a new row.
--
-- `admin_update_movement` gains a tenth parameter `p_exit_purpose text
-- DEFAULT NULL`:
--   * NULL keeps the stored purpose (every caller before 0186);
--   * on a SITE EXIT the value must be `maintenance` or `work_completed`
--     (token `invalid_exit_purpose`, 22023); the UPDATE sets
--     exit_purpose = COALESCE(p_exit_purpose, exit_purpose) for that row only;
--   * on an ENTRY or a WORKSHOP row a non-NULL value is refused (token
--     `exit_purpose_not_allowed`, 22023), so the 0111 CHECK
--     entry_exit_logs_exit_purpose_site_exit_only is never the one to answer.
-- Everything else of the 0127 body is unchanged (movements.edit_delete, the
-- advisory lock, the visit pair, the sequence re-check).
--
-- Audit: the 0069 / 0070 trigger diffs an explicit column list that did not
-- include exit_purpose, so a changed purpose alone would have written no
-- movement_audit_logs row. Both functions are re-created from 0070 verbatim
-- with that key added (the activity log already labels `exit_purpose`).
--
-- Rollout: the live API calls admin_update_movement with nine NAMED
-- arguments; the new parameter has a default, so that call resolves to the new
-- signature unchanged and applying this migration before the new screens is
-- safe.

-- ---------------------------------------------------------------------------
-- 1. The audit trigger records the exit purpose
-- ---------------------------------------------------------------------------
-- 0070 verbatim plus one key each: 'exit_purpose' in the readable snapshot
-- and in both raw diffs, so a changed purpose is a changed field.

CREATE OR REPLACE FUNCTION public.movement_audit_snapshot(p_log public.entry_exit_logs)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'equipment_id', COALESCE((SELECT e.code FROM public.equipment e WHERE e.id=p_log.equipment_id), p_log.equipment_id::text),
    'supervisor_id', COALESCE((SELECT p.full_name FROM public.profiles p WHERE p.id=p_log.supervisor_id), p_log.supervisor_id::text),
    'movement_type', p_log.movement_type,
    'movement_context', p_log.movement_context,
    'driver_id', COALESCE((SELECT d.full_name FROM public.drivers d WHERE d.id=p_log.driver_id), p_log.driver_id::text),
    'driver_name', p_log.driver_name,
    'company_id', COALESCE((SELECT COALESCE(c.name_ar,c.name_en) FROM public.companies c WHERE c.id=p_log.company_id), p_log.company_id::text),
    'project_id', COALESCE((SELECT COALESCE(pr.name_ar,pr.name_en) FROM public.projects pr WHERE pr.id=p_log.project_id), p_log.project_id::text),
    'contractor_equipment_code', p_log.contractor_equipment_code,
    'notes', p_log.notes,
    'recorded_at', p_log.recorded_at,
    'workshop_purpose', p_log.workshop_purpose,
    'exit_purpose', p_log.exit_purpose
  ));
$$;

REVOKE ALL ON FUNCTION public.movement_audit_snapshot(public.entry_exit_logs) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_movement_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_raw jsonb;
  v_new_raw jsonb;
  v_old jsonb;
  v_new jsonb;
  v_changed text[] := '{}';
  v_key text;
  v_actor_name text;
  v_equipment_code text;
  v_row public.entry_exit_logs;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();
  SELECT code INTO v_equipment_code FROM public.equipment WHERE id = v_row.equipment_id;

  IF TG_OP <> 'INSERT' THEN
    v_old_raw := jsonb_strip_nulls(jsonb_build_object(
      'equipment_id', OLD.equipment_id, 'supervisor_id', OLD.supervisor_id,
      'movement_type', OLD.movement_type, 'movement_context', OLD.movement_context,
      'driver_id', OLD.driver_id, 'driver_name', OLD.driver_name,
      'company_id', OLD.company_id, 'project_id', OLD.project_id,
      'contractor_equipment_code', OLD.contractor_equipment_code,
      'notes', OLD.notes, 'recorded_at', OLD.recorded_at,
      'workshop_purpose', OLD.workshop_purpose,
      'exit_purpose', OLD.exit_purpose
    ));
    v_old := public.movement_audit_snapshot(OLD);
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new_raw := jsonb_strip_nulls(jsonb_build_object(
      'equipment_id', NEW.equipment_id, 'supervisor_id', NEW.supervisor_id,
      'movement_type', NEW.movement_type, 'movement_context', NEW.movement_context,
      'driver_id', NEW.driver_id, 'driver_name', NEW.driver_name,
      'company_id', NEW.company_id, 'project_id', NEW.project_id,
      'contractor_equipment_code', NEW.contractor_equipment_code,
      'notes', NEW.notes, 'recorded_at', NEW.recorded_at,
      'workshop_purpose', NEW.workshop_purpose,
      'exit_purpose', NEW.exit_purpose
    ));
    v_new := public.movement_audit_snapshot(NEW);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_old_raw || v_new_raw) LOOP
      IF v_old_raw -> v_key IS DISTINCT FROM v_new_raw -> v_key THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    IF cardinality(v_changed) = 0 THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_changed := ARRAY(SELECT jsonb_object_keys(v_new_raw));
  ELSE
    v_changed := ARRAY(SELECT jsonb_object_keys(v_old_raw));
  END IF;

  INSERT INTO public.movement_audit_logs(
    movement_id, action, actor_id, actor_name, equipment_id, equipment_code,
    movement_type, movement_context, old_values, new_values, changed_fields
  ) VALUES (
    v_row.id,
    CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
    auth.uid(), v_actor_name, v_row.equipment_id, v_equipment_code,
    v_row.movement_type, v_row.movement_context, v_old, v_new, v_changed
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_movement_change() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. admin_update_movement takes the exit purpose
-- ---------------------------------------------------------------------------
-- PostgREST resolves an RPC by its argument names; with both the nine- and the
-- ten-argument versions present a call naming the nine would be ambiguous, so
-- the old signature is dropped first. Body: 0127 verbatim plus the 0186 lines.

DROP FUNCTION IF EXISTS public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text);

-- admin_update_movement: latest 0127 (movements.edit_delete) + 0186.
CREATE FUNCTION public.admin_update_movement(
  p_movement_id uuid,
  p_equipment_id uuid,
  p_supervisor_id uuid,
  p_recorded_at timestamptz,
  p_company_id uuid,
  p_project_id uuid,
  p_contractor_equipment_code text,
  p_driver_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_exit_purpose text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log public.entry_exit_logs;
  v_pair public.entry_exit_logs;
  v_adjacent_id uuid;
  v_adjacent_type text;
  v_driver_name text;
  v_driver_changed boolean := false;
  v_has_later boolean;
  v_code text;
  v_notes text;
  v_old_before integer;
  v_new_before integer;
  v_old_after integer;
  v_new_after integer;
BEGIN
  -- Fail closed: no session, no profile or a non-admin role is rejected.
  IF auth.uid() IS NULL OR NOT public.has_permission('movements.edit_delete') THEN
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

  -- 0186: the purpose of a SITE exit. NULL keeps the stored purpose; any
  -- other row (an entry, a workshop movement) never carries one.
  IF p_exit_purpose IS NOT NULL THEN
    IF v_log.movement_context IS DISTINCT FROM 'site'
       OR v_log.movement_type IS DISTINCT FROM 'exit' THEN
      RAISE EXCEPTION 'exit_purpose_not_allowed'
        USING ERRCODE = '22023',
              HINT = 'Only a project (site) exit carries an exit purpose.';
    END IF;
    IF p_exit_purpose NOT IN ('maintenance', 'work_completed') THEN
      RAISE EXCEPTION 'invalid_exit_purpose'
        USING ERRCODE = '22023',
              HINT = 'The exit purpose is maintenance or work_completed.';
    END IF;
  END IF;

  -- EXACTLY the key of enforce_movement_sequence(): one lock per equipment,
  -- no context suffix. When the equipment changes both locks are taken in
  -- ascending uuid order, so two concurrent corrections cannot deadlock.
  IF p_equipment_id = v_log.equipment_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_log.equipment_id::text, 0));
  ELSIF p_equipment_id < v_log.equipment_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(v_log.equipment_id::text, 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(v_log.equipment_id::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0));
  END IF;

  -- Baseline of the GLOBAL sequence of both equipments, under the locks.
  v_old_before := public.movement_sequence_violations(v_log.equipment_id);
  IF p_equipment_id = v_log.equipment_id THEN
    v_new_before := v_old_before;
  ELSE
    v_new_before := public.movement_sequence_violations(p_equipment_id);
  END IF;

  -- Resolve the existing visit pair before changing time/equipment. The
  -- adjacent row of the global chain is the pair when it has the opposite
  -- type; the per-context search of 0105 stays as the fallback for legacy
  -- rows that interleave the two contexts.
  IF v_log.movement_type = 'entry' THEN
    SELECT l.id, l.movement_type INTO v_adjacent_id, v_adjacent_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id
      AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)
    ORDER BY l.recorded_at, l.id
    LIMIT 1;

    IF v_adjacent_type IS NOT DISTINCT FROM 'exit' THEN
      SELECT l.* INTO v_pair
      FROM public.entry_exit_logs l
      WHERE l.id = v_adjacent_id
      FOR UPDATE;
    ELSE
      SELECT l.* INTO v_pair
      FROM public.entry_exit_logs l
      WHERE l.equipment_id = v_log.equipment_id
        AND l.movement_context = v_log.movement_context
        AND l.movement_type = 'exit'
        AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)
      ORDER BY l.recorded_at, l.id
      LIMIT 1
      FOR UPDATE;
    END IF;
  ELSE
    SELECT l.id, l.movement_type INTO v_adjacent_id, v_adjacent_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id
      AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;

    IF v_adjacent_type IS NOT DISTINCT FROM 'entry' THEN
      SELECT l.* INTO v_pair
      FROM public.entry_exit_logs l
      WHERE l.id = v_adjacent_id
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
      -- Decided on the stored (pre-edit) position, under the lock above. The
      -- visit is closed when a later movement exists in its own context, or
      -- when the next movement of the equipment is an EXIT in the other
      -- context (an admin cross-context exit).
      SELECT EXISTS (
        SELECT 1
        FROM public.entry_exit_logs l
        WHERE l.equipment_id = v_log.equipment_id
          AND l.movement_context = v_log.movement_context
          AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)
      ) INTO v_has_later;

      IF NOT v_has_later AND v_adjacent_type IS DISTINCT FROM 'exit' THEN
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
    notes = v_notes,
    exit_purpose = CASE
      WHEN l.movement_context = 'site' AND l.movement_type = 'exit'
        THEN COALESCE(p_exit_purpose, l.exit_purpose)
      ELSE l.exit_purpose
    END
  WHERE l.id = p_movement_id;

  -- Visit identity and inherited site facts stay consistent on both rows. A
  -- workshop pair row never carries site facts, and a site pair row receives
  -- them only when the edited row is a site movement too: correcting a
  -- workshop exit must not blank the site entry it closed.
  IF v_pair.id IS NOT NULL THEN
    UPDATE public.entry_exit_logs l SET
      equipment_id = p_equipment_id,
      company_id = CASE
        WHEN l.movement_context <> 'site' THEN NULL
        WHEN v_log.movement_context = 'site' THEN p_company_id
        ELSE l.company_id
      END,
      project_id = CASE
        WHEN l.movement_context <> 'site' THEN NULL
        WHEN v_log.movement_context = 'site' THEN p_project_id
        ELSE l.project_id
      END,
      contractor_equipment_code = CASE
        WHEN l.movement_context <> 'site' THEN NULL
        WHEN v_log.movement_context = 'site' THEN v_code
        ELSE l.contractor_equipment_code
      END
    WHERE l.id = v_pair.id;
  END IF;

  -- The sequence is GLOBAL per equipment. Refuse the correction only when it
  -- introduces a violation: a chain that was already broken before 0043 must
  -- stay correctable, but it may never get worse.
  v_old_after := public.movement_sequence_violations(v_log.equipment_id);
  IF p_equipment_id = v_log.equipment_id THEN
    v_new_after := v_old_after;
  ELSE
    v_new_after := public.movement_sequence_violations(p_equipment_id);
  END IF;
  IF v_old_after > v_old_before OR v_new_after > v_new_before THEN
    RAISE EXCEPTION 'invalid_sequence';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text, text) IS
  'Admin-only correction of one movement in one transaction: equipment, supervisor, recorded_at, site company/project/contractor code (copied to the paired visit row), driver, notes and (0186) the purpose of a site exit. Requires movements.edit_delete (0127). Serialises on the sequence trigger''s per-equipment advisory lock and refuses a change that introduces a violation of the global ENTRY/EXIT sequence ordered by (recorded_at, id). An open site visit keeps its immutable entry driver: change_active_movement_driver is the only path there. p_notes NULL keeps the note, empty clears it. p_exit_purpose NULL keeps the purpose; maintenance or work_completed on a site exit only (invalid_exit_purpose, exit_purpose_not_allowed). Audited by the audit_entry_exit_logs trigger.';

REVOKE ALL ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
