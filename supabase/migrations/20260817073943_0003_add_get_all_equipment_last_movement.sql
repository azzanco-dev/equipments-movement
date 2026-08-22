-- Helper function: returns the last movement for every equipment that has at least one log
-- Used by the admin dashboard to count equipment currently on/off site
CREATE OR REPLACE FUNCTION public.get_all_equipment_last_movement()
RETURNS TABLE (
  equipment_id uuid,
  movement_type text,
  recorded_at timestamptz,
  supervisor_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (e.id)
    e.id AS equipment_id,
    l.movement_type,
    l.recorded_at,
    l.supervisor_id
  FROM equipment e
  INNER JOIN entry_exit_logs l ON l.equipment_id = e.id
  ORDER BY e.id, l.recorded_at DESC;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.get_all_equipment_last_movement() TO authenticated;
