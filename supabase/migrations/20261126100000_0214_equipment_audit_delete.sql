-- 0214: deleting a unit works again (owner 2026-11-26, «فيه معدات قديمة ابغاك
-- تحذفها, بس تاكد ماعليها عمليات»).
--
-- Since 0168 every DELETE of public.equipment failed: the AFTER trigger
-- audit_equipment wrote the delete row with equipment_id = OLD.id, a unit that
-- no longer exists, so equipment_audit_logs_equipment_id_fkey refused the
-- insert and the whole delete was rolled back (production holds no 'delete'
-- row since 0168). The function is re-created from its production body
-- verbatim, except that a DELETE stores equipment_id NULL; equipment_code and
-- old_values still name the unit, and the activity page already shows a
-- deleted record without a link. Grants and the trigger are unchanged.

CREATE OR REPLACE FUNCTION public.audit_equipment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Derived, normalised or bookkeeping columns: never a change a person made.
  c_skipped CONSTANT text[] := ARRAY[
    'id',
    'created_at',
    'updated_at',
    'plate_digits',
    'plate_letters_en',
    'numbering_status',
    'type_search'
  ];
  v_old_raw jsonb;
  v_new_raw jsonb;
  v_old jsonb;
  v_new jsonb;
  v_changed text[] := '{}';
  v_key text;
  v_actor_name text;
  v_equipment_id uuid;
  v_equipment_code text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- 0214: the unit is gone when this AFTER trigger runs, so its id cannot
    -- be stored (the foreign key would refuse the row and with it the
    -- delete). The code and the old snapshot keep the record readable.
    v_equipment_id := NULL;
    v_equipment_code := OLD.code;
  ELSE
    v_equipment_id := NEW.id;
    v_equipment_code := NEW.code;
  END IF;

  SELECT full_name INTO v_actor_name
  FROM public.profile_names
  WHERE id = auth.uid();

  IF TG_OP <> 'INSERT' THEN
    v_old_raw := to_jsonb(OLD) - c_skipped;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_raw := to_jsonb(NEW) - c_skipped;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_old_raw || v_new_raw) LOOP
      IF v_old_raw -> v_key IS DISTINCT FROM v_new_raw -> v_key THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    -- Only skipped columns moved (updated_at alone, a plate re-normalised to
    -- the same value): no row.
    IF cardinality(v_changed) = 0 THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_changed := ARRAY(
      SELECT k FROM jsonb_object_keys(jsonb_strip_nulls(v_new_raw)) AS k
      ORDER BY k
    );
  ELSE
    v_changed := ARRAY(
      SELECT k FROM jsonb_object_keys(jsonb_strip_nulls(v_old_raw)) AS k
      ORDER BY k
    );
  END IF;

  -- Only the changed keys, with the two foreign keys as readable names.
  SELECT
    CASE WHEN v_old_raw IS NULL THEN NULL
         ELSE public.equipment_audit_display(v_old_raw, v_changed) END,
    CASE WHEN v_new_raw IS NULL THEN NULL
         ELSE public.equipment_audit_display(v_new_raw, v_changed) END
  INTO v_old, v_new;

  INSERT INTO public.equipment_audit_logs(
    equipment_id, equipment_code, action, actor_id, actor_name,
    old_values, new_values, changed_fields
  ) VALUES (
    v_equipment_id,
    v_equipment_code,
    CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
    auth.uid(),
    v_actor_name,
    v_old,
    v_new,
    v_changed
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_equipment_change() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.audit_equipment_change() IS
  '0168 / 0214: AFTER INSERT / UPDATE / DELETE trigger of public.equipment writing '
  'equipment_audit_logs. Compares to_jsonb(OLD) and to_jsonb(NEW) without the '
  'derived columns (id, created_at, updated_at, plate_digits, '
  'plate_letters_en, numbering_status, type_search) and stores the changed '
  'keys only; an UPDATE that changes nothing writes no row. A DELETE row '
  'carries equipment_id NULL (the unit is gone) with its code and old values. '
  'Actor from auth.uid() (NULL for a service-role or migration write).';
