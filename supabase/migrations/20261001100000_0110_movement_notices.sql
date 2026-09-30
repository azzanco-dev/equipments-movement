-- Wave 9: WhatsApp notices between the workshop and the site foremen.
--
-- Owner approval 2026-09-30. The ENTRY -> EXIT sequence is GLOBAL per equipment
-- (0043, 0108): a unit recorded inside a site cannot get a WORKSHOP entry until
-- its site exit exists, and only the foreman who recorded the site entry (or an
-- admin) may record that exit (0087/0088). Today the workshop officer phones
-- the foreman. This migration adds the database half of three WhatsApp notices
-- sent by the Next.js server through the UltraMsg gateway.
--
-- NOTIFICATIONS ONLY. Nothing here touches `entry_exit_logs`, its trigger, its
-- policies or the sequence rules: no drafts, no pending requests, and a notice
-- that cannot be sent never blocks or fails a movement. Nothing edits data.
--
-- ===========================================================================
-- The three notices (`movement_notices.kind`)
-- ===========================================================================
--   workshop_arrival  MANUAL. A workshop role (or an admin) reports that a unit
--                     which is recorded inside a site has arrived at the
--                     workshop. Recipient: the foreman who recorded the unit's
--                     open site ENTRY.
--   site_exit         AUTOMATIC, after the site EXIT of that visit is recorded.
--                     Recipient: the user who pressed "notify" for the site
--                     ENTRY the exit closed (the LATEST such notice when
--                     several officers pressed). No notice -> no message.
--   workshop_exit     AUTOMATIC, after a WORKSHOP exit is recorded. Walk back
--                     from the workshop ENTRY the exit closed to the movement
--                     immediately before it in the global order
--                     `(recorded_at, id)`. When that movement is a SITE exit,
--                     the recipient is the foreman of the SITE ENTRY that exit
--                     closed. Independent of `workshop_arrival`. Anything else
--                     -> no message.
--
-- ===========================================================================
-- Who decides what
-- ===========================================================================
--   * The recipient is resolved HERE, from the movement chain. No function
--     takes a recipient, a phone number or a message text from the client.
--   * The message texts are fixed server-side templates
--     (`src/lib/movementNoticeMessages.ts`); the database returns only the
--     facts they need.
--   * The Next.js server has no service-role key by design, so it calls these
--     functions with the signed-in user's token. They are SECURITY DEFINER
--     with a fixed `search_path`, revoked from PUBLIC/anon, granted to
--     `authenticated`, and each validates `auth.uid()`/role itself and fails
--     closed on a missing profile.
--   * Every attempt is a row in `public.movement_notices`. Clients hold SELECT
--     only: there is no INSERT/UPDATE/DELETE policy and no write grant, so the
--     functions below are the only write path.
--
-- ===========================================================================
-- `profiles.mobile_number`
-- ===========================================================================
--   New nullable column, set only by `public.admin_set_user_mobile` (0014
--   limits a client UPDATE on `profiles` to `full_name`, and the INSERT policy
--   is admin only). It is NOT added to the `profile_names` view (0099), which
--   stays id/full_name/role.
--   Read access follows the unchanged `select_profiles` policy of 0076 and the
--   table-wide SELECT grant: a user reads his own number, an admin and a
--   `monitor` read every number, and a workshop role reads the numbers of the
--   other workshop-role users. A `supervisor` reads only his own. Profile RLS
--   is deliberately not redesigned in this batch.
--
-- ===========================================================================
-- Accepted disclosure
-- ===========================================================================
--   `request_workshop_arrival_notice` and `prepare_movement_exit_notice`
--   return the recipient's mobile number to their caller, because the server
--   that sends the message runs with that caller's token. A workshop role can
--   therefore learn the mobile of the foreman of a unit that is on site, and
--   the recorder of an exit can learn the mobile of the one user his exit
--   notifies. The owner accepted this (they phone each other today). The
--   returned row is limited to the columns the message needs.
--
-- ===========================================================================
-- Decisions
-- ===========================================================================
--   * Delete behaviour. `entry_log_id` and `movement_id` reference
--     `entry_exit_logs` with ON DELETE SET NULL, so `admin_delete_movement`
--     (0108) keeps working unchanged and the attempt log survives the deleted
--     movement. `sender_id`/`recipient_id` reference `auth.users` (as
--     `entry_exit_logs.supervisor_id` does) with ON DELETE SET NULL, so a
--     notice never blocks deleting a user. `equipment_id` is ON DELETE CASCADE:
--     an equipment that still has movements cannot be deleted anyway (RESTRICT
--     on `entry_exit_logs`), so this only removes orphaned log rows.
--   * Lock. Both notice functions serialise on their OWN per-equipment
--     advisory key, `hashtextextended('movement_notice:' || equipment_id, 0)`,
--     so two officers pressing "notify" at the same moment queue and the
--     10-minute rule cannot be raced. They deliberately do NOT take the
--     sequence trigger's key: inserting a notice takes a FOR KEY SHARE lock on
--     the referenced `entry_exit_logs` row, while the functions of 0108 lock
--     that row FOR UPDATE first and the trigger's key second, which would be an
--     ABBA deadlock. With a separate key a notice only ever waits for a row
--     lock while holding a key nobody else in 0108 asks for. The price is that
--     the "latest movement" read is a plain read: a movement committed in the
--     same instant may be missed, which at worst sends one unnecessary notice.
--   * 10-minute rule. A repeated `workshop_arrival` for the same site entry is
--     refused while a notice of that entry with status `sent` or `pending`, or
--     one that failed by `timeout` (the gateway may have delivered it), is
--     younger than 10 minutes. Other failures, `no_mobile` and `not_configured`
--     may be retried immediately, but never more than 3 attempts per entry in
--     10 minutes whatever their status: the status of a notice is written with
--     its sender's own token, so a limit that trusted it alone could be
--     bypassed by marking a running send as failed.
--   * "A notice exists" (site_exit). ANY `workshop_arrival` attempt for the
--     entry counts, whatever its status: the officer did ask, and he should
--     learn that the exit was recorded even when his own message failed.
--   * Idempotency. One automatic notice per `(movement_id, kind)`, enforced by
--     a unique partial index. A repeated call for the same exit returns zero
--     rows, so a retried API call cannot send twice (at most once).

