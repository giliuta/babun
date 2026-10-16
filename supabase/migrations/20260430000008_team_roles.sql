-- ─────────────────────────────────────────────────────────────────────
-- STORY-039 — Team roles (Owner / Dispatcher / Master) + invitations.
--
-- Replaces the per-user-tenant model (one tenants.owner_user_id) with a
-- proper RBAC layer:
--   * tenant_members(tenant_id, user_id, role)  — N-to-N membership.
--   * 3 fixed roles: 'owner' | 'dispatcher' | 'master'. Stored as text
--     with a CHECK constraint (NOT a Postgres enum) so future custom
--     roles can be added without an ALTER TYPE migration.
--   * invitations(token, expires_at, accepted_at) — email-based
--     invite flow with 7-day TTL and one-time-use semantics.
--   * Helper current_user_role() for per-role RLS gating across all
--     11 tenant-scoped tables.
--   * Protected last-owner invariant (no self-lockout).
--
-- Master role caveat (decision D1=C, 2026-04-30): Master users see ALL
-- appointments in their tenant (no "only-assigned" filter). Restricting
-- to assigned-only requires migrating the local masters[] model into
-- Supabase first — parked as STORY-039b. Master role's edit privilege
-- is column-restricted (only status + comment on appointments) via the
-- appointments_master_column_guard trigger.
--
-- Financials column-level RLS (e.g. masking total_amount/expenses for
-- Dispatcher) is parked as STORY-039c. UI-level guards in this story.
-- ─────────────────────────────────────────────────────────────────────

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ CHUNK 1 — New tables: tenant_members + invitations                ║
-- ╚═══════════════════════════════════════════════════════════════════╝

create table public.tenant_members (
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  user_id              uuid not null references auth.users(id)     on delete cascade,
  role                 text not null check (role in ('owner','dispatcher','master')),
  invited_by_user_id   uuid          references auth.users(id)     on delete set null,
  joined_at            timestamptz not null default now(),
  -- Reserved for per-membership settings (notification prefs etc).
  metadata             jsonb       not null default '{}'::jsonb,
  primary key (tenant_id, user_id)
);
-- "What tenants does this user belong to?" — used by helpers + switcher.
create index idx_tenant_members_user_id on public.tenant_members(user_id);
-- "List the owners of a tenant" — used by the last-owner protection.
create index idx_tenant_members_tenant_role on public.tenant_members(tenant_id, role);

create table public.invitations (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  email                text not null,
  role                 text not null check (role in ('owner','dispatcher','master')),
  invited_by_user_id   uuid          references auth.users(id)     on delete set null,
  -- Random URL-safe token, populated server-side via gen_random_bytes.
  token                text not null unique,
  expires_at           timestamptz not null default now() + interval '7 days',
  -- One-time use: stamped on accept; subsequent accepts are rejected.
  accepted_at          timestamptz,
  created_at           timestamptz not null default now()
);
-- "List pending invites for a tenant" — owner-side dashboard.
create index idx_invitations_tenant on public.invitations(tenant_id) where accepted_at is null;
-- "Find pending invites by email" — used by /invite/[token] match path.
create index idx_invitations_email on public.invitations(lower(email)) where accepted_at is null;

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ CHUNK 2 — Backfill existing tenants → tenant_members rows         ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Atomic with the rest of the migration (single transaction). Each
-- tenant.owner_user_id becomes one tenant_members row with role='owner'.
-- joined_at = tenant.created_at so analytics keep the original signup
-- timestamp. Orphans (owner_user_id IS NULL — only the legacy DEV
-- tenant) are excluded.

insert into public.tenant_members (tenant_id, user_id, role, joined_at)
select t.id, t.owner_user_id, 'owner', t.created_at
from public.tenants t
where t.owner_user_id is not null
on conflict (tenant_id, user_id) do nothing;

