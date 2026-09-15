-- raw_user_meta_data is writable by anyone calling auth.signUp, so it must not
-- decide the profile role. The create-user Edge Function now sends the role in
-- app_metadata, which only the service role can set.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := 'supervisor';
BEGIN
  IF NEW.raw_app_meta_data->>'admin_created' = 'true'
     AND NEW.raw_app_meta_data->>'role' IN (
       'admin',
       'supervisor',
       'workshop',
       'assistant_workshop_manager',
       'workshop_manager',
       'monitor'
     ) THEN
    v_role := NEW.raw_app_meta_data->>'role';
  END IF;

  INSERT INTO public.profiles(id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    v_role
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;
