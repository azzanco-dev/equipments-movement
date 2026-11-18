-- 0203: installments («الاقساط») — what the company buys on credit: the
-- contract, its generated schedule and its payments.
--
-- Owner decisions 2026-11-18:
--   * «ابغاه يكون ضمن البرنامج الرئيسي»: a section of this program, not the
--     separate app planned on 2026-11-08 (the side repo company-installments
--     and its inst_0001 are NOT applied anywhere; this file replaces them).
--   * «ابغاه يكون بابسط شكل, بدون ربط مع المعدات الي موجودة حاليا, ممكن
--     يكون فيه ربط اختياري»: one total amount (no VAT / profit / fees
--     breakdown), a free-text description, an OPTIONAL link to units with no
--     rule on them (any owner, a unit may sit on several contracts).
--   * «خلي المقدم والدفعة الاخيرة»: the down payment and the final (balloon)
--     payment stay.
--   * «خلي جدول السدادات والي معاه»: payments are free amounts, allocated to
--     the oldest unpaid rows, never deleted — voided with a reason.
--   * «اهم شي اني يكون عندي اطلاع متى موعد اقرب الاقساط»: the views below
--     serve the nearest dues first.
--   * «مبدئيا لاتضيف للسايد بار, خلي الوصول له عبر الرابط»: the screens are a
--     hidden page; nothing in this file concerns the menu.
-- My own choices, told to the owner: the financier is a small list of names
-- (not free text), schedule rows are never typed in, no separate event log
-- (the payments carry who recorded and who voided them), the contract number
-- is INS- + a global sequence that never restarts.
--
-- ===========================================================================
-- What is built
-- ===========================================================================
--   installment_financiers           the bank or dealer: a name. Written
--       directly under RLS (installments.manage), like banks.
--   installment_contracts            number INS-0001 (global sequence of at
--       least four digits, consumed at creation), description, financier,
--       total_amount, down_payment (paid at the contract, outside the
--       schedule), balloon_amount (0 = none; the LAST payment),
--       financed_amount = total_amount - down_payment (generated),
--       installment_count, frequency_months, first_due_date, notes, status
--       active / paid_off / cancelled.
--   installment_contract_equipment   the OPTIONAL link to units.
--   installment_schedule             one row per payment, GENERATED from the
--       terms: equal payments truncated to the halala, the remainder on the
--       last regular one, the balloon as the last row. paid_amount is moved
--       only by the payment functions.
--   installment_payments             a payment (date, amount, method,
--       reference, note); never deleted, voided with a reason.
--   installment_payment_allocations  which schedule rows a payment paid, the
--       oldest unpaid first (due_date, seq).
--   installment_contract_sequence    the one-row counter (no client access).
--   Views (security_invoker): installment_dues (every schedule row with its
--   state and the days to its due date), installment_contract_summary (one
--   row per contract with paid / remaining / overdue / the next due row),
--   installment_payment_list (payments with the two names) and
--   installment_overview (ONE row: overdue, due within 7 and 30 days, the
--   total remaining on the active contracts).
--
-- Permissions (group `installments`, enforced in the database):
--   installments.view    read everything above.
--   installments.manage  financiers, create / edit / cancel a contract,
--                        record and void payments. Requires installments.view.
--   Both held by the admin role; assignable to any role.
--
-- Rules:
--   * Contracts, their units, the schedule, payments and allocations are
--     written ONLY by the SECURITY DEFINER functions below (no write policy).
--   * The money terms (total, down payment, balloon, count, frequency, first
--     due date) change only while the contract has no posted payment
--     (contract_has_payments), and a change rebuilds the schedule. The
--     description, financier, notes and units always change, except on a
--     cancelled contract (contract_not_active).
--   * A payment never exceeds what remains (payment_exceeds_balance) and is
--     never dated after the Saudi today; the one that pays the rest turns the
--     contract paid_off, voiding a payment of a paid-off contract reopens it.
--   * A contract is cancelled only without a posted payment.
--   * Day boundaries are Saudi days (UTC+03:00): saudi_today().
--
-- Stable tokens (the client maps them; raw errors are never shown):
--   installments_manage_required                                   42501
--   invalid_contract, invalid_description, invalid_financier,
--   invalid_amount, invalid_down_payment, invalid_balloon,
--   invalid_installment_count, invalid_frequency,
--   invalid_first_due_date, invalid_notes, invalid_equipment,
--   invalid_payment, invalid_payment_amount, invalid_paid_on,
--   invalid_method, invalid_reference, invalid_note, reason_required,
--   payment_exceeds_balance                                         22023
--   contract_not_active, contract_has_payments,
--   payment_already_voided                                          55000
--
-- Rollout: apply 0203 BEFORE deploying the installments screens. Nothing
-- live depends on it.