-- Backfill app_metadata.available_tenants for every existing user. The
-- `tenant_id` claim itself was already stamped by handle_new_user
-- (STORY-037); we add available_tenants as a JSON array of all tenants
-- the user is a member of (one element today; multiple after invites
-- start landing).
update auth.users u
   set raw_app_meta_data =
         coalesce(u.raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object(
              'available_tenants',
              (select jsonb_agg(tm.tenant_id::text)
                 from public.tenant_members tm
                where tm.user_id = u.id)
            )
 where exists (
   select 1 from public.tenant_members tm where tm.user_id = u.id
 );

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ CHUNK 3 — Helpers: current_tenant_id() + current_user_role()      ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- current_tenant_id() rewritten:
--   1) Fast path: JWT app_metadata.tenant_id (the "active" tenant for
--      multi-team users).
--   2) Fallback: pick any tenant_members row for auth.uid(). Covers the
--      fresh-signup race (JWT issued before the trigger's stamp).
-- The legacy fallback against tenants.owner_user_id is gone (column
-- dropped in CHUNK 5).

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(((auth.jwt() -> 'app_metadata') ->> 'tenant_id'), '')::uuid,
    -- Deterministic fallback: oldest membership wins. Removes the
    -- non-determinism in the rare multi-tenant + JWT-not-yet-stamped
    -- edge case (e.g. Edge worker doing a server fetch right after a
    -- /api/team/switch before the client refreshSession()-ed).
    (select tenant_id from public.tenant_members
       where user_id = auth.uid()
       order by joined_at asc, tenant_id asc
       limit 1)
  );
$$;
revoke all on function public.current_tenant_id() from public;
grant execute on function public.current_tenant_id() to anon, authenticated;

-- current_user_role(): role for the active tenant. Returns NULL for
-- anon and for users not in the active tenant. Used across every
-- per-role RLS USING / WITH CHECK clause. STABLE volatility so
-- Postgres caches the result within a single query (the per-row RLS
-- evaluation only calls this once per query, not per row).

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
    from public.tenant_members
   where user_id = auth.uid()
     and tenant_id = public.current_tenant_id()
   limit 1;
$$;
revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to anon, authenticated;

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ CHUNK 4 — Triggers: last-owner protection + master column guard   ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- protect_last_owner: BEFORE UPDATE OR DELETE on tenant_members. Blocks
-- the demotion or removal of the LAST owner. Demoting a co-owner when
-- ≥ 2 owners exist is fine; first-owner-leaves is the only error path.

