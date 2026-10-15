-- ─────────────────────────────────────────────────────────────────────
-- STORY-073 — Personal calendar opt-in.
--
-- Owner-only flag on tenants. When true, the calendar surfaces a
-- "personal" lane where the owner records private notes / private
-- appointments not visible to team members. When false (default for
-- fresh tenants), the calendar shows two CTAs in its empty state:
--   1. Включить личный календарь
--   2. Создать календарь для других людей  (i.e. start team mode)
--
-- The visibility rule (which appointments count as "personal" vs
-- team-shared) lives on the appointments side and lands in a
-- follow-up migration. This one only stamps the toggle.
-- ─────────────────────────────────────────────────────────────────────

alter table public.tenants
  add column if not exists personal_calendar_enabled boolean not null default false;

comment on column public.tenants.personal_calendar_enabled is
  'STORY-073 — Owner has opted into a personal calendar lane for '
  'private notes / private appointments. UI exposes a toggle in '
  'Settings → Аккаунт + an inline CTA on the empty calendar view. '
  'Default false for new signups — they pick during onboarding. '
  'Existing pre-migration tenants are backfilled to true so they '
  'do not get bounced into the fork-state empty-state on their '
  'next calendar visit.';

-- Backfill: existing tenants get personal_calendar_enabled = true so
-- the fork-state empty CTA does not surface on their calendar after
-- this migration lands. They can flip it back via Settings if they
-- prefer the team-only mode.
update public.tenants
   set personal_calendar_enabled = true
 where onboarded_at is not null;
