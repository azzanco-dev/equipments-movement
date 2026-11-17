-- 0200: quotations without states — a quotation is a plain document.
--
-- Owner decision 2026-11-17, after a recap of the feature whose section
-- «دورة العرض» listed مسودة / معتمد / مقبول - مرفوض / منتهي:
-- «طيب مايحتاج التصنيف او الدورة, شيلها».
--
-- It SUPERSEDES decision 5 of 0199 (draft → approved → the client's answer,
-- «منتهي», the number at the first approval, «رجوع للتعديل», the draft-only
-- edit and delete). 0199 is applied and is not edited; this is the forward
-- migration. The quotation screens were never deployed, so nothing live reads
-- what is dropped here.
--
-- What changes:
--   1. No states: quotations.status, the approval (approved_at, approved_by)
--      and the client's answer (outcome, outcome_at, outcome_by, outcome_note)
--      are DROPPED with their CHECKs; quotation_list loses them, its
--      approved_by_name and the computed `state`. approve_quotation,
--      return_quotation_approval, set_quotation_outcome and their helper
--      assert_quotation_approve are DROPPED.
--   2. The number: the official QT-YYYYMM#### is issued at CREATION — the same
--      global sequence that never restarts (quotation_number_sequence), the
--      month the Saudi month of the creation. The draft reference QD-####,
--      its counter table and its function are DROPPED. A row that still
--      carries a draft reference is CONVERTED here (my choice over a guard, so
--      the migration is correct with rows; production has none): in
--      (created_at, id) order it takes the next number of the sequence with
--      the Saudi month of ITS creation, an `updated` event {old_number,
--      new_number, reason: 'number_at_creation'} and an untouched updated_at.
--   3. A quotation is always editable (save_quotation) and deletable
--      (delete_quotation) by a holder of sales.manage: no lock, no «only a
--      draft». A deleted quotation's number is NEVER reused — the sequence
--      keeps a gap — and, because every number is official now, the deleted
--      quotation is first copied to the append-only quotation_deletions (the
--      0193 supplier_po_deletions pattern; no screen reads it) so a missing
--      number can always be explained.
--   4. «صالح لغاية» stays a plain date; nothing computes «منتهي».
--   5. The key sales.quotations.approve stays (it is in production, held by
--      the admin role) and now gates ONLY the terms template (the RLS of
--      quotation_term_templates, unchanged). Its catalogue label and
--      description say so; no new key.
--   6. quotation_events stays; its CHECK keeps the six 0199 event types as
--      history, and only `created` and `updated` are written from now on.
--
-- Unchanged: quotation_term_templates (table, trigger, policies),
-- quotation_lines, quotation_costs, quotation_terms, quotation_events,
-- quotation_number_sequence, next_quotation_number() (body), the internal
-- helpers record_quotation_event and quotation_price_value, and every
-- parameter of save_quotation / delete_quotation / copy_quotation.
--
-- Stable error tokens that remain (the whole message; the client maps them):
--   sales_manage_required                                       42501
--   invalid_quotation, invalid_company, invalid_project,
--   invalid_dates, invalid_notes, quotation_has_no_lines,
--   invalid_lines, invalid_equipment_type,
--   duplicate_equipment_type, invalid_price, line_has_no_price,
--   invalid_note, invalid_costs, invalid_cost_name,
--   invalid_borne_by, invalid_terms                             22023
-- Gone: quotation_approve_required, invalid_outcome,
--   quotation_approved_locked, quotation_not_draft,
--   quotation_not_approved, quotation_number_issued.
--
-- Rollout: apply 0200 BEFORE deploying the quotation screens (they select the
-- reduced quotation_list and call only the three functions).

