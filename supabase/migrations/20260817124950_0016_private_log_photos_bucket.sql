UPDATE storage.buckets SET public = false WHERE id = 'log-photos';

DROP POLICY IF EXISTS select_log_photos ON storage.objects;
CREATE POLICY select_log_photos ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'log-photos'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  );