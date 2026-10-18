-- 0136: purchasing, the smallest piece — supplier purchase orders, the rental
-- price per equipment, and the shared «كرت المعدة» behind the scenes.
--
-- Owner decisions 2026-10-15 to 2026-10-18 (phase 3 starts here, explicitly
-- requested; see AGENTS.md «Purchasing»). Database only: no screen depends on
-- this migration yet, the purchasing screens follow in a later wave.
--
-- ===========================================================================
-- 1. What is built
-- ===========================================================================
--   equipment_cards («كرت المعدة»)  ONE unit for ONE company + project over a
--       period (open end = period_to NULL). The shared document that
--       movements, purchasing and sales will link to later. Created only
--       implicitly by add_supplier_po_equipment, never edited directly for
--       now; its shared fields exist with defaults (rate_unit month,
--       standard_hours 260, period_from = the PO start date). Two cards of
--       the same unit never overlap (EXCLUDE constraint with btree_gist).
--   supplier_pos                     a supplier purchase order: number
--       `SPO` + YY + four-digit yearly sequence (SPO260001), consumed at
--       creation (gaps are fine), lessor (NULL only for an internal PO),
--       company, project, start date, status open/closed. No approval.
--   supplier_po_equipment            one line per card on a PO with the price
--       EXCLUDING VAT (numeric(12,2) >= 0; an internal unit, i.e. Al-Azani
--       or a lessor marked is_internal, must be 0). A card sits on at most
--       one OPEN PO (trigger).
--   supplier_po_events               append-only audit of every change.
--   supplier_po_counters             the yearly sequence (no client access).
--   lessors.is_internal              future internal suppliers; Al-Azani has
--       no lessor row, so is_internal_equipment() also tests
--       ownership_status = 'alazani'.
--   lessor_contacts                  WhatsApp number and email of a lessor,
--       DB-only (lessors.edit), no screen yet.
--
-- ===========================================================================
-- 2. Permissions
-- ===========================================================================
--   The catalogue already carries the two phase-3 keys of 0126,
--   `purchasing.view` and `purchasing.manage` (enforced_in 'reserved'), and
--   the custom role `purchasing` holds both. They are kept — no new keys —
--   and become enforced in the database: SELECT policies of the five
--   purchasing tables need `purchasing.view`; the four write functions need
--   `purchasing.manage`. No gate tests a role name (the 0127 rule): the
--   admin gets both keys in BOTH worlds — the `admin` role in
--   role_permissions (the ACTIVE mode) and two rows added to the frozen
--   legacy mapping, re-created from its 0130 body VERBATIM plus exactly
--   those two admin rows (the 0128 pattern), so that an admin keeps
--   purchasing if the flag is ever switched off. No other role's legacy
--   permissions change.
--
-- ===========================================================================
-- 3. Rules
-- ===========================================================================
--   * Every write goes through the SECURITY DEFINER functions below (no
--     INSERT / UPDATE / DELETE policy on any purchasing table); each checks
--     auth.uid() and `has_permission('purchasing.manage')`
--     first (token purchasing_manage_required, 42501).
--   * add_supplier_po_equipment serialises on the unit's advisory key
--     hashtextextended(equipment_id::text, 0), the key every movement
--     function uses, so a card is never created twice for one unit.
--   * Stable error tokens (the client maps them, never shows raw errors):
--       purchasing_manage_required  42501
--       invalid_po / invalid_equipment / invalid_lessor /
--       invalid_company / invalid_project / invalid_start_date /
--       invalid_price / invalid_line             22023
--       po_closed                                55000
--       internal_price_must_be_zero              22023
--       card_overlap                             23P01
--       equipment_already_on_open_po             23505
--   * Nothing here changes a movement, a photo, the master data or any
--     existing policy.

-- ===========================================================================
-- A. Extension and the lessor side
-- ===========================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

ALTER TABLE public.lessors
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lessors.is_internal IS
  '0136: an internal supplier (a company of the group). Lines of its units on a supplier PO carry price 0. Al-Azani has no lessor row: is_internal_equipment() tests equipment.ownership_status = ''alazani'' too.';

