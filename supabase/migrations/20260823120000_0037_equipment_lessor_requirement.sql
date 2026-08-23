-- F, B and external-supplier equipment must identify the lessor.
-- NOT VALID preserves legacy rows that still need data cleanup while enforcing
-- the rule for all new or updated rows.
ALTER TABLE public.equipment
  DROP CONSTRAINT IF EXISTS equipment_lessor_required_for_external_ownership;

ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_lessor_required_for_external_ownership
  CHECK (
    ownership_status NOT IN (
      'third_party_f',
      'third_party_partnership_b',
      'external_supplier'
    )
    OR lessor_id IS NOT NULL
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS equipment_lessor_id_idx
  ON public.equipment (lessor_id)
  WHERE lessor_id IS NOT NULL;
