/*
# Restrict the fleet-wide last-movement lookup to admins

## Problem
`get_all_equipment_last_movement()` is SECURITY DEFINER over `entry_exit_logs`
with no authorization check in its body, so any authenticated caller received
the latest movement and responsible supervisor for every machine, bypassing the
`supervisor_id = auth.uid() OR is_admin()` policy on that table.

## Change
Add an `is_admin()` guard inside the function so a non-admin caller gets no rows.
Only the admin dashboard consumes it.
*/

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
  WHERE public.is_admin()
  ORDER BY e.id, l.recorded_at DESC;
$$;