create or replace function public.protect_last_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  remaining int;
begin
  if (TG_OP = 'DELETE' and old.role = 'owner')
     or (TG_OP = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    select count(*)
      into remaining
      from public.tenant_members
     where tenant_id = old.tenant_id
       and role      = 'owner'
       and user_id   <> old.user_id;
    if remaining = 0 then
      raise exception 'cannot remove or demote the last owner of tenant %', old.tenant_id
        using errcode = '23514',
              hint    = 'invite or promote another owner first';
    end if;
  end if;
  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists tenant_members_protect_last_owner on public.tenant_members;
create trigger tenant_members_protect_last_owner
  before update or delete on public.tenant_members
  for each row execute function public.protect_last_owner();

-- appointments_master_column_guard: BEFORE UPDATE on appointments.
-- When the caller's role is 'master', allows mutating only `status`
-- and `comment`. Everything else must be unchanged. The row-level RLS
-- still gates which appointments are even visible (any tenant member);
-- this trigger is the column-level wall.

create or replace function public.appointments_master_column_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  caller_role text := public.current_user_role();
begin
  if caller_role = 'master' then
    if   new.tenant_id        is distinct from old.tenant_id
      or new.client_id        is distinct from old.client_id
      or new.team_id          is distinct from old.team_id
      or new.master_id        is distinct from old.master_id
      or new.location_id      is distinct from old.location_id
      or new.date             is distinct from old.date
      or new.time_start       is distinct from old.time_start
      or new.time_end         is distinct from old.time_end
      or new.kind             is distinct from old.kind
      or new.total_amount     is distinct from old.total_amount
      or new.custom_total     is distinct from old.custom_total
      or new.discount_amount  is distinct from old.discount_amount
      or new.prepaid_amount   is distinct from old.prepaid_amount
      or new.address          is distinct from old.address
      or new.address_note     is distinct from old.address_note
      or new.address_lat      is distinct from old.address_lat
      or new.address_lng      is distinct from old.address_lng
      or new.cancel_reason    is distinct from old.cancel_reason
      or new.source           is distinct from old.source
      or new.is_online_booking  is distinct from old.is_online_booking
      or new.consent_given      is distinct from old.consent_given
      or new.color_override     is distinct from old.color_override
      or new.reminder_enabled   is distinct from old.reminder_enabled
      or new.reminder_offsets   is distinct from old.reminder_offsets
      or new.reminder_template  is distinct from old.reminder_template
      or new.service_ids        is distinct from old.service_ids
      or new.services           is distinct from old.services
      or new.service_price_overrides is distinct from old.service_price_overrides
      or new.expenses          is distinct from old.expenses
      or new.payments          is distinct from old.payments
      or new.payment           is distinct from old.payment
      or new.global_discount   is distinct from old.global_discount
      or new.total_duration    is distinct from old.total_duration then
      raise exception 'master role can only update status and comment'
        using errcode = '42501',
              hint    = 'use status / comment columns or escalate to dispatcher';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_master_column_guard on public.appointments;
create trigger appointments_master_column_guard
  before update on public.appointments
  for each row execute function public.appointments_master_column_guard();

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ CHUNK 5 — Drop legacy artifacts: prevent_owner_change + column   ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- The owner_user_id column is no longer the source of truth — it's
-- moved to tenant_members. Drop the prevent-change trigger first (it
-- references the column), then the partial unique index, then the
-- column itself. Order matters: any leftover dependency raises here.

drop trigger if exists tenants_prevent_owner_change on public.tenants;
drop function if exists public.tenants_prevent_owner_change();
drop index if exists public.tenants_owner_user_id_unique;
alter table public.tenants drop column if exists owner_user_id;

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ CHUNK 6 — Update handle_new_user trigger (atomic signup)          ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Single transaction: tenant + first owner membership + 4 default
-- tags + JWT stamp (tenant_id + available_tenants). Anything failing
-- rolls the whole signup back. calendar_settings creation stays lazy
-- (default-on-read in the repo); deliberately not touched here to
-- keep the trigger surface tight.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
begin
  -- 1) tenant
  insert into public.tenants (id, name, vertical)
  values (
    gen_random_uuid(),
    coalesce(new.raw_user_meta_data->>'business_name', new.email),
    'unknown'
  )
  returning id into new_tenant_id;

  -- 2) tenant_members — this user becomes the first owner.
  insert into public.tenant_members (tenant_id, user_id, role, joined_at)
  values (new_tenant_id, new.id, 'owner', now());

  -- 3) default client tags (locked palette from STORY-043).
  insert into public.client_tags (id, tenant_id, name, color) values
    (gen_random_uuid(), new_tenant_id, 'VIP',         '#f59e0b'),
    (gen_random_uuid(), new_tenant_id, 'Новый',       '#3b82f6'),
    (gen_random_uuid(), new_tenant_id, 'Постоянный',  '#10b981'),
    (gen_random_uuid(), new_tenant_id, 'Проблемный',  '#ef4444');

  -- 4) JWT stamps. tenant_id = active tenant; available_tenants = the
  -- list the UI switcher reads. Both are in app_metadata (admin-only,
  -- not user-mutable).
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

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ CHUNK 7 — RLS rewrites on the 11 tenant-scoped tables             ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Pattern: drop the old "FOR ALL using tenant_id = current_tenant_id()"
-- policy on each table; create per-role policies. SELECT is open to
-- every tenant member; write privilege depends on role.

-- ── 7.1 tenants ──────────────────────────────────────────────────────
drop policy if exists tenants_select_own  on public.tenants;
drop policy if exists tenants_update_own  on public.tenants;
create policy tenants_select_member on public.tenants for select
  to anon, authenticated
  using (id = public.current_tenant_id());
create policy tenants_update_owner on public.tenants for update
  to authenticated
  using      (id = public.current_tenant_id() and public.current_user_role() = 'owner')
  with check (id = public.current_tenant_id() and public.current_user_role() = 'owner');

-- ── 7.2 clients ──────────────────────────────────────────────────────
drop policy if exists clients_all_own on public.clients;
create policy clients_select_member on public.clients for select
  to anon, authenticated
  using (tenant_id = public.current_tenant_id());
