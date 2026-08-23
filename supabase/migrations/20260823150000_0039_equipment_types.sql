CREATE TABLE public.equipment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX equipment_types_name_lower_key
  ON public.equipment_types (lower(btrim(name)));

UPDATE public.equipment
SET type = COALESCE(NULLIF(btrim(type), ''), 'غير محدد');

INSERT INTO public.equipment_types (name)
SELECT DISTINCT btrim(type)
FROM public.equipment
WHERE btrim(type) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.equipment_types (name)
VALUES ('غير محدد')
ON CONFLICT DO NOTHING;

UPDATE public.equipment AS equipment
SET type = equipment_type.name
FROM public.equipment_types AS equipment_type
WHERE lower(btrim(equipment.type)) = lower(btrim(equipment_type.name))
  AND equipment.type <> equipment_type.name;

ALTER TABLE public.equipment_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_equipment_types" ON public.equipment_types
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_equipment_types" ON public.equipment_types
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "update_equipment_types" ON public.equipment_types
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "delete_equipment_types" ON public.equipment_types
  FOR DELETE TO authenticated USING (public.is_admin());

ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_type_fkey
  FOREIGN KEY (type) REFERENCES public.equipment_types(name)
  ON UPDATE CASCADE ON DELETE RESTRICT;
