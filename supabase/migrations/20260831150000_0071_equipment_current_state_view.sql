-- Server-queryable current equipment state for dashboard drill-down reports.
CREATE OR REPLACE VIEW public.equipment_current_state
WITH (security_invoker = true)
AS
SELECT
  e.id,
  e.code,
  e.type,
  e.plate_number,
  e.operational_status,
  e.is_active,
  latest.movement_type,
  latest.movement_context,
  latest.recorded_at AS last_movement_at,
  latest.id AS last_movement_id
FROM public.equipment e
LEFT JOIN LATERAL (
  SELECT l.id, l.movement_type, l.movement_context, l.recorded_at
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = e.id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1
) latest ON true;

REVOKE ALL ON public.equipment_current_state FROM PUBLIC, anon;
GRANT SELECT ON public.equipment_current_state TO authenticated;
