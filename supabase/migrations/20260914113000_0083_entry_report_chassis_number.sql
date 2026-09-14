-- Include the chassis identifier in entry-report cards when a plate is absent.
CREATE OR REPLACE FUNCTION public.get_entry_report_summary(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH entries AS (
  SELECT
    l.id, l.equipment_id, l.supervisor_id, l.movement_type, l.movement_context,
    l.driver_id, l.driver_name, l.contractor_equipment_code, l.registration_method,
    l.odometer_reading, l.notes, l.photo_url, l.company_id, l.project_id,
    l.recorded_at, l.created_at, e.code equipment_code, e.type equipment_type,
    e.plate_number, e.chassis_number, c.name_ar company_name_ar,
    c.name_en company_name_en, p.name_ar project_name_ar, p.name_en project_name_en,
    pr.full_name supervisor_name, d.mobile_number driver_mobile
  FROM public.entry_exit_logs l
  LEFT JOIN public.equipment e ON e.id = l.equipment_id
  LEFT JOIN public.companies c ON c.id = l.company_id
  LEFT JOIN public.projects p ON p.id = l.project_id
  LEFT JOIN public.profiles pr ON pr.id = l.supervisor_id
  LEFT JOIN public.drivers d ON d.id = l.driver_id
  WHERE l.movement_context = 'site'
    AND l.movement_type = 'entry'
    AND l.recorded_at >= p_from
    AND l.recorded_at <= p_to
), ranked AS (
  SELECT COALESCE(company_name_ar, company_name_en, '—') name, count(*)::int count
  FROM entries GROUP BY 1 ORDER BY count(*) DESC, name LIMIT 5
), projects AS (
  SELECT COALESCE(project_name_ar, project_name_en, '—') name, count(*)::int count
  FROM entries GROUP BY 1 ORDER BY count(*) DESC, name LIMIT 5
), foremen AS (
  SELECT COALESCE(supervisor_name, '—') name, count(*)::int count, max(recorded_at) last_entry
  FROM entries GROUP BY 1 ORDER BY count(*) DESC, name LIMIT 5
), open_visits AS (
  SELECT jsonb_agg(jsonb_build_object(
    'equipment_code', equipment_code, 'equipment_type', equipment_type,
    'company_name', COALESCE(company_name_ar, company_name_en),
    'project_name', COALESCE(project_name_ar, project_name_en),
    'driver_name', driver_name, 'entry_recorded_at', entry_recorded_at
  ) ORDER BY entry_recorded_at DESC) value
  FROM (
    SELECT equipment_code, equipment_type, company_name_ar, company_name_en,
      project_name_ar, project_name_en, driver_name, entry_recorded_at
    FROM public.equipment_visits
    WHERE movement_context = 'site' AND exit_log_id IS NULL
    ORDER BY entry_recorded_at DESC LIMIT 5
  ) v
), latest AS (
  SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'equipment_id', equipment_id, 'supervisor_id', supervisor_id,
    'movement_type', movement_type, 'movement_context', movement_context,
    'driver_name', driver_name, 'driver_id', driver_id, 'recorded_at', recorded_at,
    'created_at', created_at, 'contractor_equipment_code', contractor_equipment_code,
    'registration_method', registration_method, 'odometer_reading', odometer_reading,
    'notes', notes, 'photo_url', photo_url,
    'equipment', jsonb_build_object(
      'id', equipment_id, 'code', equipment_code, 'type', equipment_type,
      'plate_number', plate_number, 'chassis_number', chassis_number
    ),
    'company', CASE WHEN company_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', company_id, 'name_ar', company_name_ar, 'name_en', company_name_en
    ) END,
    'project', CASE WHEN project_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', project_id, 'name_ar', project_name_ar, 'name_en', project_name_en
    ) END,
    'supervisor', jsonb_build_object('id', supervisor_id, 'full_name', supervisor_name),
    'driver', CASE WHEN driver_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', driver_id, 'mobile_number', driver_mobile
    ) END
  ) ORDER BY recorded_at DESC, id DESC) value
  FROM (SELECT * FROM entries ORDER BY recorded_at DESC, id DESC LIMIT 10) x
)
SELECT jsonb_build_object(
  'total', (SELECT count(*)::int FROM entries),
  'equipment', (SELECT count(DISTINCT equipment_id)::int FROM entries),
  'companies', (SELECT count(DISTINCT company_id)::int FROM entries WHERE company_id IS NOT NULL),
  'projects', (SELECT count(DISTINCT project_id)::int FROM entries WHERE project_id IS NOT NULL),
  'open', (SELECT count(*)::int FROM public.equipment_visits WHERE movement_context = 'site' AND exit_log_id IS NULL),
  'latest', COALESCE((SELECT value FROM latest), '[]'::jsonb),
  'open_visits', COALESCE((SELECT value FROM open_visits), '[]'::jsonb),
  'top_companies', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM ranked r), '[]'::jsonb),
  'top_projects', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM projects r), '[]'::jsonb),
  'foremen', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM foremen r), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.get_entry_report_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_entry_report_summary(timestamptz, timestamptz) TO authenticated;