create policy clients_insert_owner_or_dispatcher on public.clients for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'));
create policy clients_update_owner_or_dispatcher on public.clients for update
  to authenticated
  using      (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'))
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'));
create policy clients_delete_owner on public.clients for delete
  to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.current_user_role() = 'owner');

-- ── 7.3 client_tags + client_tag_assignments ─────────────────────────
drop policy if exists client_tags_all_own on public.client_tags;
create policy client_tags_select_member on public.client_tags for select
  to anon, authenticated
  using (tenant_id = public.current_tenant_id());
create policy client_tags_modify_owner_or_dispatcher on public.client_tags for all
  to authenticated
  using      (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'))
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'));

drop policy if exists client_tag_assignments_all_own on public.client_tag_assignments;
create policy client_tag_assignments_select_member on public.client_tag_assignments for select
  to anon, authenticated
  using (tenant_id = public.current_tenant_id());
create policy client_tag_assignments_modify_owner_or_dispatcher on public.client_tag_assignments for all
  to authenticated
  using      (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'))
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'));

-- ── 7.4 appointments ─────────────────────────────────────────────────
-- SELECT: any tenant member.
-- INSERT/DELETE: owner + dispatcher.
-- UPDATE: any tenant member at the row level (so master can update
--   status + comment); the column-level guard trigger from CHUNK 4
--   stops master from mutating any other column.
drop policy if exists appointments_all_own on public.appointments;
create policy appointments_select_member on public.appointments for select
  to anon, authenticated
  using (tenant_id = public.current_tenant_id());
create policy appointments_insert_owner_or_dispatcher on public.appointments for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'));
create policy appointments_update_member on public.appointments for update
  to authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
create policy appointments_delete_owner_or_dispatcher on public.appointments for delete
  to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.current_user_role() in ('owner','dispatcher'));

-- ── 7.5 team_schedules ───────────────────────────────────────────────
drop policy if exists team_schedules_all_own on public.team_schedules;
create policy team_schedules_select_member on public.team_schedules for select
  to anon, authenticated
  using (tenant_id = public.current_tenant_id());
create policy team_schedules_modify_owner_or_dispatcher on public.team_schedules for all
  to authenticated
  using      (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'))
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'));

-- ── 7.6 calendar_settings ────────────────────────────────────────────
drop policy if exists calendar_settings_all_own on public.calendar_settings;
create policy calendar_settings_select_member on public.calendar_settings for select
  to anon, authenticated
  using (tenant_id = public.current_tenant_id());
create policy calendar_settings_modify_owner_or_dispatcher on public.calendar_settings for all
  to authenticated
  using      (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'))
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'));

-- ── 7.7 day_cities + day_extras ──────────────────────────────────────
drop policy if exists day_cities_all_own on public.day_cities;
create policy day_cities_select_member on public.day_cities for select
  to anon, authenticated
  using (tenant_id = public.current_tenant_id());
create policy day_cities_modify_owner_or_dispatcher on public.day_cities for all
  to authenticated
  using      (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'))
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'));

drop policy if exists day_extras_all_own on public.day_extras;
create policy day_extras_select_member on public.day_extras for select
  to anon, authenticated
  using (tenant_id = public.current_tenant_id());
create policy day_extras_modify_owner_or_dispatcher on public.day_extras for all
  to authenticated
  using      (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'))
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'));

-- ── 7.8 recurring_reminders ──────────────────────────────────────────
drop policy if exists recurring_reminders_all_own on public.recurring_reminders;
create policy recurring_reminders_select_member on public.recurring_reminders for select
  to anon, authenticated
  using (tenant_id = public.current_tenant_id());
create policy recurring_reminders_modify_owner_or_dispatcher on public.recurring_reminders for all
  to authenticated
  using      (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'))
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() in ('owner','dispatcher'));

-- ── 7.9 appointment_photos ───────────────────────────────────────────
-- All members can write photos (Master uploads after a service visit).
drop policy if exists appointment_photos_all_own on public.appointment_photos;
create policy appointment_photos_all_member on public.appointment_photos for all
  to anon, authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- storage.objects bucket policies are unchanged — they already gate on
-- the tenant prefix in the path, no role gate needed. Master can
-- already INSERT/DELETE under their tenant's prefix.

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ CHUNK 8 — RLS on tenant_members + invitations                     ║
-- ╚═══════════════════════════════════════════════════════════════════╝

alter table public.tenant_members enable row level security;
-- Anyone in the tenant can see the teammate list.
create policy tenant_members_select_teammate on public.tenant_members for select
  to authenticated
  using (tenant_id = public.current_tenant_id());
-- Owner can invite (insert), promote/demote (update), remove (delete).
create policy tenant_members_insert_owner on public.tenant_members for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() = 'owner');
create policy tenant_members_update_owner on public.tenant_members for update
  to authenticated
  using      (tenant_id = public.current_tenant_id()
              and public.current_user_role() = 'owner')
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() = 'owner');
create policy tenant_members_delete_owner on public.tenant_members for delete
  to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.current_user_role() = 'owner');
-- Self-leave: any member may delete their own row (the
-- protect_last_owner trigger blocks last-owner self-removal).
create policy tenant_members_self_leave on public.tenant_members for delete
  to authenticated
  using (user_id = auth.uid());

alter table public.invitations enable row level security;
-- Owner can manage invites for the tenant.
create policy invitations_owner_manage on public.invitations for all
  to authenticated
  using      (tenant_id = public.current_tenant_id()
              and public.current_user_role() = 'owner')
  with check (tenant_id = public.current_tenant_id()
              and public.current_user_role() = 'owner');
-- Invitee can read their own invite (for the /invite/[token] page).
-- The accept flow itself goes through the SECURITY DEFINER RPC
-- accept_invitation() so the invitee never needs UPDATE on the table
-- directly.
create policy invitations_invitee_select on public.invitations for select
  to authenticated
  using (lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')));

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ CHUNK 9 — accept_invitation(token) RPC                            ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Single SECURITY DEFINER entry point for the /invite/[token] accept
-- flow. Validates token + email match + not-expired + not-accepted,
-- INSERTs tenant_members (idempotent on conflict), stamps
-- accepted_at, refreshes app_metadata.available_tenants.

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv          public.invitations%rowtype;
  caller_email text := lower(coalesce((auth.jwt() ->> 'email'), ''));
begin
  if caller_email = '' then
    raise exception 'must be signed in to accept an invitation' using errcode = '42501';
  end if;

  select * into inv from public.invitations where token = p_token;
  if not found then
    raise exception 'invitation not found' using errcode = '42704';
  end if;
  if inv.accepted_at is not null then
    raise exception 'invitation already accepted' using errcode = '42501';
  end if;
  if inv.expires_at < now() then
    raise exception 'invitation expired' using errcode = '42501';
  end if;
  if lower(inv.email) <> caller_email then
    raise exception 'invitation email does not match the signed-in user' using errcode = '42501';
  end if;

  -- Idempotent insert: if already a member, do nothing (still mark
  -- accepted so the invite is consumed).
  insert into public.tenant_members (tenant_id, user_id, role, invited_by_user_id)
  values (inv.tenant_id, auth.uid(), inv.role, inv.invited_by_user_id)
  on conflict (tenant_id, user_id) do nothing;

  update public.invitations set accepted_at = now() where id = inv.id;

  -- Append tenant to available_tenants in app_metadata. The user's
  -- next refreshSession() picks up the new array.
  update auth.users
     set raw_app_meta_data =
           coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object(
                'available_tenants',
                (select jsonb_agg(distinct tm.tenant_id::text)
                   from public.tenant_members tm
                  where tm.user_id = auth.uid())
              )
   where id = auth.uid();

  return inv.tenant_id;
end;
$$;
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ Verify (run manually after apply)                                ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- select
--   (select count(*) from public.tenant_members) as members_total,
--   (select count(*) from auth.users
--      where (raw_app_meta_data ->> 'available_tenants') is not null) as users_with_avail,
--   (select count(*) from pg_policies where tablename in
--      ('tenants','clients','client_tags','client_tag_assignments','appointments',
--       'team_schedules','calendar_settings','day_cities','day_extras',
--       'recurring_reminders','appointment_photos','tenant_members','invitations')) as policy_count;
-- expect: members_total = pre-migration tenants-with-owner count (=2);
--         users_with_avail = same (=2);
--         policy_count ≥ 30.
