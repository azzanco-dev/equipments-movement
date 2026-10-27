-- 0152 — roles, stage 3: profile_names shows the ASSIGNED role.
--
-- Owner decision 2026-10-27 (retiring the legacy role in stages, «ابدا
-- بالمرحلة الثالثة»; «اهم شي مايتغير شي على المستخدمين»). The name-only
-- view of 0099 keeps its three columns (its rule: never add a column), but
-- `role` is now the user's assignment (`profile_roles.role_key`) instead of
-- the legacy `profiles.role`; NULL for a user without assignment. Its only
-- readers are the foreman pickers, which from this stage list the users
-- whose role records project movements (a permission, not a role name), so
-- a custom foreman role shows there too. For the six original roles the
-- value is the same key as before (the legacy role and the assignment were
-- kept equal for them). The view no longer depends on profiles.role.

CREATE OR REPLACE VIEW public.profile_names
WITH (security_invoker = false)
AS
SELECT
  p.id,
  p.full_name,
  pr.role_key AS role
FROM public.profiles p
LEFT JOIN public.profile_roles pr ON pr.profile_id = p.id;

REVOKE ALL ON public.profile_names FROM PUBLIC, anon;
GRANT SELECT ON public.profile_names TO authenticated;

COMMENT ON VIEW public.profile_names IS
  'Display names only: id, full_name, role. DELIBERATE, REVIEWED EXCEPTION - '
  'this is the one view that runs with owner rights (security_invoker = '
  'false), so a signed-in user can resolve the name of the person who '
  'recorded a movement they may already read, which select_profiles (0076) '
  'would otherwise hide. Never add a column: email, phone and every other '
  'profile field stay behind select_profiles. Readable by authenticated only; '
  'anon is revoked. Since 0152 role is the assigned role '
  '(profile_roles.role_key), NULL without assignment, not profiles.role.';