DO $$
BEGIN
  IF to_regprocedure('public.next_quotation_number()') IS NULL
     OR to_regprocedure('public.has_permission(text)') IS NULL THEN
    RAISE EXCEPTION '0203: migration 0202 and the roles system must be applied first';
  END IF;
END;
$$;

-- ===========================================================================
-- 1. The permission keys, held by the admin role
-- ===========================================================================
INSERT INTO public.permissions (
  key, group_key, name_ar, name_en, description_ar, description_en,
  scoped, scopes, requires, admin_only, enforced_in, sort
) VALUES
  ('installments.view', 'installments',
   'الاقساط: عرض', 'Installments: view',
   'عرض عقود الاقساط وجدول اقساطها وسداداتها ومواعيد الاستحقاق.',
   'View installment contracts, their schedules, payments and due dates.',
   false, NULL, '{}', false, 'database', 1200),
  ('installments.manage', 'installments',
   'الاقساط: ادارة العقود والسداد', 'Installments: manage contracts and payments',
   'اضافة الجهات وانشاء عقود الاقساط وتعديلها والغاؤها وتسجيل السداد والغاؤه.',
   'Add financiers, create, edit or cancel installment contracts, and record or void payments.',
   false, NULL, ARRAY['installments.view'], false, 'database', 1210)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_key, permission_key, scope)
VALUES
  ('admin', 'installments.view', NULL),
  ('admin', 'installments.manage', NULL)
ON CONFLICT (role_key, permission_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.assert_installments_manage()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('installments.manage') THEN
    RAISE EXCEPTION 'installments_manage_required' USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_installments_manage() IS
  '0203: raises installments_manage_required (42501) unless the caller is signed in and holds installments.manage. Called first by every installments writer.';

REVOKE ALL ON FUNCTION public.assert_installments_manage()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.saudi_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date;
$$;

COMMENT ON FUNCTION public.saudi_today() IS
  '0203: today as a Saudi day (UTC+03:00), the day boundary of the installment states and of a payment date.';

REVOKE ALL ON FUNCTION public.saudi_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saudi_today() TO authenticated;

-- ===========================================================================
-- 2. Financiers: a small list of names, written directly under RLS
-- ===========================================================================
CREATE TABLE public.installment_financiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
    CONSTRAINT installment_financiers_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX installment_financiers_name_unique
  ON public.installment_financiers (lower(btrim(name)));

COMMENT ON TABLE public.installment_financiers IS
  '0203: who an installment contract is owed to — a bank or a dealer, by name only. Read by installments.view; inserted, renamed and deleted directly (RLS) by installments.manage; a financier with contracts is not deleted (installment_contracts_financier_id_fkey, RESTRICT).';

CREATE OR REPLACE FUNCTION public.normalise_installment_financier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.name := btrim(NEW.name);
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

CREATE TRIGGER installment_financiers_normalise
  BEFORE INSERT OR UPDATE ON public.installment_financiers
  FOR EACH ROW EXECUTE FUNCTION public.normalise_installment_financier();

CREATE TRIGGER installment_financiers_updated_at
  BEFORE UPDATE ON public.installment_financiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.installment_financiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_installment_financiers ON public.installment_financiers
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('installments.view')));

CREATE POLICY insert_installment_financiers ON public.installment_financiers
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_permission('installments.manage')));

CREATE POLICY update_installment_financiers ON public.installment_financiers
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_permission('installments.manage')))
  WITH CHECK ((SELECT public.has_permission('installments.manage')));

CREATE POLICY delete_installment_financiers ON public.installment_financiers
  FOR DELETE TO authenticated
  USING ((SELECT public.has_permission('installments.manage')));

REVOKE ALL ON TABLE public.installment_financiers FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.installment_financiers FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.installment_financiers TO authenticated;

