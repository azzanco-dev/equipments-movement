DROP POLICY IF EXISTS insert_companies ON public.companies;
CREATE POLICY insert_companies ON public.companies FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS update_companies ON public.companies;
CREATE POLICY update_companies ON public.companies FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS delete_companies ON public.companies;
CREATE POLICY delete_companies ON public.companies FOR DELETE
  TO authenticated USING (public.is_admin());