DROP POLICY IF EXISTS update_log_photos ON storage.objects;
CREATE POLICY update_log_photos ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'log-photos'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  )
  WITH CHECK (
    bucket_id = 'log-photos'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  );

DROP POLICY IF EXISTS delete_log_photos ON storage.objects;
CREATE POLICY delete_log_photos ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'log-photos'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  );

DROP POLICY IF EXISTS insert_log_photos ON storage.objects;
CREATE POLICY insert_log_photos ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'log-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );