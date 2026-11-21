-- 0207: deleting a CANCELLED installment contract, and the payment date of a
-- paid installment.
--
-- Owner 2026-11-21 («حذف عقد اقساط بس بعد الالغاء», «ابغى يكون لي وصول
-- سريع للي سددتهم» → a «المسددة» tab in «الاستحقاقات»; plan approved).
--
--   1. delete_installment_contract(p_contract_id) deletes a contract whose
--      status is `cancelled` — `contract_not_cancelled` (55000) otherwise.
--      A cancelled contract has no POSTED payment (cancel_installment_contract
--      refuses one), but it may hold VOIDED payments and their transfer
--      receipts (0206); they go with it, with its schedule, allocations and
--      unit links. Before anything is deleted the whole contract is copied to
--      the append-only installment_contract_deletions (the 0193 / 0200
--      pattern: no foreign keys, read by installments.view, no client write,
--      no screen). The function RETURNS the storage paths of the deleted
--      receipt rows: the client removes those files afterwards (the 0206
--      delete policy allows a path no row stores any more). The contract
--      number is never reused (the sequence is not touched).
--   2. installment_dues gains the trailing column last_paid_on: the latest
--      paid_on among the POSTED payments allocated to the row (NULL while
--      nothing posted is allocated). CREATE OR REPLACE VIEW keeps every 0203
--      column in place.
--
-- Tokens: installments_manage_required (42501); invalid_contract (22023);
-- contract_not_cancelled, contract_has_payments (55000).

-- ===========================================================================
-- 1. installment_contract_deletions: what a missing contract was
-- ===========================================================================
CREATE TABLE public.installment_contract_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No foreign keys: the contract is gone, and this record must never block
  -- the deletion of a financier, a unit or a profile.
  contract_id uuid NOT NULL,
  contract_number text NOT NULL,
  contract jsonb NOT NULL,
  schedule jsonb NOT NULL,
  payments jsonb NOT NULL,
  allocations jsonb NOT NULL,
  equipment jsonb NOT NULL,
  receipts jsonb NOT NULL,
  deleted_by uuid DEFAULT auth.uid(),
  deleted_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.installment_contract_deletions IS
  '0207: append-only copy of every deleted (cancelled) installment contract with its schedule, payments, allocations, unit links and receipt rows, written by delete_installment_contract before the delete. No foreign keys, no client write, no screen. Read by installments.view.';

CREATE INDEX installment_contract_deletions_contract_idx
  ON public.installment_contract_deletions (contract_id);

ALTER TABLE public.installment_contract_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_installment_contract_deletions
  ON public.installment_contract_deletions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('installments.view')));

REVOKE ALL ON TABLE public.installment_contract_deletions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.installment_contract_deletions TO authenticated;

-- ===========================================================================
-- 2. delete_installment_contract
-- ===========================================================================
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
    equipment, receipts, deleted_by, deleted_by_name
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
  DELETE FROM public.installment_contracts WHERE id = c.id;

  RETURN v_paths;
END;
$$;

COMMENT ON FUNCTION public.delete_installment_contract(uuid) IS
  '0207: deletes a CANCELLED installment contract (contract_not_cancelled otherwise) with its schedule, its voided payments and their allocations and receipt rows, and its unit links, after copying everything to installment_contract_deletions. Returns the storage paths of the deleted receipt rows for the client to remove. The contract number is never reused. installments.manage.';

REVOKE ALL ON FUNCTION public.delete_installment_contract(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_installment_contract(uuid) TO authenticated;

-- ===========================================================================
-- 3. installment_dues: the payment date of a paid row (trailing column)
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
  s.due_date,
  s.amount,
  s.paid_amount,
  s.amount - s.paid_amount AS remaining_amount,
  s.is_balloon,
  s.paid_amount > 0 AND s.paid_amount < s.amount AS is_partial,
  s.paid_amount >= s.amount AS is_paid,
  public.installment_state(s.due_date, s.amount, s.paid_amount, public.saudi_today()) AS state,
  s.due_date - public.saudi_today() AS days_until_due,
  (
    SELECT max(p.paid_on)
    FROM public.installment_payment_allocations a
    JOIN public.installment_payments p ON p.id = a.payment_id
    WHERE a.schedule_id = s.id AND p.status = 'posted'
  ) AS last_paid_on
FROM public.installment_schedule s
JOIN public.installment_contracts c ON c.id = s.contract_id
JOIN public.installment_financiers f ON f.id = c.financier_id;

COMMENT ON VIEW public.installment_dues IS
  '0203 / 0207: every schedule row with its contract, financier, derived state (installment_state, Saudi today), days_until_due (negative = days overdue) and, since 0207, last_paid_on (the latest paid_on of the posted payments allocated to it). The nearest-dues list filters contract_status = active and is_paid = false; the «المسددة» tab filters is_paid = true. security_invoker: installments.view through the table policies.';

REVOKE ALL ON public.installment_dues FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.installment_dues TO authenticated;
