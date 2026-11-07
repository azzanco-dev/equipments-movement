-- 0182: documents of suppliers and clients («المستندات»).
--
-- Owner 2026-11-07: «نبغى نضيف امكانية رفع الملفات pdf او صور في معلومات
-- الموردين والشركات مثل السجل التجاري شهادة الضريبة شهادة الايبان العنوان
-- الوطني». Approved on /ui-kit «مستندات الموردين والشركات» after his review
-- («بدون تاريخ الانتهاء … وبدون تاريخ الرفع ومين رفعه»: no expiry column,
-- the uploader and the time are stored for the record but not shown), and
-- the flow «الاولى ونفذ»: a file is saved the moment it is uploaded, and a
-- new supplier or client is saved first, then its details open on the
-- documents.
--
-- What this migration does
--   * The PRIVATE Storage bucket `party-documents`: 10 MB per file, PDF,
--     JPEG, PNG and WEBP only. Objects live at
--       lessor/<lessor id>/<random uuid>.<ext>
--       company/<company id>/<random uuid>.<ext>
--   * The table public.party_documents: one row per stored file, for exactly
--     one supplier (`lessor_id`) or one client (`company_id`), with its type:
--       commercial_register («السجل التجاري»), tax_certificate («شهادة
--       الضريبة»), iban_certificate («شهادة الايبان», suppliers only — the
--       clients have no IBAN since 0175), national_address («العنوان
--       الوطني») — at most ONE current file of each per party (partial
--       unique indexes; a replacement UPDATEs the row) — and `other`
--       («مستندات اخرى»): any number, each named by `title` (required,
--       1–100 characters; NULL for the fixed types).
--     The file facts: `storage_path` (unique, inside the party's folder),
--     `file_name` (1–255), `mime_type` (the bucket's four), `size_bytes`
--     (1 … 10 MB). `uploaded_by` (the caller, set by the trigger),
--     `created_at`, `updated_at` with the usual update_updated_at() trigger.
--     The party foreign keys are ON DELETE RESTRICT: a supplier or a client
--     that still has documents is not deleted (the screens say «احذف
--     المستندات اولا»), so no file is ever left without its row.
--   * RLS on the table:
--       read   lessors.read OR lessors.edit (a supplier's documents),
--              companies_projects.read OR companies_projects.edit (a client's)
--       insert / update / delete   lessors.edit / companies_projects.edit
--     No new permission key.
--   * The BEFORE INSERT OR UPDATE trigger enforce_party_document_row():
--     `uploaded_by` := auth.uid() on insert and whenever the file changes,
--     the party and the type never change on update, and the stored path
--     must lie in the party's own folder (`lessor/<lessor_id>/…`).
--   * Storage policies on storage.objects for this bucket only, through
--     three narrowly scoped SECURITY DEFINER helpers (fixed search_path,
--     authenticated only):
--       select  can_read_party_document_object(name): a row of the table
--               stores this path and the caller may read that party's
--               documents (signed URLs need it), or the caller holds the
--               folder kind's edit key (Storage reads an object back when it
--               uploads or removes it);
--       insert  can_upload_party_document_object(name): the path is
--               <kind>/<existing party id>/<file> and the caller holds the
--               kind's edit key;
--       delete  can_delete_party_document_object(name): the same edit key
--               and NO row stores the path any more (a file is removed only
--               after its row was deleted or pointed to the replacement).
--     No update policy: a stored file is never overwritten.
--   The client uploads the file first, then writes the row; if the row is
--   refused it removes the file it just uploaded (still unreferenced, so
--   the delete policy allows it).

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'party-documents',
  'party-documents',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.party_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lessor_id uuid REFERENCES public.lessors(id) ON DELETE RESTRICT,
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  doc_type text NOT NULL,
  title text,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_documents_one_party_check
    CHECK ((lessor_id IS NULL) <> (company_id IS NULL)),
  CONSTRAINT party_documents_doc_type_check
    CHECK (doc_type IN (
      'commercial_register',
      'tax_certificate',
      'iban_certificate',
      'national_address',
      'other'
    )),
  CONSTRAINT party_documents_iban_supplier_check
    CHECK (doc_type <> 'iban_certificate' OR lessor_id IS NOT NULL),
  CONSTRAINT party_documents_title_check
    CHECK (
      (doc_type = 'other' AND title IS NOT NULL AND char_length(btrim(title)) BETWEEN 1 AND 100)
      OR (doc_type <> 'other' AND title IS NULL)
    ),
  CONSTRAINT party_documents_storage_path_key UNIQUE (storage_path),
  CONSTRAINT party_documents_file_name_check
    CHECK (char_length(file_name) BETWEEN 1 AND 255),
  CONSTRAINT party_documents_mime_type_check
    CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT party_documents_size_bytes_check
    CHECK (size_bytes BETWEEN 1 AND 10485760)
);

COMMENT ON TABLE public.party_documents IS
  '0182: the documents of a supplier (lessor_id) or a client (company_id): one current file per fixed type, any number of named «other» documents. The file lives in the private bucket party-documents at storage_path. Written by the screens under RLS (lessors.edit / companies_projects.edit).';

CREATE UNIQUE INDEX IF NOT EXISTS party_documents_lessor_type_unique
  ON public.party_documents (lessor_id, doc_type)
  WHERE lessor_id IS NOT NULL AND doc_type <> 'other';
CREATE UNIQUE INDEX IF NOT EXISTS party_documents_company_type_unique
  ON public.party_documents (company_id, doc_type)
  WHERE company_id IS NOT NULL AND doc_type <> 'other';
CREATE INDEX IF NOT EXISTS party_documents_lessor_idx
  ON public.party_documents (lessor_id, created_at)
  WHERE lessor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS party_documents_company_idx
  ON public.party_documents (company_id, created_at)
  WHERE company_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_party_documents_updated_at ON public.party_documents;
CREATE TRIGGER set_party_documents_updated_at
BEFORE UPDATE ON public.party_documents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------------------
-- Row rules
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_party_document_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_folder text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.lessor_id IS DISTINCT FROM OLD.lessor_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.doc_type IS DISTINCT FROM OLD.doc_type THEN
      RAISE EXCEPTION 'party_document_identity_locked'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
      NEW.uploaded_by := auth.uid();
    ELSE
      NEW.uploaded_by := OLD.uploaded_by;
    END IF;
  ELSE
    NEW.uploaded_by := auth.uid();
    NEW.created_at := now();
  END IF;

  NEW.title := nullif(btrim(NEW.title), '');
  v_folder := CASE
    WHEN NEW.lessor_id IS NOT NULL THEN 'lessor/' || NEW.lessor_id::text || '/'
    ELSE 'company/' || NEW.company_id::text || '/'
  END;
  IF NEW.storage_path IS NULL
     OR left(NEW.storage_path, char_length(v_folder)) <> v_folder
     OR position('/' IN substr(NEW.storage_path, char_length(v_folder) + 1)) > 0
     OR char_length(NEW.storage_path) = char_length(v_folder) THEN
    RAISE EXCEPTION 'party_document_path_invalid'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_party_document_row() IS
  '0182: BEFORE INSERT OR UPDATE on party_documents: uploaded_by is the caller (on insert and when the file changes), the party and the type never change, and storage_path is one file directly inside lessor/<lessor_id>/ or company/<company_id>/.';

REVOKE ALL ON FUNCTION public.enforce_party_document_row()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_party_document_row ON public.party_documents;
CREATE TRIGGER enforce_party_document_row
BEFORE INSERT OR UPDATE ON public.party_documents
FOR EACH ROW EXECUTE FUNCTION public.enforce_party_document_row();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.party_documents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.party_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_documents TO authenticated;

DROP POLICY IF EXISTS select_party_documents ON public.party_documents;
CREATE POLICY select_party_documents ON public.party_documents
FOR SELECT TO authenticated
USING (
  (lessor_id IS NOT NULL AND (
    (SELECT public.has_permission('lessors.read'))
    OR (SELECT public.has_permission('lessors.edit'))
  ))
  OR (company_id IS NOT NULL AND (
    (SELECT public.has_permission('companies_projects.read'))
    OR (SELECT public.has_permission('companies_projects.edit'))
  ))
);

DROP POLICY IF EXISTS insert_party_documents ON public.party_documents;
CREATE POLICY insert_party_documents ON public.party_documents
FOR INSERT TO authenticated
WITH CHECK (
  (lessor_id IS NOT NULL AND (SELECT public.has_permission('lessors.edit')))
  OR (company_id IS NOT NULL AND (SELECT public.has_permission('companies_projects.edit')))
);

DROP POLICY IF EXISTS update_party_documents ON public.party_documents;
CREATE POLICY update_party_documents ON public.party_documents
FOR UPDATE TO authenticated
USING (
  (lessor_id IS NOT NULL AND (SELECT public.has_permission('lessors.edit')))
  OR (company_id IS NOT NULL AND (SELECT public.has_permission('companies_projects.edit')))
)
WITH CHECK (
  (lessor_id IS NOT NULL AND (SELECT public.has_permission('lessors.edit')))
  OR (company_id IS NOT NULL AND (SELECT public.has_permission('companies_projects.edit')))
);

DROP POLICY IF EXISTS delete_party_documents ON public.party_documents;
CREATE POLICY delete_party_documents ON public.party_documents
FOR DELETE TO authenticated
USING (
  (lessor_id IS NOT NULL AND (SELECT public.has_permission('lessors.edit')))
  OR (company_id IS NOT NULL AND (SELECT public.has_permission('companies_projects.edit')))
);

-- ---------------------------------------------------------------------------
-- Storage helpers
-- ---------------------------------------------------------------------------

-- The edit key of a folder kind; NULL for anything else.
CREATE OR REPLACE FUNCTION public.party_document_edit_key(p_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_kind
    WHEN 'lessor' THEN 'lessors.edit'
    WHEN 'company' THEN 'companies_projects.edit'
  END;
$$;

REVOKE ALL ON FUNCTION public.party_document_edit_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.party_document_edit_key(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_upload_party_document_object(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parts text[] := string_to_array(p_name, '/');
  v_key text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR cardinality(v_parts) <> 3 OR v_parts[3] = '' THEN
    RETURN false;
  END IF;
  v_key := public.party_document_edit_key(v_parts[1]);
  IF v_key IS NULL OR NOT public.has_permission(v_key) THEN
    RETURN false;
  END IF;
  BEGIN
    v_id := v_parts[2]::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  IF v_parts[1] = 'lessor' THEN
    RETURN EXISTS (SELECT 1 FROM public.lessors WHERE id = v_id);
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.companies WHERE id = v_id);
END;
$$;

COMMENT ON FUNCTION public.can_upload_party_document_object(text) IS
  '0182: the storage INSERT rule of bucket party-documents: <lessor|company>/<existing party id>/<file> and the caller holds lessors.edit / companies_projects.edit.';

REVOKE ALL ON FUNCTION public.can_upload_party_document_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_party_document_object(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_read_party_document_object(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.party_documents d
      WHERE d.storage_path = p_name
        AND (
          (d.lessor_id IS NOT NULL
            AND (public.has_permission('lessors.read') OR public.has_permission('lessors.edit')))
          OR (d.company_id IS NOT NULL
            AND (public.has_permission('companies_projects.read')
              OR public.has_permission('companies_projects.edit')))
        )
    )
    -- The edit key of the folder kind: Storage reads the object back when
    -- it uploads (INSERT … RETURNING) and when it removes one (DELETE …
    -- RETURNING), before or after any row stores the path.
    OR COALESCE(
      public.has_permission(public.party_document_edit_key(split_part(p_name, '/', 1))),
      false
    )
  );
$$;

COMMENT ON FUNCTION public.can_read_party_document_object(text) IS
  '0182: the storage SELECT rule of bucket party-documents: a party_documents row stores this path and the caller may read that supplier''s or client''s documents, or the caller holds the folder kind''s edit key (Storage reads an object back on upload and removal).';

REVOKE ALL ON FUNCTION public.can_read_party_document_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_party_document_object(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_delete_party_document_object(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.party_document_edit_key(split_part(p_name, '/', 1)) IS NOT NULL
    AND public.has_permission(public.party_document_edit_key(split_part(p_name, '/', 1)))
    AND NOT EXISTS (
      SELECT 1 FROM public.party_documents d WHERE d.storage_path = p_name
    );
$$;

COMMENT ON FUNCTION public.can_delete_party_document_object(text) IS
  '0182: the storage DELETE rule of bucket party-documents: the caller holds the folder kind''s edit key and no party_documents row stores the path (a file is removed only after its row is gone or points to the replacement).';

REVOKE ALL ON FUNCTION public.can_delete_party_document_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_delete_party_document_object(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Storage policies (this bucket only)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS select_party_documents_objects ON storage.objects;
CREATE POLICY select_party_documents_objects ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'party-documents'
  AND public.can_read_party_document_object(name)
);

DROP POLICY IF EXISTS insert_party_documents_objects ON storage.objects;
CREATE POLICY insert_party_documents_objects ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'party-documents'
  AND public.can_upload_party_document_object(name)
);

DROP POLICY IF EXISTS delete_party_documents_objects ON storage.objects;
CREATE POLICY delete_party_documents_objects ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'party-documents'
  AND public.can_delete_party_document_object(name)
);

NOTIFY pgrst, 'reload schema';