-- ===========================================================================
-- 0. 0199 must be in place
-- ===========================================================================
DO $$
BEGIN
  IF to_regclass('public.quotations') IS NULL
     OR to_regclass('public.quotation_number_sequence') IS NULL
     OR to_regprocedure('public.record_quotation_event(uuid, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION '0200: migration 0199 (quotations) is not applied';
  END IF;
END;
$$;

-- ===========================================================================
-- 1. The view and the lifecycle functions go first (they read the columns)
-- ===========================================================================
DROP VIEW IF EXISTS public.quotation_list;

DROP FUNCTION IF EXISTS public.approve_quotation(uuid);
DROP FUNCTION IF EXISTS public.return_quotation_approval(uuid, text);
DROP FUNCTION IF EXISTS public.set_quotation_outcome(uuid, text, text);
DROP FUNCTION IF EXISTS public.assert_quotation_approve();

-- ===========================================================================
-- 2. Every quotation carries an official number
-- ===========================================================================
-- A row still under a draft reference takes the next number of the global
-- sequence, in creation order, with the Saudi month of its creation.
-- updated_at does not move (the conversion is not an edit by a user).
ALTER TABLE public.quotations DISABLE TRIGGER quotations_updated_at;

DO $$
DECLARE
  r record;
  v_seq integer;
  v_number text;
BEGIN
  FOR r IN
    SELECT q.id, q.quote_number, q.created_at
    FROM public.quotations q
    WHERE q.quote_number !~ '^QT-[0-9]{10,}$'
    ORDER BY q.created_at, q.id
  LOOP
    UPDATE public.quotation_number_sequence
    SET last_seq = last_seq + 1
    WHERE singleton
    RETURNING last_seq INTO v_seq;
    IF v_seq IS NULL THEN
      RAISE EXCEPTION '0200: quotation_number_sequence has no row';
    END IF;
    v_number := 'QT-'
      || to_char(r.created_at AT TIME ZONE 'Asia/Riyadh', 'YYYYMM')
      || lpad(v_seq::text, 4, '0');

    UPDATE public.quotations
    SET quote_number = v_number
    WHERE id = r.id;

    -- A migration has no auth.uid(): the event has no actor.
    INSERT INTO public.quotation_events (quotation_id, event_type, payload)
    VALUES (
      r.id, 'updated',
      jsonb_build_object(
        'old_number', r.quote_number,
        'new_number', v_number,
        'reason', 'number_at_creation'
      )
    );
  END LOOP;
END;
$$;

ALTER TABLE public.quotations ENABLE TRIGGER quotations_updated_at;

-- ===========================================================================
-- 3. quotations: the state columns and their CHECKs are dropped
-- ===========================================================================
ALTER TABLE public.quotations
  DROP CONSTRAINT IF EXISTS quotations_approved_at_check,
  DROP CONSTRAINT IF EXISTS quotations_approved_numbered,
  DROP CONSTRAINT IF EXISTS quotations_outcome_approved_check,
  DROP CONSTRAINT IF EXISTS quotations_outcome_at_check,
  DROP CONSTRAINT IF EXISTS quotations_status_check,
  DROP CONSTRAINT IF EXISTS quotations_outcome_check,
  DROP CONSTRAINT IF EXISTS quotations_outcome_note_check,
  DROP CONSTRAINT IF EXISTS quotations_number_format;

ALTER TABLE public.quotations
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS outcome,
  DROP COLUMN IF EXISTS outcome_at,
  DROP COLUMN IF EXISTS outcome_by,
  DROP COLUMN IF EXISTS outcome_note;

ALTER TABLE public.quotations
  ADD CONSTRAINT quotations_number_format
    CHECK (quote_number ~ '^QT-[0-9]{10,}$');

COMMENT ON TABLE public.quotations IS
  '0199 / 0200: quotations («عروض الاسعار»): a price list for a client company with an optional project, by equipment type, no quantities or totals. A plain document since 0200 (owner 2026-11-17, «مايحتاج التصنيف او الدورة, شيلها»): no state, no approval, no client answer; valid_until is a plain date. No link to client POs or cards. Read by sales.view; written only by save_quotation, delete_quotation and copy_quotation (sales.manage), always editable and deletable.';
COMMENT ON COLUMN public.quotations.quote_number IS
  '0200: the OFFICIAL number QT- + the Saudi YYYYMM of the quotation''s creation + a global sequence of at least four digits that never restarts (next_quotation_number), issued when the quotation is created or copied. A deleted quotation''s number is never reused (the sequence keeps a gap; see quotation_deletions).';

-- ===========================================================================
-- 4. The draft reference goes
-- ===========================================================================
DROP FUNCTION IF EXISTS public.next_quotation_draft_ref();
DROP TABLE IF EXISTS public.quotation_draft_sequence;

COMMENT ON TABLE public.quotation_number_sequence IS
  '0199 / 0200: the ONE row holding the last issued quotation number (QT-YYYYMM####, a global sequence that never restarts and never reuses a number). Read and written only by next_quotation_number(); no client access.';
COMMENT ON FUNCTION public.next_quotation_number() IS
  '0199 / 0200: consumes and returns the next quotation number, QT- + the Saudi year and month (YYYYMM) + a global sequence of at least four digits that never restarts (QT-2026110001). Since 0200 it is called by save_quotation (a new quotation) and copy_quotation, so the month is the creation''s. The counter is a table row, so a rolled-back save takes its number back; a DELETED quotation does not (its number stays a gap).';
COMMENT ON TABLE public.quotation_events IS
  '0199 / 0200: append-only audit of a quotation with the actor and the actor''s name at the time. Since 0200 only created and updated are written (the CHECK keeps approved, approval_returned, outcome_set and outcome_cleared as history). No screen reads it. Read by sales.view; written only by the quotation functions; no update or delete path (it cascades with a deleted quotation, whose events are copied to quotation_deletions first).';

-- ===========================================================================
-- 5. The key now gates the terms template only
-- ===========================================================================
UPDATE public.permissions
SET name_ar = 'المبيعات: قالب شروط عروض الاسعار',
    name_en = 'Sales: quotation terms template',
    description_ar = 'ادارة قالب الشروط والاحكام لعروض الاسعار: اضافة شرط وتعديله وحذفه وترتيبه.',
    description_en = 'Manage the terms template of quotations: add, edit, delete and order its terms.'
WHERE key = 'sales.quotations.approve';

-- ===========================================================================
-- 6. quotation_deletions: what a missing number was
-- ===========================================================================
CREATE TABLE public.quotation_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No foreign keys: the quotation is gone, and this record must never block
  -- the deletion of a company, a project or a profile.
  quotation_id uuid NOT NULL,
  quote_number text NOT NULL,
  company_id uuid,
  project_id uuid,
  issue_date date,
  valid_until date,
  notes text,
  quotation_created_at timestamptz,
  quotation_created_by uuid,
  lines jsonb NOT NULL,
  costs jsonb NOT NULL,
  terms jsonb NOT NULL,
  events jsonb NOT NULL,
  deleted_by uuid,
  deleted_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quotation_deletions_created_idx
  ON public.quotation_deletions (created_at DESC);
CREATE INDEX quotation_deletions_number_idx
  ON public.quotation_deletions (quote_number);

COMMENT ON TABLE public.quotation_deletions IS
  '0200: append-only record of every deleted quotation (delete_quotation): its facts, its lines, costs, terms and quotation_events rows (which cascade with the quotation), with who deleted it and the name from profile_names at that time. Its number is never issued again, so this table explains every gap of the QT sequence. No foreign keys. Read by sales.view; written only by delete_quotation; no update or delete path; no screen reads it.';

ALTER TABLE public.quotation_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_quotation_deletions ON public.quotation_deletions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('sales.view')));

