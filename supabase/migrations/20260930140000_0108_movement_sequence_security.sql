-- Wave 8 security batch, part 1 of 2: the movement sequence and its write paths.
--
-- Owner approval 2026-09-30, after a read-only audit. Since migration 0043 the
-- ENTRY -> EXIT sequence is GLOBAL per equipment (ONE chain across the `site`
-- and `workshop` contexts, ordered by `(recorded_at, id)`), and
-- `public.enforce_movement_sequence()` serialises on
-- `pg_advisory_xact_lock(hashtextextended(equipment_id::text, 0))`. Several
-- later objects still assumed one sequence and one lock key PER CONTEXT. This
-- migration brings them back in line. Nothing here edits data.
--
-- ===========================================================================
-- H1 / M4 / M8 — `public.enforce_movement_sequence()`
-- ===========================================================================
--   Recreated from its latest full definition (0103). Three intended changes,
--   everything else is the 0103 body repeated in full because
--   `CREATE OR REPLACE FUNCTION` cannot replace part of a body:
--
--   H1. An EXIT whose context differs from the context of the ENTRY it closes
--       is reserved to admins (owner decision 2026-09-30). 0088 enforced that
--       only for `movement_context = 'site'`, so a workshop role could insert
--       a WORKSHOP exit for a unit whose open entry was a SITE entry and close
--       a foreman's visit. The workshop branch now raises the symmetrical
--       stable code `exit_equipment_on_site` (ERRCODE 42501). The site branch
--       (`exit_equipment_in_workshop`, `exit_not_entry_owner`) is unchanged.
--       A workshop exit that closes a WORKSHOP entry keeps the shared-workshop
--       rule of 0076: any workshop role may register it.
--
--   M4. Both role checks fail closed. `v_role NOT IN (...)` evaluates to NULL
--       for a caller with no profile row, and `IF NULL THEN` does not raise, so
--       a JWT whose profile was deleted passed the role check. They now read
--       `v_role IS NULL OR v_role NOT IN (...)`.
--       Consequence for maintenance: an INSERT with no JWT at all (SQL editor,
--       a future data-fix migration) is now rejected too. Such a script must
--       impersonate a real user or disable the trigger for its statement.
--
--   M8. A driverless site ENTRY stores NULL in BOTH `driver_id` and
--       `driver_name` (AGENTS.md, owner decision 2026-09-23). 0103 kept a
--       client-supplied `driver_name` when `driver_id` was NULL, so any caller
--       of the movement API could store a free-text name that matches no
--       driver. The name is now kept ONLY on the one legitimate path that
--       writes a name without an id: the admin Excel import
--       (`public.import_movement_rows`, 0063), which sets the
--       transaction-local `app.movement_excel_import` marker and is admin
--       only — exactly the predicate 0088 used for its old exemption. Clients
--       cannot set that GUC through PostgREST. Existing legacy rows that have
--       only `driver_name` are not touched and keep displaying.
--
--   `search_path` becomes `public, pg_temp` (was `public`): listing `pg_temp`
--   last keeps a temporary object from shadowing a table the trigger reads.
--
-- ===========================================================================
-- H2 — `public.admin_update_movement` and `public.admin_delete_movement`
-- ===========================================================================
--   Recreated from 0105 with the same signatures, return types and grants.
--
--   Lock. Both took `hashtextextended(equipment_id || ':' || context, 0)`,
--   which is NOT the trigger's key, so they never serialised against a
--   concurrent movement insert. They now take exactly the trigger's key. When
--   a correction moves a movement to another equipment, both equipment locks
--   are taken in ascending uuid order so two concurrent corrections cannot
--   deadlock on them. The row lock is still taken before the advisory lock,
--   the same order `public.update_entry_contractor_code` (0093) uses.
--
--   Sequence rule. The checks were per context (`PARTITION BY equipment_id,
--   movement_context`, "last movement of this context") although the sequence
--   is global: site ENTRY, site EXIT, workshop ENTRY, then deleting the site
--   EXIT, left ENTRY -> ENTRY. They are now global per equipment, ordered by
--   `(recorded_at, id)`.
--
--   Rows older than 0043 may already interleave the two contexts, and such an
--   equipment must stay correctable. So an edit is refused only when it
--   INTRODUCES a violation, never because one already exists elsewhere in the
--   chain. A violation is a row that repeats the type of the row before it, or
--   a first row that is an EXIT.
--     * Update: `public.movement_sequence_violations(equipment)` is counted
--       for the old and the new equipment under the locks, before and after
--       the write. `invalid_sequence` is raised when either count GROWS. For a
--       clean chain (count 0) this is exactly the old strict check, globally.
--     * Delete: removing a row makes its two neighbours adjacent. The delete
--       is refused when that new adjacency is a violation AND the row itself
--       was part of none. In a clean chain that is every row except the last
--       one, so the documented rule "only the last movement may be deleted"
--       holds unchanged, now across both contexts. In a legacy chain a row
--       that is itself the duplicate may be removed. Codes are unchanged:
--       `entry_has_later_exit` when the row is an ENTRY followed by an EXIT,
--       otherwise `movement_not_last`.
--
--   Visit pair (update only). The row that shares the visit is now the
--   ADJACENT row of the global chain when it has the opposite type, which is
--   the ENTRY the sequence trigger actually inherited from. For a same-context
--   visit that is the row 0105 already picked. It differs only for an admin
--   cross-context exit, where the per-context search picked an unrelated older
--   visit and would have copied company/project/code onto it. The per-context
--   search stays as the fallback for legacy interleaved rows. Site facts are
--   copied onto the pair only when the edited row is a site movement, so
--   editing a workshop exit can never blank a site entry.
--
--   "Open visit" (update only). A site ENTRY is also treated as closed when
--   the next movement of the equipment is an EXIT in the other context, so the
--   in-place driver correction agrees with `change_active_movement_driver`.
--
--   Everything else is the 0105 body: admin check, payload validation, the
--   notes and contractor-code rules, the driver rules, the photo and
--   driver-change cleanup and audit row of the delete, and the returned
--   Storage paths.
--
-- ===========================================================================
-- H3 — `public.change_active_movement_driver`
-- ===========================================================================
--   Recreated from 0067. It authorised with `can_access_movement()`, which is
--   a READ rule: true for `monitor` (0072) and for every workshop role (0098).
--   A read-only user could therefore change the driver of any open site visit;
--   only the button was hidden. It now allows an admin, or a `supervisor`
--   whose `auth.uid()` is the entry's `supervisor_id`, and fails closed for a
--   missing profile. A refused caller gets the same `entry_not_accessible` as
--   a missing row, so the function never discloses another foreman's entry.
--   The lock key was `equipment_id || ':site'`; it is now the trigger's key.
--   The history stays append-only and a closed visit still rejects a change;
--   "closed" additionally covers an admin exit recorded in the other context.
--
-- ===========================================================================
-- Security
-- ===========================================================================
--   Every function keeps SECURITY DEFINER with a fixed `search_path`, EXECUTE
--   revoked from PUBLIC/anon and granted to `authenticated` only, and
--   validates `auth.uid()`/role itself. The trigger function and the internal
--   helper are not executable by any client role.

