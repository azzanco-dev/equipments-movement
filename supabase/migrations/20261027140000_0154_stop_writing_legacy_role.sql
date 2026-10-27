-- 0154 — roles, stage 4c-1: nothing writes profiles.role any more.
--
-- Owner decision 2026-10-27 (retiring the legacy role in stages, «ابدا بـ
-- 4c»; «اهم شي مايتغير شي على المستخدمين»). Apply AFTER the create-user /
-- manage-user Edge Functions and the screens of this stage are live: the
-- new create-user assigns the chosen role itself (admin_assign_profile_role
-- as the caller), manage-user no longer writes the role, and the screens
-- change a role through the assignment only (0153).
--   A. handle_new_user (latest 0084) writes the narrowest placeholder
--      `monitor` into the legacy column for every new account; the column is
--      NOT NULL until it is dropped (stage 4c-2) and nothing reads it. The
--      role that decides is the assignment.
--   B. The 0126/0151 sync trigger, which copied profiles.role into the
--      assignment, goes: a new account holds no role until one is assigned
--      (fail closed; create-user assigns it right away), and the legacy
--      column is never copied again.
--   C. admin_set_user_role (latest 0127), the legacy role writer of the
--      users screens, has no caller left and goes.
-- Existing users keep their assignments; nobody's access changes.

-- ===========================================================================
-- A. New accounts: a placeholder legacy value only
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles(id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'monitor'
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Trigger on auth.users (0154): inserts the profile with the placeholder legacy role monitor; the role that decides is the profile_roles assignment, set by create-user through admin_assign_profile_role. No account gets a role from metadata.';

-- ===========================================================================
-- B. No copy of the legacy role into the assignment
-- ===========================================================================
DROP TRIGGER IF EXISTS sync_profile_role_assignment ON public.profiles;
DROP FUNCTION IF EXISTS public.sync_profile_role_assignment();

-- ===========================================================================
-- C. The legacy role writer
-- ===========================================================================
DROP FUNCTION IF EXISTS public.admin_set_user_role(uuid, text);
