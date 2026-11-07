-- 0183: the documents of suppliers and clients take files up to 5 MB.
--
-- Owner 2026-11-07, after 0182 was applied: «خلي الحد الاقصى 5 ميقا» (was
-- 10 MB, the movement-photo limit).
--
-- What this migration does
--   * The bucket `party-documents` refuses a file over 5 MB (5242880 bytes);
--     its types stay PDF, JPEG, PNG and WEBP.
--   * The CHECK party_documents_size_bytes_check becomes 1 … 5242880. It is
--     added NOT VALID so a file stored under the 10 MB limit of 0182 (if
--     any was uploaded meanwhile) keeps its row; every new upload and every
--     replacement is checked.
--   No policy, function or other column changes. MUST be applied AFTER 0182.

UPDATE storage.buckets
SET file_size_limit = 5242880
WHERE id = 'party-documents';

ALTER TABLE public.party_documents
  DROP CONSTRAINT IF EXISTS party_documents_size_bytes_check;
ALTER TABLE public.party_documents
  ADD CONSTRAINT party_documents_size_bytes_check
    CHECK (size_bytes BETWEEN 1 AND 5242880) NOT VALID;

COMMENT ON CONSTRAINT party_documents_size_bytes_check ON public.party_documents IS
  '0183: a document is at most 5 MB (owner 2026-11-07). NOT VALID: a row stored under the 10 MB limit of 0182 stays; new rows and replacements are checked.';

NOTIFY pgrst, 'reload schema';