-- ---------------------------------------------------------------------------
-- 1. Sequence trigger: H1 + M4 + M8
-- ---------------------------------------------------------------------------
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

-- A trigger function is never called directly (0025). Repeated so the state
-- is explicit in the file that holds the live definition.
REVOKE ALL ON FUNCTION public.enforce_movement_sequence()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Internal helper: violations of the global sequence of one equipment
-- ---------------------------------------------------------------------------
-- Counts the rows that break ENTRY -> EXIT -> ENTRY -> EXIT for one equipment
-- across BOTH contexts, ordered by (recorded_at, id): a first row that is not
-- an ENTRY, and every row that repeats the type of the row before it.
--
-- Deliberately NOT SECURITY DEFINER and not executable by any client role. It
-- is called only from the SECURITY DEFINER admin functions below, where it
-- runs with their owner's rights. Should it ever be granted by mistake, it
-- would run with the caller's rights and `entry_exit_logs` RLS would apply.
CREATE OR REPLACE FUNCTION public.movement_sequence_violations(p_equipment_id uuid)
RETURNS integer
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
  FROM (
    SELECT
      l.movement_type,
      lag(l.movement_type) OVER (ORDER BY l.recorded_at, l.id) AS prev,
      row_number() OVER (ORDER BY l.recorded_at, l.id) AS rn
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = p_equipment_id
  ) s
  WHERE (s.rn = 1 AND s.movement_type <> 'entry')
     OR s.prev = s.movement_type;
$$;

COMMENT ON FUNCTION public.movement_sequence_violations(uuid) IS
  'Internal. Number of rows that break the global ENTRY/EXIT sequence of one equipment, ordered by (recorded_at, id) across both contexts. Used by the admin correction to refuse only an edit that introduces a violation.';

REVOKE ALL ON FUNCTION public.movement_sequence_violations(uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Admin correction of one movement (H2)
-- ---------------------------------------------------------------------------
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

COMMENT ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text) IS
  'Admin-only correction of one movement in one transaction: equipment, supervisor, recorded_at, site company/project/contractor code (copied to the paired visit row), driver and notes. Serialises on the sequence trigger''s per-equipment advisory lock and refuses a change that introduces a violation of the global ENTRY/EXIT sequence ordered by (recorded_at, id). An open site visit keeps its immutable entry driver: change_active_movement_driver is the only path there. p_notes NULL keeps the note, empty clears it. Audited by the audit_entry_exit_logs trigger.';

REVOKE ALL ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_movement(uuid, uuid, uuid, timestamptz, uuid, uuid, text, uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Admin delete of one movement (H2)
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

COMMENT ON FUNCTION public.admin_delete_movement(uuid) IS
  'Admin-only delete of one movement. Serialises on the sequence trigger''s per-equipment advisory lock and refuses a delete that introduces a violation of the global ENTRY/EXIT sequence ordered by (recorded_at, id): in a valid chain only the last movement of the equipment may go. Removes the driver-change and photo rows in the same transaction, records them in movement_audit_logs, and returns the Storage paths the API route deletes afterwards.';

REVOKE ALL ON FUNCTION public.admin_delete_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_movement(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Driver change on an open site visit (H3)
-- ---------------------------------------------------------------------------
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
  v_allowed := FOUND AND (
    v_role = 'admin'
    OR (v_role = 'supervisor' AND v_entry.supervisor_id = auth.uid())
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

COMMENT ON FUNCTION public.change_active_movement_driver(uuid, uuid, text) IS
  'Append-only driver change on an OPEN site ENTRY. Allowed for an admin or the foreman who registered the entry; every other role, and a caller without a profile, is refused. Serialises on the sequence trigger''s per-equipment advisory lock; a closed visit rejects the change.';

REVOKE ALL ON FUNCTION public.change_active_movement_driver(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_active_movement_driver(uuid, uuid, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
