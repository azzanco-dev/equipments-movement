-- 0166: the admin corrects any driver of a project visit in place.
--
-- Owner 2026-10-31: a duplicate driver gets created, the admin "changes" the
-- driver on the movement, and deleting the duplicate is then refused — the
-- change is appended (movement_driver_changes) and the entry keeps the old
-- driver, so both rows still reference it (ON DELETE RESTRICT). «ليش مايكون
-- تعديل السائق من خانة تعديل الحركة للادمن يغير السائق مباشرة», then «لو حركة
-- فيه 3 سائقين تغيروا وابغى اغير السائق الثاني كيف» and «Yes, build it».
--
-- A visit's drivers form one chain: the entry driver, then every change in
-- (changed_at, id) order. `admin_correct_visit_driver` replaces ONE link of
-- that chain — the entry driver (p_change_id NULL) or the new driver of one
-- change — and keeps its neighbours consistent:
--   * the entry (or the change) gets the new driver;
--   * the NEXT change starts from it (previous_driver_*);
--   * a change that now goes from a driver to the same driver is deleted;
--   * when the visit is closed and its exit carried the visit's last driver,
--     the exit follows the new last driver.
-- The genuine swap during an open visit stays `change_active_movement_driver`
-- (append-only). The entry and exit rows are audited by the existing
-- audit_entry_exit_logs trigger; a correction of a change row writes its own
-- movement_audit_logs row (changed field `driver_change`).
--
-- Writer: `movements.edit_delete` (the admin correction key of
-- admin_update_movement). Lock order as every chain writer: the entry row
-- first, then the equipment's advisory key of enforce_movement_sequence().

create or replace function public.admin_correct_visit_driver(
  p_entry_log_id uuid,
  p_change_id uuid,
  p_new_driver_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.entry_exit_logs;
  v_exit public.entry_exit_logs;
  v_next_id uuid;
  v_next_type text;
  v_new_id uuid;
  v_new_name text;
  v_change public.movement_driver_changes;
  v_old_id uuid;
  v_old_name text;
  v_old_last uuid;
  v_new_last uuid;
  v_new_last_name text;
  v_removed integer := 0;
  v_exit_updated boolean := false;
  v_actor_name text;
  v_code text;
begin
  if auth.uid() is null or not public.has_permission('movements.edit_delete') then
    raise exception 'admin_required'
      using errcode = '42501',
            hint = 'Only an administrator may correct a visit driver.';
  end if;

  select l.* into v_entry
  from public.entry_exit_logs l
  where l.id = p_entry_log_id
    and l.movement_type = 'entry'
    and l.movement_context = 'site'
  for update;
  if not found then
    raise exception 'movement_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_entry.equipment_id::text, 0));

  select d.id, d.full_name into v_new_id, v_new_name
  from public.drivers d
  where d.id = p_new_driver_id;
  if not found then
    raise exception 'invalid_driver_id';
  end if;

  -- The exit that closed this visit, if any: the next movement of the unit.
  select l.id, l.movement_type into v_next_id, v_next_type
  from public.entry_exit_logs l
  where l.equipment_id = v_entry.equipment_id
    and (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id)
  order by l.recorded_at, l.id
  limit 1;
  if v_next_type is not distinct from 'exit' then
    select l.* into v_exit
    from public.entry_exit_logs l
    where l.id = v_next_id
    for update;
  end if;

  select c.new_driver_id into v_old_last
  from public.movement_driver_changes c
  where c.entry_log_id = p_entry_log_id
  order by c.changed_at desc, c.id desc
  limit 1;
  if not found then
    v_old_last := v_entry.driver_id;
  end if;

  if p_change_id is null then
    v_old_id := v_entry.driver_id;
    v_old_name := v_entry.driver_name;
    if v_old_id is not distinct from v_new_id then
      raise exception 'driver_unchanged';
    end if;

    update public.entry_exit_logs l
    set driver_id = v_new_id,
        driver_name = v_new_name
    where l.id = v_entry.id;

    update public.movement_driver_changes c
    set previous_driver_id = v_new_id,
        previous_driver_name = v_new_name
    where c.id = (
      select f.id
      from public.movement_driver_changes f
      where f.entry_log_id = p_entry_log_id
      order by f.changed_at, f.id
      limit 1
    );
  else
    select c.* into v_change
    from public.movement_driver_changes c
    where c.id = p_change_id
      and c.entry_log_id = p_entry_log_id
    for update;
    if not found then
      raise exception 'driver_change_not_found';
    end if;
    v_old_id := v_change.new_driver_id;
    v_old_name := coalesce(
      (select d.full_name from public.drivers d where d.id = v_change.new_driver_id),
      v_change.new_driver_name
    );
    if v_old_id = v_new_id then
      raise exception 'driver_unchanged';
    end if;

    update public.movement_driver_changes c
    set new_driver_id = v_new_id,
        new_driver_name = v_new_name
    where c.id = v_change.id;

    update public.movement_driver_changes c
    set previous_driver_id = v_new_id,
        previous_driver_name = v_new_name
    where c.id = (
      select n.id
      from public.movement_driver_changes n
      where n.entry_log_id = p_entry_log_id
        and (n.changed_at, n.id) > (v_change.changed_at, v_change.id)
      order by n.changed_at, n.id
      limit 1
    );

    select p.full_name into v_actor_name from public.profiles p where p.id = auth.uid();
    select e.code into v_code from public.equipment e where e.id = v_entry.equipment_id;
    insert into public.movement_audit_logs (
      movement_id, action, actor_id, actor_name, equipment_id, equipment_code,
      movement_type, movement_context, old_values, new_values, changed_fields
    ) values (
      v_entry.id, 'update', auth.uid(), v_actor_name, v_entry.equipment_id, v_code,
      v_entry.movement_type, v_entry.movement_context,
      jsonb_build_object('driver_change', v_old_name),
      jsonb_build_object('driver_change', v_new_name),
      array['driver_change']
    );
  end if;

  -- A link that now goes from a driver to the same driver means nothing.
  delete from public.movement_driver_changes c
  where c.entry_log_id = p_entry_log_id
    and c.previous_driver_id = c.new_driver_id;
  get diagnostics v_removed = row_count;

  select c.new_driver_id, c.new_driver_name into v_new_last, v_new_last_name
  from public.movement_driver_changes c
  where c.entry_log_id = p_entry_log_id
  order by c.changed_at desc, c.id desc
  limit 1;
  if not found then
    select l.driver_id, l.driver_name into v_new_last, v_new_last_name
    from public.entry_exit_logs l
    where l.id = v_entry.id;
  end if;

  -- A closed visit's exit carries the driver current at the exit.
  if v_exit.id is not null
     and v_exit.movement_context = 'site'
     and v_exit.driver_id is not distinct from v_old_last
     and v_new_last is distinct from v_old_last then
    update public.entry_exit_logs l
    set driver_id = v_new_last,
        driver_name = v_new_last_name
    where l.id = v_exit.id;
    v_exit_updated := true;
  end if;

  return jsonb_build_object(
    'entry_log_id', v_entry.id,
    'removed_changes', v_removed,
    'exit_updated', v_exit_updated
  );
end;
$$;

comment on function public.admin_correct_visit_driver(uuid, uuid, uuid) is
  '0166: the admin (movements.edit_delete) replaces one driver of a project visit chain — the entry driver (p_change_id NULL) or the new driver of one change — keeping the next change, no-op changes and the closing exit consistent.';

revoke all on function public.admin_correct_visit_driver(uuid, uuid, uuid) from public, anon;
grant execute on function public.admin_correct_visit_driver(uuid, uuid, uuid) to authenticated;
