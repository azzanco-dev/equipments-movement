-- 0196: WhatsApp notices for a workshop stay nested in a project visit.
--
-- Owner decisions 2026-11-14 (all three approved: «اعتمد على الثلاثة»), the
-- notices part: the foreman of the OPEN project visit is told when his unit
-- enters the workshop and when it leaves it; «ابلاغ الفورمان» goes away (the
-- workshop no longer needs the project exit to record its entry, 0195).
--
-- Object by object:
--   1. movement_notices.kind accepts two more kinds, workshop_entry and
--      workshop_return. The 0110 CHECK (unnamed, so movement_notices_kind_check
--      by PostgreSQL's rule) is replaced by the named CHECK
--      movement_notices_kind_check over the five kinds; any other CHECK of the
--      table naming 'workshop_arrival' is dropped first so a differently named
--      old constraint cannot linger. Stored rows are not touched (they hold
--      the three old kinds only).
--   2. prepare_movement_notice(p_movement_id uuid): NEW. The RETURNS TABLE,
--      the caller rule (the movement's own recorder, or movements.edit_delete;
--      movement_not_accessible 42501), the freshness rule (a movement created
--      more than 10 minutes ago returns nothing), the notices' own advisory
--      key and the one-notice-per-(movement, kind) insert of
--      prepare_movement_exit_notice (latest 0156), with:
--        * a workshop ENTRY while the unit's site visit is open (its latest
--          site movement before the entry is an ENTRY) -> workshop_entry,
--          recipient = that site entry's supervisor_id, entry_log_id = that
--          site entry;
--        * a workshop EXIT while the site visit is open -> workshop_return,
--          the same recipient and entry_log_id;
--        * a workshop EXIT otherwise -> the workshop_exit rule unchanged (the
--          workshop entry it closed, the movement right before it a site
--          exit, the foreman of the site entry that exit closed), the two
--          entries looked up in their own context;
--        * a site EXIT -> the site_exit rule (the latest workshop_arrival
--          sender of the entry it closed), the entry it closed being the
--          latest SITE entry before it;
--        * a site ENTRY -> nothing (zero rows, no error); a workshop ENTRY
--          with no open site visit -> nothing;
--        * never a notice whose recipient is the caller himself.
--      SECURITY DEFINER, SET search_path = public, pg_temp, REVOKE ALL FROM
--      PUBLIC, anon, GRANT EXECUTE TO authenticated.
-- Left exactly as they are: prepare_movement_exit_notice (the screens live
-- before the deploy call it after every exit), request_workshop_arrival_notice,
-- movement_notice_payload (its project and company come from entry_log_id,
-- the site entry, for the new kinds too), complete_movement_notice and the
-- table's policies.
--
-- Rollout: apply after 0195 and BEFORE deploying the screens that call
-- prepare_movement_notice (after every saved movement except a site entry).
-- The live screens keep calling prepare_movement_exit_notice.

-- ===========================================================================
-- 1. The two new kinds
-- ===========================================================================
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.movement_notices'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%workshop_arrival%'
  LOOP
    EXECUTE format('ALTER TABLE public.movement_notices DROP CONSTRAINT %I', v_name);
  END LOOP;
END;
$$;

ALTER TABLE public.movement_notices
  ADD CONSTRAINT movement_notices_kind_check
  CHECK (kind IN (
    'workshop_arrival', 'site_exit', 'workshop_exit',
    'workshop_entry', 'workshop_return'
  ));

COMMENT ON TABLE public.movement_notices IS
  'One row per WhatsApp notice attempt between the workshop and the site foremen (migration 0110). Kinds: workshop_arrival, site_exit, workshop_exit, and since 0196 workshop_entry / workshop_return (a workshop stay nested in an open project visit; entry_log_id is that project visit''s entry). Written only by request_workshop_arrival_notice, prepare_movement_exit_notice, prepare_movement_notice (0196) and complete_movement_notice; clients hold SELECT only. Holds no phone number and no message text.';

-- ===========================================================================
-- 2. prepare_movement_notice
-- ===========================================================================
-- From prepare_movement_exit_notice, latest 0156.
CREATE OR REPLACE FUNCTION public.prepare_movement_notice(p_movement_id uuid)
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
  v_allowed boolean;
  v_log public.entry_exit_logs;
  v_closed_entry public.entry_exit_logs;
  v_previous public.entry_exit_logs;
  v_site_entry public.entry_exit_logs;
  v_site_last public.entry_exit_logs;
  v_kind text;
  v_recipient uuid;
  v_notice_id uuid;
