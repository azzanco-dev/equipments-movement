-- Equipment, movement logs, and supervisor lists now search by chassis number,
-- so it needs the same trigram index as code, type, and plate number.
CREATE INDEX IF NOT EXISTS equipment_chassis_trgm_idx
  ON public.equipment USING gin (chassis_number extensions.gin_trgm_ops);
