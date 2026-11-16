-- 0199: quotations («عروض الاسعار») — the database layer.
--
-- Owner decisions (final, approved with the Figma design, 2026-11-15 /
-- 2026-11-16):
--   1. A quotation is a price list for a CLIENT (a row of companies) with an
--      optional project. NO quantities, NO totals.
--   2. A line = one equipment TYPE (a row of equipment_types, by name) with
--      three optional prices excluding VAT — daily, monthly and transport
--      «النقل mob/demob» —, at least one of them set, and an optional note.
--      A type appears once per quotation.
--   3. Costs («التكاليف»): a list per quotation; each cost has a name and who
--      bears it, the client or Al-Azani (stored as `lessor`, the side that
--      rents the equipment out). The form's starting costs are the screens'.
--   4. Terms («الشروط والاحكام») come from a TEMPLATE managed in Settings
--      (title and body in Arabic and English, a position, «محدد تلقائيا في
--      العرض الجديد»); the terms ticked in the form are COPIED into the
--      quotation when it is saved, so later template edits never change a
--      saved quotation.
--   5. States: draft → approved → the client's answer accepted / rejected.
--      «منتهي» (expired) is computed on read: approved, no answer and
--      valid_until before the Saudi today. Approval is by the ADMIN — the
--      new key sales.quotations.approve, held by the admin role — and the
--      approver MAY be the creator. The official number QT-YYYYMM#### is
--      issued at the FIRST approval; a draft carries a draft reference
--      QD-####. «رجوع للتعديل» puts an approved quotation back to draft: it
--      keeps its official number and its client answer is cleared. A draft
--      that still carries its draft reference can be deleted. «نسخ العرض»
--      makes a new draft from any quotation.
--   6. A quotation is a document only: no link to client POs, cards or card
--      prices. Nothing here touches them.
--   8. The quotation page shows no timeline, but the database keeps an
--      append-only event log (no screen reads it).
--   9. The existing sales pages and objects are NOT changed.
--
-- Shape (the 0169 / 0177 / 0190 / 0193 patterns):
--   * quotation_term_templates is a master list written DIRECTLY under RLS
--     (like banks, 0177): read with sales.view, written with
--     sales.quotations.approve.
--   * quotations, quotation_lines, quotation_costs, quotation_terms and
--     quotation_events are read with sales.view and have NO write policy:
--     every write goes through the SECURITY DEFINER functions below
--     (SET search_path = public, pg_temp; REVOKE ALL FROM PUBLIC, anon;
--     GRANT EXECUTE TO authenticated), each checking auth.uid() and the key
--     first. Inside a writer the quotation row is locked FOR UPDATE first,
--     then a counter row.
--   * the two one-row counters and their functions are internal (the 0190
--     pattern): RLS on with no policy, no privilege for any client role, the
--     functions not executable by authenticated.
--   * every editable table carries updated_at with update_updated_at().
--
-- Stable error tokens (the whole message; the client maps them):
--   sales_manage_required, quotation_approve_required          42501
--   invalid_quotation, invalid_company, invalid_project,
--   invalid_dates, invalid_notes, quotation_has_no_lines (save),
--   invalid_lines, invalid_equipment_type,
--   duplicate_equipment_type, invalid_price, line_has_no_price,
--   invalid_note, invalid_costs, invalid_cost_name,
--   invalid_borne_by, invalid_terms, invalid_outcome            22023
--   quotation_approved_locked, quotation_not_draft,
--   quotation_has_no_lines (approve), quotation_not_approved,
--   quotation_number_issued                                     55000
--
-- Rollout: apply 0199 BEFORE deploying the quotation screens (they read the
-- view and call the functions). Nothing live depends on it.

-- ===========================================================================
-- 1. The permission key, held by the admin role
-- ===========================================================================
-- Owner: approval is by the ADMIN. Reads use the existing sales.view and the
-- quotation writes the existing sales.manage; the new key approves, returns
-- for editing and manages the terms template.
INSERT INTO public.permissions (
  key, group_key, name_ar, name_en, description_ar, description_en,
  scoped, scopes, requires, admin_only, enforced_in, sort
) VALUES (
  'sales.quotations.approve', 'sales',
  'المبيعات: اعتماد عروض الاسعار وقالب شروطها', 'Sales: approve quotations and their terms template',
  'اعتماد عرض سعر مسودة ويصدر رقمه عند اول اعتماد، وارجاعه للتعديل، وادارة قالب الشروط والاحكام.',
  'Approve a draft quotation (its number is issued at the first approval), return it for editing, and manage the terms template.',
  false, NULL, ARRAY['sales.view'], false, 'database', 1130
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_key, permission_key, scope)
VALUES ('admin', 'sales.quotations.approve', NULL)
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- ===========================================================================
-- 2. The terms template (owner decision 4), written directly under RLS
-- ===========================================================================
CREATE TABLE public.quotation_term_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_ar text NOT NULL
    CONSTRAINT quotation_term_templates_title_ar_check
      CHECK (char_length(btrim(title_ar)) BETWEEN 1 AND 120),
  title_en text NOT NULL
    CONSTRAINT quotation_term_templates_title_en_check
      CHECK (char_length(btrim(title_en)) BETWEEN 1 AND 120),
  body_ar text NOT NULL
    CONSTRAINT quotation_term_templates_body_ar_check
      CHECK (char_length(btrim(body_ar)) BETWEEN 1 AND 1000),
  body_en text NOT NULL
    CONSTRAINT quotation_term_templates_body_en_check
      CHECK (char_length(btrim(body_en)) BETWEEN 1 AND 1000),
  -- 0 or less = «after the last term» (the trigger below); a positive value
  -- places the term.
  position integer NOT NULL DEFAULT 0,
  -- «محدد تلقائيا في العرض الجديد»: ticked in the form of a NEW quotation.
  is_default boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quotation_term_templates_position_idx
  ON public.quotation_term_templates (position, id);

