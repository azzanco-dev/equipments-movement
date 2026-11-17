-- 0201: quotation terms without a title — a term is its text alone.
--
-- Owner decision 2026-11-17, on the terms of «عروض الاسعار»:
-- «شيل العنوان العربي والانجليزي في الشروط».
--
-- A term of the template (quotation_term_templates) and its copy on a
-- quotation (quotation_terms) keep ONE text in Arabic and ONE in English
-- (body_ar, body_en), the order and, for the template, «محدد تلقائيا في
-- العرض الجديد». title_ar and title_en are DROPPED from both tables with
-- their CHECKs. 0199 and 0200 are not edited; this is the forward migration.
-- The quotation screens were never deployed, so nothing live reads the
-- dropped columns.
--
-- What changes:
--   1. A stored title is first folded into the text as its first line
--      («title» + newline + text) when the result still fits the 1000
--      characters of the text; a longer result keeps the text alone. The
--      updated_at of the rows is not moved. (Production held no template
--      term and no quotation when this was written.)
--   2. quotation_term_templates.title_ar / title_en and
--      quotation_terms.title_ar / title_en are dropped.
--   3. normalise_quotation_term_template trims the two texts only.
--   4. save_quotation, delete_quotation and copy_quotation are re-created
--      from 0200 verbatim without the two columns (same parameters, same
--      tokens, same grants). The `terms` of a quotation_deletions row no
--      longer carry title_ar / title_en.
--
-- Rollout: apply 0201 right after 0200 and BEFORE deploying the quotation
-- screens (they insert a template term without a title and select no title).

-- ===========================================================================
-- 0. 0200 must be in place
-- ===========================================================================
DO $$
BEGIN
  IF to_regclass('public.quotation_deletions') IS NULL
     OR to_regclass('public.quotation_draft_sequence') IS NOT NULL
     OR to_regprocedure('public.approve_quotation(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '0201: migration 0200 (quotations without states) is not applied';
  END IF;
END;
$$;

-- ===========================================================================
-- 1. A stored title becomes the first line of its text
-- ===========================================================================
ALTER TABLE public.quotation_term_templates DISABLE TRIGGER quotation_term_templates_updated_at;
ALTER TABLE public.quotation_terms DISABLE TRIGGER quotation_terms_updated_at;

UPDATE public.quotation_term_templates t
SET body_ar = CASE
      WHEN char_length(btrim(t.title_ar) || E'\n' || btrim(t.body_ar)) <= 1000
        THEN btrim(t.title_ar) || E'\n' || btrim(t.body_ar)
      ELSE t.body_ar
    END,
    body_en = CASE
      WHEN char_length(btrim(t.title_en) || E'\n' || btrim(t.body_en)) <= 1000
        THEN btrim(t.title_en) || E'\n' || btrim(t.body_en)
      ELSE t.body_en
    END;

UPDATE public.quotation_terms t
SET body_ar = CASE
      WHEN char_length(btrim(t.title_ar) || E'\n' || btrim(t.body_ar)) <= 1000
        THEN btrim(t.title_ar) || E'\n' || btrim(t.body_ar)
      ELSE t.body_ar
    END,
    body_en = CASE
      WHEN char_length(btrim(t.title_en) || E'\n' || btrim(t.body_en)) <= 1000
        THEN btrim(t.title_en) || E'\n' || btrim(t.body_en)
      ELSE t.body_en
    END;

ALTER TABLE public.quotation_term_templates ENABLE TRIGGER quotation_term_templates_updated_at;
ALTER TABLE public.quotation_terms ENABLE TRIGGER quotation_terms_updated_at;

-- ===========================================================================
-- 2. The title columns are dropped (their CHECKs go with them)
-- ===========================================================================
ALTER TABLE public.quotation_term_templates
  DROP COLUMN title_ar,
  DROP COLUMN title_en;

ALTER TABLE public.quotation_terms
  DROP COLUMN title_ar,
  DROP COLUMN title_en;

COMMENT ON TABLE public.quotation_term_templates IS
  '0199 / 0201: the terms template of quotations — one text in Arabic and one in English per term (no title since 0201), its order and whether a new quotation ticks it. Written directly under RLS by sales.quotations.approve; read by sales.view.';
COMMENT ON TABLE public.quotation_terms IS
  '0199 / 0201: the COPIES of the template terms a quotation carries — the two texts (no title since 0201) and the order, with template_id NULL once the template row is deleted. Written only by save_quotation and copy_quotation.';

-- ===========================================================================
-- 3. The template trigger trims the two texts only
-- ===========================================================================
-- 0199's body without its two title lines.
CREATE OR REPLACE FUNCTION public.normalise_quotation_term_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.body_ar := btrim(NEW.body_ar);
  NEW.body_en := btrim(NEW.body_en);

  IF NEW.position IS NULL OR NEW.position <= 0 THEN
    -- Definer rights: the greatest position of the WHOLE template, whatever
    -- the writer may read.
    SELECT COALESCE(max(t.position), 0) + 1 INTO NEW.position
    FROM public.quotation_term_templates t
    WHERE t.id <> NEW.id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalise_quotation_term_template() IS
  '0201 (re-created from 0199 without the titles): BEFORE INSERT / UPDATE trigger of quotation_term_templates — trims body_ar and body_en; a position of 0 or less becomes max(position) + 1; created_by is the inserting user and never changes. Not callable by clients.';

REVOKE ALL ON FUNCTION public.normalise_quotation_term_template()
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 4. save_quotation: the chosen template texts are copied without a title
-- ===========================================================================
-- 0200's body verbatim; only the copy of the template rows changes.
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
    quotation_id, template_id, body_ar, body_en, position
  )
  SELECT v_id, t.id, t.body_ar, t.body_en, 0
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

-- ===========================================================================
-- 5. delete_quotation: the archived terms carry no title
-- ===========================================================================
-- 0200's body verbatim; only the terms of the archive row change.
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

-- ===========================================================================
-- 6. copy_quotation: the stored copies are copied without a title
-- ===========================================================================
-- 0200's body verbatim; only the copy of the terms changes.
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
    quotation_id, template_id, body_ar, body_en, position
  )
  SELECT v_id, t.template_id, t.body_ar, t.body_en, t.position
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

-- ===========================================================================
-- 7. The closing guard
-- ===========================================================================
DO $$
DECLARE
  v_name text;
  v_fn text;
BEGIN
  -- No title column is left on the two tables.
  SELECT c.relname || '.' || a.attname INTO v_name
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  WHERE a.attrelid IN (
      'public.quotation_term_templates'::regclass,
      'public.quotation_terms'::regclass
    )
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname IN ('title_ar', 'title_en')
  LIMIT 1;
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION '0201: the column % still exists', v_name;
  END IF;

  -- No function of the feature still reads a title.
  SELECT p.proname INTO v_fn
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'normalise_quotation_term_template', 'save_quotation',
      'delete_quotation', 'copy_quotation'
    )
    AND p.prosrc ~ '\m(title_ar|title_en)\M'
  LIMIT 1;
  IF v_fn IS NOT NULL THEN
    RAISE EXCEPTION '0201: % still reads a term title', v_fn;
  END IF;

  -- The three functions stay closed to anon and open to authenticated.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[])',
    'public.delete_quotation(uuid)',
    'public.copy_quotation(uuid)'
  ]
  LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '0201: % is missing', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0201: the grants of % changed', v_fn;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.normalise_quotation_term_template()', 'EXECUTE') THEN
    RAISE EXCEPTION '0201: normalise_quotation_term_template is callable by a client';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
