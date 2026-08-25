-- ─────────────────────────────────────────────────────────────────────
-- STORY-037 — per-user tenants + signup trigger.
--
-- After this migration:
--   * Every row in auth.users has exactly one matching public.tenants
--     row with owner_user_id = auth.users.id (created by trigger).
--   * tenant_id also lives in auth.users.raw_app_meta_data so it ends
--     up in the JWT for STORY-038's auth.tenant_id() helper.
--   * The legacy 00000000-…-babb tenant from STORY-036 stays in place
--     with owner_user_id = NULL; it's an orphan, harmless, ignored
--     by the partial unique index.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Schema change: tenants.owner_user_id ──────────────────────────
-- Each tenant maps back to its owning auth user. on delete cascade
-- means deleting an auth user nukes their tenant + (eventually,
-- under STORY-038 RLS) all their data through fk cascades from
-- tenants → clients → appointments → …

alter table public.tenants
  add column if not exists owner_user_id uuid
    references auth.users(id) on delete cascade;

-- ── 2. Partial unique index ──────────────────────────────────────────
-- Enforces one tenant per user FOR NOW. The `where … is not null`
-- clause lets the legacy DEV tenant (owner_user_id NULL) coexist.
-- STORY-039 will replace this with a team-membership table.

create unique index if not exists tenants_owner_user_id_unique
  on public.tenants(owner_user_id)
  where owner_user_id is not null;

-- ── 3. Signup trigger function ───────────────────────────────────────
-- Fires AFTER INSERT on auth.users. SECURITY DEFINER → runs as
-- postgres so it can write to public.tenants and update
-- auth.users.raw_app_meta_data. set search_path = public blocks
-- schema-shadowing attacks (without it, an attacker who can create
-- a function in another writable schema could hijack gen_random_uuid).
--
-- Body in two steps:
--   a) insert the tenant
--   b) stamp tenant_id into raw_app_meta_data. The current session's
--      JWT was already issued by this point so it does NOT contain the
--      stamp; the stamp matters from the next sign-in onward (STORY-038
--      RLS reads it). The server-side layout in G5 always re-queries
--      `tenants where owner_user_id = user.id` as the source of truth,
--      so first-session ergonomics aren't impacted.

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
  -- can NOT mutate it from the client (unlike raw_user_meta_data),
  -- so it's safe to trust on the server.
  update auth.users
     set raw_app_meta_data =
           coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('tenant_id', new_tenant_id::text)
   where id = new.id;

  return new;
end;
$$;

-- ── 4. The trigger itself ────────────────────────────────────────────
-- drop-then-create idiom keeps the migration idempotent if it ever
-- gets re-run (which Supabase CLI sometimes does on drift detection).

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 5. Defensive grants ──────────────────────────────────────────────
-- SECURITY DEFINER already runs as postgres which has full rights,
-- but explicit grants make the intent auditable in pg_dump.
grant insert on public.tenants to postgres;
grant update on auth.users to postgres;
