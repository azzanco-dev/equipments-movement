-- 0153 — roles, stage 4b: a role is changed through the assignment only.
--
-- Owner decision 2026-10-27 (retiring the legacy role in stages, «ابدا بـ
-- 4b»; «اهم شي مايتغير شي على المستخدمين»). From this stage the user screens
-- change a user's role with admin_assign_profile_role alone and never write
-- profiles.role again (it keeps whatever it holds until the column is
-- dropped in stage 4c). The 0126 function tied the admin assignment to the
-- legacy admin role ("admin parity") so the two could not drift; nothing
-- reads the legacy value any more (is_admin() reads the assignment since
-- 0150), so the parity check goes. In its place the function itself keeps
-- the rule manage-user enforced: the last admin cannot lose the admin role.
-- Everything else is the 0126 body verbatim (the admin and settings.roles
-- gate, the advisory lock, user_not_found, role_not_found, role_inactive,
-- cannot_change_own_admin, the upsert and its audit trigger).

CREATE OR REPLACE FUNCTION public.admin_assign_profile_role(
  p_profile_id uuid,
  p_role_key text
)
RETURNS public.profile_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role public.roles;
  v_current text;
  v_assignment public.profile_roles;
BEGIN
  IF auth.uid() IS NULL
     OR public.is_admin() IS NOT TRUE
     OR public.has_permission('settings.roles') IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may assign roles.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('roles_system', 0));

  PERFORM 1
  FROM public.profiles p
  WHERE p.id = p_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_role FROM public.roles WHERE key = p_role_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'role_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_role.is_active THEN
    RAISE EXCEPTION 'role_inactive' USING ERRCODE = '55000',
      HINT = 'Activate the role before assigning it.';
  END IF;

  IF p_profile_id = auth.uid() AND v_role.key <> 'admin' THEN
    RAISE EXCEPTION 'cannot_change_own_admin' USING ERRCODE = '55000',
      HINT = 'You cannot take the admin role away from your own account.';
  END IF;

  -- 0153: the last admin keeps the admin role (it was manage-user's rule on
  -- the legacy role).
  SELECT pr.role_key INTO v_current
  FROM public.profile_roles pr
  WHERE pr.profile_id = p_profile_id;
  IF v_current = 'admin'
     AND v_role.key <> 'admin'
     AND NOT EXISTS (
       SELECT 1
       FROM public.profile_roles other
       WHERE other.role_key = 'admin'
         AND other.profile_id <> p_profile_id
     ) THEN
    RAISE EXCEPTION 'last_admin' USING ERRCODE = '55000',
      HINT = 'At least one admin is required.';
  END IF;

  INSERT INTO public.profile_roles AS pr (profile_id, role_key, assigned_at, assigned_by)
  VALUES (p_profile_id, v_role.key, now(), auth.uid())
  ON CONFLICT (profile_id) DO UPDATE
    SET role_key = EXCLUDED.role_key,
        assigned_at = EXCLUDED.assigned_at,
        assigned_by = EXCLUDED.assigned_by
    WHERE pr.role_key IS DISTINCT FROM EXCLUDED.role_key;

  SELECT * INTO v_assignment FROM public.profile_roles WHERE profile_id = p_profile_id;
  RETURN v_assignment;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_profile_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_profile_role(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_assign_profile_role(uuid, text) IS
  'Admin-only (0126, 0153). Sets a user''s one role (profile_roles). Since 0153 it never looks at profiles.role (no admin parity); the last admin cannot lose the admin role and an admin cannot take it from himself. Codes: admin_required (42501), user_not_found, role_not_found (P0002), role_inactive, cannot_change_own_admin, last_admin (55000).';
