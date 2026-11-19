-- 0205: the daily WhatsApp reminder of installment due dates.
--
-- Owner decisions: 2026-11-18 (ONE summary message a day at 9:00 Saudi time,
-- only when there is something to say: the unpaid installments of ACTIVE
-- contracts that are overdue — repeated every day until paid — and the ones
-- coming due; sent server side through the UltraMsg gateway, logged, never
-- twice the same day to the same person; triggered by Vercel Cron calling a
-- secret-protected route) and 2026-11-19 («خلي التذكير يكون لعمر بلبحيث
-- فقط»: one recipient; then, after seeing the message, «بس … الي مستحقة
-- خلال يوم» and, asked, «بكرة بس» with the overdue ones kept: the message
-- holds the OVERDUE rows and the rows due TOMORROW only — not today's, not
-- the 7-day ones; a row due today was in yesterday's message and is in
-- tomorrow's as overdue when it is still unpaid).
--
-- ===========================================================================
-- What this adds
-- ===========================================================================
--   * installment_reminder_recipients — who gets the reminder (a profile id
--     and an on / off switch). Seeded with the one profile named
--     «عمر بلبحيث» (288433b5-8285-458e-af6c-97ba7ea833c0, found read-only on
--     2026-11-19; the insert is skipped if that profile is gone). The mobile
--     number is NOT stored here: it is read from profile_contacts at send
--     time, so changing it on the user page is enough. No client role reads
--     or writes this table; it is changed by a SQL statement for now.
--   * installment_reminder_config — ONE row holding the SHA-256 (hex) of the
--     route's secret, seeded below with the hash of the secret generated on
--     2026-11-19 for the owner (he put the secret itself in Vercel as
--     CRON_SECRET; it is in no file of the repository). A hash of 48 random
--     letters and digits cannot be turned back into the secret. To change
--     the secret: a new CRON_SECRET in Vercel, a redeploy, and an UPDATE of
--     key_hash. NULL makes both functions refuse with reminder_not_configured.
--   * installment_reminder_log — one row per recipient per Saudi day with the
--     outcome (nothing / pending / sent / failed / no_mobile /
--     not_configured), the counts and the total. It holds no phone number and
--     no message text. Read by installments.view (the admin today); no client
--     writes.
--   * prepare_installment_reminder(p_key) and
--     complete_installment_reminder(p_key, p_log_id, p_status,
--     p_provider_message_id, p_error_code): the only path. SECURITY DEFINER,
--     fixed search_path, executable by `anon` ONLY.
--
-- ===========================================================================
-- Why `anon` + a secret, and not the service role key
-- ===========================================================================
--   A cron call has no signed-in user, so there is no user token to forward
--   as the other notices do. The Next.js server of this project holds only
--   the public anon key (no service role key anywhere in the app; the Edge
--   Functions have their own). Adding the service role key to Vercel would
--   give that server a key that bypasses every RLS policy, for a job that
--   needs one read and two small writes. Instead the two functions here are
--   the only thing the job can call, and each refuses unless the caller
--   passes the secret whose hash is stored in installment_reminder_config.
--   The route forwards the same CRON_SECRET that Vercel sends it, so there is
--   ONE secret, kept in Vercel. The anon key is public, but without the
--   secret both functions refuse (reminder_key_invalid, 42501) before they
--   read anything.
--
-- ===========================================================================
-- Once a day
-- ===========================================================================
--   The day is saudi_today(). The log is UNIQUE (profile_id, reminder_day).
--   prepare claims the row with ONE INSERT … ON CONFLICT DO UPDATE … WHERE
--   status is not 'sent' or 'pending', so two runs at the same time (Vercel
--   may deliver a scheduled run twice) cannot both get it. A row already
--   'sent' or 'pending' means nothing more is sent that day — a 'pending'
--   row left by a run that stopped half way also blocks the day (at most
--   once, never twice). A row 'failed', 'no_mobile', 'not_configured' or
--   'nothing' may be tried again the same day by a later run (a manual run
--   after the number was added, or after a contract was recorded).
--
-- Tokens: reminder_key_invalid (42501), reminder_not_configured (55000),
-- invalid_reminder_log (22023), invalid_reminder_status (22023).

SET LOCAL lock_timeout = '5s';

-- ===========================================================================
-- 1. Recipients
-- ===========================================================================
CREATE TABLE public.installment_reminder_recipients (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.installment_reminder_recipients IS
  '0205: who receives the daily installments WhatsApp reminder. The mobile comes from profile_contacts at send time. No client role reads or writes it; read only by prepare_installment_reminder.';

CREATE TRIGGER installment_reminder_recipients_updated_at
  BEFORE UPDATE ON public.installment_reminder_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.installment_reminder_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.installment_reminder_recipients
  FROM PUBLIC, anon, authenticated;

INSERT INTO public.installment_reminder_recipients (profile_id)
SELECT p.id
FROM public.profiles p
WHERE p.id = '288433b5-8285-458e-af6c-97ba7ea833c0'::uuid
ON CONFLICT (profile_id) DO NOTHING;

-- ===========================================================================
-- 2. The secret's hash (one row)
-- ===========================================================================
CREATE TABLE public.installment_reminder_config (
  id boolean PRIMARY KEY DEFAULT true
    CONSTRAINT installment_reminder_config_single_row CHECK (id),
  key_hash text
    CONSTRAINT installment_reminder_config_key_hash_format
      CHECK (key_hash IS NULL OR key_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.installment_reminder_config IS
  '0205: one row. key_hash = encode(sha256(convert_to(<CRON_SECRET>, ''UTF8'')), ''hex''). NULL = the reminder is not configured. No client role reads or writes it.';

CREATE TRIGGER installment_reminder_config_updated_at
  BEFORE UPDATE ON public.installment_reminder_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.installment_reminder_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.installment_reminder_config
  FROM PUBLIC, anon, authenticated;

INSERT INTO public.installment_reminder_config (id, key_hash)
VALUES (true, '6327ca41228ed1852a18b283dac1c4a29874c73088ec0b0be48d278f4af4367d')
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- 3. The send log
-- ===========================================================================
CREATE TABLE public.installment_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- A snapshot, so the log still reads after the profile is renamed or gone.
  recipient_name text,
  reminder_day date NOT NULL,
  status text NOT NULL
    CONSTRAINT installment_reminder_log_status_check
      CHECK (status IN ('nothing', 'pending', 'sent', 'failed', 'no_mobile', 'not_configured')),
  overdue_count integer NOT NULL DEFAULT 0,
  due_tomorrow_count integer NOT NULL DEFAULT 0,
  total_amount numeric(14, 2) NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  provider_message_id text
    CONSTRAINT installment_reminder_log_provider_id_check
      CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 100),
  -- A short safe code, never raw provider text.
  error_code text
    CONSTRAINT installment_reminder_log_error_code_check
      CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT installment_reminder_log_once_a_day UNIQUE (profile_id, reminder_day)
);

COMMENT ON TABLE public.installment_reminder_log IS
  '0205: one row per recipient per Saudi day: the outcome of the installments reminder, its counts and total. No phone number, no message text. Written only by prepare_installment_reminder / complete_installment_reminder; read by installments.view.';

CREATE INDEX installment_reminder_log_day_idx
  ON public.installment_reminder_log (reminder_day DESC);

ALTER TABLE public.installment_reminder_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.installment_reminder_log
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.installment_reminder_log TO authenticated;

CREATE POLICY select_installment_reminder_log ON public.installment_reminder_log
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('installments.view')));