COMMENT ON TABLE public.quotation_term_templates IS
  '0199: the terms template of quotations («الشروط والاحكام», Settings › «شروط عروض الاسعار»): title and body in Arabic and English, a position, is_default («محدد تلقائيا في العرض الجديد»). save_quotation COPIES the chosen rows into quotation_terms, so editing or deleting a template term never changes a saved quotation. Read by sales.view; written directly (RLS) by sales.quotations.approve. No seed rows.';
COMMENT ON COLUMN public.quotation_term_templates.position IS
  '0199: the order of the term in the template and in a new quotation. A value of 0 or less is replaced by max(position) + 1 (normalise_quotation_term_template).';
COMMENT ON COLUMN public.quotation_term_templates.is_default IS
  '0199: «محدد تلقائيا في العرض الجديد» — the term is pre-ticked in the form of a new quotation.';

-- Trims the four texts, places a term without a position after the last
-- one, and keeps created_by the real author.
CREATE OR REPLACE FUNCTION public.normalise_quotation_term_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.title_ar := btrim(NEW.title_ar);
  NEW.title_en := btrim(NEW.title_en);
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
  '0199: BEFORE INSERT / UPDATE trigger of quotation_term_templates — trims title_ar, title_en, body_ar, body_en; a position of 0 or less becomes max(position) + 1; created_by is the inserting user and never changes. Not callable by clients.';

REVOKE ALL ON FUNCTION public.normalise_quotation_term_template()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER quotation_term_templates_normalise
  BEFORE INSERT OR UPDATE ON public.quotation_term_templates
  FOR EACH ROW EXECUTE FUNCTION public.normalise_quotation_term_template();

CREATE TRIGGER quotation_term_templates_updated_at
  BEFORE UPDATE ON public.quotation_term_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.quotation_term_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_quotation_term_templates ON public.quotation_term_templates
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('sales.view')));

CREATE POLICY insert_quotation_term_templates ON public.quotation_term_templates
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_permission('sales.quotations.approve')));

CREATE POLICY update_quotation_term_templates ON public.quotation_term_templates
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_permission('sales.quotations.approve')))
  WITH CHECK ((SELECT public.has_permission('sales.quotations.approve')));

CREATE POLICY delete_quotation_term_templates ON public.quotation_term_templates
  FOR DELETE TO authenticated
  USING ((SELECT public.has_permission('sales.quotations.approve')));

REVOKE ALL ON TABLE public.quotation_term_templates FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.quotation_term_templates FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quotation_term_templates TO authenticated;

-- ===========================================================================
-- 3. quotations (owner decisions 1 and 5)
-- ===========================================================================
CREATE TABLE public.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT,
  -- The official number QT-YYYYMM#### (issued at the first approval) or,
  -- until then, the draft reference QD-####.
  quote_number text NOT NULL UNIQUE
    CONSTRAINT quotations_number_format
      CHECK (quote_number ~ '^QT-[0-9]{10,}$' OR quote_number ~ '^QD-[0-9]{4,}$'),
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT quotations_status_check CHECK (status IN ('draft', 'approved')),
  issue_date date NOT NULL,
  valid_until date NOT NULL,
  notes text
    CONSTRAINT quotations_notes_check CHECK (char_length(notes) <= 1000),
  approved_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- The client's answer, only on an approved quotation.
  outcome text
    CONSTRAINT quotations_outcome_check CHECK (outcome IN ('accepted', 'rejected')),
  outcome_at timestamptz,
  outcome_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  outcome_note text
    CONSTRAINT quotations_outcome_note_check CHECK (char_length(outcome_note) <= 500),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quotations_valid_until_check CHECK (valid_until >= issue_date),
  CONSTRAINT quotations_approved_at_check
    CHECK ((status = 'approved') = (approved_at IS NOT NULL)),
  -- An approved quotation always carries an official number.
  CONSTRAINT quotations_approved_numbered
    CHECK (status <> 'approved' OR quote_number ~ '^QT-'),
  CONSTRAINT quotations_outcome_approved_check
    CHECK (outcome IS NULL OR status = 'approved'),
  CONSTRAINT quotations_outcome_at_check
    CHECK ((outcome IS NULL) = (outcome_at IS NULL))
);