CREATE OR REPLACE FUNCTION public.is_internal_equipment(p_equipment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.equipment e
    LEFT JOIN public.lessors l ON l.id = e.lessor_id
    WHERE e.id = p_equipment_id
      AND (e.ownership_status = 'alazani' OR l.is_internal)
  );
$$;

COMMENT ON FUNCTION public.is_internal_equipment(uuid) IS
  '0136: true for an Al-Azani unit or a unit of a lessor marked is_internal; such a unit costs 0 on a supplier PO. Reveals nothing but that boolean.';

REVOKE ALL ON FUNCTION public.is_internal_equipment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_internal_equipment(uuid) TO authenticated;

CREATE TABLE public.lessor_contacts (
  lessor_id uuid PRIMARY KEY REFERENCES public.lessors(id) ON DELETE CASCADE,
  whatsapp_number text
    CONSTRAINT lessor_contacts_whatsapp_check CHECK (char_length(whatsapp_number) <= 30),
  email text
    CONSTRAINT lessor_contacts_email_check CHECK (char_length(email) <= 120),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lessor_contacts IS
  '0136: contact channels of a lessor (WhatsApp, email) for the purchasing notices to come. lessors.edit only; no screen yet.';

ALTER TABLE public.lessor_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_lessor_contacts ON public.lessor_contacts
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('lessors.edit')));
CREATE POLICY insert_lessor_contacts ON public.lessor_contacts
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_permission('lessors.edit')));
CREATE POLICY update_lessor_contacts ON public.lessor_contacts
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_permission('lessors.edit')))
  WITH CHECK ((SELECT public.has_permission('lessors.edit')));
CREATE POLICY delete_lessor_contacts ON public.lessor_contacts
  FOR DELETE TO authenticated
  USING ((SELECT public.has_permission('lessors.edit')));

CREATE TRIGGER lessor_contacts_updated_at
  BEFORE UPDATE ON public.lessor_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================================================
-- B. equipment_cards («كرت المعدة»)
-- ===========================================================================
CREATE TABLE public.equipment_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  period_from date NOT NULL,
  period_to date,
  rate_unit text NOT NULL DEFAULT 'month'
    CONSTRAINT equipment_cards_rate_unit_check CHECK (rate_unit IN ('month', 'day', 'hour')),
  standard_hours integer NOT NULL DEFAULT 260
    CONSTRAINT equipment_cards_standard_hours_check CHECK (standard_hours > 0),
  note text
    CONSTRAINT equipment_cards_note_check CHECK (char_length(note) <= 500),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_cards_period_check
    CHECK (period_to IS NULL OR period_to >= period_from),
  -- Two cards of one unit never overlap in time (an open end is unbounded).
  CONSTRAINT equipment_cards_no_overlap
    EXCLUDE USING gist (
      equipment_id WITH =,
      daterange(period_from, period_to, '[]') WITH &&
    )
);

CREATE INDEX equipment_cards_equipment_idx
  ON public.equipment_cards (equipment_id, period_from DESC);
CREATE INDEX equipment_cards_company_project_idx
  ON public.equipment_cards (company_id, project_id);

COMMENT ON TABLE public.equipment_cards IS
  '0136 «كرت المعدة»: one unit for one company and project over a period (period_to NULL = open). The shared document movements, purchasing and sales link to; for now created only by add_supplier_po_equipment with the defaults (rate_unit month, standard_hours 260, period_from = the PO start date). Read by purchasing.view; no direct write path.';
COMMENT ON COLUMN public.equipment_cards.rate_unit IS
  'Billing unit shared by purchasing and sales: month, day or hour. Default month; not edited by the first purchasing screens.';
COMMENT ON COLUMN public.equipment_cards.standard_hours IS
  'Standard monthly hours shared by purchasing and sales. Default 260; not edited by the first purchasing screens.';

ALTER TABLE public.equipment_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_equipment_cards ON public.equipment_cards
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('purchasing.view')));

CREATE TRIGGER equipment_cards_updated_at
  BEFORE UPDATE ON public.equipment_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================================================
