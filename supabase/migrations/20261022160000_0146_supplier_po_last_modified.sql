-- 0146: `last_modified_at(supplier_pos)`, the time of a PO's latest change
-- for the «اخر تعديل» column of the PO list.
--
-- Owner 2026-10-22: «اضف عمود اخر تعديل لاوامر الشراء». `supplier_pos` has
-- no updated_at, and most changes of a PO are on its lines (a unit added, a
-- price or note edited) or on the PO itself (start date / notes, closing).
-- Every one of them writes an event to the append-only `supplier_po_events`
-- (0136, 0142), `created` included, so the latest event IS the last change.
-- The PO's own created_at is the fallback for a PO without events. Runs as
-- the caller: the events are read under their own RLS (purchasing.view, the
-- same key that reads the list). Served by supplier_po_events_po_idx
-- (supplier_po_id, created_at).

CREATE OR REPLACE FUNCTION public.last_modified_at(po public.supplier_pos)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT max(e.created_at)
     FROM public.supplier_po_events e
     WHERE e.supplier_po_id = po.id),
    po.created_at
  );
$$;

COMMENT ON FUNCTION public.last_modified_at(public.supplier_pos) IS
  '0146: PostgREST computed column of supplier_pos — the time of the latest supplier_po_events row of the PO (any change: created, equipment added, price / line / PO updated, closed), else the PO''s created_at. The «اخر تعديل» column and sort of the PO list.';

REVOKE ALL ON FUNCTION public.last_modified_at(public.supplier_pos) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.last_modified_at(public.supplier_pos) TO authenticated;
