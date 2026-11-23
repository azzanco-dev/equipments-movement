-- 0210: what an installment contract covers («البنود») and a name on each
-- installment.
--
-- Owner 2026-11-23, on the new contract page: «نبغى نضيف البنود, الاشياء الي
-- داخله في العقد, ممكن تكون معدات وممكن شي اخر, مثلا حط البند والعدد» and
-- «نبغى نشتغل على سطر القسط, مرات ابغى اضيف له اسم, مثل "القسط 1 - رقم سند
-- الامر 545456564"»; asked, he chose free text with a count, keeping the
-- optional unit link as it is, and naming an installment from the contract
-- page at any time.
--
--   * installment_contract_items: name (1-120) + quantity (> 0, two
--     decimals) in their order, written only by save_installment_contract
--     (new trailing p_items: SQL NULL keeps them, an array replaces them,
--     [] removes them; tokens invalid_items, invalid_item_name,
--     invalid_item_quantity). Read by installments.view.
--   * An INSTALLMENT row may now carry `note` (≤ 200, the 0209 column):
--     set_installment_row_note(p_schedule_id, p_note) writes it, a blank
--     clears it, on any contract but a cancelled one, paid or not.
--     generate_installment_schedule keeps the notes by installment number
--     when it rebuilds the rows.
--   * installment_dues appends `note`; the reminder's items carry it; the
--     deletion archive keeps the items; the edit key counts them.
--
-- The save function is 0209's body verbatim plus p_items; the fifteen-
-- parameter function is dropped, so a call with the fifteen named
-- parameters (the screens live before this) resolves to the new one and
-- keeps the items.

-- ===========================================================================
-- 1. A note on an installment row
-- ===========================================================================
ALTER TABLE public.installment_schedule
  DROP CONSTRAINT installment_schedule_kind_shape,
  ADD CONSTRAINT installment_schedule_kind_shape CHECK (
    CASE kind
      WHEN 'first_payment' THEN title IS NOT NULL
      WHEN 'vat' THEN rate IS NULL
      ELSE title IS NULL AND rate IS NULL
    END
  );

COMMENT ON COLUMN public.installment_schedule.note IS
  '0209 / 0210: the note of a first payment or the VAT row, and since 0210 the name added to an installment («القسط 1 - رقم سند الامر …»).';

