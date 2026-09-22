-- Owner request 2026-09-23: on the movement detail page an admin needs two
-- extra actions behind the header menu — edit the note and the driver, and
-- delete the movement entirely (with its photos).
--
-- Why SECURITY DEFINER functions and NOT RLS policies
-- ---------------------------------------------------
-- `entry_exit_logs` deliberately has NO UPDATE and NO DELETE policy, so
-- PostgREST `PATCH`/`DELETE /entry_exit_logs` is denied for every role. RLS
-- cannot restrict WHICH columns an UPDATE writes, and a DELETE policy could
-- not express the sequence rule ("only the last movement may go"), so the
-- reviewed pattern of 0067/0068/0093 is reused: narrowly scoped
-- SECURITY DEFINER functions with a fixed `search_path`, `public.is_admin()`
-- checked fail-closed, EXECUTE revoked from PUBLIC/anon and granted to
-- `authenticated` only.
--
-- Audit
-- -----
-- No explicit audit row is needed for the movement itself. The existing
-- AFTER INSERT/UPDATE/DELETE trigger `audit_entry_exit_logs` (0069, body
-- replaced by 0070) fires on UPDATE and on DELETE and writes
-- `public.movement_audit_logs` with `auth.uid()` as the actor — SECURITY
-- DEFINER does not change the JWT GUC, so the ADMIN is recorded, not the
-- function owner. `admin_delete_movement` adds ONE extra row of its own,
-- before the movement row goes, for the dependent records the trigger cannot
-- see (driver changes and photo paths); the trigger then adds the
-- `delete` row that carries `movement_audit_snapshot(OLD)`.
-- `movement_audit_logs.movement_id` has no foreign key, so both rows survive
-- the deletion of the movement.

-- ---------------------------------------------------------------------------
-- 1. Admin edit of the note and the driver
-- ---------------------------------------------------------------------------
-- Exactly three columns may be written: `notes`, `driver_id`, `driver_name`.
-- `recorded_at`, `movement_type`, `movement_context`, `equipment_id`,
-- `company_id`, `project_id` and `contractor_equipment_code` are never touched
-- here — the existing `public.admin_update_movement` (0068) stays the path for
-- those, and `public.update_entry_contractor_code` (0093) stays the foreman
-- path for the contractor code.
--
-- Driver rules (the movement invariants stay authoritative in the database):
--   * workshop movements have no driver at all (the sequence trigger nulls
--     the driver columns on insert), so any driver input is rejected;
--   * on a site ENTRY whose visit is still OPEN the entry driver stays
--     immutable: the append-only `public.change_active_movement_driver`
--     (0040) is the only path, so this function refuses with
--     `open_visit_driver_change` and the UI routes the admin there;
--   * on a closed visit (ENTRY with a later movement) and on an EXIT row the
--     admin may correct the driver; the audit trigger records it.
--   * `p_driver_name` is NOT trusted as a snapshot: whenever `p_driver_id` is
--     given, the stored name is read from `public.drivers`. It is honoured
--     only to repair a legacy row that has a name but no `driver_id`, and
--     then it never invents a `driver_id`.
CREATE OR REPLACE FUNCTION public.admin_update_movement_details(
  p_log_id uuid,
  p_notes text,
  p_driver_id uuid DEFAULT NULL,
  p_driver_name text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log public.entry_exit_logs;
  v_notes text;
  v_legacy_name text;
  v_driver_name text;
  v_has_later boolean;
BEGIN
  -- Fail closed: no session, no profile or a non-admin role is rejected.
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may edit a movement.';
  END IF;

  SELECT l.* INTO v_log
  FROM public.entry_exit_logs l
  WHERE l.id = p_log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'movement_not_found'
      USING HINT = 'No movement matches this identifier.';
  END IF;

  -- The caller always sends the full note, so an empty value clears it.
  v_notes := NULLIF(btrim(p_notes), '');
  IF v_notes IS NOT NULL AND char_length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'movement_notes_too_long'
      USING HINT = 'The note is limited to 1000 characters.';
  END IF;

  v_legacy_name := NULLIF(btrim(p_driver_name), '');

  IF (p_driver_id IS NOT NULL OR v_legacy_name IS NOT NULL)
     AND v_log.movement_context <> 'site' THEN
    RAISE EXCEPTION 'driver_not_supported'
      USING HINT = 'Workshop movements are recorded without a driver.';
  END IF;

  IF p_driver_id IS NOT NULL THEN
    SELECT d.full_name INTO v_driver_name
    FROM public.drivers d
    WHERE d.id = p_driver_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_driver'
        USING HINT = 'The selected driver does not exist.';
    END IF;

    IF v_log.movement_type = 'entry' THEN
      -- Same key as enforce_movement_sequence(): serialise against a
      -- concurrent EXIT insert for this equipment and context, so the
      -- open/closed decision cannot race.
      PERFORM pg_advisory_xact_lock(
        hashtextextended(v_log.equipment_id::text || ':' || v_log.movement_context, 0)
      );
      SELECT EXISTS (
        SELECT 1
        FROM public.entry_exit_logs l
        WHERE l.equipment_id = v_log.equipment_id
          AND l.movement_context = v_log.movement_context
          AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)
      ) INTO v_has_later;

      IF NOT v_has_later THEN
        RAISE EXCEPTION 'open_visit_driver_change'
          USING HINT = 'Use change_active_movement_driver while the visit is open.';
      END IF;
    END IF;
  END IF;

  UPDATE public.entry_exit_logs l
  SET notes = v_notes,
      driver_id = CASE
        WHEN p_driver_id IS NOT NULL THEN p_driver_id
        ELSE l.driver_id
      END,
      driver_name = CASE
        WHEN p_driver_id IS NOT NULL THEN v_driver_name
        -- Legacy repair only: a row that kept a name without a driver_id.
        WHEN l.driver_id IS NULL AND v_legacy_name IS NOT NULL THEN v_legacy_name
        ELSE l.driver_name
      END
  WHERE l.id = p_log_id;
