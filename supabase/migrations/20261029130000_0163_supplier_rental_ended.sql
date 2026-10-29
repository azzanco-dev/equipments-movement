-- 0163: «منتهية» — a supplier unit whose rental has ended.
--
-- Owner decisions 2026-10-29 («263 في اسطول الموردين، 241 في داخل المشاريع
-- للموردين … كيف نخلي 263 هو نفسه 241»):
--   1. A new asset status `rental_ended` («منتهية»), for «مالك اخر»
--      (`external_supplier`) units ONLY (`equipment_rental_ended_external_check`).
--      Like `sold` it is not `active`, so `equipment_status_sync` (0102) forces
--      `is_active = false` and every fleet predicate
--      (`is_active AND status = 'active'`) leaves the unit out of the fleet
--      figures and reports.
--   2. AUTOMATIC: any EXIT from a project of an active supplier unit makes it
--      «منتهية» («غالبا معدات الموردين ماتدخل الورشة حقنا», so the exit
--      purpose does not matter), and any ENTRY (project or workshop) of a
--      «منتهية» unit makes it active again («ممكن ترجع»). Only the unit's
--      LATEST movement decides (`sync_equipment_rental_status`), on every
--      insert, delete and change of the movement's type, context, time or
--      unit, so a historical import or a deleted movement never leaves the
--      status behind the chain.
--   3. The entry searches (`search_entry_equipment`; `search_workshop_equipment`
--      for an entry) offer «منتهية» units, so the form can record their return.
--   4. Changed by hand by whoever can edit equipment (the equipment form and
--      the Excel update, which now accepts `rental_ended`); never while the
--      unit is inside a project or the workshop (`equipment_inside_cannot_end`).
--   5. Backfill once («حول ال 22»): every active supplier unit whose latest
--      movement is an exit from a project becomes «منتهية». Supplier units in
--      the workshop or without any movement stay active.
--
-- The three functions are their latest bodies (searches: 0156; Excel update:
-- 0134) verbatim plus the lines marked 0163.

-- ===========================================================================
-- 1. The status value and its owner rule
-- ===========================================================================
ALTER TABLE public.equipment
  DROP CONSTRAINT IF EXISTS equipment_status_check;
ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_status_check
  CHECK (status IN ('active', 'sold', 'rental_ended'));

ALTER TABLE public.equipment
  DROP CONSTRAINT IF EXISTS equipment_rental_ended_external_check;
ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_rental_ended_external_check
  CHECK (status <> 'rental_ended' OR ownership_status = 'external_supplier');

COMMENT ON COLUMN public.equipment.status IS
  'Asset status: active (in the fleet), sold, or rental_ended («منتهية», 0163: '
  'a supplier unit whose rental ended; external_supplier only, set and cleared '
  'automatically by its latest movement and by hand). Only active counts as '
  'the fleet; every fleet predicate is (is_active AND status = ''active'').';

-- ===========================================================================
-- 2. Never «منتهية» while inside a project or the workshop
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.guard_equipment_rental_ended()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type text;
BEGIN
  IF NEW.status = 'rental_ended'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'rental_ended') THEN
    SELECT l.movement_type INTO v_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF v_type = 'entry' THEN
      RAISE EXCEPTION 'equipment_inside_cannot_end'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_equipment_rental_ended() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.guard_equipment_rental_ended() IS
  '0163: refuses status rental_ended («منتهية») for a unit whose latest movement '
  'is an ENTRY (inside a project or the workshop): its exit comes first.';

DROP TRIGGER IF EXISTS guard_equipment_rental_ended ON public.equipment;
CREATE TRIGGER guard_equipment_rental_ended
  BEFORE INSERT OR UPDATE OF status ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.guard_equipment_rental_ended();

