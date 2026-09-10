-- User access is no longer linked to projects. Site movements continue to
-- select their project independently, and supervisor company assignments stay.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := 'supervisor';
BEGIN
  IF NEW.raw_user_meta_data->>'admin_created' = 'true'
     AND NEW.raw_user_meta_data->>'role' IN (
       'admin',
       'supervisor',
       'workshop',
       'assistant_workshop_manager',
       'workshop_manager',
       'monitor'
     ) THEN
    v_role := NEW.raw_user_meta_data->>'role';
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

CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_user_id uuid,
  p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  IF p_role NOT IN (
    'admin',
    'supervisor',
    'workshop',
    'assistant_workshop_manager',
    'workshop_manager',
    'monitor'
  ) THEN
    RAISE EXCEPTION 'invalid role';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot change your own role';
  END IF;

  UPDATE public.profiles
  SET role = p_role
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text)
  TO authenticated;

DROP TABLE IF EXISTS public.profile_projects;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS project_id;
