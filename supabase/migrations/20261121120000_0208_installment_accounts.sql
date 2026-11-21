-- 0208: the bank account of a financier and of an installment contract.
--
-- Owner 2026-11-21: «نبغى نضيف حقل الايبان في الجهات التمويلية, بنفس
-- الموردين, البنك ورقم الايبان, وفيه بعض الجهات التمويلية ترسل ايبان مختلف
-- مع كل عقد» (plan approved: «ابدا في الايبان»).
--
--   1. installment_financiers gains bank_name (a bank of the banks list,
--      0177: FK ON UPDATE CASCADE ON DELETE RESTRICT, as lessors) and iban
--      (a Saudi IBAN, the 0175 CHECK), both optional; the financier's
--      normalising trigger trims the bank and stores the IBAN without spaces
--      or dashes, upper-cased. Written directly under the 0203 RLS, as the
--      name is.
--   2. installment_contracts gains the same two columns: the contract's OWN
--      account, for a financier that sends another IBAN with each contract.
--      NULL = the financier's account is used. Written only by
--      save_installment_contract, re-created from its 0203 body with one
--      trailing parameter p_account jsonb DEFAULT NULL: SQL NULL keeps the
--      stored account (none on a new contract), JSON null or an object
--      without values clears it, {bank_name, iban} sets it. The 0203
--      eleven-parameter function is DROPPED (two overloads that differ by a
--      trailing default cannot be told apart by a named call; a call with
--      the eleven named parameters resolves to the new one and keeps the
--      account). The account changes on any contract but a cancelled one,
--      with or without payments.
--   3. installment_contract_summary appends financier_bank_name,
--      financier_iban, contract_bank_name, contract_iban (CREATE OR REPLACE,
--      every 0203 column in place).
-- No uniqueness on an IBAN: two financiers may share an account.
--
-- New tokens (22023): invalid_account, invalid_bank, invalid_iban.

-- ===========================================================================
-- 1. The columns
-- ===========================================================================
ALTER TABLE public.installment_financiers
  ADD COLUMN bank_name text
    CONSTRAINT installment_financiers_bank_name_fkey
      REFERENCES public.banks(name) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD COLUMN iban text
    CONSTRAINT installment_financiers_iban_check
      CHECK (iban IS NULL OR iban ~ '^SA[0-9]{4}[0-9A-Z]{18}$');

COMMENT ON COLUMN public.installment_financiers.bank_name IS
  '0208: the bank of the financier''s account, a name of the banks list (a rename follows, a used bank is not deleted). Optional.';
COMMENT ON COLUMN public.installment_financiers.iban IS
  '0208: the financier''s Saudi IBAN, stored without spaces, upper-case. Optional; a contract may carry its own (installment_contracts.iban).';

ALTER TABLE public.installment_contracts
  ADD COLUMN bank_name text
    CONSTRAINT installment_contracts_bank_name_fkey
      REFERENCES public.banks(name) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD COLUMN iban text
    CONSTRAINT installment_contracts_iban_check
      CHECK (iban IS NULL OR iban ~ '^SA[0-9]{4}[0-9A-Z]{18}$');

COMMENT ON COLUMN public.installment_contracts.bank_name IS
  '0208: the bank of the contract''s OWN account (NULL = the financier''s account). Written by save_installment_contract.';
COMMENT ON COLUMN public.installment_contracts.iban IS
  '0208: the contract''s OWN Saudi IBAN, for a financier that sends another one with each contract (NULL = the financier''s). Written by save_installment_contract.';

CREATE INDEX installment_financiers_bank_name_idx
  ON public.installment_financiers (bank_name) WHERE bank_name IS NOT NULL;
CREATE INDEX installment_contracts_bank_name_idx
  ON public.installment_contracts (bank_name) WHERE bank_name IS NOT NULL;

-- ===========================================================================
-- 2. The financier's trigger also normalises the account
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.normalise_installment_financier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.bank_name := NULLIF(btrim(NEW.bank_name), '');
  NEW.iban := NULLIF(upper(regexp_replace(NEW.iban, '[\s-]', '', 'g')), '');
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalise_installment_financier()
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 3. save_installment_contract takes the contract's account
-- ===========================================================================
DROP FUNCTION public.save_installment_contract(
  uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[]
);

