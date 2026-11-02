-- 0169: sales phase 1 — client purchase orders («PO العملاء»), the database
-- layer. Mirrors the supplier-PO layer of 0136–0167 on the same shared
-- document «كرت المعدة» (equipment_cards).
--
-- Owner decisions 2026-11-01 / 2026-11-02 (the mockups approved on /ui-kit,
-- src/screens/ui-kit/SalesMockup.tsx):
--   * a client PO = ONE company (the client) + ONE project; its identity is
--     the CLIENT's own PO number as received (free text, unique per company,
--     trimmed, no generated sequence), an issue date, an optional expiry
--     date, notes, status open / closed. NO approval workflow, NO attachment.
--   * its lines reference equipment_cards — the SAME card the supplier side
--     uses, so a card may carry one supplier line and one client line — with
--     the SALE price excluding VAT (NULL = unpriced), the price unit month /
--     day / hour on the LINE, the standard hours (default from the PO, 260)
--     and an optional contract quantity (a ceiling for the remaining-quantity
--     tracking of a later phase). A card sits on at most one OPEN client PO.
--   * the join rule is purchasing's: a unit joins a client PO only while it
--     is INSIDE that company and project right now (its latest movement is
--     an open site ENTRY there); the function reuses the unit's open card
--     for that company and project (the one the supplier side created,
--     matched by entry_log_id, else by period) or creates one behind the
--     scenes. NO same-entry-day rule (0148 is purchasing's): the units of
--     one client PO may have entered on different days.
--   * owned units (Al-Azani) join a client PO straight from the gate entry;
--     rented units join whether or not their supplier PO exists.
--   * permissions: `sales.view` / `sales.manage` (group sales, enforced in
--     the database), held by the admin role and by the new custom role
--     «المبيعات» (key sales). No hiding between the two sides (owner
--     2026-10-15): the sales role also reads purchasing (purchasing.view) and
--     the purchasing role reads sales (sales.view).
--
-- Rules (the 0136 shape): every write goes through the SECURITY DEFINER
-- functions below (no INSERT / UPDATE / DELETE policy on any sales table);
-- each checks auth.uid() and has_permission('sales.manage') first;
-- add_client_po_equipment serialises on the unit's advisory key
-- hashtextextended(equipment_id::text, 0), the key every movement function
-- takes; every editable table carries updated_at with the update_updated_at()
-- trigger and a line change touches its PO; the events are append-only.
--   Stable error tokens (the client maps them, never shows raw errors):
--     sales_manage_required                       42501
--     invalid_client_po / invalid_equipment /
--     invalid_company / invalid_project /
--     invalid_po_number / invalid_issue_date /
--     invalid_expiry_date / invalid_price /
--     invalid_rate_unit / invalid_standard_hours /
--     invalid_quantity / invalid_note /
--     invalid_notes / invalid_line                22023
--     duplicate_po_number                         23505
--     client_po_closed                            55000
--     equipment_not_at_po_project                 55000
--     card_overlap                                23P01
--     equipment_already_on_open_client_po         23505
-- Nothing here changes a movement, a photo, the master data, a supplier PO
-- or any existing policy except the SELECT policy of equipment_cards, which
-- the sales side now reads too.

-- ===========================================================================
-- A. The catalogue: the two sales keys, the admin, the custom role
-- ===========================================================================
INSERT INTO public.permissions (
  key, group_key, name_ar, name_en, description_ar, description_en,
  scoped, scopes, requires, admin_only, enforced_in, sort
) VALUES
  ('sales.view', 'sales',
   'المبيعات: عرض', 'Sales: view',
   'عرض اوامر شراء العملاء واسعار البيع وكروت المعدات.',
   'View client purchase orders, sale prices and equipment cards.',
   false, NULL, '{}', false, 'database', 1100),
  ('sales.manage', 'sales',
   'المبيعات: ادارة', 'Sales: manage',
   'انشاء اوامر شراء العملاء واضافة المعدات واسعار البيع وتعديلها واقفالها.',
   'Create client purchase orders, add equipment and sale prices, edit and close them.',
   false, NULL, ARRAY['sales.view'], false, 'database', 1110)
ON CONFLICT (key) DO NOTHING;

-- The admin role holds both. Since 0156 the role assignment is the only
-- mapping (the frozen legacy mapping of 0126 is gone), so one insert.
INSERT INTO public.role_permissions (role_key, permission_key, scope)
VALUES
  ('admin', 'sales.view', NULL),
  ('admin', 'sales.manage', NULL)
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- The custom role «المبيعات», assignable like any custom role (the 0126
-- `purchasing` role is the model): reads movements, reports and master
-- data, manages client POs, and reads the purchasing side of the cards.
INSERT INTO public.roles (key, name_ar, name_en, description_ar, description_en, is_system, is_active)
VALUES (
  'sales', 'المبيعات', 'Sales',
  'المبيعات: اوامر شراء العملاء واسعار البيع وكروت المعدات، مع قراءة الحركات والتقارير والبيانات والمشتريات.',
  'Sales: client purchase orders, sale prices and equipment cards, with reading of movements, reports, master data and purchasing.',
  false, true
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_key, permission_key, scope)
VALUES
  ('sales', 'movements.read', 'all'),
  ('sales', 'movements.export', NULL),
  ('sales', 'reports.view', 'all'),
  ('sales', 'inquiry.view', NULL),
  ('sales', 'equipment.read', NULL),
  ('sales', 'equipment.location.view', NULL),
  ('sales', 'drivers.read', NULL),
  ('sales', 'companies_projects.read', NULL),
  ('sales', 'lessors.read', NULL),
  ('sales', 'purchasing.view', NULL),
  ('sales', 'sales.view', NULL),
  ('sales', 'sales.manage', NULL),
  -- No hiding between the two sides (owner 2026-10-15): the purchasing role
  -- reads the sale prices too.
  ('purchasing', 'sales.view', NULL)
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- ===========================================================================
-- B. The shared card is read by both sides
-- ===========================================================================
DROP POLICY IF EXISTS select_equipment_cards ON public.equipment_cards;
CREATE POLICY select_equipment_cards ON public.equipment_cards
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('purchasing.view')) OR (SELECT public.has_permission('sales.view')));

