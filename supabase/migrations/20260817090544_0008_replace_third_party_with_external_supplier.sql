/*
# Replace third_party with external_supplier in ownership_status

## Summary
Removes `third_party` from the allowed `ownership_status` values and adds
`external_supplier` (مورّد خارجي). Existing rows with `third_party` are
migrated to `external_supplier`.

## Changes
1. Drop existing CHECK constraint.
2. Migrate data: `third_party` -> `external_supplier`.
3. Add new constraint allowing:
   - `alazani`
   - `takween`
   - `third_party_f`
   - `third_party_partnership_b`
   - `external_supplier`
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'equipment_ownership_status_check'
      AND conrelid = 'equipment'::regclass
  ) THEN
    ALTER TABLE equipment DROP CONSTRAINT equipment_ownership_status_check;
  END IF;
END $$;

UPDATE equipment SET ownership_status = 'external_supplier' WHERE ownership_status = 'third_party';

ALTER TABLE equipment
  ADD CONSTRAINT equipment_ownership_status_check
  CHECK (ownership_status IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier'));