END;
$$;

COMMENT ON FUNCTION public.admin_update_movement_details(uuid, text, uuid, text) IS
  'Admin-only edit of notes/driver_id/driver_name on one movement. Never writes recorded_at, type, context, equipment, company, project or contractor code. An open site visit keeps its immutable entry driver: change_active_movement_driver is the only path there. Audited by the audit_entry_exit_logs trigger.';

REVOKE ALL ON FUNCTION public.admin_update_movement_details(uuid, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_movement_details(uuid, text, uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The workshop "keep one photo" guard must not block a movement deletion
-- ---------------------------------------------------------------------------
-- `protect_workshop_required_photo` (0040) refuses to delete the last photo of
-- a workshop movement. That rule protects an EXISTING movement; once the
-- movement itself is being deleted it is meaningless and would make the
-- deletion impossible. Two narrow escapes are added, and nothing else changes:
--   * a transaction-local marker set by `admin_delete_movement` only (clients
--     cannot set GUCs through PostgREST), and
--   * the parent movement no longer existing, which is what the
--     `ON DELETE CASCADE` from `entry_exit_logs` produces.
CREATE OR REPLACE FUNCTION public.protect_workshop_required_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('app.movement_delete', true) = OLD.entry_exit_log_id::text THEN
    RETURN OLD;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.entry_exit_logs l WHERE l.id = OLD.entry_exit_log_id
  ) THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    WHERE l.id = OLD.entry_exit_log_id
      AND l.movement_context = 'workshop'
  ) AND (
    SELECT count(*)
    FROM public.entry_exit_photos p
    WHERE p.entry_exit_log_id = OLD.entry_exit_log_id
  ) <= 1 THEN
    RAISE EXCEPTION 'workshop movement requires one photo';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_workshop_required_photo()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Admin delete of one movement
