-- ─────────────────────────────────────────────────────────────────────
-- STORY-047 G3 hotfix — read-only service_role GRANTs on legacy tables.
--
-- Symptom caught while smoke-testing send_sms: a curl POST returned
--   { "error": "app_settings: permission denied for table app_settings" }
-- even though the function uses a service-role JWT. Root cause is the
-- same JWT-Signing-Keys migration that bit STORY-053b's hotfix
-- 20260501_002_push_subscriptions_service_role.sql:
--   * legacy `service_role` keys auto-bypassed RLS at the Postgres
--     level via an implicit privilege
--   * post-migration service-role JWTs are signed by SUPABASE_SECRET_KEYS
--     and DO NOT auto-bypass — they need an explicit GRANT plus an RLS
--     policy `for select to service_role using (true)`.
--
-- Tightened to least privilege: SELECT-only. The send_sms Edge Function
-- never INSERT/UPDATE/DELETEs these four tables; it only reads them.
-- A future Edge Function that needs write access on any of these
-- tables must add its own narrow GRANT in the feature story that
-- introduces the need.
--
-- Affected tables:
--   public.app_settings   — sms_enabled master switch lookup
--   public.tenants        — {business_name} placeholder
--   public.appointments   — primary scan table for the cron sweep
--   public.clients        — {client_name} + recipient phone
--
-- All four idempotent — re-running the migration is safe.
-- ─────────────────────────────────────────────────────────────────────

-- ── app_settings ─────────────────────────────────────────────────
grant select on public.app_settings to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'app_settings'
       and policyname = 'app_settings_service_role_select'
  ) then
    create policy app_settings_service_role_select
      on public.app_settings
      for select to service_role
      using (true);
  end if;
end $$;

-- ── tenants ──────────────────────────────────────────────────────
grant select on public.tenants to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'tenants'
       and policyname = 'tenants_service_role_select'
  ) then
    create policy tenants_service_role_select
      on public.tenants
      for select to service_role
      using (true);
  end if;
end $$;

-- ── appointments ─────────────────────────────────────────────────
grant select on public.appointments to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'appointments'
       and policyname = 'appointments_service_role_select'
  ) then
    create policy appointments_service_role_select
      on public.appointments
      for select to service_role
      using (true);
  end if;
end $$;

-- ── clients ──────────────────────────────────────────────────────
grant select on public.clients to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'clients'
       and policyname = 'clients_service_role_select'
  ) then
    create policy clients_service_role_select
      on public.clients
      for select to service_role
      using (true);
  end if;
end $$;

comment on policy app_settings_service_role_select on public.app_settings is
  'STORY-047 G3 hotfix — read-only service-role bypass after JWT-Signing-Keys migration. Write access (if ever needed) lives in the feature story that requires it.';
comment on policy tenants_service_role_select on public.tenants is
  'STORY-047 G3 hotfix — read-only service-role bypass after JWT-Signing-Keys migration.';
comment on policy appointments_service_role_select on public.appointments is
  'STORY-047 G3 hotfix — read-only service-role bypass after JWT-Signing-Keys migration.';
comment on policy clients_service_role_select on public.clients is
  'STORY-047 G3 hotfix — read-only service-role bypass after JWT-Signing-Keys migration.';