-- `profiles` is read by every request. Fail fast instead of queueing the
-- application behind this migration if another session holds a lock on it.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. profiles.mobile_number
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mobile_number text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_mobile_number_format;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_mobile_number_format
  CHECK (mobile_number IS NULL OR mobile_number ~ '^\+?[0-9]{8,15}$');

COMMENT ON COLUMN public.profiles.mobile_number IS
  'WhatsApp number used for movement notices. Written only by admin_set_user_mobile. Never exposed through profile_names.';

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

  UPDATE public.profiles p
  SET mobile_number = v_mobile
  WHERE p.id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found'
      USING HINT = 'No user matches this identifier.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_set_user_mobile(uuid, text) IS
  'Admin-only. Sets or clears (NULL/empty) profiles.mobile_number after removing spaces and dashes; the value must be 8 to 15 digits with an optional leading plus. Stable codes: admin_required, user_not_found, invalid_mobile.';

REVOKE ALL ON FUNCTION public.admin_set_user_mobile(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_mobile(uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The attempt log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.movement_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL
    CHECK (kind IN ('workshop_arrival', 'site_exit', 'workshop_exit')),
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  -- The site ENTRY the notice is about.
  entry_log_id uuid REFERENCES public.entry_exit_logs(id) ON DELETE SET NULL,
  -- The EXIT that triggered an automatic notice; NULL for workshop_arrival.
  movement_id uuid REFERENCES public.entry_exit_logs(id) ON DELETE SET NULL,
  -- The signed-in user whose action caused the notice.
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'no_mobile', 'not_configured')),
  provider_message_id text
    CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 100),
  -- A short safe code, never raw provider text.
  error_code text
    CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

COMMENT ON TABLE public.movement_notices IS
  'One row per WhatsApp notice attempt between the workshop and the site foremen (migration 0110). Written only by request_workshop_arrival_notice, prepare_movement_exit_notice and complete_movement_notice; clients hold SELECT only. Holds no phone number and no message text.';

-- The 10-minute rule, the site_exit lookup and "was this entry already
-- reported": the notices of one site entry, newest first.
CREATE INDEX IF NOT EXISTS movement_notices_entry_kind_created_idx
  ON public.movement_notices (entry_log_id, kind, created_at DESC, id DESC);

-- Idempotency of the automatic notices: one per exit and kind. Also serves
-- the `movement_id` foreign key.
CREATE UNIQUE INDEX IF NOT EXISTS movement_notices_movement_kind_key
  ON public.movement_notices (movement_id, kind)
  WHERE movement_id IS NOT NULL;

