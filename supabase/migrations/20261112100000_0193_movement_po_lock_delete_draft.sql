-- 0193: a movement whose card sits on a PO is locked; a draft supplier PO can
-- be deleted; a supplier PO needs a unit; card pricing needs matching units.
--
-- Owner decisions 2026-11-12: «حلو يصير لازم يكون فيه معدة» (C), «حلو قفل
-- الحركة, اعتمده» (A), «حذف الامر الدرافت مو موجود؟ سويه» (B) and «مفروض لو
-- po المورد يومي او po العميل يومي يقبل الكرت, اذا اختلفت الوحدة يرفض» (D).
--
-- Why A: in the «الدرعية» clean-up the movements of several units were
-- corrected to another project while their cards (0189: one card = one
-- visit, equipment_cards.entry_log_id) and the PO lines on those cards stayed
-- in the old company and project. Nothing tied the movement to the card.
--
-- A. guard_movement_with_po() — BEFORE UPDATE OR DELETE trigger
--    entry_exit_logs_po_guard on entry_exit_logs, FOR EACH ROW, so it holds
--    for every path (admin_update_movement, admin_delete_movement, any raw
--    SQL statement). The "cards of a movement" are the equipment_cards rows
--    with entry_log_id = OLD.id (only a site ENTRY ever has one); a card is
--    "on a PO" while a supplier_po_equipment or a client_po_equipment line
--    references it.
--    * DELETE: a card on a PO → movement_on_po (55000), DETAIL = the PO
--      numbers (supplier first, then client; each distinct and ordered;
--      ", " between them). A card on no PO that carries a month record
--      (equipment_card_months, ON DELETE RESTRICT) → movement_on_po, DETAIL
--      'card months'. Every other card of the movement is DELETED by the
--      trigger before the row goes (equipment_card_events cascades with it,
--      0172 ON DELETE CASCADE). Without this the 0137 FK
--      equipment_cards.entry_log_id ON DELETE SET NULL would leave a card
--      without its visit; it is not changed here — after this trigger no
--      card is left for it to null.
--    * UPDATE: the locked facts are equipment_id, company_id, project_id,
--      movement_type, movement_context and the Saudi DAY of recorded_at
--      ((recorded_at AT TIME ZONE 'Asia/Riyadh')::date; a time change inside
--      the same Saudi day is free). When none changes the trigger returns
--      at once, before any query (it runs on every movement update: a
--      classification, a contractor code, a driver correction, notes).
--      Otherwise:
--        - the cards ON a PO must stay CONSISTENT with the new row: the same
--          unit, company and project as NEW, NEW still a site entry and —
--          only when the Saudi day changed — every supplier PO of those
--          cards starting on the new day (0148: a PO's start date is its
--          units' entry day). Anything else → movement_on_po with the PO
--          numbers. The application never moves a card, so for the screens
--          this is a lock; a deliberate data fix can still move the PO and
--          the card first and the movement after, in ONE transaction.
--        - the cards on NO PO FOLLOW the movement: unit, company and project
--          are copied from NEW. When NEW stops being a site entry (or loses
--          its company / project) they are deleted, unless one carries a
--          month record (→ movement_on_po, DETAIL 'card months').
--    * Serialises on the sequence trigger's advisory key of the unit (both
--      units, in uuid order, when the unit changes) and locks the cards FOR
--      UPDATE, but only on the slow path (the movement has cards). The admin
--      functions already hold those keys (re-entrant).
--    * Cheap: equipment_cards_entry_log_idx (0137, partial on entry_log_id
--      IS NOT NULL) serves `entry_log_id = OLD.id`;
--      supplier_po_equipment_card_idx / client_po_equipment_card_idx and the
--      equipment_card_months_unique (card, month) index serve the EXISTS.
--    Paths checked: admin_update_movement (0186) updates the edited row and
--    copies equipment / company / project / contractor code to the PAIRED
--    row, so editing an EXIT fires the trigger on its ENTRY too;
--    admin_delete_movement (0133) deletes the row last. Neither has an
--    EXCEPTION block, so the token and its DETAIL reach the client
--    unchanged (PostgREST: message / details / hint) and both stay as they
--    are. classify_workshop_entry (0158: workshop entries, purpose only),
--    update_entry_contractor_code (0156: the code only),
--    admin_correct_visit_driver (0166: the driver only),
--    enforce_movement_sequence (BEFORE INSERT only) and the AFTER triggers
--    never change a locked fact. companies / projects are ON DELETE RESTRICT
--    from entry_exit_logs since 0134, so no FK action rewrites them.
--
-- B. Deleting a draft supplier PO: delete_supplier_po(p_po_id uuid) RETURNS
--    jsonb {po_id, po_number, line_count, cards_deleted} — purchasing.manage;
--    invalid_po (22023); po_approved_locked (55000) for an approved PO;
--    po_number_issued (55000) for a draft that already carries an OFFICIAL
--    number (approved once and returned: the official numbers stay
--    contiguous, 0190). Every line is deleted with the card rule of
--    remove_supplier_po_equipment (0189) repeated here (not factored out:
--    that function is not re-created): the card goes too when nothing else
--    uses it (draft pricing, no client price, no other supplier line, no
--    client line, no month, no card event). An empty draft is deletable.
--    The PO, its lines (with the unit's code and whether the card went) and
--    its events (supplier_po_events cascades with the PO, 0136 ON DELETE
--    CASCADE, so they are copied first) are kept in the new append-only
--    supplier_po_deletions table, read by purchasing.view.
--    Locks: the PO's lines FOR UPDATE (by id), then the PO row — the order
--    update_supplier_po_equipment and remove_supplier_po_equipment take, so
--    a concurrent line edit cannot deadlock against the delete — then, unit
--    by unit in equipment-id order, the unit's advisory key and the card
--    row (remove_supplier_po_equipment's order).
--
-- C. create_supplier_po (the 0190 body VERBATIM plus one check):
--    p_equipment NULL or [] → po_has_no_lines (55000, the token
--    approve_supplier_po already uses), raised before the draft reference
--    is consumed.
--
-- D. approve_equipment_card_pricing (the 0190 body VERBATIM plus):
--    1. card_pricing_unit_mismatch (55000) when the card's client_price_unit
--       (0185: NOT NULL DEFAULT 'month') differs from the supplier line's
--       rate_unit (0157/0185: NOT NULL DEFAULT 'month'); a daily supplier
--       line with a daily client price is accepted. Cards approved before
--       stay approved (no backfill).
--    2. The linkage approves the PO only when, besides every line sitting on
--       an approved card, NO line of the PO is unpriced (a card may sit on
--       several POs and only its latest PO's line was checked, and a draft
--       line's price can be cleared after its card was approved). Such a PO
--       waits, with no error (supplier_po_approved false in the event).
--    3. The line is re-read under the PO row lock, so the price and unit
--       checked are the locked ones; the line is still the one of the
--       card's LATEST supplier PO (created_at DESC, id DESC), read under the
--       card lock as before.
--
-- E. A closing guard aborts unless the trigger, delete_supplier_po and the
--    table exist and the two re-created functions carry their new tokens.
--
-- Stable tokens:
--   movement_on_po                              55000 (DETAIL: PO numbers
--                                                     or 'card months')
--   invalid_po                                  22023
--   po_approved_locked / po_number_issued       55000
--   po_has_no_lines                             55000
--   card_pricing_unit_mismatch                  55000
--
-- Rollout: the trigger only refuses what the screens should not do; the
-- screens that offer «حذف الامر» and map the new tokens may deploy before or
-- after this migration (a call to a missing function fails as before).

-- ===========================================================================
-- A. The movement lock
-- ===========================================================================
-- Already created by 0137; kept here so the trigger's lookup never lacks it.
CREATE INDEX IF NOT EXISTS equipment_cards_entry_log_idx
  ON public.equipment_cards (entry_log_id)
  WHERE entry_log_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_movement_with_po()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_day date;
  v_new_day date;
  v_site_entry boolean;
  v_numbers text;
  v_inconsistent boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_day := (OLD.recorded_at AT TIME ZONE 'Asia/Riyadh')::date;
    v_new_day := (NEW.recorded_at AT TIME ZONE 'Asia/Riyadh')::date;
    -- The cheap exit: no locked fact changes.
    IF NEW.equipment_id IS NOT DISTINCT FROM OLD.equipment_id
       AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
       AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
       AND NEW.movement_type IS NOT DISTINCT FROM OLD.movement_type
       AND NEW.movement_context IS NOT DISTINCT FROM OLD.movement_context
       AND v_new_day IS NOT DISTINCT FROM v_old_day THEN
      RETURN NEW;
    END IF;
  END IF;

  -- No card from this movement: nothing to guard (every exit, every
  -- workshop row, most entries).
  IF NOT EXISTS (
    SELECT 1 FROM public.equipment_cards c WHERE c.entry_log_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- The sequence trigger's key of the unit(s), in uuid order (re-entrant:
  -- the admin functions already hold it), then the cards themselves.
  IF TG_OP = 'UPDATE' AND NEW.equipment_id IS DISTINCT FROM OLD.equipment_id THEN
    IF NEW.equipment_id < OLD.equipment_id THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));
      PERFORM pg_advisory_xact_lock(hashtextextended(OLD.equipment_id::text, 0));
    ELSE
      PERFORM pg_advisory_xact_lock(hashtextextended(OLD.equipment_id::text, 0));
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.equipment_id::text, 0));
  END IF;

  PERFORM 1
  FROM public.equipment_cards c
  WHERE c.entry_log_id = OLD.id
  ORDER BY c.id
  FOR UPDATE;

  -- The PO numbers of the movement's cards: supplier first, then client.
  SELECT NULLIF(concat_ws(', ',
    (SELECT string_agg(DISTINCT sp.po_number, ', ' ORDER BY sp.po_number)
     FROM public.equipment_cards c
     JOIN public.supplier_po_equipment sl ON sl.equipment_card_id = c.id
     JOIN public.supplier_pos sp ON sp.id = sl.supplier_po_id
     WHERE c.entry_log_id = OLD.id),
    (SELECT string_agg(DISTINCT cp.po_number, ', ' ORDER BY cp.po_number)
     FROM public.equipment_cards c
     JOIN public.client_po_equipment cl ON cl.equipment_card_id = c.id
     JOIN public.client_pos cp ON cp.id = cl.client_po_id
     WHERE c.entry_log_id = OLD.id)
  ), '')
  INTO v_numbers;

  IF TG_OP = 'DELETE' THEN
    IF v_numbers IS NOT NULL THEN
      RAISE EXCEPTION 'movement_on_po'
        USING ERRCODE = '55000',
              DETAIL = v_numbers,
              HINT = 'The unit of this movement sits on a purchase order; remove it from the PO first.';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.equipment_cards c
      JOIN public.equipment_card_months m ON m.equipment_card_id = c.id
      WHERE c.entry_log_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'movement_on_po'
        USING ERRCODE = '55000',
              DETAIL = 'card months',
              HINT = 'The card of this movement has recorded months; delete them first.';
    END IF;
    -- Cards on no PO and without months: they go with their visit (their
    -- equipment_card_events cascade).
    DELETE FROM public.equipment_cards c WHERE c.entry_log_id = OLD.id;
    RETURN OLD;
  END IF;

  -- UPDATE with a changed locked fact.
  v_site_entry := NEW.movement_type = 'entry'
    AND NEW.movement_context = 'site'
    AND NEW.company_id IS NOT NULL
    AND NEW.project_id IS NOT NULL;

  IF v_numbers IS NOT NULL THEN
    -- The cards on a PO must already match the new row (a data fix moves
    -- the PO and the card first, then the movement, in one transaction).
    SELECT
      NOT v_site_entry
      OR EXISTS (
        SELECT 1
        FROM public.equipment_cards c
        WHERE c.entry_log_id = OLD.id
          AND (
            EXISTS (SELECT 1 FROM public.supplier_po_equipment sl WHERE sl.equipment_card_id = c.id)
            OR EXISTS (SELECT 1 FROM public.client_po_equipment cl WHERE cl.equipment_card_id = c.id)
          )
          AND (
            c.equipment_id IS DISTINCT FROM NEW.equipment_id
            OR c.company_id IS DISTINCT FROM NEW.company_id
            OR c.project_id IS DISTINCT FROM NEW.project_id
          )
      )
      OR (
        v_new_day IS DISTINCT FROM v_old_day
        AND EXISTS (
          SELECT 1
          FROM public.equipment_cards c
          JOIN public.supplier_po_equipment sl ON sl.equipment_card_id = c.id
          JOIN public.supplier_pos sp ON sp.id = sl.supplier_po_id
          WHERE c.entry_log_id = OLD.id
            AND sp.start_date IS DISTINCT FROM v_new_day
        )
      )
    INTO v_inconsistent;

    IF v_inconsistent THEN
      RAISE EXCEPTION 'movement_on_po'
        USING ERRCODE = '55000',
              DETAIL = v_numbers,
              HINT = 'The unit of this movement sits on a purchase order; its unit, company, project, type and day are locked.';
    END IF;
  END IF;

  -- The cards on NO PO follow the movement.
  IF NOT v_site_entry THEN
    IF EXISTS (
      SELECT 1
      FROM public.equipment_cards c
      JOIN public.equipment_card_months m ON m.equipment_card_id = c.id
      WHERE c.entry_log_id = OLD.id
        AND NOT EXISTS (SELECT 1 FROM public.supplier_po_equipment sl WHERE sl.equipment_card_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM public.client_po_equipment cl WHERE cl.equipment_card_id = c.id)
    ) THEN
      RAISE EXCEPTION 'movement_on_po'
        USING ERRCODE = '55000',
              DETAIL = 'card months',
              HINT = 'The card of this movement has recorded months; delete them first.';
    END IF;
    DELETE FROM public.equipment_cards c
    WHERE c.entry_log_id = OLD.id
      AND NOT EXISTS (SELECT 1 FROM public.supplier_po_equipment sl WHERE sl.equipment_card_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.client_po_equipment cl WHERE cl.equipment_card_id = c.id);
  ELSE
    UPDATE public.equipment_cards c
    SET equipment_id = NEW.equipment_id,
        company_id = NEW.company_id,
        project_id = NEW.project_id
    WHERE c.entry_log_id = OLD.id
      AND (
        c.equipment_id IS DISTINCT FROM NEW.equipment_id
        OR c.company_id IS DISTINCT FROM NEW.company_id
        OR c.project_id IS DISTINCT FROM NEW.project_id
      )
      AND NOT EXISTS (SELECT 1 FROM public.supplier_po_equipment sl WHERE sl.equipment_card_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.client_po_equipment cl WHERE cl.equipment_card_id = c.id);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_movement_with_po() IS
  '0193 (owner 2026-11-12, «حلو قفل الحركة, اعتمده»): BEFORE UPDATE OR DELETE trigger function of entry_exit_logs. A movement whose card (equipment_cards.entry_log_id) sits on a supplier or client PO cannot be deleted, nor change its unit, company, project, type, context or Saudi day unless the cards on a PO already match the new row (and, for a new day, every supplier PO of them starts on it): movement_on_po (55000), DETAIL = the PO numbers (supplier, then client). A card on no PO follows the movement (unit, company, project), or is deleted with it / when the row stops being a site entry; one with month records refuses (movement_on_po, DETAIL card months). Any other update returns at once.';

