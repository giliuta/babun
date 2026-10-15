-- ─────────────────────────────────────────────────────────────────────
-- STORY-080 — Constrain tenants.vertical to known enum values.
--
-- Code review iter 3 found tenants.vertical was free-text. Owner can
-- write any string via the supabase-js client (RLS lets them update
-- their own tenant). Future seed-template logic and admin-tile labels
-- assume the enum, so a hostile or accidentally-corrupted value
-- breaks UI assumptions.
--
-- Allowed: hvac, beauty, auto, cleaning, other.
-- Pre-existing 'unknown' tenants (set by handle_new_user before the
-- onboarding wizard runs) are normalised to 'other' so the constraint
-- can be added without orphaning the seed.
-- ─────────────────────────────────────────────────────────────────────

-- Normalise legacy 'unknown' (default from handle_new_user trigger).
update public.tenants set vertical = 'other'
 where vertical is null or vertical = 'unknown'
    or vertical not in ('hvac','beauty','auto','cleaning','other');

alter table public.tenants
  drop constraint if exists tenants_vertical_check;
alter table public.tenants
  add constraint tenants_vertical_check
  check (vertical in ('hvac','beauty','auto','cleaning','other'));

-- Update the trigger so future signups land with 'other' instead of
-- the now-illegal 'unknown'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
begin
  insert into public.tenants (id, name, vertical)
  values (
    gen_random_uuid(),
    coalesce(new.raw_user_meta_data->>'business_name', new.email),
    'other'
  )
  returning id into new_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role, joined_at)
  values (new_tenant_id, new.id, 'owner', now());

  insert into public.client_tags (id, tenant_id, name, color) values
    (gen_random_uuid(), new_tenant_id, 'VIP',         '#f59e0b'),
    (gen_random_uuid(), new_tenant_id, 'Новый',       '#3b82f6'),
    (gen_random_uuid(), new_tenant_id, 'Постоянный',  '#10b981'),
    (gen_random_uuid(), new_tenant_id, 'Проблемный',  '#ef4444');

  update auth.users
     set raw_app_meta_data =
           coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object(
                'tenant_id',         new_tenant_id::text,
                'available_tenants', jsonb_build_array(new_tenant_id::text)
              )
   where id = new.id;

  return new;
end;
$$;
