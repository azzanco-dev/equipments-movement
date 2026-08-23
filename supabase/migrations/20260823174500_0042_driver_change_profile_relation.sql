-- Expose the audited changer through the protected profiles relationship.
ALTER TABLE public.movement_driver_changes
  DROP CONSTRAINT IF EXISTS movement_driver_changes_changed_by_fkey;
ALTER TABLE public.movement_driver_changes
  ADD CONSTRAINT movement_driver_changes_changed_by_fkey
  FOREIGN KEY (changed_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;
