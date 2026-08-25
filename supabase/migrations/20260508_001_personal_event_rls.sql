-- STORY-055 — Personal-event RLS isolation.
--
-- Until v458 the appointments table's RLS only filtered by
-- `tenant_id = current_tenant_id()`. Personal events
-- (kind='event'/'personal') were privacy-filtered ONLY in JS by the
-- dashboard's `visibleAppointments` memo. Anyone authenticated
-- against the tenant could still dump every personal event of every
-- master via `supabase.from('appointments').select()` from devtools.
--
-- This migration:
--   1. Adds `created_by uuid` referencing auth.users.
--   2. Installs a BEFORE INSERT trigger that auto-fills `created_by`
--      from auth.uid() so the TS layer requires zero changes.
--   3. Backfills existing kind='event'/'personal' rows with a
--      best-guess: the tenant's first owner (joined_at ASC).
--   4. Replaces the four appointments policies so personal events
--      are author-scoped while work appointments keep the previous
--      tenant + role rules.
--
-- Roles preserved (matching 20260430_008_team_roles.sql convention):
--   • SELECT — anon + authenticated
--   • INSERT/UPDATE/DELETE — authenticated only
--
-- Service role continues to bypass RLS as designed; Edge Functions
-- such as send_push are unaffected.

-- ── 1. Column ────────────────────────────────────────────────────────
alter table public.appointments
  add column if not exists created_by uuid references auth.users(id);

create index if not exists appointments_created_by_idx
  on public.appointments(created_by) where created_by is not null;

-- ── 2. Trigger — auto-fill from auth.uid() ───────────────────────────
create or replace function public.set_appointment_created_by()
returns trigger as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_appointments_set_created_by on public.appointments;
create trigger trg_appointments_set_created_by
  before insert on public.appointments
  for each row execute function public.set_appointment_created_by();

-- ── 3. Backfill — first owner of the tenant wins ─────────────────────
-- The single existing prod event row (master_id='master-moujpopm-k61mg')
-- gets attributed to its tenant's first owner. If wrong, fix in Studio.
update public.appointments a
set created_by = (
  select user_id from public.tenant_members tm
  where tm.tenant_id = a.tenant_id and tm.role = 'owner'
  order by tm.joined_at asc
  limit 1
)
where a.kind in ('event','personal') and a.created_by is null;

-- ── 4. Policy rewrite ────────────────────────────────────────────────
drop policy if exists appointments_select_member             on public.appointments;
drop policy if exists appointments_insert_owner_or_dispatcher on public.appointments;
drop policy if exists appointments_update_member             on public.appointments;
drop policy if exists appointments_delete_owner_or_dispatcher on public.appointments;

-- SELECT — work visible to every tenant member; event/personal only
-- to the author.
create policy appointments_select on public.appointments for select
  to anon, authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (kind = 'work' or created_by = auth.uid())
  );

-- INSERT — owner/dispatcher can write work; any authenticated tenant
-- member can write event/personal authored by themselves (the
-- trigger above will fill created_by when null).
create policy appointments_insert on public.appointments for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and (
      (kind = 'work' and public.current_user_role() in ('owner','dispatcher'))
      or (kind in ('event','personal') and (created_by is null or created_by = auth.uid()))
    )
  );

-- UPDATE — same shape as SELECT (work for everyone in tenant,
-- event/personal only for the author).
create policy appointments_update on public.appointments for update
  to authenticated
  using      (tenant_id = public.current_tenant_id() and (kind = 'work' or created_by = auth.uid()))
  with check (tenant_id = public.current_tenant_id() and (kind = 'work' or created_by = auth.uid()));

-- DELETE — work via owner/dispatcher; event/personal only by author.
create policy appointments_delete on public.appointments for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      (kind = 'work' and public.current_user_role() in ('owner','dispatcher'))
      or (kind in ('event','personal') and created_by = auth.uid())
    )
  );