CREATE INDEX quotations_company_idx
  ON public.quotations (company_id);
CREATE INDEX quotations_updated_at_idx
  ON public.quotations (updated_at DESC);
CREATE INDEX quotations_quote_number_trgm_idx
  ON public.quotations USING gin (quote_number extensions.gin_trgm_ops);

COMMENT ON TABLE public.quotations IS
  '0199: quotations («عروض الاسعار»): a price list for a client company with an optional project, by equipment type, no quantities or totals. status draft / approved; the client answer outcome accepted / rejected on an approved one; «منتهي» is computed (quotation_list.state). A document only: no link to client POs or cards. Read by sales.view; written only by save_quotation, approve_quotation, return_quotation_approval, set_quotation_outcome, delete_quotation and copy_quotation.';
COMMENT ON COLUMN public.quotations.quote_number IS
  '0199: the OFFICIAL number QT- + the Saudi YYYYMM of the first approval + a global sequence of at least four digits that never restarts (next_quotation_number), or, until the first approval, the draft reference QD-#### (next_quotation_draft_ref). A quotation returned to draft keeps its official number.';

CREATE TRIGGER quotations_updated_at
  BEFORE UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================================================
-- 4. quotation_lines (owner decision 2)
-- ===========================================================================
CREATE TABLE public.quotation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  -- By name, as equipment.type: a rename of the type follows, a used type
  -- cannot be deleted.
  equipment_type text NOT NULL
    REFERENCES public.equipment_types(name) ON UPDATE CASCADE ON DELETE RESTRICT,
  -- Prices excluding VAT; NULL = this price does not apply.
  daily_price numeric(12, 2)
    CONSTRAINT quotation_lines_daily_price_check CHECK (daily_price IS NULL OR daily_price >= 0),
  monthly_price numeric(12, 2)
    CONSTRAINT quotation_lines_monthly_price_check CHECK (monthly_price IS NULL OR monthly_price >= 0),
  mob_demob_price numeric(12, 2)
    CONSTRAINT quotation_lines_mob_demob_price_check CHECK (mob_demob_price IS NULL OR mob_demob_price >= 0),
  note text
    CONSTRAINT quotation_lines_note_check CHECK (char_length(note) <= 500),
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quotation_lines_has_price
    CHECK (daily_price IS NOT NULL OR monthly_price IS NOT NULL OR mob_demob_price IS NOT NULL),
  CONSTRAINT quotation_lines_type_unique UNIQUE (quotation_id, equipment_type)
);

CREATE INDEX quotation_lines_quotation_position_idx
  ON public.quotation_lines (quotation_id, position);
CREATE INDEX quotation_lines_equipment_type_idx
  ON public.quotation_lines (equipment_type);

COMMENT ON TABLE public.quotation_lines IS
  '0199: one line per equipment type of a quotation with three optional prices excluding VAT (daily, monthly, mob/demob; at least one set) and an optional note; a type once per quotation. Read by sales.view; written only by save_quotation and copy_quotation.';

CREATE TRIGGER quotation_lines_updated_at
  BEFORE UPDATE ON public.quotation_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================================================
-- 5. quotation_costs (owner decision 3)
-- ===========================================================================
CREATE TABLE public.quotation_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  name text NOT NULL
    CONSTRAINT quotation_costs_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  -- Who bears the cost: the client, or Al-Azani (`lessor`).
  borne_by text NOT NULL
    CONSTRAINT quotation_costs_borne_by_check CHECK (borne_by IN ('client', 'lessor')),
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quotation_costs_quotation_position_idx
  ON public.quotation_costs (quotation_id, position);

COMMENT ON TABLE public.quotation_costs IS
  '0199: the costs of a quotation («التكاليف»), each with who bears it: client or lessor (Al-Azani). Read by sales.view; written only by save_quotation and copy_quotation.';

CREATE TRIGGER quotation_costs_updated_at
  BEFORE UPDATE ON public.quotation_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================================================
-- 6. quotation_terms: the COPIES of the template terms (owner decision 4)
-- ===========================================================================
CREATE TABLE public.quotation_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  -- The template row it was copied from; NULL once that row is deleted (the
  -- copy stays).
  template_id uuid REFERENCES public.quotation_term_templates(id) ON DELETE SET NULL,
  title_ar text NOT NULL
    CONSTRAINT quotation_terms_title_ar_check
      CHECK (char_length(btrim(title_ar)) BETWEEN 1 AND 120),
  title_en text NOT NULL
    CONSTRAINT quotation_terms_title_en_check
      CHECK (char_length(btrim(title_en)) BETWEEN 1 AND 120),
  body_ar text NOT NULL
    CONSTRAINT quotation_terms_body_ar_check
      CHECK (char_length(btrim(body_ar)) BETWEEN 1 AND 1000),
  body_en text NOT NULL
    CONSTRAINT quotation_terms_body_en_check
      CHECK (char_length(btrim(body_en)) BETWEEN 1 AND 1000),
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quotation_terms_quotation_position_idx
  ON public.quotation_terms (quotation_id, position);
