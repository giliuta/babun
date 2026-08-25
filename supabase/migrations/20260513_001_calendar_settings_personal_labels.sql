-- v493 — calendar_settings round-trip fix for personal labels.
--
-- v492 added CalendarSettings.personalLabels / personalDefaultLabel
-- in TypeScript so the personal calendar gets a per-master labels
-- list (mirror of brigade team.cities / team.default_city). But the
-- DB row didn't have those columns, so the realtime subscription
-- hydration at DashboardClientLayout:898 fetched a row WITHOUT
-- personalLabels and the spread-merge wiped the just-saved entry.
-- Visible bug: создаю метку → она появляется → пропадает.
--
-- This migration:
--   1. Adds nullable jsonb personal_labels + text personal_default_label
--      columns. jsonb so we can carry the future ordering / colour
--      override without another migration.
--   2. No backfill — null / undefined means «no personal labels set»,
--      which is the v492 cold-start state anyway.
--   3. No CHECK constraints — the sanitizer in
--      packages/shared/src/local/calendar-settings.ts owns validation.

alter table public.calendar_settings
  add column if not exists personal_labels        jsonb,
  add column if not exists personal_default_label text;