-- C. supplier_pos and the yearly number
-- ===========================================================================
CREATE TABLE public.supplier_po_counters (
  year smallint PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.supplier_po_counters IS
  '0136: last consumed sequence of supplier PO numbers per two-digit year (Saudi time). Read and written only by next_supplier_po_number(); no client access.';

ALTER TABLE public.supplier_po_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_supplier_po_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_year smallint;
  v_seq integer;
BEGIN
  v_year := to_char(now() AT TIME ZONE 'Asia/Riyadh', 'YY')::smallint;
  INSERT INTO public.supplier_po_counters (year, last_seq)
  VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE SET last_seq = public.supplier_po_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;
  RETURN 'SPO' || lpad(v_year::text, 2, '0') || lpad(v_seq::text, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.next_supplier_po_number() IS
  '0136: consumes and returns the next supplier PO number, SPO + YY + four digits (SPO260001). Called only by create_supplier_po; a rolled-back creation leaves a gap, which is accepted.';

REVOKE ALL ON FUNCTION public.next_supplier_po_number()
  FROM PUBLIC, anon, authenticated;

CREATE TABLE public.supplier_pos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL UNIQUE
    CONSTRAINT supplier_pos_number_format CHECK (po_number ~ '^SPO[0-9]{6,}$'),
  lessor_id uuid REFERENCES public.lessors(id) ON DELETE RESTRICT,
  is_internal boolean NOT NULL DEFAULT false,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CONSTRAINT supplier_pos_status_check CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  notes text
    CONSTRAINT supplier_pos_notes_check CHECK (char_length(notes) <= 1000),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_pos_lessor_check CHECK (lessor_id IS NOT NULL OR is_internal),
  CONSTRAINT supplier_pos_closed_at_check
    CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE INDEX supplier_pos_status_start_idx
  ON public.supplier_pos (status, start_date DESC);
CREATE INDEX supplier_pos_lessor_idx ON public.supplier_pos (lessor_id);
CREATE INDEX supplier_pos_company_project_idx
  ON public.supplier_pos (company_id, project_id);

COMMENT ON TABLE public.supplier_pos IS
  '0136: supplier purchase orders (phase 3, first piece). Number consumed at creation; no approval workflow; lessor NULL only for an internal PO (is_internal). Read by purchasing.view; written only by create_supplier_po and close_supplier_po.';

ALTER TABLE public.supplier_pos ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_supplier_pos ON public.supplier_pos
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('purchasing.view')));

-- ===========================================================================
-- D. supplier_po_equipment (the lines) and supplier_po_events (the audit)
-- ===========================================================================
CREATE TABLE public.supplier_po_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_po_id uuid NOT NULL REFERENCES public.supplier_pos(id) ON DELETE CASCADE,
  equipment_card_id uuid NOT NULL REFERENCES public.equipment_cards(id) ON DELETE RESTRICT,
  price numeric(12, 2) NOT NULL
    CONSTRAINT supplier_po_equipment_price_check CHECK (price >= 0),
  note text
    CONSTRAINT supplier_po_equipment_note_check CHECK (char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_po_equipment_unique UNIQUE (supplier_po_id, equipment_card_id)
);

CREATE INDEX supplier_po_equipment_card_idx
  ON public.supplier_po_equipment (equipment_card_id);

COMMENT ON TABLE public.supplier_po_equipment IS
  '0136: one line per equipment card on a supplier PO with the price EXCLUDING VAT (0 for an internal unit). A card sits on at most one open PO. Read by purchasing.view; written only by add_supplier_po_equipment and update_supplier_po_equipment_price.';

ALTER TABLE public.supplier_po_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_supplier_po_equipment ON public.supplier_po_equipment
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('purchasing.view')));

CREATE TRIGGER supplier_po_equipment_updated_at
  BEFORE UPDATE ON public.supplier_po_equipment
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- A card is on at most one OPEN PO. Two cards of one unit never overlap
-- (equipment_cards_no_overlap), so this is the whole "one unit, one open PO
-- per period" rule. Enforced here, not only in the function, so no other
-- write path can break it.
CREATE OR REPLACE FUNCTION public.enforce_supplier_po_equipment_single_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.supplier_po_equipment l
    JOIN public.supplier_pos p ON p.id = l.supplier_po_id
    WHERE l.equipment_card_id = NEW.equipment_card_id
      AND l.id <> NEW.id
      AND p.status = 'open'
  ) AND EXISTS (
    SELECT 1 FROM public.supplier_pos p
    WHERE p.id = NEW.supplier_po_id AND p.status = 'open'
  ) THEN
    RAISE EXCEPTION 'equipment_already_on_open_po'
      USING ERRCODE = '23505',
            HINT = 'This equipment card already sits on another open supplier PO.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_supplier_po_equipment_single_open()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER supplier_po_equipment_single_open
  BEFORE INSERT OR UPDATE OF equipment_card_id, supplier_po_id
  ON public.supplier_po_equipment
  FOR EACH ROW EXECUTE FUNCTION public.enforce_supplier_po_equipment_single_open();

