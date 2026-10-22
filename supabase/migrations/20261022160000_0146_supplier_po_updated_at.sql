-- 0146: `supplier_pos.updated_at`, the time of a PO's latest change, for the
-- «اخر تعديل» column of the PO list.
--
-- Owner 2026-10-22: «اضف عمود اخر تعديل لاوامر الشراء», and an editable
-- table carries updated_at as a rule («مفروض يكون من القواعد اضافة
-- updated_at»). 0136 created supplier_pos without it.
--
-- Most changes of a PO are on its lines (a unit added, a price or note
-- edited), which never touch the PO row, so the PO's updated_at moves on
-- both: the usual BEFORE UPDATE trigger on supplier_pos (start date / notes
-- through update_supplier_po, closing through close_supplier_po) and an
-- AFTER trigger on supplier_po_equipment that touches its PO on every
-- insert, update and delete of a line.
--
-- Existing POs get the time of their latest supplier_po_events row (every
-- change since 0136 wrote one), else their created_at. The column is filled
-- before the triggers exist, so the backfill keeps those times.

-- ===========================================================================
-- 1. The column, filled from the history
-- ===========================================================================
ALTER TABLE public.supplier_pos
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.supplier_pos p
SET updated_at = COALESCE(
  (SELECT max(e.created_at)
   FROM public.supplier_po_events e
   WHERE e.supplier_po_id = p.id),
  p.created_at
)
WHERE p.updated_at IS NULL;

ALTER TABLE public.supplier_pos
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

COMMENT ON COLUMN public.supplier_pos.updated_at IS
  '0146: the time of the PO''s latest change — its own row (update_supplier_po, close_supplier_po) or any of its lines (supplier_po_equipment insert / update / delete). The «اخر تعديل» column and sort of the PO list.';

-- The list sorts by it, like the master lists (0080).
CREATE INDEX IF NOT EXISTS supplier_pos_updated_at_id_idx
  ON public.supplier_pos (updated_at DESC, id DESC);

-- ===========================================================================
-- 2. The PO row's own changes
-- ===========================================================================
DROP TRIGGER IF EXISTS supplier_pos_updated_at ON public.supplier_pos;
CREATE TRIGGER supplier_pos_updated_at
  BEFORE UPDATE ON public.supplier_pos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================================================
-- 3. A line's change touches its PO
-- ===========================================================================
-- SECURITY DEFINER because supplier_pos has no UPDATE policy; it only sets
-- updated_at of the PO the changed line belongs to. Every line write already
-- runs inside the purchasing.manage functions.
CREATE OR REPLACE FUNCTION public.touch_supplier_po_from_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.supplier_pos SET updated_at = now()
    WHERE id = OLD.supplier_po_id;
    RETURN OLD;
  END IF;
  UPDATE public.supplier_pos SET updated_at = now()
  WHERE id = NEW.supplier_po_id;
  IF TG_OP = 'UPDATE' AND OLD.supplier_po_id IS DISTINCT FROM NEW.supplier_po_id THEN
    UPDATE public.supplier_pos SET updated_at = now()
    WHERE id = OLD.supplier_po_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.touch_supplier_po_from_line() IS
  '0146: AFTER INSERT / UPDATE / DELETE trigger of supplier_po_equipment — moves supplier_pos.updated_at of the line''s PO, so a line change counts as a change of the PO.';

REVOKE ALL ON FUNCTION public.touch_supplier_po_from_line()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS supplier_po_equipment_touch_po ON public.supplier_po_equipment;
CREATE TRIGGER supplier_po_equipment_touch_po
  AFTER INSERT OR UPDATE OR DELETE ON public.supplier_po_equipment
  FOR EACH ROW EXECUTE FUNCTION public.touch_supplier_po_from_line();
