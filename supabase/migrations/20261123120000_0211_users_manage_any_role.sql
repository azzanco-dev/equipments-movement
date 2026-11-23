-- 0211: «ادارة المستخدمين» can be given to any role (owner 2026-11-23,
-- «ادارة المستخدمين (للادمن) ابغى اعطي الصلاحية لاي احد»).
--
-- 1. `users.manage` is no longer `admin_only`: the roles page offers it to
--    every role (admin_set_role_permissions reads the flag; settings.roles
--    stays admin only, so only the admin edits roles).
-- 2. admin_assign_profile_role (0153 verbatim, plus the second path): the
--    admin (is_admin AND settings.roles) assigns any role as before; a
--    holder of users.manage who is NOT the admin may assign roles too, so
--    he can add users and change their role, but
--      * never the admin role          → admin_role_admin_only (42501)
--      * never to or from an admin user → admin_role_admin_only (42501)
--      * never his own role            → cannot_change_own_role (55000)
--    so the permission cannot be used to become the admin or to strip one.
--    The Edge Functions (create-user, manage-user) apply the same rule to
--    an admin's login details (manage-user refuses a non-admin caller on an
--    admin target).
-- 3. profiles: update_profiles and delete_profiles (0127) keep users.manage,
--    and a caller who is not the admin cannot update or delete an ADMIN's
--    profile (definer helper profile_is_admin_user, outside the caller's
--    RLS). His own row stays editable as before.
-- Nothing changes for the admin. Apply BEFORE deploying the Edge Functions
-- and the screens of the same commit.

UPDATE public.permissions
SET admin_only = false
WHERE key = 'users.manage';

COMMENT ON COLUMN public.permissions.admin_only IS
  'True for keys that only the admin role may hold (settings.roles; users.manage until 0211).';

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
  v_caller_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may assign roles.';
  END IF;

  v_caller_admin := public.is_admin() IS TRUE
    AND public.has_permission('settings.roles') IS TRUE;

  -- 0211: a holder of users.manage may assign roles too, within limits.
  IF NOT v_caller_admin
     AND public.has_permission('users.manage') IS NOT TRUE THEN
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

  SELECT pr.role_key INTO v_current
  FROM public.profile_roles pr
  WHERE pr.profile_id = p_profile_id;

  IF NOT v_caller_admin THEN
    IF p_profile_id = auth.uid() THEN
      RAISE EXCEPTION 'cannot_change_own_role' USING ERRCODE = '55000',
        HINT = 'You cannot change the role of your own account.';
    END IF;
    IF v_role.key = 'admin' OR v_current = 'admin' THEN
      RAISE EXCEPTION 'admin_role_admin_only' USING ERRCODE = '42501',
        HINT = 'Only an administrator may give or take the admin role.';
    END IF;
  END IF;

  IF p_profile_id = auth.uid() AND v_role.key <> 'admin' THEN
    RAISE EXCEPTION 'cannot_change_own_admin' USING ERRCODE = '55000',
      HINT = 'You cannot take the admin role away from your own account.';
  END IF;

  -- 0153: the last admin keeps the admin role (it was manage-user's rule on
  -- the legacy role).
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
  'Assigns a user''s one role (0153; 0211: also a holder of users.manage who is not the admin, never the admin role, never an admin user, never his own role).';

-- ===========================================================================
-- 3. profiles: an admin's row is the admin's alone
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.profile_is_admin_user(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_roles pr
    WHERE pr.profile_id = p_profile_id
      AND pr.role_key = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.profile_is_admin_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_is_admin_user(uuid) TO authenticated;

COMMENT ON FUNCTION public.profile_is_admin_user(uuid) IS
  '0211: whether a profile holds the admin role (profile_roles), read outside the caller''s RLS for the profiles policies.';

DROP POLICY IF EXISTS update_profiles ON public.profiles;
CREATE POLICY update_profiles ON public.profiles
FOR UPDATE TO authenticated
USING (
  auth.uid() = id
  OR (
    (SELECT public.has_permission('users.manage'))
    AND ((SELECT public.has_permission('settings.roles')) OR NOT public.profile_is_admin_user(id))
  )
)
WITH CHECK (
  auth.uid() = id
  OR (
    (SELECT public.has_permission('users.manage'))
    AND ((SELECT public.has_permission('settings.roles')) OR NOT public.profile_is_admin_user(id))
  )
);
COMMENT ON POLICY update_profiles ON public.profiles IS
  '0211: own row, or users.manage (0127); an admin''s row only by the admin.';

DROP POLICY IF EXISTS delete_profiles ON public.profiles;
CREATE POLICY delete_profiles ON public.profiles
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('users.manage'))
  AND ((SELECT public.has_permission('settings.roles')) OR NOT public.profile_is_admin_user(id))
);
COMMENT ON POLICY delete_profiles ON public.profiles IS
  '0211: users.manage (0127); an admin''s row only by the admin.';
