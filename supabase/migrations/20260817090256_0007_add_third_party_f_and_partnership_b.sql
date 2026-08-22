/*
# Add two new ownership_status values

## Summary
Adds `third_party_f` and `third_party_partnership_b` to the allowed
`ownership_status` values on the `equipment` table.

## Changes
1. Drop existing CHECK constraint.
2. Add new constraint allowing:
   - `alazani`
   - `takween`
   - `third_party`
   - `third_party_f`           — مملوكة للغير F
   - `third_party_partnership_b` — مملوكة للغير شراكة B
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

ALTER TABLE equipment
  ADD CONSTRAINT equipment_ownership_status_check
  CHECK (ownership_status IN ('alazani', 'takween', 'third_party', 'third_party_f', 'third_party_partnership_b'));
