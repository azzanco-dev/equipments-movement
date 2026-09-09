/* Add an optional English name to driver master data. */

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS name_en text;

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_name_en_check;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_name_en_check
  CHECK (name_en IS NULL OR char_length(btrim(name_en)) BETWEEN 2 AND 150);

CREATE INDEX IF NOT EXISTS drivers_name_en_trgm_idx
  ON public.drivers USING gin (name_en extensions.gin_trgm_ops);
