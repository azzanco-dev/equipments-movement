-- Owner request 2026-09-19: a foreman must be able to correct the contractor
-- equipment code ("ترقيم الشركة") on his OWN site ENTRY while the visit is
-- still open. Until now `entry_exit_logs` had no UPDATE policy at all and only
-- admins could change a movement, through `public.admin_update_movement`.
--
-- Why a SECURITY DEFINER function and NOT an UPDATE policy
-- -------------------------------------------------------
-- PostgreSQL RLS cannot restrict WHICH COLUMNS an UPDATE touches. A
-- `FOR UPDATE ... USING (...) WITH CHECK (...)` policy on `entry_exit_logs`
-- would let a foreman rewrite `recorded_at`, `company_id`, `project_id`,
-- `driver_id`, `supervisor_id` or `movement_type` on any row the policy
-- matched — the movement invariants and the EXIT inheritance chain would then
-- be editable from PostgREST. Column privileges (`GRANT UPDATE (col)`) cannot
-- express the row conditions we need either (ownership + open visit), and the
-- openness test needs rows the caller's own SELECT policy may hide.
--
-- So the reviewed pattern already used by 0067 (`change_active_movement_driver`)
-- and 0068 (`admin_update_movement`) is reused: a narrowly scoped
-- SECURITY DEFINER function that is the ONLY write path. `entry_exit_logs`
-- keeps zero UPDATE policies, so PostgREST `PATCH /entry_exit_logs` stays
-- denied for every role, including `supervisor`.
--
-- Guarantees of `public.update_entry_contractor_code`
--   * caller must be authenticated and have the `supervisor` role, read from
--     `public.profiles` (fail closed: a NULL/unknown role is rejected);
--   * the row must be the caller's own (`supervisor_id = auth.uid()`),
--     `movement_type = 'entry'` and `movement_context = 'site'`;
--   * the visit must still be open — no later movement for that equipment
--     ordered deterministically by `(recorded_at, id)`, checked while holding
--     `pg_advisory_xact_lock(hashtextextended(equipment_id::text, 0))`, the
--     same key `public.enforce_movement_sequence()` takes before it probes the
--     sequence, so a concurrent EXIT insert cannot slip between the openness
--     check and the UPDATE;
--   * the input is trimmed, `''` becomes NULL (the code is optional) and
--     anything longer than 50 characters is rejected;
--   * exactly ONE column is written: `contractor_equipment_code`.
--
-- Audit: no explicit insert is needed. The existing AFTER INSERT/UPDATE/DELETE
-- trigger `audit_entry_exit_logs` (migration 0069) already records every
-- database write path into `public.movement_audit_logs` with `auth.uid()` as
-- the actor. `auth.uid()` reads the request JWT GUC, which SECURITY DEFINER
-- does not change, so the FOREMAN is recorded as the actor, not the function
-- owner, with `changed_fields = {contractor_equipment_code}`.
--
-- Not affected:
--   * `enforce_movement_sequence` is a BEFORE **INSERT** trigger (0021, bodies
--     replaced by 0087/0088). Updating one column never re-runs it.
--   * EXIT inheritance is untouched: `enforce_movement_sequence` copies
--     `contractor_equipment_code` from the corresponding latest valid ENTRY at
--     the moment the EXIT is inserted, so an edit made while the visit is open
--     is the value the later EXIT inherits.
--   * Admin behavior is unchanged: admins keep `admin_update_movement`, which
--     still updates both rows of a closed visit. This function is deliberately
--     supervisor-only.

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
  IF v_role IS DISTINCT FROM 'supervisor' THEN
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

COMMENT ON FUNCTION public.update_entry_contractor_code(uuid, text) IS
  'Foreman-only, single-column edit of contractor_equipment_code on his own open site ENTRY. The only UPDATE path on entry_exit_logs for role supervisor; audited by the audit_entry_exit_logs trigger.';

REVOKE ALL ON FUNCTION public.update_entry_contractor_code(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_entry_contractor_code(uuid, text)
  TO authenticated;
