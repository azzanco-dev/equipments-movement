/*
# Stop users from writing their own role

## Problem
The `update_profiles` policy is `USING (auth.uid() = id OR is_admin())`, and a row
level rule permits writing every column of a permitted row. `authenticated` held
UPDATE on all columns of `profiles`, so any signed-in user could PATCH their own
row with `{"role":"admin"}` and gain every admin capability, because `is_admin()`
reads exactly that column.

## Change
- Revoke table-wide UPDATE on `profiles` from `authenticated` and re-grant it on
  `full_name` only. SELECT/INSERT/DELETE are untouched, so no read breaks.
- Add `admin_set_user_role(uuid, text)` as SECURITY DEFINER, which verifies the
  caller is an admin, validates the role value and refuses to change the caller's
  own role. The admin users screen calls this instead of a direct update.
*/

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

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
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION 'invalid role';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot change your own role';
  END IF;

  UPDATE public.profiles SET role = p_role WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated;
