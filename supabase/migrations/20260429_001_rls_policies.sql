-- ─────────────────────────────────────────────────────────────────────
-- STORY-038 — RLS policies + tenant_id helper.
--
-- After this migration:
--   * RLS is on for tenants, clients, client_tags, client_tag_assignments.
--   * public.current_tenant_id() resolves tenant_id from JWT (fast)
--     with a fallback DB lookup (covers the fresh-signup race where
--     the JWT predates the trigger's app_metadata stamp).
--   * Every tenant-scoped table has one permissive policy keyed off
--     current_tenant_id(). Both anon (→ NULL → 0 rows) and
--     authenticated roles are covered explicitly.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Helper: current_tenant_id() ───────────────────────────────────
-- SECURITY DEFINER so the fallback subquery on tenants doesn't hit
-- the very RLS policy it's used to evaluate (which would recurse).
-- set search_path blocks schema-shadowing the same way as the
-- STORY-037 handle_new_user function.

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- Fast path: JWT app_metadata.tenant_id (stamped by handle_new_user).
    -- NULL for anon (auth.jwt() is null) and for the very first session
    -- post-signup (JWT was issued before the trigger's stamp).
    nullif(((auth.jwt() -> 'app_metadata') ->> 'tenant_id'), '')::uuid,
    -- DB fallback: query tenants by auth.uid(). Bypasses RLS via
    -- SECURITY DEFINER. Returns NULL for anon (auth.uid() null) and
    -- for the broken state where no tenants row exists for the user.
    (select id from public.tenants where owner_user_id = auth.uid() limit 1)
  );
$$;

revoke all on function public.current_tenant_id() from public;
grant execute on function public.current_tenant_id() to anon, authenticated;

-- ── 2. Enable RLS on all tenant-scoped tables ────────────────────────
alter table public.tenants                enable row level security;
alter table public.clients                enable row level security;
alter table public.client_tags            enable row level security;
alter table public.client_tag_assignments enable row level security;

-- ── 3. Drop any leftover dev policies (idempotent for re-runs) ───────
drop policy if exists tenants_select_own           on public.tenants;
drop policy if exists tenants_update_own           on public.tenants;
drop policy if exists clients_all_own              on public.clients;
drop policy if exists client_tags_all_own          on public.client_tags;
drop policy if exists client_tag_assignments_all_own on public.client_tag_assignments;

-- ── 4. tenants — read + update own row only ──────────────────────────
-- INSERT is handled exclusively by handle_new_user() trigger (no app
-- code creates tenants directly).
-- DELETE happens via cascade when auth.users row is removed.

create policy tenants_select_own
  on public.tenants for select
  to anon, authenticated
  using (id = public.current_tenant_id());

create policy tenants_update_own
  on public.tenants for update
  to anon, authenticated
  using (id = public.current_tenant_id())
  with check (id = public.current_tenant_id());

-- ── 5. clients — full CRUD on rows belonging to the caller's tenant ──
-- `for all` covers SELECT/INSERT/UPDATE/DELETE in one policy.
-- Both `using` (gates read/match) and `with check` (gates write/post-
-- write state) reference the same predicate so a row can never be
-- inserted or updated into a different tenant_id than the caller's.

create policy clients_all_own
  on public.clients for all
  to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 6. client_tags — same shape as clients ───────────────────────────
create policy client_tags_all_own
  on public.client_tags for all
  to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 7. client_tag_assignments — junction table ───────────────────────
-- tenant_id is denormalized onto the junction row itself for fast
-- filtering — see schema in STORY-036 G2.
create policy client_tag_assignments_all_own
  on public.client_tag_assignments for all
  to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ── 8. Prevent owner_user_id change via UPDATE ───────────────────────
-- Closes a subtle backdoor: tenants_update_own only checks `id`. A
-- malicious authenticated caller could `UPDATE tenants SET owner_user_id
-- = '<someone_else_uuid>' WHERE id = current_tenant_id()` — the policy
-- would pass (id unchanged) but the tenant ownership would silently
-- transfer. Realistically requires the attacker to know another user's
-- uuid, but defense-in-depth: block the column entirely on UPDATE.
-- The trigger from STORY-037 (handle_new_user) inserts owner_user_id
-- on creation; nothing else legitimately mutates it.

create or replace function public.tenants_prevent_owner_change()
returns trigger
language plpgsql
as $$
begin
  if old.owner_user_id is distinct from new.owner_user_id then
    raise exception 'owner_user_id cannot be changed via UPDATE';
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_prevent_owner_change on public.tenants;
create trigger tenants_prevent_owner_change
  before update on public.tenants
  for each row execute function public.tenants_prevent_owner_change();

-- ── 9. Sanity check (run manually after migration) ───────────────────
-- set role anon;
-- select count(*) from public.clients;       -- expect 0
-- select count(*) from public.tenants;       -- expect 0
-- reset role;
