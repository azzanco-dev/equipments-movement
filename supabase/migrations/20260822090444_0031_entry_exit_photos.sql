/*
# Entry Exit Photos — multi-photo support (up to 3 per movement)

## What this migration does (plain English)

Creates a new `entry_exit_photos` table that lets each equipment movement
(entry or exit) have up to 3 photos attached to it, replacing the old
single `photo_url` column on `entry_exit_logs`. The old column is kept
for backward compatibility — existing records that use it will still
display their legacy photo.

## New table: entry_exit_photos

- `id` — UUID primary key
- `entry_exit_log_id` — FK to `entry_exit_logs.id`, CASCADE on delete
  (safe because movements are never deleted in normal operation; if a
  movement is ever removed, its photos should go too)
- `file_path` — storage path in the `log-photos` bucket
- `uploaded_by` — FK to `profiles.id`, the user who uploaded the photo
- `sort_order` — integer, defaults to 0, preserves display order
- `created_at` — timestamptz, defaults to now()

## 3-photo limit enforcement

A trigger `enforce_max_three_photos` runs BEFORE INSERT on
`entry_exit_photos`. It counts existing rows for the same
`entry_exit_log_id` and raises an exception if a 4th photo would be
created. This makes the limit impossible to bypass via direct API
inserts.

## RLS policies

- SELECT: any authenticated user who can read the parent movement can
  read its photos (mirrors entry_exit_logs read access — authenticated
  users can read all movements).
- INSERT: authenticated users can insert photos for any movement they
  are allowed to write to (the uploaded_by must match auth.uid()).
- DELETE: only the uploader or an admin can delete a photo.
- UPDATE: only the uploader or an admin can update sort_order.

## Storage

Photos continue to use the existing `log-photos` private bucket. The
existing storage RLS policies already scope reads to the file owner or
admin, which aligns with the photo ownership model.

## What is NOT changed

- `entry_exit_logs.photo_url` column is NOT removed.
- No existing data is migrated or deleted.
- Movement sequence rules, EXIT inheritance, and all other movement
  logic are untouched.
*/

CREATE TABLE IF NOT EXISTS entry_exit_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_exit_log_id uuid NOT NULL REFERENCES entry_exit_logs(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entry_exit_photos_log_id
  ON entry_exit_photos(entry_exit_log_id);

CREATE INDEX IF NOT EXISTS idx_entry_exit_photos_uploaded_by
  ON entry_exit_photos(uploaded_by);

ALTER TABLE entry_exit_photos ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user can read photos (mirrors movement read access)
DROP POLICY IF EXISTS "select_entry_exit_photos" ON entry_exit_photos;
CREATE POLICY "select_entry_exit_photos"
  ON entry_exit_photos FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: uploader must be the authenticated user
DROP POLICY IF EXISTS "insert_entry_exit_photos" ON entry_exit_photos;
CREATE POLICY "insert_entry_exit_photos"
  ON entry_exit_photos FOR INSERT
  TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

-- UPDATE: uploader or admin
DROP POLICY IF EXISTS "update_entry_exit_photos" ON entry_exit_photos;
CREATE POLICY "update_entry_exit_photos"
  ON entry_exit_photos FOR UPDATE
  TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_admin())
  WITH CHECK (uploaded_by = auth.uid() OR public.is_admin());

-- DELETE: uploader or admin
DROP POLICY IF EXISTS "delete_entry_exit_photos" ON entry_exit_photos;
CREATE POLICY "delete_entry_exit_photos"
  ON entry_exit_photos FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_admin());

-- Trigger: enforce max 3 photos per movement
CREATE OR REPLACE FUNCTION enforce_max_three_photos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  photo_count integer;
BEGIN
  SELECT count(*) INTO photo_count
  FROM entry_exit_photos
  WHERE entry_exit_log_id = NEW.entry_exit_log_id;

  IF photo_count >= 3 THEN
    RAISE EXCEPTION 'maximum 3 photos per movement';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_max_three_photos ON entry_exit_photos;
CREATE TRIGGER trg_enforce_max_three_photos
  BEFORE INSERT ON entry_exit_photos
  FOR EACH ROW
  EXECUTE FUNCTION enforce_max_three_photos();

-- Revoke execute from anon/authenticated (only trigger should call it)
REVOKE EXECUTE ON FUNCTION enforce_max_three_photos() FROM anon, authenticated;