CREATE OR REPLACE FUNCTION public.generate_installment_schedule(p_contract_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
  v_final numeric(14, 2);
  v_regular_count integer;
  v_regular_total numeric(14, 2);
  v_each numeric(14, 2);
  v_amount numeric(14, 2);
  v_i integer;
  v_notes jsonb;
BEGIN
  SELECT * INTO c FROM public.installment_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
  END IF;
  -- The callers check this too; a guard, because the delete cascades.
  IF EXISTS (
    SELECT 1 FROM public.installment_schedule s
    WHERE s.contract_id = c.id AND s.kind = 'installment' AND s.paid_amount > 0
  ) THEN
    RAISE EXCEPTION 'contract_has_payments' USING ERRCODE = '55000';
  END IF;

  -- 0210: the names stay with their installment numbers.
  SELECT jsonb_object_agg(s.seq::text, s.note) INTO v_notes
  FROM public.installment_schedule s
  WHERE s.contract_id = c.id AND s.kind = 'installment' AND s.note IS NOT NULL;

  DELETE FROM public.installment_schedule
  WHERE contract_id = c.id AND kind = 'installment';

  IF c.first_due_date IS NULL THEN
    RETURN;
  END IF;

  v_final := c.balloon_amount;
  v_regular_count := c.installment_count - CASE WHEN v_final > 0 THEN 1 ELSE 0 END;
  v_regular_total := c.installments_amount - v_final;
  v_each := trunc(v_regular_total / v_regular_count, 2);

  FOR v_i IN 1..c.installment_count LOOP
    v_amount := CASE
      WHEN v_i > v_regular_count THEN v_final
      WHEN v_i = v_regular_count THEN v_regular_total - v_each * (v_regular_count - 1)
      ELSE v_each
    END;
    INSERT INTO public.installment_schedule (
      contract_id, kind, seq, due_date, amount, is_balloon, note
    ) VALUES (
      c.id,
      'installment',
      v_i,
      (c.first_due_date + make_interval(months => (v_i - 1) * c.frequency_months))::date,
      v_amount,
      v_i > v_regular_count,
      v_notes->>v_i::text
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.generate_installment_schedule(uuid) IS
  '0203, re-created 0209 / 0210: rebuilds the INSTALLMENT rows of a contract from installments_amount (none while first_due_date is NULL), keeping each installment''s name by its number; first payments and the VAT row are never touched. Executable by nobody.';

CREATE FUNCTION public.set_installment_row_note(p_schedule_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
  v_row public.installment_schedule%ROWTYPE;
  v_note text;
BEGIN
  PERFORM public.assert_installments_manage();

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.installment_schedule
  WHERE id = p_schedule_id AND kind = 'installment';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_schedule_row' USING ERRCODE = '22023';
  END IF;
  -- The contract first, the lock order of the other writers.
  SELECT * INTO c FROM public.installment_contracts WHERE id = v_row.contract_id FOR UPDATE;
  SELECT * INTO v_row FROM public.installment_schedule WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_schedule_row' USING ERRCODE = '22023';
  END IF;
  IF c.status = 'cancelled' THEN
    RAISE EXCEPTION 'contract_not_active' USING ERRCODE = '55000';
  END IF;

  IF v_row.note IS DISTINCT FROM v_note THEN
    UPDATE public.installment_schedule SET note = v_note WHERE id = v_row.id;
    UPDATE public.installment_contracts SET updated_at = now() WHERE id = c.id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_installment_row_note(uuid, text) IS
  '0210: names an installment («رقم سند الامر 545456564»), shown after «القسط N»; a blank clears it. Any installment of a contract that is not cancelled, paid or not. installments.manage.';

REVOKE ALL ON FUNCTION public.set_installment_row_note(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_installment_row_note(uuid, text) TO authenticated;

-- ===========================================================================
-- 2. The items
-- ===========================================================================
CREATE TABLE public.installment_contract_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.installment_contracts(id) ON DELETE CASCADE,
  position integer NOT NULL
    CONSTRAINT installment_contract_items_position_check CHECK (position BETWEEN 1 AND 100),
  name text NOT NULL
    CONSTRAINT installment_contract_items_name_check
      CHECK (char_length(name) BETWEEN 1 AND 120 AND name = btrim(name)),
  quantity numeric(10, 2) NOT NULL
    CONSTRAINT installment_contract_items_quantity_check CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installment_contract_items_position_unique UNIQUE (contract_id, position)
);

COMMENT ON TABLE public.installment_contract_items IS
  '0210: what an installment contract covers («البنود»), free text with a count, in their order. Read by installments.view; written only by save_installment_contract (p_items).';

CREATE TRIGGER installment_contract_items_updated_at
  BEFORE UPDATE ON public.installment_contract_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.installment_contract_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_installment_contract_items ON public.installment_contract_items
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('installments.view')));

REVOKE ALL ON TABLE public.installment_contract_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.installment_contract_items TO authenticated;

CREATE OR REPLACE FUNCTION public.installment_contract_edit_key(p_contract_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET timezone = 'UTC'
SET datestyle = 'ISO, YMD'
AS $$
  SELECT md5(jsonb_build_object(
    'contract', to_jsonb(c) - 'updated_at',
    'rows', (
      SELECT jsonb_agg(to_jsonb(s) - 'updated_at' ORDER BY s.id)
      FROM public.installment_schedule s
      WHERE s.contract_id = c.id AND s.kind <> 'installment'
    ),
    'locked', EXISTS (
      SELECT 1 FROM public.installment_schedule s
      WHERE s.contract_id = c.id AND s.kind = 'installment' AND s.paid_amount > 0
    ),
    'units', (
      SELECT jsonb_agg(e.equipment_id ORDER BY e.equipment_id)
      FROM public.installment_contract_equipment e
      WHERE e.contract_id = c.id
    ),
    'items', (
      SELECT jsonb_agg(jsonb_build_array(i.name, i.quantity) ORDER BY i.position)
      FROM public.installment_contract_items i
      WHERE i.contract_id = c.id
    )
  )::text)
  FROM public.installment_contracts c
  WHERE c.id = p_contract_id
$$;

COMMENT ON FUNCTION public.installment_contract_edit_key(uuid) IS
  '0209 / 0210: the version of a contract an edit is based on (save_installment_contract p_expected_key), its items included. Security invoker: RLS decides.';

-- ===========================================================================
-- 3. save_installment_contract: 0209's body verbatim plus p_items
-- ===========================================================================
DROP FUNCTION public.save_installment_contract(
  uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[], jsonb, jsonb, jsonb, text
);

CREATE FUNCTION public.save_installment_contract(
  p_id uuid,
  p_description text,
  p_financier_id uuid,
  p_total_amount numeric,
  p_down_payment numeric,
  p_balloon_amount numeric,
  p_installment_count integer,
  p_frequency_months integer,
  p_first_due_date date,
  p_notes text DEFAULT NULL,
  p_equipment_ids uuid[] DEFAULT NULL,
  p_account jsonb DEFAULT NULL,
  -- {mode, amount, due, due_date, title, note, paid_on, method}; SQL NULL
  -- keeps the stored VAT.
  p_vat jsonb DEFAULT NULL,
  -- [{id, title, rate | amount, due_date, note, paid_on, method}] in their
  -- order; SQL NULL keeps the stored rows, [] removes them.
  p_first_payments jsonb DEFAULT NULL,
  -- installment_contract_edit_key as the edit page read it; NULL = no check.
  p_expected_key text DEFAULT NULL,
  -- 0210: [{name, quantity}] in their order; SQL NULL keeps the stored
  -- items, [] removes them.
  p_items jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
  v_old public.installment_schedule%ROWTYPE;
  v_new boolean := p_id IS NULL;
  v_id uuid;
  v_description text;
  v_notes text;
  v_total numeric(14, 2);
  v_prepaid numeric(14, 2);
  v_balloon numeric(14, 2);
  v_installments numeric;
  v_units uuid[];
  v_account_set boolean := false;
  v_bank text;
  v_iban text;
  v_vat_mode text := 'unspecified';
  v_vat numeric := 0;
  v_vat_due text;
  v_vat_date date;
  v_vat_row public.installment_schedule%ROWTYPE;
  v_vat_title text;
  v_vat_note text;
  v_vat_paid_on date;
  v_vat_method text;
  v_rate_base numeric;
  v_input jsonb;
  v_item jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_keep uuid[] := '{}';
  v_row_id uuid;
  v_seq integer := 0;
  v_title text;
  v_row_note text;
  v_rate numeric;
  v_base numeric;
  v_first_total numeric := 0;
  v_due date;
  v_paid_on date;
  v_method text;
  v_division_changed boolean;
  v_items jsonb;
  v_item_name text;
  v_item_qty numeric;
BEGIN
  PERFORM public.assert_installments_manage();

  IF NOT v_new THEN
    SELECT * INTO c FROM public.installment_contracts WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
    END IF;
    IF c.status = 'cancelled' THEN
      RAISE EXCEPTION 'contract_not_active' USING ERRCODE = '55000';
    END IF;
    IF p_expected_key IS NOT NULL
       AND p_expected_key IS DISTINCT FROM public.installment_contract_edit_key(c.id) THEN
      RAISE EXCEPTION 'contract_changed' USING ERRCODE = '55000';
    END IF;
  END IF;

  v_description := btrim(COALESCE(p_description, ''));
  IF v_description = '' OR char_length(v_description) > 200 THEN
    RAISE EXCEPTION 'invalid_description' USING ERRCODE = '22023';
  END IF;
  IF p_financier_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.installment_financiers f WHERE f.id = p_financier_id
  ) THEN
    RAISE EXCEPTION 'invalid_financier' USING ERRCODE = '22023';
  END IF;
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
  IF char_length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023';
  END IF;

  IF p_total_amount IS NULL OR p_total_amount <= 0
     OR p_total_amount > 999999999999.99 OR round(p_total_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  v_total := round(p_total_amount, 2);
  IF p_down_payment < 0 OR p_down_payment > 999999999999.99 THEN
    RAISE EXCEPTION 'invalid_down_payment' USING ERRCODE = '22023';
  END IF;
  v_prepaid := round(COALESCE(p_down_payment, 0), 2);
  IF p_balloon_amount < 0 OR p_balloon_amount > 999999999999.99 THEN
    RAISE EXCEPTION 'invalid_balloon' USING ERRCODE = '22023';
  END IF;
  v_balloon := round(COALESCE(p_balloon_amount, 0), 2);

  -- 0208: the contract's own account. SQL NULL keeps the stored one (none
  -- on a new contract); JSON null or an object without values clears it
  -- (the financier's account is then used); an object sets it.
  IF p_account IS NOT NULL THEN
    IF jsonb_typeof(p_account) = 'object' THEN
      v_bank := NULLIF(btrim(COALESCE(p_account->>'bank_name', '')), '');
      v_iban := NULLIF(upper(regexp_replace(COALESCE(p_account->>'iban', ''), '[\s-]', '', 'g')), '');
    ELSIF jsonb_typeof(p_account) <> 'null' THEN
      RAISE EXCEPTION 'invalid_account' USING ERRCODE = '22023';
    END IF;
    IF v_bank IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.banks b WHERE b.name = v_bank
    ) THEN
      RAISE EXCEPTION 'invalid_bank' USING ERRCODE = '22023';
    END IF;
    IF v_iban IS NOT NULL AND v_iban !~ '^SA[0-9]{4}[0-9A-Z]{18}$' THEN
      RAISE EXCEPTION 'invalid_iban' USING ERRCODE = '22023';
    END IF;
    v_account_set := true;
  END IF;

  -- The linked units, without repeats; every one must exist.
  SELECT COALESCE(array_agg(DISTINCT u), '{}') INTO v_units
  FROM unnest(COALESCE(p_equipment_ids, '{}'::uuid[])) AS u;
  IF array_position(v_units, NULL) IS NOT NULL
     OR cardinality(v_units) > 200
     OR EXISTS (
       SELECT 1 FROM unnest(v_units) AS u
       WHERE NOT EXISTS (SELECT 1 FROM public.equipment e WHERE e.id = u)
     ) THEN
    RAISE EXCEPTION 'invalid_equipment' USING ERRCODE = '22023';
  END IF;

  -- 0210: what the contract covers, free text with a count. Checked before
  -- anything is written.
  IF p_items IS NOT NULL THEN
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 100 THEN
      RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
    END IF;
    v_items := '[]'::jsonb;
    FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value, n) ORDER BY e.n
    LOOP
      IF jsonb_typeof(v_item) <> 'object'
         OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_item->'quantity') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
      END IF;
      v_item_name := btrim(v_item->>'name');
      IF v_item_name = '' OR char_length(v_item_name) > 120 THEN
        RAISE EXCEPTION 'invalid_item_name' USING ERRCODE = '22023';
      END IF;
      v_item_qty := (v_item->>'quantity')::numeric;
      IF v_item_qty <= 0 OR v_item_qty > 99999999.99 OR v_item_qty <> round(v_item_qty, 2) THEN
        RAISE EXCEPTION 'invalid_item_quantity' USING ERRCODE = '22023';
      END IF;
      v_items := v_items || jsonb_build_array(jsonb_build_object('name', v_item_name, 'quantity', v_item_qty));
    END LOOP;
  END IF;

  -- VAT -----------------------------------------------------------------------
  IF NOT v_new THEN
    SELECT * INTO v_vat_row FROM public.installment_schedule s
    WHERE s.contract_id = c.id AND s.kind = 'vat';
  END IF;

  IF p_vat IS NULL THEN
    IF NOT v_new THEN
      v_vat_mode := c.vat_mode;
      v_vat_due := c.vat_due;
      v_vat_date := c.vat_due_date;
      v_vat := c.vat_amount;
      v_vat_title := v_vat_row.title;
      v_vat_note := v_vat_row.note;
    END IF;
  ELSE
    IF jsonb_typeof(p_vat) <> 'object'
       OR COALESCE(p_vat->>'mode', '') NOT IN ('unspecified', 'none', 'inside', 'separate') THEN
      RAISE EXCEPTION 'invalid_vat' USING ERRCODE = '22023';
    END IF;
    v_vat_mode := p_vat->>'mode';
    -- «غير محدد» is what the earlier contracts are, never a choice.
    IF v_vat_mode = 'unspecified' AND (v_new OR c.vat_mode <> 'unspecified') THEN
      RAISE EXCEPTION 'invalid_vat' USING ERRCODE = '22023';
    END IF;

    IF v_vat_mode = 'separate' THEN
      IF COALESCE(jsonb_typeof(p_vat->'amount'), 'null') = 'null' THEN
        v_vat := round(v_total * 15 / 115, 2);
      ELSIF jsonb_typeof(p_vat->'amount') = 'number' THEN
        v_vat := round((p_vat->>'amount')::numeric, 2);
      ELSE
        RAISE EXCEPTION 'invalid_vat_amount' USING ERRCODE = '22023';
      END IF;

      v_vat_due := COALESCE(p_vat->>'due', 'undecided');
      IF v_vat_due NOT IN ('undecided', 'date', 'last') THEN
        RAISE EXCEPTION 'invalid_vat_date' USING ERRCODE = '22023';
      END IF;
      IF v_vat_due = 'date' THEN
        v_vat_date := public.installment_json_day(p_vat->'due_date', 'invalid_vat_date');
        IF v_vat_date IS NULL THEN
          RAISE EXCEPTION 'invalid_vat_date' USING ERRCODE = '22023';
        END IF;
      END IF;

      v_vat_title := NULLIF(btrim(COALESCE(p_vat->>'title', '')), '');
      v_vat_note := NULLIF(btrim(COALESCE(p_vat->>'note', '')), '');
      IF char_length(v_vat_title) > 80 OR char_length(v_vat_note) > 200 THEN
        RAISE EXCEPTION 'invalid_vat' USING ERRCODE = '22023';
      END IF;

      v_vat_paid_on := public.installment_json_day(p_vat->'paid_on', 'invalid_paid_on');
      IF v_vat_paid_on > public.saudi_today() THEN
        RAISE EXCEPTION 'invalid_paid_on' USING ERRCODE = '22023';
      END IF;
      v_vat_method := COALESCE(p_vat->>'method', 'transfer');
      IF v_vat_paid_on IS NOT NULL
         AND v_vat_method NOT IN ('transfer', 'cheque', 'auto_debit', 'cash') THEN
        RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  -- The VAT is inside the typed total: it adds nothing.
  IF v_vat_mode = 'inside' THEN
    v_vat := round(v_total * 15 / 115, 2);
  ELSIF v_vat_mode = 'separate' THEN
    IF v_vat <= 0 OR v_vat >= v_total THEN
      RAISE EXCEPTION 'invalid_vat_amount' USING ERRCODE = '22023';
    END IF;
    -- A fully paid one keeps its day.
    IF NOT v_new AND c.vat_mode = 'separate'
       AND v_vat_row.paid_amount >= v_vat_row.amount THEN
      v_vat_due := c.vat_due;
      v_vat_date := c.vat_due_date;
    END IF;
  ELSE
    v_vat := 0;
  END IF;

  IF v_vat_row.paid_amount > 0 THEN
    IF v_vat_mode <> 'separate' OR v_vat <> v_vat_row.amount OR v_vat_paid_on IS NOT NULL THEN
      RAISE EXCEPTION 'contract_has_payments' USING ERRCODE = '55000';
    END IF;
  END IF;

  -- What a percentage is of.
  v_rate_base := v_total - CASE WHEN v_vat_mode = 'separate' THEN v_vat ELSE 0 END;

  -- The first payments --------------------------------------------------------
  v_input := p_first_payments;
  IF v_input IS NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'rate', s.rate,
      'amount', CASE WHEN s.rate IS NULL THEN s.amount END,
      'due_date', s.due_date,
      'note', s.note
    ) ORDER BY s.seq), '[]'::jsonb)
    INTO v_input
    FROM public.installment_schedule s
    WHERE s.contract_id = p_id AND s.kind = 'first_payment';
  END IF;
  IF jsonb_typeof(v_input) <> 'array' THEN
    RAISE EXCEPTION 'invalid_first_payments' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_input) > 100 THEN
    RAISE EXCEPTION 'invalid_first_payments' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_input) WITH ORDINALITY AS e(value, n) ORDER BY e.n
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'invalid_first_payment' USING ERRCODE = '22023';
    END IF;
    v_title := btrim(COALESCE(v_item->>'title', ''));
    v_row_note := NULLIF(btrim(COALESCE(v_item->>'note', '')), '');
    IF v_title = '' OR char_length(v_title) > 80 OR char_length(v_row_note) > 200 THEN
      RAISE EXCEPTION 'invalid_first_payment' USING ERRCODE = '22023';
    END IF;

    v_rate := NULL;
    IF jsonb_typeof(v_item->'rate') = 'number'
       AND COALESCE(jsonb_typeof(v_item->'amount'), 'null') = 'null' THEN
      v_rate := (v_item->>'rate')::numeric;
      IF v_rate <= 0 OR v_rate >= 100 OR round(v_rate, 4) <> v_rate THEN
        RAISE EXCEPTION 'invalid_first_payment' USING ERRCODE = '22023';
      END IF;
      v_base := round(v_rate_base * v_rate / 100, 2);
    ELSIF jsonb_typeof(v_item->'amount') = 'number'
       AND COALESCE(jsonb_typeof(v_item->'rate'), 'null') = 'null' THEN
      v_base := round((v_item->>'amount')::numeric, 2);
    ELSE
      RAISE EXCEPTION 'invalid_first_payment' USING ERRCODE = '22023';
    END IF;
    IF v_base <= 0 OR v_base > 999999999999.99 THEN
      RAISE EXCEPTION 'invalid_first_payment' USING ERRCODE = '22023';
    END IF;

    v_due := public.installment_json_day(v_item->'due_date', 'invalid_first_payment_date');
    v_paid_on := public.installment_json_day(v_item->'paid_on', 'invalid_paid_on');
    IF v_paid_on > public.saudi_today() THEN
      RAISE EXCEPTION 'invalid_paid_on' USING ERRCODE = '22023';
    END IF;
    v_method := COALESCE(v_item->>'method', 'transfer');
    IF v_paid_on IS NOT NULL
       AND v_method NOT IN ('transfer', 'cheque', 'auto_debit', 'cash') THEN
      RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
    END IF;

    v_row_id := NULL;
    IF COALESCE(jsonb_typeof(v_item->'id'), 'null') <> 'null' THEN
      SELECT * INTO v_old FROM public.installment_schedule s
      WHERE s.contract_id = p_id AND s.kind = 'first_payment'
        AND s.id::text = v_item->>'id';
      IF NOT FOUND OR v_old.id = ANY (v_keep) THEN
        RAISE EXCEPTION 'invalid_first_payment' USING ERRCODE = '22023';
      END IF;
      v_row_id := v_old.id;
      v_keep := v_keep || v_old.id;
      IF v_old.paid_amount > 0 THEN
        IF v_base <> v_old.amount OR v_paid_on IS NOT NULL THEN
          RAISE EXCEPTION 'first_payment_locked' USING ERRCODE = '55000';
        END IF;
        IF v_old.paid_amount >= v_old.amount THEN
          v_due := v_old.due_date;
        END IF;
      END IF;
    END IF;

    v_first_total := v_first_total + v_base;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', v_row_id, 'title', v_title, 'note', v_row_note, 'rate', v_rate,
      'amount', v_base, 'due', v_due,
      'paid_on', v_paid_on, 'method', v_method
    ));
  END LOOP;

  IF NOT v_new AND EXISTS (
    SELECT 1 FROM public.installment_schedule s
    WHERE s.contract_id = c.id AND s.kind = 'first_payment'
      AND s.paid_amount > 0 AND NOT (s.id = ANY (v_keep))
  ) THEN
    RAISE EXCEPTION 'first_payment_locked' USING ERRCODE = '55000';
  END IF;

  -- What is left to divide ----------------------------------------------------
  v_installments := v_rate_base - v_prepaid - v_first_total;
  IF v_installments <= 0 THEN
    IF v_first_total > 0 THEN
      RAISE EXCEPTION 'invalid_first_payments' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'invalid_down_payment' USING ERRCODE = '22023';
  END IF;
  PERFORM public.assert_installment_division(
    v_installments, v_balloon, p_installment_count, p_frequency_months
  );

  IF v_new THEN
    v_division_changed := true;
  ELSE
    v_division_changed :=
      v_installments IS DISTINCT FROM c.installments_amount
      OR v_balloon IS DISTINCT FROM c.balloon_amount
      OR p_installment_count IS DISTINCT FROM c.installment_count
      OR p_frequency_months IS DISTINCT FROM c.frequency_months::integer
      OR p_first_due_date IS DISTINCT FROM c.first_due_date;

    -- none <-> inside moves no amount, so it stays open.
    IF (
      v_division_changed
      OR v_total IS DISTINCT FROM c.total_amount
      OR v_prepaid IS DISTINCT FROM c.down_payment
      OR (v_vat_mode = 'separate') <> (c.vat_mode = 'separate')
      OR (v_vat_mode = 'separate' AND v_vat IS DISTINCT FROM c.vat_amount)
    ) AND EXISTS (
      SELECT 1 FROM public.installment_schedule s
      WHERE s.contract_id = c.id AND s.kind = 'installment' AND s.paid_amount > 0
    ) THEN
      RAISE EXCEPTION 'contract_has_payments' USING ERRCODE = '55000';
    END IF;
  END IF;

  -- The writes ----------------------------------------------------------------
  IF v_new THEN
    INSERT INTO public.installment_contracts (
      contract_number, description, financier_id, total_amount, down_payment,
      balloon_amount, installment_count, frequency_months, first_due_date,
      notes, created_by, bank_name, iban,
      vat_mode, vat_due, vat_amount, vat_due_date, installments_amount
    ) VALUES (
      public.next_installment_contract_number(), v_description, p_financier_id,
      v_total, v_prepaid, v_balloon, p_installment_count, p_frequency_months,
      p_first_due_date, v_notes, auth.uid(), v_bank, v_iban,
      v_vat_mode, v_vat_due, v_vat, v_vat_date, v_installments
    )
    RETURNING id INTO v_id;
  ELSE
    v_id := c.id;
    UPDATE public.installment_contracts SET
      description = v_description,
      financier_id = p_financier_id,
      total_amount = v_total,
      down_payment = v_prepaid,
      balloon_amount = v_balloon,
      installment_count = p_installment_count,
      frequency_months = p_frequency_months,
      first_due_date = p_first_due_date,
      first_due_set_at = CASE
        WHEN p_first_due_date IS NULL THEN NULL
        WHEN p_first_due_date IS DISTINCT FROM c.first_due_date THEN now()
        ELSE c.first_due_set_at END,
      first_due_set_by = CASE
        WHEN p_first_due_date IS NULL THEN NULL
        WHEN p_first_due_date IS DISTINCT FROM c.first_due_date THEN auth.uid()
        ELSE c.first_due_set_by END,
      vat_mode = v_vat_mode,
      vat_due = v_vat_due,
      vat_amount = v_vat,
      vat_due_date = v_vat_date,
      installments_amount = v_installments,
      notes = v_notes,
      bank_name = CASE WHEN v_account_set THEN v_bank ELSE c.bank_name END,
      iban = CASE WHEN v_account_set THEN v_iban ELSE c.iban END
    WHERE id = c.id;

    DELETE FROM public.installment_schedule s
    WHERE s.contract_id = v_id AND s.kind = 'first_payment' AND NOT (s.id = ANY (v_keep));
    -- Out of the way, so the rows can take their new order.
    UPDATE public.installment_schedule
    SET seq = seq + 1000
    WHERE contract_id = v_id AND kind = 'first_payment';
  END IF;

  IF v_division_changed THEN
    PERFORM public.generate_installment_schedule(v_id);
  END IF;
  PERFORM public.sync_installment_vat_row(v_id);
  IF v_vat_mode = 'separate' THEN
    UPDATE public.installment_schedule
    SET title = v_vat_title, note = v_vat_note
    WHERE contract_id = v_id AND kind = 'vat';
  END IF;

  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS e(value, n) ORDER BY e.n
  LOOP
    v_seq := v_seq + 1;
    v_row_id := (v_item->>'id')::uuid;
    v_base := (v_item->>'amount')::numeric;
    IF v_row_id IS NULL THEN
      INSERT INTO public.installment_schedule (
        contract_id, kind, seq, title, note, rate, amount, due_date
      ) VALUES (
        v_id, 'first_payment', v_seq, v_item->>'title', v_item->>'note',
        (v_item->>'rate')::numeric, v_base,
        (v_item->>'due')::date
      )
      RETURNING id INTO v_row_id;
    ELSE
      UPDATE public.installment_schedule SET
        seq = v_seq,
        title = v_item->>'title',
        note = v_item->>'note',
        rate = (v_item->>'rate')::numeric,
        amount = v_base,
        due_date = (v_item->>'due')::date
      WHERE id = v_row_id;
    END IF;

    IF v_item->>'paid_on' IS NOT NULL THEN
      v_payments := v_payments || jsonb_build_array(v_item || jsonb_build_object('id', v_row_id));
    END IF;
  END LOOP;

  IF v_vat_paid_on IS NOT NULL THEN
    v_payments := v_payments || jsonb_build_array(jsonb_build_object(
      'id', (SELECT s.id FROM public.installment_schedule s WHERE s.contract_id = v_id AND s.kind = 'vat'),
      'amount', v_vat, 'paid_on', v_vat_paid_on, 'method', v_vat_method
    ));
  END IF;

  -- «مدفوعة» is an ordinary payment: voided and receipted like any other.
  -- Recorded once every row exists, so paying one never closes the contract
  -- over a row still to be written.
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_payments) WITH ORDINALITY AS e(value, n) ORDER BY e.n
  LOOP
    PERFORM public.record_installment_payment(
      v_id, (v_item->>'paid_on')::date, (v_item->>'amount')::numeric, v_item->>'method',
      NULL, NULL, (v_item->>'id')::uuid
    );
  END LOOP;

  DELETE FROM public.installment_contract_equipment ce
  WHERE ce.contract_id = v_id AND NOT (ce.equipment_id = ANY (v_units));
  INSERT INTO public.installment_contract_equipment (contract_id, equipment_id)
  SELECT v_id, u FROM unnest(v_units) AS u
  ON CONFLICT (contract_id, equipment_id) DO NOTHING;

  -- 0210: the items, replaced whole when sent.
  IF v_items IS NOT NULL THEN
    DELETE FROM public.installment_contract_items WHERE contract_id = v_id;
    INSERT INTO public.installment_contract_items (contract_id, position, name, quantity)
    SELECT v_id, e.n::integer, e.value->>'name', (e.value->>'quantity')::numeric
    FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(value, n);
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.save_installment_contract(uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[], jsonb, jsonb, jsonb, text, jsonb) IS
  '0203 / 0208 / 0209, re-created 0210: creates or edits a contract with its first payments, VAT, installments (none while p_first_due_date is NULL), units and items in one transaction. p_total_amount is everything to pay, the VAT inside it. p_down_payment is what was paid before entry. A first payment or a separate VAT sent with paid_on records an ordinary payment. p_items: SQL NULL keeps the items, an array replaces them. p_expected_key refuses a save over a changed contract (contract_changed). installments.manage.';

