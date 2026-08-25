-- ─────────────────────────────────────────────────────────────────────
-- STORY-043 — Default client tags on signup + backfill.
--
-- Two parts:
--   1. CREATE OR REPLACE handle_new_user() to insert four default
--      client_tags rows in the same transaction as the new tenant.
--   2. Idempotent backfill for existing tenants (airfix, giluta) so
--      they get the same starter taxonomy.
--
-- The trigger keeps SECURITY DEFINER + set search_path = public from
-- STORY-037; the trigger object itself (on_auth_user_created) is
-- unchanged, only the function body grows.
--
-- Default palette (locked):
--   VIP         #f59e0b   (orange)
--   Новый       #3b82f6   (blue)
--   Постоянный  #10b981   (green)
--   Проблемный  #ef4444   (red)
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Trigger function — extended body ─────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
begin
  -- a) create the tenant
  insert into public.tenants (id, name, vertical, owner_user_id)
  values (
    gen_random_uuid(),
    coalesce(new.raw_user_meta_data->>'business_name', new.email),
    'unknown',
    new.id
  )
  returning id into new_tenant_id;

  -- b) stamp tenant_id into the JWT-bound app_metadata.
  -- raw_app_meta_data is the admin-only metadata bucket — users
  -- can NOT mutate it from the client, so it's safe to trust on
  -- the server.
  update auth.users
     set raw_app_meta_data =
           coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('tenant_id', new_tenant_id::text)
   where id = new.id;

  -- c) STORY-043 — default client tags. Four rows per new tenant.
  -- Inserted in the same transaction so a tag failure rolls back
  -- the entire signup. Names + colours match the locked palette.
  insert into public.client_tags (id, tenant_id, name, color) values
    (gen_random_uuid(), new_tenant_id, 'VIP',         '#f59e0b'),
    (gen_random_uuid(), new_tenant_id, 'Новый',       '#3b82f6'),
    (gen_random_uuid(), new_tenant_id, 'Постоянный',  '#10b981'),
    (gen_random_uuid(), new_tenant_id, 'Проблемный',  '#ef4444');

  return new;
end;
$$;

-- ── 2. Backfill for existing tenants (idempotent) ───────────────────
-- One row per (tenant, default_tag) pair, gated by NOT EXISTS so
-- re-running the migration is a no-op and so a tenant that already
-- customised colour for a tag with the same name keeps that
-- customisation untouched (we key on `name`, not on `(name, color)`).
-- Orphans (owner_user_id IS NULL) are excluded — same defensive
-- posture as STORY-041 G3.
insert into public.client_tags (id, tenant_id, name, color)
select
  gen_random_uuid(),
  t.id,
  tag.name,
  tag.color
from public.tenants t
cross join (values
  ('VIP',         '#f59e0b'),
  ('Новый',       '#3b82f6'),
  ('Постоянный',  '#10b981'),
  ('Проблемный',  '#ef4444')
) as tag(name, color)
where t.owner_user_id is not null
  and not exists (
    select 1
    from public.client_tags ct
    where ct.tenant_id = t.id
      and ct.name = tag.name
  );