CREATE INDEX quotation_terms_template_idx
  ON public.quotation_terms (template_id);

COMMENT ON TABLE public.quotation_terms IS
  '0199: the terms of a quotation, COPIED from quotation_term_templates at save time (their texts then, template_id kept as a link; ON DELETE SET NULL). Later template edits never change them. Read by sales.view; written only by save_quotation and copy_quotation.';

CREATE TRIGGER quotation_terms_updated_at
  BEFORE UPDATE ON public.quotation_terms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================================================
-- 7. quotation_events: the append-only log (owner decision 8)
-- ===========================================================================
CREATE TABLE public.quotation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  -- Insertion order within one created_at (one transaction shares now()).
  seq bigint GENERATED ALWAYS AS IDENTITY,
  event_type text NOT NULL
    CONSTRAINT quotation_events_type_check CHECK (
      event_type IN (
        'created', 'updated', 'approved', 'approval_returned',
        'outcome_set', 'outcome_cleared'
      )
    ),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- The actor's name at the time (profile_names).
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quotation_events_quotation_idx
  ON public.quotation_events (quotation_id, created_at, seq);

COMMENT ON TABLE public.quotation_events IS
  '0199: append-only audit of a quotation (created, updated, approved, approval_returned, outcome_set, outcome_cleared) with the actor and the actor''s name at the time. No screen reads it (owner: «شيل سجل العرض»). Read by sales.view; written only by the quotation functions; no update or delete path (it cascades with a deleted draft).';

-- ===========================================================================
-- 8. Read access: sales.view; no write policy on the five tables
-- ===========================================================================
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_quotations ON public.quotations
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('sales.view')));
CREATE POLICY select_quotation_lines ON public.quotation_lines
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('sales.view')));
CREATE POLICY select_quotation_costs ON public.quotation_costs
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('sales.view')));
CREATE POLICY select_quotation_terms ON public.quotation_terms
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('sales.view')));
CREATE POLICY select_quotation_events ON public.quotation_events
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('sales.view')));

REVOKE ALL ON TABLE
  public.quotations, public.quotation_lines, public.quotation_costs,
  public.quotation_terms, public.quotation_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE
  public.quotations, public.quotation_lines, public.quotation_costs,
  public.quotation_terms, public.quotation_events
  TO authenticated;

-- ===========================================================================
-- 9. The two counters (the 0190 pattern; owner decision 5)
-- ===========================================================================
CREATE TABLE public.quotation_number_sequence (
  singleton boolean PRIMARY KEY DEFAULT true
    CONSTRAINT quotation_number_sequence_singleton CHECK (singleton),
  last_seq integer NOT NULL DEFAULT 0
    CONSTRAINT quotation_number_sequence_last_seq_check CHECK (last_seq >= 0)
);

COMMENT ON TABLE public.quotation_number_sequence IS
  '0199: the ONE row holding the last issued official quotation number (QT-YYYYMM####, a global sequence that never restarts). Read and written only by next_quotation_number(); no client access.';

ALTER TABLE public.quotation_number_sequence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quotation_number_sequence FROM PUBLIC, anon, authenticated;
INSERT INTO public.quotation_number_sequence (singleton, last_seq) VALUES (true, 0);

CREATE TABLE public.quotation_draft_sequence (
  singleton boolean PRIMARY KEY DEFAULT true
    CONSTRAINT quotation_draft_sequence_singleton CHECK (singleton),
  last_seq integer NOT NULL DEFAULT 0
    CONSTRAINT quotation_draft_sequence_last_seq_check CHECK (last_seq >= 0)
);

COMMENT ON TABLE public.quotation_draft_sequence IS
  '0199: the ONE row holding the last consumed quotation draft reference (QD-####, never restarts). Read and written only by next_quotation_draft_ref(); no client access.';

ALTER TABLE public.quotation_draft_sequence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quotation_draft_sequence FROM PUBLIC, anon, authenticated;
INSERT INTO public.quotation_draft_sequence (singleton, last_seq) VALUES (true, 0);