CREATE TABLE public.supplier_po_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_po_id uuid NOT NULL REFERENCES public.supplier_pos(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CONSTRAINT supplier_po_events_type_check CHECK (
      event_type IN ('created', 'equipment_added', 'price_changed', 'card_changed', 'closed')
    ),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX supplier_po_events_po_idx
  ON public.supplier_po_events (supplier_po_id, created_at);

COMMENT ON TABLE public.supplier_po_events IS
  '0136: append-only audit of a supplier PO (created, equipment_added, price_changed, card_changed, closed). Read by purchasing.view; written only by the purchasing functions; no update or delete path.';

ALTER TABLE public.supplier_po_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_supplier_po_events ON public.supplier_po_events
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('purchasing.view')));

-- ===========================================================================
-- E. The write functions
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.assert_purchasing_manage()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('purchasing.manage') THEN
    RAISE EXCEPTION 'purchasing_manage_required'
      USING ERRCODE = '42501',
            HINT = 'Managing supplier purchase orders needs the purchasing.manage permission.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_purchasing_manage()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_supplier_po(
  p_lessor_id uuid,
  p_company_id uuid,
  p_project_id uuid,
  p_start_date date,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_internal boolean := false;
  v_id uuid;
  v_number text;
BEGIN
  PERFORM public.assert_purchasing_manage();

  IF p_company_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'invalid_company' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id) THEN
    RAISE EXCEPTION 'invalid_project' USING ERRCODE = '22023';
  END IF;
  IF p_start_date IS NULL THEN
    RAISE EXCEPTION 'invalid_start_date' USING ERRCODE = '22023';
  END IF;

  -- No lessor = an internal PO (Al-Azani units). A lessor marked is_internal
  -- makes an internal PO too; every other lessor is an external supplier.
  IF p_lessor_id IS NULL THEN
    v_internal := true;
  ELSE
    SELECT l.is_internal INTO v_internal
    FROM public.lessors l
    WHERE l.id = p_lessor_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_lessor' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_number := public.next_supplier_po_number();

  INSERT INTO public.supplier_pos (
    po_number, lessor_id, is_internal, company_id, project_id, start_date,
    notes, created_by
  ) VALUES (
    v_number, p_lessor_id, v_internal, p_company_id, p_project_id, p_start_date,
    NULLIF(btrim(p_notes), ''), auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    v_id, 'created',
    jsonb_build_object(
      'po_number', v_number,
      'lessor_id', p_lessor_id,
      'is_internal', v_internal,
      'company_id', p_company_id,
      'project_id', p_project_id,
      'start_date', p_start_date
    ),
    auth.uid()
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.create_supplier_po(uuid, uuid, uuid, date, text) IS
  '0136: creates an open supplier PO with the next SPO number (consumed even if the caller later rolls back). NULL lessor = internal PO. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.create_supplier_po(uuid, uuid, uuid, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_po(uuid, uuid, uuid, date, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.add_supplier_po_equipment(
  p_po_id uuid,
  p_equipment_id uuid,
  p_price numeric,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_po public.supplier_pos%ROWTYPE;
  v_card_id uuid;
  v_card_created boolean := false;
  v_line_id uuid;
BEGIN
  PERFORM public.assert_purchasing_manage();

  SELECT * INTO v_po
  FROM public.supplier_pos p
  WHERE p.id = p_po_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_po' USING ERRCODE = '22023';
  END IF;
  IF v_po.status <> 'open' THEN
    RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000';
  END IF;

  IF p_equipment_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.equipment e WHERE e.id = p_equipment_id) THEN
    RAISE EXCEPTION 'invalid_equipment' USING ERRCODE = '22023';
  END IF;
  IF p_price IS NULL OR p_price < 0 OR p_price > 9999999999.99 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  IF public.is_internal_equipment(p_equipment_id) AND p_price <> 0 THEN
    RAISE EXCEPTION 'internal_price_must_be_zero' USING ERRCODE = '22023';
  END IF;

  -- The unit's advisory key (the one every movement function takes), so two
  -- concurrent calls never create two cards for one unit.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 0));

  -- Reuse the unit's card for this company and project when its period
  -- covers the PO start date (an open end covers everything after it);
  -- otherwise open a new card from the PO start date with the defaults.
  SELECT c.id INTO v_card_id
  FROM public.equipment_cards c
  WHERE c.equipment_id = p_equipment_id
    AND c.company_id = v_po.company_id
    AND c.project_id = v_po.project_id
    AND c.period_from <= v_po.start_date
    AND (c.period_to IS NULL OR c.period_to >= v_po.start_date)
  ORDER BY c.period_from DESC
  LIMIT 1;

  IF v_card_id IS NULL THEN
    BEGIN
      INSERT INTO public.equipment_cards (
        equipment_id, company_id, project_id, period_from, created_by
      ) VALUES (
        p_equipment_id, v_po.company_id, v_po.project_id, v_po.start_date, auth.uid()
      )
      RETURNING id INTO v_card_id;
      v_card_created := true;
    EXCEPTION
      WHEN exclusion_violation THEN
        -- Another card of this unit (another company or project) already
        -- covers the PO start date.
        RAISE EXCEPTION 'card_overlap'
          USING ERRCODE = '23P01',
                HINT = 'The equipment already has a card for another company or project in this period.';
    END;
  END IF;

  BEGIN
    INSERT INTO public.supplier_po_equipment (
      supplier_po_id, equipment_card_id, price, note
    ) VALUES (
      v_po.id, v_card_id, p_price, NULLIF(btrim(p_note), '')
    )
    RETURNING id INTO v_line_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'equipment_already_on_open_po'
        USING ERRCODE = '23505',
              HINT = 'This equipment is already on this PO.';
  END;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    v_po.id, 'equipment_added',
    jsonb_build_object(
      'line_id', v_line_id,
      'equipment_id', p_equipment_id,
      'equipment_card_id', v_card_id,
      'card_created', v_card_created,
      'price', p_price
    ),
    auth.uid()
  );

  RETURN v_line_id;