CREATE OR REPLACE FUNCTION public.save_installment_contract(
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
  p_account jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
  v_id uuid;
  v_description text;
  v_notes text;
  v_total numeric(14, 2);
  v_down numeric(14, 2);
  v_balloon numeric(14, 2);
  v_units uuid[];
  v_terms_changed boolean;
  v_account_set boolean := false;
  v_bank text;
  v_iban text;
BEGIN
  PERFORM public.assert_installments_manage();

  IF p_id IS NOT NULL THEN
    SELECT * INTO c FROM public.installment_contracts WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
    END IF;
    IF c.status = 'cancelled' THEN
      RAISE EXCEPTION 'contract_not_active' USING ERRCODE = '55000';
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

  PERFORM public.assert_installment_terms(
    p_total_amount, p_down_payment, p_balloon_amount,
    p_installment_count, p_frequency_months, p_first_due_date
  );
  v_total := round(p_total_amount, 2);
  v_down := round(COALESCE(p_down_payment, 0), 2);
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

  IF p_id IS NULL THEN
    INSERT INTO public.installment_contracts (
      contract_number, description, financier_id, total_amount, down_payment,
      balloon_amount, installment_count, frequency_months, first_due_date,
      notes, created_by, bank_name, iban
    ) VALUES (
      public.next_installment_contract_number(), v_description, p_financier_id,
      v_total, v_down, v_balloon, p_installment_count, p_frequency_months,
      p_first_due_date, v_notes, auth.uid(), v_bank, v_iban
    )
    RETURNING id INTO v_id;

    PERFORM public.generate_installment_schedule(v_id);
  ELSE
    v_id := c.id;
    v_terms_changed :=
      v_total IS DISTINCT FROM c.total_amount
      OR v_down IS DISTINCT FROM c.down_payment
      OR v_balloon IS DISTINCT FROM c.balloon_amount
      OR p_installment_count IS DISTINCT FROM c.installment_count
      OR p_frequency_months IS DISTINCT FROM c.frequency_months::integer
      OR p_first_due_date IS DISTINCT FROM c.first_due_date;

    IF v_terms_changed AND EXISTS (
      SELECT 1 FROM public.installment_payments p
      WHERE p.contract_id = c.id AND p.status = 'posted'
    ) THEN
      RAISE EXCEPTION 'contract_has_payments' USING ERRCODE = '55000';
    END IF;

    UPDATE public.installment_contracts SET
      description = v_description,
      financier_id = p_financier_id,
      total_amount = v_total,
      down_payment = v_down,
      balloon_amount = v_balloon,
      installment_count = p_installment_count,
      frequency_months = p_frequency_months,
      first_due_date = p_first_due_date,
      notes = v_notes,
      bank_name = CASE WHEN v_account_set THEN v_bank ELSE c.bank_name END,
      iban = CASE WHEN v_account_set THEN v_iban ELSE c.iban END
    WHERE id = c.id;

    IF v_terms_changed THEN
      PERFORM public.generate_installment_schedule(c.id);
    END IF;
  END IF;

  DELETE FROM public.installment_contract_equipment ce
  WHERE ce.contract_id = v_id AND NOT (ce.equipment_id = ANY (v_units));
  INSERT INTO public.installment_contract_equipment (contract_id, equipment_id)
  SELECT v_id, u FROM unnest(v_units) AS u
  ON CONFLICT (contract_id, equipment_id) DO NOTHING;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.save_installment_contract(
  uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[], jsonb
) IS
  '0203 / 0208: creates (p_id NULL) or edits an installment contract with its generated schedule and its optional units in one transaction. The money terms change only without a posted payment (contract_has_payments) and a change rebuilds the schedule; the description, financier, notes, units and (0208) the contract''s own account always change, except on a cancelled contract (contract_not_active). p_account: SQL NULL keeps the account, JSON null or an empty object clears it, {bank_name, iban} sets it (invalid_account, invalid_bank, invalid_iban). installments.manage. Returns the contract id.';

REVOKE ALL ON FUNCTION public.save_installment_contract(
  uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[], jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_installment_contract(
  uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[], jsonb
) TO authenticated;

-- ===========================================================================
-- 4. The contract summary shows both accounts (trailing columns)
-- ===========================================================================
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
  c.financed_amount - COALESCE(t.paid_total, 0) AS remaining_total,
  COALESCE(t.paid_count, 0) AS paid_count,
  COALESCE(t.overdue_count, 0) AS overdue_count,
  COALESCE(t.overdue_amount, 0) AS overdue_amount,
  n.due_date AS next_due_date,
  n.amount - n.paid_amount AS next_due_amount,
  t.last_due_date,
  (SELECT count(*) FROM public.installment_contract_equipment ce WHERE ce.contract_id = c.id)
    AS equipment_count,
  -- 0208: the financier's account and the contract's own account (NULL =
  -- the financier's is used).
  f.bank_name AS financier_bank_name,
  f.iban AS financier_iban,
  c.bank_name AS contract_bank_name,
  c.iban AS contract_iban
FROM public.installment_contracts c
JOIN public.installment_financiers f ON f.id = c.financier_id
LEFT JOIN public.profile_names cb ON cb.id = c.created_by
LEFT JOIN LATERAL (
  SELECT
    sum(s.paid_amount) AS paid_total,
    count(*) FILTER (WHERE s.paid_amount >= s.amount) AS paid_count,
    count(*) FILTER (WHERE s.paid_amount < s.amount AND s.due_date < public.saudi_today())
      AS overdue_count,
    sum(s.amount - s.paid_amount) FILTER (WHERE s.due_date < public.saudi_today())
      AS overdue_amount,
    max(s.due_date) AS last_due_date
  FROM public.installment_schedule s
  WHERE s.contract_id = c.id
) t ON true
LEFT JOIN LATERAL (
  SELECT s.due_date, s.amount, s.paid_amount
  FROM public.installment_schedule s
  WHERE s.contract_id = c.id AND s.paid_amount < s.amount
  ORDER BY s.due_date, s.seq
  LIMIT 1
) n ON true;

COMMENT ON VIEW public.installment_contract_summary IS
  '0203 / 0208: one row per contract with every contract column, the financier name, created_by_name (profile_names), paid / remaining totals, the overdue count and amount, the next unpaid row, the unit count and (0208) financier_bank_name / financier_iban and the contract''s own contract_bank_name / contract_iban (NULL = the financier''s account). The contracts list and the contract page. security_invoker: installments.view through the table policies.';

REVOKE ALL ON public.installment_contract_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.installment_contract_summary TO authenticated;