-- ===========================================================================
-- 3. The contract number: INS- + a global sequence that never restarts
-- ===========================================================================
CREATE TABLE public.installment_contract_sequence (
  singleton boolean PRIMARY KEY DEFAULT true
    CONSTRAINT installment_contract_sequence_singleton CHECK (singleton),
  last_seq integer NOT NULL DEFAULT 0
    CONSTRAINT installment_contract_sequence_last_seq_check CHECK (last_seq >= 0)
);

INSERT INTO public.installment_contract_sequence (singleton, last_seq)
VALUES (true, 0)
ON CONFLICT (singleton) DO NOTHING;

COMMENT ON TABLE public.installment_contract_sequence IS
  '0203: the ONE row holding the last issued installment contract number (INS-0001, a global sequence that never restarts). Read and written only by next_installment_contract_number(); no client access.';

ALTER TABLE public.installment_contract_sequence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.installment_contract_sequence FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.next_installment_contract_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seq integer;
BEGIN
  -- The one row, locked by the UPDATE itself: concurrent creations queue
  -- here and each takes its own number.
  UPDATE public.installment_contract_sequence
  SET last_seq = last_seq + 1
  WHERE singleton
  RETURNING last_seq INTO v_seq;
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'installment_contract_sequence_missing' USING ERRCODE = '55000';
  END IF;
  -- lpad() CUTS a longer text to the length it is given, so past 9999 the
  -- length is the sequence's own.
  RETURN 'INS-' || lpad(v_seq::text, GREATEST(4, char_length(v_seq::text)), '0');
END;
$$;

COMMENT ON FUNCTION public.next_installment_contract_number() IS
  '0203: consumes and returns the next installment contract number, INS- + a global sequence of at least four digits that never restarts (INS-0001). Called by save_installment_contract for a new contract. The counter is a table row, so a rolled-back call takes its number back.';

REVOKE ALL ON FUNCTION public.next_installment_contract_number()
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 4. Contracts
-- ===========================================================================
CREATE TABLE public.installment_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number text NOT NULL UNIQUE
    CONSTRAINT installment_contracts_number_format CHECK (contract_number ~ '^INS-[0-9]{4,}$'),
  description text NOT NULL
    CONSTRAINT installment_contracts_description_check
      CHECK (char_length(btrim(description)) BETWEEN 1 AND 200),
  financier_id uuid NOT NULL REFERENCES public.installment_financiers(id) ON DELETE RESTRICT,
  total_amount numeric(14, 2) NOT NULL
    CONSTRAINT installment_contracts_total_check CHECK (total_amount > 0),
  down_payment numeric(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT installment_contracts_down_payment_check CHECK (down_payment >= 0),
  balloon_amount numeric(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT installment_contracts_balloon_check CHECK (balloon_amount >= 0),
  financed_amount numeric(14, 2) GENERATED ALWAYS AS (total_amount - down_payment) STORED,
  installment_count integer NOT NULL
    CONSTRAINT installment_contracts_count_check CHECK (installment_count BETWEEN 1 AND 360),
  frequency_months smallint NOT NULL DEFAULT 1
    CONSTRAINT installment_contracts_frequency_check CHECK (frequency_months IN (1, 2, 3, 6, 12)),
  first_due_date date NOT NULL,
  notes text
    CONSTRAINT installment_contracts_notes_check CHECK (char_length(notes) <= 1000),
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT installment_contracts_status_check CHECK (status IN ('active', 'paid_off', 'cancelled')),
  closed_at timestamptz,
  cancel_reason text
    CONSTRAINT installment_contracts_cancel_reason_check CHECK (char_length(cancel_reason) <= 500),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installment_contracts_down_payment_lt_total
    CHECK (down_payment < total_amount),
  -- A balloon is the last of at least two payments and smaller than the
  -- financed amount.
  CONSTRAINT installment_contracts_balloon_shape CHECK (
    balloon_amount = 0
    OR (installment_count >= 2 AND balloon_amount < total_amount - down_payment)
  ),
  CONSTRAINT installment_contracts_closed_at_check
    CHECK ((status = 'active') = (closed_at IS NULL))
);

CREATE INDEX installment_contracts_status_idx
  ON public.installment_contracts (status, updated_at DESC);
CREATE INDEX installment_contracts_financier_idx
  ON public.installment_contracts (financier_id);

COMMENT ON TABLE public.installment_contracts IS
  '0203: something the company buys on credit. The number is consumed at creation; the schedule is generated from the terms. Read by installments.view; written only by save_installment_contract, cancel_installment_contract and the payment functions (status).';
COMMENT ON COLUMN public.installment_contracts.description IS
  '0203: free text, what was bought. The link to units (installment_contract_equipment) is optional.';
COMMENT ON COLUMN public.installment_contracts.down_payment IS
  '0203: paid when the contract was made; it is NOT a schedule row and no payment is recorded for it.';
COMMENT ON COLUMN public.installment_contracts.balloon_amount IS
  '0203: the final larger payment (0 = none). It is the LAST of installment_count payments.';
COMMENT ON COLUMN public.installment_contracts.financed_amount IS
  '0203: total_amount - down_payment: what the schedule adds up to.';

CREATE TRIGGER installment_contracts_updated_at
  BEFORE UPDATE ON public.installment_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.installment_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_installment_contracts ON public.installment_contracts
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('installments.view')));