COMMENT ON TABLE public.equipment_cards IS
  '0136 «كرت المعدة»: one unit for one company and project over a period (period_to NULL = open). The shared document movements, purchasing and sales link to; created only behind the scenes by add_supplier_po_equipment (0136) and add_client_po_equipment (0169) from the unit''s open site entry. Read by purchasing.view or sales.view; no direct write path.';

-- ===========================================================================
-- C. client_pos
-- ===========================================================================
CREATE TABLE public.client_pos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  -- The CLIENT's own number, as received; stored trimmed.
  po_number text NOT NULL
    CONSTRAINT client_pos_number_check
      CHECK (po_number = btrim(po_number) AND po_number <> '' AND char_length(po_number) <= 60),
  issue_date date NOT NULL,
  expiry_date date,
  standard_hours integer NOT NULL DEFAULT 260
    CONSTRAINT client_pos_standard_hours_check CHECK (standard_hours > 0),
  status text NOT NULL DEFAULT 'open'
    CONSTRAINT client_pos_status_check CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text
    CONSTRAINT client_pos_notes_check CHECK (char_length(notes) <= 1000),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_pos_expiry_check
    CHECK (expiry_date IS NULL OR expiry_date >= issue_date),
  CONSTRAINT client_pos_closed_at_check
    CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

-- One number per client: compared as upper(btrim(po_number)).
CREATE UNIQUE INDEX client_pos_company_number_unique
  ON public.client_pos (company_id, upper(btrim(po_number)));
CREATE INDEX client_pos_company_project_idx
  ON public.client_pos (company_id, project_id);
CREATE INDEX client_pos_status_issue_idx
  ON public.client_pos (status, issue_date DESC);
CREATE INDEX client_pos_updated_at_id_idx
  ON public.client_pos (updated_at DESC, id DESC);
CREATE INDEX client_pos_po_number_trgm_idx
  ON public.client_pos USING gin (po_number extensions.gin_trgm_ops);

COMMENT ON TABLE public.client_pos IS
  '0169: client purchase orders («PO العملاء», sales phase 1). One company (the client) + one project; the identity is the client''s own PO number (free text, unique per company on upper(btrim(po_number))); an issue date, an optional expiry date, the default standard hours of its lines (260), notes; status open / closed; no approval. Read by sales.view; written only by create_client_po, update_client_po and close_client_po.';
COMMENT ON COLUMN public.client_pos.po_number IS
  '0169: the CLIENT''s own PO number as received (e.g. PO20241200550), trimmed, at most 60 characters; unique per company (client_pos_company_number_unique). Never generated.';
COMMENT ON COLUMN public.client_pos.standard_hours IS
  '0169: the PO''s standard monthly hours (default 260), copied to each new line (editable per line).';
COMMENT ON COLUMN public.client_pos.expiry_date IS
  '0169: the optional end of the client PO, on or after the issue date. Informational: closing is explicit (close_client_po).';
COMMENT ON COLUMN public.client_pos.updated_at IS
  '0169: the time of the PO''s latest change — its own row or any of its lines (touch_client_po_from_line).';

ALTER TABLE public.client_pos ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_client_pos ON public.client_pos
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('sales.view')));

CREATE TRIGGER client_pos_updated_at
  BEFORE UPDATE ON public.client_pos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================================================
-- D. client_po_equipment (the lines)
-- ===========================================================================
CREATE TABLE public.client_po_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_po_id uuid NOT NULL REFERENCES public.client_pos(id) ON DELETE CASCADE,
  equipment_card_id uuid NOT NULL REFERENCES public.equipment_cards(id) ON DELETE RESTRICT,
  -- The SALE price excluding VAT; NULL = unpriced («تحتاج سعر»).
  price numeric(12, 2)
    CONSTRAINT client_po_equipment_price_check CHECK (price IS NULL OR price >= 0),
  rate_unit text NOT NULL DEFAULT 'month'
    CONSTRAINT client_po_equipment_rate_unit_check CHECK (rate_unit IN ('month', 'day', 'hour')),
  standard_hours integer NOT NULL
    CONSTRAINT client_po_equipment_standard_hours_check CHECK (standard_hours > 0),
  -- The optional contract quantity, in the line's unit: a ceiling.
  quantity numeric(12, 2)
    CONSTRAINT client_po_equipment_quantity_check CHECK (quantity IS NULL OR quantity > 0),
  note text
    CONSTRAINT client_po_equipment_note_check CHECK (char_length(note) <= 500),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_po_equipment_unique UNIQUE (client_po_id, equipment_card_id)
);

CREATE INDEX client_po_equipment_card_idx
  ON public.client_po_equipment (equipment_card_id);

COMMENT ON TABLE public.client_po_equipment IS
  '0169: one line per equipment card on a client PO with the SALE price excluding VAT (NULL = unpriced), its unit (month / day / hour), the line''s standard hours (from the PO at insert, editable), an optional contract quantity in that unit (a ceiling) and a note. A card sits on at most one OPEN client PO (trigger). Read by sales.view; written only by add_client_po_equipment and update_client_po_equipment.';
COMMENT ON COLUMN public.client_po_equipment.rate_unit IS
  '0169: the unit of the line''s sale price — month, day or hour. Independent of the supplier line''s unit on the same card.';
COMMENT ON COLUMN public.client_po_equipment.standard_hours IS
  '0169: the line''s standard monthly hours, copied from the PO at insert and editable per line.';
COMMENT ON COLUMN public.client_po_equipment.quantity IS
  '0169: the optional contract quantity in the line''s unit (months, days or hours), a ceiling for the remaining-quantity tracking of a later phase. NULL = no ceiling.';

ALTER TABLE public.client_po_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_client_po_equipment ON public.client_po_equipment
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('sales.view')));