REVOKE ALL ON FUNCTION public.save_installment_contract(uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[], jsonb, jsonb, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_installment_contract(uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[], jsonb, jsonb, jsonb, text, jsonb)
  TO authenticated;

-- ===========================================================================
-- 4. Deleting a cancelled contract archives its items
-- ===========================================================================
ALTER TABLE public.installment_contract_deletions
  ADD COLUMN items jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.delete_installment_contract(p_contract_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
  v_paths text[];
BEGIN
  PERFORM public.assert_installments_manage();

  IF p_contract_id IS NULL THEN
    RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c FROM public.installment_contracts
  WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
  END IF;
  IF c.status <> 'cancelled' THEN
    RAISE EXCEPTION 'contract_not_cancelled' USING ERRCODE = '55000';
  END IF;
  -- Cannot happen through the functions (cancel refuses a posted payment and
  -- payments are recorded on active contracts only); kept as a guard.
  IF EXISTS (
    SELECT 1 FROM public.installment_payments p
    WHERE p.contract_id = c.id AND p.status = 'posted'
  ) THEN
    RAISE EXCEPTION 'contract_has_payments' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.installment_contract_deletions (
    contract_id, contract_number, contract, schedule, payments, allocations,
    equipment, receipts, files, items, deleted_by, deleted_by_name
  )
  SELECT
    c.id,
    c.contract_number,
    to_jsonb(c),
    COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.seq)
              FROM public.installment_schedule s WHERE s.contract_id = c.id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at, p.id)
              FROM public.installment_payments p WHERE p.contract_id = c.id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(to_jsonb(a))
              FROM public.installment_payment_allocations a
              JOIN public.installment_payments p ON p.id = a.payment_id
              WHERE p.contract_id = c.id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(to_jsonb(e))
              FROM public.installment_contract_equipment e WHERE e.contract_id = c.id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(to_jsonb(r))
              FROM public.installment_payment_receipts r
              JOIN public.installment_payments p ON p.id = r.payment_id
              WHERE p.contract_id = c.id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(to_jsonb(cf) ORDER BY cf.created_at, cf.id)
              FROM public.installment_contract_files cf WHERE cf.contract_id = c.id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(to_jsonb(ci) ORDER BY ci.position)
              FROM public.installment_contract_items ci WHERE ci.contract_id = c.id), '[]'::jsonb),
    auth.uid(),
    (SELECT pn.full_name FROM public.profile_names pn WHERE pn.id = auth.uid());

  SELECT COALESCE(array_agg(r.storage_path ORDER BY r.storage_path), ARRAY[]::text[])
  INTO v_paths
  FROM public.installment_payment_receipts r
  JOIN public.installment_payments p ON p.id = r.payment_id
  WHERE p.contract_id = c.id;

  -- The receipt rows first (their FK to the payment is RESTRICT), then the
  -- payments (their allocations cascade), the unit links, and the contract
  -- (its schedule cascades).
  DELETE FROM public.installment_payment_receipts r
  USING public.installment_payments p
  WHERE p.id = r.payment_id AND p.contract_id = c.id;
  DELETE FROM public.installment_payments WHERE contract_id = c.id;
  DELETE FROM public.installment_contract_equipment WHERE contract_id = c.id;
  -- 0209: its file rows (the client removes the objects afterwards).
  DELETE FROM public.installment_contract_files WHERE contract_id = c.id;
  DELETE FROM public.installment_contracts WHERE id = c.id;

  RETURN v_paths;