-- The optional link to units. A pure link table: created_at only.
CREATE TABLE public.installment_contract_equipment (
  contract_id uuid NOT NULL REFERENCES public.installment_contracts(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, equipment_id)
);

CREATE INDEX installment_contract_equipment_equipment_idx
  ON public.installment_contract_equipment (equipment_id);

COMMENT ON TABLE public.installment_contract_equipment IS
  '0203: the OPTIONAL link of a contract to units, with no rule on the unit (any owner; a unit may sit on several contracts). Read by installments.view; written only by save_installment_contract.';

ALTER TABLE public.installment_contract_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_installment_contract_equipment ON public.installment_contract_equipment
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('installments.view')));

-- ===========================================================================
-- 5. The schedule
-- ===========================================================================
CREATE TABLE public.installment_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.installment_contracts(id) ON DELETE CASCADE,
  seq integer NOT NULL
    CONSTRAINT installment_schedule_seq_check CHECK (seq >= 1),
  due_date date NOT NULL,
  amount numeric(14, 2) NOT NULL
    CONSTRAINT installment_schedule_amount_check CHECK (amount > 0),
  is_balloon boolean NOT NULL DEFAULT false,
  paid_amount numeric(14, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installment_schedule_unique UNIQUE (contract_id, seq),
  CONSTRAINT installment_schedule_paid_check CHECK (paid_amount >= 0 AND paid_amount <= amount)
);

CREATE INDEX installment_schedule_contract_idx
  ON public.installment_schedule (contract_id, due_date, seq);
CREATE INDEX installment_schedule_open_due_idx
  ON public.installment_schedule (due_date)
  WHERE paid_amount < amount;

COMMENT ON TABLE public.installment_schedule IS
  '0203: one row per payment of a contract, generated by generate_installment_schedule() from the terms and never typed in. paid_amount is moved only by record_installment_payment / void_installment_payment. Read by installments.view.';

CREATE TRIGGER installment_schedule_updated_at
  BEFORE UPDATE ON public.installment_schedule
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.installment_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_installment_schedule ON public.installment_schedule
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('installments.view')));

