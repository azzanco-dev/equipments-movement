-- 0156 — roles, stage 4c-2: the legacy column profiles.role is dropped.
--
-- Owner decision 2026-10-27 (retiring the legacy role in stages, «نبغى نشيل
-- التقسيم هذا وتكون كلها واحد»; «اهم شي مايتغير شي على المستخدمين»). Since
-- 0150 access is read from the assignment only (profile_roles, through
-- has_permission() / permission_scope() / current_permissions() /
-- is_admin()), since 0153 a role is changed through the assignment only and
-- since 0154 nothing writes profiles.role but the placeholder of
-- handle_new_user. The column decides nothing; this migration removes it and
-- everything that still mentions it, with NO change for any user.
--
-- Apply AFTER the manage-user / create-user Edge Functions and the screens
-- of this stage are live (manage-user's `get` no longer selects the column,
-- create-user no longer sends a role in app_metadata, the users screens no
-- longer read it).
--
--   A. Guards: the roles system is on, every profile holding the legacy
--      value 'admin' has an assignment, and somebody holds the admin role.
--      Otherwise the whole migration aborts and nothing changes.
--   B. Fifteen functions read the caller's legacy role into a variable that
--      nothing used since 0127 (the permission keys decide). Each is
--      re-created from its latest definition (named above it) VERBATIM,
--      minus that read and its variable (an emptied DECLARE goes too).
--      prepare_movement_exit_notice used `v_role IS NOT NULL` as "the caller
--      has a profile"; that meaning stays as an EXISTS on profiles. The
--      "missing profile is rejected" comments still hold: the permission
--      functions read the assignment, which needs a profile.
--   C. Eight admin home functions initialised an unused variable with
--      current_user_role(); re-created from 0127 verbatim minus that line.
--   D. handle_new_user (latest 0154) inserts the profile without a role.
--   E. What only served the legacy column goes: current_user_role() (0004),
--      admin_roles_system_offenders() and admin_roles_system_preview()
--      (0126), legacy_role_permissions(text) (latest 0136; its only caller
--      was the preview) and set_roles_system_enabled_0126 (the 0126 body
--      renamed by 0150). set_roles_system_enabled (the 0150 wrapper) keeps
--      its admin gate and its roles_system_permanent refusal; switching ON
--      returns the same jsonb shape, unchanged (the system is on for good).
--      The app_settings.roles_system flag is not touched.
--   F. The check profiles_role_check (0072), the index idx_profiles_role
--      (0001) and the column itself are dropped.
--   G. Guard: no function of the public schema, no view and no policy may
--      still reference the column or a dropped function.
-- CREATE OR REPLACE keeps the privileges and the comment of every function
-- re-created in B and C, so they are not restated.

-- ===========================================================================
-- A. Guards
-- ===========================================================================
DO $$
DECLARE
  v_missing integer;
BEGIN
  IF NOT public.roles_system_enabled() THEN
    RAISE EXCEPTION
      '0156: the roles system is not enabled; this migration would change access';
  END IF;

  SELECT count(*) INTO v_missing
  FROM public.profiles p
  WHERE p.role = 'admin'
    AND NOT EXISTS (
      SELECT 1
      FROM public.profile_roles pr
      WHERE pr.profile_id = p.id
    );
  IF v_missing > 0 THEN
    RAISE EXCEPTION
      '0156: % user(s) hold the legacy admin role without any role assignment',
      v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profile_roles pr WHERE pr.role_key = 'admin'
  ) THEN
    RAISE EXCEPTION '0156: nobody holds the admin role assignment';
  END IF;
END;
$$;

-- ===========================================================================
-- B. Functions without the unused legacy role read
-- ===========================================================================