-- ---------------------------------------------------------------------------
-- Invariants:
--   * the per-equipment advisory lock is taken with the SAME key as
--     `enforce_movement_sequence()` (`equipment_id || ':' || movement_context`)
--     so a concurrent insert cannot slip between the check and the delete;
--   * only the LAST movement of that (equipment, movement_context) sequence,
--     ordered deterministically by `(recorded_at, id)`, may be deleted.
--     Deleting an ENTRY that already has an EXIT is reported separately
--     (`entry_has_later_exit`) because the UI tells the admin to delete the
--     exit first; deleting any other non-last row would turn the sequence
--     into ENTRY → ENTRY or EXIT → EXIT, so it is refused as
--     `movement_not_last`;
--   * dependent rows are removed in the same transaction and named in the
--     audit row: `movement_driver_changes` (FK is ON DELETE RESTRICT, so the
--     delete would otherwise fail) and `entry_exit_photos`;
--   * the function returns the Storage object paths of the deleted photos —
--     including the legacy `entry_exit_logs.photo_url` — so the API route can
--     remove the objects AFTER the transaction committed. Storage is not
--     transactional; the database is the source of truth and a leftover
--     object is reported, never treated as a failed delete.
CREATE OR REPLACE FUNCTION public.admin_delete_movement(p_log_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log public.entry_exit_logs;
  v_later public.entry_exit_logs;
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_log.equipment_id::text || ':' || v_log.movement_context, 0)
  );

  SELECT l.* INTO v_later
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = v_log.equipment_id
    AND l.movement_context = v_log.movement_context
    AND (l.recorded_at, l.id) > (v_log.recorded_at, v_log.id)
  ORDER BY l.recorded_at, l.id
  LIMIT 1;

  IF FOUND THEN
    IF v_log.movement_type = 'entry' AND v_later.movement_type = 'exit' THEN
      RAISE EXCEPTION 'entry_has_later_exit'
        USING HINT = 'Delete the exit of this visit first.';
    END IF;
    RAISE EXCEPTION 'movement_not_last'
      USING HINT = 'Only the last movement of this equipment and context may be deleted.';
  END IF;

  SELECT COALESCE(array_agg(p.file_path ORDER BY p.sort_order, p.id), '{}')
  INTO v_paths
  FROM public.entry_exit_photos p
  WHERE p.entry_exit_log_id = p_log_id;

  IF NULLIF(btrim(v_log.photo_url), '') IS NOT NULL THEN
    v_paths := v_paths || btrim(v_log.photo_url);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.changed_at, c.id), '[]'::jsonb)
  INTO v_changes
  FROM public.movement_driver_changes c
  WHERE c.entry_log_id = p_log_id;

  IF jsonb_array_length(v_changes) > 0 THEN
    v_fields := v_fields || 'movement_driver_changes';
  END IF;
  IF cardinality(v_paths) > 0 THEN
    v_fields := v_fields || 'entry_exit_photos';
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

-- ---------------------------------------------------------------------------
-- 4. An admin may remove a `log-photos` object whose rows are already gone
-- ---------------------------------------------------------------------------
-- The API route deletes the Storage objects with the ADMIN'S OWN token right
-- after `admin_delete_movement` commits — there is no service-role client on
-- the server, so RLS stays authoritative for this cleanup too.
--
-- The policy of 0079 is recreated byte-for-byte with ONE added alternative.
-- Its last AND-group asks the object to still be reachable through a row:
-- an `entry_exit_photos` row, a movement id in the path, a legacy
-- `entry_exit_logs.photo_url`, or a pending upload batch. After a movement is
-- deleted NONE of those rows exist any more, so the very objects the admin
-- just orphaned would become undeletable. `OR public.is_admin()` closes that
-- gap: an admin may delete any object in this bucket, which is exactly the
-- reach `admin_delete_movement` already gives him over the rows.
--
-- Nothing else is relaxed:
--   * the policy is still scoped to `bucket_id = 'log-photos'`;
--   * `monitor` is still excluded;
--   * the uploader rule is untouched — a non-admin still needs BOTH his own
--     `auth.uid()` folder AND a row that `can_access_movement()` accepts;
--   * SELECT/INSERT/UPDATE on `storage.objects` are not touched at all.
DROP POLICY IF EXISTS delete_log_photos ON storage.objects;
CREATE POLICY delete_log_photos ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'log-photos'
  AND public.current_user_role() <> 'monitor'
  AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  AND (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.entry_exit_photos photo
      WHERE photo.file_path = name
        AND public.can_access_movement(photo.entry_exit_log_id)
    )
    OR public.can_access_movement(public.safe_uuid(split_part(name, '/', 2)))
    OR EXISTS (
      SELECT 1 FROM public.entry_exit_logs movement
      WHERE movement.photo_url = name
        AND public.can_access_movement(movement.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.pending_movement_photo_batches pending
      WHERE pending.id = public.safe_uuid(split_part(name, '/', 2))
        AND pending.uploaded_by = auth.uid()
        AND name = ANY(pending.file_paths)
    )
  )
);

COMMENT ON FUNCTION public.admin_delete_movement(uuid) IS
  'Admin-only delete of one movement. Refuses any row that is not the last movement of its (equipment, movement_context) sequence ordered by (recorded_at, id), removes its driver-change and photo rows in the same transaction, records them in movement_audit_logs, and returns the Storage paths the API route deletes afterwards.';

REVOKE ALL ON FUNCTION public.admin_delete_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_movement(uuid) TO authenticated;
