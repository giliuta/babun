-- ─────────────────────────────────────────────────────────────────────
-- STORY-053b — service_role bypass for push_subscriptions (G1 hotfix).
--
-- Mirrors a change already applied to the production DB via SQL Editor
-- on 2026-05-01 during G1 smoke debugging. Recorded here so the
-- migration history reproduces production state on a fresh database.
--
-- Why this exists: Supabase migrated from a single legacy service-role
-- key to `SUPABASE_SECRET_KEYS` — keys minted via JWT Signing Keys.
-- The new keys do NOT auto-bypass RLS the way the legacy key did, so
-- Edge Functions that perform cross-user reads (here: fanning out a
-- Web Push notification triggered by user A to user B's devices) get
-- "permission denied" against tables with RLS enabled.
--
-- Pattern: any table that needs to be readable from an Edge Function
-- via the service-role-equivalent key needs both
--   1. GRANT to service_role (Postgres-level access), and
--   2. an explicit policy `for all to service_role using (true)`.
--
-- Apply this same shape to future tables where Edge Functions perform
-- cross-user queries. Don't make it the default for tables that
-- shouldn't be readable cross-user — only the ones that genuinely
-- need fan-out from server-side jobs.
-- ─────────────────────────────────────────────────────────────────────

grant all on public.push_subscriptions to service_role;

create policy push_subscriptions_service_role_all
  on public.push_subscriptions
  for all
  to service_role
  using (true)
  with check (true);

comment on policy push_subscriptions_service_role_all
  on public.push_subscriptions is
  'STORY-053b — explicit RLS bypass for the send_push Edge Function. '
  'Required after Supabase JWT-Signing-Keys migration; legacy service '
  'role auto-bypass no longer applies.';