REVOKE ALL ON FUNCTION public.guard_movement_with_po() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS entry_exit_logs_po_guard ON public.entry_exit_logs;
CREATE TRIGGER entry_exit_logs_po_guard
  BEFORE UPDATE OR DELETE ON public.entry_exit_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_movement_with_po();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.entry_exit_logs'::regclass
      AND t.tgname = 'entry_exit_logs_po_guard'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION '0193: the trigger entry_exit_logs_po_guard is missing';
  END IF;
END;
$$;

-- ===========================================================================
-- B1. supplier_po_deletions (append-only)
-- ===========================================================================
CREATE TABLE public.supplier_po_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL,
  po_number text NOT NULL,
  lessor_id uuid,
  owner_class text,
  company_id uuid,
  project_id uuid,
  start_date date,
  notes text,
  po_created_at timestamptz,
  po_created_by uuid,
  lines jsonb NOT NULL,
  events jsonb NOT NULL,
  deleted_by uuid,
  deleted_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX supplier_po_deletions_created_idx
  ON public.supplier_po_deletions (created_at DESC);

COMMENT ON TABLE public.supplier_po_deletions IS
  '0193: append-only record of every deleted draft supplier PO (delete_supplier_po): the PO''s facts, its lines [{line_id, equipment_id, equipment_code, card_id, card_deleted, price, rate_unit, note}] and its supplier_po_events rows (which cascade with the PO), with who deleted it and the name from profile_names at that time. po_id has no FK: the PO is gone. Read by purchasing.view; written only by delete_supplier_po; no update or delete path.';

