CREATE OR REPLACE FUNCTION public.import_movement_rows(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_result jsonb := '[]'::jsonb;
  v_mode text;
  v_entry_at timestamptz;
  v_exit_at timestamptz;
  v_entry_id uuid;
  v_exit_id uuid;
  v_error text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'invalid_import_rows';
  END IF;

  FOR v_row IN
    SELECT value
    FROM jsonb_array_elements(p_rows)
    ORDER BY COALESCE(NULLIF(value->>'entry_date', ''), NULLIF(value->>'exit_date', '')),
             NULLIF(value->>'row_number', '')::integer
  LOOP
    v_entry_id := NULL;
    v_exit_id := NULL;
    v_error := NULL;
    BEGIN
      v_mode := v_row->>'mode';
      IF v_mode NOT IN ('entry', 'exit', 'both') THEN RAISE EXCEPTION 'invalid_mode'; END IF;
      IF NULLIF(v_row->>'equipment_id', '') IS NULL THEN RAISE EXCEPTION 'equipment_required'; END IF;

      IF v_mode IN ('entry', 'both') THEN
        v_entry_at := ((v_row->>'entry_date')::date + time '12:00') AT TIME ZONE 'Asia/Riyadh';
        INSERT INTO public.entry_exit_logs(
          equipment_id, supervisor_id, movement_type, movement_context,
          registration_method, driver_id, driver_name, company_id, project_id,
          contractor_equipment_code, notes, recorded_at
        ) VALUES (
          (v_row->>'equipment_id')::uuid,
          COALESCE(NULLIF(v_row->>'supervisor_id', '')::uuid, auth.uid()),
          'entry', 'site', 'manual',
          (v_row->>'driver_id')::uuid,
          NULLIF(v_row->>'driver_label', ''),
          (v_row->>'company_id')::uuid,
          (v_row->>'project_id')::uuid,
          NULLIF(btrim(v_row->>'contractor_equipment_code'), ''),
          NULLIF(btrim(v_row->>'notes'), ''),
          v_entry_at
        ) RETURNING id INTO v_entry_id;
      END IF;

      IF v_mode IN ('exit', 'both') THEN
        v_exit_at := ((v_row->>'exit_date')::date + time '12:00') AT TIME ZONE 'Asia/Riyadh';
        IF v_mode = 'both' AND v_exit_at <= v_entry_at THEN
          v_exit_at := v_entry_at + interval '1 minute';
        END IF;
        INSERT INTO public.entry_exit_logs(
          equipment_id, supervisor_id, movement_type, movement_context,
          registration_method, notes, recorded_at
        ) VALUES (
          (v_row->>'equipment_id')::uuid,
          COALESCE(NULLIF(v_row->>'supervisor_id', '')::uuid, auth.uid()),
          'exit', 'site', 'manual',
          NULLIF(btrim(v_row->>'notes'), ''),
          v_exit_at
        ) RETURNING id INTO v_exit_id;
      END IF;

      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'row_number', v_row->>'row_number',
        'success', true,
        'entry_id', v_entry_id,
        'exit_id', v_exit_id
      ));
    EXCEPTION WHEN OTHERS THEN
      v_error := CASE
        WHEN SQLERRM LIKE '%sequence would be invalid%' THEN 'invalid_sequence'
        WHEN SQLERRM LIKE '%no prior entry%' THEN 'no_prior_entry'
        WHEN SQLERRM LIKE '%future%' THEN 'future_date'
        WHEN SQLERRM LIKE '%violates foreign key%' THEN 'invalid_relation'
        ELSE 'import_failed'
      END;
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'row_number', v_row->>'row_number',
        'success', false,
        'error', v_error
      ));
    END;
  END LOOP;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.import_movement_rows(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_movement_rows(jsonb) TO authenticated;
