-- 0206: the transfer receipt of an installment payment («ملف الحوالة»).
--
-- Owner 2026-11-19: «تضيف رفع ملف الحوالة في سداد القسط». A payment may
-- carry ONE file (PDF or image) that is opened later from the contract
-- page. The pattern is the party documents of 0182 (private bucket, narrow
-- SECURITY DEFINER storage helpers, signed URLs only), with two changes:
-- the payments table has no write policy (0203), so the receipt row is
-- written only through two SECURITY DEFINER functions; and the file is
-- attached AFTER the payment is saved (the path names the payment), so a
-- failed upload never undoes a payment — the receipt can be attached later
-- from the payment card.
--
-- What this migration does
--   * The PRIVATE Storage bucket `installment-receipts`: 5 MB per file
--     (the owner's limit for documents, 0183), PDF, JPEG, PNG and WEBP.
--     Objects live at <contract id>/<payment id>/<random uuid>.<ext>.
--   * The table public.installment_payment_receipts: at most ONE current
--     file per payment (UNIQUE payment_id; a replacement UPDATEs the row),
--     `storage_path` (unique, inside the payment's folder), `file_name`
--     (1–255), `mime_type` (the bucket's four), `size_bytes` (1 … 5 MB),
--     `uploaded_by`, `created_at`, `updated_at` with update_updated_at().
--     Read by installments.view; NO write policy.
--   * set_installment_payment_receipt(payment, path, name, mime, size):
--     installments.manage; the payment must be POSTED (a voided payment
--     keeps its file as it is: payment_already_voided), the path must be
--     <its contract>/<it>/<file> and the object must already be stored in
--     the bucket (receipt_file_missing). Inserts or replaces the row and
--     returns the path it replaced (NULL when none), which the client then
--     removes from Storage.
--   * remove_installment_payment_receipt(payment): installments.manage, a
--     posted payment with a receipt (receipt_not_found); deletes the row
--     and returns its path for the client to remove.
--   * Storage policies on storage.objects for this bucket only:
--       select  can_read_installment_receipt_object(name): installments.view
--               (every reader of the installments sees every payment);
--       insert  can_upload_installment_receipt_object(name): the path is
--               <contract>/<posted payment of that contract>/<file> and the
--               caller holds installments.manage;
--       delete  can_delete_installment_receipt_object(name):
--               installments.manage and NO row stores the path.
--     No update policy: a stored file is never overwritten.
--   * installment_payment_list is re-created with the receipt columns
--     appended (CREATE OR REPLACE: the earlier columns stay in place).
--
-- Tokens: installments_manage_required (42501); invalid_payment,
-- invalid_receipt (22023); payment_already_voided, receipt_file_missing,
-- receipt_not_found (55000).
--
-- Nothing else changes: record_installment_payment, the void, the views of
-- the dashboard and the daily reminder (0205) are untouched.

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'installment-receipts',
  'installment-receipts',
  false,
  5242880,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE public.installment_payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL
    REFERENCES public.installment_payments(id) ON DELETE RESTRICT,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installment_payment_receipts_payment_key UNIQUE (payment_id),
  CONSTRAINT installment_payment_receipts_storage_path_key UNIQUE (storage_path),
  CONSTRAINT installment_payment_receipts_file_name_check
    CHECK (char_length(file_name) BETWEEN 1 AND 255),
  CONSTRAINT installment_payment_receipts_mime_type_check
    CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT installment_payment_receipts_size_bytes_check
    CHECK (size_bytes BETWEEN 1 AND 5242880)
);

COMMENT ON TABLE public.installment_payment_receipts IS
  '0206: the transfer receipt of an installment payment, one current file per payment, stored in the private bucket installment-receipts at storage_path. Read by installments.view; written only by set_installment_payment_receipt / remove_installment_payment_receipt.';

CREATE TRIGGER installment_payment_receipts_updated_at
  BEFORE UPDATE ON public.installment_payment_receipts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.installment_payment_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_installment_payment_receipts
  ON public.installment_payment_receipts
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('installments.view')));

REVOKE ALL ON public.installment_payment_receipts FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.installment_payment_receipts
  FROM authenticated;
GRANT SELECT ON public.installment_payment_receipts TO authenticated;

-- ---------------------------------------------------------------------------
-- Writers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_installment_payment_receipt(
  p_payment_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.installment_payments%ROWTYPE;
  v_name text := btrim(COALESCE(p_file_name, ''));
  v_old text;
BEGIN
  PERFORM public.assert_installments_manage();

  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_payment
  FROM public.installment_payments
  WHERE id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;
  IF v_payment.status <> 'posted' THEN
    RAISE EXCEPTION 'payment_already_voided' USING ERRCODE = '55000';
  END IF;

  IF p_storage_path IS NULL
     OR cardinality(string_to_array(p_storage_path, '/')) <> 3
     OR split_part(p_storage_path, '/', 1) <> v_payment.contract_id::text
     OR split_part(p_storage_path, '/', 2) <> v_payment.id::text
     OR split_part(p_storage_path, '/', 3) = ''
     OR char_length(v_name) NOT BETWEEN 1 AND 255
     OR p_mime_type IS NULL
     OR p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
     OR p_size_bytes IS NULL
     OR p_size_bytes NOT BETWEEN 1 AND 5242880 THEN
    RAISE EXCEPTION 'invalid_receipt' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'installment-receipts' AND o.name = p_storage_path
  ) THEN
    RAISE EXCEPTION 'receipt_file_missing' USING ERRCODE = '55000';
  END IF;

  SELECT storage_path INTO v_old
  FROM public.installment_payment_receipts
  WHERE payment_id = p_payment_id;

  IF v_old = p_storage_path THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.installment_payment_receipts (
    payment_id, storage_path, file_name, mime_type, size_bytes, uploaded_by
  )
  VALUES (p_payment_id, p_storage_path, v_name, p_mime_type, p_size_bytes, auth.uid())
  ON CONFLICT (payment_id) DO UPDATE
  SET storage_path = EXCLUDED.storage_path,
      file_name = EXCLUDED.file_name,
      mime_type = EXCLUDED.mime_type,
      size_bytes = EXCLUDED.size_bytes,
      uploaded_by = EXCLUDED.uploaded_by;

  RETURN v_old;