-- ===========================================================================
-- 4. The secret check
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.assert_installment_reminder_key(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hash text;
BEGIN
  SELECT c.key_hash INTO v_hash
  FROM public.installment_reminder_config c
  WHERE c.id;

  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'reminder_not_configured' USING ERRCODE = '55000';
  END IF;

  IF p_key IS NULL
     OR char_length(p_key) NOT BETWEEN 16 AND 256
     OR encode(sha256(convert_to(p_key, 'UTF8')), 'hex') <> v_hash THEN
    RAISE EXCEPTION 'reminder_key_invalid' USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_installment_reminder_key(text) IS
  '0205: raises reminder_not_configured (55000) while no hash is set, reminder_key_invalid (42501) unless sha256(p_key) is the stored hash. Called first by the two reminder functions; executable by nobody else.';

REVOKE ALL ON FUNCTION public.assert_installment_reminder_key(text)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 5. Prepare today's reminder
-- ===========================================================================
-- Returns
--   { "day": "YYYY-MM-DD",
--     "items": [ { "bucket": "overdue" | "tomorrow", "contract_number",
--                  "description", "financier_name", "seq", "due_date",
--                  "remaining_amount", "days_until_due" } … ],
--     "recipients": [ { "log_id", "name", "mobile" } … ],
--     "skipped": <recipients already sent or in progress today> }
-- `recipients` is empty when there is nothing to say (the rows are logged as
-- 'nothing') or when every recipient already has today's reminder.
CREATE OR REPLACE FUNCTION public.prepare_installment_reminder(p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date;
  v_items jsonb;
  v_overdue integer;
  v_tomorrow integer;
  v_total numeric(14, 2);
  v_recipients jsonb := '[]'::jsonb;
  v_skipped integer := 0;
  v_rcpt record;
  v_log_id uuid;
BEGIN
  PERFORM public.assert_installment_reminder_key(p_key);

  v_day := public.saudi_today();

  WITH due AS (
    SELECT
      CASE
        WHEN s.due_date < v_day THEN 'overdue'
        ELSE 'tomorrow'
      END AS bucket,
      c.contract_number,
      c.description,
      f.name AS financier_name,
      s.seq,
      s.due_date,
      (s.amount - s.paid_amount) AS remaining_amount,
      (s.due_date - v_day) AS days_until_due
    FROM public.installment_schedule s
    JOIN public.installment_contracts c ON c.id = s.contract_id
    JOIN public.installment_financiers f ON f.id = c.financier_id
    WHERE c.status = 'active'
      AND s.paid_amount < s.amount
      AND (s.due_date < v_day OR s.due_date = v_day + 1)
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bucket', d.bucket,
          'contract_number', d.contract_number,
          'description', d.description,
          'financier_name', d.financier_name,
          'seq', d.seq,
          'due_date', d.due_date,
          'remaining_amount', d.remaining_amount,
          'days_until_due', d.days_until_due
        )
        ORDER BY
          CASE d.bucket WHEN 'overdue' THEN 1 ELSE 2 END,
          d.due_date, d.contract_number, d.seq
      ),
      '[]'::jsonb
    ),
    count(*) FILTER (WHERE d.bucket = 'overdue'),
    count(*) FILTER (WHERE d.bucket = 'tomorrow'),
    COALESCE(sum(d.remaining_amount), 0)
  INTO v_items, v_overdue, v_tomorrow, v_total
  FROM due d;

  FOR v_rcpt IN
    SELECT rr.profile_id, p.full_name, pc.mobile_number
    FROM public.installment_reminder_recipients rr
    JOIN public.profiles p ON p.id = rr.profile_id
    LEFT JOIN public.profile_contacts pc ON pc.user_id = rr.profile_id
    WHERE rr.is_active
    ORDER BY rr.created_at, rr.profile_id
  LOOP
    v_log_id := NULL;

    IF jsonb_array_length(v_items) = 0 THEN
      INSERT INTO public.installment_reminder_log AS l (
        profile_id, recipient_name, reminder_day, status, completed_at
      ) VALUES (v_rcpt.profile_id, v_rcpt.full_name, v_day, 'nothing', now())
      ON CONFLICT (profile_id, reminder_day) DO UPDATE
        SET status = 'nothing',
            recipient_name = EXCLUDED.recipient_name,
            overdue_count = 0, due_tomorrow_count = 0,
            total_amount = 0, completed_at = now()
        WHERE l.status NOT IN ('sent', 'pending')
      RETURNING l.id INTO v_log_id;
      IF v_log_id IS NULL THEN
        v_skipped := v_skipped + 1;
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.installment_reminder_log AS l (
      profile_id, recipient_name, reminder_day, status,
      overdue_count, due_tomorrow_count, total_amount, attempts
    ) VALUES (
      v_rcpt.profile_id, v_rcpt.full_name, v_day, 'pending',
      v_overdue, v_tomorrow, v_total, 1
    )
    ON CONFLICT (profile_id, reminder_day) DO UPDATE
      SET status = 'pending',
          recipient_name = EXCLUDED.recipient_name,
          overdue_count = EXCLUDED.overdue_count,
          due_tomorrow_count = EXCLUDED.due_tomorrow_count,
          total_amount = EXCLUDED.total_amount,
          attempts = l.attempts + 1,
          provider_message_id = NULL,
          error_code = NULL,
          completed_at = NULL
      WHERE l.status NOT IN ('sent', 'pending')
    RETURNING l.id INTO v_log_id;

    IF v_log_id IS NULL THEN
      v_skipped := v_skipped + 1;
    ELSE
      v_recipients := v_recipients || jsonb_build_object(
        'log_id', v_log_id,
        'name', v_rcpt.full_name,
        'mobile', v_rcpt.mobile_number
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'day', v_day,
    'items', v_items,
    'recipients', v_recipients,
    'skipped', v_skipped
  );