END;
$$;

COMMENT ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text) IS
  '0136: adds a unit to an open supplier PO at a price excluding VAT (0 for an internal unit), reusing or creating its equipment card for the PO company and project. Serialises on the unit''s advisory key. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_supplier_po_equipment(uuid, uuid, numeric, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.update_supplier_po_equipment_price(
  p_line_id uuid,
  p_price numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line public.supplier_po_equipment%ROWTYPE;
  v_status text;
  v_equipment_id uuid;
BEGIN
  PERFORM public.assert_purchasing_manage();

  SELECT * INTO v_line
  FROM public.supplier_po_equipment l
  WHERE l.id = p_line_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = '22023';
  END IF;

  SELECT p.status INTO v_status
  FROM public.supplier_pos p
  WHERE p.id = v_line.supplier_po_id
  FOR UPDATE;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000';
  END IF;

  IF p_price IS NULL OR p_price < 0 OR p_price > 9999999999.99 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  SELECT c.equipment_id INTO v_equipment_id
  FROM public.equipment_cards c
  WHERE c.id = v_line.equipment_card_id;
  IF public.is_internal_equipment(v_equipment_id) AND p_price <> 0 THEN
    RAISE EXCEPTION 'internal_price_must_be_zero' USING ERRCODE = '22023';
  END IF;

  IF p_price = v_line.price THEN
    RETURN;
  END IF;

  UPDATE public.supplier_po_equipment
  SET price = p_price
  WHERE id = v_line.id;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    v_line.supplier_po_id, 'price_changed',
    jsonb_build_object(
      'line_id', v_line.id,
      'equipment_id', v_equipment_id,
      'old_price', v_line.price,
      'new_price', p_price
    ),
    auth.uid()
  );
