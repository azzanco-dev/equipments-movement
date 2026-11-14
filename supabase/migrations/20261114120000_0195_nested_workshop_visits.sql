-- 0195: a workshop stay is NESTED inside an open project visit.
--
-- Owner decisions 2026-11-14 (all three approved: «اعتمد على الثلاثة»):
--   «نبغى نلغي الزامية اخراج المعدة في حال الدخول للورشة فقط» and «لو كان
--   الخروج فقط عند انتهاء العمل كذا بيحل مشكلة التكرار»: a project (site)
--   visit stays OPEN until the work is completed; a workshop entry / exit is
--   a stop nested inside it. There is no automatic project exit. A project
--   exit is allowed while the unit is inside the workshop. A unit inside the
--   workshop whose project visit is open counts IN THE WORKSHOP. The reverse
--   stays: a project ENTRY for a unit inside the workshop still needs its
--   workshop exit first. Old data is not touched: no stored row changes here.
--
-- Until now (0043, 0108, 0155) the chain was ONE alternation per unit across
-- both contexts, ordered by (recorded_at, id). From this migration:
--   * per context: within 'site' and within 'workshop' separately ENTRY,
--     EXIT, ENTRY, EXIT ... starting with an ENTRY;
--   * R1: a site ENTRY is refused while the latest workshop movement before
--     it is an ENTRY (token equipment_in_workshop, 55000); historically, a
--     workshop ENTRY is refused when a site ENTRY lies after it and before
--     the next workshop movement ('sequence would be invalid');
--   * an EXIT keeps the context it was SENT with (the 0155 swap is gone) and
--     closes the open entry of that context, inheriting company, project,
--     contractor code and (site) the current driver from it.
-- The order is always (recorded_at, id); the advisory key of every chain
-- reader / writer stays hashtextextended(equipment_id::text, 0). Every "latest
-- movement of one context" lookup is served by the existing index
-- idx_entry_exit_logs_equipment_context_time (equipment_id, movement_context,
-- recorded_at, id) of 0040 (a btree scans it backwards for DESC), so no index
-- is added.
--
-- The state of a unit: a workshop visit is open -> that entry's purpose
-- (maintenance / parking / out_of_service / unclassified); else a site visit
-- is open -> working; else available. One definition:
-- equipment_state_from_presence(). equipment_state_from_movement (0125)
-- stays in place for the old tests and the screens' mirror; no database
-- object calls it after this migration.
--
-- Object by object (each re-created from its LATEST body, changed only where
-- said; names, arguments, defaults, LANGUAGE, SECURITY, search_path, grants
-- and comments' meaning kept):
--   1. enforce_movement_sequence() (latest 0155): the per-context chain, R1,
--      the state tokens exit_equipment_in_workshop / exit_equipment_on_site
--      (now ERRCODE 55000: a state, not a permission), no context swap.
--   2. movement_sequence_violations(uuid) (latest 0108): counts the section 1
--      violations (per-context alternation, a context's first row not an
--      entry, R1) instead of the global alternation. Still internal.
--   3. equipment_state_from_presence(boolean, text, boolean): NEW, pure.
--      equipment_state(equipment) (latest 0125) reads the two open visits.
--   4. admin_equipment_state (latest 0129): the "current movement" behind
--      state and every last_* column is the open workshop entry, else the
--      open site entry, else the unit's latest movement. Every column keeps
--      its name, type and position; TRAILING: site_entry_id, site_entry_at,
--      site_company_id, site_project_id (the OPEN site visit's entry).
--   5. get_equipment_presence(uuid): NEW, SECURITY DEFINER like
--      get_last_movement (latest 0158), same gate and masking; one row with
--      both open visits and the latest movement. get_last_movement itself is
--      left exactly as it is (the screens live before the deploy call it).
--   6. admin_update_movement (latest 0186): the pair is the SAME-CONTEXT
--      partner only; validity through the new violations count.
--   7. admin_delete_movement (latest 0133): neighbours per context; deleting
--      a workshop EXIT that would leave a site ENTRY inside the re-opened
--      workshop visit is refused with movement_not_last.
--   8. admin_correct_visit_driver (latest 0166): the exit that closed the
--      visit is the next SITE movement after the entry.
--   9. update_entry_contractor_code (latest 0156): the visit is closed only
--      by a later SITE movement.
--  10. search_site_exit_equipment (latest 0156): the units whose latest SITE
--      movement is an entry, whatever the workshop rows say; the owner filter
--      on that entry's supervisor.
--  11. search_entry_equipment / search_workshop_equipment (latest 0163): the
--      state badge from the current movement (inside_workshop while a
--      workshop visit is open, else inside_site with that entry's company /
--      project / since, else outside, else none). Row filters unchanged.
--  12. sync_equipment_rental_status (latest 0163): rental_ended only when the
--      latest movement is a site EXIT and no workshop visit is open; active
--      again whenever a visit of either context is open.
--      guard_equipment_rental_ended (latest 0163): equipment_inside_cannot_end
--      whenever a visit of either context is open.
--  13. driver_equipment_summary (latest 0092): is_current from the latest
--      SITE movement.
--  14. purchasing_site_visits / purchasing_site_units (latest 0194): one
--      TRAILING column in_workshop (the visit is open AND the unit has an
--      open workshop visit now).
--  15. get_admin_fleet_equipment (latest 0156): four TRAILING return columns
--      site_company_name_ar / _en, site_project_name_ar / _en (the open site
--      visit's company and project). The return type changes, so it is
--      dropped and created again with the 0127 grants.
-- Left exactly as they are: get_last_movement, request_workshop_arrival_notice,
-- prepare_movement_exit_notice, change_active_movement_driver,
-- classify_workshop_entry, enforce_site_exit_purpose, import_movement_rows,
-- the PO functions, guard_movement_with_po, movement_visits, the sales views.
-- The notices are migration 0196.
--
-- Scenarios (rehearse against a copy of production in a rolled-back
-- transaction; S = site, W = workshop):
--   N1  S ENTRY 1 Sep, W ENTRY 3 Oct, W EXIT 8 Oct: all three accepted; state
--       working -> the W entry's purpose (unclassified until classified) ->
--       working; the site visit stays open with its project and driver.
--   N2  N1 + S EXIT 20 Oct: accepted, closes the S entry of 1 Sep (company,
--       project, contractor code, current driver; exit_not_entry_owner
--       against it); state available.
--   N3  S ENTRY, W ENTRY, S EXIT while inside (accepted: the site visit is
--       closed while the unit sits in the workshop; state stays the W
--       purpose), W EXIT (accepted; state available).
--   Refused: a S ENTRY while a W visit is open -> equipment_in_workshop; a
--       second W ENTRY while one is open -> sequence would be invalid; a W
--       EXIT with none open -> exit_equipment_on_site when a S visit is open,
--       else no prior entry found for this equipment / sequence would be
--       invalid; a S EXIT with no open S visit while in the workshop ->
--       exit_equipment_in_workshop; a historical W ENTRY inserted before an
--       existing S ENTRY with no W movement in between -> sequence would be
--       invalid.
--   The old serial flow S ENTRY, S EXIT, W ENTRY, W EXIT, S ENTRY behaves as
--       before (every step accepted, the same inherited facts).
--   The admin Excel import (app.movement_excel_import, site rows only) goes
--       through the same trigger: its site rows are checked per context; a
--       site exit for a unit inside the workshop with no open site visit is
--       now refused (it was relabelled a workshop exit by 0155 for a holder
--       of the workshop key) and reported as import_failed, since
--       import_movement_rows maps only the texts it knew.
--
-- Rollout: apply 0195 (then 0196) BEFORE deploying the screens that call
-- get_equipment_presence or read the new columns. The new chain only allows
-- more; every function the live screens call keeps its name, arguments and
-- leading columns, so they keep working on both sides of it.

-- ===========================================================================
-- 1. enforce_movement_sequence: the per-context chain and R1
-- ===========================================================================
-- enforce_movement_sequence: latest 0155. The trigger itself (BEFORE INSERT,
-- 0021) is not re-created.
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
  -- 0195: the latest movement of the OTHER context before the new row.
  v_other_last text;
BEGIN
  NEW.created_at := now();

  IF NEW.movement_type NOT IN ('entry', 'exit')
     OR NEW.movement_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'invalid movement';
  END IF;
  IF NEW.recorded_at > now() THEN
    RAISE EXCEPTION 'movement time cannot be in the future';
  END IF;

  -- 0195: the 0155 context swap is gone. An EXIT keeps the context it was
  -- SENT with and closes the open ENTRY of that context.

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
  -- 0195: the neighbours IN THE ROW'S OWN CONTEXT (per-context chain).
  SELECT l.movement_type INTO v_before
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND l.movement_context = NEW.movement_context
    AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
  SELECT l.movement_type INTO v_after
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND l.movement_context = NEW.movement_context
    AND (l.recorded_at, l.id) > (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at, l.id
  LIMIT 1;
  -- 0195: the latest movement of the other context before the new row
  -- ('entry' = that visit is open at this point of the chain).
  SELECT l.movement_type INTO v_other_last
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND l.movement_context <> NEW.movement_context
    AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  -- 0195: an EXIT with no open visit of its own context while the other
  -- context's visit is open names the state (55000: a state, not a
  -- permission).
  IF NEW.movement_type = 'exit'
     AND v_before IS DISTINCT FROM 'entry'
     AND v_other_last = 'entry' THEN
    IF NEW.movement_context = 'site' THEN
      RAISE EXCEPTION 'exit_equipment_in_workshop'
        USING ERRCODE = '55000',
              HINT = 'The equipment has no open site visit and is inside the workshop.';
    END IF;
    RAISE EXCEPTION 'exit_equipment_on_site'
      USING ERRCODE = '55000',
            HINT = 'The equipment has no open workshop visit and is inside a site.';
  END IF;
  -- 0195 (R1): a site ENTRY while the unit is inside the workshop; its
  -- workshop exit comes first.
  IF NEW.movement_context = 'site'
     AND NEW.movement_type = 'entry'
     AND v_other_last = 'entry' THEN
    RAISE EXCEPTION 'equipment_in_workshop'
      USING ERRCODE = '55000',
            HINT = 'The equipment is inside the workshop; record its workshop exit first.';
  END IF;

  IF (v_before IS NOT NULL AND v_before = NEW.movement_type)
     OR (v_after IS NOT NULL AND v_after = NEW.movement_type) THEN
    RAISE EXCEPTION 'sequence would be invalid';
  END IF;
  IF NEW.movement_type = 'exit' AND v_before IS NULL THEN
    RAISE EXCEPTION 'no prior entry found for this equipment';
  END IF;
  -- 0195 (R1, historical form): a workshop ENTRY would put a later site
  -- ENTRY inside the workshop when no workshop movement lies between them.
  IF NEW.movement_context = 'workshop'
     AND NEW.movement_type = 'entry'
     AND EXISTS (
       SELECT 1
       FROM public.entry_exit_logs s
       WHERE s.equipment_id = NEW.equipment_id
         AND s.movement_context = 'site'
         AND s.movement_type = 'entry'
         AND (s.recorded_at, s.id) > (NEW.recorded_at, NEW.id)
         AND NOT EXISTS (
           SELECT 1
           FROM public.entry_exit_logs w
           WHERE w.equipment_id = NEW.equipment_id
             AND w.movement_context = 'workshop'
             AND (w.recorded_at, w.id) > (NEW.recorded_at, NEW.id)
             AND (w.recorded_at, w.id) < (s.recorded_at, s.id)
         )
     ) THEN
    RAISE EXCEPTION 'sequence would be invalid';
  END IF;

  IF NEW.movement_type = 'exit' THEN
    -- 0195: the open ENTRY of the exit's own context.
    SELECT l.* INTO v_last_entry
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id
      AND l.movement_context = NEW.movement_context
      AND l.movement_type = 'entry'
      AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'no prior entry found for this equipment'; END IF;

    -- Owner decisions 2026-09-17, 2026-09-19 and 2026-09-30: a site exit
    -- only for the foreman who opened the visit; the holder of
    -- movements.exit_cross_context (the admin) is exempt. Since 0195 the
    -- exit closes the open entry of its own context, so the "own context
    -- only" checks that stood here before 0155 cannot fail.
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
  '0195: the chain is per context (site and workshop each alternate ENTRY, EXIT ... from an ENTRY, ordered by (recorded_at, id)); a workshop stay may nest inside an open site visit (owner 2026-11-14). R1: a site ENTRY while the latest workshop movement before it is an ENTRY is refused (equipment_in_workshop, 55000), and a workshop ENTRY with a later site ENTRY before the next workshop movement (sequence would be invalid). An EXIT keeps its sent context (the 0155 swap is gone) and closes the open entry of that context, inheriting its facts; exit_not_entry_owner is checked against that site entry. exit_equipment_in_workshop / exit_equipment_on_site (55000): an exit with no open visit of its own context while the other context is open. 0135 purpose rule unchanged.';

-- ===========================================================================
-- 2. movement_sequence_violations: the section 1 rules
-- ===========================================================================
-- movement_sequence_violations: latest 0108. Counts, for one equipment:
--   * per context, a first row that is not an ENTRY and every row that
--     repeats the type of the previous row OF ITS CONTEXT;
--   * R1: every site ENTRY whose latest workshop movement before it is an
--     ENTRY (the historical form of R1 is the same pair seen from the
--     workshop side, so it is counted once).
-- Still NOT SECURITY DEFINER and executable by no client role: called only
-- from the SECURITY DEFINER admin functions.
CREATE OR REPLACE FUNCTION public.movement_sequence_violations(p_equipment_id uuid)
RETURNS integer
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
  FROM (
    SELECT
      l.id,
      l.recorded_at,
      l.movement_type,
      l.movement_context,
      lag(l.movement_type) OVER (
        PARTITION BY l.movement_context ORDER BY l.recorded_at, l.id
      ) AS prev,
      row_number() OVER (
        PARTITION BY l.movement_context ORDER BY l.recorded_at, l.id
      ) AS rn
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = p_equipment_id
  ) s
  WHERE (s.rn = 1 AND s.movement_type <> 'entry')
     OR s.prev = s.movement_type
     OR (
       s.movement_context = 'site'
       AND s.movement_type = 'entry'
       AND (
         SELECT w.movement_type
         FROM public.entry_exit_logs w
         WHERE w.equipment_id = p_equipment_id
           AND w.movement_context = 'workshop'
           AND (w.recorded_at, w.id) < (s.recorded_at, s.id)
         ORDER BY w.recorded_at DESC, w.id DESC
         LIMIT 1
       ) = 'entry'
     );
$$;

COMMENT ON FUNCTION public.movement_sequence_violations(uuid) IS
  'Internal. 0195: number of rows that break the per-context ENTRY/EXIT chain of one equipment (a context''s first row not an ENTRY, a row repeating the type of the previous row of its context, ordered by (recorded_at, id)) plus every site ENTRY whose latest earlier workshop movement is an ENTRY (R1, nesting). Used by the admin correction to refuse only an edit that introduces a violation.';

REVOKE ALL ON FUNCTION public.movement_sequence_violations(uuid)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 3. The one state rule, and the equipment_state computed field
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.equipment_state_from_presence(
  p_workshop_open boolean,
  p_workshop_purpose text,
  p_site_open boolean
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN COALESCE(p_workshop_open, false) THEN
      CASE p_workshop_purpose
        WHEN 'maintenance' THEN 'maintenance'
        WHEN 'parking' THEN 'parking'
        WHEN 'out_of_service' THEN 'out_of_service'
        ELSE 'unclassified'
      END
    WHEN COALESCE(p_site_open, false) THEN 'working'
    ELSE 'available'
  END
$$;

REVOKE ALL ON FUNCTION
  public.equipment_state_from_presence(boolean, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.equipment_state_from_presence(boolean, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.equipment_state_from_presence(boolean, text, boolean) IS
  '0195: the equipment state from the unit''s two open visits: a workshop visit open (its latest workshop movement is an ENTRY) = that entry''s purpose (maintenance, parking, out_of_service, else unclassified); else a site visit open = working; else available. A NULL flag counts as closed. The single definition shared by equipment_state(equipment), admin_equipment_state and get_equipment_presence; equipment_state_from_movement (0125) is no longer called by the database.';

-- equipment_state: latest 0125.
CREATE OR REPLACE FUNCTION public.equipment_state(p_equipment public.equipment)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- 0195: from the two open visits (a nested workshop stay wins).
  SELECT public.equipment_state_from_presence(
    w.movement_type IS NOT DISTINCT FROM 'entry',
    w.workshop_purpose,
    s.movement_type IS NOT DISTINCT FROM 'entry'
  )
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (
    SELECT l.movement_type, l.workshop_purpose
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = p_equipment.id
      AND l.movement_context = 'workshop'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) w ON true
  LEFT JOIN LATERAL (
    SELECT l.movement_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = p_equipment.id
      AND l.movement_context = 'site'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) s ON true
$$;

REVOKE ALL ON FUNCTION public.equipment_state(public.equipment)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_state(public.equipment)
  TO authenticated;

COMMENT ON FUNCTION public.equipment_state(public.equipment) IS
  'Computed field: the equipment state (working, available, maintenance, '
  'parking, out_of_service, unclassified). Since 0195 from the unit''s two '
  'open visits through equipment_state_from_presence (a workshop visit open '
  'wins, else an open site visit is working), each read as the latest '
  'movement of its context by (recorded_at DESC, id DESC). SECURITY INVOKER, '
  'so entry_exit_logs RLS decides which movements are seen (0125).';

-- ===========================================================================
-- 4. admin_equipment_state: the current movement, and the open site visit
-- ===========================================================================
-- admin_equipment_state: latest 0129. CREATE OR REPLACE VIEW: every column
-- keeps its name, type and position; four columns are appended.
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
  -- Appended in 0107. They describe the same current movement as the
  -- columns above (0195: the open workshop entry, else the open site entry,
  -- else the latest movement); all three are NULL for equipment that has
  -- never moved.
  m.id AS last_movement_id,
  m.company_id AS last_company_id,
  m.project_id AS last_project_id,
  -- Appended in 0118: the site exit purpose (0111) of that same latest
  -- movement; NULL unless it is a site exit recorded with a purpose.
  m.exit_purpose AS last_exit_purpose,
  -- Appended in 0125: the one equipment state (working, available,
  -- maintenance, parking, out_of_service, unclassified) of that same
  -- latest movement.
  -- 0195: from the two open visits (equipment_state_from_presence).
  public.equipment_state_from_presence(
    m.movement_type = 'entry' AND m.movement_context = 'workshop',
    m.workshop_purpose,
    s.id IS NOT NULL
  ) AS equipment_state,
  -- 0129: «جديدة» is now "created within equipment_new_window()" (7 days),
  -- the same rule as the equipment_is_new computed field; it no longer means
  -- "never moved".
  (e.created_at >= now() - public.equipment_new_window()) AS is_new,
  -- 0195: appended. The OPEN site visit's entry (NULL when no site visit is
  -- open): set for inside_site and for a workshop state nested in a project.
  s.id AS site_entry_id,
  s.recorded_at AS site_entry_at,
  s.company_id AS site_company_id,
  s.project_id AS site_project_id
FROM public.equipment e
-- 0195: the CURRENT movement: the open workshop entry, else the open site
-- entry, else the unit's latest movement (the later of the two contexts'
-- latest rows), so an available unit keeps the facts it had.
LEFT JOIN LATERAL (
  SELECT
    cur.id,
    cur.movement_type,
    cur.movement_context,
    cur.workshop_purpose,
    cur.recorded_at,
    cur.company_id,
    cur.project_id,
    cur.exit_purpose
  FROM (
    (
      SELECT l.id, l.movement_type, l.movement_context, l.workshop_purpose,
             l.recorded_at, l.company_id, l.project_id, l.exit_purpose
      FROM public.entry_exit_logs l
      WHERE l.equipment_id = e.id
        AND l.movement_context = 'workshop'
      ORDER BY l.recorded_at DESC, l.id DESC
      LIMIT 1
    )
    UNION ALL
    (
      SELECT l.id, l.movement_type, l.movement_context, l.workshop_purpose,
             l.recorded_at, l.company_id, l.project_id, l.exit_purpose
      FROM public.entry_exit_logs l
      WHERE l.equipment_id = e.id
        AND l.movement_context = 'site'
      ORDER BY l.recorded_at DESC, l.id DESC
      LIMIT 1
    )
  ) cur
  ORDER BY (cur.movement_type = 'entry' AND cur.movement_context = 'workshop') DESC,
           (cur.movement_type = 'entry') DESC,
           cur.recorded_at DESC, cur.id DESC
  LIMIT 1
) m ON true
-- 0195: the open site visit (its latest site movement, when an entry).
LEFT JOIN LATERAL (
  SELECT l.id, l.movement_type, l.recorded_at, l.company_id, l.project_id
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = e.id
    AND l.movement_context = 'site'
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1
) s ON s.movement_type = 'entry';

REVOKE ALL ON public.admin_equipment_state FROM PUBLIC, anon;
GRANT SELECT ON public.admin_equipment_state TO authenticated;

COMMENT ON VIEW public.admin_equipment_state IS
  'Every equipment row with its state. Since 0195 the state and every last_* '
  'column describe the CURRENT movement: the open workshop entry, else the '
  'open site entry, else the unit''s latest movement, each context read by '
  '(recorded_at DESC, id DESC) (a workshop stay nested in a project counts '
  'in the workshop). security_invoker, so equipment and entry_exit_logs RLS '
  'stay authoritative. Shared by the admin home functions so "current state" '
  'has exactly one definition. Carries both is_active and status; the fleet '
  'predicate is (is_active AND status = ''active''). last_movement_id, '
  'last_company_id and last_project_id (0107) identify that current '
  'movement; last_exit_purpose (0118) is its site exit purpose, if any. '
  'equipment_state is equipment_state_from_presence (0195). is_new is true '
  'while the row was created within equipment_new_window() (0129). 0195 '
  'appends site_entry_id, site_entry_at, site_company_id, site_project_id: '
  'the OPEN site visit''s entry, NULL when none is open.';

-- ===========================================================================
-- 5. get_equipment_presence: both open visits for the screens
-- ===========================================================================
-- The gate and the masking of get_last_movement (latest 0158): movements.read
-- or a create key; the open flags, the state, the times and the workshop
-- purpose always; a visit's details only when can_access_movement() allows
-- its entry (else NULL), except the project and foreman names, which a
-- holder of movements.site.create or movements.workshop.create also gets.
-- The row ids are masked like the supervisor id. Always ONE row (a unit that
-- never moved: available, both flags false).
CREATE OR REPLACE FUNCTION public.get_equipment_presence(p_equipment_id uuid)
RETURNS TABLE(
  state text,
  site_open boolean,
  workshop_open boolean,
  site_entry_id uuid,
  site_entry_at timestamptz,
  site_supervisor_id uuid,
  site_supervisor_name text,
  site_company_id uuid,
  site_company_name_ar text,
  site_company_name_en text,
  site_project_id uuid,
  site_project_name_ar text,
  site_project_name_en text,
  site_contractor_equipment_code text,
  site_driver_id uuid,
  site_driver_name text,
  site_driver_mobile_number text,
  workshop_entry_id uuid,
  workshop_entry_at timestamptz,
  workshop_purpose text,
  workshop_supervisor_id uuid,
  workshop_supervisor_name text,
  last_movement_id uuid,
  last_movement_type text,
  last_movement_context text,
  last_movement_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_can_record boolean;
BEGIN
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF NOT (
    public.has_permission('movements.read')
    OR public.has_permission('movements.site.create')
    OR public.has_permission('movements.workshop.create')
  ) THEN
    RAISE EXCEPTION 'authenticated role required';
  END IF;

  -- A movement recorder keeps the project and foreman names (the movement
  -- form explains a blocked entry with them), as in get_last_movement.
  v_can_record := public.has_permission('movements.site.create')
    OR public.has_permission('movements.workshop.create');

  RETURN QUERY
  SELECT
    public.equipment_state_from_presence(
      w.id IS NOT NULL, w.workshop_purpose, s.id IS NOT NULL
    ),
    (s.id IS NOT NULL),
    (w.id IS NOT NULL),
    CASE WHEN acc.site_read THEN s.id END,
    s.recorded_at,
    CASE WHEN acc.site_read THEN s.supervisor_id END,
    CASE WHEN acc.site_read OR (s.id IS NOT NULL AND v_can_record) THEN ssup.full_name END,
    CASE WHEN acc.site_read THEN s.company_id END,
    CASE WHEN acc.site_read THEN co.name_ar END,
    CASE WHEN acc.site_read THEN co.name_en END,
    CASE WHEN acc.site_read THEN s.project_id END,
    CASE WHEN acc.site_read OR (s.id IS NOT NULL AND v_can_record) THEN pr.name_ar END,
    CASE WHEN acc.site_read OR (s.id IS NOT NULL AND v_can_record) THEN pr.name_en END,
    CASE WHEN acc.site_read THEN s.contractor_equipment_code END,
    CASE WHEN acc.site_read THEN COALESCE(c.new_driver_id, s.driver_id) END,
    CASE WHEN acc.site_read THEN COALESCE(c.new_driver_name, s.driver_name) END,
    CASE WHEN acc.site_read THEN d.mobile_number END,
    CASE WHEN acc.workshop_read THEN w.id END,
    w.recorded_at,
    w.workshop_purpose,
    CASE WHEN acc.workshop_read THEN w.supervisor_id END,
    CASE WHEN acc.workshop_read OR (w.id IS NOT NULL AND v_can_record) THEN wsup.full_name END,
    CASE WHEN acc.last_read THEN lm.id END,
    lm.movement_type,
    lm.movement_context,
    lm.recorded_at
  FROM (SELECT 1) AS one
  -- The open workshop visit: the latest workshop movement, when an entry.
  LEFT JOIN LATERAL (
    SELECT l.*
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = p_equipment_id
      AND l.movement_context = 'workshop'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) w ON w.movement_type = 'entry'
  -- The open site visit: the latest site movement, when an entry.
  LEFT JOIN LATERAL (
    SELECT l.*
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = p_equipment_id
      AND l.movement_context = 'site'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) s ON s.movement_type = 'entry'
  -- The unit's latest movement overall.
  LEFT JOIN LATERAL (
    SELECT l.id, l.movement_type, l.movement_context, l.recorded_at
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = p_equipment_id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN public.profiles ssup ON ssup.id = s.supervisor_id
  LEFT JOIN public.profiles wsup ON wsup.id = w.supervisor_id
  LEFT JOIN public.companies co ON co.id = s.company_id
  LEFT JOIN public.projects pr ON pr.id = s.project_id
  -- The CURRENT driver of the open site visit: its latest driver change,
  -- else the entry's own driver.
  LEFT JOIN LATERAL (
    SELECT x.new_driver_id, x.new_driver_name
    FROM public.movement_driver_changes x
    WHERE x.entry_log_id = s.id
    ORDER BY x.changed_at DESC, x.id DESC
    LIMIT 1
  ) c ON true
  LEFT JOIN public.drivers d ON d.id = COALESCE(c.new_driver_id, s.driver_id)
  CROSS JOIN LATERAL (
    SELECT
      public.can_access_movement(s.id) AS site_read,
      public.can_access_movement(w.id) AS workshop_read,
      public.can_access_movement(lm.id) AS last_read
  ) acc;
END;
$$;

REVOKE ALL ON FUNCTION public.get_equipment_presence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_presence(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_equipment_presence(uuid) IS
  '0195: one row with the unit''s two OPEN visits (site_* = the open site visit, workshop_* = the open workshop visit, NULL when none; each the latest movement of its context by (recorded_at, id) when it is an ENTRY), the state of equipment_state_from_presence and the unit''s latest movement overall. The site driver is the current one (the latest movement_driver_changes row of that entry, else the entry''s). Gate as get_last_movement: movements.read or a create key. The flags, state, times, workshop purpose and latest type / context always; a visit''s ids and details only when can_access_movement() allows its entry, except the project and foreman names, which a create-key holder also gets.';

-- ===========================================================================
-- 6. admin_update_movement: the same-context pair
-- ===========================================================================
-- admin_update_movement: latest 0186 (ten arguments), same signature.
CREATE OR REPLACE FUNCTION public.admin_update_movement(
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

  -- Baseline of the sequence of both equipments (0195: per context plus the
  -- nesting rule, movement_sequence_violations), under the locks.
  v_old_before := public.movement_sequence_violations(v_log.equipment_id);
  IF p_equipment_id = v_log.equipment_id THEN
    v_new_before := v_old_before;
  ELSE
    v_new_before := public.movement_sequence_violations(p_equipment_id);
  END IF;

  -- Resolve the existing visit pair before changing time/equipment. 0195:
  -- the pair is the SAME-CONTEXT partner only: an entry's next row of its
  -- context when that is an exit, an exit's previous row of its context
  -- when that is an entry (a nested workshop row is never a site row's
  -- pair, nor the other way round).
  IF v_log.movement_type = 'entry' THEN
    SELECT l.id, l.movement_type INTO v_adjacent_id, v_adjacent_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id
      AND l.movement_context = v_log.movement_context
      AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)
    ORDER BY l.recorded_at, l.id
    LIMIT 1;

    IF v_adjacent_type IS NOT DISTINCT FROM 'exit' THEN
      SELECT l.* INTO v_pair
      FROM public.entry_exit_logs l
      WHERE l.id = v_adjacent_id
      FOR UPDATE;
    END IF;
  ELSE
    SELECT l.id, l.movement_type INTO v_adjacent_id, v_adjacent_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id
      AND l.movement_context = v_log.movement_context
      AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;

    IF v_adjacent_type IS NOT DISTINCT FROM 'entry' THEN
      SELECT l.* INTO v_pair
      FROM public.entry_exit_logs l
      WHERE l.id = v_adjacent_id
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

  -- 0195: the chain is per context plus the nesting rule
  -- (movement_sequence_violations). Refuse the correction only when it
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
  'Admin-only correction of one movement in one transaction: equipment, supervisor, recorded_at, site company/project/contractor code (copied to the paired visit row: since 0195 its SAME-CONTEXT partner only), driver, notes and (0186) the purpose of a site exit. Requires movements.edit_delete (0127). Serialises on the sequence trigger''s per-equipment advisory lock and refuses a change that introduces a violation of the chain (0195: per context plus the nesting rule, movement_sequence_violations) ordered by (recorded_at, id). An open site visit keeps its immutable entry driver: change_active_movement_driver is the only path there. p_notes NULL keeps the note, empty clears it. p_exit_purpose NULL keeps the purpose; maintenance or work_completed on a site exit only (invalid_exit_purpose, exit_purpose_not_allowed). Audited by the audit_entry_exit_logs trigger.';

REVOKE ALL ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text, text) TO authenticated;

-- ===========================================================================
-- 7. admin_delete_movement: neighbours per context
-- ===========================================================================
-- admin_delete_movement: latest 0133 (its photo_url rule kept verbatim).
CREATE OR REPLACE FUNCTION public.admin_delete_movement(p_log_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log public.entry_exit_logs;
  v_later public.entry_exit_logs;
  v_has_later boolean;
  v_earlier_type text;
  v_has_earlier boolean;
  v_gap_invalid boolean;
  v_row_invalid boolean;
  v_paths text[] := '{}';
  v_changes jsonb := '[]'::jsonb;
  v_fields text[] := '{}';
  v_actor_name text;
  v_equipment_code text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('movements.edit_delete') THEN
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

  -- EXACTLY the key of enforce_movement_sequence(): one lock per equipment,
  -- so a concurrent insert cannot slip between the check and the delete.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_log.equipment_id::text, 0));

  -- 0195: neighbours in the chain of the movement's OWN context.
  SELECT l.movement_type INTO v_earlier_type
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = v_log.equipment_id
    AND l.movement_context = v_log.movement_context
    AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
  v_has_earlier := FOUND;

  SELECT l.* INTO v_later
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = v_log.equipment_id
    AND l.movement_context = v_log.movement_context
    AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)
  ORDER BY l.recorded_at, l.id
  LIMIT 1;
  v_has_later := FOUND;

  -- The last movement of its context may always go (but see the 0195
  -- nesting rule below). Any other row makes its two neighbours adjacent;
  -- the delete is refused when that introduces a violation, i.e.
  -- the new adjacency is invalid while the row itself was part of none. In a
  -- clean chain this is every row but the last one.
  IF v_has_later THEN
    IF v_has_earlier THEN
      v_gap_invalid := v_earlier_type = v_later.movement_type;
      v_row_invalid := v_earlier_type = v_log.movement_type
        OR v_later.movement_type = v_log.movement_type;
    ELSE
      -- The row is the first one: the next row becomes the first.
      v_gap_invalid := v_later.movement_type <> 'entry';
      v_row_invalid := v_log.movement_type <> 'entry'
        OR v_later.movement_type = v_log.movement_type;
    END IF;

    IF v_gap_invalid AND NOT v_row_invalid THEN
      IF v_log.movement_type = 'entry' AND v_later.movement_type = 'exit' THEN
        RAISE EXCEPTION 'entry_has_later_exit'
          USING HINT = 'Delete the exit of this visit first.';
      END IF;
      RAISE EXCEPTION 'movement_not_last'
        USING HINT = 'Only the last movement of this equipment may be deleted.';
    END IF;
  END IF;

  -- 0195: deleting a workshop EXIT re-opens its workshop visit up to the
  -- next workshop movement; a site ENTRY in that stretch would then sit
  -- inside the workshop (R1), so the delete is refused.
  IF v_log.movement_context = 'workshop'
     AND v_log.movement_type = 'exit'
     AND v_has_earlier
     AND v_earlier_type = 'entry'
     AND EXISTS (
       SELECT 1
       FROM public.entry_exit_logs s
       WHERE s.equipment_id = v_log.equipment_id
         AND s.movement_context = 'site'
         AND s.movement_type = 'entry'
         AND (s.recorded_at, s.id) > (v_log.recorded_at, v_log.id)
         AND (
           NOT v_has_later
           OR (s.recorded_at, s.id) < (v_later.recorded_at, v_later.id)
         )
     ) THEN
    RAISE EXCEPTION 'movement_not_last'
      USING HINT = 'A later project entry depends on this workshop exit.';
  END IF;

  SELECT COALESCE(array_agg(p.file_path ORDER BY p.sort_order, p.id), '{}')
  INTO v_paths
  FROM public.entry_exit_photos p
  WHERE p.entry_exit_log_id = p_log_id;

  -- 0133 (B-8, em:entry_exit_logs:insert:photo_url): the legacy photo_url is
  -- handed to the Storage cleanup of DELETE /api/movements/[id] only when it
  -- lies in THIS movement's own folder, <supervisor_id>/<movement id>/<file>.
  -- Any other value (a path of another movement, another user's folder, a
  -- pre-0031 path without the movement segment) is left in Storage; it can
  -- never steer the admin's token into removing another movement's evidence.
  IF NULLIF(btrim(v_log.photo_url), '') IS NOT NULL
     AND split_part(btrim(v_log.photo_url), '/', 1) = v_log.supervisor_id::text
     AND split_part(btrim(v_log.photo_url), '/', 2) = p_log_id::text THEN
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

REVOKE ALL ON FUNCTION public.admin_delete_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_movement(uuid) TO authenticated;

-- ===========================================================================
-- 8. admin_correct_visit_driver: the closing exit is the next SITE movement
-- ===========================================================================
-- admin_correct_visit_driver: latest 0166.
create or replace function public.admin_correct_visit_driver(
  p_entry_log_id uuid,
  p_change_id uuid,
  p_new_driver_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.entry_exit_logs;
  v_exit public.entry_exit_logs;
  v_next_id uuid;
  v_next_type text;
  v_new_id uuid;
  v_new_name text;
  v_change public.movement_driver_changes;
  v_old_id uuid;
  v_old_name text;
  v_old_last uuid;
  v_new_last uuid;
  v_new_last_name text;
  v_removed integer := 0;
  v_exit_updated boolean := false;
  v_actor_name text;
  v_code text;
begin
  if auth.uid() is null or not public.has_permission('movements.edit_delete') then
    raise exception 'admin_required'
      using errcode = '42501',
            hint = 'Only an administrator may correct a visit driver.';
  end if;

  select l.* into v_entry
  from public.entry_exit_logs l
  where l.id = p_entry_log_id
    and l.movement_type = 'entry'
    and l.movement_context = 'site'
  for update;
  if not found then
    raise exception 'movement_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_entry.equipment_id::text, 0));

  select d.id, d.full_name into v_new_id, v_new_name
  from public.drivers d
  where d.id = p_new_driver_id;
  if not found then
    raise exception 'invalid_driver_id';
  end if;

  -- The exit that closed this visit, if any: 0195, the next SITE movement of
  -- the unit (a nested workshop stay never closes it).
  select l.id, l.movement_type into v_next_id, v_next_type
  from public.entry_exit_logs l
  where l.equipment_id = v_entry.equipment_id
    and l.movement_context = 'site'
    and (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id)
  order by l.recorded_at, l.id
  limit 1;
  if v_next_type is not distinct from 'exit' then
    select l.* into v_exit
    from public.entry_exit_logs l
    where l.id = v_next_id
    for update;
  end if;

  select c.new_driver_id into v_old_last
  from public.movement_driver_changes c
  where c.entry_log_id = p_entry_log_id
  order by c.changed_at desc, c.id desc
  limit 1;
  if not found then
    v_old_last := v_entry.driver_id;
  end if;

  if p_change_id is null then
    v_old_id := v_entry.driver_id;
    v_old_name := v_entry.driver_name;
    if v_old_id is not distinct from v_new_id then
      raise exception 'driver_unchanged';
    end if;

    update public.entry_exit_logs l
    set driver_id = v_new_id,
        driver_name = v_new_name
    where l.id = v_entry.id;

    update public.movement_driver_changes c
    set previous_driver_id = v_new_id,
        previous_driver_name = v_new_name
    where c.id = (
      select f.id
      from public.movement_driver_changes f
      where f.entry_log_id = p_entry_log_id
      order by f.changed_at, f.id
      limit 1
    );
  else
    select c.* into v_change
    from public.movement_driver_changes c
    where c.id = p_change_id
      and c.entry_log_id = p_entry_log_id
    for update;
    if not found then
      raise exception 'driver_change_not_found';
    end if;
    v_old_id := v_change.new_driver_id;
    v_old_name := coalesce(
      (select d.full_name from public.drivers d where d.id = v_change.new_driver_id),
      v_change.new_driver_name
    );
    if v_old_id = v_new_id then
      raise exception 'driver_unchanged';
    end if;

    update public.movement_driver_changes c
    set new_driver_id = v_new_id,
        new_driver_name = v_new_name
    where c.id = v_change.id;

    update public.movement_driver_changes c
    set previous_driver_id = v_new_id,
        previous_driver_name = v_new_name
    where c.id = (
      select n.id
      from public.movement_driver_changes n
      where n.entry_log_id = p_entry_log_id
        and (n.changed_at, n.id) > (v_change.changed_at, v_change.id)
      order by n.changed_at, n.id
      limit 1
    );

    select p.full_name into v_actor_name from public.profiles p where p.id = auth.uid();
    select e.code into v_code from public.equipment e where e.id = v_entry.equipment_id;
    insert into public.movement_audit_logs (
      movement_id, action, actor_id, actor_name, equipment_id, equipment_code,
      movement_type, movement_context, old_values, new_values, changed_fields
    ) values (
      v_entry.id, 'update', auth.uid(), v_actor_name, v_entry.equipment_id, v_code,
      v_entry.movement_type, v_entry.movement_context,
      jsonb_build_object('driver_change', v_old_name),
      jsonb_build_object('driver_change', v_new_name),
      array['driver_change']
    );
  end if;

  -- A link that now goes from a driver to the same driver means nothing.
  delete from public.movement_driver_changes c
  where c.entry_log_id = p_entry_log_id
    and c.previous_driver_id = c.new_driver_id;
  get diagnostics v_removed = row_count;

  select c.new_driver_id, c.new_driver_name into v_new_last, v_new_last_name
  from public.movement_driver_changes c
  where c.entry_log_id = p_entry_log_id
  order by c.changed_at desc, c.id desc
  limit 1;
  if not found then
    select l.driver_id, l.driver_name into v_new_last, v_new_last_name
    from public.entry_exit_logs l
    where l.id = v_entry.id;
  end if;

  -- A closed visit's exit carries the driver current at the exit.
  if v_exit.id is not null
     and v_exit.movement_context = 'site'
     and v_exit.driver_id is not distinct from v_old_last
     and v_new_last is distinct from v_old_last then
    update public.entry_exit_logs l
    set driver_id = v_new_last,
        driver_name = v_new_last_name
    where l.id = v_exit.id;
    v_exit_updated := true;
  end if;

  return jsonb_build_object(
    'entry_log_id', v_entry.id,
    'removed_changes', v_removed,
    'exit_updated', v_exit_updated
  );
end;
$$;

comment on function public.admin_correct_visit_driver(uuid, uuid, uuid) is
  '0166/0195: the admin (movements.edit_delete) replaces one driver of a project visit chain — the entry driver (p_change_id NULL) or the new driver of one change — keeping the next change, no-op changes and the closing exit (since 0195 the next SITE movement after the entry) consistent.';

revoke all on function public.admin_correct_visit_driver(uuid, uuid, uuid) from public, anon;
grant execute on function public.admin_correct_visit_driver(uuid, uuid, uuid) to authenticated;

-- ===========================================================================
-- 9. update_entry_contractor_code: closed only by a later SITE movement
-- ===========================================================================
-- update_entry_contractor_code: latest 0156.
CREATE OR REPLACE FUNCTION public.update_entry_contractor_code(
  p_log_id uuid,
  p_code text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry public.entry_exit_logs;
  v_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'contractor_code_not_allowed'
      USING ERRCODE = '42501',
            HINT = 'Authentication is required.';
  END IF;

  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL IS DISTINCT FROM 'supervisor'` is TRUE, so this rejects it.
  IF NOT public.has_permission('movements.site.contractor_code') THEN
    RAISE EXCEPTION 'contractor_code_not_allowed'
      USING ERRCODE = '42501',
            HINT = 'Only the foreman who registered the site entry may edit its contractor code.';
  END IF;

  -- Validate the input before taking any lock.
  v_code := NULLIF(btrim(p_code), '');
  IF v_code IS NOT NULL AND char_length(v_code) > 50 THEN
    RAISE EXCEPTION 'contractor_code_too_long'
      USING HINT = 'The contractor equipment code is limited to 50 characters.';
  END IF;

  SELECT l.* INTO v_entry
  FROM public.entry_exit_logs l
  WHERE l.id = p_log_id
    AND l.movement_type = 'entry'
    AND l.movement_context = 'site'
    AND l.supervisor_id = auth.uid()
  FOR UPDATE;

  -- A row that exists but belongs to somebody else, or is an EXIT, or is a
  -- workshop movement, is reported exactly like a missing row so the function
  -- never discloses another foreman's movements.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entry_not_accessible'
      USING ERRCODE = '42501',
            HINT = 'No open site entry of yours matches this movement.';
  END IF;

  -- Same key as enforce_movement_sequence(): serialise against a concurrent
  -- EXIT (or historical insert) for this equipment.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_entry.equipment_id::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_entry.equipment_id
      -- 0195: only a later SITE movement closes the visit; a nested
      -- workshop stay does not.
      AND l.movement_context = 'site'
      AND (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id)
  ) THEN
    RAISE EXCEPTION 'visit_is_closed'
      USING HINT = 'The visit is no longer open, so its contractor code cannot be edited.';
  END IF;

  UPDATE public.entry_exit_logs
  SET contractor_equipment_code = v_code
  WHERE id = v_entry.id;

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.update_entry_contractor_code(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_entry_contractor_code(uuid, text) TO authenticated;

-- ===========================================================================
-- 10. search_site_exit_equipment: the open SITE visits
-- ===========================================================================
-- search_site_exit_equipment: latest 0156.
CREATE OR REPLACE FUNCTION public.search_site_exit_equipment(
  p_search text DEFAULT NULL,
  p_ownership_status text DEFAULT NULL,
  p_plate_digits text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  plate_number text,
  chassis_number text,
  ownership_status text,
  is_active boolean,
  master_data_complete boolean,
  numbering_status text,
  matched_previous_code boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_term text;
  v_term_search text;
  v_digits text;
BEGIN
  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL NOT IN (...)` alone evaluates to NULL, which would let it through.
  IF NOT public.has_permission('movements.site.create') THEN
    RAISE EXCEPTION 'foreman role required';
  END IF;
  v_is_admin := public.has_permission('movements.exit_cross_context')
    OR public.permission_scope('movements.site.create') = 'all';

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  -- LIKE wildcards and the LIKE escape character are stripped so a search term
  -- can never widen the match. chr(92) is the backslash.
  v_term := NULLIF(btrim(translate(p_search, '%_' || chr(92), '')), '');
  -- 0116: the same term, normalised like equipment.type_search. NULL when
  -- nothing is left (a term of tatweel only), so it never matches every row.
  v_term_search := NULLIF(public.normalize_search_text(v_term), '');
  v_digits := NULLIF(btrim(p_plate_digits), '');
  IF v_digits IS NOT NULL AND v_digits !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'invalid plate digits';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.code,
    e.type,
    e.plate_number,
    e.chassis_number,
    e.ownership_status,
    e.is_active,
    e.master_data_complete,
    e.numbering_status,
    (
      v_term IS NOT NULL
      AND e.code NOT ILIKE '%' || v_term || '%'
      AND EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
    ) AS matched_previous_code
  FROM public.equipment e
  -- 0195: the latest SITE movement, whatever the workshop rows say (a unit
  -- in the workshop with its project visit open can leave the project).
  JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.supervisor_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
      AND l.movement_context = 'site'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  WHERE e.is_active
    AND e.status = 'active'
    -- Only equipment currently inside, i.e. with an open visit.
    AND last_movement.movement_type = 'entry'
    -- A site exit closes a site entry only (2026-09-19); since 0195 a unit
    -- inside the workshop is offered while its site visit is open.
    AND last_movement.movement_context = 'site'
    AND (v_is_admin OR last_movement.supervisor_id = auth.uid())
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
      -- 0114: a previous code (A115 -> F84) still finds the same equipment.
      OR EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
      -- 0116: the type is compared normalised on both sides.
      OR e.type_search ILIKE '%' || v_term_search || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      OR e.chassis_number ILIKE '%' || v_term || '%'
      OR (v_digits IS NOT NULL AND e.plate_digits ILIKE '%' || v_digits || '%')
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_site_exit_equipment(text, text, text) IS
  '0195: the active units whose latest SITE movement (by (recorded_at, id)) is an entry, whatever their workshop rows say; a foreman sees the visits he opened, a holder of movements.exit_cross_context or movements.site.create scope all sees every one. Search by code (and previous codes), type, plate, chassis, plate digits; 20 rows.';

REVOKE ALL ON FUNCTION public.search_site_exit_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_site_exit_equipment(text, text, text) TO authenticated;

-- ===========================================================================
-- 11. The entry pickers: the state badge from the current movement
-- ===========================================================================
-- search_entry_equipment: latest 0163.
CREATE OR REPLACE FUNCTION public.search_entry_equipment(
  p_search text DEFAULT NULL,
  p_ownership_status text DEFAULT NULL,
  p_plate_digits text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  plate_number text,
  chassis_number text,
  ownership_status text,
  is_active boolean,
  master_data_complete boolean,
  numbering_status text,
  state text,
  state_since timestamptz,
  state_company_name_ar text,
  state_company_name_en text,
  state_project_name_ar text,
  state_project_name_en text,
  state_workshop_purpose text,
  matched_previous_code boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_term text;
  v_term_search text;
  v_digits text;
BEGIN
  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL NOT IN (...)` alone evaluates to NULL, which would let it through.
  IF NOT public.has_permission('movements.site.create') THEN
    RAISE EXCEPTION 'foreman role required';
  END IF;

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  -- LIKE wildcards and the LIKE escape character are stripped so a search term
  -- can never widen the match. chr(92) is the backslash.
  v_term := NULLIF(btrim(translate(p_search, '%_' || chr(92), '')), '');
  -- 0116: the same term, normalised like equipment.type_search. NULL when
  -- nothing is left (a term of tatweel only), so it never matches every row.
  v_term_search := NULLIF(public.normalize_search_text(v_term), '');
  v_digits := NULLIF(btrim(p_plate_digits), '');
  IF v_digits IS NOT NULL AND v_digits !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'invalid plate digits';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.code,
    e.type,
    e.plate_number,
    e.chassis_number,
    e.ownership_status,
    e.is_active,
    e.master_data_complete,
    e.numbering_status,
    CASE
      WHEN last_movement.movement_type IS NULL THEN 'none'
      WHEN last_movement.movement_type <> 'entry' THEN 'outside'
      WHEN last_movement.movement_context = 'workshop' THEN 'inside_workshop'
      ELSE 'inside_site'
    END::text AS state,
    CASE
      WHEN last_movement.movement_type = 'entry' THEN last_movement.recorded_at
    END AS state_since,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_ar
    END AS state_company_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_en
    END AS state_company_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_ar
    END AS state_project_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_en
    END AS state_project_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'workshop' THEN last_movement.workshop_purpose
    END AS state_workshop_purpose,
    (
      v_term IS NOT NULL
      AND e.code NOT ILIKE '%' || v_term || '%'
      AND EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
    ) AS matched_previous_code
  FROM public.equipment e
  -- 0195: the CURRENT movement: the open workshop entry, else the open site
  -- entry, else the latest movement (the later of the two contexts' latest
  -- rows), ordered deterministically by (recorded_at, id).
  LEFT JOIN LATERAL (
    SELECT cur.movement_type, cur.movement_context, cur.recorded_at,
           cur.workshop_purpose, cur.company_id, cur.project_id
    FROM (
      (
        SELECT l.id, l.movement_type, l.movement_context, l.recorded_at,
               l.workshop_purpose, l.company_id, l.project_id
        FROM public.entry_exit_logs l
        WHERE l.equipment_id = e.id
          AND l.movement_context = 'workshop'
        ORDER BY l.recorded_at DESC, l.id DESC
        LIMIT 1
      )
      UNION ALL
      (
        SELECT l.id, l.movement_type, l.movement_context, l.recorded_at,
               l.workshop_purpose, l.company_id, l.project_id
        FROM public.entry_exit_logs l
        WHERE l.equipment_id = e.id
          AND l.movement_context = 'site'
        ORDER BY l.recorded_at DESC, l.id DESC
        LIMIT 1
      )
    ) cur
    ORDER BY (cur.movement_type = 'entry' AND cur.movement_context = 'workshop') DESC,
             (cur.movement_type = 'entry') DESC,
             cur.recorded_at DESC, cur.id DESC
    LIMIT 1
  ) last_movement ON true
  LEFT JOIN public.companies co ON co.id = last_movement.company_id
  LEFT JOIN public.projects pr ON pr.id = last_movement.project_id
  -- 0163: a «منتهية» supplier unit is offered too; its entry makes it
  -- active again (`sync_equipment_rental_status`).
  WHERE ((e.is_active AND e.status = 'active') OR e.status = 'rental_ended')
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
      -- 0114: a previous code (A115 -> F84) still finds the same equipment.
      OR EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
      -- 0116: the type is compared normalised on both sides.
      OR e.type_search ILIKE '%' || v_term_search || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      OR e.chassis_number ILIKE '%' || v_term || '%'
      OR (v_digits IS NOT NULL AND e.plate_digits ILIKE '%' || v_digits || '%')
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_entry_equipment(text, text, text) IS
  '0195: the site ENTRY picker (movements.site.create): active units and «منتهية» supplier units by code (and previous codes), type, plate, chassis, plate digits; 20 rows. The state badge comes from the current movement: inside_workshop while a workshop visit is open, else inside_site while a site visit is open (with that entry''s company, project and since), else outside, else none.';

REVOKE ALL ON FUNCTION public.search_entry_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_entry_equipment(text, text, text) TO authenticated;

-- search_workshop_equipment: latest 0163. The EXIT list (the latest WORKSHOP
-- movement is an entry) is unchanged.
CREATE OR REPLACE FUNCTION public.search_workshop_equipment(
  p_movement_type text,
  p_search text DEFAULT NULL,
  p_ownership_status text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  plate_number text,
  ownership_status text,
  qr_value text,
  is_active boolean,
  master_data_complete boolean,
  numbering_status text,
  state text,
  state_since timestamptz,
  state_company_name_ar text,
  state_company_name_en text,
  state_project_name_ar text,
  state_project_name_en text,
  state_workshop_purpose text,
  matched_previous_code boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_term text;
  v_term_search text;
BEGIN
  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL NOT IN (...)` alone evaluates to NULL, which would let it through.
  IF NOT public.has_permission('movements.workshop.create') THEN
    RAISE EXCEPTION 'workshop role required';
  END IF;

  IF p_movement_type IS NULL OR p_movement_type NOT IN ('entry', 'exit') THEN
    RAISE EXCEPTION 'invalid movement type';
  END IF;

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  -- LIKE wildcards and the LIKE escape character are stripped so a search term
  -- can never widen the match. chr(92) is the backslash.
  v_term := NULLIF(btrim(translate(p_search, '%_' || chr(92), '')), '');
  -- 0116: the same term, normalised like equipment.type_search. NULL when
  -- nothing is left (a term of tatweel only), so it never matches every row.
  v_term_search := NULLIF(public.normalize_search_text(v_term), '');

  RETURN QUERY
  SELECT
    e.id,
    e.code,
    e.type,
    e.plate_number,
    e.ownership_status,
    e.qr_value,
    e.is_active,
    e.master_data_complete,
    e.numbering_status,
    CASE
      WHEN last_movement.movement_type IS NULL THEN 'none'
      WHEN last_movement.movement_type <> 'entry' THEN 'outside'
      WHEN last_movement.movement_context = 'workshop' THEN 'inside_workshop'
      ELSE 'inside_site'
    END::text AS state,
    CASE
      WHEN last_movement.movement_type = 'entry' THEN last_movement.recorded_at
    END AS state_since,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_ar
    END AS state_company_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_en
    END AS state_company_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_ar
    END AS state_project_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_en
    END AS state_project_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'workshop' THEN last_movement.workshop_purpose
    END AS state_workshop_purpose,
    (
      v_term IS NOT NULL
      AND e.code NOT ILIKE '%' || v_term || '%'
      AND EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
    ) AS matched_previous_code
  FROM public.equipment e
  -- 0195: the CURRENT movement: the open workshop entry, else the open site
  -- entry, else the latest movement (the later of the two contexts' latest
  -- rows), ordered deterministically by (recorded_at, id).
  LEFT JOIN LATERAL (
    SELECT cur.movement_type, cur.movement_context, cur.recorded_at,
           cur.workshop_purpose, cur.company_id, cur.project_id
    FROM (
      (
        SELECT l.id, l.movement_type, l.movement_context, l.recorded_at,
               l.workshop_purpose, l.company_id, l.project_id
        FROM public.entry_exit_logs l
        WHERE l.equipment_id = e.id
          AND l.movement_context = 'workshop'
        ORDER BY l.recorded_at DESC, l.id DESC
        LIMIT 1
      )
      UNION ALL
      (
        SELECT l.id, l.movement_type, l.movement_context, l.recorded_at,
               l.workshop_purpose, l.company_id, l.project_id
        FROM public.entry_exit_logs l
        WHERE l.equipment_id = e.id
          AND l.movement_context = 'site'
        ORDER BY l.recorded_at DESC, l.id DESC
        LIMIT 1
      )
    ) cur
    ORDER BY (cur.movement_type = 'entry' AND cur.movement_context = 'workshop') DESC,
             (cur.movement_type = 'entry') DESC,
             cur.recorded_at DESC, cur.id DESC
    LIMIT 1
  ) last_movement ON true
  -- The latest WORKSHOP movement, which decides what a workshop EXIT may
  -- close. Kept separate from the state above on purpose.
  LEFT JOIN LATERAL (
    SELECT l.movement_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
      AND l.movement_context = 'workshop'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_workshop_movement ON true
  LEFT JOIN public.companies co ON co.id = last_movement.company_id
  LEFT JOIN public.projects pr ON pr.id = last_movement.project_id
  -- 0163: for a workshop ENTRY a «منتهية» supplier unit is offered too.
  WHERE (
      (e.is_active AND e.status = 'active')
      OR (p_movement_type = 'entry' AND e.status = 'rental_ended')
    )
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
      -- 0114: a previous code (A115 -> F84) still finds the same equipment.
      OR EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
      -- 0116: the type is compared normalised on both sides.
      OR e.type_search ILIKE '%' || v_term_search || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      -- 0116 (EM-117): the chassis number, as the two site searches match it.
      OR e.chassis_number ILIKE '%' || v_term || '%'
    )
    AND (
      p_movement_type = 'entry'
      OR (
        p_movement_type = 'exit'
        AND last_workshop_movement.movement_type = 'entry'
      )
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_workshop_equipment(text, text, text) IS
  '0195: the workshop picker (movements.workshop.create): for an ENTRY every active unit (and «منتهية» supplier units), for an EXIT the units whose latest WORKSHOP movement is an entry; search by code (and previous codes), type, plate, chassis; 20 rows. The state badge comes from the current movement: inside_workshop while a workshop visit is open, else inside_site while a site visit is open (with that entry''s company, project and since), else outside, else none.';

REVOKE ALL ON FUNCTION public.search_workshop_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_equipment(text, text, text) TO authenticated;

-- ===========================================================================
-- 12. The supplier rental status
-- ===========================================================================
-- guard_equipment_rental_ended: latest 0163. Its trigger is not re-created.
CREATE OR REPLACE FUNCTION public.guard_equipment_rental_ended()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type text;
  v_workshop_type text;
BEGIN
  IF NEW.status = 'rental_ended'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'rental_ended') THEN
    -- 0195: inside while a visit of EITHER context is open (the latest
    -- movement of that context is an entry).
    SELECT l.movement_type INTO v_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.id
      AND l.movement_context = 'site'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    SELECT l.movement_type INTO v_workshop_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.id
      AND l.movement_context = 'workshop'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF v_type = 'entry' OR v_workshop_type = 'entry' THEN
      RAISE EXCEPTION 'equipment_inside_cannot_end'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_equipment_rental_ended() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.guard_equipment_rental_ended() IS
  '0163/0195: refuses status rental_ended («منتهية») for a unit with an open '
  'visit of either context (its latest site or latest workshop movement is '
  'an ENTRY): its exit comes first.';

-- sync_equipment_rental_status: latest 0163. The trigger
-- equipment_rental_lifecycle and its function are not re-created.
CREATE OR REPLACE FUNCTION public.sync_equipment_rental_status(
  p_equipment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner text;
  v_status text;
  v_active boolean;
  v_type text;
  v_context text;
  v_site_type text;
  v_workshop_type text;
BEGIN
  IF p_equipment_id IS NULL THEN
    RETURN;
  END IF;
  SELECT e.ownership_status, e.status, e.is_active
    INTO v_owner, v_status, v_active
  FROM public.equipment e
  WHERE e.id = p_equipment_id;
  -- Supplier units only; a sold unit (or a deactivated active one) is left
  -- exactly as its owner set it.
  IF NOT FOUND
     OR v_owner IS DISTINCT FROM 'external_supplier'
     OR NOT (v_status = 'rental_ended' OR (v_status = 'active' AND v_active)) THEN
    RETURN;
  END IF;

  SELECT l.movement_type, l.movement_context INTO v_type, v_context
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  -- 0195: the latest movement of each context (a workshop stay may nest in
  -- a project visit).
  SELECT l.movement_type INTO v_site_type
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
    AND l.movement_context = 'site'
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
  SELECT l.movement_type INTO v_workshop_type
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
    AND l.movement_context = 'workshop'
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  -- 0195: ended only after a project exit while no workshop visit is open;
  -- active again whenever a visit of either context is open.
  IF v_status = 'active' AND v_type = 'exit' AND v_context = 'site'
     AND v_workshop_type IS DISTINCT FROM 'entry' THEN
    UPDATE public.equipment SET status = 'rental_ended'
    WHERE id = p_equipment_id;
  ELSIF v_status = 'rental_ended'
        AND (v_site_type = 'entry' OR v_workshop_type = 'entry') THEN
    UPDATE public.equipment SET status = 'active', is_active = true
    WHERE id = p_equipment_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_equipment_rental_status(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sync_equipment_rental_status(uuid) IS
  '0163/0195: a supplier unit becomes rental_ended («منتهية») when its latest '
  'movement is an EXIT from a project and no workshop visit is open, and '
  'active again whenever a visit of either context is open. Called by the '
  'movement trigger only; it runs inside the movement''s transaction, after '
  'the sequence trigger took the unit''s advisory lock.';

-- ===========================================================================
-- 13. driver_equipment_summary: is_current from the latest SITE movement
-- ===========================================================================
-- driver_equipment_summary: latest 0092. Columns unchanged.
CREATE OR REPLACE VIEW public.driver_equipment_summary
WITH (security_invoker = true)
AS
SELECT
  attributed.driver_id,
  attributed.equipment_id,
  eq.code AS equipment_code,
  eq.type AS equipment_type,
  eq.plate_number AS equipment_plate_number,
  count(*)::integer AS times_driven,
  (array_agg(
     attributed.recorded_at
     ORDER BY attributed.recorded_at DESC, attributed.entry_log_id DESC
   ))[1] AS last_driven_at,
  (array_agg(
     attributed.entry_log_id
     ORDER BY attributed.recorded_at DESC, attributed.entry_log_id DESC
   ))[1] AS last_entry_log_id,
  COALESCE(current_visit.driver_id = attributed.driver_id, false) AS is_current
FROM (
  -- The driver the site ENTRY was recorded with.
  SELECT l.equipment_id, l.driver_id, l.id AS entry_log_id, l.recorded_at
  FROM public.entry_exit_logs l
  WHERE l.movement_type = 'entry'
    AND l.movement_context = 'site'
    AND l.driver_id IS NOT NULL
  UNION
  -- Any driver who took the equipment over while that visit was still open.
  SELECT l.equipment_id, c.new_driver_id, l.id, l.recorded_at
  FROM public.entry_exit_logs l
  JOIN public.movement_driver_changes c ON c.entry_log_id = l.id
  WHERE l.movement_type = 'entry'
    AND l.movement_context = 'site'
    AND c.new_driver_id IS NOT NULL
) attributed
LEFT JOIN public.equipment eq ON eq.id = attributed.equipment_id
LEFT JOIN LATERAL (
  -- Current driver of this equipment, but only while its latest SITE movement
  -- (0195: whatever the workshop rows say) is an open site ENTRY. Correlated
  -- so it runs for the equipment in hand instead of scanning every equipment
  -- row.
  SELECT COALESCE(latest_change.new_driver_id, latest.driver_id) AS driver_id
  FROM (
    SELECT l.id, l.movement_type, l.movement_context, l.driver_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = attributed.equipment_id
      AND l.movement_context = 'site'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) latest
  LEFT JOIN LATERAL (
    SELECT c.new_driver_id
    FROM public.movement_driver_changes c
    WHERE c.entry_log_id = latest.id
    ORDER BY c.changed_at DESC, c.id DESC
    LIMIT 1
  ) latest_change ON true
  WHERE latest.movement_type = 'entry'
    AND latest.movement_context = 'site'
) current_visit ON true
GROUP BY
  attributed.driver_id,
  attributed.equipment_id,
  eq.code,
  eq.type,
  eq.plate_number,
  current_visit.driver_id;

REVOKE ALL ON public.driver_equipment_summary FROM PUBLIC, anon;
GRANT SELECT ON public.driver_equipment_summary TO authenticated;

COMMENT ON VIEW public.driver_equipment_summary IS
  'Equipment a driver actually drove, derived from site ENTRY movements plus '
  'movement_driver_changes hand-overs: times_driven, last_driven_at (ties '
  'broken by (recorded_at, id)) and is_current for an open site visit (0195: '
  'the latest SITE movement is that entry, whatever the workshop rows say). '
  'security_invoker, so entry_exit_logs / movement_driver_changes RLS stays '
  'authoritative. Legacy movements that carry only the driver_name snapshot '
  'have no driver_id and are deliberately not attributed to any driver.';

-- ===========================================================================
-- 14. purchasing_site_visits / purchasing_site_units: in_workshop
-- ===========================================================================
-- purchasing_site_visits: latest 0194, one trailing column.
CREATE OR REPLACE VIEW public.purchasing_site_visits
WITH (security_invoker = true)
AS
SELECT
  v.entry_id,
  v.equipment_id,
  v.equipment_code,
  v.equipment_type,
  v.equipment_type_search,
  v.equipment_plate_number,
  e.chassis_number AS equipment_chassis_number,
  v.equipment_ownership_status,
  v.equipment_lessor_id,
  v.equipment_lessor_name,
  v.company_id,
  v.company_name_ar,
  v.company_name_en,
  v.project_id,
  v.project_name_ar,
  v.project_name_en,
  -- The foreman who recorded the site entry.
  v.entry_supervisor_id,
  v.entry_supervisor_name,
  v.entry_at,
  -- «ترقيم الشركة»: the client company's number on the entry, when set.
  v.contractor_equipment_code,
  -- The supplier PO of the visit (0189; 0194: an earlier visit's PO by its
  -- card's entry, see the join below).
  po.id AS supplier_po_id,
  po.po_number,
  (po.id IS NOT NULL) AS has_po,
  -- Without one: the open PO of the unit's party for this company and
  -- project, which the unit can join (add_supplier_po_equipment re-checks).
  -- 0148: only a PO whose start date is the day this unit entered.
  -- 0160: and only a DRAFT one (an approved PO is locked).
  party_po.id AS party_po_id,
  party_po.po_number AS party_po_number,
  -- 0169: the open CLIENT PO the unit sits on for this company and project.
  cpo.id AS client_po_id,
  cpo.po_number AS client_po_number,
  (cpo.id IS NOT NULL) AS has_client_po,
  -- 0169: without one, the open client PO of this company and project that
  -- the unit can join (add_client_po_equipment re-checks).
  project_cpo.id AS project_client_po_id,
  project_cpo.po_number AS project_client_po_number,
  -- 0188: the visit's state and its exit (NULL while inside).
  CASE WHEN v.exit_id IS NULL THEN 'inside' ELSE 'exited' END AS visit_state,
  v.exit_at,
  v.exit_purpose,
  -- 0192: appended; everything above is 0189 verbatim. When the visit's
  -- ENTRY was registered in the system (movement_visits, 0159).
  v.entry_created_at,
  -- 0195: appended; everything above is 0194 verbatim. The visit is open
  -- AND the unit sits in the workshop now (a nested workshop stay).
  (v.is_open AND ws_now.movement_type IS NOT DISTINCT FROM 'entry') AS in_workshop
FROM public.movement_visits v
LEFT JOIN public.equipment e ON e.id = v.equipment_id
LEFT JOIN LATERAL (
  -- 0189: the visit's supplier PO — a line of the unit on a PO of this
  -- company and project, through the card of this very visit, else (0194)
  -- through a card whose ENTRY is at or before this visit's entry in the
  -- chain's (recorded_at, id) order (a PO of an earlier stay still covers
  -- the unit when it returns; a PO of a LATER visit never marks an older
  -- one; the start date is free since 0194 and says nothing about the
  -- visit). The visit's own card first, then the latest card entry, then
  -- the latest PO. The card's entry is read under the reader's movement RLS.
  SELECT p.id, p.po_number
  FROM public.supplier_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.supplier_pos p ON p.id = l.supplier_po_id
  LEFT JOIN public.entry_exit_logs ce ON ce.id = c.entry_log_id
  WHERE c.equipment_id = v.equipment_id
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND (
      c.entry_log_id IS NOT DISTINCT FROM v.entry_id
      OR (ce.recorded_at, ce.id) <= (v.entry_at, v.entry_id)
    )
  ORDER BY (c.entry_log_id IS NOT DISTINCT FROM v.entry_id) DESC,
           ce.recorded_at DESC NULLS LAST, ce.id DESC NULLS LAST,
           p.created_at DESC, p.id DESC
  LIMIT 1
) po ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.supplier_pos p
  WHERE po.id IS NULL
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND p.start_date = (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date
    AND p.approval_status = 'draft'
    AND (
      (v.equipment_ownership_status = 'external_supplier'
        AND p.lessor_id IS NOT NULL
        AND p.lessor_id = v.equipment_lessor_id)
      OR (v.equipment_ownership_status <> 'external_supplier'
        AND p.owner_class = v.equipment_ownership_status)
    )
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) party_po ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.client_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.client_pos p ON p.id = l.client_po_id
  WHERE c.equipment_id = v.equipment_id
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    -- 0189: a CLOSED visit only through its own card (0188 used the card's
    -- period, which is gone), so a later visit's PO does not cover it.
    AND (
      v.exit_id IS NULL
      OR c.entry_log_id IS NOT DISTINCT FROM v.entry_id
    )
  ORDER BY (c.entry_log_id IS NOT DISTINCT FROM v.entry_id) DESC, p.created_at DESC, p.id DESC
  LIMIT 1
) cpo ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.client_pos p
  WHERE cpo.id IS NULL
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) project_cpo ON true
-- 0195: the unit's latest WORKSHOP movement, for in_workshop.
LEFT JOIN LATERAL (
  SELECT wl.movement_type
  FROM public.entry_exit_logs wl
  WHERE wl.equipment_id = v.equipment_id
    AND wl.movement_context = 'workshop'
  ORDER BY wl.recorded_at DESC, wl.id DESC
  LIMIT 1
) ws_now ON v.is_open
WHERE v.movement_context = 'site';

COMMENT ON VIEW public.purchasing_site_visits IS
  '0188/0189/0192/0194/0195: every SITE visit of movement_visits, open or closed, with the supplier PO of the visit (supplier_po_id, po_number, has_po) — a line of the unit on a PO of that company and project through the visit''s own card, else (0194) through a card whose entry is at or before the visit''s entry in (recorded_at, id) order (the visit''s card first, then the latest card entry, then the latest PO; a supplier PO has no open / closed state and its start date is free since 0194) —, else the DRAFT PO of its party there whose start date is the visit''s entry day that it can join (party_po_id, party_po_number), the client columns of 0169 (the open client PO; a closed visit only through its own card) and visit_state (inside / exited), exit_at and exit_purpose; since 0192 also entry_created_at, when the visit''s entry was registered in the system; since 0195 in_workshop, true while the visit is open and the unit''s latest workshop movement is an entry (a workshop stay nested in the visit). The «المعدات في المشاريع» page. security_invoker: movements RLS (also for the cards'' entries and the workshop rows), purchasing.view and sales.view apply as for the reader.';

REVOKE ALL ON public.purchasing_site_visits FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_site_visits TO authenticated;

-- purchasing_site_units: latest 0194, one trailing column.
CREATE OR REPLACE VIEW public.purchasing_site_units
WITH (security_invoker = true)
AS
SELECT
  v.entry_id,
  v.equipment_id,
  v.equipment_code,
  v.equipment_type,
  v.equipment_type_search,
  v.equipment_plate_number,
  e.chassis_number AS equipment_chassis_number,
  v.equipment_ownership_status,
  v.equipment_lessor_id,
  v.equipment_lessor_name,
  v.company_id,
  v.company_name_ar,
  v.company_name_en,
  v.project_id,
  v.project_name_ar,
  v.project_name_en,
  -- The foreman who recorded the open site entry.
  v.entry_supervisor_id,
  v.entry_supervisor_name,
  v.entry_at,
  -- «ترقيم الشركة»: the client company's number on the entry, when set.
  v.contractor_equipment_code,
  -- The open PO the unit sits on for this company and project.
  po.id AS supplier_po_id,
  po.po_number,
  (po.id IS NOT NULL) AS has_po,
  -- Without one: the open PO of the unit's party for this company and
  -- project, which the unit can join (add_supplier_po_equipment re-checks).
  -- 0148: only a PO whose start date is the day this unit entered.
  -- 0160: and only a DRAFT one (an approved PO is locked).
  party_po.id AS party_po_id,
  party_po.po_number AS party_po_number,
  -- 0169: the open CLIENT PO the unit sits on for this company and project.
  cpo.id AS client_po_id,
  cpo.po_number AS client_po_number,
  (cpo.id IS NOT NULL) AS has_client_po,
  -- 0169: without one, the open client PO of this company and project that
  -- the unit can join (add_client_po_equipment re-checks).
  project_cpo.id AS project_client_po_id,
  project_cpo.po_number AS project_client_po_number,
  -- 0195: appended; everything above is 0194 verbatim. The unit sits in the
  -- workshop now while its project visit is open (a nested workshop stay).
  (v.is_open AND ws_now.movement_type IS NOT DISTINCT FROM 'entry') AS in_workshop
FROM public.movement_visits v
LEFT JOIN public.equipment e ON e.id = v.equipment_id
LEFT JOIN LATERAL (
  -- 0189: the visit's supplier PO — a line of the unit on a PO of this
  -- company and project, through the card of this very visit, else (0194)
  -- through a card whose ENTRY is at or before this visit's entry in the
  -- chain's (recorded_at, id) order (a PO of an earlier stay still covers
  -- the unit when it returns; a PO of a LATER visit never marks an older
  -- one; the start date is free since 0194 and says nothing about the
  -- visit). The visit's own card first, then the latest card entry, then
  -- the latest PO. The card's entry is read under the reader's movement RLS.
  SELECT p.id, p.po_number
  FROM public.supplier_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.supplier_pos p ON p.id = l.supplier_po_id
  LEFT JOIN public.entry_exit_logs ce ON ce.id = c.entry_log_id
  WHERE c.equipment_id = v.equipment_id
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND (
      c.entry_log_id IS NOT DISTINCT FROM v.entry_id
      OR (ce.recorded_at, ce.id) <= (v.entry_at, v.entry_id)
    )
  ORDER BY (c.entry_log_id IS NOT DISTINCT FROM v.entry_id) DESC,
           ce.recorded_at DESC NULLS LAST, ce.id DESC NULLS LAST,
           p.created_at DESC, p.id DESC
  LIMIT 1
) po ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.supplier_pos p
  WHERE po.id IS NULL
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND p.start_date = (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date
    AND p.approval_status = 'draft'
    AND (
      (v.equipment_ownership_status = 'external_supplier'
        AND p.lessor_id IS NOT NULL
        AND p.lessor_id = v.equipment_lessor_id)
      OR (v.equipment_ownership_status <> 'external_supplier'
        AND p.owner_class = v.equipment_ownership_status)
    )
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) party_po ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.client_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.client_pos p ON p.id = l.client_po_id
  WHERE c.equipment_id = v.equipment_id
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) cpo ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.client_pos p
  WHERE cpo.id IS NULL
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) project_cpo ON true
-- 0195: the unit's latest WORKSHOP movement, for in_workshop.
LEFT JOIN LATERAL (
  SELECT wl.movement_type
  FROM public.entry_exit_logs wl
  WHERE wl.equipment_id = v.equipment_id
    AND wl.movement_context = 'workshop'
  ORDER BY wl.recorded_at DESC, wl.id DESC
  LIMIT 1
) ws_now ON v.is_open
WHERE v.is_open
  AND v.movement_context = 'site';

COMMENT ON VIEW public.purchasing_site_units IS
  '0147/0148/0160/0169/0189/0194/0195: the units inside a project now (open site visits of movement_visits) with the supplier PO of the visit (supplier_po_id, po_number, has_po) — as purchasing_site_visits finds it: through the visit''s own card, else (0194) through a card whose entry is at or before the visit''s entry (a supplier PO has no open / closed state and its start date is free since 0194) —, else the DRAFT PO of their party there whose start date is the visit''s entry day (Saudi time) that they can join (party_po_id, party_po_number); and (0169) the open client PO they sit on there (client_po_id, client_po_number, has_client_po), else the open client PO of that company and project they can join (project_client_po_id, project_client_po_number); since 0195 in_workshop, true while the unit''s latest workshop movement is an entry (a workshop stay nested in the visit). The inquiry''s PO card reads it. security_invoker: movements RLS (also for the cards'' entries and the workshop rows), purchasing.view and sales.view apply as for the reader.';

REVOKE ALL ON public.purchasing_site_units FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_site_units TO authenticated;

-- ===========================================================================
-- 15. get_admin_fleet_equipment: the open site visit's names
-- ===========================================================================
-- get_admin_fleet_equipment: latest 0156. The return type gains four trailing
-- columns, so the function is dropped and created again (no database object
-- depends on it), with the grants of 0127.
DROP FUNCTION IF EXISTS public.get_admin_fleet_equipment(text, text[], text, integer, integer, text);

CREATE OR REPLACE FUNCTION public.get_admin_fleet_equipment(
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
  is_new boolean,
  site_company_name_ar text,
  site_company_name_en text,
  site_project_name_ar text,
  site_project_name_en text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- 500 is the largest page size the shared list system offers, and the
  -- Excel export walks the function in pages of 500.
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 7), 1), 500);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_owners text[];
  v_states text[];
  -- 0121: the requested order; NULL is the order the tables always had.
  v_sort text := COALESCE(p_sort, 'last_movement_desc');
BEGIN
  IF NOT public.has_permission('home.admin') THEN
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
    s.is_new,
    -- 0195: appended. The OPEN site visit's company and project (also for a
    -- workshop row nested in a project, «تابعة لمشروع»); NULL when none.
    sc.name_ar AS site_company_name_ar,
    sc.name_en AS site_company_name_en,
    sp.name_ar AS site_project_name_ar,
    sp.name_en AS site_project_name_en
  FROM public.admin_equipment_state s
  LEFT JOIN public.companies c ON c.id = s.last_company_id
  LEFT JOIN public.projects p ON p.id = s.last_project_id
  LEFT JOIN public.companies sc ON sc.id = s.site_company_id
  LEFT JOIN public.projects sp ON sp.id = s.site_project_id
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

REVOKE ALL ON FUNCTION public.get_admin_fleet_equipment(text, text[], text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_fleet_equipment(text, text[], text, integer, integer, text) TO authenticated;

COMMENT ON FUNCTION public.get_admin_fleet_equipment(text, text[], text, integer, integer, text) IS
  '0195: one page of the admin fleet tables (home.admin) over admin_equipment_state: p_state inside_site / workshop / available (p_purpose narrows the workshop), owners, allowlisted sort, at most 500 rows, total_count on every row. Since 0195 a workshop stay nested in a project counts in the workshop, and the trailing site_company_name_ar / _en and site_project_name_ar / _en name the OPEN site visit''s company and project (NULL when none).';

-- ===========================================================================
-- 16. The closing guard
-- ===========================================================================
DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.enforce_movement_sequence()'::regprocedure);
  IF position('v_entry_context' IN v_def) > 0 THEN
    RAISE EXCEPTION '0195: enforce_movement_sequence still swaps the exit context';
  END IF;
  IF position('RAISE EXCEPTION ''equipment_in_workshop''' IN v_def) = 0
     OR position('l.movement_context = NEW.movement_context' IN v_def) = 0 THEN
    RAISE EXCEPTION '0195: enforce_movement_sequence lacks the per-context chain or R1';
  END IF;
  IF to_regprocedure('public.equipment_state_from_presence(boolean, text, boolean)') IS NULL THEN
    RAISE EXCEPTION '0195: equipment_state_from_presence is missing';
  END IF;
  IF to_regprocedure('public.get_equipment_presence(uuid)') IS NULL THEN
    RAISE EXCEPTION '0195: get_equipment_presence is missing';
  END IF;
  IF to_regprocedure('public.get_last_movement(uuid, text)') IS NULL THEN
    RAISE EXCEPTION '0195: get_last_movement must stay';
  END IF;
  IF position('equipment_state_from_movement' IN pg_get_functiondef(
       'public.equipment_state(public.equipment)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '0195: equipment_state still reads the latest movement';
  END IF;
  IF position('PARTITION BY l.movement_context' IN pg_get_functiondef(
       'public.movement_sequence_violations(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0195: movement_sequence_violations is still global';
  END IF;
  IF position('movement_context = v_log.movement_context' IN pg_get_functiondef(
       'public.admin_delete_movement(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0195: admin_delete_movement still compares global neighbours';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'admin_equipment_state'
        AND column_name IN ('site_entry_id', 'site_entry_at', 'site_company_id', 'site_project_id')) <> 4 THEN
    RAISE EXCEPTION '0195: admin_equipment_state lacks the site_* columns';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('purchasing_site_visits', 'purchasing_site_units')
        AND column_name = 'in_workshop') <> 2 THEN
    RAISE EXCEPTION '0195: a purchasing view lacks in_workshop';
  END IF;
  IF to_regprocedure('public.get_admin_fleet_equipment(text, text[], text, integer, integer, text)') IS NULL
     OR position('site_project_name_ar' IN pg_get_function_result(
       'public.get_admin_fleet_equipment(text, text[], text, integer, integer, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0195: get_admin_fleet_equipment lacks the site columns';
  END IF;
  IF has_function_privilege('anon', 'public.get_equipment_presence(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.movement_sequence_violations(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0195: unexpected execute privilege';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