-- change_active_movement_driver — latest 0127.
CREATE OR REPLACE FUNCTION public.change_active_movement_driver(
  p_entry_log_id uuid,
  p_new_driver_id uuid,
  p_note text DEFAULT NULL
)
RETURNS public.movement_driver_changes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed boolean;
  v_entry public.entry_exit_logs;
  v_next_type text;
  v_previous record;
  v_new public.drivers;
  v_change public.movement_driver_changes;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'entry_not_accessible'
      USING ERRCODE = '42501',
            HINT = 'Authentication is required.';
  END IF;

  -- Row lock first, advisory lock second: the same order as
  -- update_entry_contractor_code (0093) and the admin functions above, so two
  -- writers on the same entry queue instead of deadlocking, and the entry
  -- cannot change between this read and the insert below.
  SELECT * INTO v_entry
  FROM public.entry_exit_logs
  WHERE id = p_entry_log_id
    AND movement_type = 'entry'
    AND movement_context = 'site'
  FOR UPDATE;

  -- Write rule, not the read rule of can_access_movement(): an admin, or the
  -- foreman who registered this entry. `IS NOT TRUE` also rejects a missing
  -- row and a missing profile (NULL role), so the check fails closed, and a
  -- refused caller cannot tell a foreign entry from a missing one.
  v_allowed := FOUND AND public.movement_scope_allows(
    public.permission_scope('movements.site.driver_change'),
    v_entry.supervisor_id,
    v_entry.movement_context,
    v_entry.company_id
  );
  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'entry_not_accessible'
      USING ERRCODE = '42501',
            HINT = 'Only the foreman who registered the entry, or an admin, may change its driver.';
  END IF;

  -- EXACTLY the key of enforce_movement_sequence(): serialise against a
  -- concurrent EXIT for this equipment, so the open/closed decision and the
  -- driver an exit inherits cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_entry.equipment_id::text, 0));

  SELECT l.movement_type INTO v_next_type
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = v_entry.equipment_id
    AND (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id)
  ORDER BY l.recorded_at, l.id
  LIMIT 1;

  -- Closed by a later site EXIT (the 0067 rule), or by an EXIT recorded
  -- directly after the entry in the other context (an admin cross-context
  -- exit).
  IF v_next_type IS NOT DISTINCT FROM 'exit'
     OR EXISTS (
       SELECT 1
       FROM public.entry_exit_logs l
       WHERE l.equipment_id = v_entry.equipment_id
         AND l.movement_context = 'site'
         AND l.movement_type = 'exit'
         AND (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id)
     ) THEN
    RAISE EXCEPTION 'visit_is_closed';
  END IF;

  SELECT d.id, d.full_name INTO v_new
  FROM public.drivers d
  WHERE d.id = p_new_driver_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_driver_id'; END IF;

  SELECT c.new_driver_id AS id, c.new_driver_name AS full_name
  INTO v_previous
  FROM public.movement_driver_changes c
  WHERE c.entry_log_id = p_entry_log_id
  ORDER BY c.changed_at DESC, c.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT v_entry.driver_id AS id, v_entry.driver_name AS full_name
    INTO v_previous;
  END IF;

  IF v_previous.id = v_new.id THEN
    RAISE EXCEPTION 'driver_unchanged';
  END IF;

  INSERT INTO public.movement_driver_changes (
    entry_log_id,
    previous_driver_id,
    previous_driver_name,
    new_driver_id,
    new_driver_name,
    changed_by,
    note
  ) VALUES (
    p_entry_log_id,
    v_previous.id,
    v_previous.full_name,
    v_new.id,
    v_new.full_name,
    auth.uid(),
    NULLIF(btrim(p_note), '')
  )
  RETURNING * INTO v_change;

  RETURN v_change;
END;
$$;

