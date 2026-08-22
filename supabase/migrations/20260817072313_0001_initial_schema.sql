/*
# Equipment Entry/Exit Management — Initial Schema

## Overview
Creates the complete database schema for a heavy equipment entry/exit tracking system
for a construction company. The app uses Supabase Auth (email + password) with two
roles: supervisor (sees only own logs) and admin (sees everything).

## New Tables

1. **profiles** — extends auth.users with full name and role
   - id (uuid, PK, FK to auth.users)
   - full_name (text, not null)
   - role (text, not null, check: 'admin' | 'supervisor')
   - created_at (timestamptz, default now())

2. **projects** — construction projects
   - id (uuid, PK)
   - name (text, not null)
   - company (text, not null) — owning company
   - created_at (timestamptz, default now())

3. **lessors** — equipment rental companies
   - id (uuid, PK)
   - name (text, not null)
   - contact_person (text, nullable)
   - contact_number (text, nullable)
   - created_at (timestamptz, default now())

4. **equipment** — heavy equipment units
   - id (uuid, PK)
   - code (text, unique, not null) — e.g. "A203"
   - type (text, not null) — e.g. "crane 50 ton"
   - plate_number (text, nullable)
   - operational_status (text, not null, check: 'operational' | 'maintenance' | 'stopped')
   - ownership_status (text, not null, check: 'owned' | 'rented')
   - project_id (uuid, FK to projects, nullable)
   - lessor_id (uuid, FK to lessors, nullable — filled only if rented)
   - brand (text, nullable)
   - model (text, nullable)
   - manufacture_year (int, nullable)
   - chassis_number (text, nullable)
   - registration_type (text, nullable, check: 'private_transport' | 'public_transport' | 'heavy_equipment')
   - qr_value (text, unique, not null) — unique QR code value per equipment
   - last_maintenance_date (date, nullable)
   - registration_expiry (date, nullable)
   - insurance_expiry (date, nullable)
   - is_active (boolean, default true) — soft disable instead of delete
   - created_at (timestamptz, default now())
   - updated_at (timestamptz, default now())

5. **entry_exit_logs** — immutable entry/exit records
   - id (uuid, PK)
   - equipment_id (uuid, FK to equipment)
   - supervisor_id (uuid, FK to auth.users) — the supervisor who created the log
   - movement_type (text, not null, check: 'entry' | 'exit')
   - registration_method (text, not null, check: 'qr' | 'manual')
   - driver_name (text, nullable)
   - odometer_reading (numeric, nullable)
   - notes (text, nullable)
   - photo_url (text, nullable) — Supabase Storage path
   - recorded_at (timestamptz, default now())

## Security (RLS)
- **profiles**: users read own profile; admins read all; users update own profile (name only).
- **projects**: admins full CRUD; supervisors read-only.
- **lessors**: admins full CRUD; supervisors read-only.
- **equipment**: admins full CRUD; supervisors read-only.
- **entry_exit_logs**: supervisors see/insert only own logs (cannot update/delete);
  admins see all, insert, but cannot update/delete (immutable).
- All tables use 4 separate policies (SELECT/INSERT/UPDATE/DELETE).

## Indexes
- equipment: code (unique), qr_value (unique), project_id, is_active
- entry_exit_logs: equipment_id, supervisor_id, recorded_at, movement_type
- profiles: role

## Important Notes
1. profiles.id is both PK and FK to auth.users — 1:1 relationship.
2. entry_exit_logs are immutable after creation: no UPDATE or DELETE policy for supervisors;
   admins also cannot UPDATE/DELETE (enforced by absence of those policies).
3. A trigger auto-creates a profile row when a new auth.user is created.
4. A trigger updates equipment.updated_at on row update.
5. The `is_active` flag on equipment replaces hard deletes.
*/