ALTER TABLE public.supplier_po_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_supplier_po_deletions ON public.supplier_po_deletions
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('purchasing.view')));

REVOKE ALL ON TABLE public.supplier_po_deletions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.supplier_po_deletions FROM authenticated;
GRANT SELECT ON TABLE public.supplier_po_deletions TO authenticated;

-- ===========================================================================
-- B2. delete_supplier_po
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.delete_supplier_po(
  p_po_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_po public.supplier_pos%ROWTYPE;
  v_line public.supplier_po_equipment%ROWTYPE;
  v_card public.equipment_cards%ROWTYPE;
  v_unit record;
  v_code text;
  v_card_deleted boolean;
  v_lines jsonb := '[]'::jsonb;
  v_events jsonb;
  v_line_count integer := 0;
  v_cards_deleted integer := 0;
  v_actor_name text;
BEGIN
  PERFORM public.assert_purchasing_manage();

  IF p_po_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.supplier_pos p WHERE p.id = p_po_id) THEN
    RAISE EXCEPTION 'invalid_po' USING ERRCODE = '22023';
  END IF;

  -- The lines first, then the PO: the order of update_supplier_po_equipment
  -- and remove_supplier_po_equipment (line, then PO).
  PERFORM 1
  FROM public.supplier_po_equipment l
  WHERE l.supplier_po_id = p_po_id
  ORDER BY l.id
  FOR UPDATE;

  SELECT * INTO v_po
  FROM public.supplier_pos p
  WHERE p.id = p_po_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_po' USING ERRCODE = '22023';
  END IF;
  IF v_po.approval_status <> 'draft' THEN
    RAISE EXCEPTION 'po_approved_locked'
      USING ERRCODE = '55000',
            HINT = 'An approved PO is locked; return it to draft first.';
  END IF;
  -- 0190: an official number stays issued (the numbers are contiguous).
  IF v_po.po_number !~ '^DRAFT-[0-9]{4,}$' THEN
    RAISE EXCEPTION 'po_number_issued'
      USING ERRCODE = '55000',
            HINT = 'A PO whose official number was issued cannot be deleted.';
  END IF;

  -- The history, before the cascade removes it.
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.seq), '[]'::jsonb)
  INTO v_events
  FROM public.supplier_po_events e
  WHERE e.supplier_po_id = p_po_id;

  -- Unit by unit in equipment-id order (two deletes never wait on each other
  -- in opposite orders): the unit's advisory key, the card row, then the
  -- line — the card rule of remove_supplier_po_equipment (0189).
  FOR v_unit IN
    SELECT DISTINCT c.equipment_id
    FROM public.supplier_po_equipment l
    JOIN public.equipment_cards c ON c.id = l.equipment_card_id
    WHERE l.supplier_po_id = p_po_id
    ORDER BY c.equipment_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_unit.equipment_id::text, 0));

    SELECT e.code INTO v_code
    FROM public.equipment e
    WHERE e.id = v_unit.equipment_id;

    FOR v_line IN
      SELECT l.*
      FROM public.supplier_po_equipment l
      JOIN public.equipment_cards c ON c.id = l.equipment_card_id
      WHERE l.supplier_po_id = p_po_id
        AND c.equipment_id = v_unit.equipment_id
      ORDER BY l.created_at, l.id
    LOOP
      SELECT * INTO v_card
      FROM public.equipment_cards c
      WHERE c.id = v_line.equipment_card_id
      FOR UPDATE;

      DELETE FROM public.supplier_po_equipment WHERE id = v_line.id;
      v_line_count := v_line_count + 1;
      v_card_deleted := false;

      IF v_card.pricing_status = 'draft'
         AND v_card.client_price IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.supplier_po_equipment l
           WHERE l.equipment_card_id = v_card.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.client_po_equipment l
           WHERE l.equipment_card_id = v_card.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.equipment_card_months m
           WHERE m.equipment_card_id = v_card.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.equipment_card_events ev
           WHERE ev.equipment_card_id = v_card.id
         ) THEN
        DELETE FROM public.equipment_cards WHERE id = v_card.id;
        v_card_deleted := true;
        v_cards_deleted := v_cards_deleted + 1;
      END IF;

      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'line_id', v_line.id,
        'equipment_id', v_card.equipment_id,
        'equipment_code', v_code,
        'card_id', v_card.id,
        'card_deleted', v_card_deleted,
        'price', v_line.price,
        'rate_unit', v_line.rate_unit,
        'note', v_line.note
      ));
    END LOOP;
  END LOOP;

  SELECT full_name INTO v_actor_name
  FROM public.profile_names
  WHERE id = auth.uid();

  INSERT INTO public.supplier_po_deletions (
    po_id, po_number, lessor_id, owner_class, company_id, project_id,
    start_date, notes, po_created_at, po_created_by, lines, events,
    deleted_by, deleted_by_name
  ) VALUES (
    v_po.id, v_po.po_number, v_po.lessor_id, v_po.owner_class, v_po.company_id,
    v_po.project_id, v_po.start_date, v_po.notes, v_po.created_at,
    v_po.created_by, v_lines, v_events, auth.uid(), v_actor_name
  );

  -- The events cascade (0136 ON DELETE CASCADE); no line is left.
  DELETE FROM public.supplier_pos WHERE id = v_po.id;

  RETURN jsonb_build_object(
    'po_id', v_po.id,
    'po_number', v_po.po_number,
    'line_count', v_line_count,
    'cards_deleted', v_cards_deleted
  );