-- classify_workshop_entry — latest 0127.
CREATE OR REPLACE FUNCTION public.classify_workshop_entry(p_entry_log_id uuid, p_purpose text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry public.entry_exit_logs;
  v_is_open boolean;
BEGIN
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF NOT public.has_permission('movements.workshop.classify') THEN
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

-- enforce_site_entry_driver — latest 0127.
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

  RAISE EXCEPTION 'site_entry_driver_required'
    USING ERRCODE = '23514',
          HINT = 'Select the driver of the site entry.';
END;
$$;

-- enforce_site_exit_purpose — latest 0127.
CREATE OR REPLACE FUNCTION public.enforce_site_exit_purpose()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only a SITE EXIT carries a purpose. Anything sent with another row is
  -- dropped rather than rejected, like the site facts of a workshop row.
  IF NEW.movement_type IS DISTINCT FROM 'exit'
     OR NEW.movement_context IS DISTINCT FROM 'site' THEN
    NEW.exit_purpose := NULL;
    RETURN NEW;
  END IF;

  IF NEW.exit_purpose IS NULL THEN
    -- The admin Excel import (0063) cannot supply a purpose. Same predicate
    -- as the driver-name exemption of 0108: the transaction-local marker set
    -- by public.import_movement_rows AND an admin caller.
    IF current_setting('app.movement_excel_import', true) = 'true'
       AND public.has_permission('movements.import') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'exit_purpose_required'
      USING ERRCODE = '23514',
            HINT = 'Choose the purpose of the site exit: maintenance or work_completed.';
  END IF;

  RETURN NEW;
END;
$$;

-- get_last_movement — latest 0127.
CREATE OR REPLACE FUNCTION public.get_last_movement(
  p_equipment_id uuid,
  p_movement_context text DEFAULT 'site'
)
RETURNS TABLE(
  movement_type text,
  movement_context text,
  workshop_purpose text,
  recorded_at timestamptz,
  supervisor_id uuid,
  supervisor_name text,
  company_id uuid,
  project_id uuid,
  project_name_ar text,
  project_name_en text,
  contractor_equipment_code text,
  driver_id uuid,
  driver_name text,
  driver_mobile_number text,
  company_name_ar text,
  company_name_en text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF NOT (
    public.has_permission('movements.read')
    OR public.has_permission('movements.site.create')
    OR public.has_permission('movements.workshop.create')
  ) THEN
    RAISE EXCEPTION 'authenticated role required';
  END IF;
  IF p_movement_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'invalid movement context';
  END IF;

  RETURN QUERY
  SELECT
    l.movement_type,
    l.movement_context,
    l.workshop_purpose,
    l.recorded_at,
    l.supervisor_id,
    s.full_name,
    l.company_id,
    l.project_id,
    p.name_ar,
    p.name_en,
    l.contractor_equipment_code,
    COALESCE(c.new_driver_id, l.driver_id),
    COALESCE(c.new_driver_name, l.driver_name),
    d.mobile_number,
    co.name_ar,
    co.name_en
  FROM public.entry_exit_logs l
  LEFT JOIN public.profiles s ON s.id = l.supervisor_id
  LEFT JOIN public.projects p ON p.id = l.project_id
  LEFT JOIN LATERAL (
    SELECT x.new_driver_id, x.new_driver_name
    FROM public.movement_driver_changes x
    WHERE x.entry_log_id = l.id
    ORDER BY x.changed_at DESC, x.id DESC
    LIMIT 1
  ) c ON l.movement_type = 'entry'
  LEFT JOIN public.drivers d ON d.id = COALESCE(c.new_driver_id, l.driver_id)
  LEFT JOIN public.companies co ON co.id = l.company_id
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
END;
$$;

-- prepare_movement_exit_notice — latest 0127.
CREATE OR REPLACE FUNCTION public.prepare_movement_exit_notice(p_movement_id uuid)
RETURNS TABLE(
  notice_id uuid,
  notice_kind text,
  recipient_name text,
  recipient_mobile text,
  equipment_code text,
  equipment_type text,
  project_name_ar text,
  project_name_en text,
  company_name_ar text,
  company_name_en text,
  sender_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed boolean;
  v_log public.entry_exit_logs;
  v_closed_entry public.entry_exit_logs;
  v_previous public.entry_exit_logs;
  v_site_entry public.entry_exit_logs;
  v_kind text;
  v_recipient uuid;
  v_notice_id uuid;
BEGIN
  SELECT l.* INTO v_log
  FROM public.entry_exit_logs l
  WHERE l.id = p_movement_id;

  -- The movement's own recorder, or an admin. `IS NOT TRUE` also rejects a
  -- missing row, no session and a missing profile (NULL role), so the check
  -- fails closed and a refused caller cannot tell a foreign movement from a
  -- missing one.
  v_allowed := FOUND
    AND auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid())
    AND (public.has_permission('movements.edit_delete') OR v_log.supervisor_id = auth.uid());
  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'movement_not_accessible'
      USING ERRCODE = '42501',
            HINT = 'Only the user who recorded the movement, or an admin, may trigger its notice.';
  END IF;

  IF v_log.movement_type IS DISTINCT FROM 'exit' THEN
    RAISE EXCEPTION 'movement_not_exit'
      USING HINT = 'Only an exit triggers an automatic notice.';
  END IF;

  -- Only a freshly saved exit. The server calls this right after the insert
  -- (the sequence trigger stamps `created_at := now()`), so an old exit is
  -- never the server: refusing it keeps a recorder from replaying his past
  -- exits to collect recipients' numbers or to leave pending rows behind.
  IF v_log.created_at < now() - interval '10 minutes' THEN RETURN; END IF;

  -- The notices' own per-equipment key (NOT the sequence trigger's, see the
  -- header), so two calls for the same equipment queue.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('movement_notice:' || v_log.equipment_id::text, 0)
  );

  -- The ENTRY this exit closed: the nearest earlier entry of the equipment in
  -- the global order, exactly how the sequence trigger finds `v_last_entry`.
  SELECT l.* INTO v_closed_entry
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = v_log.equipment_id
    AND l.movement_type = 'entry'
    AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_log.movement_context = 'site' THEN
    -- Notice 2. Only a site exit that closed a SITE entry, and only when
    -- somebody reported the unit for that entry. Any attempt counts, whatever
    -- its status; the latest one decides the recipient.
    IF v_closed_entry.movement_context IS DISTINCT FROM 'site' THEN RETURN; END IF;

    SELECT n.sender_id INTO v_recipient
    FROM public.movement_notices n
    WHERE n.entry_log_id = v_closed_entry.id
      AND n.kind = 'workshop_arrival'
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 1;
    IF NOT FOUND OR v_recipient IS NULL THEN RETURN; END IF;

    v_kind := 'site_exit';
    v_site_entry := v_closed_entry;
  ELSE
    -- Notice 3. The workshop exit closed a WORKSHOP entry; the movement
    -- immediately before that entry must be a SITE exit, and the recipient is
    -- the foreman of the SITE entry that exit closed.
    IF v_closed_entry.movement_context IS DISTINCT FROM 'workshop' THEN RETURN; END IF;

    SELECT l.* INTO v_previous
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id
      AND (l.recorded_at, l.id) < (v_closed_entry.recorded_at, v_closed_entry.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF NOT FOUND
       OR v_previous.movement_type IS DISTINCT FROM 'exit'
       OR v_previous.movement_context IS DISTINCT FROM 'site' THEN
      RETURN;
    END IF;

    SELECT l.* INTO v_site_entry
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id
      AND l.movement_type = 'entry'
      AND (l.recorded_at, l.id) < (v_previous.recorded_at, v_previous.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF NOT FOUND OR v_site_entry.movement_context IS DISTINCT FROM 'site' THEN
      RETURN;
    END IF;

    v_kind := 'workshop_exit';
    v_recipient := v_site_entry.supervisor_id;
  END IF;

  -- One automatic notice per exit and kind (unique partial index). A repeated
  -- call inserts nothing and returns zero rows, so it can never send twice.
  INSERT INTO public.movement_notices (
    kind, equipment_id, entry_log_id, movement_id, sender_id, recipient_id, status
  ) VALUES (
    v_kind, v_log.equipment_id, v_site_entry.id, v_log.id,
    auth.uid(), v_recipient, 'pending'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_notice_id;

  IF v_notice_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT x.*
  FROM public.movement_notice_payload(v_notice_id) AS x;
END;
$$;

-- quick_create_driver — latest 0127.
CREATE OR REPLACE FUNCTION public.quick_create_driver(
  p_full_name text,
  p_mobile_number text,
  p_equipment_id uuid DEFAULT NULL
)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver public.drivers;
  v_employment_type text;
BEGIN
  -- Only the roles that record a site movement may quick-create a driver.
  -- Fail closed: no session and a missing profile (NULL role) are rejected.
  IF auth.uid() IS NULL
     OR NOT public.has_permission('drivers.quick_create') THEN
    RAISE EXCEPTION 'quick_driver_not_allowed'
      USING ERRCODE = '42501',
            HINT = 'Only an admin or a site foreman may quick-create a driver.';
  END IF;

  IF btrim(p_full_name) = '' OR btrim(p_mobile_number) !~ '^\+?[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'invalid_quick_driver';
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE mobile_number = btrim(p_mobile_number)
  LIMIT 1;
  IF FOUND THEN RETURN v_driver; END IF;

  -- wave 13: a NEW driver of an external supplier's unit gets the
  -- external-supplier employment type. Decided from the equipment row; an
  -- unknown or missing equipment leaves the type empty, as before.
  IF p_equipment_id IS NOT NULL THEN
    SELECT 'مورد خارجي' INTO v_employment_type
    FROM public.equipment e
    WHERE e.id = p_equipment_id
      AND e.ownership_status = 'external_supplier';
  END IF;

  INSERT INTO public.drivers(full_name, mobile_number, employment_type)
  VALUES (btrim(p_full_name), btrim(p_mobile_number), v_employment_type)
  RETURNING * INTO v_driver;
  RETURN v_driver;
END;
$$;

-- quick_create_foreman_equipment — latest 0127.
CREATE OR REPLACE FUNCTION public.quick_create_foreman_equipment(
  p_plate_number text,
  p_chassis_number text,
  p_type text,
  p_lessor_id uuid
)
RETURNS public.equipment
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_equipment public.equipment;
  v_plate text := NULLIF(upper(btrim(p_plate_number)), '');
  v_chassis text := NULLIF(upper(btrim(p_chassis_number)), '');
BEGIN
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF COALESCE(public.permission_scope('equipment.quick_create'), '') NOT IN ('all', 'site')
     OR (v_plate IS NULL AND v_chassis IS NULL)
     OR btrim(p_type) = ''
     OR p_lessor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_quick_equipment';
  END IF;

  SELECT * INTO v_equipment
  FROM public.equipment
  WHERE (v_plate IS NOT NULL AND upper(btrim(plate_number)) = v_plate)
     OR (v_chassis IS NOT NULL AND upper(btrim(chassis_number)) = v_chassis)
  ORDER BY
    CASE WHEN v_plate IS NOT NULL AND upper(btrim(plate_number)) = v_plate THEN 0 ELSE 1 END,
    created_at,
    id
  LIMIT 1;
  IF FOUND THEN RETURN v_equipment; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.equipment_types WHERE name = btrim(p_type)) THEN
    RAISE EXCEPTION 'invalid_equipment_type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lessors WHERE id = p_lessor_id) THEN
    RAISE EXCEPTION 'invalid_lessor';
  END IF;

  INSERT INTO public.equipment(
    code,
    type,
    plate_number,
    chassis_number,
    operational_status,
    ownership_status,
    lessor_id,
    qr_value,
    master_data_complete,
    numbering_status
  )
  VALUES (
    public.next_short_equipment_code(),
    btrim(p_type),
    v_plate,
    v_chassis,
    'operational',
    'external_supplier',
    p_lessor_id,
    gen_random_uuid()::text,
    false,
    'unnumbered'
  )
  RETURNING * INTO v_equipment;
  RETURN v_equipment;
END;
$$;

-- quick_create_lessor_by_name — latest 0127.
CREATE OR REPLACE FUNCTION public.quick_create_lessor_by_name(p_name text)
RETURNS public.lessors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lessor public.lessors;
  v_name text := btrim(p_name);
BEGIN
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF NOT public.has_permission('lessors.quick_create')
     OR v_name = ''
     OR char_length(v_name) > 150 THEN
    RAISE EXCEPTION 'invalid_quick_lessor';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(lower(v_name), 0));
  SELECT * INTO v_lessor
  FROM public.lessors
  WHERE lower(btrim(name)) = lower(v_name)
  LIMIT 1;
  IF FOUND THEN RETURN v_lessor; END IF;

  INSERT INTO public.lessors(name)
  VALUES (v_name)
  RETURNING * INTO v_lessor;
  RETURN v_lessor;
END;
$$;

-- quick_create_workshop_equipment — latest 0135.
CREATE OR REPLACE FUNCTION public.quick_create_workshop_equipment(
  p_numbering_status text,
  p_code text,
  p_plate_number text
)
RETURNS public.equipment
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_equipment public.equipment;
  v_plate text := upper(btrim(p_plate_number));
  v_code text;
BEGIN
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF COALESCE(public.permission_scope('equipment.quick_create'), '') NOT IN ('all', 'workshop')
     OR p_numbering_status NOT IN ('numbered', 'unnumbered')
     OR v_plate = '' THEN
    RAISE EXCEPTION 'invalid_workshop_equipment';
  END IF;

  SELECT * INTO v_equipment
  FROM public.equipment
  WHERE upper(btrim(plate_number)) = v_plate
  LIMIT 1;
  IF FOUND THEN RETURN v_equipment; END IF;

  IF p_numbering_status = 'numbered' THEN
    v_code := upper(btrim(p_code));
    IF v_code = '' THEN RAISE EXCEPTION 'equipment code required'; END IF;
    -- 0135 (em:notice-text:equipment-code-from-workshop-quick-create): the
    -- code opens every WhatsApp notice, so it is letters, digits, space,
    -- `_` and `-` only, at most 30 characters. Same rule as
    -- equipment_code_format_check below; the client maps the token.
    IF char_length(v_code) > 30 OR v_code !~ '^[A-Z0-9][A-Z0-9 _-]*$' THEN
      RAISE EXCEPTION 'invalid_equipment_code' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.equipment WHERE upper(btrim(code)) = v_code) THEN
      RAISE EXCEPTION 'duplicate equipment code';
    END IF;
  ELSE
    LOOP
      v_code := 'U' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.equipment WHERE code = v_code);
    END LOOP;
  END IF;

  INSERT INTO public.equipment(
    code, type, plate_number, operational_status, ownership_status,
    qr_value, master_data_complete, numbering_status
  )
  VALUES (
    v_code, 'غير محدد', v_plate, 'operational', 'alazani',
    gen_random_uuid()::text, false, p_numbering_status
  )
  RETURNING * INTO v_equipment;
  RETURN v_equipment;
