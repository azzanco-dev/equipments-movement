-- 0127: policies and functions on permission keys (wave 22A, database half).
--
-- Depends on 0126 (permissions, roles, the frozen legacy mapping, the flag and
-- has_permission / permission_scope / movement_scope_allows). With
-- app_settings.roles_system disabled (the only state 0126 writes) every
-- rewritten object gives EXACTLY its previous result for each of the six
-- legacy roles: the role-name test is replaced by the permission key that the
-- frozen mapping grants to exactly the roles that passed it, with the same
-- scope predicate. tests/wave22Roles.test.cjs proves it object by object
-- (tests/helpers/wave22Rewrites.cjs holds the replacements).
--
-- ===========================================================================
-- 1. Rules followed
-- ===========================================================================
--   * Every function body is its LATEST definition copied verbatim; the only
--     change is the documented role test. Locks (the sequence trigger's
--     advisory key, row locks), error codes, messages and every other line
--     are unchanged. `SELECT role INTO v_role` lines stay even where v_role
--     is no longer read, so each diff is the role test alone.
--   * Every policy keeps its name, command and TO authenticated, and its
--     predicate is the latest one with only the role atoms replaced. Keys in
--     policies are wrapped as (SELECT public.has_permission('key')), so they
--     are evaluated once per statement (an InitPlan), not once per row.
--   * Nothing becomes more permissive for the six roles: each key/scope is
--     granted by the mapping to exactly the roles that passed. A user
--     without a profile gets nothing, as before (profiles.role is NOT NULL
--     and CHECKed to the six).
--   * is_admin() and current_user_role() are unchanged (see 3).
--
-- ===========================================================================
-- 2. What moved (object -> key, scope)
-- ===========================================================================
--   Movements
--     select_entry_exit_logs (SELECT)        own rows always, plus the
--                                            movements.read scope (all, site,
--                                            workshop, companies; own adds
--                                            nothing)
--     insert_entry_exit_logs (INSERT)        own supervisor_id, or
--                                            movements.edit_delete (another
--                                            user's name)
--     can_access_movement(uuid)              own rows, plus the
--                                            movements.read scope; feeds the
--                                            photo, driver-change and Storage
--                                            SELECT policies
--     enforce_movement_sequence() trigger    workshop branch:
--                                            movements.workshop.create; site
--                                            branch: movements.site.create;
--                                            import driver-name exemption:
--                                            movements.import; exemption from
--                                            the exit context/owner rules
--                                            (was is_admin()):
--                                            movements.exit_cross_context; the
--                                            owner rule itself: the closed
--                                            entry must be inside the
--                                            movements.site.create scope (own
--                                            = the foreman's own entry, as
--                                            before; all = any foreman's)
--     enforce_site_exit_purpose(),
--     enforce_site_entry_driver() triggers   import exemption:
--                                            movements.import
--     change_active_movement_driver          movements.site.driver_change
--                                            scope on the entry
--     update_entry_contractor_code           movements.site.contractor_code
--                                            (still only the recorder's own
--                                            open entry)
--     classify_workshop_entry                movements.workshop.classify
--     request_workshop_arrival_notice        movements.notify_foreman
--     prepare_movement_exit_notice           recorder, or movements.edit_delete
--     admin_update_movement,
--     admin_delete_movement                  movements.edit_delete
--     prepare_movement_import,
--     import_movement_rows,
--     search_workshop_opening_candidates,
--     add_workshop_opening_balance           movements.import
--     search_entry_equipment                 movements.site.create
--     search_site_exit_equipment             movements.site.create; every
--                                            open visit listed (was admin):
--                                            movements.exit_cross_context or
--                                            site.create scope all
--     search_workshop_equipment              movements.workshop.create
--     get_last_movement                      movements.read or a create key
--                                            (was: any of the six roles)
--   Photos and Storage (bucket log-photos)
--     can_write_movement_photos(uuid)        movements.photos.manage scope
--     insert/update/delete_entry_exit_photos,
--     insert/update/delete_log_photos,
--     insert_own_pending_movement_photo_batches
--                                            "not monitor" ->
--                                            movements.photos.manage;
--                                            is_admin() (anyone's photo) ->
--                                            movements.photos.delete_any
--   Notices
--     select_movement_notices                is_admin() ->
--                                            settings.integrations; workshop
--                                            roles -> movements.notify_foreman
--   Equipment, drivers, master data
--     insert/update/delete_equipment         equipment.create / edit / delete
--     quick_create_foreman_equipment         equipment.quick_create scope all
--                                            or site
--     quick_create_workshop_equipment        equipment.quick_create scope all
--                                            or workshop
--     admin_change_equipment_code            equipment.change_code (still
--                                            SECURITY INVOKER: its UPDATE also
--                                            needs equipment.edit, which
--                                            change_code requires)
--     update_equipment_from_excel            equipment.import
--     get_all_equipment_last_movement        equipment.read and the
--                                            movements.read scope all (the
--                                            other DEFINER read of every
--                                            unit's last movement)
--     insert/update/delete_drivers           drivers.create / edit / delete
--     quick_create_driver                    drivers.quick_create
--     projects, companies, company_projects
--     insert/update/delete                   companies_projects.edit
--     insert/update/delete_lessors           lessors.edit
--     quick_create_lessor_by_name            lessors.quick_create
--     insert/update/delete_equipment_types   settings.equipment_types
--   Users
--     select_profiles                        own, plus the users.read scope
--                                            (all; workshop = profiles whose
--                                            legacy role is a workshop role)
--     insert/update/delete_profiles,
--     select_profile_contacts,
--     profile_companies (4),
--     admin_set_user_mobile,
--     admin_set_user_role                    users.manage (admin only).
--                                            admin_set_user_role also
--                                            refuses while the roles system
--                                            is ON (roles_system_active_
--                                            use_assignment, 55000): the
--                                            role then changes through
--                                            admin_assign_profile_role. Flag
--                                            off: no new refusal.
--   Reports and admin home
--     get_equipment_attention_report         reports.view scope all AND
--                                            movements.read scope all (it is
--                                            SECURITY DEFINER and reads every
--                                            unit's latest movement; only
--                                            admin holds reports.view in the
--                                            legacy mapping, and admin reads
--                                            all, so nothing changes)
--     get_admin_foreman_discipline,
--     get_admin_entries_series,
--     get_admin_entries_yearly,
--     get_admin_foreman_recent_movements,
--     get_admin_owner_state_matrix,
--     get_admin_fleet_state,
--     get_admin_availability_by_type,
--     get_admin_fleet_equipment              home.admin
--     movement_audit_logs_admin_select       movements.activity
--
-- ===========================================================================
-- 3. What still tests a role name (by design or outside the database)
-- ===========================================================================
--   Database:
--     * public.is_admin() / public.current_user_role(): unchanged helpers.
--       After 0127 no RLS policy and no function body calls them, except the
--       0126 role-management functions (is_admin() AND settings.roles).
--     * public.handle_new_user(): the allowlist of the six roles a new
--       account may get from app_metadata (role assignment, not a gate).
--     * public.admin_set_user_role(): the allowlist of the six legacy roles
--       it may write (its gate is users.manage now).
--     * public.profile_names view: exposes the role column, no gate.
--     * Read policies USING (true) (equipment, projects, companies,
--       company_projects, lessors, drivers, equipment_types,
--       equipment_code_changes) are not role-gated and stay open to every
--       signed-in user: the movement forms, details and joins need them, so
--       equipment.read, drivers.read, companies_projects.read and
--       lessors.read are screen keys only.
--   Outside the database (to move to has_permission in the UI wave):
--     * app/api/movements/route.ts: early 403 on profiles.role per context
--       (the database re-checks with the keys).
--     * app/api/movements/[id]/route.ts: early 403 unless profiles.role is
--       admin (the database re-checks movements.edit_delete).
--     * app/api/movements/[id]/photos and photo-uploads: early 403 for
--       monitor (the database re-checks movements.photos.manage).
--     * app/api/notifications/whatsapp-status and app/api/afaqy/* (through
--       src/lib/server/adminRequest.ts): rpc('is_admin').
--     * supabase/functions/create-user and manage-user (Edge Functions):
--       profiles.role = 'admin'.
--     * Client routing and screens (src/App.tsx, Layout, HomeScreen,
--       MovementDetail, EntryExitForm and others).
--   With the flag off all of these agree with the database. Before the flag
--   is turned on, each should ask has_permission / current_permissions; the
--   admin parity rule of 0126 keeps the is_admin()-based ones (and the Edge
--   Functions) pointing at the same users as the 'admin' role.
--
-- ===========================================================================
-- 4. Rollout
-- ===========================================================================
--   Apply after 0126 (and after 0125, the source of four functions here).
--   Safe before any UI change: with the flag off every result is unchanged.
--   Function grants are restated (callable functions: EXECUTE for
--   authenticated only; trigger functions: no client role). Existing
--   function comments are kept and a 0127 note is appended.

-- ===========================================================================
-- A. Functions
-- ===========================================================================

-- can_access_movement: latest 0098; movements.read.
CREATE OR REPLACE FUNCTION public.can_access_movement(p_movement_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    WHERE l.id = p_movement_id
      AND (
        l.supervisor_id = auth.uid()
        OR public.movement_scope_allows(
          public.permission_scope('movements.read'),
          l.supervisor_id,
          l.movement_context,
          l.company_id
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_movement(uuid) TO authenticated;

-- can_write_movement_photos: latest 0109; movements.photos.manage.
CREATE OR REPLACE FUNCTION public.can_write_movement_photos(p_movement_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    JOIN public.profiles me ON me.id = auth.uid()
    WHERE l.id = p_movement_id
      AND public.movement_scope_allows(
        public.permission_scope('movements.photos.manage'),
        l.supervisor_id,
        l.movement_context,
        l.company_id
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_write_movement_photos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_movement_photos(uuid) TO authenticated;

-- enforce_movement_sequence: latest 0125; movements.workshop.create, movements.site.create, movements.import, movements.exit_cross_context.
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

    -- Owner decisions 2026-09-17, 2026-09-19 and 2026-09-30: an EXIT closes
    -- an ENTRY of its OWN context only, and a site exit only for the foreman
    -- who opened the visit. Admins are exempt from both.
    IF NOT public.has_permission('movements.exit_cross_context') THEN
      IF NEW.movement_context = 'site' THEN
        IF v_last_entry.movement_context IS DISTINCT FROM 'site' THEN
          RAISE EXCEPTION 'exit_equipment_in_workshop'
            USING ERRCODE = '42501',
                  HINT = 'The equipment is inside the workshop; a site exit cannot close a workshop entry.';
        END IF;
        IF public.movement_scope_allows(
             public.permission_scope('movements.site.create'),
             v_last_entry.supervisor_id,
             v_last_entry.movement_context,
             v_last_entry.company_id
           ) IS NOT TRUE THEN
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

REVOKE ALL ON FUNCTION public.enforce_movement_sequence()
  FROM PUBLIC, anon, authenticated;

-- change_active_movement_driver: latest 0108; movements.site.driver_change.
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
  v_role text;
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

  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();

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

REVOKE ALL ON FUNCTION public.change_active_movement_driver(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_active_movement_driver(uuid, uuid, text) TO authenticated;

-- update_entry_contractor_code: latest 0093; movements.site.contractor_code.
CREATE OR REPLACE FUNCTION public.update_entry_contractor_code(
  p_log_id uuid,
  p_code text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_entry public.entry_exit_logs;
  v_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'contractor_code_not_allowed'
      USING ERRCODE = '42501',
            HINT = 'Authentication is required.';
  END IF;

  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
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

REVOKE ALL ON FUNCTION public.update_entry_contractor_code(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_entry_contractor_code(uuid, text) TO authenticated;

-- classify_workshop_entry: latest 0125; movements.workshop.classify.
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

REVOKE ALL ON FUNCTION public.classify_workshop_entry(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classify_workshop_entry(uuid, text) TO authenticated;

-- request_workshop_arrival_notice: latest 0110; movements.notify_foreman.
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
  v_role text;
  v_last public.entry_exit_logs;
  v_notice_id uuid;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
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

REVOKE ALL ON FUNCTION public.request_workshop_arrival_notice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_workshop_arrival_notice(uuid) TO authenticated;

-- prepare_movement_exit_notice: latest 0110; movements.edit_delete.
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
  v_role text;
  v_allowed boolean;
  v_log public.entry_exit_logs;
  v_closed_entry public.entry_exit_logs;
  v_previous public.entry_exit_logs;
  v_site_entry public.entry_exit_logs;
  v_kind text;
  v_recipient uuid;
  v_notice_id uuid;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();

  SELECT l.* INTO v_log
  FROM public.entry_exit_logs l
  WHERE l.id = p_movement_id;

  -- The movement's own recorder, or an admin. `IS NOT TRUE` also rejects a
  -- missing row, no session and a missing profile (NULL role), so the check
  -- fails closed and a refused caller cannot tell a foreign movement from a
  -- missing one.
  v_allowed := FOUND
    AND auth.uid() IS NOT NULL
    AND v_role IS NOT NULL
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

REVOKE ALL ON FUNCTION public.prepare_movement_exit_notice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_movement_exit_notice(uuid) TO authenticated;

-- admin_update_movement: latest 0108; movements.edit_delete.
CREATE OR REPLACE FUNCTION public.admin_update_movement(
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
    notes = v_notes
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

REVOKE ALL ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text) TO authenticated;

-- admin_delete_movement: latest 0108; movements.edit_delete.
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

  -- Neighbours in the GLOBAL sequence of the equipment (both contexts).
  SELECT l.movement_type INTO v_earlier_type
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = v_log.equipment_id
    AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
  v_has_earlier := FOUND;

  SELECT l.* INTO v_later
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = v_log.equipment_id
    AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)
  ORDER BY l.recorded_at, l.id
  LIMIT 1;
  v_has_later := FOUND;

  -- The last movement may always go. Any other row makes its two neighbours
  -- adjacent; the delete is refused when that introduces a violation, i.e.
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

REVOKE ALL ON FUNCTION public.admin_delete_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_movement(uuid) TO authenticated;

-- prepare_movement_import: latest 0063; movements.import.
CREATE OR REPLACE FUNCTION public.prepare_movement_import(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_result jsonb := '[]'::jsonb;
  v_errors jsonb;
  v_equipment record;
  v_company record;
  v_project record;
  v_driver record;
  v_supervisor record;
  v_mode text;
  v_entry_date date;
  v_exit_date date;
  v_value text;
BEGIN
  IF NOT public.has_permission('movements.import') THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'invalid_import_rows';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_errors := '[]'::jsonb;
    v_entry_date := NULL;
    v_exit_date := NULL;
    v_mode := COALESCE(NULLIF(v_row->>'mode', ''), 'entry');

    IF v_mode NOT IN ('entry', 'exit', 'both') THEN
      v_errors := v_errors || '"invalid_mode"'::jsonb;
    END IF;

    v_value := NULLIF(btrim(v_row->>'equipment_code'), '');
    SELECT e.id, e.code, e.type, e.plate_number
    INTO v_equipment
    FROM public.equipment e
    WHERE (v_value IS NOT NULL AND upper(btrim(e.code)) = upper(v_value))
       OR (
         NULLIF(btrim(v_row->>'plate_number'), '') IS NOT NULL
         AND regexp_replace(upper(COALESCE(e.plate_number, '')), '[^A-Z0-9ء-ي]', '', 'g') =
             regexp_replace(upper(v_row->>'plate_number'), '[^A-Z0-9ء-ي]', '', 'g')
       )
    ORDER BY CASE WHEN upper(btrim(e.code)) = upper(COALESCE(v_value, '')) THEN 0 ELSE 1 END, e.code
    LIMIT 1;
    IF NOT FOUND THEN
      v_errors := v_errors || '"equipment_not_found"'::jsonb;
    END IF;

    v_value := NULLIF(btrim(v_row->>'company_name'), '');
    SELECT c.id, c.name_ar, c.name_en INTO v_company
    FROM public.companies c
    WHERE v_value IS NOT NULL
      AND (lower(btrim(c.name_ar)) = lower(v_value)
        OR lower(btrim(c.name_en)) = lower(v_value))
    ORDER BY c.created_at, c.id LIMIT 1;

    v_value := NULLIF(btrim(v_row->>'project_name'), '');
    SELECT p.id, p.name_ar, p.name_en INTO v_project
    FROM public.projects p
    WHERE v_value IS NOT NULL
      AND (lower(btrim(p.name_ar)) = lower(v_value)
        OR lower(btrim(p.name_en)) = lower(v_value))
    ORDER BY p.created_at, p.id LIMIT 1;

    v_value := NULLIF(btrim(v_row->>'driver_name'), '');
    SELECT d.id, d.full_name, d.mobile_number, d.id_number INTO v_driver
    FROM public.drivers d
    WHERE (v_value IS NOT NULL AND lower(btrim(d.full_name)) = lower(v_value))
       OR (
           NULLIF(btrim(v_row->>'driver_number'), '') IS NOT NULL
           AND (
             regexp_replace(COALESCE(d.mobile_number, ''), '\D', '', 'g') = regexp_replace(v_row->>'driver_number', '\D', '', 'g')
             OR btrim(COALESCE(d.id_number, '')) = btrim(v_row->>'driver_number')
           )
       )
    ORDER BY CASE WHEN lower(btrim(d.full_name)) = lower(COALESCE(v_value, '')) THEN 0 ELSE 1 END, d.created_at, d.id
    LIMIT 1;

    v_value := NULLIF(btrim(v_row->>'supervisor_name'), '');
    SELECT p.id, p.full_name INTO v_supervisor
    FROM public.profiles p
    WHERE v_value IS NOT NULL AND lower(btrim(p.full_name)) = lower(v_value)
    ORDER BY p.created_at, p.id LIMIT 1;
    IF v_supervisor.id IS NULL THEN
      SELECT p.id, p.full_name INTO v_supervisor
      FROM public.profiles p WHERE p.id = auth.uid();
    END IF;

    BEGIN
      IF NULLIF(v_row->>'entry_date', '') IS NOT NULL THEN
        v_entry_date := (v_row->>'entry_date')::date;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || '"invalid_entry_date"'::jsonb;
    END;
    BEGIN
      IF NULLIF(v_row->>'exit_date', '') IS NOT NULL THEN
        v_exit_date := (v_row->>'exit_date')::date;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || '"invalid_exit_date"'::jsonb;
    END;

    IF v_mode IN ('entry', 'both') THEN
      IF v_company.id IS NULL THEN v_errors := v_errors || '"company_not_found"'::jsonb; END IF;
      IF v_project.id IS NULL THEN v_errors := v_errors || '"project_not_found"'::jsonb; END IF;
      IF v_entry_date IS NULL THEN v_errors := v_errors || '"entry_date_required"'::jsonb; END IF;
    END IF;
    IF v_mode IN ('exit', 'both') AND v_exit_date IS NULL THEN
      v_errors := v_errors || '"exit_date_required"'::jsonb;
    END IF;
    IF v_mode = 'both' AND v_entry_date IS NOT NULL AND v_exit_date IS NOT NULL AND v_exit_date < v_entry_date THEN
      v_errors := v_errors || '"exit_before_entry"'::jsonb;
    END IF;

    v_result := v_result || jsonb_build_array(
      v_row || jsonb_build_object(
        'equipment_id', v_equipment.id,
        'equipment_label', CASE WHEN v_equipment.id IS NULL THEN NULL ELSE v_equipment.code || ' — ' || v_equipment.type END,
        'company_id', v_company.id,
        'company_label', COALESCE(v_company.name_ar, v_company.name_en),
        'project_id', v_project.id,
        'project_label', COALESCE(v_project.name_ar, v_project.name_en),
        'driver_id', v_driver.id,
        'driver_label', v_driver.full_name,
        'supervisor_id', v_supervisor.id,
        'supervisor_label', v_supervisor.full_name,
        'errors', v_errors
      )
    );
  END LOOP;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_movement_import(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_movement_import(jsonb) TO authenticated;

-- import_movement_rows: latest 0063; movements.import.
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

-- search_workshop_opening_candidates: latest 0041; movements.import.
CREATE OR REPLACE FUNCTION public.search_workshop_opening_candidates(p_search text DEFAULT NULL)
RETURNS TABLE(id uuid, code text, type text, plate_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_permission('movements.import') THEN RAISE EXCEPTION 'admin required'; END IF;
  RETURN QUERY SELECT e.id,e.code,e.type,e.plate_number FROM public.equipment e
  WHERE e.is_active
    AND NOT EXISTS (SELECT 1 FROM public.entry_exit_logs l WHERE l.equipment_id=e.id AND l.movement_context='workshop')
    AND (NULLIF(btrim(p_search),'') IS NULL OR e.code ILIKE '%'||btrim(p_search)||'%' OR e.type ILIKE '%'||btrim(p_search)||'%' OR e.plate_number ILIKE '%'||btrim(p_search)||'%')
  ORDER BY e.code LIMIT 20;
END; $$;

REVOKE ALL ON FUNCTION public.search_workshop_opening_candidates(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_opening_candidates(text) TO authenticated;

-- add_workshop_opening_balance: latest 0041; movements.import.
CREATE OR REPLACE FUNCTION public.add_workshop_opening_balance(p_equipment_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_log_id uuid;
BEGIN
  IF NOT public.has_permission('movements.import') THEN RAISE EXCEPTION 'admin required'; END IF;
  IF EXISTS (SELECT 1 FROM public.entry_exit_logs l WHERE l.equipment_id=p_equipment_id AND l.movement_context='workshop') THEN
    RAISE EXCEPTION 'workshop movement already exists';
  END IF;
  INSERT INTO public.entry_exit_logs(equipment_id,supervisor_id,movement_type,movement_context,registration_method,notes,recorded_at)
  VALUES (p_equipment_id,auth.uid(),'entry','workshop','manual','رصيد افتتاحي للورشة',now()) RETURNING id INTO v_log_id;
  RETURN v_log_id;
END; $$;

REVOKE ALL ON FUNCTION public.add_workshop_opening_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_workshop_opening_balance(uuid) TO authenticated;

-- enforce_site_exit_purpose: latest 0115; movements.import.
CREATE OR REPLACE FUNCTION public.enforce_site_exit_purpose()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
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
    SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
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

REVOKE ALL ON FUNCTION public.enforce_site_exit_purpose()
  FROM PUBLIC, anon, authenticated;

-- enforce_site_entry_driver: latest 0120; movements.import.
CREATE OR REPLACE FUNCTION public.enforce_site_entry_driver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
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
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
  IF current_setting('app.movement_excel_import', true) = 'true'
     AND public.has_permission('movements.import') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'site_entry_driver_required'
    USING ERRCODE = '23514',
          HINT = 'Select the driver of the site entry.';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_site_entry_driver()
  FROM PUBLIC, anon, authenticated;

-- search_entry_equipment: latest 0116; movements.site.create.
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
  v_role text;
  v_term text;
  v_term_search text;
  v_digits text;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

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

REVOKE ALL ON FUNCTION public.search_entry_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_entry_equipment(text, text, text) TO authenticated;

-- search_site_exit_equipment: latest 0116; movements.site.create, movements.exit_cross_context.
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
  v_role text;
  v_is_admin boolean;
  v_term text;
  v_term_search text;
  v_digits text;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

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

REVOKE ALL ON FUNCTION public.search_site_exit_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_site_exit_equipment(text, text, text) TO authenticated;

-- search_workshop_equipment: latest 0116; movements.workshop.create.
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
  v_role text;
  v_term text;
  v_term_search text;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

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

REVOKE ALL ON FUNCTION public.search_workshop_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_equipment(text, text, text) TO authenticated;

-- get_last_movement: latest 0109; movements.read, movements.site.create, movements.workshop.create.
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
DECLARE
  v_role text;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
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

REVOKE ALL ON FUNCTION public.get_last_movement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_last_movement(uuid, text) TO authenticated;

-- quick_create_foreman_equipment: latest 0109; equipment.quick_create.
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
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
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

REVOKE ALL ON FUNCTION public.quick_create_foreman_equipment(text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_foreman_equipment(text, text, text, uuid) TO authenticated;

-- quick_create_workshop_equipment: latest 0109; equipment.quick_create.
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
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
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

REVOKE ALL ON FUNCTION public.quick_create_workshop_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_workshop_equipment(text, text, text) TO authenticated;

-- quick_create_lessor_by_name: latest 0109; lessors.quick_create.
CREATE OR REPLACE FUNCTION public.quick_create_lessor_by_name(p_name text)
RETURNS public.lessors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lessor public.lessors;
  v_name text := btrim(p_name);
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
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

REVOKE ALL ON FUNCTION public.quick_create_lessor_by_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_lessor_by_name(text) TO authenticated;

-- quick_create_driver: latest 0119; drivers.quick_create.
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
  v_role text;
  v_employment_type text;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
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

REVOKE ALL ON FUNCTION public.quick_create_driver(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_driver(text, text, uuid) TO authenticated;

-- update_equipment_from_excel: latest 0125; equipment.import.
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

-- admin_change_equipment_code: latest 0114; equipment.change_code.
CREATE OR REPLACE FUNCTION public.admin_change_equipment_code(
  p_equipment_id uuid,
  p_new_code text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text := btrim(p_new_code);
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('equipment.change_code') THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_equipment_id IS NULL OR v_code IS NULL OR v_code = '' THEN
    RAISE EXCEPTION 'equipment_code_required' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'equipment_code_reason_too_long' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.equipment_code_change_reason', COALESCE(v_reason, ''), true);

  UPDATE public.equipment
  SET code = v_code
  WHERE id = p_equipment_id;

  IF NOT FOUND THEN
    PERFORM set_config('app.equipment_code_change_reason', '', true);
    RAISE EXCEPTION 'equipment_not_found' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.equipment_code_change_reason', '', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_change_equipment_code(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_change_equipment_code(uuid, text, text) TO authenticated;

-- get_equipment_attention_report: latest 0102; reports.view, movements.read.
CREATE OR REPLACE FUNCTION public.get_equipment_attention_report(
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL,
  p_owners text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(p_search), '');
  v_owners text[];
BEGIN
  IF auth.uid() IS NULL
     OR public.permission_scope('reports.view') IS DISTINCT FROM 'all'
     OR public.permission_scope('movements.read') IS DISTINCT FROM 'all' THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  RETURN (
    WITH latest AS (
      SELECT DISTINCT ON (l.equipment_id)
        l.equipment_id,
        l.id AS movement_id,
        l.movement_type,
        l.movement_context,
        l.recorded_at,
        l.project_id
      FROM public.entry_exit_logs l
      ORDER BY l.equipment_id, l.recorded_at DESC, l.id DESC
    ),
    classified AS (
      SELECT
        e.id AS equipment_id,
        e.code AS equipment_code,
        e.type AS equipment_type,
        e.plate_number,
        latest.movement_id,
        latest.movement_type,
        latest.movement_context,
        latest.recorded_at AS last_movement_at,
        p.name_ar AS project_name_ar,
        p.name_en AS project_name_en,
        CASE
          WHEN latest.movement_id IS NULL THEN 'no_movement'
          WHEN latest.movement_type = 'entry' THEN 'open_visit'
          WHEN latest.movement_type = 'exit' THEN 'outside_sites'
          ELSE 'unclassified_history'
        END AS attention_reason
      FROM public.equipment e
      LEFT JOIN latest ON latest.equipment_id = e.id
      LEFT JOIN public.projects p ON p.id = latest.project_id
      -- This report is entirely current state, so it is the fleet only.
      WHERE e.is_active = true
        AND e.status = 'active'
        AND (v_owners IS NULL OR e.ownership_status = ANY(v_owners))
    ),
    filtered AS (
      SELECT *
      FROM classified
      WHERE attention_reason <> 'unclassified_history'
        AND (
          v_search IS NULL
          OR equipment_code ILIKE '%' || v_search || '%'
          OR equipment_type ILIKE '%' || v_search || '%'
          OR plate_number ILIKE '%' || v_search || '%'
        )
    ),
    paged AS (
      SELECT *
      FROM filtered
      ORDER BY
        CASE attention_reason
          WHEN 'open_visit' THEN 1
          WHEN 'outside_sites' THEN 2
          WHEN 'no_movement' THEN 3
          ELSE 4
        END,
        last_movement_at NULLS LAST,
        equipment_code,
        equipment_id
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*)::integer FROM filtered),
      'summary', jsonb_build_object(
        'no_movement', (SELECT count(*)::integer FROM classified WHERE attention_reason = 'no_movement'),
        'open_visit', (SELECT count(*)::integer FROM classified WHERE attention_reason = 'open_visit'),
        'outside_sites', (SELECT count(*)::integer FROM classified WHERE attention_reason = 'outside_sites')
      ),
      'rows', COALESCE((
        SELECT jsonb_agg(to_jsonb(paged))
        FROM paged
      ), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_equipment_attention_report(integer, integer, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_attention_report(integer, integer, text, text[]) TO authenticated;

-- get_all_equipment_last_movement: latest 0027; equipment.read, movements.read.
CREATE OR REPLACE FUNCTION public.get_all_equipment_last_movement()
RETURNS TABLE(
  equipment_id uuid,
  movement_type text,
  recorded_at timestamptz,
  supervisor_id uuid,
  company_id uuid,
  project_id uuid,
  contractor_equipment_code text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (e.id)
         e.id AS equipment_id,
         l.movement_type,
         l.recorded_at,
         l.supervisor_id,
         l.company_id,
         l.project_id,
         l.contractor_equipment_code
  FROM public.equipment e
  INNER JOIN public.entry_exit_logs l ON l.equipment_id = e.id
  WHERE public.has_permission('equipment.read')
    AND public.permission_scope('movements.read') = 'all'
  ORDER BY e.id, l.recorded_at DESC, l.id DESC;
$$;

REVOKE ALL ON FUNCTION public.get_all_equipment_last_movement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_all_equipment_last_movement() TO authenticated;

-- get_admin_foreman_discipline: latest 0094; home.admin.
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
DECLARE
  v_role text := public.current_user_role();
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

REVOKE ALL ON FUNCTION public.get_admin_foreman_discipline(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_foreman_discipline(timestamptz, timestamptz) TO authenticated;

-- get_admin_entries_series: latest 0095; home.admin.
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
  v_role text := public.current_user_role();
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

REVOKE ALL ON FUNCTION public.get_admin_entries_series(timestamptz, timestamptz, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_entries_series(timestamptz, timestamptz, text[], text) TO authenticated;

-- get_admin_entries_yearly: latest 0095; home.admin.
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
  v_role text := public.current_user_role();
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

REVOKE ALL ON FUNCTION public.get_admin_entries_yearly(integer, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_entries_yearly(integer, text[], text) TO authenticated;

-- get_admin_foreman_recent_movements: latest 0095; home.admin.
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
  v_role text := public.current_user_role();
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

REVOKE ALL ON FUNCTION public.get_admin_foreman_recent_movements(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_foreman_recent_movements(integer) TO authenticated;

-- get_admin_owner_state_matrix: latest 0102; home.admin.
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
  v_role text := public.current_user_role();
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

REVOKE ALL ON FUNCTION public.get_admin_owner_state_matrix(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_owner_state_matrix(text[]) TO authenticated;

-- get_admin_fleet_state: latest 0125; home.admin.
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

REVOKE ALL ON FUNCTION public.get_admin_fleet_state(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_fleet_state(text[]) TO authenticated;

-- get_admin_availability_by_type: latest 0125; home.admin.
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

REVOKE ALL ON FUNCTION public.get_admin_availability_by_type(text[], text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_availability_by_type(text[], text, integer, integer) TO authenticated;

-- get_admin_fleet_equipment: latest 0125; home.admin.
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

REVOKE ALL ON FUNCTION public.get_admin_fleet_equipment(text, text[], text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_fleet_equipment(text, text[], text, integer, integer, text) TO authenticated;

-- admin_set_user_mobile: latest 0113; users.manage.
CREATE OR REPLACE FUNCTION public.admin_set_user_mobile(
  p_user_id uuid,
  p_mobile_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mobile text;
BEGIN
  -- Fail closed: no session, no profile or a non-admin role is rejected.
  IF auth.uid() IS NULL OR public.has_permission('users.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may set a user mobile number.';
  END IF;

  -- Spaces and dashes are typing aids, not part of the number. NULL or an
  -- empty value clears it.
  v_mobile := NULLIF(regexp_replace(COALESCE(p_mobile_number, ''), '[[:space:]-]', '', 'g'), '');
  IF v_mobile IS NOT NULL AND v_mobile !~ '^\+?[0-9]{8,15}$' THEN
    RAISE EXCEPTION 'invalid_mobile'
      USING HINT = 'A mobile number is 8 to 15 digits with an optional leading plus sign.';
  END IF;

  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id) THEN
    RAISE EXCEPTION 'user_not_found'
      USING HINT = 'No user matches this identifier.';
  END IF;

  INSERT INTO public.profile_contacts (user_id, mobile_number, updated_at)
  VALUES (p_user_id, v_mobile, now())
  ON CONFLICT (user_id) DO UPDATE
    SET mobile_number = EXCLUDED.mobile_number,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_mobile(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_mobile(uuid, text) TO authenticated;

-- admin_set_user_role: latest 0079; users.manage.
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_user_id uuid,
  p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('users.manage') THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  IF p_role NOT IN (
    'admin',
    'supervisor',
    'workshop',
    'assistant_workshop_manager',
    'workshop_manager',
    'monitor'
  ) THEN
    RAISE EXCEPTION 'invalid role';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot change your own role';
  END IF;

  IF public.roles_system_enabled() THEN
    RAISE EXCEPTION 'roles_system_active_use_assignment'
      USING ERRCODE = '55000',
            HINT = 'The roles system is active: change the user''s role assignment instead of the account role.';
  END IF;

  UPDATE public.profiles
  SET role = p_role
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated;
-- Keep each function's existing comment and append the 0127 note.
DO $wave22$
DECLARE
  v_item record;
  v_comment text;
BEGIN
  FOR v_item IN
    SELECT n.signature::regprocedure AS fn, n.keys
    FROM (VALUES
    ('public.can_access_movement(uuid)', 'movements.read'),
    ('public.can_write_movement_photos(uuid)', 'movements.photos.manage'),
    ('public.enforce_movement_sequence()', 'movements.workshop.create, movements.site.create, movements.import, movements.exit_cross_context'),
    ('public.change_active_movement_driver(uuid, uuid, text)', 'movements.site.driver_change'),
    ('public.update_entry_contractor_code(uuid, text)', 'movements.site.contractor_code'),
    ('public.classify_workshop_entry(uuid, text)', 'movements.workshop.classify'),
    ('public.request_workshop_arrival_notice(uuid)', 'movements.notify_foreman'),
    ('public.prepare_movement_exit_notice(uuid)', 'movements.edit_delete'),
    ('public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text)', 'movements.edit_delete'),
    ('public.admin_delete_movement(uuid)', 'movements.edit_delete'),
    ('public.prepare_movement_import(jsonb)', 'movements.import'),
    ('public.import_movement_rows(jsonb)', 'movements.import'),
    ('public.search_workshop_opening_candidates(text)', 'movements.import'),
    ('public.add_workshop_opening_balance(uuid)', 'movements.import'),
    ('public.enforce_site_exit_purpose()', 'movements.import'),
    ('public.enforce_site_entry_driver()', 'movements.import'),
    ('public.search_entry_equipment(text, text, text)', 'movements.site.create'),
    ('public.search_site_exit_equipment(text, text, text)', 'movements.site.create, movements.exit_cross_context'),
    ('public.search_workshop_equipment(text, text, text)', 'movements.workshop.create'),
    ('public.get_last_movement(uuid, text)', 'movements.read, movements.site.create, movements.workshop.create'),
    ('public.quick_create_foreman_equipment(text, text, text, uuid)', 'equipment.quick_create'),
    ('public.quick_create_workshop_equipment(text, text, text)', 'equipment.quick_create'),
    ('public.quick_create_lessor_by_name(text)', 'lessors.quick_create'),
    ('public.quick_create_driver(text, text, uuid)', 'drivers.quick_create'),
    ('public.update_equipment_from_excel(jsonb)', 'equipment.import'),
    ('public.admin_change_equipment_code(uuid, text, text)', 'equipment.change_code'),
    ('public.get_equipment_attention_report(integer, integer, text, text[])', 'reports.view, movements.read'),
    ('public.get_all_equipment_last_movement()', 'equipment.read, movements.read'),
    ('public.get_admin_foreman_discipline(timestamptz, timestamptz)', 'home.admin'),
    ('public.get_admin_entries_series(timestamptz, timestamptz, text[], text)', 'home.admin'),
    ('public.get_admin_entries_yearly(integer, text[], text)', 'home.admin'),
    ('public.get_admin_foreman_recent_movements(integer)', 'home.admin'),
    ('public.get_admin_owner_state_matrix(text[])', 'home.admin'),
    ('public.get_admin_fleet_state(text[])', 'home.admin'),
    ('public.get_admin_availability_by_type(text[], text, integer, integer)', 'home.admin'),
    ('public.get_admin_fleet_equipment(text, text[], text, integer, integer, text)', 'home.admin'),
    ('public.admin_set_user_mobile(uuid, text)', 'users.manage'),
    ('public.admin_set_user_role(uuid, text)', 'users.manage')
    ) AS n(signature, keys)
  LOOP
    v_comment := obj_description(v_item.fn, 'pg_proc');
    EXECUTE format(
      'COMMENT ON FUNCTION %s IS %L',
      v_item.fn,
      concat_ws(
        ' ',
        v_comment,
        '0127: role test replaced by permission key(s) ' || v_item.keys
          || '; same result for every legacy role while the roles system is inactive.'
      )
    );
  END LOOP;
END;
$wave22$;

-- ===========================================================================
-- B. Policies
-- ===========================================================================

DROP POLICY IF EXISTS select_entry_exit_logs ON public.entry_exit_logs;
CREATE POLICY select_entry_exit_logs ON public.entry_exit_logs
FOR SELECT TO authenticated
USING (
  supervisor_id = auth.uid()
  OR CASE (SELECT public.permission_scope('movements.read'))
    WHEN 'all' THEN true
    WHEN 'site' THEN movement_context = 'site'
    WHEN 'workshop' THEN movement_context = 'workshop'
    WHEN 'companies' THEN
      movement_context = 'site'
      AND company_id IN (
        SELECT pc.company_id
        FROM public.profile_companies pc
        WHERE pc.profile_id = auth.uid()
      )
    ELSE false
  END
);
COMMENT ON POLICY select_entry_exit_logs ON public.entry_exit_logs IS
  '0127: was a role-name test (latest 0098); now permission key movements.read. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_entry_exit_logs ON public.entry_exit_logs;
CREATE POLICY insert_entry_exit_logs ON public.entry_exit_logs
FOR INSERT TO authenticated
WITH CHECK (
  supervisor_id = auth.uid() OR (SELECT public.has_permission('movements.edit_delete'))
);
COMMENT ON POLICY insert_entry_exit_logs ON public.entry_exit_logs IS
  '0127: was a role-name test (latest 0004); now permission key movements.edit_delete. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_entry_exit_photos ON public.entry_exit_photos;
CREATE POLICY insert_entry_exit_photos ON public.entry_exit_photos
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_permission('movements.photos.manage'))
  AND uploaded_by = auth.uid()
  AND public.can_write_movement_photos(entry_exit_log_id)
);
COMMENT ON POLICY insert_entry_exit_photos ON public.entry_exit_photos IS
  '0127: was a role-name test (latest 0109); now permission key movements.photos.manage. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS update_entry_exit_photos ON public.entry_exit_photos;
CREATE POLICY update_entry_exit_photos ON public.entry_exit_photos
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_permission('movements.photos.manage'))
  AND public.can_access_movement(entry_exit_log_id)
  AND (uploaded_by = auth.uid() OR (SELECT public.has_permission('movements.photos.delete_any')))
)
WITH CHECK (
  (SELECT public.has_permission('movements.photos.manage'))
  AND public.can_access_movement(entry_exit_log_id)
  AND (uploaded_by = auth.uid() OR (SELECT public.has_permission('movements.photos.delete_any')))
);
COMMENT ON POLICY update_entry_exit_photos ON public.entry_exit_photos IS
  '0127: was a role-name test (latest 0072); now permission keys movements.photos.manage, movements.photos.delete_any. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS delete_entry_exit_photos ON public.entry_exit_photos;
CREATE POLICY delete_entry_exit_photos ON public.entry_exit_photos
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('movements.photos.manage'))
  AND public.can_access_movement(entry_exit_log_id)
  AND (uploaded_by = auth.uid() OR (SELECT public.has_permission('movements.photos.delete_any')))
);
COMMENT ON POLICY delete_entry_exit_photos ON public.entry_exit_photos IS
  '0127: was a role-name test (latest 0072); now permission keys movements.photos.manage, movements.photos.delete_any. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_log_photos ON storage.objects;
CREATE POLICY insert_log_photos ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'log-photos'
  AND (SELECT public.has_permission('movements.photos.manage'))
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    public.can_write_movement_photos(public.safe_uuid(split_part(name, '/', 2)))
    OR EXISTS (
      SELECT 1
      FROM public.pending_movement_photo_batches pending
      WHERE pending.id = public.safe_uuid(split_part(name, '/', 2))
        AND pending.uploaded_by = auth.uid()
        AND pending.expires_at > now()
        AND name = ANY(pending.file_paths)
    )
  )
);
COMMENT ON POLICY insert_log_photos ON storage.objects IS
  '0127: was a role-name test (latest 0109); now permission key movements.photos.manage. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS update_log_photos ON storage.objects;
CREATE POLICY update_log_photos ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'log-photos'
  AND (SELECT public.has_permission('movements.photos.manage'))
  AND ((storage.foldername(name))[1] = auth.uid()::text OR (SELECT public.has_permission('movements.photos.delete_any')))
)
WITH CHECK (
  bucket_id = 'log-photos'
  AND (SELECT public.has_permission('movements.photos.manage'))
  AND ((storage.foldername(name))[1] = auth.uid()::text OR (SELECT public.has_permission('movements.photos.delete_any')))
);
COMMENT ON POLICY update_log_photos ON storage.objects IS
  '0127: was a role-name test (latest 0072); now permission keys movements.photos.manage, movements.photos.delete_any. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS delete_log_photos ON storage.objects;
CREATE POLICY delete_log_photos ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'log-photos'
  AND (SELECT public.has_permission('movements.photos.manage'))
  AND ((storage.foldername(name))[1] = auth.uid()::text OR (SELECT public.has_permission('movements.photos.delete_any')))
  AND (
    (SELECT public.has_permission('movements.photos.delete_any'))
    OR EXISTS (
      SELECT 1
      FROM public.entry_exit_photos photo
      WHERE photo.file_path = name
        AND public.can_access_movement(photo.entry_exit_log_id)
    )
    OR public.can_access_movement(public.safe_uuid(split_part(name, '/', 2)))
    OR EXISTS (
      SELECT 1
      FROM public.entry_exit_logs movement
      WHERE movement.photo_url = name
        AND public.can_access_movement(movement.id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.pending_movement_photo_batches pending
      WHERE pending.id = public.safe_uuid(split_part(name, '/', 2))
        AND pending.uploaded_by = auth.uid()
        AND name = ANY(pending.file_paths)
    )
  )
);
COMMENT ON POLICY delete_log_photos ON storage.objects IS
  '0127: was a role-name test (latest 0104); now permission keys movements.photos.manage, movements.photos.delete_any. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_own_pending_movement_photo_batches ON public.pending_movement_photo_batches;
CREATE POLICY insert_own_pending_movement_photo_batches ON public.pending_movement_photo_batches
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND (SELECT public.has_permission('movements.photos.manage'))
  AND expires_at > now()
);
COMMENT ON POLICY insert_own_pending_movement_photo_batches ON public.pending_movement_photo_batches IS
  '0127: was a role-name test (latest 0079); now permission key movements.photos.manage. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS select_movement_notices ON public.movement_notices;
CREATE POLICY select_movement_notices ON public.movement_notices
FOR SELECT TO authenticated
USING (
  (SELECT public.has_permission('settings.integrations'))
  OR sender_id = auth.uid()
  OR recipient_id = auth.uid()
  OR (
    kind = 'workshop_arrival'
    AND (SELECT public.has_permission('movements.notify_foreman'))
  )
);
COMMENT ON POLICY select_movement_notices ON public.movement_notices IS
  '0127: was a role-name test (latest 0110); now permission keys settings.integrations, movements.notify_foreman. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS select_profiles ON public.profiles;
CREATE POLICY select_profiles ON public.profiles
FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR (SELECT public.permission_scope('users.read')) = 'all'
  OR (
    (SELECT public.permission_scope('users.read')) = 'workshop'
    AND role IN ('workshop', 'assistant_workshop_manager', 'workshop_manager')
  )
);
COMMENT ON POLICY select_profiles ON public.profiles IS
  '0127: was a role-name test (latest 0076); now permission key users.read. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_profiles ON public.profiles;
CREATE POLICY insert_profiles ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_permission('users.manage'))
);
COMMENT ON POLICY insert_profiles ON public.profiles IS
  '0127: was a role-name test (latest 0004); now permission key users.manage. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS update_profiles ON public.profiles;
CREATE POLICY update_profiles ON public.profiles
FOR UPDATE TO authenticated
USING (
  auth.uid() = id OR (SELECT public.has_permission('users.manage'))
)
WITH CHECK (
  auth.uid() = id OR (SELECT public.has_permission('users.manage'))
);
COMMENT ON POLICY update_profiles ON public.profiles IS
  '0127: was a role-name test (latest 0004); now permission key users.manage. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS delete_profiles ON public.profiles;
CREATE POLICY delete_profiles ON public.profiles
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('users.manage'))
);
COMMENT ON POLICY delete_profiles ON public.profiles IS
  '0127: was a role-name test (latest 0004); now permission key users.manage. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS select_profile_contacts ON public.profile_contacts;
CREATE POLICY select_profile_contacts ON public.profile_contacts
FOR SELECT TO authenticated
USING (
  (SELECT public.has_permission('users.manage'))
  OR user_id = auth.uid()
);
COMMENT ON POLICY select_profile_contacts ON public.profile_contacts IS
  '0127: was a role-name test (latest 0113); now permission key users.manage. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS select_profile_companies ON public.profile_companies;
CREATE POLICY select_profile_companies ON public.profile_companies
FOR SELECT TO authenticated
USING (
  profile_id = auth.uid() OR (SELECT public.has_permission('users.manage'))
);
COMMENT ON POLICY select_profile_companies ON public.profile_companies IS
  '0127: was a role-name test (latest 0058); now permission key users.manage. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_profile_companies ON public.profile_companies;
CREATE POLICY insert_profile_companies ON public.profile_companies
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_permission('users.manage'))
);
COMMENT ON POLICY insert_profile_companies ON public.profile_companies IS
  '0127: was a role-name test (latest 0058); now permission key users.manage. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS update_profile_companies ON public.profile_companies;
CREATE POLICY update_profile_companies ON public.profile_companies
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_permission('users.manage'))
)
WITH CHECK (
  (SELECT public.has_permission('users.manage'))
);
COMMENT ON POLICY update_profile_companies ON public.profile_companies IS
  '0127: was a role-name test (latest 0058); now permission key users.manage. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS delete_profile_companies ON public.profile_companies;
CREATE POLICY delete_profile_companies ON public.profile_companies
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('users.manage'))
);
COMMENT ON POLICY delete_profile_companies ON public.profile_companies IS
  '0127: was a role-name test (latest 0058); now permission key users.manage. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS movement_audit_logs_admin_select ON public.movement_audit_logs;
CREATE POLICY movement_audit_logs_admin_select ON public.movement_audit_logs
FOR SELECT TO authenticated
USING (
  (SELECT public.has_permission('movements.activity'))
);
COMMENT ON POLICY movement_audit_logs_admin_select ON public.movement_audit_logs IS
  '0127: was a role-name test (latest 0069); now permission key movements.activity. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_equipment ON public.equipment;
CREATE POLICY insert_equipment ON public.equipment
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_permission('equipment.create'))
);
COMMENT ON POLICY insert_equipment ON public.equipment IS
  '0127: was a role-name test (latest 0004); now permission key equipment.create. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS update_equipment ON public.equipment;
CREATE POLICY update_equipment ON public.equipment
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_permission('equipment.edit'))
)
WITH CHECK (
  (SELECT public.has_permission('equipment.edit'))
);
COMMENT ON POLICY update_equipment ON public.equipment IS
  '0127: was a role-name test (latest 0004); now permission key equipment.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS delete_equipment ON public.equipment;
CREATE POLICY delete_equipment ON public.equipment
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('equipment.delete'))
);
COMMENT ON POLICY delete_equipment ON public.equipment IS
  '0127: was a role-name test (latest 0004); now permission key equipment.delete. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_projects ON public.projects;
CREATE POLICY insert_projects ON public.projects
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_permission('companies_projects.edit'))
);
COMMENT ON POLICY insert_projects ON public.projects IS
  '0127: was a role-name test (latest 0004); now permission key companies_projects.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS update_projects ON public.projects;
CREATE POLICY update_projects ON public.projects
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_permission('companies_projects.edit'))
)
WITH CHECK (
  (SELECT public.has_permission('companies_projects.edit'))
);
COMMENT ON POLICY update_projects ON public.projects IS
  '0127: was a role-name test (latest 0004); now permission key companies_projects.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS delete_projects ON public.projects;
CREATE POLICY delete_projects ON public.projects
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('companies_projects.edit'))
);
COMMENT ON POLICY delete_projects ON public.projects IS
  '0127: was a role-name test (latest 0004); now permission key companies_projects.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_companies ON public.companies;
CREATE POLICY insert_companies ON public.companies
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_permission('companies_projects.edit'))
);
COMMENT ON POLICY insert_companies ON public.companies IS
  '0127: was a role-name test (latest 0018); now permission key companies_projects.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS update_companies ON public.companies;
CREATE POLICY update_companies ON public.companies
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_permission('companies_projects.edit'))
)
WITH CHECK (
  (SELECT public.has_permission('companies_projects.edit'))
);
COMMENT ON POLICY update_companies ON public.companies IS
  '0127: was a role-name test (latest 0018); now permission key companies_projects.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS delete_companies ON public.companies;
CREATE POLICY delete_companies ON public.companies
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('companies_projects.edit'))
);
COMMENT ON POLICY delete_companies ON public.companies IS
  '0127: was a role-name test (latest 0018); now permission key companies_projects.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_company_projects ON public.company_projects;
CREATE POLICY insert_company_projects ON public.company_projects
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_permission('companies_projects.edit'))
);
COMMENT ON POLICY insert_company_projects ON public.company_projects IS
  '0127: was a role-name test (latest 0029); now permission key companies_projects.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS update_company_projects ON public.company_projects;
CREATE POLICY update_company_projects ON public.company_projects
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_permission('companies_projects.edit'))
)
WITH CHECK (
  (SELECT public.has_permission('companies_projects.edit'))
);
COMMENT ON POLICY update_company_projects ON public.company_projects IS
  '0127: was a role-name test (latest 0029); now permission key companies_projects.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS delete_company_projects ON public.company_projects;
CREATE POLICY delete_company_projects ON public.company_projects
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('companies_projects.edit'))
);
COMMENT ON POLICY delete_company_projects ON public.company_projects IS
  '0127: was a role-name test (latest 0029); now permission key companies_projects.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_lessors ON public.lessors;
CREATE POLICY insert_lessors ON public.lessors
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_permission('lessors.edit'))
);
COMMENT ON POLICY insert_lessors ON public.lessors IS
  '0127: was a role-name test (latest 0004); now permission key lessors.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS update_lessors ON public.lessors;
CREATE POLICY update_lessors ON public.lessors
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_permission('lessors.edit'))
)
WITH CHECK (
  (SELECT public.has_permission('lessors.edit'))
);
COMMENT ON POLICY update_lessors ON public.lessors IS
  '0127: was a role-name test (latest 0004); now permission key lessors.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS delete_lessors ON public.lessors;
CREATE POLICY delete_lessors ON public.lessors
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('lessors.edit'))
);
COMMENT ON POLICY delete_lessors ON public.lessors IS
  '0127: was a role-name test (latest 0004); now permission key lessors.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_drivers ON public.drivers;
CREATE POLICY insert_drivers ON public.drivers
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_permission('drivers.create'))
);
COMMENT ON POLICY insert_drivers ON public.drivers IS
  '0127: was a role-name test (latest 0033); now permission key drivers.create. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS update_drivers ON public.drivers;
CREATE POLICY update_drivers ON public.drivers
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_permission('drivers.edit'))
)
WITH CHECK (
  (SELECT public.has_permission('drivers.edit'))
);
COMMENT ON POLICY update_drivers ON public.drivers IS
  '0127: was a role-name test (latest 0033); now permission key drivers.edit. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS delete_drivers ON public.drivers;
CREATE POLICY delete_drivers ON public.drivers
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('drivers.delete'))
);
COMMENT ON POLICY delete_drivers ON public.drivers IS
  '0127: was a role-name test (latest 0033); now permission key drivers.delete. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS insert_equipment_types ON public.equipment_types;
CREATE POLICY insert_equipment_types ON public.equipment_types
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.has_permission('settings.equipment_types'))
);
COMMENT ON POLICY insert_equipment_types ON public.equipment_types IS
  '0127: was a role-name test (latest 0039); now permission key settings.equipment_types. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS update_equipment_types ON public.equipment_types;
CREATE POLICY update_equipment_types ON public.equipment_types
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_permission('settings.equipment_types'))
)
WITH CHECK (
  (SELECT public.has_permission('settings.equipment_types'))
);
COMMENT ON POLICY update_equipment_types ON public.equipment_types IS
  '0127: was a role-name test (latest 0039); now permission key settings.equipment_types. Same result for every legacy role while the roles system is inactive.';

DROP POLICY IF EXISTS delete_equipment_types ON public.equipment_types;
CREATE POLICY delete_equipment_types ON public.equipment_types
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('settings.equipment_types'))
);
COMMENT ON POLICY delete_equipment_types ON public.equipment_types IS
  '0127: was a role-name test (latest 0039); now permission key settings.equipment_types. Same result for every legacy role while the roles system is inactive.';
NOTIFY pgrst, 'reload schema';