CREATE OR REPLACE FUNCTION public.installment_state(
  p_due_date date,
  p_amount numeric,
  p_paid_amount numeric,
  p_today date
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_paid_amount >= p_amount THEN 'paid'
    WHEN p_due_date < p_today THEN 'overdue'
    WHEN p_due_date = p_today THEN 'due_today'
    WHEN p_due_date <= p_today + 30 THEN 'due_soon'
    ELSE 'upcoming'
  END;
$$;

COMMENT ON FUNCTION public.installment_state(date, numeric, numeric, date) IS
  '0203: paid / overdue (due day passed, not fully paid) / due_today / due_soon (within 30 days) / upcoming. A partly paid row keeps its state by date; paid_amount > 0 marks it partial. src/lib/installments.ts installmentState() mirrors it.';

REVOKE ALL ON FUNCTION public.installment_state(date, numeric, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.installment_state(date, numeric, numeric, date) TO authenticated;

-- Months are added to the FIRST due date (not chained), so a 31st stays the
-- month's last day: 2026-01-31, 2026-02-28, 2026-03-31.
CREATE OR REPLACE FUNCTION public.generate_installment_schedule(p_contract_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
  v_regular_count integer;
  v_regular_total numeric(14, 2);
  v_each numeric(14, 2);
  v_i integer;
  v_amount numeric(14, 2);
BEGIN
  SELECT * INTO c FROM public.installment_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.installment_schedule WHERE contract_id = p_contract_id;

  v_regular_count := c.installment_count - CASE WHEN c.balloon_amount > 0 THEN 1 ELSE 0 END;
  v_regular_total := c.financed_amount - c.balloon_amount;
  v_each := trunc(v_regular_total / v_regular_count, 2);

  FOR v_i IN 1..v_regular_count LOOP
    v_amount := CASE
      WHEN v_i = v_regular_count THEN v_regular_total - v_each * (v_regular_count - 1)
      ELSE v_each
    END;
    INSERT INTO public.installment_schedule (contract_id, seq, due_date, amount, is_balloon)
    VALUES (
      p_contract_id,
      v_i,
      (c.first_due_date + make_interval(months => (v_i - 1) * c.frequency_months))::date,
      v_amount,
      false
    );
  END LOOP;

  IF c.balloon_amount > 0 THEN
    INSERT INTO public.installment_schedule (contract_id, seq, due_date, amount, is_balloon)
    VALUES (
      p_contract_id,
      c.installment_count,
      (c.first_due_date + make_interval(months => (c.installment_count - 1) * c.frequency_months))::date,
      c.balloon_amount,
      true
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.generate_installment_schedule(uuid) IS
  '0203: (re)builds a contract''s schedule from its terms: equal regular payments truncated to the halala, the remainder on the last regular one, the balloon (if any) as the last row. Called only by save_installment_contract, only while the contract has no posted payment. src/lib/installments.ts buildSchedule() mirrors it for the preview.';

REVOKE ALL ON FUNCTION public.generate_installment_schedule(uuid)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 6. Payments and their allocations
-- ===========================================================================
CREATE TABLE public.installment_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.installment_contracts(id) ON DELETE RESTRICT,
  paid_on date NOT NULL,
  amount numeric(14, 2) NOT NULL
    CONSTRAINT installment_payments_amount_check CHECK (amount > 0),
  method text NOT NULL
    CONSTRAINT installment_payments_method_check
      CHECK (method IN ('transfer', 'cheque', 'auto_debit', 'cash')),
  reference text
    CONSTRAINT installment_payments_reference_check CHECK (char_length(reference) <= 80),
  note text
    CONSTRAINT installment_payments_note_check CHECK (char_length(note) <= 500),
  status text NOT NULL DEFAULT 'posted'
    CONSTRAINT installment_payments_status_check CHECK (status IN ('posted', 'voided')),
  voided_at timestamptz,
  voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  void_reason text
    CONSTRAINT installment_payments_void_reason_check CHECK (char_length(void_reason) <= 500),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installment_payments_voided_check
    CHECK ((status = 'voided') = (voided_at IS NOT NULL))
);

CREATE INDEX installment_payments_contract_idx
  ON public.installment_payments (contract_id, paid_on DESC, created_at DESC);

COMMENT ON TABLE public.installment_payments IS
  '0203: a payment of a contract. Never deleted: a mistake is voided with a reason (void_installment_payment), and the row keeps who recorded it and who voided it. Read by installments.view; written only by the payment functions.';

CREATE TRIGGER installment_payments_updated_at
  BEFORE UPDATE ON public.installment_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.installment_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_installment_payments ON public.installment_payments
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('installments.view')));

CREATE TABLE public.installment_payment_allocations (
  payment_id uuid NOT NULL REFERENCES public.installment_payments(id) ON DELETE CASCADE,
  -- CASCADE: a schedule is rebuilt only while the contract has no POSTED
  -- payment, so the rows that go with it are allocations of voided payments
  -- (found in the rehearsal: RESTRICT refused a term change after a void).
  schedule_id uuid NOT NULL REFERENCES public.installment_schedule(id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL
    CONSTRAINT installment_payment_allocations_amount_check CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, schedule_id)
);

CREATE INDEX installment_payment_allocations_schedule_idx
  ON public.installment_payment_allocations (schedule_id);

COMMENT ON TABLE public.installment_payment_allocations IS
  '0203: which schedule rows a payment paid (oldest unpaid first). A link table: created_at only. A voided payment keeps its allocations as history (its amounts are taken back from paid_amount) until the schedule is rebuilt by a term change, which removes them with the old rows.';

ALTER TABLE public.installment_payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_installment_payment_allocations ON public.installment_payment_allocations
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('installments.view')));

