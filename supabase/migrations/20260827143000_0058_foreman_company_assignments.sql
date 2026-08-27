CREATE TABLE public.profile_companies (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, company_id)
);

CREATE INDEX profile_companies_company_id_idx
  ON public.profile_companies(company_id);

-- Preserve any company assignments that can be inferred from the previous
-- foreman-to-project relation. The legacy rows remain intact.
INSERT INTO public.profile_companies(profile_id, company_id)
SELECT DISTINCT pp.profile_id, cp.company_id
FROM public.profile_projects pp
JOIN public.company_projects cp ON cp.project_id = pp.project_id
ON CONFLICT DO NOTHING;

ALTER TABLE public.profile_companies ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.profile_companies TO authenticated;

CREATE POLICY "select_profile_companies"
  ON public.profile_companies
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin());

CREATE POLICY "insert_profile_companies"
  ON public.profile_companies
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "update_profile_companies"
  ON public.profile_companies
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "delete_profile_companies"
  ON public.profile_companies
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- Assignments are intentionally stored for future scoping only. They do not
-- restrict movement creation or visibility at this stage.
