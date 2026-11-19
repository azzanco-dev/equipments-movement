-- ===========================================================================
-- 0204: the responsible persons of a client, and a quotation's «عناية» and
-- working hours.
--
-- Owner decisions 2026-11-19, after the quotation PDF he approved the same
-- day (it prints «عناية» with a mobile and an email in the client's box, and
-- a «ساعات العمل» table of three fixed numbers):
--   «طيب كيف بتكون الية اضافة ساعات العمل» → the three numbers become fields
--     of the quotation, 10 / 26 / 260 by default;
--   «ابغى خيار اضافة بيانات شخص مسؤول جديد, ويكون فيه تعيين له حسب الشركة
--     وحسب المشروع, الاسم رقم التواصل الايميل»;
--   «في قاعدة البيانات اضف اسناد الشركة والمشروع للشخص المسؤول, لكن الفلتر
--     يكون حسب الشركة مبدئيا» → the projects of a person are stored; the
--     screens list a client's persons by the company alone for now;
--   «لا خليهم منفصلين» → the one contact a company row already carries
--     (companies.contact_person / contact_number / email, 0175) stays as it
--     is and is NOT copied into the new list;
--   a quotation without «عناية» is allowed; clients (companies) only, no
--     such list for suppliers.
--
-- What this adds:
--   1. company_contacts: the responsible persons of a client company — a
--      name, an optional contact number and email — and
--      company_contact_projects: the projects a person is assigned to (no
--      row = every project of the company). Read by sales.view or the
--      companies keys; written ONLY by save_company_contact and
--      delete_company_contact (sales.manage OR companies_projects.edit, so
--      a person can be added from the quotation form and from the company
--      form).
--   2. quotations gains «عناية» — contact_id (which person the copy came
--      from; NO foreign key, see below) and the COPY attention_name /
--      attention_number / attention_email — and the working hours
--      daily_hours / monthly_days / monthly_hours (10 / 26 / 260 for every
--      existing quotation).
--   3. save_quotation takes two more optional parameters, p_attention and
--      p_hours (the ten-parameter function is dropped; a call with the ten
--      named parameters resolves to the new one and changes neither);
--      copy_quotation copies the new columns; delete_quotation archives
--      them (quotation_deletions.attention / hours); quotation_list exposes
--      them as trailing columns.
--
-- A quotation keeps a COPY of the person's three values, as it keeps a copy
-- of its terms: editing or deleting a person never changes a saved
-- quotation. That is also why quotations.contact_id carries no foreign key:
-- a deleted person must not touch a quotation row (an ON DELETE SET NULL
-- would fire the quotation's updated_at trigger and move its «اخر تعديل»).
--
-- Rollout: apply 0204 BEFORE deploying the screens that use it (they select
-- the new columns and send the two parameters). The screens live before it
-- keep working: they call save_quotation with its ten named parameters and
-- select the view's earlier columns.

-- ===========================================================================
-- 0. 0202 must be in place, and 0204 not applied twice
-- ===========================================================================
DO $$
BEGIN
  IF to_regprocedure('public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[])') IS NULL
     OR to_regclass('public.quotation_deletions') IS NULL THEN
    RAISE EXCEPTION '0204: the quotation functions of 0200 / 0201 are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.quotations'::regclass
      AND c.conname = 'quotations_number_format'
      AND pg_get_constraintdef(c.oid) LIKE '%{9,}%'
  ) THEN
    RAISE EXCEPTION '0204: apply 0202 first';
  END IF;
  IF to_regclass('public.company_contacts') IS NOT NULL THEN
    RAISE EXCEPTION '0204: company_contacts already exists';
  END IF;
END;
$$;