END;
$$;

COMMENT ON FUNCTION public.set_installment_payment_receipt(uuid, text, text, text, integer) IS
  '0206: attaches (or replaces) the transfer receipt of a POSTED payment; the file must already be stored at <contract>/<payment>/<file> in bucket installment-receipts. installments.manage. Returns the replaced path (NULL when none) for the client to remove.';

REVOKE ALL ON FUNCTION public.set_installment_payment_receipt(uuid, text, text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_installment_payment_receipt(uuid, text, text, text, integer)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_installment_payment_receipt(p_payment_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_path text;
BEGIN
  PERFORM public.assert_installments_manage();

  SELECT status INTO v_status
  FROM public.installment_payments
  WHERE id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'posted' THEN
    RAISE EXCEPTION 'payment_already_voided' USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.installment_payment_receipts
  WHERE payment_id = p_payment_id
  RETURNING storage_path INTO v_path;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'receipt_not_found' USING ERRCODE = '55000';
  END IF;

  RETURN v_path;
END;
$$;

COMMENT ON FUNCTION public.remove_installment_payment_receipt(uuid) IS
  '0206: removes the transfer receipt of a POSTED payment and returns its path for the client to remove from Storage. installments.manage.';

REVOKE ALL ON FUNCTION public.remove_installment_payment_receipt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_installment_payment_receipt(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Storage helpers and policies (this bucket only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_read_installment_receipt_object(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND public.has_permission('installments.view');
$$;

COMMENT ON FUNCTION public.can_read_installment_receipt_object(text) IS
  '0206: the storage SELECT rule of bucket installment-receipts: installments.view (signed URLs, and the read-back of an upload or a removal by a manager).';

REVOKE ALL ON FUNCTION public.can_read_installment_receipt_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_installment_receipt_object(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_upload_installment_receipt_object(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parts text[] := string_to_array(p_name, '/');
  v_contract uuid;
  v_payment uuid;
BEGIN
  IF auth.uid() IS NULL OR cardinality(v_parts) <> 3 OR v_parts[3] = '' THEN
    RETURN false;
  END IF;
  IF NOT public.has_permission('installments.manage') THEN
    RETURN false;
  END IF;
  BEGIN
    v_contract := v_parts[1]::uuid;
    v_payment := v_parts[2]::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  RETURN EXISTS (
    SELECT 1 FROM public.installment_payments p
    WHERE p.id = v_payment AND p.contract_id = v_contract AND p.status = 'posted'
  );
END;
$$;

COMMENT ON FUNCTION public.can_upload_installment_receipt_object(text) IS
  '0206: the storage INSERT rule of bucket installment-receipts: <contract id>/<posted payment of that contract>/<file> and the caller holds installments.manage.';

REVOKE ALL ON FUNCTION public.can_upload_installment_receipt_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_installment_receipt_object(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_delete_installment_receipt_object(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.has_permission('installments.manage')
    AND NOT EXISTS (
      SELECT 1 FROM public.installment_payment_receipts r WHERE r.storage_path = p_name
    );
$$;

COMMENT ON FUNCTION public.can_delete_installment_receipt_object(text) IS
  '0206: the storage DELETE rule of bucket installment-receipts: installments.manage and no receipt row stores the path (a file is removed only after its row is gone or points to the replacement).';

REVOKE ALL ON FUNCTION public.can_delete_installment_receipt_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_delete_installment_receipt_object(text) TO authenticated;

DROP POLICY IF EXISTS select_installment_receipts_objects ON storage.objects;
CREATE POLICY select_installment_receipts_objects ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'installment-receipts'
  AND public.can_read_installment_receipt_object(name)
);

DROP POLICY IF EXISTS insert_installment_receipts_objects ON storage.objects;
CREATE POLICY insert_installment_receipts_objects ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'installment-receipts'
  AND public.can_upload_installment_receipt_object(name)
);

DROP POLICY IF EXISTS delete_installment_receipts_objects ON storage.objects;
CREATE POLICY delete_installment_receipts_objects ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'installment-receipts'
  AND public.can_delete_installment_receipt_object(name)
);

-- ---------------------------------------------------------------------------
-- The payments list with its receipt (columns appended)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.installment_payment_list
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.contract_id,
  p.paid_on,
  p.amount,
  p.method,
  p.reference,
  p.note,
  p.status,
  p.voided_at,
  p.voided_by,
  vb.full_name AS voided_by_name,
  p.void_reason,
  p.created_by,
  cb.full_name AS created_by_name,
  p.created_at,
  r.id AS receipt_id,
  r.storage_path AS receipt_path,
  r.file_name AS receipt_file_name,
  r.mime_type AS receipt_mime_type,
  r.size_bytes AS receipt_size_bytes
FROM public.installment_payments p
LEFT JOIN public.profile_names cb ON cb.id = p.created_by
LEFT JOIN public.profile_names vb ON vb.id = p.voided_by
LEFT JOIN public.installment_payment_receipts r ON r.payment_id = p.id;

COMMENT ON VIEW public.installment_payment_list IS
  '0203, receipt columns 0206: the payments with who recorded and who voided each (profile_names) and the transfer receipt when attached. The payments list of the contract page. security_invoker: installments.view through the table policies.';

NOTIFY pgrst, 'reload schema';
