-- Migration 0133: hardening of the movement-photo Storage policies.
--
-- Source: the security audit run-1 (source-only, 2026-10-18 at 33ce47b),
-- group B "photos and Storage", reviewed by the product owner on 2026-10-18.
-- Four leads are closed here, each by re-creating the object it names and
-- keeping everything else verbatim. Lead B-9 (orphan Storage objects and a
-- periodic cleanup) is NOT part of this migration.
--
--   B-6   em:storage.objects:select:pending-batch-unbound-folder
--         select_log_photos (latest 0079): the pending-batch branch now also
--         requires the object to be in the caller's own folder.
--   B-7   em:storage.objects:update-delete:linked-evidence-unguarded
--         update_log_photos / delete_log_photos (latest 0127): a caller
--         without movements.photos.delete_any can no longer delete, move or
--         overwrite an object that an entry_exit_photos row still references,
--         and an UPDATE is bound to the movement or batch like an INSERT.
--   B-8   em:entry_exit_logs:insert:photo_url
--         a new BEFORE INSERT trigger clears the legacy photo_url on every
--         insert except the admin Excel import, and admin_delete_movement
--         (latest 0127) returns the legacy path for cleanup only when it is
--         in the movement's own folder.
--   B-10  em:pending_movement_photo_batches:insert:expires_at-client-controlled
--         two new triggers on pending_movement_photo_batches: expires_at is
--         always now() + 2 hours, every file path must be
--         <uploaded_by>/<batch id>/<file>, and a staged batch is immutable.
--
-- Nothing else changes: no other policy or function is redefined, the
-- SECURITY DEFINER functions keep search_path = public, pg_temp and their
-- grants, and no product flow is altered (the flows are walked through in
-- the section of each lead below).

-- ===========================================================================
-- B-10  pending_movement_photo_batches: server-side expiry and path shape
-- ===========================================================================
-- The staging table (0079) is written by POST /api/movements/photo-uploads
-- with the CALLER'S OWN token: {id, uploaded_by, file_paths, expected_files},
-- file_paths already shaped <uid>/<batch id>/<random>-<safe name>. Its INSERT
-- policy (0127) accepts any expires_at later than now() and any file_paths,
-- so a direct PostgREST insert could stage a batch that never expires, or one
-- whose paths name objects outside the caller's folder (the capability
-- behind B-6 and B-7 as well).
--
-- The BEFORE INSERT trigger below:
--   * overwrites expires_at with now() + interval '2 hours' (the 0079
--     column default) whatever the client sent, so the designed two-hour
--     staging window is the server's and the route's expiry cleanup reaches
--     every batch;
--   * refuses, with the stable code invalid_pending_photo_path (ERRCODE
--     23514), any element of file_paths that is not exactly
--     <uploaded_by>/<id>/<non-empty file name without a slash>, which is the
--     one shape enforce_movement_photo_path (0109) accepts when the batch is
--     later linked to a movement.
-- The BEFORE UPDATE trigger keeps id, uploaded_by, file_paths and expires_at
-- immutable (the table has no UPDATE policy; this is defence in depth, so a
-- future policy cannot reopen the window).
--
-- The route needs no change: it inserts the id it generated, its own uid and
-- paths of exactly that shape, and it never sets expires_at. The policy's
-- `expires_at > now()` clause stays verbatim and is now always true.

CREATE OR REPLACE FUNCTION public.enforce_pending_photo_batch_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefix text;
  v_path text;
  v_file text;
