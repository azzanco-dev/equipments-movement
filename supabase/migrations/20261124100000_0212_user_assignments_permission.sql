-- 0212: «اسناد الشركات والمشاريع» as a task of its own (owner 2026-11-24,
-- «نبغى نخلي اسنادات الشركات والمشاريع للمستخدمين مهمة منفصلة عن صفحة
-- المستخدم، لانها ممكن تنسند لادوار غير الادمن»; plan and Figma design
-- approved «اعتمد وابني»).
--
-- 1. The permission key `users.assignments` («المستخدمون: اسناد الشركات
--    والمشاريع», group users, unscoped, no prerequisite, enforced in the
--    database, held by the admin role, NOT admin only: it can be given to any
--    role without the whole «ادارة المستخدمين»).
-- 2. admin_set_profile_assignments (0176 verbatim plus the new gate): the
--    caller holds users.manage OR users.assignments. A caller who is not the
--    admin (is_admin AND settings.roles) can never change his OWN assignments
--    (cannot_change_own_assignments, 55000: the companies widen what a
--    `movements.read` scope of `companies` reads) nor an ADMIN's
--    (admin_role_admin_only, 42501, the 0211 rule). Nothing changes for the
--    admin. The token of a caller without either key stays
--    users_manage_required (42501), so the screens of before map it as
--    before.
-- 3. The read of the new Settings page: the view `user_assignment_list`, one
--    row per user who is not an admin, with the role, whether the role
--    records project movements, and the assignments as JSON. It runs with
--    its owner's rights (security_invoker = false, like profile_names) and
--    returns rows ONLY to a caller holding users.manage or users.assignments
--    (the gate is in its WHERE), so neither profiles nor profile_companies,
--    profile_projects or profile_roles needs a wider policy.
--
-- Nothing changes the movement form (it reads the caller's own
-- profile_assignments as before), the manage-user Edge Function or any
-- policy. Apply BEFORE deploying the screens of the same commit (they read
-- the view); the screens live before it keep working.