-- "Was this unit reported" by equipment, and the equipment foreign key.
CREATE INDEX IF NOT EXISTS movement_notices_equipment_created_idx
  ON public.movement_notices (equipment_id, created_at DESC);

-- The sender/recipient branches of the SELECT policy and their foreign keys.
CREATE INDEX IF NOT EXISTS movement_notices_sender_idx
  ON public.movement_notices (sender_id);
CREATE INDEX IF NOT EXISTS movement_notices_recipient_idx
  ON public.movement_notices (recipient_id);

ALTER TABLE public.movement_notices ENABLE ROW LEVEL SECURITY;

-- Supabase grants every privilege on a new public table to the API roles by
-- default. Clients read only; every write goes through the functions below.
REVOKE ALL ON TABLE public.movement_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.movement_notices TO authenticated;

-- An admin, the sender and the recipient read a notice. Every workshop role
-- also reads the `workshop_arrival` rows, so any officer sees that a unit was
-- already reported. `current_user_role()` is NULL for a missing profile, so
-- the last branch fails closed. There is deliberately no INSERT, UPDATE or
-- DELETE policy.
DROP POLICY IF EXISTS "select_movement_notices" ON public.movement_notices;
CREATE POLICY "select_movement_notices" ON public.movement_notices
FOR SELECT TO authenticated USING (
  public.is_admin()
  OR sender_id = auth.uid()
  OR recipient_id = auth.uid()
  OR (
    kind = 'workshop_arrival'
    AND public.current_user_role() IN (
      'workshop', 'assistant_workshop_manager', 'workshop_manager'
    )
  )
);

-- ---------------------------------------------------------------------------
-- 3. Internal helper: the facts the server needs to send one notice
-- ---------------------------------------------------------------------------
-- Deliberately NOT SECURITY DEFINER and not executable by any client role. It
-- is called only from the SECURITY DEFINER functions below, where it runs with
-- their owner's rights. Should it ever be granted by mistake, it would run
-- with the caller's rights and the RLS of every table it reads would apply.
-- Project and company are those of the site ENTRY the notice is about.
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
    r.mobile_number,
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
  LEFT JOIN public.profiles s ON s.id = n.sender_id
  WHERE n.id = p_notice_id;
$$;

COMMENT ON FUNCTION public.movement_notice_payload(uuid) IS
  'Internal. The minimum facts the server needs to send one movement notice: recipient name and mobile, equipment code and type, project and company of the site entry, sender name. Not executable by client roles.';

REVOKE ALL ON FUNCTION public.movement_notice_payload(uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Notice 1 (manual): the unit arrived at the workshop
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_workshop_arrival_notice(p_equipment_id uuid)
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_last public.entry_exit_logs;
  v_notice_id uuid;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
  -- Fail closed: no session and a missing profile (NULL role) are rejected.
  IF auth.uid() IS NULL
     OR v_role IS NULL
     OR v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager') THEN
    RAISE EXCEPTION 'notice_role_required'
      USING ERRCODE = '42501',
            HINT = 'Only a workshop role or an admin may notify a foreman.';
  END IF;

  IF p_equipment_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.equipment e WHERE e.id = p_equipment_id) THEN
    RAISE EXCEPTION 'equipment_not_found'
      USING HINT = 'No equipment matches this identifier.';
  END IF;

  -- The notices' own per-equipment key (NOT the sequence trigger's, see the
  -- header): two officers pressing at the same moment queue here, so the
  -- 10-minute check below cannot be raced.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('movement_notice:' || p_equipment_id::text, 0)
  );

  SELECT l.* INTO v_last
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  IF NOT FOUND
     OR v_last.movement_type IS DISTINCT FROM 'entry'
     OR v_last.movement_context IS DISTINCT FROM 'site' THEN
    RAISE EXCEPTION 'equipment_not_on_site'
      USING HINT = 'The equipment has no open site entry.';
  END IF;

  -- A successful (or still running) send, and a timeout the gateway may have
  -- delivered anyway, block a repeat for 10 minutes. Another failed or
  -- impossible send may be retried immediately, but the attempts of one entry
  -- are capped whatever their status, because the status is written with the
  -- sender's own token and must not be the only limit.
  IF EXISTS (
    SELECT 1
    FROM public.movement_notices n
    WHERE n.entry_log_id = v_last.id
      AND n.kind = 'workshop_arrival'
      AND n.created_at > now() - interval '10 minutes'
      AND (
        n.status IN ('sent', 'pending')
        OR (n.status = 'failed' AND n.error_code = 'timeout')
      )
  ) OR (
    SELECT count(*)
    FROM public.movement_notices n
    WHERE n.entry_log_id = v_last.id
      AND n.kind = 'workshop_arrival'
      AND n.created_at > now() - interval '10 minutes'
  ) >= 3 THEN
    RAISE EXCEPTION 'notice_recently_sent'
      USING HINT = 'The foreman of this site entry was notified less than 10 minutes ago.';
  END IF;

  -- The recipient is the foreman who recorded the open site entry. It is
  -- never supplied by the caller.
  INSERT INTO public.movement_notices (
    kind, equipment_id, entry_log_id, movement_id, sender_id, recipient_id, status
  ) VALUES (
    'workshop_arrival', v_last.equipment_id, v_last.id, NULL,
    auth.uid(), v_last.supervisor_id, 'pending'
  )
  RETURNING id INTO v_notice_id;

  RETURN QUERY
  SELECT x.*
  FROM public.movement_notice_payload(v_notice_id) AS x;
