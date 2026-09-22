-- Owner decision 2026-09-23: the DRIVER IS OPTIONAL ON A SITE ENTRY.
--
-- ===========================================================================
-- Why
-- ===========================================================================
--   A gate foreman frequently has to register an entry for a unit that arrives
--   on a lowbed, is moved by a workshop technician, or whose driver is simply
--   not identified yet. Until now `enforce_movement_sequence()` rejected such
--   an entry with `driver_id is required for an entry`, so the foreman either
--   waited at the gate or quick-created a placeholder driver — which polluted
--   the driver master data with records nobody could clean up afterwards.
--   Migrations 0063/0065 had already relaxed the same requirement for the
--   admin Excel import; this migration extends that to the entries recorded
--   from the movement form.
--
-- ===========================================================================
-- What changes, exactly
-- ===========================================================================
--   `public.enforce_movement_sequence()` is recreated from its latest full
--   definition (0088) with ONE predicate removed. The old site-ENTRY branch
--   read:
--
--     IF NEW.driver_id IS NULL THEN
--       IF current_setting('app.movement_excel_import', true) IS DISTINCT FROM 'true'
--          OR NOT public.is_admin() THEN
--         RAISE EXCEPTION 'driver_id is required for an entry';
--       END IF;
--       NEW.driver_name := NULLIF(btrim(NEW.driver_name), '');
--     ELSE ...
--
--   The inner `RAISE EXCEPTION` (and with it the import-only exemption, which
--   now has nothing left to exempt) is gone. A driverless entry keeps the same
--   `driver_name` snapshot behaviour the import path already had: a blank name
--   normalises to NULL, so `driver_id IS NULL` and `driver_name IS NULL` stay
--   consistent instead of storing an empty string that reads as a real name.
--
--   EVERY OTHER RULE IS BYTE-FOR-BYTE THE 0088 BODY and is deliberately
--   repeated in full rather than patched, because `CREATE OR REPLACE FUNCTION`
--   cannot replace part of a body:
--     * strict ENTRY -> EXIT -> ENTRY -> EXIT per (equipment, context), probed
--       both backwards and forwards so a historical insertion cannot break an
--       existing chain;
--     * deterministic ordering by `(recorded_at, id)` everywhere, so identical
--       timestamps still resolve to exactly one order;
--     * the per-equipment `pg_advisory_xact_lock`, which is what makes two
--       concurrent movements for one unit serialise in PostgreSQL rather than
--       in the browser;
--     * `movement_type` / `movement_context` allowlist, the no-future-time
--       rule, and the role check per context;
--     * the workshop branch, which still blanks company/project/contractor
--       code/driver and restores `operational_status` when a maintenance visit
--       closes;
--     * the site-EXIT rules of 0087/0088: a site exit closes a SITE entry only
--       (`exit_equipment_in_workshop`) and only for the foreman who opened it
--       (`exit_not_entry_owner`), admins exempt;
--     * EXIT inheritance of company, project and contractor equipment code.
--
-- ===========================================================================
-- Driverless visits downstream
-- ===========================================================================
--   * EXIT inheritance: the site-EXIT branch reads the latest
--     `movement_driver_changes` row and falls back to the entry's own
--     `driver_id` / `driver_name`. Both are plain assignments of a possibly
--     NULL value into nullable columns (`entry_exit_logs.driver_id` is
--     nullable since 0033, `driver_name` since 0001), so an exit closing a
--     driverless visit simply inherits NULL. No `NOT FOUND` path raises.
--   * Driver changes: `public.change_active_movement_driver()` (0067) already
--     records the first driver of a driverless open visit as NULL -> new
--     driver. Its `v_previous.id = v_new.id` guard evaluates to NULL when the
--     previous driver is NULL, which is not TRUE, so `driver_unchanged` is not
--     raised and the append-only row is written with `previous_driver_id` and
--     `previous_driver_name` NULL. The function is therefore NOT recreated
--     here; it needs no change.
--   * The NOT NULL constraints 0040 put on `previous_driver_id` /
--     `previous_driver_name` were already dropped by 0067 for exactly this
--     case. The statements below are repeated defensively and are a no-op on
--     an already-nullable column, so a database that somehow missed 0067
--     converges. Nothing is made nullable that 0067 did not already make
--     nullable, and the audit trail stays append-only: no UPDATE or DELETE
--     path is added.
--
-- ===========================================================================
-- Security
-- ===========================================================================
--   Identical to the original: `SECURITY DEFINER` with a fixed
--   `search_path = public`, unchanged ownership, and no new grant. A trigger
--   function is not directly executable by clients (0025 revoked EXECUTE on
--   the trigger functions), and this migration neither adds a grant nor
--   changes who may insert a movement — `entry_exit_logs` RLS remains
--   authoritative for that. `SECURITY DEFINER` is still required because the
--   trigger reads `public.profiles` and other foremen's movements, which the
--   caller's own RLS hides.

ALTER TABLE public.movement_driver_changes
  ALTER COLUMN previous_driver_id DROP NOT NULL,
  ALTER COLUMN previous_driver_name DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    IF v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager') THEN
      RAISE EXCEPTION 'workshop role required';
    END IF;
    NEW.company_id := NULL;
    NEW.project_id := NULL;
    NEW.contractor_equipment_code := NULL;
    NEW.driver_id := NULL;
    NEW.driver_name := NULL;
  ELSE
    IF v_role NOT IN ('admin', 'supervisor') THEN
      RAISE EXCEPTION 'foreman role required';
    END IF;
    IF NEW.movement_type = 'entry' THEN
      IF NEW.company_id IS NULL THEN RAISE EXCEPTION 'company_id is required for an entry'; END IF;
      IF NEW.project_id IS NULL THEN RAISE EXCEPTION 'project_id is required for an entry'; END IF;
      -- Owner decision 2026-09-23: a site ENTRY may be registered without a
      -- driver. A driverless entry stores NULL in both columns rather than an
      -- empty name, and a supplied `driver_id` is still resolved against the
      -- driver master so the `driver_name` snapshot can never be forged or
      -- point at a driver that does not exist.
      IF NEW.driver_id IS NULL THEN
        NEW.driver_name := NULLIF(btrim(NEW.driver_name), '');
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

    -- Owner decisions 2026-09-17 and 2026-09-19: a site EXIT closes a SITE
    -- entry only, and only the foreman who opened it (or an admin) may close it.
    IF NEW.movement_context = 'site' AND NOT public.is_admin() THEN
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
    IF v_last_entry.movement_context = 'workshop'
       AND v_last_entry.workshop_purpose = 'maintenance' THEN
      UPDATE public.equipment
      SET operational_status = COALESCE(v_last_entry.previous_operational_status, 'operational')
      WHERE id = NEW.equipment_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
