-- 0117: record three equipment code changes made before the history existed
--
-- Owner request 2026-10-04. Three units were given a new code before
-- migration 0114 started recording code changes, so their previous codes are
-- in no history row: the searches do not find the units by the old code, the
-- detail and inquiry pages list no previous code, and the reuse guard
-- (`guard_equipment_code_history`) would let another unit take the old code.
--
--   F120 / A345
--   F121 / A346
--   F133 / A144
--
-- This inserts one `equipment_code_changes` row per unit. Nothing else is
-- touched: `equipment.code` is not changed, no object is created or replaced.
--
-- Which side is the previous code is taken from the data, not assumed: of the
-- two codes of a pair EXACTLY ONE must be the current code of an equipment;
-- that unit gets the other code as its previous code. The migration raises,
-- and so applies nothing, when
--   * neither code or both codes of a pair are current equipment codes, or
--   * the previous code is already a previous code of ANOTHER unit.
-- A pair whose row already exists is skipped, so the file is safe to re-run.
--
-- The real date of the change and who made it are unknown: `changed_at` is the
-- moment this migration runs, `changed_by` is NULL, and the reason says so.
-- Codes are compared as `upper(btrim(code))`, like 0114 does everywhere.
-- The two advisory keys are the reuse guard's own (`equipment_code:<CODE>`),
-- taken in a fixed order, so a concurrent code change waits for this insert.

DO $$
DECLARE
  v_pair text[];
  v_a text;
  v_b text;
  v_a_id uuid;
  v_b_id uuid;
  v_equipment_id uuid;
  v_old text;
  v_new text;
BEGIN
  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['F120', 'A345'],
    ARRAY['F121', 'A346'],
    ARRAY['F133', 'A144']
  ]
  LOOP
    v_a := upper(btrim(v_pair[1]));
    v_b := upper(btrim(v_pair[2]));

    PERFORM pg_advisory_xact_lock(
      hashtextextended('equipment_code:' || LEAST(v_a, v_b), 0));
    PERFORM pg_advisory_xact_lock(
      hashtextextended('equipment_code:' || GREATEST(v_a, v_b), 0));

    SELECT e.id INTO v_a_id
    FROM public.equipment e
    WHERE upper(btrim(e.code)) = v_a;
    SELECT e.id INTO v_b_id
    FROM public.equipment e
    WHERE upper(btrim(e.code)) = v_b;

    IF v_a_id IS NULL AND v_b_id IS NULL THEN
      RAISE EXCEPTION 'backfill 0117: neither % nor % is a current equipment code', v_a, v_b;
    END IF;
    IF v_a_id IS NOT NULL AND v_b_id IS NOT NULL THEN
      RAISE EXCEPTION 'backfill 0117: both % and % are current equipment codes', v_a, v_b;
    END IF;

    IF v_a_id IS NOT NULL THEN
      v_equipment_id := v_a_id;
      v_new := v_a;
      v_old := v_b;
    ELSE
      v_equipment_id := v_b_id;
      v_new := v_b;
      v_old := v_a;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.equipment_code_changes c
      WHERE upper(btrim(c.old_code)) = v_old
        AND c.equipment_id <> v_equipment_id
    ) THEN
      RAISE EXCEPTION 'backfill 0117: % is already a previous code of another equipment', v_old;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.equipment_code_changes c
      WHERE upper(btrim(c.old_code)) = v_old
        AND c.equipment_id = v_equipment_id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.equipment_code_changes
      (equipment_id, old_code, new_code, changed_by, reason)
    VALUES (
      v_equipment_id,
      v_old,
      v_new,
      NULL,
      'رقم سابق اضيف يدويا: التغيير تم قبل بدء سجل تغيير الارقام، والتاريخ الفعلي غير مسجل'
    );
  END LOOP;
END;
$$;