BEGIN
  -- The staging window is decided here, never by the client (B-10).
  NEW.expires_at := now() + interval '2 hours';

  -- Every staged path is <uploaded_by>/<batch id>/<file>: the uploader's own
  -- folder and this batch's folder, so a batch can only ever admit objects the
  -- uploader stages for it (B-6, B-7, B-10).
  v_prefix := NEW.uploaded_by::text || '/' || NEW.id::text || '/';
  FOREACH v_path IN ARRAY NEW.file_paths LOOP
    v_file := CASE
      WHEN v_path IS NOT NULL AND left(v_path, length(v_prefix)) = v_prefix
      THEN substr(v_path, length(v_prefix) + 1)
    END;
    IF v_file IS NULL OR v_file = '' OR position('/' IN v_file) > 0 THEN
      RAISE EXCEPTION 'invalid_pending_photo_path'
        USING ERRCODE = '23514',
              HINT = 'A staged photo path must be <uploader>/<batch id>/<file>.';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_pending_photo_batch_shape() IS
  '0133 (B-10): BEFORE INSERT trigger on pending_movement_photo_batches. Forces expires_at = now() + 2 hours and requires every file path to be <uploaded_by>/<batch id>/<file> (invalid_pending_photo_path, 23514).';

-- A trigger function is never called directly (0025).
REVOKE ALL ON FUNCTION public.enforce_pending_photo_batch_shape()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_pending_photo_batch_shape ON public.pending_movement_photo_batches;
CREATE TRIGGER enforce_pending_photo_batch_shape
  BEFORE INSERT ON public.pending_movement_photo_batches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pending_photo_batch_shape();

CREATE OR REPLACE FUNCTION public.protect_pending_photo_batch_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.file_paths IS DISTINCT FROM OLD.file_paths
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'pending_photo_batch_immutable'
      USING ERRCODE = '23514',
            HINT = 'A staged photo batch cannot be changed; delete it and stage a new one.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_pending_photo_batch_identity() IS
  '0133 (B-10): BEFORE UPDATE trigger on pending_movement_photo_batches. id, uploaded_by, file_paths and expires_at are immutable (pending_photo_batch_immutable, 23514).';

REVOKE ALL ON FUNCTION public.protect_pending_photo_batch_identity()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_pending_photo_batch_identity ON public.pending_movement_photo_batches;
CREATE TRIGGER protect_pending_photo_batch_identity
  BEFORE UPDATE ON public.pending_movement_photo_batches
  FOR EACH ROW EXECUTE FUNCTION public.protect_pending_photo_batch_identity();

-- ===========================================================================
-- B-6  select_log_photos: a staged batch admits the caller's own folder only
-- ===========================================================================
-- 0079 verbatim, plus ONE clause in the pending-batch branch:
--   (storage.foldername(name))[1] = auth.uid()::text
-- Before, a holder of movements.photos.manage could insert a batch whose id
-- equals path segment 2 of another user's object and whose file_paths lists
-- that exact name, and then read (or sign a URL for) an object that
-- can_access_movement denies. The photo-row branch and the legacy photo_url
-- branch are unchanged. Every product read passes as before: a batch's own
-- objects are always staged under the uploader's folder (B-10 above).

DROP POLICY IF EXISTS select_log_photos ON storage.objects;
CREATE POLICY select_log_photos ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'log-photos'
  AND (
    EXISTS (
      SELECT 1 FROM public.entry_exit_photos photo
      WHERE photo.file_path = name
        AND public.can_access_movement(photo.entry_exit_log_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.entry_exit_logs movement
      WHERE movement.photo_url = name
        AND public.can_access_movement(movement.id)
    )
    OR (
      (storage.foldername(name))[1] = auth.uid()::text
      AND EXISTS (
        SELECT 1 FROM public.pending_movement_photo_batches pending
        WHERE pending.id = public.safe_uuid(split_part(name, '/', 2))
          AND pending.uploaded_by = auth.uid()
          AND pending.expires_at > now()
          AND name = ANY(pending.file_paths)
      )
    )
  )
);
COMMENT ON POLICY select_log_photos ON storage.objects IS
  '0133 (B-6): 0079 verbatim plus the own-folder requirement in the pending-batch branch. A staged batch admits only objects in the caller''s own folder.';