END;
$$;

COMMENT ON FUNCTION public.delete_supplier_po(uuid) IS
  '0193 (owner 2026-11-12, «حذف الامر الدرافت مو موجود؟ سويه»): deletes a DRAFT supplier PO that still carries its draft reference (DRAFT-####) — po_approved_locked for an approved PO, po_number_issued for a draft that holds an official number (returned after an approval), invalid_po. Every line goes with the card rule of remove_supplier_po_equipment (the card too when nothing else uses it: draft pricing, no client price, no other supplier or client line, no month, no card event). The PO, its lines and its events are recorded in supplier_po_deletions first. An empty draft is deletable. Returns {po_id, po_number, line_count, cards_deleted}. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.delete_supplier_po(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_supplier_po(uuid)
  TO authenticated;

-- ===========================================================================
-- C. create_supplier_po: 0190 verbatim plus po_has_no_lines
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.create_supplier_po(
  p_lessor_id uuid,
  p_owner_class text,
  p_company_id uuid,
  p_project_id uuid,
  p_start_date date,
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
  v_item jsonb;
BEGIN
  PERFORM public.assert_purchasing_manage();

  -- Exactly one party: a lessor row, or an owner class.
  IF p_lessor_id IS NULL AND p_owner_class IS NULL THEN
    RAISE EXCEPTION 'party_required' USING ERRCODE = '22023';
  END IF;
  IF p_lessor_id IS NOT NULL AND p_owner_class IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_party' USING ERRCODE = '22023';
  END IF;
  IF p_owner_class IS NOT NULL
     AND p_owner_class NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b') THEN
    RAISE EXCEPTION 'invalid_owner_class' USING ERRCODE = '22023';
  END IF;
  IF p_lessor_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.lessors l WHERE l.id = p_lessor_id) THEN
    RAISE EXCEPTION 'invalid_lessor' USING ERRCODE = '22023';
  END IF;
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
  IF p_equipment IS NOT NULL AND jsonb_typeof(p_equipment) <> 'array' THEN
    RAISE EXCEPTION 'invalid_equipment' USING ERRCODE = '22023';
  END IF;
  -- 0193 (owner 2026-11-12, «حلو يصير لازم يكون فيه معدة»): a PO is created
  -- with at least one unit; checked before the draft reference is consumed.
  IF p_equipment IS NULL OR jsonb_array_length(p_equipment) = 0 THEN
    RAISE EXCEPTION 'po_has_no_lines'
      USING ERRCODE = '55000',
            HINT = 'A purchase order needs at least one unit.';
  END IF;

  -- 0190: a new PO is a draft and carries a draft reference; the official
  -- number is issued at its first approval.
  v_number := public.next_supplier_po_draft_ref();

  INSERT INTO public.supplier_pos (
    po_number, lessor_id, owner_class, is_internal, company_id, project_id,
    start_date, notes, created_by
  ) VALUES (
    v_number, p_lessor_id, p_owner_class, COALESCE(p_owner_class = 'alazani', false),
    p_company_id, p_project_id, p_start_date,
    NULLIF(btrim(p_notes), ''), auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
  VALUES (
    v_id, 'created',
    jsonb_build_object(
      'po_number', v_number,
      'lessor_id', p_lessor_id,
      'owner_class', p_owner_class,
      'company_id', p_company_id,
      'project_id', p_project_id,
      'start_date', p_start_date
    ),
    auth.uid()
  );

  -- The equipment, in the same transaction: every line passes the rules of
  -- add_supplier_po_equipment or the whole call (and the reference) is
  -- rolled back. Each item: {"equipment_id": uuid, "price": number|null,
  -- "note": text|null, "rate_unit": "month"|"day"|null} (0157: the unit;
  -- null or missing = month).
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_equipment, '[]'::jsonb))
  LOOP
    PERFORM public.add_supplier_po_equipment(
      v_id,
      NULLIF(v_item->>'equipment_id', '')::uuid,
      NULLIF(v_item->>'price', '')::numeric,
      v_item->>'note',
      NULLIF(v_item->>'rate_unit', '')
    );
  END LOOP;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb) IS
  '0136/0138/0139/0148/0157/0189/0190/0193: creates a supplier PO (a draft; no open / closed state since 0189) for a party (a lessor OR an owner class) under a DRAFT REFERENCE (DRAFT-####, 0190: the official PO number is issued at its first approval) and, in the same transaction, its equipment lines (p_equipment: [{equipment_id, price|null, note, rate_unit month|week|day|hour}], at least one since 0193 — po_has_no_lines otherwise, before the reference is taken) through add_supplier_po_equipment, so every unit must have entered on the start date (entry_date_mismatch rolls the whole call back); a unit may already sit on other POs. Needs purchasing.manage.';

