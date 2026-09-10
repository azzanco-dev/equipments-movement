-- Merge the duplicate "boom truck 10ton" spelling into the existing
-- "boom truck 10 ton" equipment type without losing equipment links.
DO $$
DECLARE
  v_target_name text;
BEGIN
  SELECT name
  INTO v_target_name
  FROM public.equipment_types
  WHERE lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) =
    'boom truck 10 ton'
  ORDER BY created_at, id
  LIMIT 1;

  IF v_target_name IS NULL THEN
    v_target_name := 'boom truck 10 ton';
    INSERT INTO public.equipment_types(name)
    VALUES (v_target_name);
  END IF;

  UPDATE public.equipment
  SET type = v_target_name
  WHERE lower(regexp_replace(btrim(type), '\s+', ' ', 'g')) =
    'boom truck 10ton';

  DELETE FROM public.equipment_types
  WHERE lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) =
    'boom truck 10ton';
END;
$$;