-- ===========================================================================
-- 1. company_contacts and their projects
-- ===========================================================================
CREATE TABLE public.company_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL
    CONSTRAINT company_contacts_name_check
      CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  contact_number text
    CONSTRAINT company_contacts_contact_number_check
      CHECK (contact_number IS NULL OR char_length(contact_number) BETWEEN 1 AND 30),
  email text
    CONSTRAINT company_contacts_email_check
      CHECK (
        email IS NULL
        OR (char_length(email) <= 120 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
      ),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX company_contacts_company_idx
  ON public.company_contacts (company_id, name);

CREATE TRIGGER company_contacts_updated_at
  BEFORE UPDATE ON public.company_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.company_contacts IS
  '0204: the responsible persons of a client company («الاشخاص المسؤولون»): a name, an optional contact number and an optional email. A quotation copies one of them as its «عناية». The company row''s own single contact (0175) is separate and untouched. Read by sales.view or companies_projects.read / .edit; written only by save_company_contact and delete_company_contact. Deleted with their company.';

-- A pure link table: created_at only.
CREATE TABLE public.company_contact_projects (
  contact_id uuid NOT NULL REFERENCES public.company_contacts(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, project_id)
);

CREATE INDEX company_contact_projects_project_idx
  ON public.company_contact_projects (project_id);

COMMENT ON TABLE public.company_contact_projects IS
  '0204: the projects a responsible person is assigned to; a person with no row here is for every project of the company. Stored for later use: the screens list a client''s persons by the company alone for now (owner 2026-11-19). Written only by save_company_contact.';

ALTER TABLE public.company_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_contact_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_company_contacts ON public.company_contacts
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission('sales.view'))
    OR (SELECT public.has_permission('companies_projects.read'))
    OR (SELECT public.has_permission('companies_projects.edit'))
  );

CREATE POLICY select_company_contact_projects ON public.company_contact_projects
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission('sales.view'))
    OR (SELECT public.has_permission('companies_projects.read'))
    OR (SELECT public.has_permission('companies_projects.edit'))
  );

-- No insert / update / delete policy: the two functions below are the only
-- writers.
REVOKE ALL ON TABLE public.company_contacts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.company_contact_projects FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.company_contacts TO authenticated;
GRANT SELECT ON TABLE public.company_contact_projects TO authenticated;

-- ===========================================================================
-- 2. The writers of a responsible person
-- ===========================================================================
CREATE FUNCTION public.assert_company_contacts_manage()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT (
       public.has_permission('sales.manage')
       OR public.has_permission('companies_projects.edit')
     ) THEN
    RAISE EXCEPTION 'company_contacts_manage_required'
      USING ERRCODE = '42501',
            HINT = 'Managing the responsible persons of a client needs sales.manage or companies_projects.edit.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_company_contacts_manage() IS
  '0204: raises company_contacts_manage_required (42501) unless the caller is signed in and holds sales.manage or companies_projects.edit. Called first by save_company_contact and delete_company_contact; not callable by clients.';

