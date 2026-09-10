-- Support the default newest-updated-first ordering on master-data lists.
CREATE INDEX IF NOT EXISTS companies_updated_at_id_idx
  ON public.companies(updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS projects_updated_at_id_idx
  ON public.projects(updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS lessors_updated_at_id_idx
  ON public.lessors(updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS drivers_updated_at_id_idx
  ON public.drivers(updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS equipment_updated_at_id_idx
  ON public.equipment(updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS equipment_types_updated_at_id_idx
  ON public.equipment_types(updated_at DESC, id DESC);