CREATE OR REPLACE FUNCTION public.next_quotation_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seq integer;
BEGIN
  -- The one row, locked by the UPDATE itself: concurrent approvals queue
  -- here and each takes its own number.
  UPDATE public.quotation_number_sequence
  SET last_seq = last_seq + 1
  WHERE singleton
  RETURNING last_seq INTO v_seq;
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'quotation_number_sequence_missing' USING ERRCODE = '55000';
  END IF;
  RETURN 'QT-'
    || to_char(now() AT TIME ZONE 'Asia/Riyadh', 'YYYYMM')
    || lpad(v_seq::text, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.next_quotation_number() IS
  '0199: consumes and returns the next OFFICIAL quotation number, QT- + the Saudi year and month (YYYYMM) + a global sequence of at least four digits that never restarts (QT-2026110001). Called only by approve_quotation at a quotation''s first approval. The counter is a table row, so a rolled-back approval takes its number back.';

REVOKE ALL ON FUNCTION public.next_quotation_number()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.next_quotation_draft_ref()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seq integer;
BEGIN
  UPDATE public.quotation_draft_sequence
  SET last_seq = last_seq + 1
  WHERE singleton
  RETURNING last_seq INTO v_seq;
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'quotation_draft_sequence_missing' USING ERRCODE = '55000';
  END IF;
  RETURN 'QD-' || lpad(v_seq::text, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.next_quotation_draft_ref() IS
  '0199: consumes and returns the next quotation draft reference, QD- + a sequence of at least four digits that never restarts (QD-0001). Called only by save_quotation (a new draft) and copy_quotation.';

REVOKE ALL ON FUNCTION public.next_quotation_draft_ref()
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 10. Internal helpers
-- ===========================================================================
-- The approve key: approval, return for editing (owner: by the ADMIN).
CREATE OR REPLACE FUNCTION public.assert_quotation_approve()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('sales.quotations.approve') THEN
    RAISE EXCEPTION 'quotation_approve_required'
      USING ERRCODE = '42501',
            HINT = 'Approving quotations needs the sales.quotations.approve permission.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_quotation_approve() IS
  '0199: raises quotation_approve_required (42501) unless the caller is signed in and holds sales.quotations.approve. Called first by approve_quotation and return_quotation_approval; not callable by clients.';

REVOKE ALL ON FUNCTION public.assert_quotation_approve()
  FROM PUBLIC, anon, authenticated;

-- One event row with the actor and the actor's name at the time.
CREATE OR REPLACE FUNCTION public.record_quotation_event(
  p_quotation_id uuid,
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

  INSERT INTO public.quotation_events (quotation_id, event_type, payload, actor_id, actor_name)
  VALUES (p_quotation_id, p_event_type, COALESCE(p_payload, '{}'::jsonb), auth.uid(), v_actor_name);
END;
$$;

COMMENT ON FUNCTION public.record_quotation_event(uuid, text, jsonb) IS
  '0199: appends one quotation_events row for the signed-in actor with the actor''s name from profile_names. Called only by the quotation write functions; not callable by clients.';

REVOKE ALL ON FUNCTION public.record_quotation_event(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- One optional price of a line: JSON null / missing = NULL; otherwise a JSON
-- number between 0 and 9999999999.99 (numeric(12, 2)), else invalid_price.
CREATE OR REPLACE FUNCTION public.quotation_price_value(p_value jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_price numeric;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_value) <> 'number' THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  v_price := (p_value #>> '{}')::numeric;
  IF v_price < 0 OR v_price > 9999999999.99 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  RETURN round(v_price, 2);
END;
$$;

COMMENT ON FUNCTION public.quotation_price_value(jsonb) IS
  '0199: one optional line price of save_quotation — JSON null or missing = NULL, a JSON number 0 … 9999999999.99 (rounded to 2 decimals), anything else invalid_price (22023). Not callable by clients.';

REVOKE ALL ON FUNCTION public.quotation_price_value(jsonb)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 11. save_quotation: create a draft, or replace a draft wholesale
-- ===========================================================================
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

  -- An existing quotation: its row is locked first (every writer takes it),
  -- and only a DRAFT is edited (owner: an approved one goes back to draft
  -- through «رجوع للتعديل»).
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_q
    FROM public.quotations q
    WHERE q.id = p_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_quotation' USING ERRCODE = '22023';
    END IF;
    IF v_q.status <> 'draft' THEN
      RAISE EXCEPTION 'quotation_approved_locked'
        USING ERRCODE = '55000',
              HINT = 'An approved quotation is locked; return it to draft first.';
    END IF;
  END IF;

  -- The client (a company) and the optional project (decision 1). As
  -- create_client_po: the row must exist (companies carry no active flag).
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

  -- The lines (decision 2): at least one; each an object naming an existing
  -- type once, with at least one of the three prices; array order = position.
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

  -- The costs (decision 3): NULL = none; otherwise an array of objects, each
  -- a name and who bears it.
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

  -- The terms (decision 4): every id must be a template row; NULL or empty =
  -- no terms. A repeated id counts once.
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

  -- The stored copies to KEEP exactly as they are when a draft is edited
  -- (decision 4: a saved quotation's terms never change by themselves, so an
  -- edit of a price must not refresh a term from the template, and a term
  -- whose template row was deleted can stay). Each id is a quotation_terms
  -- row of THIS quotation; a new quotation has none.
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
    -- A new quotation is a draft under a draft reference, taken only now
    -- that every check passed; the official number waits for approval.
    v_number := public.next_quotation_draft_ref();

    INSERT INTO public.quotations (
      company_id, project_id, quote_number, status, issue_date, valid_until,
      notes, created_by
    ) VALUES (
      p_company_id, p_project_id, v_number, 'draft', p_issue_date, p_valid_until,
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
  '0199: p_id NULL creates a DRAFT quotation under a new draft reference (QD-####, taken after every check; event created {quote_number, line_count}); otherwise edits a DRAFT — its company, project, dates and notes, its lines and costs replaced wholesale, and its terms: the stored copies named in p_keep_term_ids stay exactly as they are, the other copies go, and the template rows of p_term_template_ids that no kept copy stands for are copied anew (event updated {line_count}). p_lines [{equipment_type, daily_price|null, monthly_price|null, mob_demob_price|null, note|null}], p_costs [{name, borne_by client|lessor}] (NULL = none), p_term_template_ids: the template rows whose CURRENT texts are copied into quotation_terms (NULL / empty = none); p_keep_term_ids (optional, an edit only): quotation_terms rows of this quotation to keep unchanged, so editing a draft never refreshes a term from the template and a term whose template row was deleted can stay; terms are ordered by the template position, then the copies without a template row; array order = position for lines and costs. Tokens sales_manage_required, invalid_quotation, quotation_approved_locked, invalid_company, invalid_project, invalid_dates, invalid_notes, quotation_has_no_lines, invalid_lines, invalid_equipment_type, duplicate_equipment_type, invalid_price, line_has_no_price, invalid_note, invalid_costs, invalid_cost_name, invalid_borne_by, invalid_terms. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[])
  TO authenticated;

-- ===========================================================================
-- 12. approve_quotation: the number at the first approval (decision 5)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.approve_quotation(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q public.quotations%ROWTYPE;
  v_lines integer;
  v_number text;
  v_draft_ref text;
BEGIN
  PERFORM public.assert_quotation_approve();

  -- The quotation row first, then (below) the counter row.
  SELECT * INTO v_q
  FROM public.quotations q
  WHERE q.id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_quotation' USING ERRCODE = '22023';
  END IF;
  IF v_q.status <> 'draft' THEN
    RAISE EXCEPTION 'quotation_not_draft'
      USING ERRCODE = '55000',
            HINT = 'The quotation is already approved.';
  END IF;

  SELECT count(*) INTO v_lines
  FROM public.quotation_lines l
  WHERE l.quotation_id = p_id;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'quotation_has_no_lines'
      USING ERRCODE = '55000',
            HINT = 'A quotation without equipment types cannot be approved.';
  END IF;

  -- No self-approval rule (owner: the approver MAY be the creator). The
  -- first approval issues the official number in place of the draft
  -- reference; a quotation returned to draft keeps the number it had.
  IF v_q.quote_number ~ '^QD-[0-9]{4,}$' THEN
    v_draft_ref := v_q.quote_number;
    v_number := public.next_quotation_number();
  ELSE
    v_number := v_q.quote_number;
  END IF;

  UPDATE public.quotations
  SET status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      quote_number = v_number
  WHERE id = p_id;

  PERFORM public.record_quotation_event(
    p_id, 'approved',
    jsonb_build_object('quote_number', v_number)
      || CASE
           WHEN v_draft_ref IS NOT NULL THEN jsonb_build_object('draft_ref', v_draft_ref)
           ELSE '{}'::jsonb
         END
  );

  RETURN v_number;
END;
$$;

COMMENT ON FUNCTION public.approve_quotation(uuid) IS
  '0199: approves a DRAFT quotation with at least one line — needs sales.quotations.approve; the approver may be its creator — and returns its number. When it still carries its draft reference (QD-####) the official number QT-YYYYMM#### is issued (next_quotation_number) in the same update; a quotation returned to draft keeps its number. Event approved {quote_number, draft_ref when issued}. Tokens quotation_approve_required, invalid_quotation, quotation_not_draft, quotation_has_no_lines (55000).';

REVOKE ALL ON FUNCTION public.approve_quotation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_quotation(uuid) TO authenticated;

-- ===========================================================================
-- 13. return_quotation_approval: «رجوع للتعديل» (decision 5)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.return_quotation_approval(p_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q public.quotations%ROWTYPE;
  v_note text;
BEGIN
  PERFORM public.assert_quotation_approve();

  SELECT * INTO v_q
  FROM public.quotations q
  WHERE q.id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_quotation' USING ERRCODE = '22023';
  END IF;
  IF v_q.status <> 'approved' THEN
    RAISE EXCEPTION 'quotation_not_approved'
      USING ERRCODE = '55000',
            HINT = 'Only an approved quotation is returned for editing.';
  END IF;
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  -- Back to draft: the official number stays, the approval and the client
  -- answer are cleared.
  UPDATE public.quotations
  SET status = 'draft',
      approved_at = NULL,
      approved_by = NULL,
      outcome = NULL,
      outcome_at = NULL,
      outcome_by = NULL,
      outcome_note = NULL
  WHERE id = p_id;

  PERFORM public.record_quotation_event(
    p_id, 'approval_returned',
    jsonb_build_object(
      'note', v_note,
      'approved_at', v_q.approved_at,
      'approved_by', v_q.approved_by,
      'outcome', v_q.outcome
    )
  );
END;
$$;

COMMENT ON FUNCTION public.return_quotation_approval(uuid, text) IS
  '0199: «رجوع للتعديل» — puts an APPROVED quotation back to draft (needs sales.quotations.approve): the official number is kept, the approval and the client answer are cleared; optional note (at most 500 characters). Event approval_returned {note, approved_at, approved_by, outcome}. Tokens quotation_approve_required, invalid_quotation, quotation_not_approved, invalid_note.';

REVOKE ALL ON FUNCTION public.return_quotation_approval(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_quotation_approval(uuid, text) TO authenticated;

-- ===========================================================================
-- 14. set_quotation_outcome: the client's answer (decision 5)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.set_quotation_outcome(p_id uuid, p_outcome text, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q public.quotations%ROWTYPE;
  v_outcome text;
  v_note text;
BEGIN
  PERFORM public.assert_sales_manage();

  SELECT * INTO v_q
  FROM public.quotations q
  WHERE q.id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_quotation' USING ERRCODE = '22023';
  END IF;
  IF v_q.status <> 'approved' THEN
    RAISE EXCEPTION 'quotation_not_approved'
      USING ERRCODE = '55000',
            HINT = 'The client answer is recorded on an approved quotation.';
  END IF;
  v_outcome := NULLIF(btrim(p_outcome), '');
  IF v_outcome IS NOT NULL AND v_outcome NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'invalid_outcome' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  IF v_outcome IS NULL THEN
    -- «مسح رد العميل»: nothing to clear = nothing recorded.
    IF v_q.outcome IS NULL THEN
      RETURN;
    END IF;
    UPDATE public.quotations
    SET outcome = NULL,
        outcome_at = NULL,
        outcome_by = NULL,
        outcome_note = NULL
    WHERE id = p_id;

    PERFORM public.record_quotation_event(
      p_id, 'outcome_cleared',
      jsonb_build_object('outcome', v_q.outcome, 'note', v_q.outcome_note)
    );
    RETURN;
  END IF;

  UPDATE public.quotations
  SET outcome = v_outcome,
      outcome_at = now(),
      outcome_by = auth.uid(),
      outcome_note = v_note
  WHERE id = p_id;

  PERFORM public.record_quotation_event(
    p_id, 'outcome_set',
    jsonb_build_object('outcome', v_outcome, 'note', v_note)
  );
END;
$$;

COMMENT ON FUNCTION public.set_quotation_outcome(uuid, text, text) IS
  '0199: records the client''s answer on an APPROVED quotation — accepted or rejected with an optional note (at most 500 characters; outcome_at / outcome_by; event outcome_set {outcome, note}) — or clears it with p_outcome NULL (event outcome_cleared; nothing when there is no answer). Needs sales.manage. Tokens sales_manage_required, invalid_quotation, quotation_not_approved, invalid_outcome, invalid_note.';

REVOKE ALL ON FUNCTION public.set_quotation_outcome(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_quotation_outcome(uuid, text, text) TO authenticated;

-- ===========================================================================
-- 15. delete_quotation: a draft under its draft reference (decision 5)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.delete_quotation(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q public.quotations%ROWTYPE;
BEGIN
  PERFORM public.assert_sales_manage();

  SELECT * INTO v_q
  FROM public.quotations q
  WHERE q.id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_quotation' USING ERRCODE = '22023';
  END IF;
  IF v_q.status <> 'draft' THEN
    RAISE EXCEPTION 'quotation_approved_locked'
      USING ERRCODE = '55000',
            HINT = 'An approved quotation is locked; return it to draft first.';
  END IF;
  -- An issued official number stays (the numbers stay contiguous, 0193's
  -- rule for supplier POs).
  IF v_q.quote_number !~ '^QD-[0-9]{4,}$' THEN
    RAISE EXCEPTION 'quotation_number_issued'
      USING ERRCODE = '55000',
            HINT = 'A quotation whose official number was issued cannot be deleted.';
  END IF;

  -- Lines, costs, terms and events cascade.
  DELETE FROM public.quotations WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION public.delete_quotation(uuid) IS
  '0199: deletes a DRAFT quotation that still carries its draft reference (QD-####) with its lines, costs, terms and events (cascade). Tokens sales_manage_required, invalid_quotation, quotation_approved_locked (approved), quotation_number_issued (a draft that holds an official number). Needs sales.manage.';

REVOKE ALL ON FUNCTION public.delete_quotation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_quotation(uuid) TO authenticated;

-- ===========================================================================
-- 16. copy_quotation: «نسخ العرض» (decision 5)
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
  -- draft counter.
  SELECT * INTO v_src
  FROM public.quotations q
  WHERE q.id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_quotation' USING ERRCODE = '22023';
  END IF;

  v_number := public.next_quotation_draft_ref();

  -- A new DRAFT dated today, valid for as many days as the source.
  INSERT INTO public.quotations (
    company_id, project_id, quote_number, status, issue_date, valid_until,
    notes, created_by
  ) VALUES (
    v_src.company_id, v_src.project_id, v_number, 'draft', v_today,
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
  '0199: «نسخ العرض» — a new DRAFT (new draft reference) from any quotation: the same company, project, notes, lines, costs and terms (the stored copies with their template_id), issue_date = the Saudi today, valid_until = today + the source''s validity in days. Event created {quote_number, line_count, copied_from, copied_from_number}. Returns the new id. Needs sales.manage. Tokens sales_manage_required, invalid_quotation.';

REVOKE ALL ON FUNCTION public.copy_quotation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_quotation(uuid) TO authenticated;

-- ===========================================================================
-- 17. quotation_list: one row per quotation with its computed state
-- ===========================================================================
CREATE OR REPLACE VIEW public.quotation_list
WITH (security_invoker = true)
AS
SELECT
  q.id,
  q.company_id,
  q.project_id,
  q.quote_number,
  q.status,
  q.issue_date,
  q.valid_until,
  q.notes,
  q.approved_at,
  q.approved_by,
  q.outcome,
  q.outcome_at,
  q.outcome_by,
  q.outcome_note,
  q.created_by,
  q.created_at,
  q.updated_at,
  co.name_ar AS company_name_ar,
  co.name_en AS company_name_en,
  pr.name_ar AS project_name_ar,
  pr.name_en AS project_name_en,
  cb.full_name AS created_by_name,
  ab.full_name AS approved_by_name,
  -- The client answer wins; «منتهي» = approved, no answer, valid_until
  -- before the Saudi today.
  CASE
    WHEN q.outcome = 'accepted' THEN 'accepted'
    WHEN q.outcome = 'rejected' THEN 'rejected'
    WHEN q.status = 'approved'
         AND q.valid_until < (now() AT TIME ZONE 'Asia/Riyadh')::date THEN 'expired'
    WHEN q.status = 'approved' THEN 'approved'
    ELSE 'draft'
  END AS state,
  COALESCE(ln.line_count, 0) AS line_count,
  ln.type_names
FROM public.quotations q
LEFT JOIN public.companies co ON co.id = q.company_id
LEFT JOIN public.projects pr ON pr.id = q.project_id
LEFT JOIN public.profile_names cb ON cb.id = q.created_by
LEFT JOIN public.profile_names ab ON ab.id = q.approved_by
LEFT JOIN LATERAL (
  SELECT
    count(*)::integer AS line_count,
    string_agg(l.equipment_type, '، ' ORDER BY l.position, l.id) AS type_names
  FROM public.quotation_lines l
  WHERE l.quotation_id = q.id
) ln ON true;

COMMENT ON VIEW public.quotation_list IS
  '0199: one row per quotation with every quotations column, the client company and project names, created_by_name / approved_by_name (profile_names), state (draft | approved | accepted | rejected | expired — the answer wins; expired = approved, no answer, valid_until before the Saudi today), line_count and type_names (the line types joined with «، » in position order). The quotations list and page. security_invoker: sales.view and the master-data policies apply as for the reader.';

REVOKE ALL ON public.quotation_list FROM PUBLIC, anon;
GRANT SELECT ON public.quotation_list TO authenticated;

-- ===========================================================================
-- 18. The closing guard
-- ===========================================================================
DO $$
DECLARE
  v_fn text;
  v_table text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions
    WHERE key = 'sales.quotations.approve'
      AND group_key = 'sales'
      AND enforced_in = 'database'
      AND NOT scoped
  ) THEN
    RAISE EXCEPTION '0199: the key sales.quotations.approve is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_key = 'admin'
      AND permission_key = 'sales.quotations.approve'
  ) THEN
    RAISE EXCEPTION '0199: the admin role does not hold sales.quotations.approve';
  END IF;

  -- No function of the feature is executable by anon or PUBLIC.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.save_quotation(uuid, uuid, uuid, date, date, text, jsonb, jsonb, uuid[], uuid[])',
    'public.approve_quotation(uuid)',
    'public.return_quotation_approval(uuid, text)',
    'public.set_quotation_outcome(uuid, text, text)',
    'public.delete_quotation(uuid)',
    'public.copy_quotation(uuid)',
    'public.next_quotation_number()',
    'public.next_quotation_draft_ref()',
    'public.assert_quotation_approve()',
    'public.record_quotation_event(uuid, text, jsonb)',
    'public.quotation_price_value(jsonb)',
    'public.normalise_quotation_term_template()'
  ]
  LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '0199: % is missing', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0199: % is executable by anon', v_fn;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_proc p,
           aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = to_regprocedure(v_fn)
        AND a.grantee = 0
        AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION '0199: % is executable by PUBLIC', v_fn;
    END IF;
  END LOOP;

  -- The internal helpers are not executable by authenticated either.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.next_quotation_number()',
    'public.next_quotation_draft_ref()',
    'public.assert_quotation_approve()',
    'public.record_quotation_event(uuid, text, jsonb)',
    'public.quotation_price_value(jsonb)',
    'public.normalise_quotation_term_template()'
  ]
  LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0199: % is executable by authenticated', v_fn;
    END IF;
  END LOOP;

  -- RLS is on for every table of the feature.
  FOREACH v_table IN ARRAY ARRAY[
    'public.quotation_term_templates',
    'public.quotations',
    'public.quotation_lines',
    'public.quotation_costs',
    'public.quotation_terms',
    'public.quotation_events',
    'public.quotation_number_sequence',
    'public.quotation_draft_sequence'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.oid = to_regclass(v_table)
        AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION '0199: row level security is off on %', v_table;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
