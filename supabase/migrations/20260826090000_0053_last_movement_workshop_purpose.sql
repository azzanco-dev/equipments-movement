-- Include the current workshop entry classification in equipment status displays.
DROP FUNCTION IF EXISTS public.get_last_movement(uuid, text);

CREATE FUNCTION public.get_last_movement(p_equipment_id uuid, p_movement_context text DEFAULT 'site')
RETURNS TABLE(
  movement_type text,
  movement_context text,
  workshop_purpose text,
  recorded_at timestamptz,
  supervisor_id uuid,
  company_id uuid,
  project_id uuid,
  contractor_equipment_code text,
  driver_id uuid,
  driver_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.movement_type,
    l.movement_context,
    l.workshop_purpose,
    l.recorded_at,
    CASE WHEN public.is_admin() THEN l.supervisor_id ELSE NULL END,
    CASE WHEN public.is_admin() THEN l.company_id ELSE NULL END,
    CASE WHEN public.is_admin() THEN l.project_id ELSE NULL END,
    CASE WHEN public.is_admin() THEN l.contractor_equipment_code ELSE NULL END,
    COALESCE(c.new_driver_id, l.driver_id),
    COALESCE(c.new_driver_name, l.driver_name)
  FROM public.entry_exit_logs l
  LEFT JOIN LATERAL (
    SELECT x.new_driver_id, x.new_driver_name
    FROM public.movement_driver_changes x
    WHERE x.entry_log_id = l.id
    ORDER BY x.changed_at DESC, x.id DESC
    LIMIT 1
  ) c ON l.movement_type = 'entry'
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_last_movement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_last_movement(uuid, text) TO authenticated;
