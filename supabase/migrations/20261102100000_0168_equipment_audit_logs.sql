-- 0168: the equipment change log («سجل تعديلات المعدات»).
--
-- Owner 2026-11-02: a unit (A028) was set to «مباعة» the day before and
-- nobody could tell who did it — only the Supabase API logs found the user.
-- «خلنا نسوي سجل تعديلات المعدات، يكون ضمن النشاط» — an append-only audit of
-- every INSERT / UPDATE / DELETE of public.equipment, written by a trigger so
-- no write path can bypass it (the admin form, the Excel update, the quick
-- creates, admin_change_equipment_code, the rental lifecycle trigger of 0163,
-- a type rename cascading through equipment_type_fkey, a migration).
--
-- The model is movement_audit_logs (0069 / 0070): the same columns, indexes,
-- grants and reader key, the actor from auth.uid() with the name from
-- profile_names (NULL for a service-role or migration write; the row is
-- recorded anyway), old / new values as jsonb holding ONLY the changed keys,
-- changed_fields = those keys, and an UPDATE that changes nothing writes no
-- row. Unlike 0069 the snapshot is not a hand-written list of columns: it is
-- to_jsonb(row) minus the derived and normalised columns below, so a column
-- added to equipment later is audited without touching this function.
--
-- Skipped columns (never a change a person made):
--   * id            — it is equipment_id of the audit row;
--   * created_at    — set once at creation, the audit row carries its own;
--   * updated_at    — moved by trg_equipment_updated_at on every update;
--   * plate_digits, plate_letters_en — derived from plate_number by
--                     normalize_equipment_plate_parts (0074 / 0077);
--   * numbering_status — derived from plate_number by
--                     sync_complete_equipment_plate_status (0075);
--   * type_search   — GENERATED ALWAYS from type (0116).
-- Two foreign keys are stored as the readable name of the point in time, as
-- 0070 does for the movement log: lessor_id → lessors.name and
-- project_id → projects.name_ar / name_en (the id as text when the row is
-- gone). Every other value is the stored value; the screens label the enum
-- values (ownership_status, status, registration_type).
--
-- Readers: has_permission('movements.activity'), the key of the movement log,
-- because the activity page shows both logs in one list. A dedicated key
-- (e.g. equipment.activity) can come later with its own catalogue row; the
-- policy is the only place to change. Nobody inserts, updates or deletes
-- through the API: only the SECURITY DEFINER trigger writes. No backfill:
-- the log starts when this migration is applied.

-- ===========================================================================
-- 1. The table
-- ===========================================================================
CREATE TABLE public.equipment_audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipment_id uuid REFERENCES public.equipment(id) ON DELETE SET NULL,
  equipment_code text,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name text,
  old_values jsonb,
  new_values jsonb,
  changed_fields text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.equipment_audit_logs IS
  '0168: append-only audit of public.equipment (create / update / delete), '
  'written only by the trigger audit_equipment_change. old_values / '
  'new_values hold the changed keys only (lessor_id and project_id as names); '
  'equipment_code is the code at that moment and survives the unit''s '
  'deletion. Readers: movements.activity. No updated_at: nothing is edited.';

CREATE INDEX equipment_audit_logs_created_id_idx
  ON public.equipment_audit_logs(created_at DESC, id DESC);
CREATE INDEX equipment_audit_logs_actor_created_idx
  ON public.equipment_audit_logs(actor_id, created_at DESC, id DESC);
CREATE INDEX equipment_audit_logs_equipment_created_idx
  ON public.equipment_audit_logs(equipment_id, created_at DESC, id DESC);
CREATE INDEX equipment_audit_logs_action_created_idx
  ON public.equipment_audit_logs(action, created_at DESC, id DESC);

-- ===========================================================================
-- 2. RLS and grants: read for the activity key, no write through the API
-- ===========================================================================
ALTER TABLE public.equipment_audit_logs ENABLE ROW LEVEL SECURITY;

-- The movement log's key for now (the activity page lists both logs); a
-- dedicated key can replace it here later.
CREATE POLICY equipment_audit_logs_activity_select
  ON public.equipment_audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('movements.activity')));

COMMENT ON POLICY equipment_audit_logs_activity_select ON public.equipment_audit_logs IS
  '0168: the same key as movement_audit_logs_admin_select (movements.activity); the activity page shows both logs. No INSERT / UPDATE / DELETE policy: only the definer trigger writes.';

REVOKE ALL ON TABLE public.equipment_audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.equipment_audit_logs TO authenticated;

