-- 0155 — an EXIT takes the context of the entry it closes (EM-210).
--
-- Owner decision 2026-10-28: «الادمن لما يسجل خروج معدة، سياق الخروج حسب
-- سياق الدخول». Since 0108 a holder of movements.exit_cross_context (the
-- admin) could store an EXIT whose movement_context differed from its open
-- ENTRY's; movement_visits pairs by (equipment, context), so such a visit
-- would have stayed open forever, and admin_update_movement blanks the
-- project facts of a non-site row. The admin screen never offered it; the
-- Excel import (every exit stored as a project exit), a stale exit list, or
-- a direct API call could. A read-only count on production (owner
-- authorized, 2026-10-28) found NO such exit and no broken chain, so no
-- stored row changes here.
--
-- enforce_movement_sequence (latest 0135) is re-created VERBATIM except:
--   * an EXIT's movement_context is set to the context of the latest entry
--     before it, under the chain's advisory lock, BEFORE the per-context
--     permission check — so the right create key is required, workshop rows
--     are cleared and enforce_site_exit_purpose (which fires after it) sees
--     the real context;
--   * a caller without the create key of that context, who sent the other
--     context, keeps the old refusal tokens (exit_equipment_in_workshop /
--     exit_equipment_on_site), so the screens' messages do not change;
--   * the two "own context only" checks are gone (they can no longer fail);
--     the site rule that only the foreman who opened the visit (or the
--     holder of movements.exit_cross_context) may close it is unchanged;
--   * the unused `SELECT role INTO v_role` read of the legacy profiles.role
--     is dropped (roles stage 4c).

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
  v_sent_context text;
  v_entry_context text;
BEGIN
  NEW.created_at := now();

  IF NEW.movement_type NOT IN ('entry', 'exit')
     OR NEW.movement_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'invalid movement';
  END IF;
  IF NEW.recorded_at > now() THEN
    RAISE EXCEPTION 'movement time cannot be in the future';
  END IF;

  -- 0155: an EXIT takes the context of the entry it closes.
  IF NEW.movement_type = 'exit' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));
    v_sent_context := NEW.movement_context;
    SELECT l.movement_context INTO v_entry_context
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id
      AND l.movement_type = 'entry'
      AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF FOUND AND v_entry_context IS DISTINCT FROM v_sent_context THEN
      IF v_entry_context = 'workshop'
         AND NOT public.has_permission('movements.workshop.create') THEN
        RAISE EXCEPTION 'exit_equipment_in_workshop'
          USING ERRCODE = '42501',
                HINT = 'The equipment is inside the workshop; a site exit cannot close a workshop entry.';
      END IF;
      IF v_entry_context = 'site'
         AND NOT public.has_permission('movements.site.create') THEN
        RAISE EXCEPTION 'exit_equipment_on_site'
          USING ERRCODE = '42501',
                HINT = 'The equipment is inside a site; a workshop exit cannot close a site entry.';
      END IF;
      NEW.movement_context := v_entry_context;
    END IF;
  END IF;

  IF NEW.movement_context = 'workshop' THEN
    -- Fail closed: a missing profile (NULL role) is rejected too, because
    -- `NULL NOT IN (...)` alone evaluates to NULL and would not raise.
    IF NOT public.has_permission('movements.workshop.create') THEN
      RAISE EXCEPTION 'workshop role required';
    END IF;
    NEW.company_id := NULL;
    NEW.project_id := NULL;
    NEW.contractor_equipment_code := NULL;
    NEW.driver_id := NULL;
    NEW.driver_name := NULL;
  ELSE
    IF NOT public.has_permission('movements.site.create') THEN
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
           AND public.has_permission('movements.import') THEN
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

    -- Owner decisions 2026-09-17, 2026-09-19 and 2026-09-30: a site exit
    -- only for the foreman who opened the visit; the holder of
    -- movements.exit_cross_context (the admin) is exempt. Since 0155 the
    -- exit always has its entry's context, so the "own context only" checks
    -- that stood here can no longer fail and are gone.
    IF NEW.movement_context = 'site'
       AND NOT public.has_permission('movements.exit_cross_context')
       AND public.movement_scope_allows(
             public.permission_scope('movements.site.create'),
             v_last_entry.supervisor_id,
             v_last_entry.movement_context,
             v_last_entry.company_id
           ) IS NOT TRUE THEN
      RAISE EXCEPTION 'exit_not_entry_owner'
        USING ERRCODE = '42501',
              HINT = 'Only the foreman who registered the entry, or an admin, may register this exit.';
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
  -- 0135 (em:entry_exit_logs:insert:workshop_purpose): a new row starts
  -- unclassified unless the caller holds movements.workshop.classify, the
  -- key classify_workshop_entry requires. Cleared silently (not raised) so
  -- the movement itself is never refused for the purpose alone.
  IF NEW.workshop_purpose IS NOT NULL
     AND NOT public.has_permission('movements.workshop.classify') THEN
    NEW.workshop_purpose := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_movement_sequence()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_movement_sequence() IS
  '0155: 0135 plus: an EXIT takes the context of the entry it closes (owner 2026-10-28), set before the per-context checks; a caller without that context''s create key keeps exit_equipment_in_workshop / exit_equipment_on_site; the unused legacy role read is gone.';
