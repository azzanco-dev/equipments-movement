-- The external supplier is optional and is only supporting information when
-- the equipment owner classification is `external_supplier` (مالك آخر).
ALTER TABLE public.equipment
  DROP CONSTRAINT IF EXISTS equipment_lessor_required_for_external_ownership;
