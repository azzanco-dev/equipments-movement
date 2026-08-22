REVOKE ALL ON FUNCTION public.get_all_equipment_last_movement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_all_equipment_last_movement() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_all_equipment_last_movement() TO authenticated;