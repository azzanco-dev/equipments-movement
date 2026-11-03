-- 0172: sales phase 2 — «كروت التشغيل», the HOURS of each equipment card per
-- Saudi month, the database layer. Builds on the shared document «كرت المعدة»
-- (equipment_cards, 0136) and its two sides: the supplier line
-- (supplier_po_equipment, 0136 / 0157) and the client line
-- (client_po_equipment, 0169).
--
-- Owner decisions 2026-11-03:
--   * «نفس الاكسل»: the hours are ALWAYS what sales records from the client's
--     monthly timesheet (which may arrive late, so an ended card still takes
--     its past months). Nothing is computed from movements.
--   * client due = monthly sale price × hours ÷ the client line's standard
--     hours; an hourly client line = price × hours; a DAILY line (client or
--     supplier) has NO rule yet → NULL; an unpriced line → NULL.
--   * supplier due = the SAME hours × the supplier line's monthly price ÷ the
--     client line's standard hours (fallback: the card's standard_hours when
--     there is no client line); an owned Al-Azani unit (no supplier line) →
--     NULL.
--   * margin = client due − COALESCE(supplier due, 0) when the client due is
--     known, else NULL. Every amount rounds to 2 decimals.
--   * NO approval of a month record. A sales.manage holder edits a record
--     freely and deletes it; every change lands in the card's event log with
--     the actor.
--   * a batch entry (one project, one month, many cards) saves in ONE
--     transaction: any refused item refuses the whole batch with its token.
--   * the timesheet PDF stays deferred.
--
-- Saudi time: a card's period dates are Saudi days already (0137: the entry's
-- Saudi day), so their calendar month IS the Saudi month; the current Saudi
-- month is date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh'). A month is
-- stored as the FIRST day of its month.
--
-- Rules (the 0169 shape): every write goes through the SECURITY DEFINER
-- functions below (no INSERT / UPDATE / DELETE policy on either new table);
-- each calls assert_sales_manage() (0169: auth.uid() and
-- has_permission('sales.manage')) first; record_equipment_card_month locks
-- the card row FOR UPDATE before it reads or writes its months; the events
-- are append-only; the two sides read each other (owner 2026-10-15), so the
-- SELECT policies are sales.view OR purchasing.view.
--   Stable error tokens (the client maps them, never shows raw errors):
--     sales_manage_required                       42501
--     invalid_month / invalid_card /
--     invalid_hours / invalid_note / invalid_items 22023
--     month_outside_card / month_in_future        55000
--     card_month_not_found                        P0002
-- Nothing here changes a movement, a photo, the master data, a PO table or
-- any existing policy.

-- ===========================================================================
-- A. equipment_card_months (the recorded hours, one row per card and month)
-- ===========================================================================
CREATE TABLE public.equipment_card_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_card_id uuid NOT NULL REFERENCES public.equipment_cards(id) ON DELETE RESTRICT,
  -- The first day of the Saudi month (an explicit timestamp cast keeps the
  -- immutable date_trunc).
  month date NOT NULL
    CONSTRAINT equipment_card_months_month_check
      CHECK (month = date_trunc('month', month::timestamp)::date),
  hours numeric(8, 2) NOT NULL
    CONSTRAINT equipment_card_months_hours_check CHECK (hours >= 0 AND hours <= 9999),
  note text
    CONSTRAINT equipment_card_months_note_check
      CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_card_months_unique UNIQUE (equipment_card_id, month)
);

-- The «الشهور» list and the batch screen read by month first.
CREATE INDEX equipment_card_months_month_idx
  ON public.equipment_card_months (month, equipment_card_id);

COMMENT ON TABLE public.equipment_card_months IS
  '0172 «كروت التشغيل»: the hours of one equipment card («كرت المعدة») in one Saudi month (month = the first day of the month), as sales records them from the client''s monthly timesheet, with an optional note. One row per card and month. The dues are not stored: sales_card_months computes them on read through card_month_due. Read by sales.view or purchasing.view; written only by record_equipment_card_month (and the batch record_equipment_card_months) and delete_equipment_card_month.';