REVOKE ALL ON FUNCTION public.assert_company_contacts_manage()
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.save_company_contact(
  p_id uuid,
  p_company_id uuid,
  p_name text,
  p_contact_number text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_project_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c public.company_contacts%ROWTYPE;
  v_id uuid;
  v_name text;
  v_number text;
  v_email text;
  v_project_ids uuid[] := '{}';
  v_found integer;
BEGIN
  PERFORM public.assert_company_contacts_manage();

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_c
    FROM public.company_contacts c
    WHERE c.id = p_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_contact' USING ERRCODE = '22023';
    END IF;
    -- A person never moves to another company.
    IF p_company_id IS NOT NULL AND p_company_id <> v_c.company_id THEN
      RAISE EXCEPTION 'invalid_company' USING ERRCODE = '22023';
    END IF;
  ELSIF p_company_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'invalid_company' USING ERRCODE = '22023';
  END IF;

  v_name := NULLIF(btrim(p_name), '');
  IF v_name IS NULL OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;
  v_number := NULLIF(btrim(p_contact_number), '');
  IF char_length(v_number) > 30 THEN
    RAISE EXCEPTION 'invalid_contact_number' USING ERRCODE = '22023';
  END IF;
  v_email := NULLIF(lower(btrim(p_email)), '');
  IF v_email IS NOT NULL
     AND (char_length(v_email) > 120 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  -- The projects: NULL or empty = every project of the company. Companies
  -- and projects are independent selections in this program, so any
  -- existing project is accepted.
  IF p_project_ids IS NOT NULL AND cardinality(p_project_ids) > 0 THEN
    IF array_position(p_project_ids, NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_project' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT x) INTO v_project_ids
    FROM unnest(p_project_ids) AS x;
    SELECT count(*) INTO v_found
    FROM public.projects p
    WHERE p.id = ANY (v_project_ids);
    IF v_found <> cardinality(v_project_ids) THEN
      RAISE EXCEPTION 'invalid_project' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.company_contacts (
      company_id, name, contact_number, email, created_by
    ) VALUES (
      p_company_id, v_name, v_number, v_email, auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    v_id := p_id;
    UPDATE public.company_contacts
    SET name = v_name,
        contact_number = v_number,
        email = v_email,
        updated_at = now()
    WHERE id = p_id;
    DELETE FROM public.company_contact_projects
    WHERE contact_id = p_id AND NOT (project_id = ANY (v_project_ids));
  END IF;

  INSERT INTO public.company_contact_projects (contact_id, project_id)
  SELECT v_id, x
  FROM unnest(v_project_ids) AS x
  ON CONFLICT (contact_id, project_id) DO NOTHING;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.save_company_contact(uuid, uuid, text, text, text, uuid[]) IS
  '0204: p_id NULL adds a responsible person to the client company p_company_id, otherwise edits that person (the company never changes). The name is trimmed (1–120), a blank number or email is stored as NULL (number ≤ 30; email lower-cased, ≤ 120, a lenient shape), p_project_ids replaces the person''s projects (NULL / empty = every project of the company). Returns the person''s id. Tokens company_contacts_manage_required, invalid_contact, invalid_company, invalid_name, invalid_contact_number, invalid_email, invalid_project. Needs sales.manage or companies_projects.edit. A saved quotation keeps its own copy and is not touched.';

REVOKE ALL ON FUNCTION public.save_company_contact(uuid, uuid, text, text, text, uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_company_contact(uuid, uuid, text, text, text, uuid[])
  TO authenticated;

CREATE FUNCTION public.delete_company_contact(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_company_contacts_manage();

  -- The person's projects cascade. No quotation row is touched: a quotation
  -- holds its own copy, and its contact_id (no foreign key) simply stops
  -- naming a person.
  DELETE FROM public.company_contacts WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_contact' USING ERRCODE = '22023';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.delete_company_contact(uuid) IS
  '0204: deletes a responsible person (and the person''s project rows). Saved quotations keep their copy of the name, number and email. Tokens company_contacts_manage_required, invalid_contact. Needs sales.manage or companies_projects.edit.';

REVOKE ALL ON FUNCTION public.delete_company_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_company_contact(uuid) TO authenticated;

-- ===========================================================================
-- 3. quotations: «عناية» and the working hours
-- ===========================================================================
ALTER TABLE public.quotations
  -- Which person the copy came from. No foreign key (see the header).
  ADD COLUMN contact_id uuid,
  ADD COLUMN attention_name text
    CONSTRAINT quotations_attention_name_check
      CHECK (attention_name IS NULL OR char_length(attention_name) BETWEEN 1 AND 120),
  ADD COLUMN attention_number text
    CONSTRAINT quotations_attention_number_check
      CHECK (attention_number IS NULL OR char_length(attention_number) BETWEEN 1 AND 30),
  ADD COLUMN attention_email text
    CONSTRAINT quotations_attention_email_check
      CHECK (attention_email IS NULL OR char_length(attention_email) BETWEEN 1 AND 120),
  ADD COLUMN daily_hours numeric(4, 2) NOT NULL DEFAULT 10
    CONSTRAINT quotations_daily_hours_check CHECK (daily_hours > 0 AND daily_hours <= 24),
  ADD COLUMN monthly_days smallint NOT NULL DEFAULT 26
    CONSTRAINT quotations_monthly_days_check CHECK (monthly_days BETWEEN 1 AND 31),
  ADD COLUMN monthly_hours numeric(5, 2) NOT NULL DEFAULT 260
    CONSTRAINT quotations_monthly_hours_check CHECK (monthly_hours > 0 AND monthly_hours <= 744),
  -- Without a name there is no «عناية» at all.
  ADD CONSTRAINT quotations_attention_check
    CHECK (
      attention_name IS NOT NULL
      OR (contact_id IS NULL AND attention_number IS NULL AND attention_email IS NULL)
    );

COMMENT ON COLUMN public.quotations.contact_id IS
  '0204: the company_contacts row the «عناية» copy came from, while that person existed in this client''s list at the last save. No foreign key: deleting a person never touches a quotation.';
COMMENT ON COLUMN public.quotations.attention_name IS
  '0204: «عناية» — the COPY of the responsible person''s name (with attention_number and attention_email), taken when the quotation was saved. NULL = the quotation has no «عناية».';
COMMENT ON COLUMN public.quotations.daily_hours IS
  '0204: «ساعات العمل» of the quotation: the daily hours, with monthly_days and monthly_hours (10 / 26 / 260 by default and for every quotation made before 0204). Printed on the PDF; nothing is computed from them.';

-- What a deleted quotation carried (NULL for the rows archived before 0204).
ALTER TABLE public.quotation_deletions
  ADD COLUMN attention jsonb,
  ADD COLUMN hours jsonb;

-- ===========================================================================
-- 4. save_quotation: two more optional parameters
-- ===========================================================================
-- The ten-parameter function goes first: two overloads that differ only by
-- trailing defaults could not be told apart by a named call.
DROP FUNCTION public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[]);

-- 0201's body verbatim, plus «عناية» and the working hours.
CREATE FUNCTION public.save_quotation(
  p_id uuid,
  p_company_id uuid,
  p_project_id uuid,
  p_issue_date date,
  p_valid_until date,
  p_notes text,
  p_lines jsonb,
  p_costs jsonb,
  p_term_template_ids uuid[],
  p_keep_term_ids uuid[] DEFAULT NULL,
  p_attention jsonb DEFAULT NULL,
  p_hours jsonb DEFAULT NULL
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
  v_text text;
  v_contact_id uuid;
  v_att_name text;
  v_att_number text;
  v_att_email text;
  v_hours_daily numeric := 10;
  v_hours_days numeric := 26;
  v_hours_monthly numeric := 260;
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

  -- «عناية» (0204), a COPY of a responsible person. SQL NULL keeps what the
  -- quotation has (a new one has none, and a changed client drops it); an
  -- object with a name stores that copy; an object without a name, or JSON
  -- null, clears it.
  IF p_attention IS NULL THEN
    IF p_id IS NOT NULL AND v_q.company_id = p_company_id THEN
      v_contact_id := v_q.contact_id;
      v_att_name := v_q.attention_name;
      v_att_number := v_q.attention_number;
      v_att_email := v_q.attention_email;
    END IF;
  ELSIF jsonb_typeof(p_attention) = 'null' THEN
    NULL;
  ELSIF jsonb_typeof(p_attention) <> 'object' THEN
    RAISE EXCEPTION 'invalid_attention' USING ERRCODE = '22023';
  ELSE
    v_att_name := NULLIF(btrim(p_attention->>'name'), '');
    IF v_att_name IS NOT NULL THEN
      v_att_number := NULLIF(btrim(p_attention->>'contact_number'), '');
      v_att_email := NULLIF(lower(btrim(p_attention->>'email')), '');
      IF char_length(v_att_name) > 120
         OR char_length(v_att_number) > 30
         OR char_length(v_att_email) > 120 THEN
        RAISE EXCEPTION 'invalid_attention' USING ERRCODE = '22023';
      END IF;
      -- The person the copy came from, kept only while it is a person of
      -- this client (one deleted meanwhile leaves the copy on its own).
      v_text := NULLIF(btrim(p_attention->>'contact_id'), '');
      IF v_text IS NOT NULL THEN
        IF v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION 'invalid_attention' USING ERRCODE = '22023';
        END IF;
        SELECT c.id INTO v_contact_id
        FROM public.company_contacts c
        WHERE c.id = v_text::uuid AND c.company_id = p_company_id;
      END IF;
    END IF;
  END IF;

  -- The working hours (0204). SQL NULL or JSON null keeps what the quotation
  -- has (10 / 26 / 260 on a new one); an object sets the three, each a JSON
  -- number.
  IF p_hours IS NULL OR jsonb_typeof(p_hours) = 'null' THEN
    IF p_id IS NOT NULL THEN
      v_hours_daily := v_q.daily_hours;
      v_hours_days := v_q.monthly_days;
      v_hours_monthly := v_q.monthly_hours;
    END IF;
  ELSIF jsonb_typeof(p_hours) <> 'object'
     OR jsonb_typeof(p_hours->'daily_hours') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_hours->'monthly_days') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_hours->'monthly_hours') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'invalid_hours' USING ERRCODE = '22023';
  ELSE
    v_hours_daily := (p_hours->>'daily_hours')::numeric;
    v_hours_days := (p_hours->>'monthly_days')::numeric;
    v_hours_monthly := (p_hours->>'monthly_hours')::numeric;
    IF v_hours_daily <= 0 OR v_hours_daily > 24 OR v_hours_daily <> round(v_hours_daily, 2)
       OR v_hours_days < 1 OR v_hours_days > 31 OR v_hours_days <> trunc(v_hours_days)
       OR v_hours_monthly <= 0 OR v_hours_monthly > 744
       OR v_hours_monthly <> round(v_hours_monthly, 2) THEN
      RAISE EXCEPTION 'invalid_hours' USING ERRCODE = '22023';
    END IF;
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
      notes, created_by,
      contact_id, attention_name, attention_number, attention_email,
      daily_hours, monthly_days, monthly_hours
    ) VALUES (
      p_company_id, p_project_id, v_number, p_issue_date, p_valid_until,
      v_notes, auth.uid(),
      v_contact_id, v_att_name, v_att_number, v_att_email,
      v_hours_daily, v_hours_days::smallint, v_hours_monthly
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
        contact_id = v_contact_id,
        attention_name = v_att_name,
        attention_number = v_att_number,
        attention_email = v_att_email,
        daily_hours = v_hours_daily,
        monthly_days = v_hours_days::smallint,
        monthly_hours = v_hours_monthly,
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

COMMENT ON FUNCTION public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[], jsonb, jsonb) IS
  '0204 (re-created from 0201 with «عناية» and the working hours): p_id NULL creates a quotation and issues its official number (next_quotation_number, taken after every check; event created {quote_number, line_count}); otherwise edits ANY quotation — its company, project, dates and notes, its lines and costs replaced wholesale, and its terms: the stored copies named in p_keep_term_ids stay exactly as they are, the other copies go, and the template rows of p_term_template_ids that no kept copy stands for are copied anew (event updated {line_count}); the number never changes. p_lines [{equipment_type, daily_price|null, monthly_price|null, mob_demob_price|null, note|null}], p_costs [{name, borne_by client|lessor}] (NULL = none), p_term_template_ids, p_keep_term_ids as before. p_attention (optional): SQL NULL keeps the quotation''s «عناية» (none on a new one; dropped when the client changes); an object {name, contact_number|null, email|null, contact_id|null} stores that COPY (name ≤ 120, number ≤ 30, email ≤ 120 lower-cased; contact_id is kept only while it names a person of this client); an object without a name, or JSON null, clears it. p_hours (optional): SQL NULL keeps the hours (10 / 26 / 260 on a new one); an object {daily_hours, monthly_days, monthly_hours} of JSON numbers sets them (0 < daily ≤ 24 with two decimals, days a whole number 1–31, 0 < monthly ≤ 744 with two decimals). Tokens sales_manage_required, invalid_quotation, invalid_company, invalid_project, invalid_dates, invalid_notes, invalid_attention, invalid_hours, quotation_has_no_lines, invalid_lines, invalid_equipment_type, duplicate_equipment_type, invalid_price, line_has_no_price, invalid_note, invalid_costs, invalid_cost_name, invalid_borne_by, invalid_terms. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[], jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[], jsonb, jsonb)
  TO authenticated;

-- ===========================================================================
-- 5. delete_quotation: the archive carries «عناية» and the hours
-- ===========================================================================
-- 0201's body verbatim, plus the two archived columns.
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
    lines, costs, terms, events, deleted_by, deleted_by_name,
    attention, hours
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
    auth.uid(), v_actor_name,
    CASE
      WHEN v_q.attention_name IS NULL THEN NULL
      ELSE jsonb_build_object(
        'contact_id', v_q.contact_id,
        'name', v_q.attention_name,
        'contact_number', v_q.attention_number,
        'email', v_q.attention_email
      )
    END,
    jsonb_build_object(
      'daily_hours', v_q.daily_hours,
      'monthly_days', v_q.monthly_days,
      'monthly_hours', v_q.monthly_hours
    )
  );

  -- Lines, costs, terms and events cascade. The counter is not touched: the
  -- number stays a gap and is never issued again.
  DELETE FROM public.quotations WHERE id = p_id;
END;
$$;

-- ===========================================================================
-- 6. copy_quotation: the copy carries «عناية» and the hours
-- ===========================================================================
-- 0201's body verbatim, plus the seven columns.
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
    notes, created_by,
    contact_id, attention_name, attention_number, attention_email,
    daily_hours, monthly_days, monthly_hours
  ) VALUES (
    v_src.company_id, v_src.project_id, v_number, v_today,
    v_today + (v_src.valid_until - v_src.issue_date),
    v_src.notes, auth.uid(),
    v_src.contact_id, v_src.attention_name, v_src.attention_number, v_src.attention_email,
    v_src.daily_hours, v_src.monthly_days, v_src.monthly_hours
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
-- 7. quotation_list: the new columns, appended
-- ===========================================================================
-- 0200's view with seven trailing columns (CREATE OR REPLACE keeps the
-- earlier columns, their order, the grants and the comment's subject).
CREATE OR REPLACE VIEW public.quotation_list
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
  ln.type_names,
  q.contact_id,
  q.attention_name,
  q.attention_number,
  q.attention_email,
  q.daily_hours,
  q.monthly_days,
  q.monthly_hours
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
  '0204 (0200''s view with trailing columns): one row per quotation with every quotations column of 0200, the client company and project names, created_by_name (profile_names), line_count and type_names, then «عناية» (contact_id, attention_name, attention_number, attention_email) and the working hours (daily_hours, monthly_days, monthly_hours). The quotations list and page. security_invoker: sales.view and the master-data policies apply as for the reader.';

REVOKE ALL ON public.quotation_list FROM PUBLIC, anon;
GRANT SELECT ON public.quotation_list TO authenticated;

-- ===========================================================================
-- 8. The closing guard
-- ===========================================================================
DO $$
DECLARE
  v_fn text;
BEGIN
  IF to_regprocedure('public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION '0204: the ten-parameter save_quotation is still there';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[], jsonb, jsonb)',
    'public.delete_quotation(uuid)',
    'public.copy_quotation(uuid)',
    'public.save_company_contact(uuid, uuid, text, text, text, uuid[])',
    'public.delete_company_contact(uuid)'
  ]
  LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '0204: % is missing', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0204: the grants of % are wrong', v_fn;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.assert_company_contacts_manage()', 'EXECUTE') THEN
    RAISE EXCEPTION '0204: assert_company_contacts_manage is callable by a client';
  END IF;

  -- The two tables are read-only for clients.
  IF has_table_privilege('authenticated', 'public.company_contacts', 'INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'public.company_contact_projects', 'INSERT, UPDATE, DELETE')
     OR has_table_privilege('anon', 'public.company_contacts', 'SELECT') THEN
    RAISE EXCEPTION '0204: a client can write company_contacts';
  END IF;

  -- Every quotation carries its hours.
  IF EXISTS (
    SELECT 1 FROM public.quotations q
    WHERE q.daily_hours IS NULL OR q.monthly_days IS NULL OR q.monthly_hours IS NULL
  ) THEN
    RAISE EXCEPTION '0204: a quotation lacks its working hours';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