END;
$$;

-- request_workshop_arrival_notice — latest 0127.
CREATE OR REPLACE FUNCTION public.request_workshop_arrival_notice(p_equipment_id uuid)
RETURNS TABLE(
  notice_id uuid,
  notice_kind text,
  recipient_name text,
  recipient_mobile text,
  equipment_code text,
  equipment_type text,
  project_name_ar text,
  project_name_en text,
  company_name_ar text,
  company_name_en text,
  sender_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last public.entry_exit_logs;
  v_notice_id uuid;
BEGIN
  -- Fail closed: no session and a missing profile (NULL role) are rejected.
  IF auth.uid() IS NULL
     OR NOT public.has_permission('movements.notify_foreman') THEN
    RAISE EXCEPTION 'notice_role_required'
      USING ERRCODE = '42501',
            HINT = 'Only a workshop role or an admin may notify a foreman.';
  END IF;

  IF p_equipment_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.equipment e WHERE e.id = p_equipment_id) THEN
    RAISE EXCEPTION 'equipment_not_found'
      USING HINT = 'No equipment matches this identifier.';
  END IF;

  -- The notices' own per-equipment key (NOT the sequence trigger's, see the
  -- header): two officers pressing at the same moment queue here, so the
  -- 10-minute check below cannot be raced.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('movement_notice:' || p_equipment_id::text, 0)
  );

  SELECT l.* INTO v_last
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  IF NOT FOUND
     OR v_last.movement_type IS DISTINCT FROM 'entry'
     OR v_last.movement_context IS DISTINCT FROM 'site' THEN
    RAISE EXCEPTION 'equipment_not_on_site'
      USING HINT = 'The equipment has no open site entry.';
  END IF;

  -- A successful (or still running) send, and a timeout the gateway may have
  -- delivered anyway, block a repeat for 10 minutes. Another failed or
  -- impossible send may be retried immediately, but the attempts of one entry
  -- are capped whatever their status, because the status is written with the
  -- sender's own token and must not be the only limit.
  IF EXISTS (
    SELECT 1
    FROM public.movement_notices n
    WHERE n.entry_log_id = v_last.id
      AND n.kind = 'workshop_arrival'
      AND n.created_at > now() - interval '10 minutes'
      AND (
        n.status IN ('sent', 'pending')
        OR (n.status = 'failed' AND n.error_code = 'timeout')
      )
  ) OR (
    SELECT count(*)
    FROM public.movement_notices n
    WHERE n.entry_log_id = v_last.id
      AND n.kind = 'workshop_arrival'
      AND n.created_at > now() - interval '10 minutes'
  ) >= 3 THEN
    RAISE EXCEPTION 'notice_recently_sent'
      USING HINT = 'The foreman of this site entry was notified less than 10 minutes ago.';
  END IF;

  -- The recipient is the foreman who recorded the open site entry. It is
  -- never supplied by the caller.
  INSERT INTO public.movement_notices (
    kind, equipment_id, entry_log_id, movement_id, sender_id, recipient_id, status
  ) VALUES (
    'workshop_arrival', v_last.equipment_id, v_last.id, NULL,
    auth.uid(), v_last.supervisor_id, 'pending'
  )
  RETURNING id INTO v_notice_id;

  RETURN QUERY
  SELECT x.*
  FROM public.movement_notice_payload(v_notice_id) AS x;
