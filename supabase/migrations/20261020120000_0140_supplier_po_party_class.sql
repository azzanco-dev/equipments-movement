-- 0140: `party_class(supplier_pos)`, the PO's party as an owner class for
-- the list filter.
--
-- Owner 2026-10-20: the PO list filters «المالك ثم المورد» like the movement
-- log — an owner filter (Al-Azani / Takween / F / B / external supplier)
-- and, only while it selects the external supplier, the supplier filter.
-- A PO addressed to a lessor has `owner_class` NULL, so the list needs one
-- filterable value: this PostgREST computed column returns `owner_class`,
-- or 'external_supplier' for a lessor party. Runs as the caller; it reads
-- the row it is given and nothing else.

CREATE OR REPLACE FUNCTION public.party_class(po public.supplier_pos)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(po.owner_class, 'external_supplier');
$$;

COMMENT ON FUNCTION public.party_class(public.supplier_pos) IS
  '0140: PostgREST computed column of supplier_pos — the party as an owner class (alazani / takween / third_party_f / third_party_partnership_b), or ''external_supplier'' for a PO addressed to a lessor. The «المالك» filter of the PO list.';

REVOKE ALL ON FUNCTION public.party_class(public.supplier_pos) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.party_class(public.supplier_pos) TO authenticated;