-- A change of a contract's units or payments counts as a change of the
-- contract.
CREATE OR REPLACE FUNCTION public.touch_installment_contract_from_child()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.installment_contracts
  SET updated_at = now()
  WHERE id = COALESCE(NEW.contract_id, OLD.contract_id);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_installment_contract_from_child()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER installment_contract_equipment_touch_contract
  AFTER INSERT OR UPDATE OR DELETE ON public.installment_contract_equipment
  FOR EACH ROW EXECUTE FUNCTION public.touch_installment_contract_from_child();
CREATE TRIGGER installment_payments_touch_contract
  AFTER INSERT OR UPDATE OR DELETE ON public.installment_payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_installment_contract_from_child();

REVOKE ALL ON TABLE
  public.installment_contracts,
  public.installment_contract_equipment,
  public.installment_schedule,
  public.installment_payments,
  public.installment_payment_allocations
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE
  public.installment_contracts,
  public.installment_contract_equipment,
  public.installment_schedule,
  public.installment_payments,
  public.installment_payment_allocations
TO authenticated;

-- ===========================================================================
-- 7. The contract functions
-- ===========================================================================

-- Validates the money terms; raises the stable tokens.
-- src/lib/installments.ts checkInstallmentTerms() mirrors the order.
CREATE OR REPLACE FUNCTION public.assert_installment_terms(
  p_total_amount numeric,
  p_down_payment numeric,
  p_balloon_amount numeric,
  p_installment_count integer,
  p_frequency_months integer,
  p_first_due_date date
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total numeric;
  v_down numeric;
  v_balloon numeric;
  v_financed numeric;
BEGIN
  v_total := round(p_total_amount, 2);
  v_down := round(COALESCE(p_down_payment, 0), 2);
  v_balloon := round(COALESCE(p_balloon_amount, 0), 2);

  IF v_total IS NULL OR v_total <= 0 OR v_total > 999999999999.99 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF v_down < 0 OR v_down >= v_total THEN
    RAISE EXCEPTION 'invalid_down_payment' USING ERRCODE = '22023';
  END IF;
  IF p_installment_count IS NULL OR p_installment_count < 1 OR p_installment_count > 360 THEN
    RAISE EXCEPTION 'invalid_installment_count' USING ERRCODE = '22023';
  END IF;
  IF p_frequency_months IS NULL OR p_frequency_months NOT IN (1, 2, 3, 6, 12) THEN
    RAISE EXCEPTION 'invalid_frequency' USING ERRCODE = '22023';
  END IF;
  IF p_first_due_date IS NULL THEN
    RAISE EXCEPTION 'invalid_first_due_date' USING ERRCODE = '22023';
  END IF;
  v_financed := v_total - v_down;
  IF v_balloon < 0
     OR (v_balloon > 0 AND (p_installment_count < 2 OR v_balloon >= v_financed)) THEN
    RAISE EXCEPTION 'invalid_balloon' USING ERRCODE = '22023';
  END IF;
  -- Each regular payment is at least one halala.
  IF trunc((v_financed - v_balloon)
           / (p_installment_count - CASE WHEN v_balloon > 0 THEN 1 ELSE 0 END), 2) <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_installment_terms(
  numeric, numeric, numeric, integer, integer, date
) FROM PUBLIC, anon, authenticated;

-- p_id NULL = a new contract (its number is taken after every check), else
-- the contract edited. p_equipment_ids NULL or empty = no linked unit.
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
  p_equipment_ids uuid[] DEFAULT NULL
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
      notes, created_by
    ) VALUES (
      public.next_installment_contract_number(), v_description, p_financier_id,
      v_total, v_down, v_balloon, p_installment_count, p_frequency_months,
      p_first_due_date, v_notes, auth.uid()
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
      notes = v_notes
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
  uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[]
) IS
  '0203: creates (p_id NULL) or edits an installment contract with its generated schedule and its optional units in one transaction. The money terms change only without a posted payment (contract_has_payments) and a change rebuilds the schedule; the description, financier, notes and units always change, except on a cancelled contract (contract_not_active). installments.manage. Returns the contract id.';