END;
$$;

-- search_entry_equipment — latest 0127.
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
  -- The latest movement per equipment, ordered deterministically by
  -- (recorded_at, id) exactly like the sequence trigger and 0087/0088.
  LEFT JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.recorded_at,
           l.workshop_purpose, l.company_id, l.project_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  LEFT JOIN public.companies co ON co.id = last_movement.company_id
  LEFT JOIN public.projects pr ON pr.id = last_movement.project_id
  WHERE e.is_active
    AND e.status = 'active'
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

-- search_site_exit_equipment — latest 0127.
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
  JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.supervisor_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  WHERE e.is_active
    AND e.status = 'active'
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

-- search_workshop_equipment — latest 0127.
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
  -- The latest movement per equipment in ANY context: this is the state the
  -- badge reports, the same source 0089 uses.
  LEFT JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.recorded_at,
           l.workshop_purpose, l.company_id, l.project_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
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
  WHERE e.is_active
    AND e.status = 'active'
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

-- update_entry_contractor_code — latest 0127.
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

-- ===========================================================================
-- C. Admin home functions without current_user_role()
-- ===========================================================================

-- get_admin_availability_by_type — latest 0127.
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
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 500);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_owners text[];
  v_term text;
BEGIN
  IF NOT public.has_permission('home.admin') THEN
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

