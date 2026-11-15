-- 0197: «اضافة زيارة كاملة» — record a WHOLE PAST project visit (its entry
-- and its exit together) in the name of a foreman, through ONE database
-- function.
--
-- Owner approval 2026-11-15 of the contract «اضافة زيارة كاملة»: a
-- permission-gated button on the log records a past project (site) visit;
-- project visits only, no photos, no WhatsApp notice, the exit is always
-- «انتهاء عمل» (work_completed), dates only (the two movements are stamped at
-- 12:00 Saudi time). It builds on the nested workshop rule of 0195: a
-- workshop stay inside the period is a stop of the visit, not a conflict.
--
-- Object by object:
--   1. The permission key `movements.site.add_past_visit` («الحركات: اضافة
--      زيارة كاملة بتاريخ سابق»), group movements, unscoped, enforced_in
--      database, requires movements.read (the button lives on the log), not
--      admin_only, so any role can be given it on the roles page. Granted to
--      the admin role here (the 0160 / 0174 catalogue shape).
--   2. enforce_movement_sequence() (latest 0195): 0195 verbatim plus ONE
--      predicate, v_past_visit, used three times — it replaces the
--      movements.site.create requirement of the site branch and the
--      exit_not_entry_owner rule of a site exit for the rows that
--      add_past_site_visit inserts, and it lets the ENTRY of such a visit
--      stand right before a later ENTRY of its context (the function inserts
--      the visit's EXIT next, in the same transaction, after refusing any
--      overlap; without it a visit BETWEEN two existing visits was refused —
--      found in the production rehearsal). Everything else (the per-context
--      chain for every other row, the «same type as the row before» check,
--      R1 equipment_in_workshop, the future-time check, the driver snapshot,
--      the inherited exit facts, created_at = now(), the 0135 purpose rule)
--      runs unchanged for those rows too.
--   3. enforce_site_entry_driver() (latest 0156): 0156 verbatim plus the same
--      predicate as a second exemption beside the Excel import's, so the
--      driver of a past visit is optional.
--   4. add_past_site_visit(...): NEW, SECURITY DEFINER. Order of work: the
--      gate (past_visit_required, 42501), the validation (each a stable
--      token, 22023), the sequence trigger's per-equipment advisory key
--      (before any read of the unit's movements), the OVERLAP check of site
--      visits against site visits BY SAUDI DAYS (visit_overlap, 55000,
--      DETAIL = a JSON object of the earliest conflicting visit), the two
--      instants fitted between the unit's real movements (visit_no_gap,
--      55000, when no room is left on those days), then the ENTRY and the
--      EXIT through the table's normal triggers (sequence + R1, driver, exit
--      purpose, photo_url, audit with the caller as actor, rental
--      lifecycle). Returns the two ids.
--
-- Why days and fitted instants (coordinator review 2026-11-15): stored
-- movements carry real clock times while the form has dates only. With a
-- fixed 12:00 a legitimate handover would be refused — the unit left
-- project X on 11 Sep at 16:30 and the user adds «11-13 Sep» elsewhere: a
-- 12:00 entry would fall inside X's visit. So:
--   * a visit conflicts only when the DAYS overlap beyond a shared boundary
--     day (existing d1 < new exit day AND existing d2 > new entry day; d2 =
--     infinity for an open visit);
--   * the entry is 12:00 of its day, moved after the last movement of the
--     visits before (+1 minute) and after a workshop exit of that day
--     (+1 minute) when the unit came out of the workshop that day;
--   * the exit is 12:00 of its day (same day: one minute after the entry),
--     capped at now() and one minute before the first entry of the visits
--     after; when squeezed the entry is pulled back first, then the exit
--     pushed up to the cap;
--   * both instants must keep their Saudi days and their order, else
--     visit_no_gap.
--   Cases checked: no other movement (12:00 / 12:00, same day 12:00 /
--   12:01); a previous exit 16:30 on the entry day (entry 16:31); a next
--   entry 09:00 on the exit day (exit 08:59); exit 16:30 and next entry
--   16:31 around a same-day visit (visit_no_gap); 5-11 then 11-13 accepted,
--   12-12 / open since 10 / identical refused, 13-20 or open since 13
--   accepted before it; workshop exit 15:00 on the entry day (entry 15:01),
--   on a later day (equipment_in_workshop from the trigger); today before
--   noon (exit now(), same day entry now() - 1 minute).
--
-- The exemption marker, and why it is safe:
--   add_past_site_visit sets the TRANSACTION-LOCAL setting
--   `app.past_site_visit` to the unit's id right before its two inserts and
--   clears it right after them. The triggers exempt a row only when ALL of
--   these hold: the row is a SITE row, the setting equals THAT row's
--   equipment_id, and the caller holds movements.site.add_past_visit. So:
--     * clients reach the database only through PostgREST, which cannot set
--       an `app.*` setting (pg_catalog.set_config is not exposed, and no
--       public function wraps it); the same reasoning protects the 0063
--       import marker `app.movement_excel_import` since 0108;
--     * even if a key holder could set it, a direct INSERT would still meet
--       RLS (insert_entry_exit_logs) and every other trigger rule, and the
--       exemption would give him no more than the function itself gives;
--     * the marker names one unit and dies with the statement pair (cleared,
--       and transaction-local anyway; a failed insert rolls it back).
--   No other caller's rule changes: without the marker every branch of the
--   two triggers behaves exactly as in 0195 / 0156.
--
-- Not changed: RLS, enforce_site_exit_purpose (the exit carries
-- work_completed), enforce_movement_photo_url (no photo_url is sent),
-- audit_movement_change (actor = auth.uid() = the caller),
-- equipment_rental_lifecycle / sync_equipment_rental_status (a supplier unit
-- whose LATEST movement becomes this past exit turns «منتهية», as any exit
-- does), guard_movement_with_po (UPDATE / DELETE only), import_movement_rows.
-- No movement_notices row is prepared.
--
-- Rollout: apply before deploying the screens that call it; nothing live
-- depends on it (the two re-created trigger functions behave exactly as
-- before for every existing path).