REVOKE ALL ON FUNCTION public.save_installment_contract(
  uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_installment_contract(
  uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[]
) TO authenticated;

-- A contract entered by mistake. Refused once a payment is posted (void the
-- payments first).
CREATE OR REPLACE FUNCTION public.cancel_installment_contract(
  p_contract_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c public.installment_contracts%ROWTYPE;
  v_reason text;
BEGIN
  PERFORM public.assert_installments_manage();

  v_reason := btrim(COALESCE(p_reason, ''));
  IF v_reason = '' OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c FROM public.installment_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
  END IF;
  IF c.status <> 'active' THEN
    RAISE EXCEPTION 'contract_not_active' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.installment_payments p
    WHERE p.contract_id = c.id AND p.status = 'posted'
  ) THEN
    RAISE EXCEPTION 'contract_has_payments' USING ERRCODE = '55000';
  END IF;

  UPDATE public.installment_contracts
  SET status = 'cancelled', closed_at = now(), cancel_reason = v_reason
  WHERE id = c.id;
END;
$$;

COMMENT ON FUNCTION public.cancel_installment_contract(uuid, text) IS
  '0203: cancels an active contract entered by mistake (a reason of 1 to 500 characters); refused once a payment is posted (contract_has_payments). installments.manage.';

REVOKE ALL ON FUNCTION public.cancel_installment_contract(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_installment_contract(uuid, text) TO authenticated;

-- ===========================================================================
-- 8. The payment functions
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.record_installment_payment(
  p_contract_id uuid,
  p_paid_on date,
  p_amount numeric,
  p_method text,
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL
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
  v_remaining numeric(14, 2);
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

  SELECT COALESCE(sum(s.amount - s.paid_amount), 0) INTO v_remaining
  FROM public.installment_schedule s WHERE s.contract_id = c.id;
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'payment_exceeds_balance' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.installment_payments (
    contract_id, paid_on, amount, method, reference, note, created_by
  ) VALUES (
    c.id, p_paid_on, v_amount, p_method, v_reference, v_note, auth.uid()
  )
  RETURNING id INTO v_payment_id;

  v_left := v_amount;
  FOR r IN
    SELECT s.id, s.amount - s.paid_amount AS open_amount
    FROM public.installment_schedule s
    WHERE s.contract_id = c.id AND s.paid_amount < s.amount
    ORDER BY s.due_date, s.seq
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(v_left, r.open_amount);
    UPDATE public.installment_schedule SET paid_amount = paid_amount + v_take WHERE id = r.id;
    INSERT INTO public.installment_payment_allocations (payment_id, schedule_id, amount)
    VALUES (v_payment_id, r.id, v_take);
    v_left := v_left - v_take;
  END LOOP;

  IF v_amount = v_remaining THEN
    UPDATE public.installment_contracts SET status = 'paid_off', closed_at = now() WHERE id = c.id;
  END IF;

  RETURN v_payment_id;
END;
$$;

COMMENT ON FUNCTION public.record_installment_payment(uuid, date, numeric, text, text, text) IS
  '0203: records a payment on an active contract (not dated after the Saudi today) and allocates it to the oldest unpaid schedule rows; never more than what remains; the one that pays the rest turns the contract paid_off. installments.manage. Returns the payment id.';

REVOKE ALL ON FUNCTION public.record_installment_payment(uuid, date, numeric, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_installment_payment(uuid, date, numeric, text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.void_installment_payment(
  p_payment_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p public.installment_payments%ROWTYPE;
  c public.installment_contracts%ROWTYPE;
  v_reason text;
BEGIN
  PERFORM public.assert_installments_manage();

  v_reason := btrim(COALESCE(p_reason, ''));
  IF v_reason = '' OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO p FROM public.installment_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;
  -- The contract first, the lock order of record_installment_payment.
  SELECT * INTO c FROM public.installment_contracts WHERE id = p.contract_id FOR UPDATE;
  SELECT * INTO p FROM public.installment_payments WHERE id = p_payment_id FOR UPDATE;
  IF p.status = 'voided' THEN
    RAISE EXCEPTION 'payment_already_voided' USING ERRCODE = '55000';
  END IF;
  IF c.status = 'cancelled' THEN
    RAISE EXCEPTION 'contract_not_active' USING ERRCODE = '55000';
  END IF;

  UPDATE public.installment_schedule s
  SET paid_amount = s.paid_amount - a.amount
  FROM public.installment_payment_allocations a
  WHERE a.payment_id = p.id AND a.schedule_id = s.id;

  UPDATE public.installment_payments
  SET status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  WHERE id = p.id;

  IF c.status = 'paid_off' THEN
    UPDATE public.installment_contracts SET status = 'active', closed_at = NULL WHERE id = c.id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.void_installment_payment(uuid, text) IS
  '0203: voids a payment recorded by mistake (a reason of 1 to 500 characters): its allocations are taken back from the schedule and a paid-off contract reopens. The payment row stays with who voided it. installments.manage.';

REVOKE ALL ON FUNCTION public.void_installment_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_installment_payment(uuid, text) TO authenticated;

-- ===========================================================================
-- 9. The read views (security_invoker: the table policies decide)
-- ===========================================================================
CREATE VIEW public.installment_dues
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
  s.due_date - public.saudi_today() AS days_until_due
FROM public.installment_schedule s
JOIN public.installment_contracts c ON c.id = s.contract_id
JOIN public.installment_financiers f ON f.id = c.financier_id;

COMMENT ON VIEW public.installment_dues IS
  '0203: every schedule row with its contract, financier, derived state (installment_state, Saudi today) and days_until_due (negative = days overdue). The nearest-dues list filters contract_status = active and is_paid = false and sorts by due_date. security_invoker: installments.view through the table policies.';

CREATE VIEW public.installment_contract_summary
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
    AS equipment_count
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
  '0203: one row per contract with every contract column, the financier name, created_by_name (profile_names), paid / remaining totals, the overdue count and amount, the next unpaid row and the unit count. The contracts list and the contract page. security_invoker: installments.view through the table policies.';

CREATE VIEW public.installment_payment_list
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
  p.created_at
FROM public.installment_payments p
LEFT JOIN public.profile_names cb ON cb.id = p.created_by
LEFT JOIN public.profile_names vb ON vb.id = p.voided_by;

COMMENT ON VIEW public.installment_payment_list IS
  '0203: the payments with who recorded and who voided each (profile_names). The payments list of the contract page. security_invoker: installments.view through the table policies.';

-- ONE row, whatever the data: an aggregate without GROUP BY.
CREATE VIEW public.installment_overview
WITH (security_invoker = true) AS
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
  COALESCE(sum(s.amount - s.paid_amount), 0) AS remaining_total,
  count(DISTINCT s.contract_id) AS open_contract_count,
  min(s.due_date) AS next_due_date
FROM public.installment_schedule s
JOIN public.installment_contracts c ON c.id = s.contract_id
WHERE c.status = 'active' AND s.paid_amount < s.amount;

COMMENT ON VIEW public.installment_overview IS
  '0203: ONE row over the unpaid schedule rows of the ACTIVE contracts: overdue (due day passed), due within 7 days and within 30 days (both from today, today included; the 30 contain the 7), the total remaining, the open rows and contracts, and the nearest due date. The four figures above the nearest-dues list. security_invoker: installments.view through the table policies.';

REVOKE ALL ON
  public.installment_dues,
  public.installment_contract_summary,
  public.installment_payment_list,
  public.installment_overview
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON
  public.installment_dues,
  public.installment_contract_summary,
  public.installment_payment_list,
  public.installment_overview
TO authenticated;

-- ===========================================================================
-- 10. The closing guard
-- ===========================================================================
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY[
    'installment_financiers', 'installment_contract_sequence', 'installment_contracts',
    'installment_contract_equipment', 'installment_schedule', 'installment_payments',
    'installment_payment_allocations'
  ]) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_class k
    JOIN pg_namespace n ON n.oid = k.relnamespace
    WHERE n.nspname = 'public' AND k.relname = t AND k.relkind = 'r' AND k.relrowsecurity
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0203: table without row level security: %', v_missing;
  END IF;

  IF (SELECT count(*) FROM public.role_permissions rp
      WHERE rp.role_key = 'admin'
        AND rp.permission_key IN ('installments.view', 'installments.manage')) <> 2 THEN
    RAISE EXCEPTION '0203: the admin role does not hold the two installments keys';
  END IF;
END;
$$;
