-- Users' mobile numbers move out of `profiles` (owner decision 2026-10-03).
--
-- 0110 added `profiles.mobile_number` for the WhatsApp movement notices. Read
-- access followed the `select_profiles` policy (0076): an admin AND a
-- `monitor` read every profile row, so a monitor could read every user's
-- number, and a workshop role read the numbers of the other workshop-role
-- users. The owner decided that the `monitor` role must not read users'
-- mobile numbers.
--
-- Row-level security cannot hide one column, and a column-level REVOKE on
-- `profiles` would break the client, which reads its own profile with
-- `select('*')` (src/auth/AuthContext.tsx). So the number moves to its own
-- table with its own, narrower policy.
--
-- ===========================================================================
-- What changes
-- ===========================================================================
--   * New table `public.profile_contacts` (one optional row per profile).
--     SELECT: an admin reads every row, any user reads his own row. Nobody
--     else, including `monitor`, `supervisor` and the workshop roles.
--     Clients hold SELECT only: no INSERT/UPDATE/DELETE policy and no write
--     grant, so `admin_set_user_mobile` is the only write path.
--   * The existing numbers are copied over, then `profiles.mobile_number` and
--     its check `profiles_mobile_number_format` are dropped.
--   * `admin_set_user_mobile(uuid, text)` keeps its signature, validation and
--     stable codes (admin_required, user_not_found, invalid_mobile) and now
--     upserts `profile_contacts`.
--   * The internal helper `movement_notice_payload(uuid)` keeps its 11 return
--     columns and reads the recipient mobile from `profile_contacts`. It stays
--     NOT SECURITY DEFINER and not executable by client roles; it runs only
--     inside the SECURITY DEFINER notice functions of 0110, with their owner's
--     rights, so the narrower policy does not hide the number from the server
--     send path. The accepted disclosure of 0110 (the notice functions return
--     the recipient's number to their caller) is unchanged.
--
-- ===========================================================================
-- Dependencies checked before dropping the column
-- ===========================================================================
--   * Migrations: the only reader of `profiles.mobile_number` is 0110 itself
--     (the column, its check, `admin_set_user_mobile` and
--     `movement_notice_payload`). Every other `mobile_number` in the history
--     is `drivers.mobile_number` (0033 onward), which is unrelated.
--   * Views: `profile_names` (0099) exposes id/full_name/role only. No view
--     selects `profiles.*` after 0110, so no view depends on the column.
--   * Functions: `request_workshop_arrival_notice` and
--     `prepare_movement_exit_notice` return `movement_notice_payload(...)`
--     and do not name the column; the payload helper is replaced below BEFORE
--     the column is dropped.
--   * Client and server code: only src/screens/UserDetail.tsx read the
--     column; it now reads `profile_contacts`. The Edge Functions
--     (create-user, manage-user) do not touch it.

-- `profiles` is read by every request. Fail fast instead of queueing the
-- application behind this migration if another session holds a lock on it.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_contacts (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  mobile_number text NULL
    CONSTRAINT profile_contacts_mobile_number_format
    CHECK (mobile_number IS NULL OR mobile_number ~ '^\+?[0-9]{8,15}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profile_contacts IS
  'Private contact details of a user (migration 0113). Readable by an admin and by the user himself only; written only by admin_set_user_mobile.';
COMMENT ON COLUMN public.profile_contacts.mobile_number IS
  'WhatsApp number used for movement notices. Written only by admin_set_user_mobile.';

ALTER TABLE public.profile_contacts ENABLE ROW LEVEL SECURITY;

-- Supabase grants every privilege on a new public table to the API roles by
-- default. Clients read only; every write goes through the function below.
REVOKE ALL ON TABLE public.profile_contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profile_contacts TO authenticated;

-- An admin reads every row; a user reads his own. `is_admin()` is false for a
-- missing profile, so the policy fails closed. There is deliberately no
-- INSERT, UPDATE or DELETE policy.
DROP POLICY IF EXISTS "select_profile_contacts" ON public.profile_contacts;
CREATE POLICY "select_profile_contacts" ON public.profile_contacts
FOR SELECT TO authenticated USING (
  public.is_admin()
  OR user_id = auth.uid()
);

-- ---------------------------------------------------------------------------
-- 2. Copy the existing numbers
-- ---------------------------------------------------------------------------
INSERT INTO public.profile_contacts (user_id, mobile_number)
SELECT p.id, p.mobile_number
FROM public.profiles p
WHERE p.mobile_number IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
  SET mobile_number = EXCLUDED.mobile_number,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. The write path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_mobile(
  p_user_id uuid,
  p_mobile_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mobile text;
BEGIN
  -- Fail closed: no session, no profile or a non-admin role is rejected.
  IF auth.uid() IS NULL OR public.is_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may set a user mobile number.';
  END IF;

  -- Spaces and dashes are typing aids, not part of the number. NULL or an
  -- empty value clears it.
  v_mobile := NULLIF(regexp_replace(COALESCE(p_mobile_number, ''), '[[:space:]-]', '', 'g'), '');
  IF v_mobile IS NOT NULL AND v_mobile !~ '^\+?[0-9]{8,15}$' THEN
    RAISE EXCEPTION 'invalid_mobile'
      USING HINT = 'A mobile number is 8 to 15 digits with an optional leading plus sign.';
  END IF;

  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id) THEN
    RAISE EXCEPTION 'user_not_found'
      USING HINT = 'No user matches this identifier.';
  END IF;

  INSERT INTO public.profile_contacts (user_id, mobile_number, updated_at)
  VALUES (p_user_id, v_mobile, now())
  ON CONFLICT (user_id) DO UPDATE
    SET mobile_number = EXCLUDED.mobile_number,
        updated_at = now();
END;
$$;

COMMENT ON FUNCTION public.admin_set_user_mobile(uuid, text) IS
  'Admin-only. Sets or clears (NULL/empty) profile_contacts.mobile_number after removing spaces and dashes; the value must be 8 to 15 digits with an optional leading plus. Stable codes: admin_required, user_not_found, invalid_mobile.';

REVOKE ALL ON FUNCTION public.admin_set_user_mobile(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_mobile(uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Internal helper: the facts the server needs to send one notice
-- ---------------------------------------------------------------------------
-- Same contract as 0110: deliberately NOT SECURITY DEFINER and not executable
-- by any client role. Called only from the SECURITY DEFINER notice functions,
-- where it runs with their owner's rights. Only the recipient mobile source
-- changes.
CREATE OR REPLACE FUNCTION public.movement_notice_payload(p_notice_id uuid)
RETURNS TABLE(
  notice_id uuid,
  notice_kind text,
  recipient_name text,
  recipient_mobile text,
  equipment_code text,
  equipment_type text,
  project_name_ar text,
  project_name_en text,
  company_name_ar text,
  company_name_en text,
  sender_name text
)
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  SELECT
    n.id,
    n.kind,
    r.full_name,
    rc.mobile_number,
    e.code,
    e.type,
    pr.name_ar,
    pr.name_en,
    co.name_ar,
    co.name_en,
    s.full_name
  FROM public.movement_notices n
  JOIN public.equipment e ON e.id = n.equipment_id
  LEFT JOIN public.entry_exit_logs l ON l.id = n.entry_log_id
  LEFT JOIN public.projects pr ON pr.id = l.project_id
  LEFT JOIN public.companies co ON co.id = l.company_id
  LEFT JOIN public.profiles r ON r.id = n.recipient_id
  LEFT JOIN public.profile_contacts rc ON rc.user_id = n.recipient_id
  LEFT JOIN public.profiles s ON s.id = n.sender_id
  WHERE n.id = p_notice_id;
$$;

COMMENT ON FUNCTION public.movement_notice_payload(uuid) IS
  'Internal. The minimum facts the server needs to send one movement notice: recipient name and mobile (profile_contacts, 0113), equipment code and type, project and company of the site entry, sender name. Not executable by client roles.';

REVOKE ALL ON FUNCTION public.movement_notice_payload(uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Drop the old column
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_mobile_number_format;
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS mobile_number;

NOTIFY pgrst, 'reload schema';