END;
$$;

COMMENT ON FUNCTION public.update_supplier_po_equipment_price(uuid, numeric) IS
  '0136: changes the price of a line of an OPEN supplier PO (0 stays mandatory for an internal unit) and records old and new. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.update_supplier_po_equipment_price(uuid, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_supplier_po_equipment_price(uuid, numeric)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.close_supplier_po(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM public.assert_purchasing_manage();

  SELECT p.status INTO v_status
  FROM public.supplier_pos p
  WHERE p.id = p_po_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_po' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'po_closed' USING ERRCODE = '55000';
  END IF;

  UPDATE public.supplier_pos
  SET status = 'closed', closed_at = now()
  WHERE id = p_po_id;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (p_po_id, 'closed', '{}'::jsonb, auth.uid());
END;
$$;

COMMENT ON FUNCTION public.close_supplier_po(uuid) IS
  '0136: closes an open supplier PO (its lines stay readable, no further line or price change). Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.close_supplier_po(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_supplier_po(uuid) TO authenticated;

-- ===========================================================================
-- F. The catalogue: the two reserved keys become enforced in the database
-- ===========================================================================
UPDATE public.permissions
SET enforced_in = 'database',
    description_ar = 'عرض اوامر شراء الموردين وقيم الايجار وكروت المعدات.',
    description_en = 'View supplier purchase orders, rental prices and equipment cards.'
WHERE key = 'purchasing.view';

UPDATE public.permissions
SET enforced_in = 'database',
    description_ar = 'انشاء اوامر شراء الموردين واضافة المعدات وقيم الايجار واغلاقها.',
    description_en = 'Create supplier purchase orders, add equipment and rental prices, close them.'
WHERE key = 'purchasing.manage';