END;
$$;

COMMENT ON FUNCTION public.delete_installment_contract(uuid) IS
  '0207, re-created 0209 / 0210: deletes a CANCELLED contract with its schedule, voided payments, receipt rows, file rows, unit links and items, after copying everything to installment_contract_deletions. Returns the receipt paths; the client removes those and the contract files it listed. installments.manage.';

-- ===========================================================================
-- 5. The readers: the installment's name
-- ===========================================================================
CREATE OR REPLACE VIEW public.installment_dues
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.contract_id,
  c.contract_number,
  c.description,
  c.status AS contract_status,
  c.financier_id,
  f.name AS financier_name,
  s.seq,
  c.installment_count,
  COALESCE(s.due_date, p.last_paid_on) AS due_date,
  s.amount,
  s.paid_amount,
  s.amount - s.paid_amount AS remaining_amount,
  s.is_balloon,
  s.paid_amount > 0 AND s.paid_amount < s.amount AS is_partial,
  s.paid_amount >= s.amount AS is_paid,
  public.installment_state(s.due_date, s.amount, s.paid_amount, public.saudi_today()) AS state,
  COALESCE(s.due_date, p.last_paid_on) - public.saudi_today() AS days_until_due,
  p.last_paid_on,
  s.kind,
  s.title,
  s.note
