-- 0151 — roles, stage 2: every role equal but the admin.
--
-- Owner decision 2026-10-27 («نبغى نشيل التقسيم هذا وتكون كلها واحد», then
-- «ابدا بالمرحلة الاولى، والادمن يبقى مقفول ما ينحذف», «اهم شي مايتغير شي
-- على المستخدمين» and «ابدا» for stage 2). Nobody's access changes:
--   A. The five non-admin original roles (supervisor, workshop,
--      assistant_workshop_manager, workshop_manager, monitor) stop being
--      locked system roles: like any custom role they can be deactivated or
--      deleted once nobody holds them (admin_upsert_role / admin_delete_role
--      already refuse a role in use). Their keys, names and permissions stay.
--      The admin role stays locked for good.
--   B. sync_profile_role_assignment (latest 0126) copies the legacy
--      profiles.role into the assignment only while a role with that key
--      still exists, so a deleted original role can never break creating or
--      changing a user (the screens and the Edge Functions still write the
--      legacy column until the next stage). The rest of the body is 0126
--      verbatim.
--   C. select_profiles (latest 0127): the workshop scope of users.read reads
--      the target's ASSIGNED role, not his legacy profiles.role. Same keys,
--      so the same rows for everybody whose assignment is one of the three
--      workshop roles.

-- ===========================================================================
-- A. Only the admin role stays a locked system role
-- ===========================================================================
UPDATE public.roles
SET is_system = false,
    updated_at = now()
WHERE key IN (
  'supervisor',
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
  'monitor'
)
  AND is_system;

COMMENT ON COLUMN public.roles.is_system IS
  'True for the admin role only since 0151 (it was the six legacy roles, 0126): a system role cannot be deleted or deactivated. The five other original roles are ordinary roles.';

-- ===========================================================================
-- B. The legacy sync never points at a missing role
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.sync_profile_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current text;
  v_found boolean;
BEGIN
  -- 0151: a legacy value whose role was deleted is not copied; the user's
  -- assignment is set with admin_assign_profile_role instead.
  IF NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.key = NEW.role) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.profile_roles (profile_id, role_key, assigned_by)
    VALUES (NEW.id, NEW.role, auth.uid())
    ON CONFLICT (profile_id) DO NOTHING;
    RETURN NULL;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    SELECT pr.role_key INTO v_current
    FROM public.profile_roles pr
    WHERE pr.profile_id = NEW.id
    FOR UPDATE;
    v_found := FOUND;

    -- Flag OFF: the legacy editor is the only editor, so the assignment
    -- always follows the legacy role. Flag ON: it follows only when it was
    -- never customised (it still equals the old legacy role) or for a move
    -- to or from admin (admin parity); any other legacy change is refused,
    -- the assignment is changed with admin_assign_profile_role instead.
    IF public.roles_system_enabled()
       AND NEW.role <> 'admin'
       AND OLD.role <> 'admin'
       AND v_found
       AND v_current IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'roles_system_active_use_assignment'
        USING ERRCODE = '55000',
              HINT = 'The roles system is active: change the user''s role assignment instead of the account role.';
    END IF;

    INSERT INTO public.profile_roles AS pr (profile_id, role_key, assigned_at, assigned_by)
    VALUES (NEW.id, NEW.role, now(), auth.uid())
    ON CONFLICT (profile_id) DO UPDATE
      SET role_key = EXCLUDED.role_key,
          assigned_at = EXCLUDED.assigned_at,
          assigned_by = EXCLUDED.assigned_by
      WHERE pr.role_key IS DISTINCT FROM EXCLUDED.role_key;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_role_assignment() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sync_profile_role_assignment() IS
  'Trigger on profiles (0126, 0151). A new profile gets its legacy role as assignment. A legacy role change: flag off, the assignment always follows; flag on, it follows when it still equals the old legacy role or the change is to or from admin (admin parity), otherwise the change is refused with roles_system_active_use_assignment (55000). Since 0151 nothing is copied when no role carries the legacy value (a deleted original role). Not executable by client roles.';

-- ===========================================================================
-- C. select_profiles: the workshop scope by the assigned role
-- ===========================================================================
DROP POLICY IF EXISTS select_profiles ON public.profiles;
CREATE POLICY select_profiles ON public.profiles
FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR (SELECT public.permission_scope('users.read')) = 'all'
  OR (
    (SELECT public.permission_scope('users.read')) = 'workshop'
    AND EXISTS (
      SELECT 1
      FROM public.profile_roles pr
      WHERE pr.profile_id = profiles.id
        AND pr.role_key IN ('workshop', 'assistant_workshop_manager', 'workshop_manager')
    )
  )
);
COMMENT ON POLICY select_profiles ON public.profiles IS
  '0151: the workshop scope of users.read reads the target''s assigned role (profile_roles), not profiles.role (0127). Own row, users.read all: every row.';
