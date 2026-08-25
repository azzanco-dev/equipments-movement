ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Existing accounts already have established passwords. Only newly created
-- accounts receive a temporary password that must be replaced on first login.
ALTER TABLE public.profiles
  ALTER COLUMN must_change_password SET DEFAULT true;
