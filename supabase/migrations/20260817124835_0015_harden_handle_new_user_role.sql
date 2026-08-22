CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text := 'supervisor';
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'admin_created', 'false') = 'true'
     AND NEW.raw_user_meta_data->>'role' IN ('admin', 'supervisor') THEN
    v_role := NEW.raw_user_meta_data->>'role';
  END IF;

  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    v_role
  );
  RETURN NEW;
END;
$function$;