COMMENT ON COLUMN public.equipment_card_months.month IS
  '0172: the first day of the Saudi month the hours belong to (CHECK). The functions normalise any day of the month to it.';
COMMENT ON COLUMN public.equipment_card_months.hours IS
  '0172: the hours recorded for the month, 0 to 9999 with two decimals; always what the timesheet says, never computed.';
COMMENT ON COLUMN public.equipment_card_months.created_by IS
  '0172: who first recorded the month; later edits are in equipment_card_events with their actor.';

ALTER TABLE public.equipment_card_months ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_equipment_card_months ON public.equipment_card_months
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('sales.view')) OR (SELECT public.has_permission('purchasing.view')));

GRANT SELECT ON public.equipment_card_months TO authenticated;

CREATE TRIGGER equipment_card_months_updated_at
  BEFORE UPDATE ON public.equipment_card_months
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================================================
-- B. equipment_card_events (the card's append-only audit)
-- ===========================================================================
CREATE TABLE public.equipment_card_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Insertion order within one created_at (a batch records many months in
  -- one transaction, so their events share the timestamp; 0141 / 0169).
  seq bigint GENERATED BY DEFAULT AS IDENTITY,
  equipment_card_id uuid NOT NULL REFERENCES public.equipment_cards(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CONSTRAINT equipment_card_events_type_check CHECK (
      event_type IN ('month_recorded', 'month_updated', 'month_deleted')
    ),
  -- {month, hours, old_hours, note}: month_recorded carries month, hours,
  -- note; month_updated adds old_hours (and old_note); month_deleted carries
  -- month, old_hours, note.
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- The actor's name at the time (profile_names), so the log reads without
  -- a join and survives a deleted profile.
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX equipment_card_events_card_seq_idx
  ON public.equipment_card_events (equipment_card_id, created_at, seq);

COMMENT ON TABLE public.equipment_card_events IS
  '0172: append-only audit of an equipment card''s month records (month_recorded, month_updated, month_deleted) with the actor and the actor''s name at the time; the payload carries month, hours, old_hours and note. Read by sales.view or purchasing.view; written only by the month functions; no update or delete path. The card page orders by (created_at, seq) among the PO events.';
COMMENT ON COLUMN public.equipment_card_events.seq IS
  '0172: insertion order within the same created_at (events of one batch share the timestamp).';

ALTER TABLE public.equipment_card_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_equipment_card_events ON public.equipment_card_events
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('sales.view')) OR (SELECT public.has_permission('purchasing.view')));

GRANT SELECT ON public.equipment_card_events TO authenticated;