-- The admin role holds both in the ACTIVE mode. The custom role `purchasing`
-- holds them since 0126.
INSERT INTO public.role_permissions (role_key, permission_key, scope)
VALUES
  ('admin', 'purchasing.view', NULL),
  ('admin', 'purchasing.manage', NULL)
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- ===========================================================================
-- G. The frozen legacy mapping: the 0130 body VERBATIM plus TWO admin rows
-- ===========================================================================
-- ('admin', 'purchasing.view', NULL) and ('admin', 'purchasing.manage', NULL),
-- the 0128 pattern: the admin keeps purchasing while the flag is off. Nothing
-- else of the mapping changes. Grants restated as in 0130.
CREATE OR REPLACE FUNCTION public.legacy_role_permissions(p_role text)
RETURNS TABLE(permission_key text, scope text)
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT m.permission_key, m.scope
  FROM (VALUES
    ('admin', 'home.admin', NULL),
    ('admin', 'movements.read', 'all'),
    ('admin', 'movements.site.create', 'all'),
    ('admin', 'movements.site.driver_change', 'all'),
    ('admin', 'movements.workshop.create', NULL),
    ('admin', 'movements.workshop.classify', NULL),
    ('admin', 'movements.notify_foreman', NULL),
    ('admin', 'movements.exit_cross_context', NULL),
    ('admin', 'movements.edit_delete', NULL),
    ('admin', 'movements.import', NULL),
    ('admin', 'movements.photos.manage', 'all'),
    ('admin', 'movements.photos.delete_any', NULL),
    ('admin', 'movements.export', NULL),
    ('admin', 'movements.activity', NULL),
    ('admin', 'reports.view', 'all'),
    ('admin', 'inquiry.view', NULL),
    ('admin', 'equipment.read', NULL),
    ('admin', 'equipment.create', NULL),
    ('admin', 'equipment.edit', NULL),
    ('admin', 'equipment.delete', NULL),
    ('admin', 'equipment.quick_create', 'all'),
    ('admin', 'equipment.change_code', NULL),
    ('admin', 'equipment.import', NULL),
    ('admin', 'equipment.tracker_link', NULL),
    ('admin', 'equipment.location.view', NULL),
    ('admin', 'drivers.read', NULL),
    ('admin', 'drivers.create', NULL),
    ('admin', 'drivers.edit', NULL),
    ('admin', 'drivers.delete', NULL),
    ('admin', 'drivers.quick_create', NULL),
    ('admin', 'drivers.import', NULL),
    ('admin', 'companies_projects.read', NULL),
    ('admin', 'companies_projects.edit', NULL),
    ('admin', 'lessors.read', NULL),
    ('admin', 'lessors.edit', NULL),
    ('admin', 'lessors.quick_create', NULL),
    ('admin', 'users.read', 'all'),
    ('admin', 'users.manage', NULL),
    ('admin', 'settings.equipment_types', NULL),
    ('admin', 'settings.integrations', NULL),
    ('admin', 'extracting.view', NULL),
    ('admin', 'settings.roles', NULL),
    ('admin', 'purchasing.view', NULL),
    ('admin', 'purchasing.manage', NULL),
    ('supervisor', 'home.foreman', 'own'),
    ('supervisor', 'movements.read', 'own'),
    ('supervisor', 'movements.site.create', 'own'),
    ('supervisor', 'movements.site.driver_change', 'own'),
    ('supervisor', 'movements.site.contractor_code', NULL),
    ('supervisor', 'movements.photos.manage', 'own'),
    ('supervisor', 'inquiry.view', NULL),
    ('supervisor', 'equipment.quick_create', 'site'),
    ('supervisor', 'drivers.quick_create', NULL),
    ('supervisor', 'lessors.quick_create', NULL),
    ('workshop', 'home.workshop', 'workshop'),
    ('workshop', 'movements.read', 'all'),
    ('workshop', 'movements.workshop.create', NULL),
    ('workshop', 'movements.notify_foreman', NULL),
    ('workshop', 'movements.photos.manage', 'workshop'),
    ('workshop', 'inquiry.view', NULL),
    ('workshop', 'equipment.quick_create', 'workshop'),
    ('workshop', 'users.read', 'workshop'),
    ('assistant_workshop_manager', 'home.workshop', 'all'),
    ('assistant_workshop_manager', 'movements.read', 'all'),
    ('assistant_workshop_manager', 'movements.workshop.create', NULL),
    ('assistant_workshop_manager', 'movements.workshop.classify', NULL),
    ('assistant_workshop_manager', 'movements.notify_foreman', NULL),
    ('assistant_workshop_manager', 'movements.photos.manage', 'workshop'),
    ('assistant_workshop_manager', 'movements.export', NULL),
    ('assistant_workshop_manager', 'inquiry.view', NULL),
    ('assistant_workshop_manager', 'equipment.quick_create', 'workshop'),
    ('assistant_workshop_manager', 'users.read', 'workshop'),
    ('workshop_manager', 'home.workshop', 'all'),
    ('workshop_manager', 'movements.read', 'all'),
    ('workshop_manager', 'movements.workshop.create', NULL),
    ('workshop_manager', 'movements.workshop.classify', NULL),
    ('workshop_manager', 'movements.notify_foreman', NULL),
    ('workshop_manager', 'movements.photos.manage', 'workshop'),
    ('workshop_manager', 'movements.export', NULL),
    ('workshop_manager', 'inquiry.view', NULL),
    ('workshop_manager', 'equipment.quick_create', 'workshop'),
    ('workshop_manager', 'users.read', 'workshop'),
    ('monitor', 'home.admin', NULL),
    ('monitor', 'movements.read', 'all'),
    ('monitor', 'movements.export', NULL),
    ('monitor', 'inquiry.view', NULL),
    ('monitor', 'users.read', 'all')
  ) AS m(role_key, permission_key, scope)
  WHERE m.role_key = p_role;
$$;

COMMENT ON FUNCTION public.legacy_role_permissions(text) IS
  'FROZEN legacy mapping (0126): the permissions each of the six legacy roles (profiles.role) has today, hard-coded, never read from a table. Used by permission_scope() while app_settings.roles_system is disabled, and by the comparison screen. An unknown or NULL role returns no row. 0128 added extracting.view; 0130 retired map.view (the projects map was cancelled); 0136 added purchasing.view and purchasing.manage for the admin (purchasing, first piece).';

REVOKE ALL ON FUNCTION public.legacy_role_permissions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legacy_role_permissions(text) TO authenticated;
