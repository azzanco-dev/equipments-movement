-- 0209: first payments, a first due date that may be unknown, VAT, and the
-- contract's files.
--
-- Owner 2026-11-22 (plan approved «اعتمد وارسم», drawing approved «اعتمد
-- وابني»):
--   * «ارفاق ملف العقد», «حد الملف 5 ميقا»: several files per contract.
--   * «تحديد الدفعات, ممكن تكون فيه دفعة اولى او دفعتين , وكل دفعة ابغى احدد
--     اذا كانت مبلغ مقطوع او نسبة», «خليها نفس فكرة اضافة التسعيرات»: rows,
--     a percentage is always of the contract's total.
--   * «ممكن تاريخ اول قسط مايكون متاح في البداية, فتصير تقسم القسط لما احط
--     تاريخ اول قسط», «الدفعة الاولى ممكن تندفع, لكن تاريخ اول قسط مايتحدد».
--   * «ابغى احدد اذا كانت الاقساط شاملة الضريبة او غير شاملة», then «اذا كان
--     غير شامل مش معناه اني بحسب كل قسط 15بالمية لكن بعضهم يقول غير شامل ,
--     بحيث مبلغ الضريبة يكون نهاية القسط»: exclusive has two timings.
--
-- ===========================================================================
-- The model
-- ===========================================================================
--   installment_schedule holds every payable row, told apart by `kind`:
--     first_payment  a first payment (title, optional rate, base_amount);
--                    due_date may be NULL; payable whether dated or not.
--     installment    the generated installments. They exist ONLY while the
--                    contract has a first_due_date.
--     vat            the one VAT row of «في نهاية الاقساط», once it has a
--                    date (its own, else the last installment's).
--   seq counts inside a kind, so «القسط 1 من 24» never counts a payment.
--
--   installment_contracts:
--     total_amount         as typed (before VAT when exclusive).
--     down_payment         KEEPS ITS NAME, reads «مدفوع قبل التسجيل»: what
--                          was paid before the contract was entered, as paid.
--     vat_mode             unspecified (every earlier contract) / inclusive /
--                          exclusive / exempt.
--     vat_timing           exclusive only: each / end.
--     vat_amount           what is added to total_amount: each = 15% of the
--                          total; end = as typed (15% when not given); 0
--                          otherwise. Payable = total_amount + vat_amount.
--     installments_amount  what the installments add up to, as payable.
--
--   Arithmetic (halalas, ties away from zero):
--     each: every first payment, the final payment and the division are with
--           VAT: installments = total + vat - prepaid - first payments.
--     else: installments = total - prepaid - first payments; `end` adds the
--           VAT row.
--   So for a scheduled contract the rows always add up to
--   payable - prepaid, to the halala.
--
--   Locks (a posted payment no longer locks the whole contract):
--     * a first payment with money on it keeps its amount and cannot be
--       removed (first_payment_locked); its title and note stay editable.
--     * once an installment has money on it, the total, prepaid, VAT, final
--       payment, count, frequency, first due date and the amount to divide
--       are fixed (contract_has_payments).
--     * once the VAT row has money on it, its amount and timing are fixed;
--       its day still follows the installments until it is fully paid.
--
--   An edit says which version it read (installment_contract_edit_key,
--   p_expected_key): a save over a contract that changed meanwhile is
--   refused (contract_changed), so an old page never takes back a first
--   due date, a payment row or a date that was set after it loaded.
--   Dividing again deletes `installment` rows only, and those carry no
--   posted money: a first payment keeps its allocations and receipts.
--
--   A contract turns paid_off only once it is scheduled and every row is
--   paid. Before that a payment cannot pass the existing rows
--   (installments_not_scheduled).
--
-- Every parameter added to a function has a default, so the screens that are
-- live until the deploy keep working on the contracts they create.
--
-- New tokens
--   22023: invalid_vat, invalid_vat_timing, invalid_vat_amount,
--          invalid_vat_date, invalid_first_payment, invalid_first_payments,
--          invalid_first_payment_date, invalid_schedule_row,
--          installments_not_scheduled, invalid_contract_file
--   55000: first_payment_locked, contract_changed, contract_file_missing,
--          contract_file_not_found
--
-- Rollout: apply 0209 BEFORE deploying the screens that read these columns.

DO $$
BEGIN
  IF to_regprocedure('public.save_installment_contract(uuid,text,uuid,numeric,numeric,numeric,integer,integer,date,text,uuid[],jsonb)') IS NULL THEN
    RAISE EXCEPTION '0209: migration 0208 must be applied first';
  END IF;
END;
$$;

-- ===========================================================================
-- 1. Columns
-- ===========================================================================
ALTER TABLE public.installment_contracts
  ALTER COLUMN first_due_date DROP NOT NULL,
  ADD COLUMN vat_mode text NOT NULL DEFAULT 'unspecified'
    CONSTRAINT installment_contracts_vat_mode_check
      CHECK (vat_mode IN ('unspecified', 'inclusive', 'exclusive', 'exempt')),
  ADD COLUMN vat_timing text
    CONSTRAINT installment_contracts_vat_timing_check
      CHECK (vat_timing IN ('each', 'end')),
  ADD COLUMN vat_amount numeric(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT installment_contracts_vat_amount_check CHECK (vat_amount >= 0),
  ADD COLUMN vat_due_date date,
  ADD COLUMN installments_amount numeric(14, 2),
  ADD COLUMN first_due_set_at timestamptz,
  ADD COLUMN first_due_set_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Nobody edited a contract: «اخر تعديل» must not move.
ALTER TABLE public.installment_contracts DISABLE TRIGGER installment_contracts_updated_at;
UPDATE public.installment_contracts SET installments_amount = financed_amount;
ALTER TABLE public.installment_contracts ENABLE TRIGGER installment_contracts_updated_at;

ALTER TABLE public.installment_contracts
  ALTER COLUMN installments_amount SET NOT NULL,
  ADD CONSTRAINT installment_contracts_installments_amount_check
    CHECK (installments_amount > 0),
  ADD CONSTRAINT installment_contracts_vat_shape CHECK (
    ((vat_mode = 'exclusive') = (vat_timing IS NOT NULL))
    AND (vat_mode = 'exclusive' OR vat_amount = 0)
    AND (vat_due_date IS NULL OR vat_timing IS NOT DISTINCT FROM 'end')
  ),
  -- Prepaid is typed as paid, so with VAT it may pass the total before VAT.
  DROP CONSTRAINT installment_contracts_down_payment_lt_total,
  ADD CONSTRAINT installment_contracts_prepaid_lt_payable
    CHECK (down_payment < total_amount + vat_amount),
  -- The final payment is checked against installments_amount by the function.
  DROP CONSTRAINT installment_contracts_balloon_shape,
  ADD CONSTRAINT installment_contracts_balloon_count
    CHECK (balloon_amount = 0 OR installment_count >= 2);

COMMENT ON COLUMN public.installment_contracts.down_payment IS
  '0203, meaning since 0209: «مدفوع قبل التسجيل», what was paid before the contract was entered, as paid (no VAT is added to it). Counts as paid; no payment row.';
COMMENT ON COLUMN public.installment_contracts.installments_amount IS
  '0209: what the installments add up to, as payable (with VAT when vat_timing = each), whether they are scheduled yet or not.';
COMMENT ON COLUMN public.installment_contracts.first_due_date IS
  '0209: NULL = the contract waits for its first due date and has no installment rows yet.';

ALTER TABLE public.installment_schedule
  ALTER COLUMN due_date DROP NOT NULL,
  ADD COLUMN kind text NOT NULL DEFAULT 'installment'
    CONSTRAINT installment_schedule_kind_check
      CHECK (kind IN ('first_payment', 'installment', 'vat')),
  ADD COLUMN title text
    CONSTRAINT installment_schedule_title_check
      CHECK (char_length(title) BETWEEN 1 AND 80),
  ADD COLUMN note text
    CONSTRAINT installment_schedule_note_check CHECK (char_length(note) <= 200),
  ADD COLUMN rate numeric(7, 4)
    CONSTRAINT installment_schedule_rate_check CHECK (rate > 0 AND rate < 100),
  ADD COLUMN base_amount numeric(14, 2),
  ADD COLUMN vat_amount numeric(14, 2) NOT NULL DEFAULT 0,
  DROP CONSTRAINT installment_schedule_unique,
  ADD CONSTRAINT installment_schedule_unique UNIQUE (contract_id, kind, seq),
  ADD CONSTRAINT installment_schedule_due_check
    CHECK (due_date IS NOT NULL OR kind = 'first_payment'),
  ADD CONSTRAINT installment_schedule_first_payment_shape CHECK (
    CASE WHEN kind = 'first_payment'
      THEN title IS NOT NULL AND base_amount IS NOT NULL
      ELSE title IS NULL AND note IS NULL AND rate IS NULL AND base_amount IS NULL
    END
  );

CREATE UNIQUE INDEX installment_schedule_one_vat
  ON public.installment_schedule (contract_id) WHERE kind = 'vat';

-- ===========================================================================
-- 2. Small helpers, executable by nobody
-- ===========================================================================
CREATE FUNCTION public.installment_with_vat(p_amount numeric, p_timing text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_timing = 'each'
    THEN p_amount + round(p_amount * 15 / 100, 2)
    ELSE p_amount
  END;
$$;

COMMENT ON FUNCTION public.installment_with_vat(numeric, text) IS
  '0209: an amount as payable: plus its 15% only when the VAT is paid with each payment.';

REVOKE ALL ON FUNCTION public.installment_with_vat(numeric, text)
  FROM PUBLIC, anon, authenticated;

-- A day out of JSON: JSON null or a missing key = NULL, else YYYY-MM-DD.
CREATE FUNCTION public.installment_json_day(p_value jsonb, p_token text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_text text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RETURN NULL;
  END IF;
  v_text := p_value #>> '{}';
  IF jsonb_typeof(p_value) <> 'string' OR v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION '%', p_token USING ERRCODE = '22023';
  END IF;
  BEGIN
    RETURN make_date(
      substr(v_text, 1, 4)::integer,
      substr(v_text, 6, 2)::integer,
      substr(v_text, 9, 2)::integer
    );
  EXCEPTION WHEN datetime_field_overflow THEN
    RAISE EXCEPTION '%', p_token USING ERRCODE = '22023';
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.installment_json_day(jsonb, text)
  FROM PUBLIC, anon, authenticated;

-- The shape of the division: how many, how often, and the final payment.
CREATE FUNCTION public.assert_installment_division(
  p_amount numeric,
  p_final numeric,
  p_count integer,
  p_frequency integer
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_count IS NULL OR p_count < 1 OR p_count > 360 THEN
    RAISE EXCEPTION 'invalid_installment_count' USING ERRCODE = '22023';
  END IF;
  IF p_frequency IS NULL OR p_frequency NOT IN (1, 2, 3, 6, 12) THEN
    RAISE EXCEPTION 'invalid_frequency' USING ERRCODE = '22023';
  END IF;
  IF p_final < 0 OR (p_final > 0 AND (p_count < 2 OR p_final >= p_amount)) THEN
    RAISE EXCEPTION 'invalid_balloon' USING ERRCODE = '22023';
  END IF;
  -- Each regular payment is at least one halala.
  IF trunc((p_amount - p_final)
           / (p_count - CASE WHEN p_final > 0 THEN 1 ELSE 0 END), 2) <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_installment_division(numeric, numeric, integer, integer)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 3. The two generated parts of a schedule
-- ===========================================================================
-- Months are added to the FIRST due date (not chained), so a 31st stays the
-- month end. Only `installment` rows are rebuilt.
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

  DELETE FROM public.installment_schedule
  WHERE contract_id = c.id AND kind = 'installment';

  IF c.first_due_date IS NULL THEN
    RETURN;
  END IF;

  v_final := public.installment_with_vat(c.balloon_amount, c.vat_timing);
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
      contract_id, kind, seq, due_date, amount, is_balloon, vat_amount
    ) VALUES (
      c.id,
      'installment',
      v_i,
      (c.first_due_date + make_interval(months => (v_i - 1) * c.frequency_months))::date,
      v_amount,
      v_i > v_regular_count,
      CASE WHEN c.vat_timing = 'each' THEN round(v_amount * 15 / 115, 2) ELSE 0 END
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.generate_installment_schedule(uuid) IS
  '0203, re-created 0209: rebuilds the INSTALLMENT rows of a contract from installments_amount (none while first_due_date is NULL); first payments and the VAT row are never touched. Executable by nobody.';

-- The VAT row of «في نهاية الاقساط». With money on it the amount stays and
-- only the day follows, until it is fully paid.
CREATE FUNCTION public.sync_installment_vat_row(p_contract_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
  v_row public.installment_schedule%ROWTYPE;
  v_due date;
BEGIN
  SELECT * INTO c FROM public.installment_contracts WHERE id = p_contract_id;
  SELECT * INTO v_row FROM public.installment_schedule
  WHERE contract_id = p_contract_id AND kind = 'vat';
  IF c.vat_timing = 'end' THEN
    v_due := COALESCE(
      c.vat_due_date,
      (c.first_due_date
        + make_interval(months => (c.installment_count - 1) * c.frequency_months))::date
    );
  END IF;

  IF v_row.paid_amount > 0 THEN
    IF v_due IS NOT NULL THEN
      UPDATE public.installment_schedule
      SET due_date = v_due
      WHERE id = v_row.id AND paid_amount < amount AND due_date IS DISTINCT FROM v_due;
    END IF;
    RETURN;
  END IF;

  IF v_due IS NULL THEN
    DELETE FROM public.installment_schedule
    WHERE contract_id = p_contract_id AND kind = 'vat';
  ELSIF v_row.id IS NULL THEN
    INSERT INTO public.installment_schedule (contract_id, kind, seq, due_date, amount)
    VALUES (p_contract_id, 'vat', 1, v_due, c.vat_amount);
  ELSE
    UPDATE public.installment_schedule
    SET due_date = v_due, amount = c.vat_amount
    WHERE id = v_row.id
      AND (due_date IS DISTINCT FROM v_due OR amount IS DISTINCT FROM c.vat_amount);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_installment_vat_row(uuid)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 4. Recording a payment: an optional row to pay first
-- ===========================================================================
DROP FUNCTION public.record_installment_payment(uuid, date, numeric, text, text, text);

CREATE FUNCTION public.record_installment_payment(
  p_contract_id uuid,
  p_paid_on date,
  p_amount numeric,
  p_method text,
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_schedule_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
  v_amount numeric(14, 2);
  v_left numeric(14, 2);
  v_open numeric;
  v_remaining numeric;
  v_take numeric(14, 2);
  v_reference text;
  v_note text;
  v_payment_id uuid;
  r record;
BEGIN
  PERFORM public.assert_installments_manage();

  SELECT * INTO c FROM public.installment_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
  END IF;
  IF c.status <> 'active' THEN
    RAISE EXCEPTION 'contract_not_active' USING ERRCODE = '55000';
  END IF;
  IF p_paid_on IS NULL OR p_paid_on > public.saudi_today() THEN
    RAISE EXCEPTION 'invalid_paid_on' USING ERRCODE = '22023';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('transfer', 'cheque', 'auto_debit', 'cash') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  v_reference := NULLIF(btrim(COALESCE(p_reference, '')), '');
  IF char_length(v_reference) > 80 THEN
    RAISE EXCEPTION 'invalid_reference' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 999999999999.99
     OR round(p_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'invalid_payment_amount' USING ERRCODE = '22023';
  END IF;
  v_amount := round(p_amount, 2);

  IF p_schedule_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.installment_schedule s
    WHERE s.id = p_schedule_id AND s.contract_id = c.id AND s.paid_amount < s.amount
  ) THEN
    RAISE EXCEPTION 'invalid_schedule_row' USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(sum(s.amount - s.paid_amount), 0),
    c.total_amount + c.vat_amount - c.down_payment - COALESCE(sum(s.paid_amount), 0)
  INTO v_open, v_remaining
  FROM public.installment_schedule s WHERE s.contract_id = c.id;

  IF v_amount > v_open THEN
    IF c.first_due_date IS NULL AND v_amount <= v_remaining THEN
      RAISE EXCEPTION 'installments_not_scheduled' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'payment_exceeds_balance' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.installment_payments (
    contract_id, paid_on, amount, method, reference, note, created_by
  ) VALUES (
    c.id, p_paid_on, v_amount, p_method, v_reference, v_note, auth.uid()
  )
  RETURNING id INTO v_payment_id;

  -- The chosen row, then the oldest due, then the undated first payments.
  v_left := v_amount;
  FOR r IN
    SELECT s.id, s.amount - s.paid_amount AS open_amount
    FROM public.installment_schedule s
    WHERE s.contract_id = c.id AND s.paid_amount < s.amount
    ORDER BY
      CASE WHEN s.id = p_schedule_id THEN 0 ELSE 1 END,
      s.due_date NULLS LAST, s.kind, s.seq
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(v_left, r.open_amount);
    UPDATE public.installment_schedule SET paid_amount = paid_amount + v_take WHERE id = r.id;
    INSERT INTO public.installment_payment_allocations (payment_id, schedule_id, amount)
    VALUES (v_payment_id, r.id, v_take);
    v_left := v_left - v_take;
  END LOOP;

  -- A contract still waiting for its division is never paid off.
  IF v_amount = v_open AND c.first_due_date IS NOT NULL THEN
    UPDATE public.installment_contracts SET status = 'paid_off', closed_at = now() WHERE id = c.id;
  END IF;

  RETURN v_payment_id;
END;
$$;

COMMENT ON FUNCTION public.record_installment_payment(uuid, date, numeric, text, text, text, uuid) IS
  '0203, re-created 0209: records a payment and allocates it to p_schedule_id first (when given), then the oldest due rows, then the undated first payments. Before the division it cannot pass the existing rows (installments_not_scheduled) and never closes the contract. installments.manage.';

REVOKE ALL ON FUNCTION public.record_installment_payment(uuid, date, numeric, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_installment_payment(uuid, date, numeric, text, text, text, uuid)
  TO authenticated;

-- ===========================================================================
-- 5. Saving a contract
-- ===========================================================================
-- What an edit is based on. updated_at is left out (a file upload moves it),
-- and of the installments only whether money is on them.
CREATE FUNCTION public.installment_contract_edit_key(p_contract_id uuid)
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
    )
  )::text)
  FROM public.installment_contracts c
  WHERE c.id = p_contract_id
$$;

COMMENT ON FUNCTION public.installment_contract_edit_key(uuid) IS
  '0209: the version of a contract an edit is based on (save_installment_contract p_expected_key). Security invoker: RLS decides.';

REVOKE ALL ON FUNCTION public.installment_contract_edit_key(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.installment_contract_edit_key(uuid) TO authenticated;

DROP FUNCTION public.save_installment_contract(
  uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[], jsonb
);
DROP FUNCTION public.assert_installment_terms(numeric, numeric, numeric, integer, integer, date);

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
  -- {mode, timing, amount, due_date}; SQL NULL keeps the stored VAT.
  p_vat jsonb DEFAULT NULL,
  -- [{id, title, rate | amount, due_date, note, paid_on, method}] in their
  -- order; SQL NULL keeps the stored rows, [] removes them.
  p_first_payments jsonb DEFAULT NULL,
  -- installment_contract_edit_key as the edit page read it; NULL = no check.
  p_expected_key text DEFAULT NULL
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
  v_final numeric;
  v_installments numeric;
  v_units uuid[];
  v_account_set boolean := false;
  v_bank text;
  v_iban text;
  v_vat_mode text := 'unspecified';
  v_vat_timing text;
  v_vat numeric := 0;
  v_vat_due date;
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
  v_gross numeric;
  v_first_total numeric := 0;
  v_due date;
  v_paid_on date;
  v_method text;
  v_division_changed boolean;
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

  -- VAT -----------------------------------------------------------------------
  IF p_vat IS NULL THEN
    IF NOT v_new THEN
      v_vat_mode := c.vat_mode;
      v_vat_timing := c.vat_timing;
      v_vat := c.vat_amount;
      v_vat_due := c.vat_due_date;
    END IF;
  ELSE
    IF jsonb_typeof(p_vat) <> 'object'
       OR COALESCE(p_vat->>'mode', '') NOT IN ('unspecified', 'inclusive', 'exclusive', 'exempt') THEN
      RAISE EXCEPTION 'invalid_vat' USING ERRCODE = '22023';
    END IF;
    v_vat_mode := p_vat->>'mode';
    -- «غير محدد» is what the earlier contracts are, never a choice.
    IF v_vat_mode = 'unspecified' AND (v_new OR c.vat_mode <> 'unspecified') THEN
      RAISE EXCEPTION 'invalid_vat' USING ERRCODE = '22023';
    END IF;
    IF v_vat_mode = 'exclusive' THEN
      v_vat_timing := p_vat->>'timing';
      IF COALESCE(v_vat_timing, '') NOT IN ('each', 'end') THEN
        RAISE EXCEPTION 'invalid_vat_timing' USING ERRCODE = '22023';
      END IF;
      IF v_vat_timing = 'end' THEN
        IF COALESCE(jsonb_typeof(p_vat->'amount'), 'null') = 'null' THEN
          v_vat := round(v_total * 15 / 100, 2);
        ELSIF jsonb_typeof(p_vat->'amount') = 'number' THEN
          v_vat := round((p_vat->>'amount')::numeric, 2);
        ELSE
          RAISE EXCEPTION 'invalid_vat_amount' USING ERRCODE = '22023';
        END IF;
        IF v_vat <= 0 OR v_vat > v_total THEN
          RAISE EXCEPTION 'invalid_vat_amount' USING ERRCODE = '22023';
        END IF;
        v_vat_due := public.installment_json_day(p_vat->'due_date', 'invalid_vat_date');
      END IF;
    END IF;
  END IF;
  IF v_vat_timing = 'each' THEN
    v_vat := round(v_total * 15 / 100, 2);
  END IF;
  IF v_total + v_vat > 999999999999.99 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;

  -- The first payments --------------------------------------------------------
  v_input := p_first_payments;
  IF v_input IS NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'rate', s.rate,
      'amount', CASE WHEN s.rate IS NULL THEN s.base_amount END,
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
      v_base := round(v_total * v_rate / 100, 2);
    ELSIF jsonb_typeof(v_item->'amount') = 'number'
       AND COALESCE(jsonb_typeof(v_item->'rate'), 'null') = 'null' THEN
      v_base := round((v_item->>'amount')::numeric, 2);
    ELSE
      RAISE EXCEPTION 'invalid_first_payment' USING ERRCODE = '22023';
    END IF;
    IF v_base <= 0 OR v_base > 999999999999.99 THEN
      RAISE EXCEPTION 'invalid_first_payment' USING ERRCODE = '22023';
    END IF;
    v_gross := public.installment_with_vat(v_base, v_vat_timing);

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
        IF v_gross <> v_old.amount OR v_paid_on IS NOT NULL THEN
          RAISE EXCEPTION 'first_payment_locked' USING ERRCODE = '55000';
        END IF;
        IF v_old.paid_amount >= v_old.amount THEN
          v_due := v_old.due_date;
        END IF;
      END IF;
    END IF;
    -- «مدفوعة»: the agreed day stays; without one, the day it was paid.
    v_due := COALESCE(v_due, v_paid_on);

    v_first_total := v_first_total + v_gross;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', v_row_id, 'title', v_title, 'note', v_row_note, 'rate', v_rate,
      'base', v_base, 'gross', v_gross, 'due', v_due,
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
  v_installments := v_total - v_prepaid - v_first_total
    + CASE WHEN v_vat_timing = 'each' THEN v_vat ELSE 0 END;
  IF v_installments <= 0 THEN
    IF v_first_total > 0 THEN
      RAISE EXCEPTION 'invalid_first_payments' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'invalid_down_payment' USING ERRCODE = '22023';
  END IF;
  v_final := public.installment_with_vat(v_balloon, v_vat_timing);
  PERFORM public.assert_installment_division(
    v_installments, v_final, p_installment_count, p_frequency_months
  );

  IF v_new THEN
    v_division_changed := true;
  ELSE
    v_division_changed :=
      v_installments IS DISTINCT FROM c.installments_amount
      OR v_final IS DISTINCT FROM public.installment_with_vat(c.balloon_amount, c.vat_timing)
      OR COALESCE(v_vat_timing = 'each', false) <> COALESCE(c.vat_timing = 'each', false)
      OR p_installment_count IS DISTINCT FROM c.installment_count
      OR p_frequency_months IS DISTINCT FROM c.frequency_months::integer
      OR p_first_due_date IS DISTINCT FROM c.first_due_date;

    IF (
      v_division_changed
      OR v_total IS DISTINCT FROM c.total_amount
      OR v_prepaid IS DISTINCT FROM c.down_payment
      OR v_vat IS DISTINCT FROM c.vat_amount
      OR v_vat_timing IS DISTINCT FROM c.vat_timing
    ) AND EXISTS (
      SELECT 1 FROM public.installment_schedule s
      WHERE s.contract_id = c.id AND s.kind = 'installment' AND s.paid_amount > 0
    ) THEN
      RAISE EXCEPTION 'contract_has_payments' USING ERRCODE = '55000';
    END IF;

    IF (v_vat IS DISTINCT FROM c.vat_amount OR v_vat_timing IS DISTINCT FROM c.vat_timing)
       AND EXISTS (
         SELECT 1 FROM public.installment_schedule s
         WHERE s.contract_id = c.id AND s.kind = 'vat' AND s.paid_amount > 0
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
      vat_mode, vat_timing, vat_amount, vat_due_date, installments_amount
    ) VALUES (
      public.next_installment_contract_number(), v_description, p_financier_id,
      v_total, v_prepaid, v_balloon, p_installment_count, p_frequency_months,
      p_first_due_date, v_notes, auth.uid(), v_bank, v_iban,
      v_vat_mode, v_vat_timing, v_vat, v_vat_due, v_installments
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
      vat_timing = v_vat_timing,
      vat_amount = v_vat,
      vat_due_date = v_vat_due,
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

  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS e(value, n) ORDER BY e.n
  LOOP
    v_seq := v_seq + 1;
    v_row_id := (v_item->>'id')::uuid;
    v_base := (v_item->>'base')::numeric;
    v_gross := (v_item->>'gross')::numeric;
    IF v_row_id IS NULL THEN
      INSERT INTO public.installment_schedule (
        contract_id, kind, seq, title, note, rate, base_amount, vat_amount, amount, due_date
      ) VALUES (
        v_id, 'first_payment', v_seq, v_item->>'title', v_item->>'note',
        (v_item->>'rate')::numeric, v_base, v_gross - v_base, v_gross,
        (v_item->>'due')::date
      )
      RETURNING id INTO v_row_id;
    ELSE
      UPDATE public.installment_schedule SET
        seq = v_seq,
        title = v_item->>'title',
        note = v_item->>'note',
        rate = (v_item->>'rate')::numeric,
        base_amount = v_base,
        vat_amount = v_gross - v_base,
        amount = v_gross,
        due_date = (v_item->>'due')::date
      WHERE id = v_row_id;
    END IF;

    IF v_item->>'paid_on' IS NOT NULL THEN
      v_payments := v_payments || jsonb_build_array(v_item || jsonb_build_object('id', v_row_id));
    END IF;
  END LOOP;

  -- «مدفوعة» is an ordinary payment: voided and receipted like any other.
  -- Recorded once every row exists, so paying one never closes the contract
  -- over a row still to be written.
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_payments) WITH ORDINALITY AS e(value, n) ORDER BY e.n
  LOOP
    PERFORM public.record_installment_payment(
      v_id, (v_item->>'paid_on')::date, (v_item->>'gross')::numeric, v_item->>'method',
      NULL, NULL, (v_item->>'id')::uuid
    );
  END LOOP;

  DELETE FROM public.installment_contract_equipment ce
  WHERE ce.contract_id = v_id AND NOT (ce.equipment_id = ANY (v_units));
  INSERT INTO public.installment_contract_equipment (contract_id, equipment_id)
  SELECT v_id, u FROM unnest(v_units) AS u
  ON CONFLICT (contract_id, equipment_id) DO NOTHING;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.save_installment_contract(uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[], jsonb, jsonb, jsonb, text) IS
  '0203 / 0208, re-created 0209: creates or edits a contract with its first payments, VAT, installments (none while p_first_due_date is NULL) and units in one transaction. p_down_payment is what was paid before entry. A first payment sent with paid_on records an ordinary payment. p_expected_key refuses a save over a changed contract (contract_changed). installments.manage.';

REVOKE ALL ON FUNCTION public.save_installment_contract(uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[], jsonb, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_installment_contract(uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[], jsonb, jsonb, jsonb, text)
  TO authenticated;

-- ===========================================================================
-- 6. The two small date writers
-- ===========================================================================
CREATE FUNCTION public.set_installment_first_due_date(
  p_contract_id uuid,
  p_first_due_date date,
  p_installment_count integer,
  p_frequency_months integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
BEGIN
  PERFORM public.assert_installments_manage();

  SELECT * INTO c FROM public.installment_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
  END IF;
  IF c.status <> 'active' THEN
    RAISE EXCEPTION 'contract_not_active' USING ERRCODE = '55000';
  END IF;
  IF p_first_due_date IS NULL THEN
    RAISE EXCEPTION 'invalid_first_due_date' USING ERRCODE = '22023';
  END IF;
  PERFORM public.assert_installment_division(
    c.installments_amount,
    public.installment_with_vat(c.balloon_amount, c.vat_timing),
    p_installment_count,
    p_frequency_months
  );

  IF p_first_due_date IS NOT DISTINCT FROM c.first_due_date
     AND p_installment_count = c.installment_count
     AND p_frequency_months = c.frequency_months THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.installment_schedule s
    WHERE s.contract_id = c.id AND s.kind = 'installment' AND s.paid_amount > 0
  ) THEN
    RAISE EXCEPTION 'contract_has_payments' USING ERRCODE = '55000';
  END IF;

  UPDATE public.installment_contracts SET
    first_due_date = p_first_due_date,
    installment_count = p_installment_count,
    frequency_months = p_frequency_months,
    first_due_set_at = now(),
    first_due_set_by = auth.uid()
  WHERE id = c.id;

  PERFORM public.generate_installment_schedule(c.id);
  PERFORM public.sync_installment_vat_row(c.id);
END;
$$;

COMMENT ON FUNCTION public.set_installment_first_due_date(uuid, date, integer, integer) IS
  '0209: sets or changes the first due date (with the count and frequency) and divides the installments, until an installment is paid. First payments and their payments are untouched. installments.manage.';

REVOKE ALL ON FUNCTION public.set_installment_first_due_date(uuid, date, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_installment_first_due_date(uuid, date, integer, integer)
  TO authenticated;

CREATE FUNCTION public.set_installment_first_payment_date(p_schedule_id uuid, p_due_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
  v_row public.installment_schedule%ROWTYPE;
BEGIN
  PERFORM public.assert_installments_manage();

  IF p_due_date IS NULL THEN
    RAISE EXCEPTION 'invalid_first_payment_date' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.installment_schedule
  WHERE id = p_schedule_id AND kind = 'first_payment';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_schedule_row' USING ERRCODE = '22023';
  END IF;
  -- The contract first, the lock order of the other writers.
  SELECT * INTO c FROM public.installment_contracts WHERE id = v_row.contract_id FOR UPDATE;
  SELECT * INTO v_row FROM public.installment_schedule WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_schedule_row' USING ERRCODE = '22023';
  END IF;
  IF c.status <> 'active' THEN
    RAISE EXCEPTION 'contract_not_active' USING ERRCODE = '55000';
  END IF;
  IF v_row.paid_amount >= v_row.amount THEN
    RAISE EXCEPTION 'first_payment_locked' USING ERRCODE = '55000';
  END IF;

  UPDATE public.installment_schedule SET due_date = p_due_date WHERE id = v_row.id;
  UPDATE public.installment_contracts SET updated_at = now() WHERE id = c.id;
END;
$$;

COMMENT ON FUNCTION public.set_installment_first_payment_date(uuid, date) IS
  '0209: dates a first payment that is not fully paid, so it joins the dues and the reminder. installments.manage.';

REVOKE ALL ON FUNCTION public.set_installment_first_payment_date(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_installment_first_payment_date(uuid, date)
  TO authenticated;

-- ===========================================================================
-- 7. The contract's files
-- ===========================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'installment-contract-files', 'installment-contract-files', false, 5242880,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.installment_contract_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.installment_contracts(id) ON DELETE RESTRICT,
  kind text NOT NULL
    CONSTRAINT installment_contract_files_kind_check
      CHECK (kind IN ('contract', 'annex', 'schedule', 'other')),
  title text
    CONSTRAINT installment_contract_files_title_check
      CHECK (char_length(title) BETWEEN 1 AND 100),
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL
    CONSTRAINT installment_contract_files_name_check
      CHECK (char_length(file_name) BETWEEN 1 AND 255),
  mime_type text NOT NULL
    CONSTRAINT installment_contract_files_mime_check
      CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer NOT NULL
    CONSTRAINT installment_contract_files_size_check CHECK (size_bytes BETWEEN 1 AND 5242880),
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.installment_contract_files IS
  '0209: the files of an installment contract (the contract, an annex, the schedule, other), several per contract, in the private bucket installment-contract-files at <contract id>/<file>. Read by installments.view; written only by add_installment_contract_file / remove_installment_contract_file.';

CREATE INDEX installment_contract_files_contract_idx
  ON public.installment_contract_files (contract_id, created_at, id);

CREATE TRIGGER installment_contract_files_updated_at
  BEFORE UPDATE ON public.installment_contract_files
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER installment_contract_files_touch_contract
  AFTER INSERT OR UPDATE OR DELETE ON public.installment_contract_files
  FOR EACH ROW EXECUTE FUNCTION public.touch_installment_contract_from_child();

ALTER TABLE public.installment_contract_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_installment_contract_files ON public.installment_contract_files
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('installments.view')));

REVOKE ALL ON TABLE public.installment_contract_files FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.installment_contract_files TO authenticated;

CREATE FUNCTION public.add_installment_contract_file(
  p_contract_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes integer,
  p_kind text,
  p_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
  v_name text := btrim(COALESCE(p_file_name, ''));
  v_title text := NULLIF(btrim(COALESCE(p_title, '')), '');
  v_id uuid;
BEGIN
  PERFORM public.assert_installments_manage();

  SELECT * INTO c FROM public.installment_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
  END IF;
  IF c.status = 'cancelled' THEN
    RAISE EXCEPTION 'contract_not_active' USING ERRCODE = '55000';
  END IF;

  IF p_storage_path IS NULL
     OR cardinality(string_to_array(p_storage_path, '/')) <> 2
     OR split_part(p_storage_path, '/', 1) <> c.id::text
     OR split_part(p_storage_path, '/', 2) = ''
     OR char_length(v_name) NOT BETWEEN 1 AND 255
     OR char_length(v_title) > 100
     OR p_kind IS NULL OR p_kind NOT IN ('contract', 'annex', 'schedule', 'other')
     OR p_mime_type IS NULL
     OR p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
     OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 5242880
     OR EXISTS (
       SELECT 1 FROM public.installment_contract_files f WHERE f.storage_path = p_storage_path
     ) THEN
    RAISE EXCEPTION 'invalid_contract_file' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'installment-contract-files' AND o.name = p_storage_path
  ) THEN
    RAISE EXCEPTION 'contract_file_missing' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.installment_contract_files (
    contract_id, kind, title, storage_path, file_name, mime_type, size_bytes,
    uploaded_by, uploaded_by_name
  ) VALUES (
    c.id, p_kind, v_title, p_storage_path, v_name, p_mime_type, p_size_bytes,
    auth.uid(),
    (SELECT pn.full_name FROM public.profile_names pn WHERE pn.id = auth.uid())
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.add_installment_contract_file(uuid, text, text, text, integer, text, text) IS
  '0209: attaches a file already uploaded to installment-contract-files to a contract that is not cancelled. installments.manage.';

REVOKE ALL ON FUNCTION public.add_installment_contract_file(uuid, text, text, text, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_installment_contract_file(uuid, text, text, text, integer, text, text)
  TO authenticated;

CREATE FUNCTION public.remove_installment_contract_file(p_file_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
  v_contract_id uuid;
  v_path text;
BEGIN
  PERFORM public.assert_installments_manage();

  SELECT contract_id INTO v_contract_id
  FROM public.installment_contract_files WHERE id = p_file_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract_file_not_found' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO c FROM public.installment_contracts WHERE id = v_contract_id FOR UPDATE;
  IF c.status = 'cancelled' THEN
    RAISE EXCEPTION 'contract_not_active' USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.installment_contract_files WHERE id = p_file_id
  RETURNING storage_path INTO v_path;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'contract_file_not_found' USING ERRCODE = '55000';
  END IF;
  RETURN v_path;
END;
$$;

COMMENT ON FUNCTION public.remove_installment_contract_file(uuid) IS
  '0209: removes a file of a contract that is not cancelled and returns its path for the client to remove from Storage. installments.manage.';

REVOKE ALL ON FUNCTION public.remove_installment_contract_file(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_installment_contract_file(uuid) TO authenticated;

-- Storage: this bucket only.
CREATE FUNCTION public.can_read_installment_contract_file_object(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND public.has_permission('installments.view');
$$;

REVOKE ALL ON FUNCTION public.can_read_installment_contract_file_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_installment_contract_file_object(text) TO authenticated;

CREATE FUNCTION public.can_upload_installment_contract_file_object(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.has_permission('installments.manage')
    AND cardinality(string_to_array(p_name, '/')) = 2
    AND split_part(p_name, '/', 2) <> ''
    AND EXISTS (
      SELECT 1 FROM public.installment_contracts c
      WHERE c.id::text = split_part(p_name, '/', 1) AND c.status <> 'cancelled'
    );
$$;

REVOKE ALL ON FUNCTION public.can_upload_installment_contract_file_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_installment_contract_file_object(text) TO authenticated;

CREATE FUNCTION public.can_delete_installment_contract_file_object(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.has_permission('installments.manage')
    AND NOT EXISTS (
      SELECT 1 FROM public.installment_contract_files f WHERE f.storage_path = p_name
    );
$$;

REVOKE ALL ON FUNCTION public.can_delete_installment_contract_file_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_delete_installment_contract_file_object(text) TO authenticated;

CREATE POLICY select_installment_contract_files_objects ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'installment-contract-files'
  AND public.can_read_installment_contract_file_object(name)
);

CREATE POLICY insert_installment_contract_files_objects ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'installment-contract-files'
  AND public.can_upload_installment_contract_file_object(name)
);

CREATE POLICY delete_installment_contract_files_objects ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'installment-contract-files'
  AND public.can_delete_installment_contract_file_object(name)
);

-- ===========================================================================
-- 8. Deleting a cancelled contract also archives and drops its file rows
-- ===========================================================================
ALTER TABLE public.installment_contract_deletions
  ADD COLUMN files jsonb NOT NULL DEFAULT '[]'::jsonb;

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
    equipment, receipts, files, deleted_by, deleted_by_name
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
  '0207, re-created 0209: deletes a CANCELLED contract with its schedule, voided payments, receipt rows, file rows and unit links, after copying everything to installment_contract_deletions. Returns the receipt paths; the client removes those and the contract files it listed. installments.manage.';

-- ===========================================================================
-- 9. The readers (every earlier column keeps its place)
-- ===========================================================================
-- An undated row is no due. Once fully paid it shows on the day it was paid.
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
  s.title
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
  '0203 / 0207 / 0209: every DATED payable row (installment, first payment or VAT row: kind, title) with its contract, financier, state and days_until_due, and a fully paid undated first payment on the day it was paid. An undated unpaid first payment and the installments of an undivided contract are no dues. security_invoker.';

CREATE OR REPLACE VIEW public.installment_contract_summary
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.contract_number,
  c.description,
  c.financier_id,
  f.name AS financier_name,
  c.total_amount,
  c.down_payment,
  c.balloon_amount,
  c.financed_amount,
  c.installment_count,
  c.frequency_months,
  c.first_due_date,
  c.notes,
  c.status,
  c.closed_at,
  c.cancel_reason,
  c.created_by,
  cb.full_name AS created_by_name,
  c.created_at,
  c.updated_at,
  COALESCE(t.paid_total, 0) AS paid_total,
  c.total_amount + c.vat_amount - c.down_payment - COALESCE(t.paid_total, 0) AS remaining_total,
  COALESCE(t.paid_count, 0) AS paid_count,
  COALESCE(t.overdue_count, 0) AS overdue_count,
  COALESCE(t.overdue_amount, 0) AS overdue_amount,
  n.due_date AS next_due_date,
  n.amount - n.paid_amount AS next_due_amount,
  CASE WHEN c.first_due_date IS NOT NULL THEN t.last_due_date END AS last_due_date,
  (SELECT count(*) FROM public.installment_contract_equipment ce WHERE ce.contract_id = c.id)
    AS equipment_count,
  -- 0208: the financier's account and the contract's own account (NULL =
  -- the financier's is used).
  f.bank_name AS financier_bank_name,
  f.iban AS financier_iban,
  c.bank_name AS contract_bank_name,
  c.iban AS contract_iban,
  -- 0209
  c.vat_mode,
  c.vat_timing,
  c.vat_amount,
  c.vat_due_date,
  c.installments_amount,
  c.total_amount + c.vat_amount AS payable_total,
  c.down_payment + COALESCE(t.paid_total, 0) AS paid_overall,
  COALESCE(t.first_payments_count, 0) AS first_payments_count,
  COALESCE(t.first_payments_paid_count, 0) AS first_payments_paid_count,
  COALESCE(t.first_payments_total, 0) AS first_payments_total,
  COALESCE(t.installments_locked, false) AS installments_locked,
  n.id AS next_due_id,
  n.kind AS next_due_kind,
  n.title AS next_due_title,
  n.seq AS next_due_seq,
  c.first_due_set_at,
  ds.full_name AS first_due_set_by_name
FROM public.installment_contracts c
JOIN public.installment_financiers f ON f.id = c.financier_id
LEFT JOIN public.profile_names cb ON cb.id = c.created_by
LEFT JOIN public.profile_names ds ON ds.id = c.first_due_set_by
LEFT JOIN LATERAL (
  SELECT
    sum(s.paid_amount) AS paid_total,
    count(*) FILTER (WHERE s.kind = 'installment' AND s.paid_amount >= s.amount) AS paid_count,
    count(*) FILTER (WHERE s.paid_amount < s.amount AND s.due_date < public.saudi_today())
      AS overdue_count,
    sum(s.amount - s.paid_amount) FILTER (WHERE s.due_date < public.saudi_today())
      AS overdue_amount,
    max(s.due_date) FILTER (WHERE s.kind <> 'first_payment') AS last_due_date,
    count(*) FILTER (WHERE s.kind = 'first_payment') AS first_payments_count,
    count(*) FILTER (WHERE s.kind = 'first_payment' AND s.paid_amount >= s.amount)
      AS first_payments_paid_count,
    sum(s.amount) FILTER (WHERE s.kind = 'first_payment') AS first_payments_total,
    bool_or(s.kind = 'installment' AND s.paid_amount > 0) AS installments_locked
  FROM public.installment_schedule s
  WHERE s.contract_id = c.id
) t ON true
LEFT JOIN LATERAL (
  SELECT s.id, s.kind, s.title, s.seq, s.due_date, s.amount, s.paid_amount
  FROM public.installment_schedule s
  WHERE s.contract_id = c.id AND s.paid_amount < s.amount AND s.due_date IS NOT NULL
  ORDER BY s.due_date, s.kind, s.seq
  LIMIT 1
) n ON true;

COMMENT ON VIEW public.installment_contract_summary IS
  '0203 / 0208 / 0209: one row per contract: remaining_total is the whole contract''s (payable - prepaid - paid) whether divided yet or not; paid_count counts installments only; paid_overall includes what was paid before entry; next_* is the next DATED unpaid row of any kind. security_invoker.';

-- The remaining and the contract count come from the contracts, so a
-- contract waiting for its division is in them.
CREATE OR REPLACE VIEW public.installment_overview
WITH (security_invoker = true) AS
SELECT
  d.overdue_count,
  d.overdue_amount,
  d.due_7_count,
  d.due_7_amount,
  d.due_30_count,
  d.due_30_amount,
  d.open_count,
  k.remaining_total,
  k.open_contract_count,
  d.next_due_date
FROM (
  SELECT
    count(*) FILTER (WHERE s.due_date < public.saudi_today()) AS overdue_count,
    COALESCE(sum(s.amount - s.paid_amount) FILTER (WHERE s.due_date < public.saudi_today()), 0)
      AS overdue_amount,
    count(*) FILTER (
      WHERE s.due_date >= public.saudi_today() AND s.due_date <= public.saudi_today() + 7
    ) AS due_7_count,
    COALESCE(sum(s.amount - s.paid_amount) FILTER (
      WHERE s.due_date >= public.saudi_today() AND s.due_date <= public.saudi_today() + 7
    ), 0) AS due_7_amount,
    count(*) FILTER (
      WHERE s.due_date >= public.saudi_today() AND s.due_date <= public.saudi_today() + 30
    ) AS due_30_count,
    COALESCE(sum(s.amount - s.paid_amount) FILTER (
      WHERE s.due_date >= public.saudi_today() AND s.due_date <= public.saudi_today() + 30
    ), 0) AS due_30_amount,
    count(*) AS open_count,
    min(s.due_date) AS next_due_date
  FROM public.installment_schedule s
  JOIN public.installment_contracts c ON c.id = s.contract_id
  WHERE c.status = 'active' AND s.paid_amount < s.amount AND s.due_date IS NOT NULL
) d
CROSS JOIN (
  SELECT
    COALESCE(sum(c.total_amount + c.vat_amount - c.down_payment - COALESCE((
      SELECT sum(s.paid_amount) FROM public.installment_schedule s WHERE s.contract_id = c.id
    ), 0)), 0) AS remaining_total,
    count(*) AS open_contract_count
  FROM public.installment_contracts c
  WHERE c.status = 'active'
) k;

-- ===========================================================================
-- 10. The reminder says what the row is
-- ===========================================================================
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
-- 11. Guards: nothing that existed moved
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.installment_contracts c
    WHERE c.installments_amount <> COALESCE((
            SELECT sum(s.amount) FROM public.installment_schedule s
            WHERE s.contract_id = c.id AND s.kind = 'installment'), 0)
       OR c.vat_mode <> 'unspecified'
       OR c.vat_amount <> 0
  ) THEN
    RAISE EXCEPTION '0209: a contract does not add up after the backfill';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
