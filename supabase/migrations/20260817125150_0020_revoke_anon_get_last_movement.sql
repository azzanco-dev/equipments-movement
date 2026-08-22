REVOKE ALL ON FUNCTION public.get_last_movement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_last_movement(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_last_movement(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;