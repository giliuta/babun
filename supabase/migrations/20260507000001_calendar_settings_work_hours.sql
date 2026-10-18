-- v448/v449 — calendar_settings round-trip fix.
--
-- The TypeScript CalendarSettings type carried workStartHour /
-- workEndHour / scrollOpenHour since v438 (separate working hours
-- from the visible range), but the DB schema and the repo's
-- rowToSettings / updateCalendarSettings adapters never knew about
-- these fields. The user could pick a working-time hour, the React
-- state + localStorage updated, but the next Supabase fetch (or
-- realtime broadcast) returned a row WITHOUT these fields, the
-- form fell back to `?? startHour`, and the value visually
-- "snapped back" to the visible-range start — looking exactly like
-- a broken save.
--
-- Migration:
--   1. Add three nullable integer columns (null = "use the default
--      from the form's sanitizer", which writes a derived value on
--      first edit). No CHECK constraints because the sanitizer in
--      packages/shared/src/local/calendar-settings.ts is the source
--      of truth — putting the rule in two places guarantees they
--      drift.
--   2. Backfill existing rows with sensible defaults so the form
--      doesn't load empty inputs after the migration.

alter table public.calendar_settings
  add column if not exists work_start_hour  integer,
  add column if not exists work_end_hour    integer,
  add column if not exists scroll_open_hour integer;

-- Backfill: derive defaults from the visible range. work band sits
-- inside visible (matching the form sanitizer); scroll-open lands
-- on workStartHour.
update public.calendar_settings
set
  work_start_hour  = coalesce(work_start_hour, start_hour),
  work_end_hour    = coalesce(work_end_hour, end_hour),
  scroll_open_hour = coalesce(scroll_open_hour, start_hour)
where
  work_start_hour  is null
  or work_end_hour is null
  or scroll_open_hour is null;