END;
$$;

COMMENT ON FUNCTION public.request_workshop_arrival_notice(uuid) IS
  'Workshop roles and admin. Logs a pending workshop_arrival notice for the equipment''s OPEN site entry (its latest movement by (recorded_at, id)) addressed to the foreman who recorded it, and returns the facts the server needs to send it. Serialises on the notices'' own per-equipment advisory key. Stable codes: notice_role_required, equipment_not_found, equipment_not_on_site, notice_recently_sent (a sent, pending or timed-out notice of the same entry younger than 10 minutes, or 3 attempts of any status in 10 minutes).';

REVOKE ALL ON FUNCTION public.request_workshop_arrival_notice(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_workshop_arrival_notice(uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Notices 2 and 3 (automatic): after an EXIT was recorded
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_movement_exit_notice(p_movement_id uuid)
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_allowed boolean;
  v_log public.entry_exit_logs;
  v_closed_entry public.entry_exit_logs;
  v_previous public.entry_exit_logs;
  v_site_entry public.entry_exit_logs;
  v_kind text;
  v_recipient uuid;
  v_notice_id uuid;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();

  SELECT l.* INTO v_log
  FROM public.entry_exit_logs l
  WHERE l.id = p_movement_id;

  -- The movement's own recorder, or an admin. `IS NOT TRUE` also rejects a
  -- missing row, no session and a missing profile (NULL role), so the check
  -- fails closed and a refused caller cannot tell a foreign movement from a
  -- missing one.
  v_allowed := FOUND
    AND auth.uid() IS NOT NULL
    AND v_role IS NOT NULL
    AND (v_role = 'admin' OR v_log.supervisor_id = auth.uid());
  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'movement_not_accessible'
      USING ERRCODE = '42501',
            HINT = 'Only the user who recorded the movement, or an admin, may trigger its notice.';
  END IF;

  IF v_log.movement_type IS DISTINCT FROM 'exit' THEN
    RAISE EXCEPTION 'movement_not_exit'
      USING HINT = 'Only an exit triggers an automatic notice.';
  END IF;

  -- Only a freshly saved exit. The server calls this right after the insert
  -- (the sequence trigger stamps `created_at := now()`), so an old exit is
  -- never the server: refusing it keeps a recorder from replaying his past
  -- exits to collect recipients' numbers or to leave pending rows behind.
  IF v_log.created_at < now() - interval '10 minutes' THEN RETURN; END IF;

  -- The notices' own per-equipment key (NOT the sequence trigger's, see the
  -- header), so two calls for the same equipment queue.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('movement_notice:' || v_log.equipment_id::text, 0)
  );

  -- The ENTRY this exit closed: the nearest earlier entry of the equipment in
  -- the global order, exactly how the sequence trigger finds `v_last_entry`.
  SELECT l.* INTO v_closed_entry
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = v_log.equipment_id
    AND l.movement_type = 'entry'
    AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_log.movement_context = 'site' THEN
    -- Notice 2. Only a site exit that closed a SITE entry, and only when
    -- somebody reported the unit for that entry. Any attempt counts, whatever
    -- its status; the latest one decides the recipient.
    IF v_closed_entry.movement_context IS DISTINCT FROM 'site' THEN RETURN; END IF;

    SELECT n.sender_id INTO v_recipient
    FROM public.movement_notices n
    WHERE n.entry_log_id = v_closed_entry.id
      AND n.kind = 'workshop_arrival'
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 1;
    IF NOT FOUND OR v_recipient IS NULL THEN RETURN; END IF;

    v_kind := 'site_exit';
    v_site_entry := v_closed_entry;
  ELSE
    -- Notice 3. The workshop exit closed a WORKSHOP entry; the movement
    -- immediately before that entry must be a SITE exit, and the recipient is
    -- the foreman of the SITE entry that exit closed.
    IF v_closed_entry.movement_context IS DISTINCT FROM 'workshop' THEN RETURN; END IF;

    SELECT l.* INTO v_previous
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id
      AND (l.recorded_at, l.id) < (v_closed_entry.recorded_at, v_closed_entry.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF NOT FOUND
       OR v_previous.movement_type IS DISTINCT FROM 'exit'
       OR v_previous.movement_context IS DISTINCT FROM 'site' THEN
      RETURN;
    END IF;

    SELECT l.* INTO v_site_entry
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id
      AND l.movement_type = 'entry'
      AND (l.recorded_at, l.id) < (v_previous.recorded_at, v_previous.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF NOT FOUND OR v_site_entry.movement_context IS DISTINCT FROM 'site' THEN
      RETURN;
    END IF;

    v_kind := 'workshop_exit';
    v_recipient := v_site_entry.supervisor_id;
  END IF;

  -- One automatic notice per exit and kind (unique partial index). A repeated
  -- call inserts nothing and returns zero rows, so it can never send twice.
  INSERT INTO public.movement_notices (
    kind, equipment_id, entry_log_id, movement_id, sender_id, recipient_id, status
  ) VALUES (
    v_kind, v_log.equipment_id, v_site_entry.id, v_log.id,
    auth.uid(), v_recipient, 'pending'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_notice_id;

  IF v_notice_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT x.*
  FROM public.movement_notice_payload(v_notice_id) AS x;
END;
$$;

COMMENT ON FUNCTION public.prepare_movement_exit_notice(uuid) IS
  'Called by the server after an EXIT was saved, by its recorder or an admin. Site exit: when a workshop_arrival notice exists for the site entry it closed (any status, latest one), logs a pending site_exit notice to that notice''s sender. Workshop exit: when the movement immediately before the workshop entry it closed is a site exit, logs a pending workshop_exit notice to the foreman of the site entry that exit closed. Returns the facts needed to send, or zero rows when there is nothing to send or the notice of this exit already exists. Stable codes: movement_not_accessible, movement_not_exit.';

REVOKE ALL ON FUNCTION public.prepare_movement_exit_notice(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_movement_exit_notice(uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Recording the result of a send
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_movement_notice(
  p_notice_id uuid,
  p_status text,
  p_provider_message_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_error_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'notice_not_pending'
      USING ERRCODE = '42501',
            HINT = 'Authentication is required.';
  END IF;

  IF p_status IS NULL
     OR p_status NOT IN ('sent', 'failed', 'no_mobile', 'not_configured') THEN
    RAISE EXCEPTION 'invalid_notice_status';
  END IF;

  -- Only a short safe code is stored, never raw provider text.
  IF p_status = 'failed' THEN
    v_error_code := lower(btrim(COALESCE(p_error_code, '')));
    IF v_error_code !~ '^[a-z0-9_]{1,40}$' THEN
      v_error_code := 'unknown';
    END IF;
  END IF;

  -- Only the sender, and only once: a completed notice is never rewritten. A
  -- foreign or missing notice is reported exactly like a completed one.
  UPDATE public.movement_notices n
  SET status = p_status,
      provider_message_id = CASE
        WHEN p_status = 'sent' THEN NULLIF(left(btrim(p_provider_message_id), 100), '')
      END,
      error_code = v_error_code,
      completed_at = now()
  WHERE n.id = p_notice_id
    AND n.sender_id = auth.uid()
    AND n.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'notice_not_pending'
      USING HINT = 'The notice does not exist, is not yours, or was already completed.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.complete_movement_notice(uuid, text, text, text) IS
  'Records the outcome of one notice: only its sender, only from pending, status sent/failed/no_mobile/not_configured. Stores a short safe error code for a failed send and sets completed_at. Stable codes: notice_not_pending, invalid_notice_status.';

REVOKE ALL ON FUNCTION public.complete_movement_notice(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_movement_notice(uuid, text, text, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