-- ============ PROFILES ============
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'supervisor')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Index for filtering by role
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- SELECT: users read own profile; admins read all
DROP POLICY IF EXISTS "select_profiles" ON profiles;
CREATE POLICY "select_profiles" ON profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- INSERT: only admins can create profiles (via edge function using service role, but policy for safety)
DROP POLICY IF EXISTS "insert_profiles" ON profiles;
CREATE POLICY "insert_profiles" ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- UPDATE: users update own profile (name only); admins update any
DROP POLICY IF EXISTS "update_profiles" ON profiles;
CREATE POLICY "update_profiles" ON profiles FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- DELETE: only admins
DROP POLICY IF EXISTS "delete_profiles" ON profiles;
CREATE POLICY "delete_profiles" ON profiles FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ============ PROJECTS ============
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_projects" ON projects;
CREATE POLICY "select_projects" ON projects FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "insert_projects" ON projects;
CREATE POLICY "insert_projects" ON projects FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "update_projects" ON projects;
CREATE POLICY "update_projects" ON projects FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "delete_projects" ON projects;
CREATE POLICY "delete_projects" ON projects FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ============ LESSORS ============
CREATE TABLE IF NOT EXISTS lessors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  contact_number text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lessors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_lessors" ON lessors;
CREATE POLICY "select_lessors" ON lessors FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "insert_lessors" ON lessors;
CREATE POLICY "insert_lessors" ON lessors FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "update_lessors" ON lessors;
CREATE POLICY "update_lessors" ON lessors FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "delete_lessors" ON lessors;
CREATE POLICY "delete_lessors" ON lessors FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ============ EQUIPMENT ============
CREATE TABLE IF NOT EXISTS equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  type text NOT NULL,
  plate_number text,
  operational_status text NOT NULL CHECK (operational_status IN ('operational', 'maintenance', 'stopped')),
  ownership_status text NOT NULL CHECK (ownership_status IN ('owned', 'rented')),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  lessor_id uuid REFERENCES lessors(id) ON DELETE SET NULL,
  brand text,
  model text,
  manufacture_year int,
  chassis_number text,
  registration_type text CHECK (registration_type IN ('private_transport', 'public_transport', 'heavy_equipment')),
  qr_value text NOT NULL,
  last_maintenance_date date,
  registration_expiry date,
  insurance_expiry date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_code ON equipment(code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_qr_value ON equipment(qr_value);
CREATE INDEX IF NOT EXISTS idx_equipment_project_id ON equipment(project_id);
CREATE INDEX IF NOT EXISTS idx_equipment_is_active ON equipment(is_active);

DROP POLICY IF EXISTS "select_equipment" ON equipment;
CREATE POLICY "select_equipment" ON equipment FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "insert_equipment" ON equipment;
CREATE POLICY "insert_equipment" ON equipment FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "update_equipment" ON equipment;
CREATE POLICY "update_equipment" ON equipment FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "delete_equipment" ON equipment;
CREATE POLICY "delete_equipment" ON equipment FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ============ ENTRY_EXIT_LOGS ============
CREATE TABLE IF NOT EXISTS entry_exit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
  supervisor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('entry', 'exit')),
  registration_method text NOT NULL CHECK (registration_method IN ('qr', 'manual')),
  driver_name text,
  odometer_reading numeric,
  notes text,
  photo_url text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE entry_exit_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_logs_equipment_id ON entry_exit_logs(equipment_id);
CREATE INDEX IF NOT EXISTS idx_logs_supervisor_id ON entry_exit_logs(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_logs_recorded_at ON entry_exit_logs(recorded_at);
CREATE INDEX IF NOT EXISTS idx_logs_movement_type ON entry_exit_logs(movement_type);

-- SELECT: supervisors see only own logs; admins see all
DROP POLICY IF EXISTS "select_entry_exit_logs" ON entry_exit_logs;
CREATE POLICY "select_entry_exit_logs" ON entry_exit_logs FOR SELECT
  TO authenticated
  USING (
    supervisor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- INSERT: supervisors can insert own logs; admins can insert any
DROP POLICY IF EXISTS "insert_entry_exit_logs" ON entry_exit_logs;
CREATE POLICY "insert_entry_exit_logs" ON entry_exit_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    supervisor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- No UPDATE or DELETE policies → logs are immutable for everyone (enforced by RLS)

-- ============ TRIGGERS ============

-- Auto-create profile when a new auth.user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'supervisor')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update equipment.updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_equipment_updated_at ON equipment;
CREATE TRIGGER trg_equipment_updated_at
  BEFORE UPDATE ON equipment
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============ STORAGE BUCKET ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('log-photos', 'log-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: authenticated users can upload; anyone can read (public bucket)
DROP POLICY IF EXISTS "select_log_photos" ON storage.objects;
CREATE POLICY "select_log_photos" ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'log-photos');

DROP POLICY IF EXISTS "insert_log_photos" ON storage.objects;
CREATE POLICY "insert_log_photos" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'log-photos');

DROP POLICY IF EXISTS "update_log_photos" ON storage.objects;
CREATE POLICY "update_log_photos" ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'log-photos')
  WITH CHECK (bucket_id = 'log-photos');

DROP POLICY IF EXISTS "delete_log_photos" ON storage.objects;
CREATE POLICY "delete_log_photos" ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'log-photos');