REVOKE ALL ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb)
  TO authenticated;

-- ===========================================================================
-- D. approve_equipment_card_pricing: 0190 verbatim plus the unit match, the
--    priced-lines rule of the linkage and the line read under the PO lock
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.approve_equipment_card_pricing(
  p_card_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card public.equipment_cards%ROWTYPE;
  v_line public.supplier_po_equipment%ROWTYPE;
  v_po public.supplier_pos%ROWTYPE;
  v_po_approved boolean := false;
  v_line_count integer;
  v_po_number text;
  v_draft_ref text;
BEGIN
  PERFORM public.assert_sales_approve();

  IF p_card_id IS NULL THEN
    RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_card
  FROM public.equipment_cards c
  WHERE c.id = p_card_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_card' USING ERRCODE = '22023';
  END IF;
  IF v_card.pricing_status <> 'draft' THEN
    RAISE EXCEPTION 'card_pricing_not_draft'
      USING ERRCODE = '55000',
            HINT = 'The card''s pricing is already approved.';
  END IF;
  IF v_card.client_price IS NULL THEN
    RAISE EXCEPTION 'card_pricing_no_client_price'
      USING ERRCODE = '55000',
            HINT = 'The card needs a client price before approval.';
  END IF;

  -- The supplier line: the line of the card's LATEST supplier PO, as the
  -- view does (0189: a card may sit on several POs and none is «open»).
  SELECT sl.* INTO v_line
  FROM public.supplier_po_equipment sl
  JOIN public.supplier_pos sp ON sp.id = sl.supplier_po_id
  WHERE sl.equipment_card_id = p_card_id
  ORDER BY sp.created_at DESC, sp.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'card_pricing_no_supplier_line'
      USING ERRCODE = '55000',
            HINT = 'The card sits on no supplier PO.';
  END IF;

  -- The PO row lock: every purchasing write and approve_supplier_po take it,
  -- so nothing changes the PO or its lines between the checks and the update.
  SELECT * INTO v_po
  FROM public.supplier_pos p
  WHERE p.id = v_line.supplier_po_id
  FOR UPDATE;

  -- 0193: the line again, under the PO lock, so the price and the unit
  -- checked below are the locked ones (the card lock above keeps the choice
  -- of the latest PO's line: no line of this card is added or removed
  -- meanwhile).
  SELECT * INTO v_line
  FROM public.supplier_po_equipment sl
  WHERE sl.id = v_line.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'card_pricing_no_supplier_line'
      USING ERRCODE = '55000',
            HINT = 'The card sits on no supplier PO.';
  END IF;

  IF v_line.price IS NULL THEN
    RAISE EXCEPTION 'card_pricing_no_supplier_price'
      USING ERRCODE = '55000',
            HINT = 'The supplier line of the card needs a price before approval.';
  END IF;

  -- 0193 (owner 2026-11-12, «اذا اختلفت الوحدة يرفض»): the client price and
  -- the supplier line are in the same unit (a daily line with a daily client
  -- price is fine). Both columns are NOT NULL with the default month.
  IF v_card.client_price_unit IS DISTINCT FROM v_line.rate_unit THEN
    RAISE EXCEPTION 'card_pricing_unit_mismatch'
      USING ERRCODE = '55000',
            HINT = format(
              'The client price is per %s and the supplier line per %s; the units must match.',
              v_card.client_price_unit, v_line.rate_unit
            );
  END IF;

  UPDATE public.equipment_cards
  SET pricing_status = 'approved',
      pricing_approved_at = now(),
      pricing_approved_by = auth.uid()
  WHERE id = p_card_id;

  -- Owner 2026-11-04 («الاعتماد يخلي PO المورد يصير معتمد»): when every line
  -- of the PO sits on a card whose pricing is approved (this one included,
  -- updated above) and the PO is a draft, the PO becomes approved —
  -- directly, not through approve_supplier_po: its purchasing.approve and
  -- self-approval checks belong to the manual path. A PO with other cards
  -- still in draft waits for them. 0193: so does a PO with an unpriced line.
  IF v_po.approval_status = 'draft' THEN
    SELECT count(*) INTO v_line_count
    FROM public.supplier_po_equipment l
    WHERE l.supplier_po_id = v_po.id;
    IF v_line_count > 0 AND NOT EXISTS (
      SELECT 1
      FROM public.supplier_po_equipment l
      JOIN public.equipment_cards c ON c.id = l.equipment_card_id
      WHERE l.supplier_po_id = v_po.id
        AND c.pricing_status <> 'approved'
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.supplier_po_equipment l
      WHERE l.supplier_po_id = v_po.id
        AND l.price IS NULL
    ) THEN
      v_po_approved := true;
    END IF;
  END IF;

  -- 0190: the number the PO ends up with, decided before the card event —
  -- the first approval issues the official number in place of the draft
  -- reference; a PO returned to draft keeps the number it had.
  v_po_number := v_po.po_number;
  IF v_po_approved AND v_po.po_number ~ '^DRAFT-[0-9]{4,}$' THEN
    v_draft_ref := v_po.po_number;
    v_po_number := public.next_supplier_po_number();
  END IF;

  PERFORM public.record_equipment_card_event(
    p_card_id,
    'pricing_approved',
    jsonb_build_object(
      'client_price', v_card.client_price,
      'client_price_unit', v_card.client_price_unit,
      'supplier_price', v_line.price,
      'supplier_rate_unit', v_line.rate_unit,
      'supplier_po_id', v_po.id,
      'supplier_po_number', v_po_number,
      'supplier_po_approved', v_po_approved
    )
  );

  IF v_po_approved THEN
    UPDATE public.supplier_pos
    SET approval_status = 'approved',
        approved_at = now(),
        approved_by = auth.uid(),
        po_number = v_po_number
    WHERE id = v_po.id;

    -- The 0160 event shape (actor_id; the PO page resolves the name).
    INSERT INTO public.supplier_po_events (supplier_po_id, event_type, payload, actor_id)
    VALUES (
      v_po.id, 'approved',
      jsonb_build_object(
        'via', 'card_pricing',
        'card_id', p_card_id,
        'line_count', v_line_count,
        'po_number', v_po_number
      )
        || CASE
             WHEN v_draft_ref IS NOT NULL THEN jsonb_build_object('draft_ref', v_draft_ref)
             ELSE '{}'::jsonb
           END,
      auth.uid()
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.approve_equipment_card_pricing(uuid) IS
  '0174/0185/0189/0190/0193: approves the pricing of one equipment card — needs sales.approve, a DRAFT card (card_pricing_not_draft) with a client price (card_pricing_no_client_price) and a priced supplier line (card_pricing_no_supplier_line when the card sits on no supplier PO, card_pricing_no_supplier_price; 0 counts), the line of the card''s LATEST supplier PO (0189), read again under the PO row lock (0193), in the SAME unit as the card''s client price (0193: card_pricing_unit_mismatch; cards approved earlier are untouched) — recording pricing_approved_at / _by and the event pricing_approved (with client_price_unit). Then, when every line of that supplier PO sits on an approved card, no line of it is unpriced (0193) and the PO is a draft, the PO itself becomes approved (0160 state, event approved {via: card_pricing, card_id, line_count, po_number, draft_ref when issued}) without approve_supplier_po''s checks (owner 2026-11-04); otherwise it waits. 0190: a PO still under its draft reference gets its official number (next_supplier_po_number) in that update, and pricing_approved carries that number in supplier_po_number.';

REVOKE ALL ON FUNCTION public.approve_equipment_card_pricing(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_equipment_card_pricing(uuid)
  TO authenticated;

-- ===========================================================================
-- E. The closing guard
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.entry_exit_logs'::regclass
      AND t.tgname = 'entry_exit_logs_po_guard'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION '0193: the trigger entry_exit_logs_po_guard is missing';
  END IF;
  IF to_regprocedure('public.delete_supplier_po(uuid)') IS NULL THEN
    RAISE EXCEPTION '0193: delete_supplier_po(uuid) is missing';
  END IF;
  IF to_regclass('public.supplier_po_deletions') IS NULL THEN
    RAISE EXCEPTION '0193: the table supplier_po_deletions is missing';
  END IF;
  IF position('po_has_no_lines' IN pg_get_functiondef(
       'public.create_supplier_po(uuid, text, uuid, uuid, date, text, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0193: create_supplier_po does not refuse a PO without units';
  END IF;
  IF position('card_pricing_unit_mismatch' IN pg_get_functiondef(
       'public.approve_equipment_card_pricing(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0193: approve_equipment_card_pricing does not compare the units';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
