-- Unified list search/filter/sort support.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS drivers_full_name_trgm_idx ON public.drivers USING gin (full_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS drivers_id_number_trgm_idx ON public.drivers USING gin (id_number extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS drivers_mobile_number_trgm_idx ON public.drivers USING gin (mobile_number extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS drivers_nationality_idx ON public.drivers (nationality);
CREATE INDEX IF NOT EXISTS drivers_employment_type_idx ON public.drivers (employment_type);

CREATE INDEX IF NOT EXISTS equipment_code_trgm_idx ON public.equipment USING gin (code extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS equipment_type_trgm_idx ON public.equipment USING gin (type extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS equipment_plate_trgm_idx ON public.equipment USING gin (plate_number extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS equipment_operational_status_idx ON public.equipment (operational_status);
CREATE INDEX IF NOT EXISTS equipment_ownership_status_idx ON public.equipment (ownership_status);
CREATE INDEX IF NOT EXISTS equipment_active_idx ON public.equipment (is_active);

CREATE INDEX IF NOT EXISTS companies_name_ar_trgm_idx ON public.companies USING gin (name_ar extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS companies_name_en_trgm_idx ON public.companies USING gin (name_en extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS projects_name_ar_trgm_idx ON public.projects USING gin (name_ar extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS projects_name_en_trgm_idx ON public.projects USING gin (name_en extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS lessors_name_trgm_idx ON public.lessors USING gin (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS lessors_contact_number_trgm_idx ON public.lessors USING gin (contact_number extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS entry_exit_logs_driver_name_trgm_idx ON public.entry_exit_logs USING gin (driver_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entry_exit_logs_contractor_code_trgm_idx ON public.entry_exit_logs USING gin (contractor_equipment_code extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entry_exit_logs_recorded_id_idx ON public.entry_exit_logs (recorded_at DESC, id DESC);
