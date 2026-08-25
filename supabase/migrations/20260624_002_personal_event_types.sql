-- ════════════════════════════════════════════════════════════════════
-- 20260624_002 — personal_event_types (calendar event categories)
--
-- Mirrors packages/shared/src/local/personal-event-types.ts. TEXT PK
-- because the appointment model references it via the text field
-- appointments.event_type_id, and seed ids are stable text ('ev-lunch').
-- The pre-existing public.event_templates is a uuid-PK twin that cannot
-- hold those ids; it is left untouched (empty, unreferenced) — replacing
-- it is out of scope.
--
-- PK is (tenant_id, id) for consistency with the other reference tables
-- (app ids unique per tenant).
--
-- RLS is author-scoped (created_by = auth.uid()), mirroring the personal-
-- event isolation in 20260508_001_personal_event_rls.sql. Idempotent.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.personal_event_types (
  id                text        not null,
  tenant_id         uuid        not null references public.tenants(id) on delete cascade,
  label             text        not null,
  icon              text        not null default 'tag',
  color             text        not null default '#007AFF',
  default_duration  int         not null default 60,
  all_day           boolean     not null default false,
  position          int         not null default 0,
  is_active         boolean     not null default true,
  created_by        uuid        references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, id)
);

create index if not exists idx_personal_event_types_tenant
  on public.personal_event_types(tenant_id, position) where is_active = true;
create index if not exists idx_personal_event_types_created_by
  on public.personal_event_types(created_by) where created_by is not null;

-- updated_at trigger (function already exists in schema).
drop trigger if exists personal_event_types_set_updated_at on public.personal_event_types;
create trigger personal_event_types_set_updated_at
  before update on public.personal_event_types
  for each row execute function public.set_updated_at();

-- Auto-fill created_by from auth.uid() (mirrors set_appointment_created_by).
create or replace function public.set_personal_event_type_created_by()
returns trigger as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_personal_event_types_set_created_by on public.personal_event_types;
create trigger trg_personal_event_types_set_created_by
  before insert on public.personal_event_types
  for each row execute function public.set_personal_event_type_created_by();

-- ─── RLS (author-scoped within tenant) ────────────────────────────────
alter table public.personal_event_types enable row level security;

drop policy if exists personal_event_types_select on public.personal_event_types;
create policy personal_event_types_select on public.personal_event_types for select
  to anon, authenticated
  using (tenant_id = public.current_tenant_id() and created_by = auth.uid());

drop policy if exists personal_event_types_insert on public.personal_event_types;
create policy personal_event_types_insert on public.personal_event_types for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and (created_by is null or created_by = auth.uid())
  );

drop policy if exists personal_event_types_update on public.personal_event_types;
create policy personal_event_types_update on public.personal_event_types for update
  to authenticated
  using      (tenant_id = public.current_tenant_id() and created_by = auth.uid())
  with check (tenant_id = public.current_tenant_id() and created_by = auth.uid());

drop policy if exists personal_event_types_delete on public.personal_event_types;
create policy personal_event_types_delete on public.personal_event_types for delete
  to authenticated
  using (tenant_id = public.current_tenant_id() and created_by = auth.uid());

grant select, insert, update, delete on public.personal_event_types to anon, authenticated;