-- ===========================================================================
-- 1. The permission key, held by the admin role (the 0160 / 0174 shape)
-- ===========================================================================
INSERT INTO public.permissions (
  key, group_key, name_ar, name_en, description_ar, description_en,
  scoped, scopes, requires, admin_only, enforced_in, sort
) VALUES (
  'movements.site.add_past_visit', 'movements',
  'الحركات: اضافة زيارة كاملة بتاريخ سابق', 'Movements: add a whole past project visit',
  'تسجيل زيارة مشروع انتهت في الماضي، الدخول والخروج معا، باسم فورمان. الخروج يسجل «انتهاء عمل»، ولا تقبل زيارة تتعارض مع زيارة مشروع اخرى للمعدة.',
  'Record a project visit that ended in the past, its entry and exit together, in a foreman''s name. The exit is recorded as work completed; a visit that overlaps another project visit of the unit is refused.',
  false, NULL, ARRAY['movements.read'], false, 'database', 115
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_key, permission_key, scope)
VALUES ('admin', 'movements.site.add_past_visit', NULL)
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- ===========================================================================
-- 2. enforce_movement_sequence: 0195 verbatim plus the past-visit marker
-- ===========================================================================
-- enforce_movement_sequence: latest 0195, verbatim plus v_past_visit (marked
-- "0197"). The trigger itself (BEFORE INSERT, 0021) is not re-created.
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
  -- 0197: a site row inserted by add_past_site_visit for this unit.
  v_past_visit boolean;
