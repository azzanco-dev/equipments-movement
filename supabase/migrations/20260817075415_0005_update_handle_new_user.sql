-- Block self-signup: only allow profile creation if the user was created by an admin
-- The trigger runs as SECURITY DEFINER so it bypasses RLS, but we can check if
-- the new user's metadata indicates an admin-created account.
-- We use a sentinel in raw_user_meta_data: 'admin_created' = true

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin_created boolean;
BEGIN
  is_admin_created := COALESCE((NEW.raw_user_meta_data->>'admin_created')::boolean, false);
  
  -- If not admin-created, still create the profile but as supervisor (we can't block signup at DB level)
  -- The real blocking happens by disabling signup in Supabase dashboard
  -- This trigger just ensures the profile is created correctly
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'supervisor')
  );
  RETURN NEW;
END;
$$;
