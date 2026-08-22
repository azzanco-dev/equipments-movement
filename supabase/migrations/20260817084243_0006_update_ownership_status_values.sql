/*
# Update equipment ownership_status values

## Summary
Changes the `ownership_status` column on the `equipment` table from the old
binary `owned` / `rented` values to three specific ownership categories that
reflect the actual companies the business deals with.

## Changes
1. Drop the existing CHECK constraint on `equipment.ownership_status`.
2. Migrate existing data:
   - `owned`  -> `alazani`     (شركة عبدالله العزاني للمقاولات)
   - `rented` -> `takween`     (شركة تكوين المعدات للمقاولات)
3. Add a new CHECK constraint allowing:
   - `alazani`       — شركة عبدالله العزاني للمقاولات
   - `takween`       — شركة تكوين المعدات للمقاولات
   - `third_party`   — مملوكة للغير
4. Set the column default to `alazani` so new equipment without an explicit
   value gets a sensible default.

## Notes
- No columns are dropped or renamed; only the constraint and data values change.
- RLS policies are unaffected (they are row-level, not column-level).
- The migration is idempotent: dropping a non-existent constraint is guarded.
*/

-- 1. Drop old constraint (guard with DO block for idempotency)
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

-- 2. Migrate existing data to new values
UPDATE equipment SET ownership_status = 'alazani'   WHERE ownership_status = 'owned';
UPDATE equipment SET ownership_status = 'takween'   WHERE ownership_status = 'rented';

-- 3. Add new constraint
ALTER TABLE equipment
  ADD CONSTRAINT equipment_ownership_status_check
  CHECK (ownership_status IN ('alazani', 'takween', 'third_party'));

-- 4. Set default
ALTER TABLE equipment ALTER COLUMN ownership_status SET DEFAULT 'alazani';
