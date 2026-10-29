-- 0161: the suppliers inside projects, for the admin home.
--
-- Owner 2026-10-29: «اضف عمود في المشاريع تبع الموردين». Beside the
-- «الاسطول» and «في المشاريع» owner cards, a third card lists the units of
-- «مالك اخر» (`external_supplier`) that are inside a project now, per
-- supplier (`equipment.lessor_id`). Its total is the same rows as the
-- `external_supplier` × `inside_site` cell of
-- `get_admin_owner_state_matrix`, so the two cards always agree.
--
-- Read-only, SECURITY INVOKER like the other admin-home functions: the rows
-- are `admin_equipment_state` (security_invoker) under the caller's RLS, and
-- `lessors` is readable by every signed-in user. The gate is `home.admin`,
-- as for `get_admin_owner_state_matrix`. A unit without a supplier is one
-- row with a NULL id and name. At most 200 suppliers, the largest first.

CREATE OR REPLACE FUNCTION public.get_admin_supplier_site_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_permission('home.admin') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;

  WITH units AS (
    SELECT e.lessor_id
    FROM public.admin_equipment_state s
    JOIN public.equipment e ON e.id = s.id
    WHERE s.is_active
      AND s.status = 'active'
      AND s.ownership_status = 'external_supplier'
      AND s.state = 'inside_site'
  ),
  grouped AS (
    SELECT u.lessor_id, l.name, count(*)::int AS count
    FROM units u
    LEFT JOIN public.lessors l ON l.id = u.lessor_id
    GROUP BY u.lessor_id, l.name
    ORDER BY count(*) DESC, l.name NULLS LAST
    LIMIT 200
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM units),
    'suppliers', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'lessor_id', g.lessor_id,
            'name', g.name,
            'count', g.count
          )
          ORDER BY g.count DESC, g.name NULLS LAST
        )
        FROM grouped g
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_supplier_site_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_supplier_site_counts() TO authenticated;

COMMENT ON FUNCTION public.get_admin_supplier_site_counts() IS
  '0161: the admin home''s suppliers card — active «مالك اخر» units inside a project now, per supplier (lessor_id, name; NULL for a unit without one), the largest first, at most 200, with the total. home.admin; SECURITY INVOKER over admin_equipment_state.';

NOTIFY pgrst, 'reload schema';