-- ===========================================================================
-- 3. The trigger
-- ===========================================================================
-- Keeps only `p_keys` of a raw row snapshot and replaces lessor_id and
-- project_id by the name of the moment (0070's idea for the movement log).
-- NULL values stay out (jsonb_strip_nulls): a key in changed_fields that is
-- missing from old_values was NULL before, missing from new_values is NULL
-- now.
CREATE OR REPLACE FUNCTION public.equipment_audit_display(p_raw jsonb, p_keys text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_strip_nulls(COALESCE(jsonb_object_agg(
    entry.key,
    CASE entry.key
      WHEN 'lessor_id' THEN
        CASE WHEN jsonb_typeof(entry.value) = 'string' THEN
          to_jsonb(COALESCE(
            (SELECT l.name FROM public.lessors l WHERE l.id::text = (entry.value #>> '{}')),
            entry.value #>> '{}'
          ))
        ELSE entry.value END
      WHEN 'project_id' THEN
        CASE WHEN jsonb_typeof(entry.value) = 'string' THEN
          to_jsonb(COALESCE(
            (SELECT COALESCE(pr.name_ar, pr.name_en) FROM public.projects pr WHERE pr.id::text = (entry.value #>> '{}')),
            entry.value #>> '{}'
          ))
        ELSE entry.value END
      ELSE entry.value
    END
  ), '{}'::jsonb))
  FROM jsonb_each(p_raw) AS entry
  WHERE entry.key = ANY (p_keys);
$$;

REVOKE ALL ON FUNCTION public.equipment_audit_display(jsonb, text[]) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.equipment_audit_display(jsonb, text[]) IS
  '0168: the audit snapshot of an equipment row limited to the changed keys, '
  'lessor_id and project_id as names. Called by audit_equipment_change only.';

CREATE OR REPLACE FUNCTION public.audit_equipment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Derived, normalised or bookkeeping columns: never a change a person made.
  c_skipped CONSTANT text[] := ARRAY[
    'id',
    'created_at',
    'updated_at',
    'plate_digits',
    'plate_letters_en',
    'numbering_status',
    'type_search'
  ];
  v_old_raw jsonb;
  v_new_raw jsonb;
  v_old jsonb;
  v_new jsonb;
  v_changed text[] := '{}';
  v_key text;
  v_actor_name text;
  v_equipment_id uuid;
  v_equipment_code text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_equipment_id := OLD.id;
    v_equipment_code := OLD.code;
  ELSE
    v_equipment_id := NEW.id;
    v_equipment_code := NEW.code;
  END IF;

  SELECT full_name INTO v_actor_name
  FROM public.profile_names
  WHERE id = auth.uid();

  IF TG_OP <> 'INSERT' THEN
    v_old_raw := to_jsonb(OLD) - c_skipped;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_raw := to_jsonb(NEW) - c_skipped;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_old_raw || v_new_raw) LOOP
      IF v_old_raw -> v_key IS DISTINCT FROM v_new_raw -> v_key THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    -- Only skipped columns moved (updated_at alone, a plate re-normalised to
    -- the same value): no row.
    IF cardinality(v_changed) = 0 THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_changed := ARRAY(
      SELECT k FROM jsonb_object_keys(jsonb_strip_nulls(v_new_raw)) AS k
      ORDER BY k
    );
  ELSE
    v_changed := ARRAY(
      SELECT k FROM jsonb_object_keys(jsonb_strip_nulls(v_old_raw)) AS k
      ORDER BY k
    );
  END IF;

  -- Only the changed keys, with the two foreign keys as readable names.
  SELECT
    CASE WHEN v_old_raw IS NULL THEN NULL
         ELSE public.equipment_audit_display(v_old_raw, v_changed) END,
    CASE WHEN v_new_raw IS NULL THEN NULL
         ELSE public.equipment_audit_display(v_new_raw, v_changed) END
  INTO v_old, v_new;

  INSERT INTO public.equipment_audit_logs(
    equipment_id, equipment_code, action, actor_id, actor_name,
    old_values, new_values, changed_fields
  ) VALUES (
    v_equipment_id,
    v_equipment_code,
    CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
    auth.uid(),
    v_actor_name,
    v_old,
    v_new,
    v_changed
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_equipment_change() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.audit_equipment_change() IS
  '0168: AFTER INSERT / UPDATE / DELETE trigger of public.equipment writing '
  'equipment_audit_logs. Compares to_jsonb(OLD) and to_jsonb(NEW) without the '
  'derived columns (id, created_at, updated_at, plate_digits, '
  'plate_letters_en, numbering_status, type_search) and stores the changed '
  'keys only; an UPDATE that changes nothing writes no row. Actor from '
  'auth.uid() (NULL for a service-role or migration write).';

DROP TRIGGER IF EXISTS audit_equipment ON public.equipment;
CREATE TRIGGER audit_equipment
  AFTER INSERT OR UPDATE OR DELETE ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.audit_equipment_change();

COMMENT ON TRIGGER audit_equipment ON public.equipment IS
  '0168: every create / update / delete of a unit is written to equipment_audit_logs (who, when, which fields, before / after).';
