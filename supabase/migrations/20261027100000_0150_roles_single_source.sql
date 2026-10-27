-- 0150 — roles, stage 1: the assigned role is the only source of access.
--
-- Owner decision 2026-10-27 («نبغى نشيل التقسيم هذا وتكون كلها واحد», then
-- «ابدا بالمرحلة الاولى، والادمن يبقى مقفول ما ينحذف» and «بس اهم شي
-- مايتغير شي على المستخدمين»): every role becomes equal and a user's ONE
-- role is his `profile_roles` assignment; the legacy `profiles.role` stops
-- deciding anything and is retired in later stages.
--
-- Stage 1 changes WHERE access is read from, never what anybody holds:
--   A. Guards: the roles system must be ON and every legacy admin must hold
--      the admin assignment and the reverse (the 0126 parity). Otherwise
--      the whole migration aborts and nothing changes.
--   B. is_admin(): the admin ASSIGNMENT, not profiles.role. Equal answers
--      under the parity of A.
--   C. permission_scope() / current_permissions(): the assignment only; the
--      flag-off branch through legacy_role_permissions(profiles.role) is
--      gone. Equal answers while the flag is ON (A).
--   D. set_roles_system_enabled(): the system can no longer be switched
--      off (it would have revived the legacy grants).
-- Left for the next stages, unchanged here: the sync trigger and the admin
-- parity checks (the user screens and the Edge Functions still write
-- profiles.role), the select_profiles policy, the legacy preview /
-- offenders functions, the system-role lock of the five non-admin roles,
-- and the column itself. The admin role stays locked for good.

-- ===========================================================================
-- A. Guards
-- ===========================================================================
DO $$
DECLARE
  v_mismatch integer;
BEGIN
  IF NOT public.roles_system_enabled() THEN
    RAISE EXCEPTION
      '0150: the roles system is not enabled; this migration would change access';
  END IF;

  SELECT count(*) INTO v_mismatch
  FROM public.profiles p
  LEFT JOIN public.profile_roles pr ON pr.profile_id = p.id
  WHERE (p.role = 'admin') IS DISTINCT FROM (pr.role_key = 'admin')
    AND (p.role = 'admin' OR pr.role_key = 'admin');

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION
      '0150: % user(s) where the legacy admin role and the admin assignment differ',
      v_mismatch;
  END IF;
END;
$$;

-- ===========================================================================
-- B. is_admin(): the admin assignment
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_roles
    WHERE profile_id = auth.uid()
      AND role_key = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

COMMENT ON FUNCTION public.is_admin() IS
  'True when the caller''s assigned role (profile_roles) is admin (0150; it read profiles.role before). The admin role is a locked system role: it cannot be deleted or deactivated.';

-- ===========================================================================
-- C. permission_scope() / current_permissions(): the assignment only
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.permission_scope(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_key IS NULL OR auth.uid() IS NULL THEN NULL
    ELSE (
      SELECT COALESCE(rp.scope, 'all')
      FROM public.profile_roles pr
      JOIN public.roles r
        ON r.key = pr.role_key
       AND r.is_active
      JOIN public.role_permissions rp
        ON rp.role_key = pr.role_key
       AND rp.permission_key = p_key
      WHERE pr.profile_id = auth.uid()
      LIMIT 1
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.permission_scope(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.permission_scope(text) TO authenticated;

COMMENT ON FUNCTION public.permission_scope(text) IS
  'The caller''s scope for a permission key: all, site, workshop, companies or own; ''all'' for a granted unscoped key; NULL when not granted. Read from profile_roles -> active role -> role_permissions only (0150; the flag-off branch through legacy_role_permissions(profiles.role) of 0126 is gone). No session, no assignment, an inactive role or an unknown key: NULL.';

CREATE OR REPLACE FUNCTION public.current_permissions()
RETURNS TABLE(permission_key text, scope text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT rp.permission_key, COALESCE(rp.scope, 'all')
  FROM public.profile_roles pr
  JOIN public.roles r
    ON r.key = pr.role_key
   AND r.is_active
  JOIN public.role_permissions rp ON rp.role_key = pr.role_key
  WHERE pr.profile_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_permissions() TO authenticated;

COMMENT ON FUNCTION public.current_permissions() IS
  'Every permission of the caller with its scope (''all'' for an unscoped key), for the client to load once after sign-in. From the assigned role only (0150). Same answer as permission_scope() key by key.';

-- ===========================================================================
-- D. The roles system stays on
-- ===========================================================================
-- A wrapper in front of the 0126 function (renamed, body untouched): turning
-- the system off is refused before anything else; turning it on still runs
-- every 0126 check.
ALTER FUNCTION public.set_roles_system_enabled(boolean, integer)
  RENAME TO set_roles_system_enabled_0126;

REVOKE ALL ON FUNCTION public.set_roles_system_enabled_0126(boolean, integer)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_roles_system_enabled(
  p_enabled boolean,
  p_expected_preview_rows integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR public.is_admin() IS NOT TRUE
     OR public.has_permission('settings.roles') IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may activate the roles system.';
  END IF;
  IF p_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'roles_system_permanent'
      USING ERRCODE = '55000',
            HINT = 'Since 0150 the assigned role is the only source of access; the roles system cannot be switched off.';
  END IF;
  RETURN public.set_roles_system_enabled_0126(p_enabled, p_expected_preview_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.set_roles_system_enabled(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_roles_system_enabled(boolean, integer) TO authenticated;

COMMENT ON FUNCTION public.set_roles_system_enabled(boolean, integer) IS
  'Admin-only. Since 0150 it refuses to switch the roles system off (roles_system_permanent, 55000); switching it on still runs the 0126 checks (set_roles_system_enabled_0126, not callable by clients).';