-- ===========================================================================
-- 3. The automatic rule, from the unit's latest movement
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.sync_equipment_rental_status(
  p_equipment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner text;
  v_status text;
  v_active boolean;
  v_type text;
  v_context text;
BEGIN
  IF p_equipment_id IS NULL THEN
    RETURN;
  END IF;
  SELECT e.ownership_status, e.status, e.is_active
    INTO v_owner, v_status, v_active
  FROM public.equipment e
  WHERE e.id = p_equipment_id;
  -- Supplier units only; a sold unit (or a deactivated active one) is left
  -- exactly as its owner set it.
  IF NOT FOUND
     OR v_owner IS DISTINCT FROM 'external_supplier'
     OR NOT (v_status = 'rental_ended' OR (v_status = 'active' AND v_active)) THEN
    RETURN;
  END IF;

  SELECT l.movement_type, l.movement_context INTO v_type, v_context
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  IF v_status = 'active' AND v_type = 'exit' AND v_context = 'site' THEN
    UPDATE public.equipment SET status = 'rental_ended'
    WHERE id = p_equipment_id;
  ELSIF v_status = 'rental_ended' AND v_type = 'entry' THEN
    UPDATE public.equipment SET status = 'active', is_active = true
    WHERE id = p_equipment_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_equipment_rental_status(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sync_equipment_rental_status(uuid) IS
  '0163: a supplier unit becomes rental_ended («منتهية») when its latest '
  'movement is an EXIT from a project, and active again when it is an ENTRY. '
  'Called by the movement trigger only; it runs inside the movement''s '
  'transaction, after the sequence trigger took the unit''s advisory lock.';

CREATE OR REPLACE FUNCTION public.equipment_rental_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.sync_equipment_rental_status(OLD.equipment_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND (TG_OP = 'INSERT' OR NEW.equipment_id IS DISTINCT FROM OLD.equipment_id) THEN
    PERFORM public.sync_equipment_rental_status(NEW.equipment_id);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.equipment_rental_lifecycle() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.equipment_rental_lifecycle() IS
  '0163: after a movement is inserted, deleted or moved in the chain, '
  'recomputes the supplier rental status of its unit(s).';

DROP TRIGGER IF EXISTS equipment_rental_lifecycle ON public.entry_exit_logs;
CREATE TRIGGER equipment_rental_lifecycle
  AFTER INSERT OR DELETE OR UPDATE OF movement_type, movement_context, recorded_at, equipment_id
  ON public.entry_exit_logs
  FOR EACH ROW EXECUTE FUNCTION public.equipment_rental_lifecycle();

-- ===========================================================================
-- 4. The entry searches offer «منتهية» units
-- ===========================================================================
-- search_entry_equipment — latest 0156; the WHERE marked 0163.
CREATE OR REPLACE FUNCTION public.search_entry_equipment(
  p_search text DEFAULT NULL,
  p_ownership_status text DEFAULT NULL,
  p_plate_digits text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  plate_number text,
  chassis_number text,
  ownership_status text,
  is_active boolean,
  master_data_complete boolean,
  numbering_status text,
  state text,
  state_since timestamptz,
  state_company_name_ar text,
  state_company_name_en text,
  state_project_name_ar text,
  state_project_name_en text,
  state_workshop_purpose text,
  matched_previous_code boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_term text;
  v_term_search text;
  v_digits text;
BEGIN
  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL NOT IN (...)` alone evaluates to NULL, which would let it through.
  IF NOT public.has_permission('movements.site.create') THEN
    RAISE EXCEPTION 'foreman role required';
  END IF;

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  -- LIKE wildcards and the LIKE escape character are stripped so a search term
  -- can never widen the match. chr(92) is the backslash.
  v_term := NULLIF(btrim(translate(p_search, '%_' || chr(92), '')), '');
  -- 0116: the same term, normalised like equipment.type_search. NULL when
  -- nothing is left (a term of tatweel only), so it never matches every row.
  v_term_search := NULLIF(public.normalize_search_text(v_term), '');
  v_digits := NULLIF(btrim(p_plate_digits), '');
  IF v_digits IS NOT NULL AND v_digits !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'invalid plate digits';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.code,
    e.type,
    e.plate_number,
    e.chassis_number,
    e.ownership_status,
    e.is_active,
    e.master_data_complete,
    e.numbering_status,
    CASE
      WHEN last_movement.movement_type IS NULL THEN 'none'
      WHEN last_movement.movement_type <> 'entry' THEN 'outside'
      WHEN last_movement.movement_context = 'workshop' THEN 'inside_workshop'
      ELSE 'inside_site'
    END::text AS state,
    CASE
      WHEN last_movement.movement_type = 'entry' THEN last_movement.recorded_at
    END AS state_since,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_ar
    END AS state_company_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_en
    END AS state_company_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_ar
    END AS state_project_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_en
    END AS state_project_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'workshop' THEN last_movement.workshop_purpose
    END AS state_workshop_purpose,
    (
      v_term IS NOT NULL
      AND e.code NOT ILIKE '%' || v_term || '%'
      AND EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
    ) AS matched_previous_code
  FROM public.equipment e
  -- The latest movement per equipment, ordered deterministically by
  -- (recorded_at, id) exactly like the sequence trigger and 0087/0088.
  LEFT JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.recorded_at,
           l.workshop_purpose, l.company_id, l.project_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  LEFT JOIN public.companies co ON co.id = last_movement.company_id
  LEFT JOIN public.projects pr ON pr.id = last_movement.project_id
  -- 0163: a «منتهية» supplier unit is offered too; its entry makes it
  -- active again (`sync_equipment_rental_status`).
  WHERE ((e.is_active AND e.status = 'active') OR e.status = 'rental_ended')
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
      -- 0114: a previous code (A115 -> F84) still finds the same equipment.
      OR EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
      -- 0116: the type is compared normalised on both sides.
      OR e.type_search ILIKE '%' || v_term_search || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      OR e.chassis_number ILIKE '%' || v_term || '%'
      OR (v_digits IS NOT NULL AND e.plate_digits ILIKE '%' || v_digits || '%')
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

-- search_workshop_equipment — latest 0156; the WHERE marked 0163.
CREATE OR REPLACE FUNCTION public.search_workshop_equipment(
  p_movement_type text,
  p_search text DEFAULT NULL,
  p_ownership_status text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  plate_number text,
  ownership_status text,
  qr_value text,
  is_active boolean,
  master_data_complete boolean,
  numbering_status text,
  state text,
  state_since timestamptz,
  state_company_name_ar text,
  state_company_name_en text,
  state_project_name_ar text,
  state_project_name_en text,
  state_workshop_purpose text,
  matched_previous_code boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_term text;
  v_term_search text;
BEGIN
  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL NOT IN (...)` alone evaluates to NULL, which would let it through.
  IF NOT public.has_permission('movements.workshop.create') THEN
    RAISE EXCEPTION 'workshop role required';
  END IF;

  IF p_movement_type IS NULL OR p_movement_type NOT IN ('entry', 'exit') THEN
    RAISE EXCEPTION 'invalid movement type';
  END IF;

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  -- LIKE wildcards and the LIKE escape character are stripped so a search term
  -- can never widen the match. chr(92) is the backslash.
  v_term := NULLIF(btrim(translate(p_search, '%_' || chr(92), '')), '');
  -- 0116: the same term, normalised like equipment.type_search. NULL when
  -- nothing is left (a term of tatweel only), so it never matches every row.
  v_term_search := NULLIF(public.normalize_search_text(v_term), '');

  RETURN QUERY
  SELECT
    e.id,
    e.code,
    e.type,
    e.plate_number,
    e.ownership_status,
    e.qr_value,
    e.is_active,
    e.master_data_complete,
    e.numbering_status,
    CASE
      WHEN last_movement.movement_type IS NULL THEN 'none'
      WHEN last_movement.movement_type <> 'entry' THEN 'outside'
      WHEN last_movement.movement_context = 'workshop' THEN 'inside_workshop'
      ELSE 'inside_site'
    END::text AS state,
    CASE
      WHEN last_movement.movement_type = 'entry' THEN last_movement.recorded_at
    END AS state_since,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_ar
    END AS state_company_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_en
    END AS state_company_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_ar
    END AS state_project_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_en
    END AS state_project_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'workshop' THEN last_movement.workshop_purpose
    END AS state_workshop_purpose,
    (
      v_term IS NOT NULL
      AND e.code NOT ILIKE '%' || v_term || '%'
      AND EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
    ) AS matched_previous_code
  FROM public.equipment e
  -- The latest movement per equipment in ANY context: this is the state the
  -- badge reports, the same source 0089 uses.
  LEFT JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.recorded_at,
           l.workshop_purpose, l.company_id, l.project_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  -- The latest WORKSHOP movement, which decides what a workshop EXIT may
  -- close. Kept separate from the state above on purpose.
  LEFT JOIN LATERAL (
    SELECT l.movement_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
      AND l.movement_context = 'workshop'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_workshop_movement ON true
  LEFT JOIN public.companies co ON co.id = last_movement.company_id
  LEFT JOIN public.projects pr ON pr.id = last_movement.project_id
  -- 0163: for a workshop ENTRY a «منتهية» supplier unit is offered too.
  WHERE (
      (e.is_active AND e.status = 'active')
      OR (p_movement_type = 'entry' AND e.status = 'rental_ended')
    )
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
      -- 0114: a previous code (A115 -> F84) still finds the same equipment.
      OR EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
      -- 0116: the type is compared normalised on both sides.
      OR e.type_search ILIKE '%' || v_term_search || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      -- 0116 (EM-117): the chassis number, as the two site searches match it.
      OR e.chassis_number ILIKE '%' || v_term || '%'
    )
    AND (
      p_movement_type = 'entry'
      OR (
        p_movement_type = 'exit'
        AND last_workshop_movement.movement_type = 'entry'
      )
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

-- ===========================================================================
-- 5. The Excel update accepts rental_ended
-- ===========================================================================
-- update_equipment_from_excel — latest 0134; the lines marked 0163.
CREATE OR REPLACE FUNCTION public.update_equipment_from_excel(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_equipment public.equipment;
  v_results jsonb := '[]'::jsonb;
  v_id uuid;
  v_version timestamptz;
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('equipment.import') THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'invalid_update_rows';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_id := (v_row->>'record_id')::uuid;
      v_version := (v_row->>'record_version')::timestamptz;
      SELECT * INTO v_equipment FROM public.equipment WHERE id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'record_not_found'; END IF;
      IF v_equipment.updated_at IS DISTINCT FROM v_version THEN
        RAISE EXCEPTION 'record_changed';
      END IF;
      IF NULLIF(btrim(v_row->>'code'), '') IS NULL OR NULLIF(btrim(v_row->>'type'), '') IS NULL THEN
        RAISE EXCEPTION 'required_value_missing';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.equipment_types et WHERE et.name = btrim(v_row->>'type')) THEN
        RAISE EXCEPTION 'equipment_type_not_found';
      END IF;

      -- 0134 (C-11): a changed code needs equipment.change_code; the row gets
      -- its own status and the other rows of the batch still go through.
      IF upper(btrim(v_equipment.code)) IS DISTINCT FROM upper(btrim(v_row->>'code'))
         AND NOT public.has_permission('equipment.change_code') THEN
        RAISE EXCEPTION 'equipment_code_change_not_allowed';
      END IF;

      -- Absent or blank keeps the current status; anything else must be one of
      -- the known values (0125: active or sold; 0163: rental_ended).
      v_status := COALESCE(
        NULLIF(btrim(v_row->>'status'), ''),
        v_equipment.status
      );
      IF v_status NOT IN ('active', 'sold', 'rental_ended') THEN
        RAISE EXCEPTION 'invalid_equipment_status';
      END IF;

      UPDATE public.equipment SET
        code = btrim(v_row->>'code'),
        type = btrim(v_row->>'type'),
        plate_number = NULLIF(btrim(v_row->>'plate_number'), ''),
        ownership_status = (v_row->>'ownership_status')::text,
        status = v_status,
        project_id = NULLIF(v_row->>'project_id', '')::uuid,
        lessor_id = CASE WHEN v_row->>'ownership_status' = 'external_supplier'
          THEN NULLIF(v_row->>'lessor_id', '')::uuid ELSE NULL END,
        brand = NULLIF(btrim(v_row->>'brand'), ''),
        model = NULLIF(btrim(v_row->>'model'), ''),
        manufacture_year = NULLIF(v_row->>'manufacture_year', '')::integer,
        chassis_number = NULLIF(btrim(v_row->>'chassis_number'), ''),
        registration_type = NULLIF(v_row->>'registration_type', '')::text,
        last_maintenance_date = NULLIF(v_row->>'last_maintenance_date', '')::date,
        registration_expiry = NULLIF(v_row->>'registration_expiry', '')::date,
        insurance_expiry = NULLIF(v_row->>'insurance_expiry', '')::date,
        master_data_complete = true
      WHERE id = v_id;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'record_id', v_id, 'status', 'updated'
      ));
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'record_id', v_row->>'record_id', 'status', 'error',
        'error_code', CASE
          WHEN SQLERRM LIKE '%record_not_found%' THEN 'record_not_found'
          WHEN SQLERRM LIKE '%record_changed%' THEN 'record_changed'
          WHEN SQLERRM LIKE '%required_value_missing%' THEN 'required_value_missing'
          WHEN SQLERRM LIKE '%equipment_type_not_found%' THEN 'equipment_type_not_found'
          WHEN SQLERRM LIKE '%equipment_code_change_not_allowed%' THEN 'equipment_code_change_not_allowed'
          WHEN SQLERRM LIKE '%invalid_equipment_status%' THEN 'invalid_equipment_status'
          WHEN SQLERRM LIKE '%invalid_plate_number%' THEN 'invalid_plate_number'
          -- 0163
          WHEN SQLERRM LIKE '%equipment_rental_ended_external_check%' THEN 'rental_ended_external_only'
          WHEN SQLERRM LIKE '%equipment_inside_cannot_end%' THEN 'equipment_inside_cannot_end'
          ELSE 'update_failed' END
      ));
    END;
  END LOOP;
  RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.update_equipment_from_excel(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_equipment_from_excel(jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_equipment_from_excel(jsonb) IS
  '0163: 0134 verbatim plus status rental_ended («منتهية», supplier units only: rental_ended_external_only; never inside: equipment_inside_cannot_end). Gate: equipment.import.';

-- ===========================================================================
-- 6. Backfill once («حول ال 22»)
-- ===========================================================================
DO $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.equipment e
  SET status = 'rental_ended'
  WHERE e.ownership_status = 'external_supplier'
    AND e.status = 'active'
    AND e.is_active
    AND (
      SELECT l.movement_type || ':' || l.movement_context
      FROM public.entry_exit_logs l
      WHERE l.equipment_id = e.id
      ORDER BY l.recorded_at DESC, l.id DESC
      LIMIT 1
    ) = 'exit:site';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '0163: % supplier units marked rental_ended', v_count;
END;
$$;

NOTIFY pgrst, 'reload schema';