-- One event row with the actor and the actor's name at the time (the
-- record_client_po_event shape of 0169).
CREATE OR REPLACE FUNCTION public.record_equipment_card_event(
  p_card_id uuid,
  p_event_type text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_name text;
BEGIN
  SELECT full_name INTO v_actor_name
  FROM public.profile_names
  WHERE id = auth.uid();

  INSERT INTO public.equipment_card_events (equipment_card_id, event_type, payload, actor_id, actor_name)
  VALUES (p_card_id, p_event_type, COALESCE(p_payload, '{}'::jsonb), auth.uid(), v_actor_name);
END;
$$;

COMMENT ON FUNCTION public.record_equipment_card_event(uuid, text, jsonb) IS
  '0172: appends one equipment_card_events row for the signed-in actor with the actor''s name from profile_names. Called only by the month functions; not callable by clients.';

REVOKE ALL ON FUNCTION public.record_equipment_card_event(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- C. The write functions
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- record_equipment_card_month: the upsert of ONE month of ONE card
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_equipment_card_month(
  p_card_id uuid,
  p_month date,
  p_hours numeric,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month date;
  v_card_from date;
  v_card_to date;
  v_month_from date;
  v_month_to date;
  v_current_month date;
  v_hours numeric(8, 2);
  v_note text;
  v_id uuid;
  v_old_hours numeric(8, 2);
  v_old_note text;
BEGIN
  PERFORM public.assert_sales_manage();

  -- Any day of the month names the month; stored as its first day.
  IF p_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month' USING ERRCODE = '22023';
  END IF;
  v_month := date_trunc('month', p_month::timestamp)::date;

  -- The card, locked first: two writers of the same card queue here, so the
  -- read-then-insert below never races (the UNIQUE constraint is the backstop).
  SELECT c.period_from, c.period_to INTO v_card_from, v_card_to
  FROM public.equipment_cards c
  WHERE c.id = p_card_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023';
  END IF;

  -- The month lies within the card's period, month to month in Saudi time:
  -- from the month of period_from to the month of period_to when set. An
  -- ended card still accepts its past months (the timesheet arrives late).
  v_month_from := date_trunc('month', v_card_from::timestamp)::date;
  v_month_to := CASE
    WHEN v_card_to IS NULL THEN NULL
    ELSE date_trunc('month', v_card_to::timestamp)::date
  END;
  IF v_month < v_month_from OR (v_month_to IS NOT NULL AND v_month > v_month_to) THEN
    RAISE EXCEPTION 'month_outside_card'
      USING ERRCODE = '55000',
            HINT = 'The month lies outside the card''s period.';
  END IF;

  -- Never a month after the current Saudi month.
  v_current_month := date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh')::date;
  IF v_month > v_current_month THEN
    RAISE EXCEPTION 'month_in_future'
      USING ERRCODE = '55000',
            HINT = 'Hours are recorded up to the current month only.';
  END IF;

  -- The hours: 0 to 9999, two decimals (NaN is numeric too).
  IF p_hours IS NULL OR p_hours = 'NaN'::numeric OR p_hours < 0 OR p_hours > 9999 THEN
    RAISE EXCEPTION 'invalid_hours' USING ERRCODE = '22023';
  END IF;
  v_hours := round(p_hours, 2);

  -- The note: trimmed, blank = none, at most 500 characters.
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  SELECT m.id, m.hours, m.note INTO v_id, v_old_hours, v_old_note
  FROM public.equipment_card_months m
  WHERE m.equipment_card_id = p_card_id
    AND m.month = v_month
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.equipment_card_months (equipment_card_id, month, hours, note, created_by)
    VALUES (p_card_id, v_month, v_hours, v_note, auth.uid())
    RETURNING id INTO v_id;

    PERFORM public.record_equipment_card_event(
      p_card_id,
      'month_recorded',
      jsonb_build_object('month', v_month, 'hours', v_hours, 'note', v_note)
    );
    RETURN v_id;
  END IF;

  -- An existing record: update hours and note; no event when nothing changed.
  IF v_old_hours = v_hours AND v_old_note IS NOT DISTINCT FROM v_note THEN
    RETURN v_id;
  END IF;

  UPDATE public.equipment_card_months
  SET hours = v_hours, note = v_note
  WHERE id = v_id;

  PERFORM public.record_equipment_card_event(
    p_card_id,
    'month_updated',
    jsonb_build_object(
      'month', v_month,
      'hours', v_hours,
      'old_hours', v_old_hours,
      'note', v_note,
      'old_note', v_old_note
    )
  );
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_equipment_card_month(uuid, date, numeric, text) IS
  '0172: records the hours of ONE card for ONE Saudi month (p_month is normalised to the first of its month): insert → event month_recorded, an existing row → hours and note updated with the event month_updated carrying old_hours (no event when nothing changed). The month must lie within the card''s period (month_outside_card) and not after the current Saudi month (month_in_future); an ended card still takes its past months. Locks the card row first. Needs sales.manage. Returns the record id.';

REVOKE ALL ON FUNCTION public.record_equipment_card_month(uuid, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_equipment_card_month(uuid, date, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- record_equipment_card_months: the batch (one month, many cards)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_equipment_card_months(
  p_month date,
  p_items jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_card_id uuid;
  v_count integer := 0;
BEGIN
  PERFORM public.assert_sales_manage();

  IF p_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month' USING ERRCODE = '22023';
  END IF;
  -- An array of {"card_id": uuid, "hours": number, "note": text | null}.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;

  -- In the array's order; one transaction, so a refused item (its own token)
  -- refuses the whole batch. An empty array records nothing and returns 0.
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_items) WITH ORDINALITY AS items(value, ord)
    ORDER BY ord
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR jsonb_typeof(v_item -> 'card_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item -> 'hours') IS DISTINCT FROM 'number'
       OR COALESCE(jsonb_typeof(v_item -> 'note'), 'null') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_card_id := (v_item ->> 'card_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END;

    PERFORM public.record_equipment_card_month(
      v_card_id,
      p_month,
      (v_item ->> 'hours')::numeric,
      v_item ->> 'note'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.record_equipment_card_months(date, jsonb) IS
  '0172: the batch entry of one month for many cards (one project''s timesheet): p_items is an array of {card_id, hours, note|null} (shape → invalid_items), each recorded through record_equipment_card_month in order inside ONE transaction, so any refused item refuses the whole batch with its own token. Returns the number of items recorded (an empty array → 0). Needs sales.manage.';

REVOKE ALL ON FUNCTION public.record_equipment_card_months(date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_equipment_card_months(date, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- delete_equipment_card_month
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_equipment_card_month(
  p_card_id uuid,
  p_month date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month date;
  v_id uuid;
  v_old_hours numeric(8, 2);
  v_old_note text;
BEGIN
  PERFORM public.assert_sales_manage();

  IF p_month IS NULL THEN
    RAISE EXCEPTION 'invalid_month' USING ERRCODE = '22023';
  END IF;
  v_month := date_trunc('month', p_month::timestamp)::date;

  -- The card row first (the same lock order as the recorder).
  PERFORM 1 FROM public.equipment_cards c WHERE c.id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023';
  END IF;

  SELECT m.id, m.hours, m.note INTO v_id, v_old_hours, v_old_note
  FROM public.equipment_card_months m
  WHERE m.equipment_card_id = p_card_id
    AND m.month = v_month
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'card_month_not_found'
      USING ERRCODE = 'P0002',
            HINT = 'No hours are recorded for this card and month.';
  END IF;

  DELETE FROM public.equipment_card_months WHERE id = v_id;

  PERFORM public.record_equipment_card_event(
    p_card_id,
    'month_deleted',
    jsonb_build_object('month', v_month, 'old_hours', v_old_hours, 'note', v_old_note)
  );
END;
$$;

COMMENT ON FUNCTION public.delete_equipment_card_month(uuid, date) IS
  '0172: deletes the hours of one card for one Saudi month (card_month_not_found when none) and records the event month_deleted with the old hours. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.delete_equipment_card_month(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_equipment_card_month(uuid, date) TO authenticated;

-- ===========================================================================
-- D. card_month_due: the ONE definition of a month's amount
-- ===========================================================================
-- «نفس الاكسل»: a monthly price × hours ÷ the standard hours; an hourly price
-- × hours; a daily price has no rule yet (NULL); no price → NULL. Called for
-- the client side and the supplier side alike, always with the CLIENT line's
-- standard hours (fallback the card's).
CREATE OR REPLACE FUNCTION public.card_month_due(
  p_price numeric,
  p_rate_unit text,
  p_hours numeric,
  p_standard_hours integer
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_price IS NULL OR p_hours IS NULL THEN NULL
    WHEN p_rate_unit = 'hour' THEN round(p_price * p_hours, 2)
    WHEN p_rate_unit = 'month' AND p_standard_hours > 0
      THEN round(p_price * p_hours / p_standard_hours, 2)
    ELSE NULL
  END
$$;

COMMENT ON FUNCTION public.card_month_due(numeric, text, numeric, integer) IS
  '0172: the amount a month''s hours are worth at one price — month: price × hours ÷ standard hours; hour: price × hours; day: NULL (no rule yet, owner 2026-11-03); unpriced: NULL; rounded to 2 decimals. Used by sales_card_months and sales_card_month_slots for the client due and the supplier due.';

REVOKE ALL ON FUNCTION public.card_month_due(numeric, text, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.card_month_due(numeric, text, numeric, integer) TO authenticated;

-- ===========================================================================
-- E. sales_card_months: one row per RECORDED month with the card's facts
-- ===========================================================================
-- Built on sales_equipment_cards (0169), so the unit, the company and
-- project, the period and the two PO lines (the open PO's line first, else
-- the latest) come from that one definition. owned = an Al-Azani unit, whose
-- supplier due is always NULL. due_standard_hours is the divisor used: the
-- client line's standard hours, else the card's.
CREATE OR REPLACE VIEW public.sales_card_months
WITH (security_invoker = true)
AS
SELECT
  -- The record.
  m.id,
  m.month,
  m.hours,
  m.note,
  m.created_by,
  m.created_at,
  m.updated_at,
  -- The card.
  sc.card_id,
  sc.equipment_id,
  sc.company_id,
  sc.project_id,
  sc.period_from,
  sc.period_to,
  sc.is_open,
  sc.rate_unit,
  sc.standard_hours,
  -- The unit.
  sc.equipment_code,
  sc.equipment_type,
  sc.equipment_type_search,
  sc.equipment_plate_number,
  sc.equipment_plate_digits,
  sc.equipment_chassis_number,
  sc.equipment_ownership_status,
  sc.equipment_lessor_id,
  sc.equipment_lessor_name,
  (sc.equipment_ownership_status = 'alazani') AS owned,
  -- The company (the client) and the project.
  sc.company_name_ar,
  sc.company_name_en,
  sc.project_name_ar,
  sc.project_name_en,
  -- The client side.
  sc.client_line_id,
  sc.client_po_id,
  sc.client_po_number,
  sc.client_po_status,
  sc.client_price,
  sc.client_rate_unit,
  sc.client_standard_hours,
  -- The supplier side.
  sc.supplier_line_id,
  sc.supplier_po_id,
  sc.supplier_po_number,
  sc.supplier_po_status,
  sc.supplier_price,
  sc.supplier_rate_unit,
  -- The amounts.
  COALESCE(sc.client_standard_hours, sc.standard_hours) AS due_standard_hours,
  d.client_due,
  d.supplier_due,
  CASE
    WHEN d.client_due IS NULL THEN NULL
    ELSE round(d.client_due - COALESCE(d.supplier_due, 0), 2)
  END AS margin
FROM public.equipment_card_months m
JOIN public.sales_equipment_cards sc ON sc.card_id = m.equipment_card_id
CROSS JOIN LATERAL (
  SELECT
    public.card_month_due(
      sc.client_price, sc.client_rate_unit, m.hours,
      COALESCE(sc.client_standard_hours, sc.standard_hours)
    ) AS client_due,
    CASE
      WHEN sc.equipment_ownership_status = 'alazani' THEN NULL
      ELSE public.card_month_due(
        sc.supplier_price, sc.supplier_rate_unit, m.hours,
        COALESCE(sc.client_standard_hours, sc.standard_hours)
      )
    END AS supplier_due
) d;

COMMENT ON VIEW public.sales_card_months IS
  '0172: one row per RECORDED month of an equipment card («كروت التشغيل») with the card''s facts as sales_equipment_cards exposes them (the unit, the company and project, the period, the client line and the supplier line, owned = an Al-Azani unit) plus the hours, the note and the computed amounts: client_due and supplier_due through card_month_due (month: price × hours ÷ due_standard_hours — the client line''s standard hours, else the card''s; hour: price × hours; day or unpriced: NULL; owned or no supplier line: supplier_due NULL) and margin = client_due − COALESCE(supplier_due, 0), NULL without a client due. Nothing is stored. security_invoker: sales.view or purchasing.view for the record and the card, each side''s own key for its line.';

REVOKE ALL ON public.sales_card_months FROM PUBLIC, anon;
GRANT SELECT ON public.sales_card_months TO authenticated;

-- ===========================================================================
-- F. sales_card_month_slots: every card × every month of its period so far
-- ===========================================================================
-- The «الشهور» list (filters: month, company, project, recorded) and the
-- batch screen (company + project + month → the cards there, recorded or
-- not). Computed on read: generate_series from the month of period_from to
-- the smaller of the month of period_to and the current Saudi month, LEFT
-- JOINed to the recorded row; its size is bounded by the number of cards ×
-- their months, so filter by month or by company and project.
CREATE OR REPLACE VIEW public.sales_card_month_slots
WITH (security_invoker = true)
AS
SELECT
  -- The slot (a stable id for a list row) and the record, when any.
  sc.card_id::text || ':' || to_char(g.month, 'YYYY-MM') AS slot_id,
  g.month,
  (m.id IS NOT NULL) AS recorded,
  m.id AS month_id,
  m.hours,
  m.note,
  m.created_by,
  m.created_at,
  m.updated_at,
  -- The card.
  sc.card_id,
  sc.equipment_id,
  sc.company_id,
  sc.project_id,
  sc.period_from,
  sc.period_to,
  sc.is_open,
  sc.rate_unit,
  sc.standard_hours,
  -- The unit.
  sc.equipment_code,
  sc.equipment_type,
  sc.equipment_type_search,
  sc.equipment_plate_number,
  sc.equipment_plate_digits,
  sc.equipment_chassis_number,
  sc.equipment_ownership_status,
  sc.equipment_lessor_id,
  sc.equipment_lessor_name,
  (sc.equipment_ownership_status = 'alazani') AS owned,
  -- The company (the client) and the project.
  sc.company_name_ar,
  sc.company_name_en,
  sc.project_name_ar,
  sc.project_name_en,
  -- The client side.
  sc.client_line_id,
  sc.client_po_id,
  sc.client_po_number,
  sc.client_po_status,
  sc.client_price,
  sc.client_rate_unit,
  sc.client_standard_hours,
  -- The supplier side.
  sc.supplier_line_id,
  sc.supplier_po_id,
  sc.supplier_po_number,
  sc.supplier_po_status,
  sc.supplier_price,
  sc.supplier_rate_unit,
  -- The amounts (NULL while not recorded).
  COALESCE(sc.client_standard_hours, sc.standard_hours) AS due_standard_hours,
  d.client_due,
  d.supplier_due,
  CASE
    WHEN d.client_due IS NULL THEN NULL
    ELSE round(d.client_due - COALESCE(d.supplier_due, 0), 2)
  END AS margin
FROM public.sales_equipment_cards sc
CROSS JOIN LATERAL (
  SELECT s::date AS month
  FROM generate_series(
    date_trunc('month', sc.period_from::timestamp),
    LEAST(
      date_trunc('month', COALESCE(sc.period_to, (now() AT TIME ZONE 'Asia/Riyadh')::date)::timestamp),
      date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh')
    ),
    interval '1 month'
  ) AS s
) g
LEFT JOIN public.equipment_card_months m
  ON m.equipment_card_id = sc.card_id
 AND m.month = g.month
CROSS JOIN LATERAL (
  SELECT
    public.card_month_due(
      sc.client_price, sc.client_rate_unit, m.hours,
      COALESCE(sc.client_standard_hours, sc.standard_hours)
    ) AS client_due,
    CASE
      WHEN sc.equipment_ownership_status = 'alazani' THEN NULL
      ELSE public.card_month_due(
        sc.supplier_price, sc.supplier_rate_unit, m.hours,
        COALESCE(sc.client_standard_hours, sc.standard_hours)
      )
    END AS supplier_due
) d;

COMMENT ON VIEW public.sales_card_month_slots IS
  '0172: every equipment card × every Saudi month from the month of its period_from to the smaller of the month of its period_to and the current Saudi month (generate_series, computed on read and bounded by the number of cards × their months — filter by month or by company and project), LEFT JOINed to the recorded hours: the columns of sales_card_months plus slot_id (card:YYYY-MM), recorded and month_id, with hours, note and the amounts NULL while the month is not recorded. Feeds the «الشهور» list and the batch screen. security_invoker as sales_card_months.';

REVOKE ALL ON public.sales_card_month_slots FROM PUBLIC, anon;
GRANT SELECT ON public.sales_card_month_slots TO authenticated;