-- get_admin_entries_series — latest 0127.
CREATE OR REPLACE FUNCTION public.get_admin_entries_series(
  p_from timestamptz,
  p_to timestamptz,
  p_owners text[] DEFAULT NULL,
  p_context text DEFAULT NULL
)
RETURNS TABLE(day date, entries int, exits int)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owners text[];
BEGIN
  IF NOT public.has_permission('home.admin') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;
  -- One day per returned row, so the range stays bounded and so does the
  -- chart. The يوم view asks for 30 days and the شهر view for 12 months; the
  -- سنة view does NOT raise this cap, it uses get_admin_entries_yearly below.
  IF p_to > p_from + interval '400 days' THEN
    RAISE EXCEPTION 'period longer than 400 days' USING ERRCODE = '22023';
  END IF;
  IF p_context IS NOT NULL AND p_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'unknown movement_context' USING ERRCODE = '22023';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  RETURN QUERY
  SELECT
    (l.recorded_at AT TIME ZONE INTERVAL '+03:00')::date AS day,
    count(*) FILTER (WHERE l.movement_type = 'entry')::int AS entries,
    count(*) FILTER (WHERE l.movement_type = 'exit')::int AS exits
  FROM public.entry_exit_logs l
  JOIN public.equipment e ON e.id = l.equipment_id
  WHERE l.recorded_at >= p_from
    AND l.recorded_at <= p_to
    AND (v_owners IS NULL OR e.ownership_status = ANY(v_owners))
    AND (p_context IS NULL OR l.movement_context = p_context)
  GROUP BY 1
  ORDER BY 1;
END;
$$;

-- get_admin_entries_yearly — latest 0127.
CREATE OR REPLACE FUNCTION public.get_admin_entries_yearly(
  p_years int DEFAULT 5,
  p_owners text[] DEFAULT NULL,
  p_context text DEFAULT NULL
)
RETURNS TABLE(year int, entries int, exits int)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_years int := LEAST(GREATEST(COALESCE(p_years, 5), 1), 20);
  v_owners text[];
  v_current_year int;
  v_from timestamptz;
BEGIN
  IF NOT public.has_permission('home.admin') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_context IS NOT NULL AND p_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'unknown movement_context' USING ERRCODE = '22023';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  v_current_year :=
    EXTRACT(YEAR FROM (now() AT TIME ZONE INTERVAL '+03:00'))::int;
  -- Built as text with an explicit ISO offset rather than make_timestamptz, so
  -- the POSIX sign convention can never turn +03:00 into -03:00. Comparing
  -- `recorded_at` (a timestamptz) against a timestamptz keeps the range scan
  -- on idx_logs_recorded_at usable.
  v_from := ((v_current_year - v_years + 1)::text || '-01-01 00:00:00+03:00')
    ::timestamptz;

  RETURN QUERY
  SELECT
    EXTRACT(YEAR FROM (l.recorded_at AT TIME ZONE INTERVAL '+03:00'))::int
      AS year,
    count(*) FILTER (WHERE l.movement_type = 'entry')::int AS entries,
    count(*) FILTER (WHERE l.movement_type = 'exit')::int AS exits
  FROM public.entry_exit_logs l
  JOIN public.equipment e ON e.id = l.equipment_id
  WHERE l.recorded_at >= v_from
    AND (v_owners IS NULL OR e.ownership_status = ANY(v_owners))
    AND (p_context IS NULL OR l.movement_context = p_context)
  GROUP BY 1
  ORDER BY 1;
END;
$$;

