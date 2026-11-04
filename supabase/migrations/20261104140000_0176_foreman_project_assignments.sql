-- 0176: foreman assignments by company AND project («اسنادات الفورمينات»),
-- the database layer.
--
-- Owner request 2026-11-03 (Notion EM-261): «ربط الفورمينات بالشركات
-- والمشاريع, مش بس الشركات, وتكون عبر صفحة تسمى مثلا صفحة اسنادات
-- الفورمينات»; 2026-11-04 «نبدا الحين». The page comes in a later change;
-- this migration is the data, the one writer and the read helper.
--
-- The model (decided for this build):
--   * the company links stay the base: `profile_companies` (0058) is
--     unchanged, still written by the manage-user Edge Function from the
--     user page («الشركات المسؤول عنها»), and still filters ONLY the company
--     and project selectors of the movement entry form (0145: they restrict
--     no read and no write — nothing here changes that; do not reintroduce
--     RLS scoping by them without the owner's explicit request);
--   * a foreman may ADDITIONALLY be narrowed to specific PROJECTS of a
--     linked company: `profile_projects` (the 0052 name, free again since
--     0079 dropped that table). A row NARROWS the linked company the
--     project belongs to (company_projects, 0029 — a project may belong to
--     several companies); a linked company with NO project rows = ALL its
--     projects, so every existing user keeps today's behaviour;
--   * the data never dangles: a project row is accepted only while one of
--     the project's companies is linked to the user (BEFORE INSERT,
--     project_company_not_assigned 23503), and unlinking a company removes
--     the user's project rows that no remaining linked company carries
--     (AFTER DELETE on profile_companies);
--   * ONE write path for the coming page: admin_set_profile_assignments
--     (SECURITY DEFINER, users.manage) replaces the user's company set and
--     project set in one transaction. The client has no INSERT / UPDATE /
--     DELETE policy on profile_projects;
--   * reads: the SELECT policy mirrors profile_companies (0127: the user's
--     own rows, or users.manage), and the security_invoker view
--     profile_assignments gives one row per user × linked company with the
--     narrowed projects as arrays (empty = all), for the page and the
--     movement form.
--
-- Stable error tokens (the client maps them, never shows raw errors):
--   users_manage_required            42501
--   invalid_profile / invalid_company /
--   invalid_project                  22023
--   project_company_not_assigned     23503
-- Nothing here changes a movement, a policy of an existing table, the
-- manage-user function or any existing function.

-- ===========================================================================
-- A. profile_projects
-- ===========================================================================
CREATE TABLE public.profile_projects (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, project_id)
);

CREATE INDEX profile_projects_project_id_idx
  ON public.profile_projects(project_id);

COMMENT ON TABLE public.profile_projects IS
  '0176: the projects a user is narrowed to inside a linked company (profile_companies). A row NARROWS the linked company the project belongs to (company_projects); a linked company with no project rows = ALL its projects. Written only by admin_set_profile_assignments; a row needs one of the project''s companies linked to the user (project_company_not_assigned), and unlinking a company removes the project rows no remaining linked company carries. Like profile_companies it restricts no read and no write (0145): it filters only the project selector of the movement entry form.';
COMMENT ON COLUMN public.profile_projects.profile_id IS
  '0176: the user (profiles.id).';
COMMENT ON COLUMN public.profile_projects.project_id IS
  '0176: a project of one of the user''s linked companies.';

-- A link table: created_at only (0162 left profile_companies the same way).

ALTER TABLE public.profile_projects ENABLE ROW LEVEL SECURITY;

-- Reads only: no client INSERT / UPDATE / DELETE (the writer is SECURITY
-- DEFINER). The SELECT policy is the 0127 select_profile_companies rule.
GRANT SELECT ON public.profile_projects TO authenticated;

CREATE POLICY select_profile_projects ON public.profile_projects
FOR SELECT TO authenticated
USING (
  profile_id = auth.uid() OR (SELECT public.has_permission('users.manage'))
);
COMMENT ON POLICY select_profile_projects ON public.profile_projects IS
  '0176: the 0127 select_profile_companies rule — the user''s own rows, or users.manage.';

-- ===========================================================================
-- B. The two integrity triggers
-- ===========================================================================
-- B1. A project row needs one of the project's companies linked to the user.
CREATE OR REPLACE FUNCTION public.enforce_profile_project_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.company_projects cp
    JOIN public.profile_companies pc
      ON pc.company_id = cp.company_id
     AND pc.profile_id = NEW.profile_id
    WHERE cp.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'project_company_not_assigned'
      USING ERRCODE = '23503',
            HINT = 'Link one of the project''s companies to the user first.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_profile_project_company() IS
  'BEFORE INSERT trigger on profile_projects (0176): the project must belong (company_projects) to a company linked to the user (profile_companies), else project_company_not_assigned 23503.';

REVOKE ALL ON FUNCTION public.enforce_profile_project_company()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_profile_project_company
  BEFORE INSERT ON public.profile_projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_project_company();

