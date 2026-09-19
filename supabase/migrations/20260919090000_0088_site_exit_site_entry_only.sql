-- Follow-up to 0087 after the owner's live test (2026-09-19): a foreman could
-- still pick equipment that is currently INSIDE THE WORKSHOP in the site-exit
-- list, because 0087 kept the old "workshop entries are shared" clause for
-- site exits. A site EXIT must close a SITE entry. This migration:
--   * sequence trigger: a non-admin site EXIT is rejected when the open entry
--     is a workshop entry (`exit_equipment_in_workshop`), in addition to the
--     0087 owner check (`exit_not_entry_owner`). Admins stay exempt so the
--     import and opening-balance paths keep working. New inserts only.
--   * search_site_exit_equipment: lists only equipment whose latest movement
--     is a SITE entry; non-admins see their own entries only.
-- Everything else in both functions is identical to 0087.

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
      IF NEW.driver_id IS NULL THEN
        IF current_setting('app.movement_excel_import', true) IS DISTINCT FROM 'true'
           OR NOT public.is_admin() THEN
          RAISE EXCEPTION 'driver_id is required for an entry';
        END IF;
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

-- Equipment a caller may actually register a site EXIT for.
--
-- The site movement form used to list every active piece of equipment and only
-- validate after selection. With the rule above that would offer foremen
-- equipment they cannot exit, so the list is filtered in the database instead.
--
-- SECURITY DEFINER is required because `entry_exit_logs` RLS hides other
-- foremen's movements from a foreman: an invoker-rights view would compute the
-- "latest" movement from the caller's own rows only and could therefore show a
-- visit somebody else has already closed. The function is narrowly scoped: it
-- reads nothing but equipment master columns the caller can already read from
-- `public.equipment`, it never returns who owns a visit, it is restricted to
-- admin/supervisor, and it has a fixed search_path.
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
  numbering_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_is_admin boolean;
  v_term text;
  v_digits text;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL NOT IN (...)` alone evaluates to NULL, which would let it through.
  IF v_role IS NULL OR v_role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION 'foreman role required';
  END IF;
  v_is_admin := v_role = 'admin';

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  -- LIKE wildcards and the LIKE escape character are stripped so a search term
  -- can never widen the match. chr(92) is the backslash.
  v_term := NULLIF(btrim(translate(p_search, '%_' || chr(92), '')), '');
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
    e.numbering_status
  FROM public.equipment e
  JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.supervisor_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  WHERE e.is_active
    -- Only equipment currently inside, i.e. with an open visit.
    AND last_movement.movement_type = 'entry'
    -- A site exit closes a site entry only; equipment inside the workshop is
    -- never offered here (2026-09-19).
    AND last_movement.movement_context = 'site'
    AND (v_is_admin OR last_movement.supervisor_id = auth.uid())
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
      OR e.type ILIKE '%' || v_term || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      OR e.chassis_number ILIKE '%' || v_term || '%'
      OR (v_digits IS NOT NULL AND e.plate_digits ILIKE '%' || v_digits || '%')
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.search_site_exit_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_site_exit_equipment(text, text, text) TO authenticated;
