-- Fix infinite recursion in RLS policies
-- Create SECURITY DEFINER functions that bypass RLS

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- ============ PROFILES POLICIES ============
DROP POLICY IF EXISTS "select_profiles" ON profiles;
CREATE POLICY "select_profiles" ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "insert_profiles" ON profiles;
CREATE POLICY "insert_profiles" ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "update_profiles" ON profiles;
CREATE POLICY "update_profiles" ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "delete_profiles" ON profiles;
CREATE POLICY "delete_profiles" ON profiles FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============ EQUIPMENT POLICIES ============
DROP POLICY IF EXISTS "select_equipment" ON equipment;
CREATE POLICY "select_equipment" ON equipment FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "insert_equipment" ON equipment;
CREATE POLICY "insert_equipment" ON equipment FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "update_equipment" ON equipment;
CREATE POLICY "update_equipment" ON equipment FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "delete_equipment" ON equipment;
CREATE POLICY "delete_equipment" ON equipment FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============ PROJECTS POLICIES ============
DROP POLICY IF EXISTS "select_projects" ON projects;
CREATE POLICY "select_projects" ON projects FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "insert_projects" ON projects;
CREATE POLICY "insert_projects" ON projects FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "update_projects" ON projects;
CREATE POLICY "update_projects" ON projects FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "delete_projects" ON projects;
CREATE POLICY "delete_projects" ON projects FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============ LESSORS POLICIES ============
DROP POLICY IF EXISTS "select_lessors" ON lessors;
CREATE POLICY "select_lessors" ON lessors FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "insert_lessors" ON lessors;
CREATE POLICY "insert_lessors" ON lessors FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "update_lessors" ON lessors;
CREATE POLICY "update_lessors" ON lessors FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "delete_lessors" ON lessors;
CREATE POLICY "delete_lessors" ON lessors FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============ ENTRY_EXIT_LOGS POLICIES ============
DROP POLICY IF EXISTS "select_entry_exit_logs" ON entry_exit_logs;
CREATE POLICY "select_entry_exit_logs" ON entry_exit_logs FOR SELECT
  TO authenticated
  USING (supervisor_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "insert_entry_exit_logs" ON entry_exit_logs;
CREATE POLICY "insert_entry_exit_logs" ON entry_exit_logs FOR INSERT
  TO authenticated
  WITH CHECK (supervisor_id = auth.uid() OR public.is_admin());