-- ===========================================================================
-- B-7  update_log_photos / delete_log_photos: linked evidence stays
-- ===========================================================================
-- The database protects a saved photo only on its entry_exit_photos row
-- (protect_workshop_required_photo on DELETE, protect_movement_photo_identity
-- on UPDATE). The Storage policies did not apply those rules to the bytes:
--   * delete_log_photos (0127) let the uploader delete an object while a
--     photo row still referenced it (the first OR branch admitted exactly
--     that case), leaving a workshop movement whose required photo row points
--     at nothing;
--   * update_log_photos (0127) checked only the bucket, movements.photos.manage
--     and the folder, so the uploader could move a linked object to another
--     name, or overwrite it through an upsert, with no movement check at all.
--
-- Both policies now carry, for every caller WITHOUT movements.photos.delete_any:
--   NOT EXISTS (SELECT 1 FROM public.entry_exit_photos p
--               WHERE p.file_path = storage.objects.name)
-- i.e. the row must be gone before the bytes may go. update_log_photos also
-- gets the movement binding of insert_log_photos (0127): the caller's own
-- folder AND (can_write_movement_photos(segment 2) OR an own, unexpired
-- staged batch listing the name), in USING and in WITH CHECK, for every
-- caller. The rest of delete_log_photos is verbatim.
--
-- Why every product flow still passes (checked against the routes at 33ce47b):
--   * Uploads: every upload in the app uses upsert: false (signed upload URLs
--     and direct uploads), and no flow moves or copies an object, so the
--     UPDATE policy is not on any product path. Storage's own metadata write
--     after an upload runs as the service role and is not subject to RLS.
--   * DELETE /api/movements/[id]/photos (one photo): the route deletes the
--     entry_exit_photos row FIRST (delete_entry_exit_photos decides) and
--     removes the object AFTERWARDS. By then no row references the name,
--     the object is in the uploader's folder, and segment 2 is the movement,
--     which the uploader can access: the delete passes through
--     can_access_movement(segment 2) as before.
--   * DELETE /api/movements/[id] (whole movement): admin_delete_movement
--     deletes the photo rows and the movement inside ONE transaction and
--     returns the paths; the route then removes them with the caller's own
--     token. The admin holds delete_any and passes either way. A custom role
--     holding movements.edit_delete WITHOUT delete_any is refused only for an
--     object that a photo row still references, and after the RPC committed
--     no row references the returned paths any more, so its cleanup behaves
--     exactly as before (own-folder objects removed; objects uploaded by
--     another user were already outside its folder clause, and the route
--     reports storage_cleanup = 'pending' for them, as it did).
--   * POST /api/movements with staged batches, link failure: the route
--     removes the staged objects (no row was created, the batch row still
--     exists): the pending-batch branch admits them as before.
--   * POST and DELETE /api/movements/photo-uploads (expired or abandoned
--     batches): the batch row still exists while the objects are removed:
--     the pending-batch branch admits them as before.
--   * POST /api/movements/[id]/photos, link failure after a signed upload:
--     the object has no row and lies under <uid>/<movement id>/, so
--     can_access_movement(segment 2) admits its removal as before.

DROP POLICY IF EXISTS update_log_photos ON storage.objects;
CREATE POLICY update_log_photos ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'log-photos'
  AND (SELECT public.has_permission('movements.photos.manage'))
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    (SELECT public.has_permission('movements.photos.delete_any'))
    OR NOT EXISTS (
      SELECT 1
      FROM public.entry_exit_photos p
      WHERE p.file_path = storage.objects.name
    )
  )
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
)
WITH CHECK (
  bucket_id = 'log-photos'
  AND (SELECT public.has_permission('movements.photos.manage'))
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    (SELECT public.has_permission('movements.photos.delete_any'))
    OR NOT EXISTS (
      SELECT 1
      FROM public.entry_exit_photos p
      WHERE p.file_path = storage.objects.name
    )
  )
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
COMMENT ON POLICY update_log_photos ON storage.objects IS
  '0133 (B-7): without movements.photos.delete_any an object still referenced by an entry_exit_photos row cannot be updated; every update is bound to the caller''s own folder and to the movement or staged batch of path segment 2, like insert_log_photos (0127).';

