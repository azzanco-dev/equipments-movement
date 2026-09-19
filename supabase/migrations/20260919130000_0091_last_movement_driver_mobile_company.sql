-- 0091: add the current driver's mobile number and the company name to
-- get_last_movement, so the site EXIT form can render the approved
-- "بيانات اخر دخول" summary from a single call.
--
-- Diff against the 0076 definition (everything else is copied verbatim):
--   * RETURNS TABLE gains, at the end: driver_mobile_number text,
--     company_name_ar text, company_name_en text.
--   * New LEFT JOIN public.drivers d ON d.id = COALESCE(c.new_driver_id,
--     l.driver_id) -- the latest current driver, i.e. the same driver the
--     existing driver_id/driver_name columns already resolve to.
--   * New LEFT JOIN public.companies co ON co.id = l.company_id, mirroring the
--     existing projects join.
--   * DROP first, because the return type changes; role checks, security
--     settings, search_path, REVOKE and GRANT are unchanged.

DROP FUNCTION IF EXISTS public.get_last_movement(uuid, text);
CREATE FUNCTION public.get_last_movement(
  p_equipment_id uuid,
  p_movement_context text DEFAULT 'site'
)
RETURNS TABLE(
  movement_type text,
  movement_context text,
  workshop_purpose text,
  recorded_at timestamptz,
  supervisor_id uuid,
  supervisor_name text,
  company_id uuid,
  project_id uuid,
  project_name_ar text,
  project_name_en text,
  contractor_equipment_code text,
  driver_id uuid,
  driver_name text,
  driver_mobile_number text,
  company_name_ar text,
  company_name_en text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
  IF v_role NOT IN ('admin', 'supervisor', 'workshop', 'assistant_workshop_manager', 'workshop_manager', 'monitor') THEN
    RAISE EXCEPTION 'authenticated role required';
  END IF;
  IF p_movement_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'invalid movement context';
  END IF;

  RETURN QUERY
  SELECT
    l.movement_type,
    l.movement_context,
    l.workshop_purpose,
    l.recorded_at,
    l.supervisor_id,
    s.full_name,
    l.company_id,
    l.project_id,
    p.name_ar,
    p.name_en,
    l.contractor_equipment_code,
    COALESCE(c.new_driver_id, l.driver_id),
    COALESCE(c.new_driver_name, l.driver_name),
    d.mobile_number,
    co.name_ar,
    co.name_en
  FROM public.entry_exit_logs l
  LEFT JOIN public.profiles s ON s.id = l.supervisor_id
  LEFT JOIN public.projects p ON p.id = l.project_id
  LEFT JOIN LATERAL (
    SELECT x.new_driver_id, x.new_driver_name
    FROM public.movement_driver_changes x
    WHERE x.entry_log_id = l.id
    ORDER BY x.changed_at DESC, x.id DESC
    LIMIT 1
  ) c ON l.movement_type = 'entry'
  LEFT JOIN public.drivers d ON d.id = COALESCE(c.new_driver_id, l.driver_id)
  LEFT JOIN public.companies co ON co.id = l.company_id
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.get_last_movement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_last_movement(uuid, text) TO authenticated;