CREATE TRIGGER client_po_equipment_updated_at
  BEFORE UPDATE ON public.client_po_equipment
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- A card is on at most one OPEN client PO (the 0136 rule of the supplier
-- side, mirrored). Enforced here, not only in the function, so no other
-- write path can break it.
CREATE OR REPLACE FUNCTION public.enforce_client_po_equipment_single_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.client_po_equipment l
    JOIN public.client_pos p ON p.id = l.client_po_id
    WHERE l.equipment_card_id = NEW.equipment_card_id
      AND l.id <> NEW.id
      AND p.status = 'open'
  ) AND EXISTS (
    SELECT 1 FROM public.client_pos p
    WHERE p.id = NEW.client_po_id AND p.status = 'open'
  ) THEN
    RAISE EXCEPTION 'equipment_already_on_open_client_po'
      USING ERRCODE = '23505',
            HINT = 'This equipment card already sits on another open client PO.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_client_po_equipment_single_open() IS
  '0169: BEFORE INSERT / UPDATE trigger of client_po_equipment — a card sits on at most one OPEN client PO (equipment_already_on_open_client_po).';

REVOKE ALL ON FUNCTION public.enforce_client_po_equipment_single_open()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER client_po_equipment_single_open
  BEFORE INSERT OR UPDATE OF equipment_card_id, client_po_id
  ON public.client_po_equipment
  FOR EACH ROW EXECUTE FUNCTION public.enforce_client_po_equipment_single_open();

-- A line's change touches its PO (the 0146 rule). SECURITY DEFINER because
-- client_pos has no UPDATE policy; it only sets updated_at of the PO the
-- changed line belongs to.
CREATE OR REPLACE FUNCTION public.touch_client_po_from_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.client_pos SET updated_at = now()
    WHERE id = OLD.client_po_id;
    RETURN OLD;
  END IF;
  UPDATE public.client_pos SET updated_at = now()
  WHERE id = NEW.client_po_id;
  IF TG_OP = 'UPDATE' AND OLD.client_po_id IS DISTINCT FROM NEW.client_po_id THEN
    UPDATE public.client_pos SET updated_at = now()
    WHERE id = OLD.client_po_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.touch_client_po_from_line() IS
  '0169: AFTER INSERT / UPDATE / DELETE trigger of client_po_equipment — moves client_pos.updated_at of the line''s PO, so a line change counts as a change of the PO.';

REVOKE ALL ON FUNCTION public.touch_client_po_from_line()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER client_po_equipment_touch_po
  AFTER INSERT OR UPDATE OR DELETE ON public.client_po_equipment
  FOR EACH ROW EXECUTE FUNCTION public.touch_client_po_from_line();

-- PostgREST computed column: how many lines still need a price (the
-- «تحتاج اسعار» badge and filter, as unpriced_count(supplier_pos) of 0138).
CREATE OR REPLACE FUNCTION public.unpriced_count(po public.client_pos)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
  FROM public.client_po_equipment l
  WHERE l.client_po_id = po.id
    AND l.price IS NULL;
$$;

COMMENT ON FUNCTION public.unpriced_count(public.client_pos) IS
  '0169: PostgREST computed column of client_pos — how many of the PO''s lines still have no price (the «تحتاج اسعار» badge and filter). Runs as the caller: RLS of the lines applies.';

REVOKE ALL ON FUNCTION public.unpriced_count(public.client_pos) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpriced_count(public.client_pos) TO authenticated;

-- ===========================================================================
-- E. client_po_events (the append-only audit)
-- ===========================================================================
CREATE TABLE public.client_po_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Insertion order within one created_at (the PO and its lines are created
  -- in one transaction, so their events share the timestamp; 0141).
  seq bigint GENERATED BY DEFAULT AS IDENTITY,
  client_po_id uuid NOT NULL REFERENCES public.client_pos(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CONSTRAINT client_po_events_type_check CHECK (
      event_type IN ('created', 'updated', 'equipment_added', 'line_updated', 'price_changed', 'closed')
    ),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- The actor's name at the time (profile_names), so the log reads without
  -- a join and survives a deleted profile.
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX client_po_events_po_seq_idx
  ON public.client_po_events (client_po_id, created_at, seq);

COMMENT ON TABLE public.client_po_events IS
  '0169: append-only audit of a client PO (created, updated, equipment_added, line_updated, price_changed, closed) with the actor and the actor''s name at the time. Read by sales.view; written only by the sales functions; no update or delete path. The PO page orders by (created_at, seq).';
COMMENT ON COLUMN public.client_po_events.seq IS
  '0169: insertion order within the same created_at (events of one transaction share the timestamp).';

ALTER TABLE public.client_po_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_client_po_events ON public.client_po_events
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('sales.view')));

-- ===========================================================================
-- F. The write functions
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.assert_sales_manage()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('sales.manage') THEN
    RAISE EXCEPTION 'sales_manage_required'
      USING ERRCODE = '42501',
            HINT = 'Managing client purchase orders needs the sales.manage permission.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_sales_manage() IS
  '0169: raises sales_manage_required (42501) unless the caller is signed in and holds sales.manage. Called first by every sales write function; not callable by clients.';

REVOKE ALL ON FUNCTION public.assert_sales_manage()
  FROM PUBLIC, anon, authenticated;