BEGIN
  SELECT l.* INTO v_log
  FROM public.entry_exit_logs l
  WHERE l.id = p_movement_id;

  -- The movement's own recorder, or an admin. `IS NOT TRUE` also rejects a
  -- missing row, no session and a missing profile (NULL role), so the check
  -- fails closed and a refused caller cannot tell a foreign movement from a
  -- missing one.
  v_allowed := FOUND
    AND auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid())
    AND (public.has_permission('movements.edit_delete') OR v_log.supervisor_id = auth.uid());
  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'movement_not_accessible'
      USING ERRCODE = '42501',
            HINT = 'Only the user who recorded the movement, or an admin, may trigger its notice.';
  END IF;

  -- 0196: a site ENTRY never triggers a notice (zero rows, no error).
  IF v_log.movement_context = 'site' AND v_log.movement_type = 'entry' THEN
    RETURN;
  END IF;

  -- Only a freshly saved movement. The server calls this right after the insert
  -- (the sequence trigger stamps `created_at := now()`), so an old exit is
  -- never the server: refusing it keeps a recorder from replaying his past
  -- exits to collect recipients' numbers or to leave pending rows behind.
  IF v_log.created_at < now() - interval '10 minutes' THEN RETURN; END IF;

  -- The notices' own per-equipment key (NOT the sequence trigger's, see the
  -- header), so two calls for the same equipment queue.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('movement_notice:' || v_log.equipment_id::text, 0)
  );

  IF v_log.movement_context = 'workshop' THEN
    -- 0196: the unit's latest SITE movement before this workshop movement;
    -- an ENTRY means its project visit is open (the workshop stay is nested
    -- in it, 0195).
    SELECT l.* INTO v_site_last
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id
      AND l.movement_context = 'site'
      AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;

    IF FOUND AND v_site_last.movement_type = 'entry' THEN
      -- Notices 4 and 5: the foreman of the open project visit is told when
      -- his unit enters the workshop and when it leaves it.
      v_kind := CASE
        WHEN v_log.movement_type = 'entry' THEN 'workshop_entry'
        ELSE 'workshop_return'
      END;
      v_site_entry := v_site_last;
      v_recipient := v_site_last.supervisor_id;
    ELSIF v_log.movement_type = 'entry' THEN
      -- A workshop entry with no open project visit: nobody to tell.
      RETURN;
    ELSE
      -- Notice 3, the rule of prepare_movement_exit_notice (0110/0156): the
      -- workshop exit closed a WORKSHOP entry; the movement immediately
      -- before that entry must be a SITE exit, and the recipient is the
      -- foreman of the SITE entry that exit closed. 0196: both entries are
      -- looked up in their own context (the chain is per context, 0195).
      SELECT l.* INTO v_closed_entry
      FROM public.entry_exit_logs l
      WHERE l.equipment_id = v_log.equipment_id
        AND l.movement_context = 'workshop'
        AND l.movement_type = 'entry'
        AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)
      ORDER BY l.recorded_at DESC, l.id DESC
      LIMIT 1;
      IF NOT FOUND THEN RETURN; END IF;

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
        AND l.movement_context = 'site'
        AND l.movement_type = 'entry'
        AND (l.recorded_at, l.id) < (v_previous.recorded_at, v_previous.id)
      ORDER BY l.recorded_at DESC, l.id DESC
      LIMIT 1;
      IF NOT FOUND THEN RETURN; END IF;

      v_kind := 'workshop_exit';
      v_recipient := v_site_entry.supervisor_id;
    END IF;
  ELSE
    -- Notice 2, the rule of prepare_movement_exit_notice: a site exit, and
    -- only when somebody reported the unit for the entry it closed. 0196:
    -- that entry is the latest SITE entry before the exit (the chain is per
    -- context, 0195). Any attempt counts, whatever its status; the latest
    -- one decides the recipient.
    SELECT l.* INTO v_closed_entry
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_log.equipment_id
      AND l.movement_context = 'site'
      AND l.movement_type = 'entry'
      AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT n.sender_id INTO v_recipient
    FROM public.movement_notices n
    WHERE n.entry_log_id = v_closed_entry.id
      AND n.kind = 'workshop_arrival'
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 1;
    IF NOT FOUND OR v_recipient IS NULL THEN RETURN; END IF;

    v_kind := 'site_exit';
    v_site_entry := v_closed_entry;
  END IF;

  -- 0196: nobody to tell, or the recipient is the caller himself.
  IF v_recipient IS NULL OR v_recipient = auth.uid() THEN RETURN; END IF;

  -- One automatic notice per movement and kind (unique partial index). A repeated
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

REVOKE ALL ON FUNCTION public.prepare_movement_notice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_movement_notice(uuid) TO authenticated;

COMMENT ON FUNCTION public.prepare_movement_notice(uuid) IS
  '0196: the automatic notice of a freshly saved movement (created within 10 minutes), for its own recorder or movements.edit_delete (movement_not_accessible otherwise). A workshop ENTRY / EXIT while the unit''s project visit is open (its latest site movement before it is an entry): workshop_entry / workshop_return to that site entry''s foreman (entry_log_id = that entry). Otherwise a workshop EXIT follows the workshop_exit rule and a site EXIT the site_exit rule of prepare_movement_exit_notice (each entry looked up in its own context). A site ENTRY, or a workshop ENTRY with no open project visit, returns nothing. Never a notice to the caller himself; one per (movement, kind); returns movement_notice_payload of the new notice, or nothing.';

-- ===========================================================================
-- 3. The closing guard
-- ===========================================================================
DO $$
DECLARE
  v_def text;
BEGIN
  IF (SELECT count(*) FROM pg_constraint c
      WHERE c.conrelid = 'public.movement_notices'::regclass
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%workshop_arrival%') <> 1 THEN
    RAISE EXCEPTION '0196: movement_notices must carry exactly one kind CHECK';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.movement_notices'::regclass
    AND c.conname = 'movement_notices_kind_check';
  IF v_def IS NULL
     OR position('workshop_entry' IN v_def) = 0
     OR position('workshop_return' IN v_def) = 0 THEN
    RAISE EXCEPTION '0196: the kind CHECK lacks workshop_entry / workshop_return';
  END IF;
  IF to_regprocedure('public.prepare_movement_notice(uuid)') IS NULL THEN
    RAISE EXCEPTION '0196: prepare_movement_notice is missing';
  END IF;
  IF to_regprocedure('public.prepare_movement_exit_notice(uuid)') IS NULL THEN
    RAISE EXCEPTION '0196: prepare_movement_exit_notice must stay';
  END IF;
  IF has_function_privilege('anon', 'public.prepare_movement_notice(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0196: anon may execute prepare_movement_notice';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
