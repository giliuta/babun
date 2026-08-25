-- ─────────────────────────────────────────────────────────────────────
-- DEFENSIVE NET — orphan auth.users → tenants backfill.
--
-- THIS MIGRATION IS NOT INTENDED FOR ROUTINE APPLICATION. It is kept
-- in the repo for traceability after a one-off incident on
-- 2026-04-30 where two users (`giluta.art@gmail.com` and
-- `airfix.cy@gmail.com`) registered before STORY-037 shipped its
-- handle_new_user trigger. Both lacked a matching `public.tenants`
-- row, which made the dashboard's tenant lookup return NULL and
-- bounced them to /login?error=tenant_missing.
--
-- The incident was resolved manually via a one-off DO block. This
-- file documents the equivalent SQL as a re-runnable migration in
-- case a similar inconsistency surfaces in the future.
--
-- AT TIME OF COMMIT: orphan_users = 0 in production. This file is a
-- no-op when applied to that state. Do NOT include in `supabase db
-- push` automation; apply only after surfacing a fresh orphan
-- incident.
--
-- Idempotent: safe to re-run. The NOT EXISTS guards skip rows that
-- already have a matching tenant.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Create a tenant for every auth.user that doesn't have one.
--    Naming mimics the handle_new_user trigger: name defaults to email,
--    vertical 'unknown', onboarded_at = user creation time so the
--    onboarding wizard doesn't pop up for an existing user.
insert into public.tenants (id, name, vertical, owner_user_id, onboarded_at)
select
  gen_random_uuid(),
  u.email,
  'unknown',
  u.id,
  u.created_at
from auth.users u
where not exists (
  select 1 from public.tenants t where t.owner_user_id = u.id
);

-- 2. Stamp the freshly-created (or any pre-existing but un-stamped)
--    tenant_id into auth.users.raw_app_meta_data so STORY-038's
--    current_tenant_id() helper picks it up from the JWT on next
--    sign-in. Skips users whose JWT already matches their DB tenant.
update auth.users u
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                     || jsonb_build_object(
                       'tenant_id',
                       (select t.id::text from public.tenants t where t.owner_user_id = u.id)
                     )
where exists (select 1 from public.tenants t where t.owner_user_id = u.id)
  and (raw_app_meta_data->>'tenant_id') is distinct from
      (select t.id::text from public.tenants t where t.owner_user_id = u.id);

-- 3. Verification (uncomment to run alongside):
--    select count(*) as orphans
--    from auth.users u
--    left join public.tenants t on t.owner_user_id = u.id
--    where t.id is null;
--    -- expect 0