DROP POLICY IF EXISTS delete_log_photos ON storage.objects;
CREATE POLICY delete_log_photos ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'log-photos'
  AND (SELECT public.has_permission('movements.photos.manage'))
  AND ((storage.foldername(name))[1] = auth.uid()::text OR (SELECT public.has_permission('movements.photos.delete_any')))
  AND (
    (SELECT public.has_permission('movements.photos.delete_any'))
    OR NOT EXISTS (
      SELECT 1
      FROM public.entry_exit_photos p
      WHERE p.file_path = storage.objects.name
    )
  )
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
  '0133 (B-7): 0127 verbatim plus, without movements.photos.delete_any, the object must no longer be referenced by any entry_exit_photos row (the row goes first, then the bytes).';

-- ===========================================================================
-- B-8  entry_exit_logs.photo_url: never client-written, never a foreign path
-- ===========================================================================
-- The legacy column (pre-0031) was still writable on INSERT: the policy
-- insert_entry_exit_logs checks only supervisor_id, no trigger read
-- NEW.photo_url and no column privilege was revoked. Three consumers treat
-- the value as a Storage path that belongs to the movement (the SELECT and
-- DELETE policies above, MovementDetail, and admin_delete_movement, whose
-- returned paths DELETE /api/movements/[id] removes with the admin's token):
-- a row inserted directly through PostgREST with another movement's object
-- name in photo_url turned the admin into a confused deputy that destroyed
-- that evidence.
--
-- Checked at 33ce47b: no client, API route or Edge Function writes photo_url
-- (src/, app/, supabase/functions/ only read it), and no SQL insert path does
-- either (import_movement_rows, add_workshop_opening_balance, the one-time
-- 0066 row). entry_exit_logs has no UPDATE policy (0093), and
-- admin_update_movement does not touch the column, so BEFORE INSERT is the
-- whole surface.
--
-- The trigger below sets NEW.photo_url := NULL on every insert, except when
-- the transaction-local marker of the admin Excel import
-- (app.movement_excel_import = 'true', set only by import_movement_rows) is
-- present together with has_permission('movements.import'), the same
-- predicate as 0108, 0115 and 0120. Clients cannot set that GUC through
-- PostgREST. Existing rows are untouched; a genuine legacy photo keeps
-- displaying. It fires before enforce_movement_sequence (name order), reads
-- and writes photo_url only, and takes no lock. enforce_movement_sequence is
-- NOT redefined.

CREATE OR REPLACE FUNCTION public.enforce_movement_photo_url()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.photo_url IS NULL THEN
    RETURN NEW;
  END IF;

  -- The admin Excel import (0063) is the one path allowed to carry a legacy
  -- value: the transaction-local marker set by public.import_movement_rows
  -- AND the import permission of the caller.
  IF current_setting('app.movement_excel_import', true) = 'true'
     AND public.has_permission('movements.import') THEN
    RETURN NEW;
  END IF;

  NEW.photo_url := NULL;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_movement_photo_url() IS
  '0133 (B-8): BEFORE INSERT trigger on entry_exit_logs. Clears the legacy photo_url on every insert except the admin Excel import marked by app.movement_excel_import together with movements.import. Fires before enforce_movement_sequence (name order); touches photo_url only.';

-- A trigger function is never called directly (0025).
REVOKE ALL ON FUNCTION public.enforce_movement_photo_url()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_movement_photo_url ON public.entry_exit_logs;
CREATE TRIGGER enforce_movement_photo_url
  BEFORE INSERT ON public.entry_exit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_movement_photo_url();

-- admin_delete_movement: 0127 verbatim (sequence check, advisory lock, audit
-- rows, cascade, grants), with ONE change in the photo_url block: the legacy
-- path is appended to the returned cleanup list only when
--   split_part(photo_url, '/', 1) = supervisor_id  AND
--   split_part(photo_url, '/', 2) = the movement id,
-- i.e. the object lies in this movement's own folder. A legacy value of any
-- other shape is not returned and stays in Storage (B-9 territory).
-- admin_delete_movement: latest 0127; movements.edit_delete.
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

NOTIFY pgrst, 'reload schema';