-- B2. Unlinking a company removes the user's project rows that no remaining
-- linked company carries. AFTER ROW: it sees the table after the whole
-- DELETE statement, so a multi-row unlink is judged on the final state.
CREATE OR REPLACE FUNCTION public.prune_profile_projects_on_company_unlink()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.profile_projects pp
  WHERE pp.profile_id = OLD.profile_id
    AND EXISTS (
      SELECT 1
      FROM public.company_projects cp
      WHERE cp.project_id = pp.project_id
        AND cp.company_id = OLD.company_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_projects cp
      JOIN public.profile_companies pc
        ON pc.company_id = cp.company_id
       AND pc.profile_id = pp.profile_id
      WHERE cp.project_id = pp.project_id
    );
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.prune_profile_projects_on_company_unlink() IS
  'AFTER DELETE trigger on profile_companies (0176): removes the user''s profile_projects rows of the unlinked company''s projects that no remaining linked company carries, so a project row never dangles.';

REVOKE ALL ON FUNCTION public.prune_profile_projects_on_company_unlink()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER prune_profile_projects_on_company_unlink
  AFTER DELETE ON public.profile_companies
  FOR EACH ROW EXECUTE FUNCTION public.prune_profile_projects_on_company_unlink();

-- ===========================================================================
-- C. The writer: admin_set_profile_assignments
-- ===========================================================================
-- Replaces the user's company set and project set with the given ones in
-- one transaction (deletes the rows not in a set, inserts the missing ones;
-- nothing else changes). NULL arrays and NULL elements count as nothing,
-- duplicates once. Order: the new companies first, then the companies that
-- left (B2 prunes their projects), then the projects that left, then the
-- new projects (B1 sees the complete company set). The profile row is
-- locked FOR UPDATE so two saves of one user serialise.
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
BEGIN
  IF auth.uid() IS NULL
     OR public.has_permission('users.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'users_manage_required'
      USING ERRCODE = '42501',
            HINT = 'Managing users requires the users.manage permission.';
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

  -- 2. The companies that leave (B2 prunes their project rows).
  DELETE FROM public.profile_companies pc
  WHERE pc.profile_id = p_profile_id
    AND pc.company_id <> ALL (v_company_ids);

  -- 3. The projects that leave.
  DELETE FROM public.profile_projects pp
  WHERE pp.profile_id = p_profile_id
    AND pp.project_id <> ALL (v_project_ids);

  -- 4. The projects that join (B1 checks each against the company set).
  INSERT INTO public.profile_projects (profile_id, project_id)
  SELECT p_profile_id, pr.id
  FROM unnest(v_project_ids) AS pr(id)
  ON CONFLICT (profile_id, project_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_profile_assignments(uuid, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_assignments(uuid, uuid[], uuid[]) TO authenticated;

COMMENT ON FUNCTION public.admin_set_profile_assignments(uuid, uuid[], uuid[]) IS
  '0176: the single write path of «اسنادات الفورمينات» (users.manage, users_manage_required 42501). Replaces the user''s profile_companies and profile_projects rows with the given sets in one transaction (deletes the rows not in a set, inserts the missing ones; nothing else changes). The profile must exist (invalid_profile), every company (invalid_company) and every project (invalid_project) must exist, and every project must belong to one of the given companies (project_company_not_assigned 23503). NULL arrays = empty sets. The manage-user Edge Function keeps writing profile_companies for the user page.';

-- ===========================================================================
-- D. The read helper: profile_assignments
-- ===========================================================================
-- One row per user × linked company. project_ids are the user's narrowed
-- projects of THAT company (through company_projects), empty = all its
-- projects; the two name arrays follow the same order (by Arabic name, then
-- id). security_invoker: the policies of profile_companies, profile_projects
-- and the master data apply as for the reader (the user's own rows, or
-- users.manage).
CREATE OR REPLACE VIEW public.profile_assignments
WITH (security_invoker = true)
AS
SELECT
  pc.profile_id,
  pc.company_id,
  co.name_ar AS company_name_ar,
  co.name_en AS company_name_en,
  COALESCE(np.project_ids, ARRAY[]::uuid[]) AS project_ids,
  COALESCE(np.project_names_ar, ARRAY[]::text[]) AS project_names_ar,
  COALESCE(np.project_names_en, ARRAY[]::text[]) AS project_names_en
FROM public.profile_companies pc
JOIN public.companies co ON co.id = pc.company_id
LEFT JOIN LATERAL (
  SELECT
    array_agg(pr.id ORDER BY pr.name_ar, pr.id) AS project_ids,
    array_agg(pr.name_ar ORDER BY pr.name_ar, pr.id) AS project_names_ar,
    array_agg(pr.name_en ORDER BY pr.name_ar, pr.id) AS project_names_en
  FROM public.profile_projects pp
  JOIN public.company_projects cp
    ON cp.project_id = pp.project_id
   AND cp.company_id = pc.company_id
  JOIN public.projects pr ON pr.id = pp.project_id
  WHERE pp.profile_id = pc.profile_id
) np ON true;

COMMENT ON VIEW public.profile_assignments IS
  '0176: one row per user × linked company (profile_companies) with the company names and the user''s narrowed projects of that company (profile_projects through company_projects) as project_ids / project_names_ar / project_names_en in one order; an empty project_ids = all the company''s projects. For «اسنادات الفورمينات» and the movement form. security_invoker: the user''s own rows, or users.manage.';

GRANT SELECT ON public.profile_assignments TO authenticated;

NOTIFY pgrst, 'reload schema';
