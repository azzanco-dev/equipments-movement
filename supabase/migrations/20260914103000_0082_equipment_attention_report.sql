-- Admin-only, server-paginated equipment attention report.
-- The latest movement is selected globally per equipment so an equipment cannot
-- be reported as both open at a site and outside after moving to the workshop.
CREATE OR REPLACE FUNCTION public.get_equipment_attention_report(
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(p_search), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN (
    WITH latest AS (
      SELECT DISTINCT ON (l.equipment_id)
        l.equipment_id,
        l.id AS movement_id,
        l.movement_type,
        l.movement_context,
        l.recorded_at,
        l.project_id
      FROM public.entry_exit_logs l
      ORDER BY l.equipment_id, l.recorded_at DESC, l.id DESC
    ),
    classified AS (
      SELECT
        e.id AS equipment_id,
        e.code AS equipment_code,
        e.type AS equipment_type,
        e.plate_number,
        latest.movement_id,
        latest.movement_type,
        latest.movement_context,
        latest.recorded_at AS last_movement_at,
        p.name_ar AS project_name_ar,
        p.name_en AS project_name_en,
        CASE
          WHEN latest.movement_id IS NULL THEN 'no_movement'
          WHEN latest.movement_type = 'entry' THEN 'open_visit'
          WHEN latest.movement_type = 'exit' THEN 'outside_sites'
          ELSE 'unclassified_history'
        END AS attention_reason
      FROM public.equipment e
      LEFT JOIN latest ON latest.equipment_id = e.id
      LEFT JOIN public.projects p ON p.id = latest.project_id
      WHERE e.is_active = true
    ),
    filtered AS (
      SELECT *
      FROM classified
      WHERE attention_reason <> 'unclassified_history'
        AND (
          v_search IS NULL
          OR equipment_code ILIKE '%' || v_search || '%'
          OR equipment_type ILIKE '%' || v_search || '%'
          OR plate_number ILIKE '%' || v_search || '%'
        )
    ),
    paged AS (
      SELECT *
      FROM filtered
      ORDER BY
        CASE attention_reason
          WHEN 'open_visit' THEN 1
          WHEN 'outside_sites' THEN 2
          WHEN 'no_movement' THEN 3
          ELSE 4
        END,
        last_movement_at NULLS LAST,
        equipment_code,
        equipment_id
      LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*)::integer FROM filtered),
      'summary', jsonb_build_object(
        'no_movement', (SELECT count(*)::integer FROM classified WHERE attention_reason = 'no_movement'),
        'open_visit', (SELECT count(*)::integer FROM classified WHERE attention_reason = 'open_visit'),
        'outside_sites', (SELECT count(*)::integer FROM classified WHERE attention_reason = 'outside_sites')
      ),
      'rows', COALESCE((
        SELECT jsonb_agg(to_jsonb(paged))
        FROM paged
      ), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_equipment_attention_report(integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_attention_report(integer, integer, text) TO authenticated;