END;
$$;

COMMENT ON FUNCTION public.prepare_installment_reminder(text) IS
  '0205: after the secret check, collects today''s (saudi_today()) unpaid installments of active contracts — overdue and due tomorrow — and claims one log row per active recipient for today (pending; nothing when there is nothing to say; skipped when today''s row is already sent or pending). Returns the items and the claimed recipients with their mobile. Executable by anon only (the cron route).';

REVOKE ALL ON FUNCTION public.prepare_installment_reminder(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_installment_reminder(text) TO anon;

-- ===========================================================================
-- 6. Record the outcome
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.complete_installment_reminder(
  p_key text,
  p_log_id uuid,
  p_status text,
  p_provider_message_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_installment_reminder_key(p_key);

  IF p_log_id IS NULL THEN
    RAISE EXCEPTION 'invalid_reminder_log' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL
     OR p_status NOT IN ('sent', 'failed', 'no_mobile', 'not_configured') THEN
    RAISE EXCEPTION 'invalid_reminder_status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.installment_reminder_log l
  SET status = p_status,
      provider_message_id = CASE
        WHEN p_provider_message_id IS NOT NULL
             AND char_length(p_provider_message_id) <= 100
          THEN p_provider_message_id
      END,
      error_code = CASE
        WHEN p_error_code ~ '^[a-z0-9_]{1,40}$' THEN p_error_code
      END,
      completed_at = now()
  WHERE l.id = p_log_id
    AND l.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_reminder_log' USING ERRCODE = '22023';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.complete_installment_reminder(text, uuid, text, text, text) IS
  '0205: after the secret check, records the outcome of one pending reminder row (sent / failed / no_mobile / not_configured). invalid_reminder_log when the row is unknown or no longer pending. Executable by anon only (the cron route).';

REVOKE ALL ON FUNCTION public.complete_installment_reminder(text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_installment_reminder(text, uuid, text, text, text)
  TO anon;
