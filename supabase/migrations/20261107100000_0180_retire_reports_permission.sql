-- 0180: retire the reports permission `reports.view` («التقارير»).
--
-- Owner decision 2026-11-07: the report pages were removed («شيل صفحات
-- التقارير كلها», commit 1d1038f): no route, no sidebar section, no screen.
-- The key stayed in the catalogue and on the roles page although it opened
-- nothing; the owner then chose to retire it («3 و 4»). This migration
-- removes it from the database the way 0130 retired `map.view`.
--
-- What this migration does
--   * DROP the two report functions the removed pages called, the only
--     database code that tests the key:
--       get_entry_report_summary(timestamptz, timestamptz, text[], text)
--         (latest 0158; requires reports.view, `reports_view_required`)
--       get_equipment_attention_report(integer, integer, text, text[])
--         (latest 0127; requires reports.view scope all)
--     Without the key both would refuse every caller for ever. No screen,
--     API route, Edge Function, view, policy or other function calls them
--     (checked 2026-11-07); their bodies stay in the migration history.
--   * DELETE the key from public.role_permissions first (the 0126 / 0136 /
--     0169 seeds: admin, foreman_lead, equipment_officer, purchasing, sales,
--     plus any custom grant). The 0126 foreign key is ON DELETE CASCADE, so
--     the second delete would take these rows anyway; the explicit delete
--     keeps the audit obvious: the audit_role_change trigger writes one
--     `permission_revoked` row per grant into public.role_changes
--     (changed_by NULL: a migration). The audit table has no foreign keys,
--     so every text row naming `reports.view` stays.
--   * DELETE the key from public.permissions. The group `reports` keeps
--     `inquiry.view` («الاستعلام عن معدة»), which is unchanged.
--   * A guard aborts when any function of the public schema still names the
--     key afterwards.
--   No page changes for anyone: since 1d1038f the key opens nothing
--   (src/lib/navPermissions.ts has no entry for it).

DROP FUNCTION IF EXISTS public.get_entry_report_summary(timestamptz, timestamptz, text[], text);
DROP FUNCTION IF EXISTS public.get_equipment_attention_report(integer, integer, text, text[]);

DELETE FROM public.role_permissions
WHERE permission_key = 'reports.view';

DELETE FROM public.permissions
WHERE key = 'reports.view';

DO $guard$
DECLARE
  v_names text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
  INTO v_names
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc LIKE '%reports.view%';

  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION '0180: functions still name reports.view: %', v_names;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.permissions WHERE 'reports.view' = ANY (requires)
  ) THEN
    RAISE EXCEPTION '0180: a permission still requires reports.view';
  END IF;
END;
$guard$;

NOTIFY pgrst, 'reload schema';
