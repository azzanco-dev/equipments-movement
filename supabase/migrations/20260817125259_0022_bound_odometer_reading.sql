ALTER TABLE public.entry_exit_logs
  ADD CONSTRAINT entry_exit_logs_odometer_reading_range
  CHECK (odometer_reading IS NULL OR (odometer_reading >= 0 AND odometer_reading < 10000000))
  NOT VALID;