REVOKE ALL ON TABLE public.quotation_deletions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.quotation_deletions TO authenticated;

-- ===========================================================================
-- 7. save_quotation: create with the number, or edit any quotation
-- ===========================================================================
-- 0199's body without the draft lock and the draft reference; every
-- parameter, validation, token and the kept-terms rule are unchanged.
CREATE OR REPLACE FUNCTION public.save_quotation(
  p_id uuid,
  p_company_id uuid,
  p_project_id uuid,
  p_issue_date date,
  p_valid_until date,
  p_notes text,
  p_lines jsonb,
  p_costs jsonb,
  p_term_template_ids uuid[],
  p_keep_term_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q public.quotations%ROWTYPE;
  v_id uuid;
  v_number text;
  v_notes text;
  v_item jsonb;
  v_type text;
  v_daily numeric;
  v_monthly numeric;
  v_mob numeric;
  v_note text;
  v_name text;
  v_borne text;
  v_types text[] := '{}';
  v_dailies numeric[] := '{}';
  v_monthlies numeric[] := '{}';
  v_mobs numeric[] := '{}';
  v_line_notes text[] := '{}';
  v_cost_names text[] := '{}';
  v_cost_borne text[] := '{}';
  v_term_ids uuid[] := '{}';
  v_keep_ids uuid[] := '{}';
  v_found integer;
  v_line_count integer;
BEGIN
  PERFORM public.assert_sales_manage();

  -- An existing quotation: its row is locked first (every writer takes it).
  -- Any quotation is edited (0200: nothing locks it).
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_q
    FROM public.quotations q
    WHERE q.id = p_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_quotation' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The client (a company) and the optional project. As create_client_po:
  -- the row must exist (companies carry no active flag).
  IF p_company_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'invalid_company' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id) THEN
    RAISE EXCEPTION 'invalid_project' USING ERRCODE = '22023';
  END IF;
  IF p_issue_date IS NULL OR p_valid_until IS NULL OR p_valid_until < p_issue_date THEN
    RAISE EXCEPTION 'invalid_dates' USING ERRCODE = '22023';
  END IF;
  v_notes := NULLIF(btrim(p_notes), '');
  IF char_length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023';
  END IF;

  -- The lines: at least one; each an object naming an existing type once,
  -- with at least one of the three prices; array order = position.
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'quotation_has_no_lines'
      USING ERRCODE = '22023',
            HINT = 'A quotation needs at least one equipment type.';
  END IF;
  FOR v_item IN
    SELECT e.value
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS e(value, ord)
    ORDER BY e.ord
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'invalid_lines' USING ERRCODE = '22023';
    END IF;

    -- The stored spelling of the type (compared as the 0039 unique index).
    SELECT t.name INTO v_type
    FROM public.equipment_types t
    WHERE lower(btrim(t.name)) = lower(btrim(v_item->>'equipment_type'))
    LIMIT 1;
    IF v_type IS NULL THEN
      RAISE EXCEPTION 'invalid_equipment_type' USING ERRCODE = '22023';
    END IF;
    IF v_type = ANY (v_types) THEN
      RAISE EXCEPTION 'duplicate_equipment_type'
        USING ERRCODE = '22023',
              HINT = 'An equipment type appears once per quotation.';
    END IF;

    v_daily := public.quotation_price_value(v_item->'daily_price');
    v_monthly := public.quotation_price_value(v_item->'monthly_price');
    v_mob := public.quotation_price_value(v_item->'mob_demob_price');
    IF v_daily IS NULL AND v_monthly IS NULL AND v_mob IS NULL THEN
      RAISE EXCEPTION 'line_has_no_price'
        USING ERRCODE = '22023',
              HINT = 'Each line needs a daily, monthly or mob/demob price.';
    END IF;

    v_note := NULLIF(btrim(v_item->>'note'), '');
    IF char_length(v_note) > 500 THEN
      RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
    END IF;

    v_types := array_append(v_types, v_type);
    v_dailies := array_append(v_dailies, v_daily);
    v_monthlies := array_append(v_monthlies, v_monthly);
    v_mobs := array_append(v_mobs, v_mob);
    v_line_notes := array_append(v_line_notes, v_note);
  END LOOP;

  -- The costs: NULL = none; otherwise an array of objects, each a name and
  -- who bears it.
  IF p_costs IS NOT NULL AND jsonb_typeof(p_costs) <> 'null' THEN
    IF jsonb_typeof(p_costs) <> 'array' THEN
      RAISE EXCEPTION 'invalid_costs' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN
      SELECT e.value
      FROM jsonb_array_elements(p_costs) WITH ORDINALITY AS e(value, ord)
      ORDER BY e.ord
    LOOP
      IF jsonb_typeof(v_item) <> 'object' THEN
        RAISE EXCEPTION 'invalid_costs' USING ERRCODE = '22023';
      END IF;
      v_name := NULLIF(btrim(v_item->>'name'), '');
      IF v_name IS NULL OR char_length(v_name) > 80 THEN
        RAISE EXCEPTION 'invalid_cost_name' USING ERRCODE = '22023';
      END IF;
      v_borne := btrim(v_item->>'borne_by');
      IF v_borne IS NULL OR v_borne NOT IN ('client', 'lessor') THEN
        RAISE EXCEPTION 'invalid_borne_by' USING ERRCODE = '22023';
      END IF;
      v_cost_names := array_append(v_cost_names, v_name);
      v_cost_borne := array_append(v_cost_borne, v_borne);
    END LOOP;
  END IF;

  -- The terms: every id must be a template row; NULL or empty = no terms. A
  -- repeated id counts once.
  IF p_term_template_ids IS NOT NULL AND cardinality(p_term_template_ids) > 0 THEN
    IF array_position(p_term_template_ids, NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_terms' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT x) INTO v_term_ids
    FROM unnest(p_term_template_ids) AS x;
    SELECT count(*) INTO v_found
    FROM public.quotation_term_templates t
    WHERE t.id = ANY (v_term_ids);
    IF v_found <> cardinality(v_term_ids) THEN
      RAISE EXCEPTION 'invalid_terms' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The stored copies to KEEP exactly as they are when a quotation is edited
  -- (a saved quotation's terms never change by themselves, so an edit of a
  -- price must not refresh a term from the template, and a term whose
  -- template row was deleted can stay). Each id is a quotation_terms row of
  -- THIS quotation; a new quotation has none.
  IF p_keep_term_ids IS NOT NULL AND cardinality(p_keep_term_ids) > 0 THEN
    IF p_id IS NULL OR array_position(p_keep_term_ids, NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_terms' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT x) INTO v_keep_ids
    FROM unnest(p_keep_term_ids) AS x;
    SELECT count(*) INTO v_found
    FROM public.quotation_terms k
    WHERE k.quotation_id = p_id AND k.id = ANY (v_keep_ids);
    IF v_found <> cardinality(v_keep_ids) THEN
      RAISE EXCEPTION 'invalid_terms' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_line_count := cardinality(v_types);

  IF p_id IS NULL THEN
    -- A new quotation takes its official number now that every check
    -- passed (0200: the number is issued at creation).
    v_number := public.next_quotation_number();

    INSERT INTO public.quotations (
      company_id, project_id, quote_number, issue_date, valid_until,
      notes, created_by
    ) VALUES (
      p_company_id, p_project_id, v_number, p_issue_date, p_valid_until,
      v_notes, auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    v_id := p_id;
    v_number := v_q.quote_number;

    -- updated_at moves on every save (the trigger and here).
    UPDATE public.quotations
    SET company_id = p_company_id,
        project_id = p_project_id,
        issue_date = p_issue_date,
        valid_until = p_valid_until,
        notes = v_notes,
        updated_at = now()
    WHERE id = p_id;

    -- Lines and costs are replaced wholesale; of the terms, the copies the
    -- caller keeps stay untouched and the others go.
    DELETE FROM public.quotation_lines WHERE quotation_id = p_id;
    DELETE FROM public.quotation_costs WHERE quotation_id = p_id;
    DELETE FROM public.quotation_terms
    WHERE quotation_id = p_id AND NOT (id = ANY (v_keep_ids));
  END IF;

  INSERT INTO public.quotation_lines (
    quotation_id, equipment_type, daily_price, monthly_price, mob_demob_price, note, position
  )
  SELECT v_id, l.equipment_type, l.daily_price, l.monthly_price, l.mob_demob_price, l.note, l.pos::integer
  FROM unnest(v_types, v_dailies, v_monthlies, v_mobs, v_line_notes)
    WITH ORDINALITY AS l(equipment_type, daily_price, monthly_price, mob_demob_price, note, pos);

  INSERT INTO public.quotation_costs (quotation_id, name, borne_by, position)
  SELECT v_id, c.name, c.borne_by, c.pos::integer
  FROM unnest(v_cost_names, v_cost_borne) WITH ORDINALITY AS c(name, borne_by, pos);

  -- The CURRENT template texts are copied for the chosen template rows that
  -- no kept copy already stands for.
  INSERT INTO public.quotation_terms (
    quotation_id, template_id, title_ar, title_en, body_ar, body_en, position
  )
  SELECT v_id, t.id, t.title_ar, t.title_en, t.body_ar, t.body_en, 0
  FROM public.quotation_term_templates t
  WHERE t.id = ANY (v_term_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.quotation_terms k
      WHERE k.quotation_id = v_id AND k.template_id = t.id
    );

  -- One order for kept and new terms: the template's order, then the copies
  -- whose template row is gone in the order they had.
  WITH ordered AS (
    SELECT
      k.id,
      (row_number() OVER (ORDER BY (t.id IS NULL), t.position, k.position, k.id))::integer AS rn
    FROM public.quotation_terms k
    LEFT JOIN public.quotation_term_templates t ON t.id = k.template_id
    WHERE k.quotation_id = v_id
  )
  UPDATE public.quotation_terms k
  SET position = o.rn
  FROM ordered o
  WHERE k.id = o.id AND k.position IS DISTINCT FROM o.rn;

  IF p_id IS NULL THEN
    PERFORM public.record_quotation_event(
      v_id, 'created',
      jsonb_build_object('quote_number', v_number, 'line_count', v_line_count)
    );
  ELSE
    PERFORM public.record_quotation_event(
      v_id, 'updated',
      jsonb_build_object('line_count', v_line_count)
    );
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[]) IS
  '0200 (re-created from 0199 without the draft lock and the draft reference): p_id NULL creates a quotation and issues its official number QT-YYYYMM#### (next_quotation_number, taken after every check; event created {quote_number, line_count}); otherwise edits ANY quotation — its company, project, dates and notes, its lines and costs replaced wholesale, and its terms: the stored copies named in p_keep_term_ids stay exactly as they are, the other copies go, and the template rows of p_term_template_ids that no kept copy stands for are copied anew (event updated {line_count}); the number never changes. p_lines [{equipment_type, daily_price|null, monthly_price|null, mob_demob_price|null, note|null}], p_costs [{name, borne_by client|lessor}] (NULL = none), p_term_template_ids: the template rows whose CURRENT texts are copied into quotation_terms (NULL / empty = none); p_keep_term_ids (optional, an edit only): quotation_terms rows of this quotation to keep unchanged; terms are ordered by the template position, then the copies without a template row; array order = position for lines and costs. Tokens sales_manage_required, invalid_quotation, invalid_company, invalid_project, invalid_dates, invalid_notes, quotation_has_no_lines, invalid_lines, invalid_equipment_type, duplicate_equipment_type, invalid_price, line_has_no_price, invalid_note, invalid_costs, invalid_cost_name, invalid_borne_by, invalid_terms. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[])
  TO authenticated;

-- ===========================================================================
-- 8. delete_quotation: any quotation; its number is never reused
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.delete_quotation(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q public.quotations%ROWTYPE;
  v_actor_name text;
BEGIN
  PERFORM public.assert_sales_manage();

  SELECT * INTO v_q
  FROM public.quotations q
  WHERE q.id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_quotation' USING ERRCODE = '22023';
  END IF;

  SELECT full_name INTO v_actor_name
  FROM public.profile_names
  WHERE id = auth.uid();

  -- The record of what the number was, before the cascade takes the lines,
  -- costs, terms and events.
  INSERT INTO public.quotation_deletions (
    quotation_id, quote_number, company_id, project_id, issue_date, valid_until,
    notes, quotation_created_at, quotation_created_by,
    lines, costs, terms, events, deleted_by, deleted_by_name
  )
  VALUES (
    v_q.id, v_q.quote_number, v_q.company_id, v_q.project_id, v_q.issue_date, v_q.valid_until,
    v_q.notes, v_q.created_at, v_q.created_by,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'equipment_type', l.equipment_type,
          'daily_price', l.daily_price,
          'monthly_price', l.monthly_price,
          'mob_demob_price', l.mob_demob_price,
          'note', l.note,
          'position', l.position
        ) ORDER BY l.position, l.id
      )
      FROM public.quotation_lines l
      WHERE l.quotation_id = p_id
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('name', c.name, 'borne_by', c.borne_by, 'position', c.position)
        ORDER BY c.position, c.id
      )
      FROM public.quotation_costs c
      WHERE c.quotation_id = p_id
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'template_id', t.template_id,
          'title_ar', t.title_ar,
          'title_en', t.title_en,
          'body_ar', t.body_ar,
          'body_en', t.body_en,
          'position', t.position
        ) ORDER BY t.position, t.id
      )
      FROM public.quotation_terms t
      WHERE t.quotation_id = p_id
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'event_type', e.event_type,
          'payload', e.payload,
          'actor_id', e.actor_id,
          'actor_name', e.actor_name,
          'created_at', e.created_at
        ) ORDER BY e.created_at, e.seq
      )
      FROM public.quotation_events e
      WHERE e.quotation_id = p_id
    ), '[]'::jsonb),
    auth.uid(), v_actor_name
  );

  -- Lines, costs, terms and events cascade. The counter is not touched: the
  -- number stays a gap and is never issued again.
  DELETE FROM public.quotations WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION public.delete_quotation(uuid) IS
  '0200 (re-created from 0199 without the draft-only rule): deletes ANY quotation with its lines, costs, terms and events (cascade), after copying it to the append-only quotation_deletions with who deleted it. Its number is never issued again (the sequence keeps a gap). Tokens sales_manage_required, invalid_quotation. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.delete_quotation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_quotation(uuid) TO authenticated;

