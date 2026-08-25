-- ─────────────────────────────────────────────────────────────────────
-- STORY-048 — Realtime sync.
--
-- Adds the 10 multi-user-relevant tables to the supabase_realtime
-- publication so postgres_changes events broadcast to subscribed
-- clients. REPLICA IDENTITY FULL guarantees:
--   1. UPDATE/DELETE events carry the full OLD row (needed for
--      Realtime's RLS evaluation on broadcast).
--   2. Client-side dedupe by `updated_at` works even when only some
--      columns change.
--
-- Excluded by design:
--   * invitations         — Owner-only, low write rate, page reload OK.
--   * appointment_photos  — lazy-load on AppointmentSheet open
--                           (per STORY-049).
--   * tenants             — rare changes, refresh-on-focus enough.
-- ─────────────────────────────────────────────────────────────────────

alter table public.clients                replica identity full;
alter table public.client_tags            replica identity full;
alter table public.client_tag_assignments replica identity full;
alter table public.appointments           replica identity full;
alter table public.team_schedules         replica identity full;
alter table public.calendar_settings      replica identity full;
alter table public.day_cities             replica identity full;
alter table public.day_extras             replica identity full;
alter table public.recurring_reminders    replica identity full;
alter table public.tenant_members         replica identity full;

alter publication supabase_realtime add table
  public.clients,
  public.client_tags,
  public.client_tag_assignments,
  public.appointments,
  public.team_schedules,
  public.calendar_settings,
  public.day_cities,
  public.day_extras,
  public.recurring_reminders,
  public.tenant_members;

-- Verify after apply (run manually):
-- select count(*) from pg_publication_tables
--   where pubname='supabase_realtime' and schemaname='public';
-- -- expect: 10
--
-- select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='public'
--     and c.relname in ('clients','client_tags','client_tag_assignments','appointments',
--                       'team_schedules','calendar_settings','day_cities','day_extras',
--                       'recurring_reminders','tenant_members')
--     and c.relreplident = 'f';
-- -- expect: 10
