/* Securely stage movement photos before the movement row is created. */

CREATE TABLE public.pending_movement_photo_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_paths text[] NOT NULL,
  expected_files jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_movement_photo_batches_count_check
    CHECK (cardinality(file_paths) BETWEEN 1 AND 3),
  CONSTRAINT pending_movement_photo_batches_expected_files_check
    CHECK (jsonb_typeof(expected_files) = 'array' AND jsonb_array_length(expected_files) = cardinality(file_paths))
);

ALTER TABLE public.pending_movement_photo_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_own_pending_movement_photo_batches
  ON public.pending_movement_photo_batches FOR SELECT TO authenticated
  USING (uploaded_by = auth.uid());

CREATE POLICY insert_own_pending_movement_photo_batches
  ON public.pending_movement_photo_batches FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.current_user_role() <> 'monitor'
    AND expires_at > now()
  );

CREATE POLICY delete_own_pending_movement_photo_batches
  ON public.pending_movement_photo_batches FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid());

CREATE INDEX pending_movement_photo_batches_expiry_idx
  ON public.pending_movement_photo_batches(expires_at);

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
    OR EXISTS (
      SELECT 1 FROM public.pending_movement_photo_batches pending
      WHERE pending.id = public.safe_uuid(split_part(name, '/', 2))
        AND pending.uploaded_by = auth.uid()
        AND pending.expires_at > now()
        AND name = ANY(pending.file_paths)
    )
  )
);

DROP POLICY IF EXISTS insert_log_photos ON storage.objects;
CREATE POLICY insert_log_photos ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'log-photos'
  AND public.current_user_role() <> 'monitor'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    public.can_access_movement(public.safe_uuid(split_part(name, '/', 2)))
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

DROP POLICY IF EXISTS delete_log_photos ON storage.objects;
CREATE POLICY delete_log_photos ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'log-photos'
  AND public.current_user_role() <> 'monitor'
  AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  AND (
    EXISTS (
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