-- ===========================================================================
-- 9. copy_quotation: «نسخ العرض» with a new official number
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.copy_quotation(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_src public.quotations%ROWTYPE;
  v_id uuid;
  v_number text;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_line_count integer;
BEGIN
  PERFORM public.assert_sales_manage();

  -- The source row first (nothing changes it while it is copied), then the
  -- number counter.
  SELECT * INTO v_src
  FROM public.quotations q
  WHERE q.id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_quotation' USING ERRCODE = '22023';
  END IF;

  v_number := public.next_quotation_number();

  -- A new quotation dated today, valid for as many days as the source.
  INSERT INTO public.quotations (
    company_id, project_id, quote_number, issue_date, valid_until,
    notes, created_by
  ) VALUES (
    v_src.company_id, v_src.project_id, v_number, v_today,
    v_today + (v_src.valid_until - v_src.issue_date),
    v_src.notes, auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.quotation_lines (
    quotation_id, equipment_type, daily_price, monthly_price, mob_demob_price, note, position
  )
  SELECT v_id, l.equipment_type, l.daily_price, l.monthly_price, l.mob_demob_price, l.note, l.position
  FROM public.quotation_lines l
  WHERE l.quotation_id = p_id
  ORDER BY l.position, l.id;
  GET DIAGNOSTICS v_line_count = ROW_COUNT;

  INSERT INTO public.quotation_costs (quotation_id, name, borne_by, position)
  SELECT v_id, c.name, c.borne_by, c.position
  FROM public.quotation_costs c
  WHERE c.quotation_id = p_id
  ORDER BY c.position, c.id;

  -- The STORED copies with their template link (not the template's current
  -- texts).
  INSERT INTO public.quotation_terms (
    quotation_id, template_id, title_ar, title_en, body_ar, body_en, position
  )
  SELECT v_id, t.template_id, t.title_ar, t.title_en, t.body_ar, t.body_en, t.position
  FROM public.quotation_terms t
  WHERE t.quotation_id = p_id
  ORDER BY t.position, t.id;

  PERFORM public.record_quotation_event(
    v_id, 'created',
    jsonb_build_object(
      'quote_number', v_number,
      'line_count', v_line_count,
      'copied_from', v_src.id,
      'copied_from_number', v_src.quote_number
    )
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.copy_quotation(uuid) IS
  '0200 (re-created from 0199 with the number at creation): «نسخ العرض» — a new quotation with its own official number from any quotation: the same company, project, notes, lines, costs and terms (the stored copies with their template_id), issue_date = the Saudi today, valid_until = today + the source''s validity in days. Event created {quote_number, line_count, copied_from, copied_from_number}. Returns the new id. Needs sales.manage. Tokens sales_manage_required, invalid_quotation.';

REVOKE ALL ON FUNCTION public.copy_quotation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_quotation(uuid) TO authenticated;

-- ===========================================================================
-- 10. quotation_list: one row per quotation, no state
-- ===========================================================================
CREATE VIEW public.quotation_list
WITH (security_invoker = true)
AS
SELECT
  q.id,
  q.company_id,
  q.project_id,
  q.quote_number,
  q.issue_date,
  q.valid_until,
  q.notes,
  q.created_by,
  q.created_at,
  q.updated_at,
  co.name_ar AS company_name_ar,
  co.name_en AS company_name_en,
  pr.name_ar AS project_name_ar,
  pr.name_en AS project_name_en,
  cb.full_name AS created_by_name,
  COALESCE(ln.line_count, 0) AS line_count,
  ln.type_names
FROM public.quotations q
LEFT JOIN public.companies co ON co.id = q.company_id
LEFT JOIN public.projects pr ON pr.id = q.project_id
LEFT JOIN public.profile_names cb ON cb.id = q.created_by
LEFT JOIN LATERAL (
  SELECT
    count(*)::integer AS line_count,
    string_agg(l.equipment_type, '، ' ORDER BY l.position, l.id) AS type_names
  FROM public.quotation_lines l
  WHERE l.quotation_id = q.id
) ln ON true;

COMMENT ON VIEW public.quotation_list IS
  '0200 (re-created from 0199 without the state): one row per quotation with every quotations column, the client company and project names, created_by_name (profile_names), line_count and type_names (the line types joined with «، » in position order). The quotations list and page. security_invoker: sales.view and the master-data policies apply as for the reader.';

REVOKE ALL ON public.quotation_list FROM PUBLIC, anon;
GRANT SELECT ON public.quotation_list TO authenticated;

-- ===========================================================================
-- 11. The closing guard
-- ===========================================================================
DO $$
DECLARE
  v_fn text;
  v_table text;
  v_name text;
  v_gone constant text :=
    '\m(status|approved_at|approved_by|outcome|outcome_at|outcome_by|outcome_note|'
    || 'next_quotation_draft_ref|quotation_draft_sequence|assert_quotation_approve|'
    || 'approve_quotation|return_quotation_approval|set_quotation_outcome)\M';
BEGIN
  -- The dropped pieces are gone.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.approve_quotation(uuid)',
    'public.return_quotation_approval(uuid, text)',
    'public.set_quotation_outcome(uuid, text, text)',
    'public.assert_quotation_approve()',
    'public.next_quotation_draft_ref()'
  ]
  LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      RAISE EXCEPTION '0200: % still exists', v_fn;
    END IF;
  END LOOP;
  IF to_regclass('public.quotation_draft_sequence') IS NOT NULL THEN
    RAISE EXCEPTION '0200: quotation_draft_sequence still exists';
  END IF;

  SELECT a.attname INTO v_name
  FROM pg_attribute a
  WHERE a.attrelid IN ('public.quotations'::regclass, 'public.quotation_list'::regclass)
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname IN (
      'status', 'state', 'approved_at', 'approved_by', 'approved_by_name',
      'outcome', 'outcome_at', 'outcome_by', 'outcome_note'
    )
  LIMIT 1;
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION '0200: the column % still exists', v_name;
  END IF;

  -- Every quotation carries an official number.
  IF EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.quote_number !~ '^QT-[0-9]{10,}$'
  ) THEN
    RAISE EXCEPTION '0200: a quotation without an official number remains';
  END IF;

  -- Nothing still reads what was dropped: the three writers, the view, and
  -- any other function of the schema that names a dropped function or table.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[])',
    'public.delete_quotation(uuid)',
    'public.copy_quotation(uuid)'
  ]
  LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '0200: % is missing', v_fn;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = to_regprocedure(v_fn) AND p.prosrc ~ v_gone
    ) THEN
      RAISE EXCEPTION '0200: % still reads a dropped column or function', v_fn;
    END IF;
  END LOOP;
  IF pg_get_viewdef('public.quotation_list'::regclass) ~ v_gone THEN
    RAISE EXCEPTION '0200: quotation_list still reads a dropped column';
  END IF;
  SELECT p.proname INTO v_name
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~ ('\m(next_quotation_draft_ref|quotation_draft_sequence|assert_quotation_approve|'
      || 'approve_quotation|return_quotation_approval|set_quotation_outcome)\M')
  LIMIT 1;
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION '0200: the function % still names a dropped quotation object', v_name;
  END IF;

  -- The key stays with the admin role under its new label.
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions
    WHERE key = 'sales.quotations.approve'
      AND group_key = 'sales'
      AND enforced_in = 'database'
      AND name_ar = 'المبيعات: قالب شروط عروض الاسعار'
  ) THEN
    RAISE EXCEPTION '0200: the key sales.quotations.approve is missing or not relabelled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_key = 'admin'
      AND permission_key = 'sales.quotations.approve'
  ) THEN
    RAISE EXCEPTION '0200: the admin role does not hold sales.quotations.approve';
  END IF;

  -- No function of the feature is executable by anon or PUBLIC.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[])',
    'public.delete_quotation(uuid)',
    'public.copy_quotation(uuid)',
    'public.next_quotation_number()',
    'public.record_quotation_event(uuid, text, jsonb)',
    'public.quotation_price_value(jsonb)',
    'public.normalise_quotation_term_template()'
  ]
  LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '0200: % is missing', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0200: % is executable by anon', v_fn;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_proc p,
           aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = to_regprocedure(v_fn)
        AND a.grantee = 0
        AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION '0200: % is executable by PUBLIC', v_fn;
    END IF;
  END LOOP;

  -- The three writers are callable by a signed-in user; the internal helpers
  -- are not.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[])',
    'public.delete_quotation(uuid)',
    'public.copy_quotation(uuid)'
  ]
  LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0200: % is not executable by authenticated', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.next_quotation_number()',
    'public.record_quotation_event(uuid, text, jsonb)',
    'public.quotation_price_value(jsonb)',
    'public.normalise_quotation_term_template()'
  ]
  LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0200: % is executable by authenticated', v_fn;
    END IF;
  END LOOP;

  -- RLS is on for every table of the feature; the new record has no write
  -- privilege for a client role.
  FOREACH v_table IN ARRAY ARRAY[
    'public.quotation_term_templates',
    'public.quotations',
    'public.quotation_lines',
    'public.quotation_costs',
    'public.quotation_terms',
    'public.quotation_events',
    'public.quotation_number_sequence',
    'public.quotation_deletions'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.oid = to_regclass(v_table)
        AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION '0200: row level security is off on %', v_table;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.quotation_deletions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.quotation_deletions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.quotation_deletions', 'DELETE')
     OR has_table_privilege('anon', 'public.quotation_deletions', 'SELECT') THEN
    RAISE EXCEPTION '0200: quotation_deletions is writable by a client role or readable by anon';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
