-- 0144 — company scope, projects: a scoped user sees the projects linked to
-- his companies.
--
-- Owner 2026-10-22 («تظهر المشاريع المسندة للشركات»), completing 0143: for
-- a caller whose `scoped_company_ids()` is not NULL, `projects` reads only
-- the projects that `company_projects` (0029) links to one of those
-- companies — so the project selectors of the movement form, the filters
-- and the purchasing dialogs follow from the server. A caller without
-- scope (NULL) keeps reading every project. The movement views join
-- projects with LEFT JOIN, so a visible movement whose project is not
-- linked to its company in `company_projects` keeps its row and shows no
-- project name: keep `company_projects` complete.
--
-- Nothing else changes: `company_projects` stays readable by everyone
-- signed in, the writes keep their 0127 policies, and no gate tests a role.

DROP POLICY IF EXISTS select_projects ON public.projects;
CREATE POLICY select_projects ON public.projects
FOR SELECT TO authenticated
USING (
  (SELECT public.scoped_company_ids()) IS NULL
  OR EXISTS (
    SELECT 1
    FROM public.company_projects cp
    WHERE cp.project_id = projects.id
      AND cp.company_id = ANY ((SELECT public.scoped_company_ids())::uuid[])
  )
);
COMMENT ON POLICY select_projects ON public.projects IS
  '0144: was USING (true) (0004); now every project for a caller without company scope, else the projects company_projects links to one of the caller''s linked companies.';