-- get_admin_fleet_equipment — latest 0127.
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
  is_new boolean
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

-- get_admin_fleet_state — latest 0127.
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
  v_owners text[];
  v_result jsonb;
BEGIN
  IF NOT public.has_permission('home.admin') THEN
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

-- get_admin_foreman_discipline — latest 0127.
CREATE OR REPLACE FUNCTION public.get_admin_foreman_discipline(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE(
  supervisor_id uuid,
  foreman_name text,
  entries int,
  exits int,
  open_visits int
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_permission('home.admin') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH period AS (
    SELECT
      l.supervisor_id AS sid,
      count(*) FILTER (WHERE l.movement_type = 'entry')::int AS entries,
      count(*) FILTER (WHERE l.movement_type = 'exit')::int AS exits
    FROM public.entry_exit_logs l
    WHERE l.recorded_at >= p_from
      AND l.recorded_at <= p_to
    GROUP BY l.supervisor_id
  ),
  -- Open site visits are a "right now" number, not a period number: the
  -- latest site movement of the equipment is an ENTRY and that entry is the
  -- foreman's. Deterministic by (recorded_at DESC, id DESC).
  open_now AS (
    SELECT latest.supervisor_id AS sid, count(*)::int AS open_visits
    FROM (
      SELECT DISTINCT ON (l.equipment_id)
        l.equipment_id, l.supervisor_id, l.movement_type
      FROM public.entry_exit_logs l
      WHERE l.movement_context = 'site'
      ORDER BY l.equipment_id, l.recorded_at DESC, l.id DESC
    ) latest
    WHERE latest.movement_type = 'entry'
    GROUP BY latest.supervisor_id
  )
  SELECT
    p.sid,
    pr.full_name,
    p.entries,
    p.exits,
    COALESCE(o.open_visits, 0)
  FROM period p
  LEFT JOIN open_now o ON o.sid = p.sid
  LEFT JOIN public.profiles pr ON pr.id = p.sid
  ORDER BY (p.entries + p.exits) DESC, pr.full_name, p.sid
  LIMIT 20;
END;
$$;

-- get_admin_foreman_recent_movements — latest 0127.
CREATE OR REPLACE FUNCTION public.get_admin_foreman_recent_movements(
  p_limit_per_foreman int DEFAULT 7
)
RETURNS TABLE(
  supervisor_id uuid,
  foreman_name text,
  total_movements int,
  movement_rank int,
  movement_id uuid,
  equipment_id uuid,
  equipment_code text,
  movement_type text,
  movement_context text,
  recorded_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit int := LEAST(GREATEST(COALESCE(p_limit_per_foreman, 7), 1), 20);
BEGIN
  IF NOT public.has_permission('home.admin') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      l.id,
      l.supervisor_id AS sid,
      l.equipment_id,
      l.movement_type,
      l.movement_context,
      l.recorded_at,
      -- Deterministic exactly like every other movement ordering in this
      -- system: recorded_at first, then id, so two movements sharing a
      -- timestamp still resolve to one order.
      row_number() OVER (
        PARTITION BY l.supervisor_id
        ORDER BY l.recorded_at DESC, l.id DESC
      )::int AS rn,
      count(*) OVER (PARTITION BY l.supervisor_id)::int AS total
    FROM public.entry_exit_logs l
    WHERE l.supervisor_id IS NOT NULL
  ),
  busiest AS (
    SELECT r.sid, max(r.total) AS total
    FROM ranked r
    GROUP BY r.sid
    ORDER BY max(r.total) DESC, r.sid
    LIMIT 20
  )
  SELECT
    r.sid,
    pr.full_name,
    b.total,
    r.rn,
    r.id,
    r.equipment_id,
    e.code,
    r.movement_type,
    r.movement_context,
    r.recorded_at
  FROM ranked r
  JOIN busiest b ON b.sid = r.sid
  -- LEFT JOINed: a profile or an equipment row the caller cannot read becomes
  -- NULL and never drops the movement from the foreman's list.
  LEFT JOIN public.profiles pr ON pr.id = r.sid
  LEFT JOIN public.equipment e ON e.id = r.equipment_id
  WHERE r.rn <= v_limit
  ORDER BY b.total DESC, r.sid, r.rn;
END;
$$;

-- get_admin_owner_state_matrix — latest 0127.
CREATE OR REPLACE FUNCTION public.get_admin_owner_state_matrix(
  p_owners text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owners text[];
  v_result jsonb;
BEGIN
  IF NOT public.has_permission('home.admin') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  SELECT jsonb_build_object(
    'total', COALESCE(sum(cells.count), 0)::int,
    'cells', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'owner', cells.owner,
          'state', cells.state,
          'count', cells.count
        )
        ORDER BY cells.owner, cells.state
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM (
    SELECT
      s.ownership_status AS owner,
      s.state AS state,
      count(*)::int AS count
    FROM public.admin_equipment_state s
    WHERE s.is_active AND s.status = 'active'
      AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
    GROUP BY s.ownership_status, s.state
  ) cells;

  RETURN v_result;
END;
$$;

-- ===========================================================================
-- D. New accounts: the profile without a role
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles(id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Trigger on auth.users (0156): inserts the profile (id, full_name) only; the user''s role is the profile_roles assignment, set by create-user through admin_assign_profile_role. No account gets a role from metadata.';

-- ===========================================================================
-- E. What only served the legacy column
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.set_roles_system_enabled(
  p_enabled boolean,
  p_expected_preview_rows integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR public.is_admin() IS NOT TRUE
     OR public.has_permission('settings.roles') IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may activate the roles system.';
  END IF;
  IF p_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'roles_system_permanent'
      USING ERRCODE = '55000',
            HINT = 'Since 0150 the assigned role is the only source of access; the roles system cannot be switched off.';
  END IF;
  -- 0156: the system is on for good, so switching it on changes nothing.
  -- Same answer shape as the 0126 function; p_expected_preview_rows is no
  -- longer read (there is no legacy preview to acknowledge).
  RETURN jsonb_build_object(
    'enabled', public.roles_system_enabled(),
    'changed', false,
    'reason', NULL,
    'offenders', '[]'::jsonb,
    'preview_rows', NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_roles_system_enabled(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_roles_system_enabled(boolean, integer) TO authenticated;

COMMENT ON FUNCTION public.set_roles_system_enabled(boolean, integer) IS
  'Admin-only. Since 0150 it refuses to switch the roles system off (roles_system_permanent, 55000); since 0156 switching it on changes nothing and answers {enabled, changed: false, reason: null, offenders: [], preview_rows: null}. The flag is never written.';

DROP FUNCTION IF EXISTS public.set_roles_system_enabled_0126(boolean, integer);
DROP FUNCTION IF EXISTS public.admin_roles_system_offenders();
DROP FUNCTION IF EXISTS public.admin_roles_system_preview();
DROP FUNCTION IF EXISTS public.legacy_role_permissions(text);
DROP FUNCTION IF EXISTS public.current_user_role();

-- ===========================================================================
-- F. The column
-- ===========================================================================
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
DROP INDEX IF EXISTS public.idx_profiles_role;
ALTER TABLE public.profiles DROP COLUMN role;

-- ===========================================================================
-- G. Guard: nothing still references the column or a dropped function
-- ===========================================================================
-- Function bodies are read without their comments and string literals (so
-- messages such as 'foreman role required' do not count), then any bare
-- `role` word is a reference: `p.role`, `SELECT role`, `(id, role)`. The
-- word boundary keeps role_key, roles, v_role, p_role_key and
-- current_user_role out of it. Views and policies are read the same way,
-- with the `AS role` alias of profile_names (its assigned role, 0152) set
-- aside.
DO $$
DECLARE
  v_functions text;
  v_views text;
  v_policies text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'role'
  ) THEN
    RAISE EXCEPTION '0156: profiles.role still exists';
  END IF;

  SELECT string_agg(f.oid::regprocedure::text, ', ' ORDER BY f.oid::regprocedure::text)
  INTO v_functions
  FROM pg_proc f
  JOIN pg_namespace n ON n.oid = f.pronamespace
  JOIN pg_language l ON l.oid = f.prolang
  CROSS JOIN LATERAL (
    SELECT regexp_replace(
      regexp_replace(
        regexp_replace(f.prosrc, '--[^\n]*', '', 'g'),
        '/\*.*?\*/', '', 'g'
      ),
      '''[^'']*''', '', 'g'
    ) AS code
  ) s
  WHERE n.nspname = 'public'
    AND l.lanname IN ('plpgsql', 'sql')
    AND (
      s.code ~* '\yrole\y'
      OR s.code ~* '\y(current_user_role|legacy_role_permissions|admin_roles_system_offenders|admin_roles_system_preview|set_roles_system_enabled_0126)\y'
    );
  IF v_functions IS NOT NULL THEN
    RAISE EXCEPTION '0156: function(s) still reference profiles.role or a dropped function: %',
      v_functions;
  END IF;

  SELECT string_agg(v.viewname, ', ' ORDER BY v.viewname)
  INTO v_views
  FROM pg_views v
  WHERE v.schemaname = 'public'
    AND regexp_replace(
          regexp_replace(v.definition, '''[^'']*''', '', 'g'),
          '\yAS\s+role\y', '', 'gi'
        ) ~* '\yrole\y';
  IF v_views IS NOT NULL THEN
    RAISE EXCEPTION '0156: view(s) still reference a role column: %', v_views;
  END IF;

  SELECT string_agg(p.schemaname || '.' || p.tablename || '.' || p.policyname, ', '
           ORDER BY p.schemaname, p.tablename, p.policyname)
  INTO v_policies
  FROM pg_policies p
  CROSS JOIN LATERAL (
    SELECT regexp_replace(
      coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
      '''[^'']*''', '', 'g'
    ) AS code
  ) s
  WHERE p.schemaname IN ('public', 'storage')
    AND (
      s.code ~* '\yrole\y'
      OR s.code ~* '\y(current_user_role|legacy_role_permissions)\y'
    );
  IF v_policies IS NOT NULL THEN
    RAISE EXCEPTION '0156: policy(ies) still reference profiles.role: %', v_policies;
  END IF;
END;
$$;