-- One event row with the actor and the actor's name at the time.
CREATE OR REPLACE FUNCTION public.record_client_po_event(
  p_client_po_id uuid,
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

  INSERT INTO public.client_po_events (client_po_id, event_type, payload, actor_id, actor_name)
  VALUES (p_client_po_id, p_event_type, COALESCE(p_payload, '{}'::jsonb), auth.uid(), v_actor_name);
END;
$$;

COMMENT ON FUNCTION public.record_client_po_event(uuid, text, jsonb) IS
  '0169: appends one client_po_events row for the signed-in actor with the actor''s name from profile_names. Called only by the sales write functions; not callable by clients.';

REVOKE ALL ON FUNCTION public.record_client_po_event(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- add_client_po_equipment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_client_po_equipment(
  p_client_po_id uuid,
  p_equipment_id uuid,
  p_price numeric DEFAULT NULL,
  p_rate_unit text DEFAULT 'month',
  p_standard_hours integer DEFAULT NULL,
  p_quantity numeric DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_po public.client_pos%ROWTYPE;
  v_card_id uuid;
  v_card_created boolean := false;
  v_line_id uuid;
  v_last public.entry_exit_logs%ROWTYPE;
  v_entry_date date;
  v_rate_unit text;
  v_standard_hours integer;
  v_note text;
BEGIN
  PERFORM public.assert_sales_manage();

  -- The PO row lock: every write to the PO and its lines takes it.
  SELECT * INTO v_po
  FROM public.client_pos p
  WHERE p.id = p_client_po_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_client_po' USING ERRCODE = '22023';
  END IF;
  IF v_po.status <> 'open' THEN
    RAISE EXCEPTION 'client_po_closed' USING ERRCODE = '55000';
  END IF;

  IF p_equipment_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.equipment e WHERE e.id = p_equipment_id) THEN
    RAISE EXCEPTION 'invalid_equipment' USING ERRCODE = '22023';
  END IF;
  -- The sale price is optional («تحتاج سعر» while NULL); when given it is
  -- numeric(12, 2) >= 0.
  IF p_price IS NOT NULL AND (p_price < 0 OR p_price > 9999999999.99) THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  -- The price unit: month, day or hour; nothing given = month.
  v_rate_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), 'month');
  IF v_rate_unit NOT IN ('month', 'day', 'hour') THEN
    RAISE EXCEPTION 'invalid_rate_unit' USING ERRCODE = '22023';
  END IF;
  -- The line's standard hours: given, else the PO's default.
  v_standard_hours := COALESCE(p_standard_hours, v_po.standard_hours);
  IF v_standard_hours IS NULL OR v_standard_hours <= 0 THEN
    RAISE EXCEPTION 'invalid_standard_hours' USING ERRCODE = '22023';
  END IF;
  -- The contract quantity: optional, positive, in the line's unit.
  IF p_quantity IS NOT NULL AND (p_quantity <= 0 OR p_quantity > 9999999999.99) THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  -- The unit's advisory key (the one every movement function takes), so two
  -- concurrent calls never create two cards for one unit.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0));

  -- The join rule of purchasing (0137): the unit must be inside the PO's
  -- company and project right now — its latest movement, in the chain's own
  -- order, is an open site ENTRY there. The key above is the sequence
  -- trigger's, so a movement being recorded at the same moment is serialised
  -- against this read.
  SELECT l.* INTO v_last
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
  IF NOT FOUND
     OR v_last.movement_type <> 'entry'
     OR v_last.movement_context <> 'site'
     OR v_last.company_id IS DISTINCT FROM v_po.company_id
     OR v_last.project_id IS DISTINCT FROM v_po.project_id THEN
    RAISE EXCEPTION 'equipment_not_at_po_project'
      USING ERRCODE = '55000',
            HINT = 'The equipment is not inside the PO''s company and project right now.';
  END IF;
  -- The card period starts on the day the unit entered (Saudi time). No
  -- same-day rule here: each line's period is its own card's.
  v_entry_date := (v_last.recorded_at AT TIME ZONE 'Asia/Riyadh')::date;

  -- Reuse the unit's card for this company and project: the one created
  -- from this very entry (the supplier side's, 0137), else the one whose
  -- period covers the entry date (an open end covers everything after it).
  SELECT c.id INTO v_card_id
  FROM public.equipment_cards c
  WHERE c.equipment_id = p_equipment_id
    AND c.company_id = v_po.company_id
    AND c.project_id = v_po.project_id
    AND c.entry_log_id = v_last.id
  LIMIT 1;

  IF v_card_id IS NULL THEN
    SELECT c.id INTO v_card_id
    FROM public.equipment_cards c
    WHERE c.equipment_id = p_equipment_id
      AND c.company_id = v_po.company_id
      AND c.project_id = v_po.project_id
      AND c.period_from <= v_entry_date
      AND (c.period_to IS NULL OR c.period_to >= v_entry_date)
    ORDER BY c.period_from DESC
    LIMIT 1;
  END IF;

  IF v_card_id IS NULL THEN
    -- Otherwise open a new card from the entry date, linked to the entry,
    -- with this line's unit and standard hours as the card's shared fields.
    BEGIN
      INSERT INTO public.equipment_cards (
        equipment_id, company_id, project_id, period_from, rate_unit, standard_hours,
        created_by, entry_log_id
      ) VALUES (
        p_equipment_id, v_po.company_id, v_po.project_id, v_entry_date, v_rate_unit, v_standard_hours,
        auth.uid(), v_last.id
      )
      RETURNING id INTO v_card_id;
      v_card_created := true;
    EXCEPTION
      WHEN exclusion_violation THEN
        -- Another card of this unit (another company or project) already
        -- covers the entry date.
        RAISE EXCEPTION 'card_overlap'
          USING ERRCODE = '23P01',
                HINT = 'The equipment already has a card for another company or project in this period.';
    END;
  ELSE
    -- A reused card without a link gets this entry; a link is never
    -- overwritten (0137).
    UPDATE public.equipment_cards
    SET entry_log_id = v_last.id
    WHERE id = v_card_id AND entry_log_id IS NULL;
  END IF;

  -- A card sits on at most one OPEN client PO: this PO (the unique
  -- constraint) or another (the trigger); both raise the same token.
  IF EXISTS (
    SELECT 1
    FROM public.client_po_equipment l
    JOIN public.client_pos p ON p.id = l.client_po_id
    WHERE l.equipment_card_id = v_card_id
      AND p.status = 'open'
  ) THEN
    RAISE EXCEPTION 'equipment_already_on_open_client_po'
      USING ERRCODE = '23505',
            HINT = 'This equipment already sits on an open client PO for this company and project.';
  END IF;

  BEGIN
    INSERT INTO public.client_po_equipment (
      client_po_id, equipment_card_id, price, rate_unit, standard_hours, quantity, note, created_by
    ) VALUES (
      v_po.id, v_card_id, p_price, v_rate_unit, v_standard_hours, p_quantity, v_note, auth.uid()
    )
    RETURNING id INTO v_line_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'equipment_already_on_open_client_po'
        USING ERRCODE = '23505',
              HINT = 'This equipment is already on this PO.';
  END;

  PERFORM public.record_client_po_event(
    v_po.id, 'equipment_added',
    jsonb_build_object(
      'line_id', v_line_id,
      'equipment_id', p_equipment_id,
      'equipment_card_id', v_card_id,
      'card_created', v_card_created,
      'price', p_price,
      'rate_unit', v_rate_unit,
      'standard_hours', v_standard_hours,
      'quantity', p_quantity,
      'entry_log_id', v_last.id
    )
  );

  RETURN v_line_id;
END;
$$;

COMMENT ON FUNCTION public.add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text) IS
  '0169: adds a unit to an OPEN client PO with an optional sale price (excluding VAT) per month / day / hour (p_rate_unit, default month), the line''s standard hours (p_standard_hours, NULL = the PO''s default), an optional contract quantity and a note, only while the unit is inside the PO''s company and project (its latest movement is an open site entry there: equipment_not_at_po_project), reusing the unit''s card for that company and project (by entry_log_id, else by period) or creating it from that entry''s Saudi day. A card sits on at most one open client PO (equipment_already_on_open_client_po). Serialises on the unit''s advisory key. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_client_po_equipment(uuid, uuid, numeric, text, integer, numeric, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- create_client_po
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_client_po(
  p_company_id uuid,
  p_project_id uuid,
  p_po_number text,
  p_issue_date date,
  p_expiry_date date DEFAULT NULL,
  p_standard_hours integer DEFAULT 260,
  p_notes text DEFAULT NULL,
  p_equipment jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_number text;
  v_standard_hours integer;
  v_notes text;
  v_item jsonb;
BEGIN
  PERFORM public.assert_sales_manage();

  IF p_company_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'invalid_company' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id) THEN
    RAISE EXCEPTION 'invalid_project' USING ERRCODE = '22023';
  END IF;
  -- The client's own number: trimmed, non-empty, at most 60 characters.
  v_number := NULLIF(btrim(p_po_number), '');
  IF v_number IS NULL OR char_length(v_number) > 60 THEN
    RAISE EXCEPTION 'invalid_po_number' USING ERRCODE = '22023';
  END IF;
  -- Unique per client company, compared as upper(btrim()).
  IF EXISTS (
    SELECT 1 FROM public.client_pos p
    WHERE p.company_id = p_company_id
      AND upper(btrim(p.po_number)) = upper(v_number)
  ) THEN
    RAISE EXCEPTION 'duplicate_po_number'
      USING ERRCODE = '23505',
            HINT = 'This client already has a PO with this number.';
  END IF;
  IF p_issue_date IS NULL THEN
    RAISE EXCEPTION 'invalid_issue_date' USING ERRCODE = '22023';
  END IF;
  IF p_expiry_date IS NOT NULL AND p_expiry_date < p_issue_date THEN
    RAISE EXCEPTION 'invalid_expiry_date' USING ERRCODE = '22023';
  END IF;
  v_standard_hours := COALESCE(p_standard_hours, 260);
  IF v_standard_hours <= 0 THEN
    RAISE EXCEPTION 'invalid_standard_hours' USING ERRCODE = '22023';
  END IF;
  v_notes := NULLIF(btrim(p_notes), '');
  IF char_length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023';
  END IF;
  IF p_equipment IS NOT NULL AND jsonb_typeof(p_equipment) <> 'array' THEN
    RAISE EXCEPTION 'invalid_equipment' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.client_pos (
      company_id, project_id, po_number, issue_date, expiry_date, standard_hours,
      notes, created_by
    ) VALUES (
      p_company_id, p_project_id, v_number, p_issue_date, p_expiry_date, v_standard_hours,
      v_notes, auth.uid()
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- A concurrent creation with the same number for the same client.
      RAISE EXCEPTION 'duplicate_po_number'
        USING ERRCODE = '23505',
              HINT = 'This client already has a PO with this number.';
  END;

  PERFORM public.record_client_po_event(
    v_id, 'created',
    jsonb_build_object(
      'po_number', v_number,
      'company_id', p_company_id,
      'project_id', p_project_id,
      'issue_date', p_issue_date,
      'expiry_date', p_expiry_date,
      'standard_hours', v_standard_hours
    )
  );

  -- The equipment, in the same transaction: every line passes the rules of
  -- add_client_po_equipment or the whole call is rolled back. Each item:
  -- {"equipment_id": uuid, "price": number|null, "rate_unit":
  -- "month"|"day"|"hour"|null, "standard_hours": integer|null, "quantity":
  -- number|null, "note": text|null}.
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_equipment, '[]'::jsonb))
  LOOP
    PERFORM public.add_client_po_equipment(
      v_id,
      NULLIF(v_item->>'equipment_id', '')::uuid,
      NULLIF(v_item->>'price', '')::numeric,
      NULLIF(v_item->>'rate_unit', ''),
      NULLIF(v_item->>'standard_hours', '')::integer,
      NULLIF(v_item->>'quantity', '')::numeric,
      v_item->>'note'
    );
  END LOOP;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.create_client_po(uuid, uuid, text, date, date, integer, text, jsonb) IS
  '0169: creates an open client PO for one company and project under the client''s own number (trimmed, unique per company: duplicate_po_number), with its issue date, optional expiry date (invalid_expiry_date when before the issue date), default standard hours (260) and notes, and, in the same transaction, its lines (p_equipment: [{equipment_id, price|null, rate_unit month|day|hour, standard_hours|null, quantity|null, note}]) through add_client_po_equipment, so a unit not inside the project rolls the whole call back. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.create_client_po(uuid, uuid, text, date, date, integer, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client_po(uuid, uuid, text, date, date, integer, text, jsonb)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- update_client_po
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_client_po(
  p_client_po_id uuid,
  p_issue_date date,
  p_expiry_date date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_po public.client_pos%ROWTYPE;
  v_notes text;
BEGIN
  PERFORM public.assert_sales_manage();

  SELECT * INTO v_po
  FROM public.client_pos p
  WHERE p.id = p_client_po_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_client_po' USING ERRCODE = '22023';
  END IF;
  IF v_po.status <> 'open' THEN
    RAISE EXCEPTION 'client_po_closed' USING ERRCODE = '55000';
  END IF;

  IF p_issue_date IS NULL THEN
    RAISE EXCEPTION 'invalid_issue_date' USING ERRCODE = '22023';
  END IF;
  IF p_expiry_date IS NOT NULL AND p_expiry_date < p_issue_date THEN
    RAISE EXCEPTION 'invalid_expiry_date' USING ERRCODE = '22023';
  END IF;
  v_notes := NULLIF(btrim(p_notes), '');
  IF char_length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023';
  END IF;

  IF p_issue_date = v_po.issue_date
     AND p_expiry_date IS NOT DISTINCT FROM v_po.expiry_date
     AND v_notes IS NOT DISTINCT FROM v_po.notes THEN
    RETURN;
  END IF;

  UPDATE public.client_pos
  SET issue_date = p_issue_date,
      expiry_date = p_expiry_date,
      notes = v_notes
  WHERE id = p_client_po_id;

  PERFORM public.record_client_po_event(
    p_client_po_id, 'updated',
    jsonb_build_object(
      'old_issue_date', v_po.issue_date,
      'new_issue_date', p_issue_date,
      'old_expiry_date', v_po.expiry_date,
      'new_expiry_date', p_expiry_date,
      'old_notes', v_po.notes,
      'new_notes', v_notes
    )
  );
END;
$$;

COMMENT ON FUNCTION public.update_client_po(uuid, date, date, text) IS
  '0169: changes the issue date, the expiry date (NULL = none) and the notes of an OPEN client PO and records old and new (event updated). The company, the project and the client''s number never change. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.update_client_po(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_client_po(uuid, date, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- update_client_po_equipment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_client_po_equipment(
  p_line_id uuid,
  p_price numeric,
  p_rate_unit text DEFAULT NULL,
  p_standard_hours integer DEFAULT NULL,
  p_quantity numeric DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line public.client_po_equipment%ROWTYPE;
  v_status text;
  v_equipment_id uuid;
  v_note text;
  v_price_changed boolean;
  v_rate_unit text;
  v_standard_hours integer;
BEGIN
  PERFORM public.assert_sales_manage();

  SELECT * INTO v_line
  FROM public.client_po_equipment l
  WHERE l.id = p_line_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = '22023';
  END IF;

  SELECT p.status INTO v_status
  FROM public.client_pos p
  WHERE p.id = v_line.client_po_id
  FOR UPDATE;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'client_po_closed' USING ERRCODE = '55000';
  END IF;

  -- NULL = «تحتاج سعر»: the price is a value, not "unchanged".
  IF p_price IS NOT NULL AND (p_price < 0 OR p_price > 9999999999.99) THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  -- The unit and the standard hours are NOT NULL on the line: nothing given
  -- keeps the line's own.
  v_rate_unit := COALESCE(NULLIF(btrim(p_rate_unit), ''), v_line.rate_unit);
  IF v_rate_unit NOT IN ('month', 'day', 'hour') THEN
    RAISE EXCEPTION 'invalid_rate_unit' USING ERRCODE = '22023';
  END IF;
  v_standard_hours := COALESCE(p_standard_hours, v_line.standard_hours);
  IF v_standard_hours <= 0 THEN
    RAISE EXCEPTION 'invalid_standard_hours' USING ERRCODE = '22023';
  END IF;
  -- The quantity and the note are values: NULL clears the ceiling / note.
  IF p_quantity IS NOT NULL AND (p_quantity <= 0 OR p_quantity > 9999999999.99) THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(p_note), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;

  v_price_changed := p_price IS DISTINCT FROM v_line.price;
  IF NOT v_price_changed
     AND v_rate_unit = v_line.rate_unit
     AND v_standard_hours = v_line.standard_hours
     AND p_quantity IS NOT DISTINCT FROM v_line.quantity
     AND v_note IS NOT DISTINCT FROM v_line.note THEN
    RETURN;
  END IF;

  SELECT c.equipment_id INTO v_equipment_id
  FROM public.equipment_cards c
  WHERE c.id = v_line.equipment_card_id;

  UPDATE public.client_po_equipment
  SET price = p_price,
      rate_unit = v_rate_unit,
      standard_hours = v_standard_hours,
      quantity = p_quantity,
      note = v_note
  WHERE id = v_line.id;

  PERFORM public.record_client_po_event(
    v_line.client_po_id,
    CASE WHEN v_price_changed THEN 'price_changed' ELSE 'line_updated' END,
    jsonb_build_object(
      'line_id', v_line.id,
      'equipment_id', v_equipment_id,
      'old_price', v_line.price,
      'new_price', p_price,
      'old_rate_unit', v_line.rate_unit,
      'new_rate_unit', v_rate_unit,
      'old_standard_hours', v_line.standard_hours,
      'new_standard_hours', v_standard_hours,
      'old_quantity', v_line.quantity,
      'new_quantity', p_quantity,
      'old_note', v_line.note,
      'new_note', v_note
    )
  );
END;
$$;

COMMENT ON FUNCTION public.update_client_po_equipment(uuid, numeric, text, integer, numeric, text) IS
  '0169: sets the sale price (NULL = unpriced), the price unit (p_rate_unit month|day|hour, NULL = unchanged), the standard hours (NULL = unchanged), the contract quantity (NULL = no ceiling) and the note of a line of an OPEN client PO in one call; a price change is the event price_changed, any other change is line_updated; the payload carries old and new. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.update_client_po_equipment(uuid, numeric, text, integer, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_client_po_equipment(uuid, numeric, text, integer, numeric, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- close_client_po
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_client_po(p_client_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM public.assert_sales_manage();

  SELECT p.status INTO v_status
  FROM public.client_pos p
  WHERE p.id = p_client_po_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_client_po' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'client_po_closed' USING ERRCODE = '55000';
  END IF;

  UPDATE public.client_pos
  SET status = 'closed', closed_at = now(), closed_by = auth.uid()
  WHERE id = p_client_po_id;

  PERFORM public.record_client_po_event(p_client_po_id, 'closed', '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.close_client_po(uuid) IS
  '0169: closes an open client PO (closed_at, closed_by; its lines stay readable, no further line or price change) and records the event closed. Needs sales.manage.';

REVOKE ALL ON FUNCTION public.close_client_po(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_client_po(uuid) TO authenticated;

-- ===========================================================================
-- G. sales_po_units: one row per client PO line (the «حسب المعدات» list)
-- ===========================================================================
-- The 0167 shape: a client_po_equipment line flattened with its PO, the PO's
-- company and project, the unit, its card period and, when the same card
-- carries a supplier line, that supplier side (the open supplier PO's line
-- first, else the latest). security_invoker: sales.view for the client
-- tables, purchasing.view for the supplier side (NULL without it), the
-- master-data policies for the rest (LEFT JOINs, so a line never drops out).
CREATE OR REPLACE VIEW public.sales_po_units
WITH (security_invoker = true)
AS
SELECT
  -- The line.
  l.id AS line_id,
  l.price,
  l.rate_unit,
  l.standard_hours,
  l.quantity,
  l.note AS line_note,
  l.created_at AS line_created_at,
  l.updated_at,
  (l.price IS NOT NULL) AS is_priced,
  -- The PO.
  p.id AS client_po_id,
  p.po_number,
  p.status AS po_status,
  p.issue_date,
  p.expiry_date,
  p.standard_hours AS po_standard_hours,
  -- The PO's company (the client) and project.
  p.company_id,
  co.name_ar AS company_name_ar,
  co.name_en AS company_name_en,
  p.project_id,
  pr.name_ar AS project_name_ar,
  pr.name_en AS project_name_en,
  -- The unit and its card.
  c.id AS equipment_card_id,
  c.equipment_id,
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.type_search AS equipment_type_search,
  e.plate_number AS equipment_plate_number,
  e.plate_digits AS equipment_plate_digits,
  e.chassis_number AS equipment_chassis_number,
  e.ownership_status AS equipment_ownership_status,
  e.lessor_id AS equipment_lessor_id,
  ls.name AS equipment_lessor_name,
  c.period_from AS card_period_from,
  c.period_to AS card_period_to,
  -- The supplier side of the same card, when present.
  sp.supplier_po_id,
  sp.supplier_po_number,
  sp.supplier_po_status,
  sp.supplier_price,
  sp.supplier_rate_unit
FROM public.client_po_equipment l
JOIN public.client_pos p ON p.id = l.client_po_id
JOIN public.equipment_cards c ON c.id = l.equipment_card_id
LEFT JOIN public.equipment e ON e.id = c.equipment_id
LEFT JOIN public.lessors ls ON ls.id = e.lessor_id
LEFT JOIN public.companies co ON co.id = p.company_id
LEFT JOIN public.projects pr ON pr.id = p.project_id
LEFT JOIN LATERAL (
  SELECT
    sp2.id AS supplier_po_id,
    sp2.po_number AS supplier_po_number,
    sp2.status AS supplier_po_status,
    sl.price AS supplier_price,
    sl.rate_unit AS supplier_rate_unit
  FROM public.supplier_po_equipment sl
  JOIN public.supplier_pos sp2 ON sp2.id = sl.supplier_po_id
  WHERE sl.equipment_card_id = c.id
  ORDER BY (sp2.status = 'open') DESC, sp2.created_at DESC, sp2.id DESC
  LIMIT 1
) sp ON true;

COMMENT ON VIEW public.sales_po_units IS
  '0169: one row per client PO line (client_po_equipment) with its PO (number, status, issue / expiry date, standard hours), the PO''s company and project, the unit, its card period and the supplier side of the same card when present (supplier_po_id, supplier_po_number, supplier_po_status, supplier_price, supplier_rate_unit: the open supplier PO''s line, else the latest). The «حسب المعدات» view of the client PO list. security_invoker: sales.view, purchasing.view and the master-data policies apply as for the reader.';

REVOKE ALL ON public.sales_po_units FROM PUBLIC, anon;
GRANT SELECT ON public.sales_po_units TO authenticated;

-- ===========================================================================
-- H. sales_equipment_cards: one row per card with both sides
-- ===========================================================================
-- «قائمة كروت المعدات» and «صفحة كرت المعدة»: every equipment card with the
-- unit, the company and project, the period, the entry it was created from
-- and, on each side, the line of the OPEN PO first, else the latest.
CREATE OR REPLACE VIEW public.sales_equipment_cards
WITH (security_invoker = true)
AS
SELECT
  -- The card.
  c.id AS card_id,
  c.equipment_id,
  c.company_id,
  c.project_id,
  c.period_from,
  c.period_to,
  (c.period_to IS NULL) AS is_open,
  c.rate_unit,
  c.standard_hours,
  c.note,
  c.entry_log_id,
  el.recorded_at AS entry_at,
  c.created_at,
  c.updated_at,
  -- The unit.
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.type_search AS equipment_type_search,
  e.plate_number AS equipment_plate_number,
  e.plate_digits AS equipment_plate_digits,
  e.chassis_number AS equipment_chassis_number,
  e.ownership_status AS equipment_ownership_status,
  e.lessor_id AS equipment_lessor_id,
  ls.name AS equipment_lessor_name,
  -- The company (the client) and the project.
  co.name_ar AS company_name_ar,
  co.name_en AS company_name_en,
  pr.name_ar AS project_name_ar,
  pr.name_en AS project_name_en,
  -- The client side.
  cl.client_line_id,
  cl.client_po_id,
  cl.client_po_number,
  cl.client_po_status,
  cl.client_price,
  cl.client_rate_unit,
  cl.client_standard_hours,
  cl.client_quantity,
  (cl.client_po_id IS NOT NULL AND cl.client_po_status = 'open') AS has_client_po,
  -- The supplier side.
  sp.supplier_line_id,
  sp.supplier_po_id,
  sp.supplier_po_number,
  sp.supplier_po_status,
  sp.supplier_price,
  sp.supplier_rate_unit,
  (sp.supplier_po_id IS NOT NULL AND sp.supplier_po_status = 'open') AS has_supplier_po
FROM public.equipment_cards c
LEFT JOIN public.equipment e ON e.id = c.equipment_id
LEFT JOIN public.lessors ls ON ls.id = e.lessor_id
LEFT JOIN public.companies co ON co.id = c.company_id
LEFT JOIN public.projects pr ON pr.id = c.project_id
LEFT JOIN public.entry_exit_logs el ON el.id = c.entry_log_id
LEFT JOIN LATERAL (
  SELECT
    l.id AS client_line_id,
    p.id AS client_po_id,
    p.po_number AS client_po_number,
    p.status AS client_po_status,
    l.price AS client_price,
    l.rate_unit AS client_rate_unit,
    l.standard_hours AS client_standard_hours,
    l.quantity AS client_quantity
  FROM public.client_po_equipment l
  JOIN public.client_pos p ON p.id = l.client_po_id
  WHERE l.equipment_card_id = c.id
  ORDER BY (p.status = 'open') DESC, p.created_at DESC, p.id DESC
  LIMIT 1
) cl ON true
LEFT JOIN LATERAL (
  SELECT
    sl.id AS supplier_line_id,
    sp2.id AS supplier_po_id,
    sp2.po_number AS supplier_po_number,
    sp2.status AS supplier_po_status,
    sl.price AS supplier_price,
    sl.rate_unit AS supplier_rate_unit
  FROM public.supplier_po_equipment sl
  JOIN public.supplier_pos sp2 ON sp2.id = sl.supplier_po_id
  WHERE sl.equipment_card_id = c.id
  ORDER BY (sp2.status = 'open') DESC, sp2.created_at DESC, sp2.id DESC
  LIMIT 1
) sp ON true;

COMMENT ON VIEW public.sales_equipment_cards IS
  '0169: one row per equipment card («كرت المعدة») with the unit, the company and project, the period (is_open = period_to IS NULL), the entry it was created from (entry_log_id, entry_at) and both sides — the client PO line (id, number, status, price, unit, standard hours, quantity; has_client_po = an open one) and the supplier PO line (id, number, status, price, unit; has_supplier_po = an open one), each the open PO''s line first, else the latest. «قائمة كروت المعدات» and «صفحة كرت المعدة». security_invoker: sales.view or purchasing.view for the card, each side''s own key, movements RLS for the entry.';

REVOKE ALL ON public.sales_equipment_cards FROM PUBLIC, anon;
GRANT SELECT ON public.sales_equipment_cards TO authenticated;

-- ===========================================================================
-- I. purchasing_site_units: 0160 verbatim plus the client side (trailing)
-- ===========================================================================
-- The ticket of «المعدات في المشاريع» gets a second stub: the open CLIENT PO
-- the unit sits on for this company and project (client_po_id,
-- client_po_number, has_client_po), else the open client PO of that company
-- and project that the unit could join (project_client_po_id,
-- project_client_po_number; add_client_po_equipment re-checks). Every
-- existing column keeps its place; the new ones trail.
CREATE OR REPLACE VIEW public.purchasing_site_units
WITH (security_invoker = true)
AS
SELECT
  v.entry_id,
  v.equipment_id,
  v.equipment_code,
  v.equipment_type,
  v.equipment_type_search,
  v.equipment_plate_number,
  e.chassis_number AS equipment_chassis_number,
  v.equipment_ownership_status,
  v.equipment_lessor_id,
  v.equipment_lessor_name,
  v.company_id,
  v.company_name_ar,
  v.company_name_en,
  v.project_id,
  v.project_name_ar,
  v.project_name_en,
  -- The foreman who recorded the open site entry.
  v.entry_supervisor_id,
  v.entry_supervisor_name,
  v.entry_at,
  -- «ترقيم الشركة»: the client company's number on the entry, when set.
  v.contractor_equipment_code,
  -- The open PO the unit sits on for this company and project.
  po.id AS supplier_po_id,
  po.po_number,
  (po.id IS NOT NULL) AS has_po,
  -- Without one: the open PO of the unit's party for this company and
  -- project, which the unit can join (add_supplier_po_equipment re-checks).
  -- 0148: only a PO whose start date is the day this unit entered.
  -- 0160: and only a DRAFT one (an approved PO is locked).
  party_po.id AS party_po_id,
  party_po.po_number AS party_po_number,
  -- 0169: the open CLIENT PO the unit sits on for this company and project.
  cpo.id AS client_po_id,
  cpo.po_number AS client_po_number,
  (cpo.id IS NOT NULL) AS has_client_po,
  -- 0169: without one, the open client PO of this company and project that
  -- the unit can join (add_client_po_equipment re-checks).
  project_cpo.id AS project_client_po_id,
  project_cpo.po_number AS project_client_po_number
FROM public.movement_visits v
LEFT JOIN public.equipment e ON e.id = v.equipment_id
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.supplier_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.supplier_pos p ON p.id = l.supplier_po_id
  WHERE c.equipment_id = v.equipment_id
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) po ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.supplier_pos p
  WHERE po.id IS NULL
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
    AND p.start_date = (v.entry_at AT TIME ZONE 'Asia/Riyadh')::date
    AND p.approval_status = 'draft'
    AND (
      (v.equipment_ownership_status = 'external_supplier'
        AND p.lessor_id IS NOT NULL
        AND p.lessor_id = v.equipment_lessor_id)
      OR (v.equipment_ownership_status <> 'external_supplier'
        AND p.owner_class = v.equipment_ownership_status)
    )
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) party_po ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.client_po_equipment l
  JOIN public.equipment_cards c ON c.id = l.equipment_card_id
  JOIN public.client_pos p ON p.id = l.client_po_id
  WHERE c.equipment_id = v.equipment_id
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) cpo ON true
LEFT JOIN LATERAL (
  SELECT p.id, p.po_number
  FROM public.client_pos p
  WHERE cpo.id IS NULL
    AND p.status = 'open'
    AND p.company_id = v.company_id
    AND p.project_id = v.project_id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) project_cpo ON true
WHERE v.is_open
  AND v.movement_context = 'site';

COMMENT ON VIEW public.purchasing_site_units IS
  '0147/0148/0160/0169: the units inside a project now (open site visits of movement_visits) with the open supplier PO they sit on for that company and project (supplier_po_id, po_number, has_po), else the open DRAFT PO of their party there whose start date is the visit''s entry day (Saudi time) that they can join (party_po_id, party_po_number); and (0169) the open client PO they sit on there (client_po_id, client_po_number, has_client_po), else the open client PO of that company and project they can join (project_client_po_id, project_client_po_number). The «المعدات في المشاريع» page. security_invoker: movements RLS, purchasing.view and sales.view apply as for the reader.';

REVOKE ALL ON public.purchasing_site_units FROM PUBLIC, anon;
GRANT SELECT ON public.purchasing_site_units TO authenticated;