BEGIN
  NEW.created_at := now();

  IF NEW.movement_type NOT IN ('entry', 'exit')
     OR NEW.movement_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'invalid movement';
  END IF;
  IF NEW.recorded_at > now() THEN
    RAISE EXCEPTION 'movement time cannot be in the future';
  END IF;

  -- 0197: the transaction-local marker set only by add_past_site_visit (the
  -- unit's id) AND the caller's movements.site.add_past_visit. COALESCE:
  -- an unset marker reads NULL, and a NULL here must never skip a raise.
  v_past_visit := COALESCE(
    NEW.movement_context = 'site'
      AND current_setting('app.past_site_visit', true) = NEW.equipment_id::text
      AND public.has_permission('movements.site.add_past_visit'),
    false
  );

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
    IF NOT public.has_permission('movements.site.create')
       AND NOT v_past_visit THEN
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

  -- 0197: the ENTRY of a past visit may stand right before a later ENTRY of
  -- its context: add_past_site_visit inserts the visit's EXIT next, in the
  -- same transaction, after it refused any overlap by days — so the chain
  -- alternates again once both rows are in (found in the production
  -- rehearsal: without this a visit between two existing visits was refused).
  IF (v_before IS NOT NULL AND v_before = NEW.movement_type)
     OR (v_after IS NOT NULL AND v_after = NEW.movement_type
         AND NOT (v_past_visit AND NEW.movement_type = 'entry')) THEN
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
       AND NOT v_past_visit
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
  '0195: the chain is per context (site and workshop each alternate ENTRY, EXIT ... from an ENTRY, ordered by (recorded_at, id)); a workshop stay may nest inside an open site visit (owner 2026-11-14). R1: a site ENTRY while the latest workshop movement before it is an ENTRY is refused (equipment_in_workshop, 55000), and a workshop ENTRY with a later site ENTRY before the next workshop movement (sequence would be invalid). An EXIT keeps its sent context (the 0155 swap is gone) and closes the open entry of that context, inheriting its facts; exit_not_entry_owner is checked against that site entry. exit_equipment_in_workshop / exit_equipment_on_site (55000): an exit with no open visit of its own context while the other context is open. 0135 purpose rule unchanged. 0197: a site row inserted by add_past_site_visit (the transaction-local app.past_site_visit equal to the row''s equipment_id AND movements.site.add_past_visit) needs no movements.site.create, is exempt from exit_not_entry_owner, and its ENTRY may stand right before a later ENTRY of the context (its EXIT follows in the same call); every other rule applies to it.';

-- ===========================================================================
-- 3. enforce_site_entry_driver: 0156 verbatim plus the past-visit marker
-- ===========================================================================
-- enforce_site_entry_driver: latest 0156, verbatim plus the exemption marked
-- "0197". The trigger itself (BEFORE INSERT, 0120) is not re-created.
CREATE OR REPLACE FUNCTION public.enforce_site_entry_driver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only a SITE ENTRY names a driver. A site exit inherits the visit's
  -- current driver and a workshop row never carries one.
  IF NEW.movement_type IS DISTINCT FROM 'entry'
     OR NEW.movement_context IS DISTINCT FROM 'site'
     OR NEW.driver_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- The admin Excel import (0063) may carry a driver name only, or none. Same
  -- predicate as 0108 (M8) and 0115: the transaction-local marker set by
  -- public.import_movement_rows AND an admin caller.
  IF current_setting('app.movement_excel_import', true) = 'true'
     AND public.has_permission('movements.import') THEN
    RETURN NEW;
  END IF;

  -- 0197: a past visit recorded by add_past_site_visit names its driver only
  -- when it is known: the transaction-local marker equal to this unit AND
  -- movements.site.add_past_visit.
  IF current_setting('app.past_site_visit', true) = NEW.equipment_id::text
     AND public.has_permission('movements.site.add_past_visit') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'site_entry_driver_required'
    USING ERRCODE = '23514',
          HINT = 'Select the driver of the site entry.';
END;
$$;

-- A trigger function is never called directly (0025).
REVOKE ALL ON FUNCTION public.enforce_site_entry_driver()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_site_entry_driver() IS
  'BEFORE INSERT trigger on entry_exit_logs: a site entry requires driver_id (site_entry_driver_required), except for the admin Excel import marked by app.movement_excel_import and (0197) a past visit of add_past_site_visit marked by app.past_site_visit (the unit''s id) with movements.site.add_past_visit. Never writes NEW. Fires after enforce_movement_sequence and before enforce_site_exit_purpose (alphabetical order).';

-- ===========================================================================
-- 4. add_past_site_visit
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.add_past_site_visit(
  p_equipment_id uuid,
  p_supervisor_id uuid,
  p_company_id uuid,
  p_project_id uuid,
  p_entry_date date,
  p_exit_date date,
  p_driver_id uuid DEFAULT NULL,
  p_contractor_equipment_code text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS TABLE (entry_id uuid, exit_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
  v_notes text;
  v_today date;
  v_visit record;
  v_floor timestamptz;
  v_ceiling timestamptz;
  v_base_entry timestamptz;
  v_base_exit timestamptz;
  v_ws record;
  v_ws_exit_at timestamptz;
  v_ws_bound timestamptz;
  v_cap timestamptz;
  v_entry_at timestamptz;
  v_exit_at timestamptz;
  v_entry_id uuid;
  v_exit_id uuid;
BEGIN
  -- 1. The gate.
  IF auth.uid() IS NULL
     OR NOT public.has_permission('movements.site.add_past_visit') THEN
    RAISE EXCEPTION 'past_visit_required'
      USING ERRCODE = '42501',
            HINT = 'Adding a past project visit needs the movements.site.add_past_visit permission.';
  END IF;

  -- 2. The validation, each with its own stable token.
  IF p_equipment_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.equipment e WHERE e.id = p_equipment_id) THEN
    RAISE EXCEPTION 'invalid_equipment'
      USING ERRCODE = '22023', HINT = 'The equipment does not exist.';
  END IF;

  -- The foreman: a profile whose ASSIGNED active role holds
  -- movements.site.create (0152 / 0158 shape), or the admin role.
  IF p_supervisor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.profile_roles pr
      ON pr.profile_id = p.id
    JOIN public.roles r
      ON r.key = pr.role_key
     AND r.is_active
    WHERE p.id = p_supervisor_id
      AND (
        pr.role_key = 'admin'
        OR EXISTS (
          SELECT 1
          FROM public.role_permissions rp
          WHERE rp.role_key = pr.role_key
            AND rp.permission_key = 'movements.site.create'
        )
      )
  ) THEN
    RAISE EXCEPTION 'invalid_supervisor'
      USING ERRCODE = '22023',
            HINT = 'The foreman must be a user whose role records project movements.';
  END IF;

  IF p_company_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'invalid_company'
      USING ERRCODE = '22023', HINT = 'The company does not exist.';
  END IF;
  IF p_project_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.projects pj WHERE pj.id = p_project_id) THEN
    RAISE EXCEPTION 'invalid_project'
      USING ERRCODE = '22023', HINT = 'The project does not exist.';
  END IF;
  IF p_driver_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = p_driver_id) THEN
    RAISE EXCEPTION 'invalid_driver'
      USING ERRCODE = '22023', HINT = 'The selected driver does not exist.';
  END IF;

  -- The limits of admin_update_movement (0195): 50 and 1000 characters.
  v_code := NULLIF(btrim(p_contractor_equipment_code), '');
  IF v_code IS NOT NULL AND char_length(v_code) > 50 THEN
    RAISE EXCEPTION 'invalid_contractor_code'
      USING ERRCODE = '22023',
            HINT = 'The contractor equipment code is limited to 50 characters.';
  END IF;
  v_notes := NULLIF(btrim(p_notes), '');
  IF v_notes IS NOT NULL AND char_length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'invalid_notes'
      USING ERRCODE = '22023', HINT = 'The note is limited to 1000 characters.';
  END IF;

  IF p_entry_date IS NULL OR p_exit_date IS NULL THEN
    RAISE EXCEPTION 'invalid_dates'
      USING ERRCODE = '22023', HINT = 'Both the entry date and the exit date are required.';
  END IF;
  IF p_exit_date < p_entry_date THEN
    RAISE EXCEPTION 'exit_before_entry'
      USING ERRCODE = '22023', HINT = 'The exit date cannot be before the entry date.';
  END IF;
  -- The current Saudi day (UTC+03:00).
  v_today := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  IF p_exit_date > v_today THEN
    RAISE EXCEPTION 'visit_in_future'
      USING ERRCODE = '22023', HINT = 'The exit date cannot be after today.';
  END IF;

  -- 3. The sequence trigger's per-equipment key, BEFORE any read of the
  -- unit's movements, so nothing of this unit can be written between the
  -- reads below and the inserts (the trigger takes the same key again,
  -- re-entrantly).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0));

  -- 4. The unit's project (site) visits, BY SAUDI DAYS. A visit is a site
  -- ENTRY e with its closing movement x = the unit's next SITE movement by
  -- (recorded_at, id), possibly missing; d1 = the Saudi day of e, d2 = the
  -- Saudi day of x, or infinity while the visit is open. Workshop rows are
  -- never read here: a workshop stay inside the period is a stop nested in
  -- the visit (0195), not a conflict.
  --   * OVERLAP (visit_overlap): d1 < p_exit_date AND d2 > p_entry_date.
  --     Sharing only a boundary day is not a conflict: a visit that ends on
  --     the new entry day lies BEFORE the new visit, one that starts on the
  --     new exit day lies AFTER it. Read in (e.recorded_at, e.id) order, so
  --     the first conflict met is the earliest, the one named in DETAIL.
  --   * BEFORE (d2 <= p_entry_date): v_floor = the latest of their
  --     movements; the new entry comes after it.
  --   * AFTER (the rest: d1 >= p_exit_date AND d2 > p_entry_date): v_ceiling
  --     = the earliest of their entries; the new exit comes before it. On a
  --     same-day new visit, a whole visit on that day has d2 = p_entry_date,
  --     so it counts as BEFORE only.
  FOR v_visit IN
    SELECT e.id,
           e.recorded_at AS entry_at,
           x.recorded_at AS exit_at,
           (e.recorded_at AT TIME ZONE 'Asia/Riyadh')::date AS d1,
           COALESCE((x.recorded_at AT TIME ZONE 'Asia/Riyadh')::date, 'infinity'::date) AS d2,
           pj.name_ar AS project_name_ar,
           pj.name_en AS project_name_en
    FROM public.entry_exit_logs e
    LEFT JOIN LATERAL (
      SELECT n.recorded_at
      FROM public.entry_exit_logs n
      WHERE n.equipment_id = e.equipment_id
        AND n.movement_context = 'site'
        AND (n.recorded_at, n.id) > (e.recorded_at, e.id)
      ORDER BY n.recorded_at, n.id
      LIMIT 1
    ) x ON true
    LEFT JOIN public.projects pj ON pj.id = e.project_id
    WHERE e.equipment_id = p_equipment_id
      AND e.movement_context = 'site'
      AND e.movement_type = 'entry'
    ORDER BY e.recorded_at, e.id
  LOOP
    IF v_visit.d1 < p_exit_date AND v_visit.d2 > p_entry_date THEN
      RAISE EXCEPTION 'visit_overlap'
        USING ERRCODE = '55000',
              DETAIL = jsonb_build_object(
                'entry_id', v_visit.id,
                'entry_at', v_visit.entry_at,
                'exit_at', v_visit.exit_at,
                'project_name_ar', v_visit.project_name_ar,
                'project_name_en', v_visit.project_name_en
              )::text,
              HINT = 'The period overlaps another project visit of this equipment.';
    END IF;

    IF v_visit.d2 <= p_entry_date THEN
      -- BEFORE: its exit is its latest movement (a before-visit is closed).
      IF v_floor IS NULL OR v_visit.entry_at > v_floor THEN
        v_floor := v_visit.entry_at;
      END IF;
      IF v_visit.exit_at IS NOT NULL AND v_visit.exit_at > v_floor THEN
        v_floor := v_visit.exit_at;
      END IF;
    ELSE
      -- AFTER.
      IF v_ceiling IS NULL OR v_visit.entry_at < v_ceiling THEN
        v_ceiling := v_visit.entry_at;
      END IF;
    END IF;
  END LOOP;

  -- 5. The two instants. The base is 12:00 Saudi time on each day (the same
  -- day: the exit one minute after the entry); they are then fitted between
  -- the unit's real movements of those days. Every bound may be NULL (no
  -- such movement), so each one is applied in its own IF.
  v_base_entry := (p_entry_date + time '12:00') AT TIME ZONE 'Asia/Riyadh';
  IF p_exit_date = p_entry_date THEN
    v_base_exit := v_base_entry + interval '1 minute';
  ELSE
    v_base_exit := (p_exit_date + time '12:00') AT TIME ZONE 'Asia/Riyadh';
  END IF;

  -- The entry: after the last movement of the visits before.
  v_entry_at := v_base_entry;
  IF v_floor IS NOT NULL AND v_floor + interval '1 minute' > v_entry_at THEN
    v_entry_at := v_floor + interval '1 minute';
  END IF;

  -- The workshop on the entry day: when the unit's latest WORKSHOP movement
  -- before the entry is an ENTRY whose closing workshop movement falls on
  -- the entry day, the unit left the workshop that day and the project entry
  -- comes right after it. Otherwise nothing moves: an open workshop stay
  -- then makes the sequence trigger raise equipment_in_workshop (R1).
  SELECT w.id, w.recorded_at, w.movement_type
  INTO v_ws
  FROM public.entry_exit_logs w
  WHERE w.equipment_id = p_equipment_id
    AND w.movement_context = 'workshop'
    AND w.recorded_at < v_entry_at
  ORDER BY w.recorded_at DESC, w.id DESC
  LIMIT 1;
  IF FOUND AND v_ws.movement_type = 'entry' THEN
    SELECT n.recorded_at
    INTO v_ws_exit_at
    FROM public.entry_exit_logs n
    WHERE n.equipment_id = p_equipment_id
      AND n.movement_context = 'workshop'
      AND (n.recorded_at, n.id) > (v_ws.recorded_at, v_ws.id)
    ORDER BY n.recorded_at, n.id
    LIMIT 1;
    IF FOUND AND (v_ws_exit_at AT TIME ZONE 'Asia/Riyadh')::date = p_entry_date THEN
      v_ws_bound := v_ws_exit_at + interval '1 minute';
      IF v_ws_bound > v_entry_at THEN
        v_entry_at := v_ws_bound;
      END IF;
    END IF;
  END IF;

  -- The cap of the exit: now(), and before the first entry of the visits
  -- after.
  v_cap := now();
  IF v_ceiling IS NOT NULL AND v_ceiling - interval '1 minute' < v_cap THEN
    v_cap := v_ceiling - interval '1 minute';
  END IF;

  -- The exit: the base, at least one minute after the entry on the same
  -- day, never after the cap.
  v_exit_at := v_base_exit;
  IF p_exit_date = p_entry_date AND v_entry_at + interval '1 minute' > v_exit_at THEN
    v_exit_at := v_entry_at + interval '1 minute';
  END IF;
  IF v_exit_at > v_cap THEN
    v_exit_at := v_cap;
  END IF;

  -- Squeezed (today before noon, or movements close to noon): pull the
  -- entry back towards the exit, but never before its own bounds (the
  -- floor, the workshop exit); then, if still not before the exit, push the
  -- exit up to the cap.
  IF v_entry_at >= v_exit_at THEN
    v_entry_at := LEAST(v_base_entry, v_exit_at - interval '1 minute');
    IF v_floor IS NOT NULL AND v_floor + interval '1 minute' > v_entry_at THEN
      v_entry_at := v_floor + interval '1 minute';
    END IF;
    IF v_ws_bound IS NOT NULL AND v_ws_bound > v_entry_at THEN
      v_entry_at := v_ws_bound;
    END IF;
    IF v_entry_at >= v_exit_at THEN
      v_exit_at := LEAST(v_cap, v_entry_at + interval '1 minute');
    END IF;
  END IF;

  -- No room left on those days: the two movements must keep their days and
  -- their order.
  IF NOT (
    v_entry_at < v_exit_at
    AND (v_entry_at AT TIME ZONE 'Asia/Riyadh')::date = p_entry_date
    AND (v_exit_at AT TIME ZONE 'Asia/Riyadh')::date = p_exit_date
  ) THEN
    RAISE EXCEPTION 'visit_no_gap'
      USING ERRCODE = '55000',
            HINT = 'There is no room between the unit''s movements on that day.';
  END IF;

  -- 6. The ENTRY, then the EXIT, through the table's normal triggers, with
  -- the column conventions of import_movement_rows (0134). The marker names
  -- this unit for the two inserts only.
  PERFORM set_config('app.past_site_visit', p_equipment_id::text, true);

  INSERT INTO public.entry_exit_logs(
    equipment_id, supervisor_id, movement_type, movement_context,
    registration_method, driver_id, company_id, project_id,
    contractor_equipment_code, notes, recorded_at
  ) VALUES (
    p_equipment_id, p_supervisor_id, 'entry', 'site',
    'manual', p_driver_id, p_company_id, p_project_id,
    v_code, v_notes, v_entry_at
  ) RETURNING id INTO v_entry_id;

  -- The exit inherits company, project, contractor code and driver from the
  -- entry in the sequence trigger; its purpose is always «انتهاء عمل».
  INSERT INTO public.entry_exit_logs(
    equipment_id, supervisor_id, movement_type, movement_context,
    registration_method, exit_purpose, notes, recorded_at
  ) VALUES (
    p_equipment_id, p_supervisor_id, 'exit', 'site',
    'manual', 'work_completed', v_notes, v_exit_at
  ) RETURNING id INTO v_exit_id;

  PERFORM set_config('app.past_site_visit', '', true);

  -- 7. The two ids.
  RETURN QUERY SELECT v_entry_id, v_exit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_past_site_visit(uuid, uuid, uuid, uuid, date, date, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_past_site_visit(uuid, uuid, uuid, uuid, date, date, uuid, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.add_past_site_visit(uuid, uuid, uuid, uuid, date, date, uuid, text, text) IS
  '0197 «اضافة زيارة كاملة»: records a whole PAST project visit (a site ENTRY and its EXIT) in the name of a foreman. Needs movements.site.add_past_visit (past_visit_required, 42501). Tokens (22023): invalid_equipment, invalid_supervisor (not a profile whose assigned active role holds movements.site.create, or the admin role), invalid_company, invalid_project, invalid_driver, invalid_contractor_code (> 50), invalid_notes (> 1000), invalid_dates, exit_before_entry, visit_in_future (after the Saudi today). Under the sequence advisory key, taken before any read of the unit''s movements, it refuses an overlap BY SAUDI DAYS with another SITE visit of the unit (existing entry day < new exit day AND existing exit day, infinity while open, > new entry day; a shared boundary day is not a conflict; visit_overlap, 55000, DETAIL = JSON {entry_id, entry_at, exit_at, project_name_ar, project_name_en} of the earliest conflicting visit; a workshop stay is not a conflict). Instants: 12:00 Saudi time on each day (same day: exit = entry + 1 minute), the entry moved after the last movement of the visits before and after a workshop exit of the entry day, the exit capped at now() and before the first entry of the visits after; when no room is left on those days (both instants on their own days, entry before exit): visit_no_gap (55000). Then it inserts the entry and the exit (work_completed, the driver optional) through the normal triggers, exempted narrowly by the transaction-local app.past_site_visit. Returns the two ids. No notice, no photos.';

-- ===========================================================================
-- Guards
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions
    WHERE key = 'movements.site.add_past_visit'
      AND enforced_in = 'database'
      AND NOT scoped
  ) THEN
    RAISE EXCEPTION '0197: the key movements.site.add_past_visit is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_key = 'admin'
      AND permission_key = 'movements.site.add_past_visit'
  ) THEN
    RAISE EXCEPTION '0197: the admin role does not hold movements.site.add_past_visit';
  END IF;
  IF to_regprocedure('public.add_past_site_visit(uuid, uuid, uuid, uuid, date, date, uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION '0197: add_past_site_visit is missing';
  END IF;
  IF has_function_privilege(
       'anon',
       'public.add_past_site_visit(uuid, uuid, uuid, uuid, date, date, uuid, text, text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION '0197: anon can execute add_past_site_visit';
  END IF;
  IF position('app.past_site_visit' IN pg_get_functiondef('public.enforce_movement_sequence()'::regprocedure)) = 0
     OR position('app.past_site_visit' IN pg_get_functiondef('public.enforce_site_entry_driver()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0197: a trigger function lacks the past-visit marker';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
