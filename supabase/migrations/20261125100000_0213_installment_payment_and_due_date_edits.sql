-- 0213: editing a payment's transfer day and amount, and an installment's
-- due day (owner 2026-11-25: «1. تعديل تاريخ الحوالة 2. تاريخ الاستحقاق
-- بالطريقة الي ذكرتها انت 3. تعديل مبلغ القسط الي تسدد 4. بس هذول», and
-- asked, «مبلغ السداد نفسه» for the third).
--
-- 1. installment_payments gains edited_at / edited_by: the LAST edit of a
--    payment (the contract page's history shows it). installment_schedule
--    gains due_date_edited_at / due_date_edited_by / due_date_edited_by_name:
--    the last change of an installment's due day by hand.
-- 2. update_installment_payment(p_payment_id, p_paid_on, p_amount): a POSTED
--    payment of a contract that is not cancelled. The day: any day up to the
--    Saudi today. The amount: its allocations are taken back and it is
--    allocated again the way record_installment_payment does — the first row
--    it covered first, then the oldest due, then the undated —, never past
--    what is open (payment_exceeds_balance / installments_not_scheduled); a
--    paid-off contract reopens when the amount drops and an active one is
--    paid off when the payment now covers everything; a separate VAT follows
--    its chosen day again (sync_installment_vat_row).
-- 3. set_installment_due_date(p_schedule_id, p_due_date): an INSTALLMENT row
--    of an active contract that is not fully paid (installment_already_paid);
--    a partly paid one may move too. A later rebuild of the schedule (a change
--    of the terms, only without money on the installments) drops it.
-- 4. installment_payment_list appends edited_at, edited_by, edited_by_name.

-- ===========================================================================
-- 1. The columns
-- ===========================================================================
ALTER TABLE public.installment_payments
  ADD COLUMN edited_at timestamptz,
  ADD COLUMN edited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.installment_payments.edited_at IS
  '0213: the last change of the transfer day or the amount (update_installment_payment).';

ALTER TABLE public.installment_schedule
  ADD COLUMN due_date_edited_at timestamptz,
  ADD COLUMN due_date_edited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN due_date_edited_by_name text;

COMMENT ON COLUMN public.installment_schedule.due_date_edited_at IS
  '0213: the last change of an installment''s due day by hand (set_installment_due_date); a rebuild of the schedule drops it.';

-- ===========================================================================
-- 2. Editing a payment
-- ===========================================================================
CREATE FUNCTION public.update_installment_payment(
  p_payment_id uuid,
  p_paid_on date,
  p_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p public.installment_payments%ROWTYPE;
  c public.installment_contracts%ROWTYPE;
  v_amount numeric(14, 2);
  v_first uuid;
  v_open numeric;
  v_remaining numeric;
  v_left numeric(14, 2);
  v_take numeric(14, 2);
  r record;
BEGIN
  PERFORM public.assert_installments_manage();

  SELECT * INTO p FROM public.installment_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;
  -- The contract first, the lock order of the other writers.
  SELECT * INTO c FROM public.installment_contracts WHERE id = p.contract_id FOR UPDATE;
  SELECT * INTO p FROM public.installment_payments WHERE id = p_payment_id FOR UPDATE;
  IF p.status = 'voided' THEN
    RAISE EXCEPTION 'payment_already_voided' USING ERRCODE = '55000';
  END IF;
  IF c.status = 'cancelled' THEN
    RAISE EXCEPTION 'contract_not_active' USING ERRCODE = '55000';
  END IF;
  IF p_paid_on IS NULL OR p_paid_on > public.saudi_today() THEN
    RAISE EXCEPTION 'invalid_paid_on' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 999999999999.99
     OR round(p_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'invalid_payment_amount' USING ERRCODE = '22023';
  END IF;
  v_amount := round(p_amount, 2);

  IF v_amount = p.amount AND p_paid_on = p.paid_on THEN
    RETURN;
  END IF;

  IF v_amount <> p.amount THEN
    -- The row it paid first stays first.
    SELECT a.schedule_id INTO v_first
    FROM public.installment_payment_allocations a
    JOIN public.installment_schedule s ON s.id = a.schedule_id
    WHERE a.payment_id = p.id
    ORDER BY s.due_date NULLS LAST, s.kind, s.seq
    LIMIT 1;

    -- Take it back, as a void does.
    UPDATE public.installment_schedule s
    SET paid_amount = s.paid_amount - a.amount
    FROM public.installment_payment_allocations a
    WHERE a.payment_id = p.id AND a.schedule_id = s.id;
    DELETE FROM public.installment_payment_allocations WHERE payment_id = p.id;

    SELECT
      COALESCE(sum(s.amount - s.paid_amount), 0),
      c.total_amount - c.down_payment - COALESCE(sum(s.paid_amount), 0)
    INTO v_open, v_remaining
    FROM public.installment_schedule s WHERE s.contract_id = c.id;

    IF v_amount > v_open THEN
      IF c.first_due_date IS NULL AND v_amount <= v_remaining THEN
        RAISE EXCEPTION 'installments_not_scheduled' USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'payment_exceeds_balance' USING ERRCODE = '22023';
    END IF;

    -- Allocate again: the row it paid first, then the oldest due, then the
    -- undated (record_installment_payment's order).
    v_left := v_amount;
    FOR r IN
      SELECT s.id, s.amount - s.paid_amount AS open_amount
      FROM public.installment_schedule s
      WHERE s.contract_id = c.id AND s.paid_amount < s.amount
      ORDER BY
        CASE WHEN s.id = v_first THEN 0 ELSE 1 END,
        s.due_date NULLS LAST, s.kind, s.seq
      FOR UPDATE
    LOOP
      EXIT WHEN v_left <= 0;
      v_take := least(v_left, r.open_amount);
      UPDATE public.installment_schedule SET paid_amount = paid_amount + v_take WHERE id = r.id;
      INSERT INTO public.installment_payment_allocations (payment_id, schedule_id, amount)
      VALUES (p.id, r.id, v_take);
      v_left := v_left - v_take;
    END LOOP;

    -- The contract's state follows: everything paid (and divided) = paid off.
    IF v_amount = v_open AND c.first_due_date IS NOT NULL THEN
      IF c.status <> 'paid_off' THEN
        UPDATE public.installment_contracts SET status = 'paid_off', closed_at = now() WHERE id = c.id;
      END IF;
    ELSIF c.status = 'paid_off' THEN
      UPDATE public.installment_contracts SET status = 'active', closed_at = NULL WHERE id = c.id;
    END IF;

    PERFORM public.sync_installment_vat_row(c.id);
  END IF;

  UPDATE public.installment_payments
  SET paid_on = p_paid_on, amount = v_amount, edited_at = now(), edited_by = auth.uid()
  WHERE id = p.id;
END;
$$;

COMMENT ON FUNCTION public.update_installment_payment(uuid, date, numeric) IS
  '0213: changes a posted payment''s transfer day (up to the Saudi today) and amount; a new amount is allocated again (the first row it covered first, then the oldest due, then the undated), never past what is open, and the contract is paid off or reopened to match. Keeps the last edit (edited_at / edited_by). installments.manage.';

REVOKE ALL ON FUNCTION public.update_installment_payment(uuid, date, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_installment_payment(uuid, date, numeric)
  TO authenticated;

-- ===========================================================================
-- 3. An installment's due day
-- ===========================================================================
CREATE FUNCTION public.set_installment_due_date(p_schedule_id uuid, p_due_date date)
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

  IF p_due_date IS NULL OR p_due_date < date '2000-01-01' OR p_due_date > date '2100-12-31' THEN
    RAISE EXCEPTION 'invalid_due_date' USING ERRCODE = '22023';
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
  IF c.status <> 'active' THEN
    RAISE EXCEPTION 'contract_not_active' USING ERRCODE = '55000';
  END IF;
  IF v_row.paid_amount >= v_row.amount THEN
    RAISE EXCEPTION 'installment_already_paid' USING ERRCODE = '55000';
  END IF;
  IF v_row.due_date IS NOT DISTINCT FROM p_due_date THEN
    RETURN;
  END IF;

  UPDATE public.installment_schedule
  SET due_date = p_due_date,
      due_date_edited_at = now(),
      due_date_edited_by = auth.uid(),
      due_date_edited_by_name = (SELECT n.full_name FROM public.profile_names n WHERE n.id = auth.uid())
  WHERE id = v_row.id;
  UPDATE public.installment_contracts SET updated_at = now() WHERE id = c.id;
END;
$$;

COMMENT ON FUNCTION public.set_installment_due_date(uuid, date) IS
  '0213: moves the due day of an installment row that is not fully paid (installment_already_paid), on an active contract; keeps who moved it and when. A rebuild of the schedule drops it. installments.manage.';

REVOKE ALL ON FUNCTION public.set_installment_due_date(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_installment_due_date(uuid, date)
  TO authenticated;

-- ===========================================================================
-- 4. The payments list: who edited it last
-- ===========================================================================
CREATE OR REPLACE VIEW public.installment_payment_list
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.contract_id,
  p.paid_on,
  p.amount,
  p.method,
  p.reference,
  p.note,
  p.status,
  p.voided_at,
  p.voided_by,
  vb.full_name AS voided_by_name,
  p.void_reason,
  p.created_by,
  cb.full_name AS created_by_name,
  p.created_at,
  r.id AS receipt_id,
  r.storage_path AS receipt_path,
  r.file_name AS receipt_file_name,
  r.mime_type AS receipt_mime_type,
  r.size_bytes AS receipt_size_bytes,
  p.edited_at,
  p.edited_by,
  eb.full_name AS edited_by_name
FROM public.installment_payments p
LEFT JOIN public.profile_names cb ON cb.id = p.created_by
LEFT JOIN public.profile_names vb ON vb.id = p.voided_by
LEFT JOIN public.installment_payment_receipts r ON r.payment_id = p.id
LEFT JOIN public.profile_names eb ON eb.id = p.edited_by;

COMMENT ON VIEW public.installment_payment_list IS
  '0203, receipt columns 0206, last edit 0213: the payments with who recorded, voided and last edited each (profile_names) and the transfer receipt when attached. The payments list of the contract page. security_invoker: installments.view through the table policies.';

NOTIFY pgrst, 'reload schema';
