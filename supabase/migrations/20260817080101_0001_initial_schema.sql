-- ============ PROFILES ============
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'supervisor')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- ============ PROJECTS ============
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- ============ LESSORS ============
CREATE TABLE IF NOT EXISTS lessors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  contact_number text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lessors ENABLE ROW LEVEL SECURITY;

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

-- ============ TRIGGERS ============
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