FROM public.installment_schedule s
JOIN public.installment_contracts c ON c.id = s.contract_id
JOIN public.installment_financiers f ON f.id = c.financier_id
LEFT JOIN LATERAL (
  SELECT max(p0.paid_on) AS last_paid_on
  FROM public.installment_payment_allocations a
  JOIN public.installment_payments p0 ON p0.id = a.payment_id
  WHERE a.schedule_id = s.id AND p0.status = 'posted'
) p ON true
WHERE s.due_date IS NOT NULL OR s.paid_amount >= s.amount;

COMMENT ON VIEW public.installment_dues IS
  '0203 / 0207 / 0209 / 0210: every DATED payable row (installment, first payment or VAT row: kind, title, note — an installment''s name since 0210) with its contract, financier, state and days_until_due, and a fully paid undated first payment or VAT row on the day it was paid. An undated unpaid one and the installments of an undivided contract are no dues. security_invoker.';

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
      s.kind,
      s.title,
      s.note,
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
          'kind', d.kind,
          'title', d.title,
          'note', d.note,
          'due_date', d.due_date,
          'remaining_amount', d.remaining_amount,
          'days_until_due', d.days_until_due
        )
        ORDER BY
          CASE d.bucket WHEN 'overdue' THEN 1 ELSE 2 END,
          d.due_date, d.contract_number, d.kind, d.seq
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

-- ===========================================================================
-- 6. Guards
-- ===========================================================================
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'save_installment_contract'
      AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION '0210: save_installment_contract is not one function';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.installment_contracts c
    WHERE c.installments_amount <> COALESCE((
            SELECT sum(s.amount) FROM public.installment_schedule s
            WHERE s.contract_id = c.id AND s.kind = 'installment'), 0)
  ) THEN
    RAISE EXCEPTION '0210: a contract does not add up';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
