-- 0162: created_at / updated_at on the editable tables that miss one.
--
-- Owner 2026-10-29: «هل جميع جداول الداتابيس فيها created_at و
-- updated_at؟», then «ابدا» on the plan. The rule of 2026-10-22: every
-- editable table carries `updated_at timestamptz NOT NULL DEFAULT now()`
-- with the `update_updated_at()` BEFORE UPDATE trigger; append-only logs and
-- audits, link and counter tables keep created_at only. A read-only check of
-- the linked schema found four editable tables off the rule:
--
--   1. entry_exit_logs   — edited (admin edit, workshop classification,
--                          contractor code, notes), no updated_at.
--   2. roles             — has updated_at, but only the functions set it;
--                          no trigger.
--   3. lessor_contacts   — has updated_at and its trigger, no created_at.
--   4. profile_contacts  — has updated_at (set by admin_set_user_mobile),
--                          no created_at and no trigger.
--
-- Left as they are on purpose: the append-only logs (movement_audit_logs,
-- supplier_po_events, role_changes, equipment_code_changes,
-- movement_driver_changes, movement_notices), the link tables
-- (company_projects, profile_companies, role_permissions), the counter
-- supplier_po_counters, the migration-only catalogue permissions, the photos
-- (inserted and deleted, never edited), the temporary photo batches,
-- profile_roles (its assigned_at moves with every assignment) and the
-- one-row-per-key app_settings (updated_at / updated_by).
--
-- Columns only, each with a default: no screen, view or function changes.
-- Every column is filled from the history BEFORE its trigger exists, so the
-- backfill keeps those times (as 0146 did).

-- ===========================================================================
-- 1. entry_exit_logs.updated_at
-- ===========================================================================
-- Existing movements get the time of their latest `update` row of
-- movement_audit_logs (every tracked edit since 0069 wrote one), else their
-- created_at. The audit trigger of 0069/0070 compares a fixed list of
-- columns and returns early when none changed, so this backfill writes no
-- audit rows; the other movement triggers are BEFORE INSERT only.
ALTER TABLE public.entry_exit_logs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.entry_exit_logs l
SET updated_at = COALESCE(
  (SELECT max(a.created_at)
   FROM public.movement_audit_logs a
   WHERE a.movement_id = l.id
     AND a.action = 'update'),
  l.created_at
)
WHERE l.updated_at IS NULL;

ALTER TABLE public.entry_exit_logs
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

COMMENT ON COLUMN public.entry_exit_logs.updated_at IS
  '0162: the time of the movement row''s latest change (update_updated_at trigger). Backfilled from the latest movement_audit_logs update row, else created_at. Driver changes and photos are separate rows and do not move it.';

DROP TRIGGER IF EXISTS trg_entry_exit_logs_updated_at ON public.entry_exit_logs;
CREATE TRIGGER trg_entry_exit_logs_updated_at
  BEFORE UPDATE ON public.entry_exit_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================================================
-- 2. roles: the trigger (the column exists since 0126)
-- ===========================================================================
DROP TRIGGER IF EXISTS roles_updated_at ON public.roles;
CREATE TRIGGER roles_updated_at
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===========================================================================
-- 3. lessor_contacts.created_at (its updated_at trigger exists since 0136)
-- ===========================================================================
-- The 0136 trigger is off for the backfill only, so the copy does not move
-- updated_at to now(); the migration runs in one transaction.
ALTER TABLE public.lessor_contacts
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

ALTER TABLE public.lessor_contacts DISABLE TRIGGER lessor_contacts_updated_at;

UPDATE public.lessor_contacts
SET created_at = updated_at
WHERE created_at IS NULL;

ALTER TABLE public.lessor_contacts ENABLE TRIGGER lessor_contacts_updated_at;

ALTER TABLE public.lessor_contacts
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

-- ===========================================================================
-- 4. profile_contacts: created_at and the trigger
-- ===========================================================================
ALTER TABLE public.profile_contacts
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

UPDATE public.profile_contacts
SET created_at = updated_at
WHERE created_at IS NULL;

ALTER TABLE public.profile_contacts
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

DROP TRIGGER IF EXISTS profile_contacts_updated_at ON public.profile_contacts;
CREATE TRIGGER profile_contacts_updated_at
  BEFORE UPDATE ON public.profile_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
