-- Workshop roles can read site movements.
--
-- Owner decision (2026-09-22): the workshop roles (`workshop`,
-- `assistant_workshop_manager`, `workshop_manager`) must see where a unit is
-- when it is not in the workshop. Until now migration 0076 let them read only
-- `movement_context = 'workshop'` rows, so an equipment inside a site showed
-- them as "outside" on the inquiry page, the entry selector and every state
-- badge, and the site visit was missing from its timeline.
--
-- What changes: READ only. The SELECT policy on `entry_exit_logs` and the
-- `can_access_movement()` helper (movement detail and photo access follow it)
-- grant the workshop roles every movement row, in both contexts. Nothing
-- else moves:
--   * INSERT/UPDATE policies and the sequence/context triggers are untouched,
--     so a workshop role still records workshop movements only and a site
--     exit is still reserved to the entry's foreman or an admin (0087/0088).
--   * Foremen keep seeing their own rows only; admin and monitor are
--     unchanged.
--   * The workshop home lists keep filtering `movement_context = 'workshop'`
--     in the client, so their tables do not change; the wider read surfaces
--     only where the whole history is meant to show (inquiry, state badges,
--     movement detail opened from those places).
-- The policy body is 0076's with the workshop clause's context predicate
-- removed; both objects are re-created in full so the file is the complete
-- definition.

DROP POLICY IF EXISTS "select_entry_exit_logs" ON public.entry_exit_logs;
CREATE POLICY "select_entry_exit_logs" ON public.entry_exit_logs
FOR SELECT TO authenticated USING (
  supervisor_id = auth.uid()
  OR public.is_admin()
  OR public.current_user_role() = 'monitor'
  OR public.current_user_role() IN (
    'workshop', 'assistant_workshop_manager', 'workshop_manager'
  )
);

CREATE OR REPLACE FUNCTION public.can_access_movement(p_movement_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    WHERE l.id = p_movement_id
      AND (
        l.supervisor_id = auth.uid()
        OR public.is_admin()
        OR public.current_user_role() = 'monitor'
        OR public.current_user_role() IN (
          'workshop', 'assistant_workshop_manager', 'workshop_manager'
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_movement(uuid) TO authenticated;

COMMENT ON FUNCTION public.can_access_movement(uuid) IS
  'True when the caller may read this movement: its own foreman, admin, '
  'monitor, or any workshop role (read access to both contexts since '
  'migration 0098). Mirrors the select_entry_exit_logs policy for the movement '
  'detail and photo paths.';