-- ===========================================================================
-- 1. The permission key, held by the admin role (the 0197 shape)
-- ===========================================================================
INSERT INTO public.permissions (
  key, group_key, name_ar, name_en, description_ar, description_en,
  scoped, scopes, requires, admin_only, enforced_in, sort
) VALUES (
  'users.assignments', 'users',
  'المستخدمون: اسناد الشركات والمشاريع', 'Users: company and project assignments',
  'تحديد الشركات والمشاريع اللي يختار منها كل مستخدم في نموذج الحركة، من الاعدادات. ما يقدر يعدل اسناد حسابه ولا حساب ادمن.',
  'Set the companies and projects each user picks from in the movement form, from Settings. Never the holder''s own assignments or an admin''s.',
  false, NULL, '{}', false, 'database', 715
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_key, permission_key, scope)
VALUES ('admin', 'users.assignments', NULL)
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- ===========================================================================
-- 2. admin_set_profile_assignments: 0176 verbatim plus the gate of 0212
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.admin_set_profile_assignments(
  p_profile_id uuid,
  p_company_ids uuid[],
  p_project_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_ids uuid[];
  v_project_ids uuid[];
  v_caller_admin boolean;
BEGIN
  -- 0212: users.manage OR users.assignments.
  IF auth.uid() IS NULL
     OR (public.has_permission('users.manage') IS NOT TRUE
         AND public.has_permission('users.assignments') IS NOT TRUE) THEN
    RAISE EXCEPTION 'users_manage_required'
      USING ERRCODE = '42501',
            HINT = 'Assigning companies and projects requires users.manage or users.assignments.';
  END IF;

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'invalid_profile' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles p
  WHERE p.id = p_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_profile' USING ERRCODE = '22023';
  END IF;

  -- 0212: a caller who is not the admin never changes his own assignments
  -- nor an admin's (the 0211 rule of admin_assign_profile_role).
  v_caller_admin := public.is_admin() IS TRUE
    AND public.has_permission('settings.roles') IS TRUE;
  IF NOT v_caller_admin THEN
    IF p_profile_id = auth.uid() THEN
      RAISE EXCEPTION 'cannot_change_own_assignments' USING ERRCODE = '55000',
        HINT = 'You cannot change the companies and projects of your own account.';
    END IF;
    IF public.profile_is_admin_user(p_profile_id) THEN
      RAISE EXCEPTION 'admin_role_admin_only' USING ERRCODE = '42501',
        HINT = 'Only an administrator may change an administrator''s assignments.';
    END IF;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::uuid[])
    INTO v_company_ids
  FROM unnest(COALESCE(p_company_ids, ARRAY[]::uuid[])) AS c
  WHERE c IS NOT NULL;

  SELECT COALESCE(array_agg(DISTINCT pr), ARRAY[]::uuid[])
    INTO v_project_ids
  FROM unnest(COALESCE(p_project_ids, ARRAY[]::uuid[])) AS pr
  WHERE pr IS NOT NULL;

  -- Every company exists.
  IF EXISTS (
    SELECT 1
    FROM unnest(v_company_ids) AS c(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.companies co WHERE co.id = c.id)
  ) THEN
    RAISE EXCEPTION 'invalid_company' USING ERRCODE = '22023';
  END IF;

  -- Every project exists ...
  IF EXISTS (
    SELECT 1
    FROM unnest(v_project_ids) AS pr(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pr.id)
  ) THEN
    RAISE EXCEPTION 'invalid_project' USING ERRCODE = '22023';
  END IF;

  -- ... and belongs to one of the given companies.
  IF EXISTS (
    SELECT 1
    FROM unnest(v_project_ids) AS pr(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.company_projects cp
      WHERE cp.project_id = pr.id
        AND cp.company_id = ANY (v_company_ids)
    )
  ) THEN
    RAISE EXCEPTION 'project_company_not_assigned'
      USING ERRCODE = '23503',
            HINT = 'Every project must belong to one of the given companies.';
  END IF;

  -- 1. The companies that join.
  INSERT INTO public.profile_companies (profile_id, company_id)
  SELECT p_profile_id, c.id
  FROM unnest(v_company_ids) AS c(id)
  ON CONFLICT (profile_id, company_id) DO NOTHING;

  -- 2. The companies that leave (the 0176 trigger prunes their project rows).
  DELETE FROM public.profile_companies pc
  WHERE pc.profile_id = p_profile_id
    AND pc.company_id <> ALL (v_company_ids);

  -- 3. The projects that leave.
  DELETE FROM public.profile_projects pp
  WHERE pp.profile_id = p_profile_id
    AND pp.project_id <> ALL (v_project_ids);

  -- 4. The projects that join (the 0176 trigger checks each against the
  -- company set).
  INSERT INTO public.profile_projects (profile_id, project_id)
  SELECT p_profile_id, pr.id
  FROM unnest(v_project_ids) AS pr(id)
  ON CONFLICT (profile_id, project_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_profile_assignments(uuid, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_assignments(uuid, uuid[], uuid[]) TO authenticated;

COMMENT ON FUNCTION public.admin_set_profile_assignments(uuid, uuid[], uuid[]) IS
  '0176 / 0212: the single write path of a user''s companies and projects. Needs users.manage or users.assignments (users_manage_required 42501). A caller who is not the admin never changes his own assignments (cannot_change_own_assignments 55000) nor an admin''s (admin_role_admin_only 42501). Replaces the user''s profile_companies and profile_projects rows with the given sets in one transaction. The profile must exist (invalid_profile), every company (invalid_company) and every project (invalid_project) must exist, and every project must belong to one of the given companies (project_company_not_assigned 23503). NULL arrays = empty sets.';

-- ===========================================================================
-- 3. The read of Settings › «اسناد الشركات والمشاريع»
-- ===========================================================================
-- One row per user who is not an admin. `records_projects`: the user's
-- ACTIVE role holds movements.site.create (the foremen; the list's default
-- filter). `assignments`: one object per linked company, ordered by its
-- Arabic name, with the narrowed projects of that company (empty = all of
-- them), as profile_assignments gives them. `company_ids` feeds the company
-- filter (overlaps). The WHERE gate returns nothing to a caller without
-- users.manage or users.assignments.
CREATE OR REPLACE VIEW public.user_assignment_list
WITH (security_invoker = false)
AS
SELECT
  p.id,
  p.full_name,
  public.normalize_search_text(p.full_name) AS full_name_search,
  pr.role_key,
  r.name_ar AS role_name_ar,
  r.name_en AS role_name_en,
  COALESCE(
    r.is_active AND EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role_key = r.key
        AND rp.permission_key = 'movements.site.create'
    ),
    false
  ) AS records_projects,
  COALESCE(a.company_ids, ARRAY[]::uuid[]) AS company_ids,
  COALESCE(cardinality(a.company_ids), 0) > 0 AS has_assignments,
  COALESCE(a.assignments, '[]'::jsonb) AS assignments
FROM public.profiles p
LEFT JOIN public.profile_roles pr ON pr.profile_id = p.id
LEFT JOIN public.roles r ON r.key = pr.role_key
LEFT JOIN LATERAL (
  SELECT
    array_agg(pc.company_id ORDER BY co.name_ar, co.id) AS company_ids,
    jsonb_agg(
      jsonb_build_object(
        'company_id', pc.company_id,
        'company_name_ar', co.name_ar,
        'company_name_en', co.name_en,
        'project_ids', COALESCE(np.project_ids, '[]'::jsonb),
        'project_names_ar', COALESCE(np.project_names_ar, '[]'::jsonb),
        'project_names_en', COALESCE(np.project_names_en, '[]'::jsonb)
      )
      ORDER BY co.name_ar, co.id
    ) AS assignments
  FROM public.profile_companies pc
  JOIN public.companies co ON co.id = pc.company_id
  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(prj.id ORDER BY prj.name_ar, prj.id) AS project_ids,
      jsonb_agg(prj.name_ar ORDER BY prj.name_ar, prj.id) AS project_names_ar,
      jsonb_agg(prj.name_en ORDER BY prj.name_ar, prj.id) AS project_names_en
    FROM public.profile_projects pp
    JOIN public.company_projects cp
      ON cp.project_id = pp.project_id
     AND cp.company_id = pc.company_id
    JOIN public.projects prj ON prj.id = pp.project_id
    WHERE pp.profile_id = pc.profile_id
  ) np ON true
  WHERE pc.profile_id = p.id
) a ON true
WHERE pr.role_key IS DISTINCT FROM 'admin'
  AND (
    (SELECT public.has_permission('users.manage'))
    OR (SELECT public.has_permission('users.assignments'))
  );

REVOKE ALL ON public.user_assignment_list FROM PUBLIC, anon;
GRANT SELECT ON public.user_assignment_list TO authenticated;

COMMENT ON VIEW public.user_assignment_list IS
  '0212: Settings › «اسناد الشركات والمشاريع». One row per user who is not an admin: id, full_name (+ full_name_search), role_key with its names, records_projects (the active role holds movements.site.create), company_ids, has_assignments and assignments (JSON, one object per linked company with its narrowed projects; none = every project of it). DELIBERATE, REVIEWED EXCEPTION like profile_names: security_invoker = false, and the WHERE returns rows only to a caller holding users.manage or users.assignments, so no policy of profiles, profile_roles, profile_companies or profile_projects is widened. Written only through admin_set_profile_assignments.';

-- ===========================================================================
-- 4. Guards
-- ===========================================================================
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_key = 'admin' AND permission_key = 'users.assignments'
  ) THEN
    RAISE EXCEPTION '0212: the admin role does not hold users.assignments';
  END IF;
  IF (SELECT admin_only FROM public.permissions WHERE key = 'users.assignments') THEN
    RAISE EXCEPTION '0212: users.assignments must not be admin only';
  END IF;
END
$guard$;

NOTIFY pgrst, 'reload schema';
