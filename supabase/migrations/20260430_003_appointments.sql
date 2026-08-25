-- ─────────────────────────────────────────────────────────────────────
-- STORY-042 — Appointments → Supabase (multi-device sync).
--
-- Mirror of the local @babun/shared/local/appointments.ts shape:
-- a single, jsonb-heavy table that round-trips the existing UI types
-- without splitting nested arrays into auxiliary tables (decision A1).
--
-- RLS uses the same `current_tenant_id()` helper introduced in
-- 20260429_001_rls_policies.sql; cross-tenant reads return zero rows
-- and tenant-stealing UPDATEs trip the WITH CHECK clause.
--
-- master_id / team_id stay as text (NOT FKs) because masters and
-- teams still live in localStorage. Once those tables migrate, a
-- follow-up story adds the constraints (decision A8).
-- ─────────────────────────────────────────────────────────────────────

create table public.appointments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,

  -- Local-only refs (text until masters/teams migrate).
  team_id       text,
  master_id     text,
  location_id   text,

  -- Time as text (YYYY-MM-DD / HH:MM) so the UI shape doesn't change.
  date          text not null,
  time_start    text not null,
  time_end      text not null,

  kind   text not null default 'work'      check (kind   in ('work','event','personal')),
  status text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','cancelled')),

  -- Money + flags.
  total_amount    numeric not null default 0,
  custom_total    boolean not null default false,
  discount_amount numeric not null default 0,
  prepaid_amount  numeric not null default 0,

  -- Free text + map.
  comment       text not null default '',
  address       text not null default '',
  address_note  text not null default '',
  address_lat   double precision,
  address_lng   double precision,
  cancel_reason text,
  source        text,
  is_online_booking boolean not null default false,
  consent_given     boolean not null default true,
  color_override    text,

  -- Reminders.
  reminder_enabled  boolean not null default false,
  reminder_offsets  jsonb   not null default '[]'::jsonb,
  reminder_template text    not null default '',

  -- Nested collections (jsonb — decision A1).
  service_ids             jsonb not null default '[]'::jsonb,
  services                jsonb not null default '[]'::jsonb,
  service_price_overrides jsonb not null default '{}'::jsonb,
  expenses                jsonb not null default '[]'::jsonb,
  payments                jsonb not null default '[]'::jsonb,
  payment                 jsonb,
  photos                  jsonb not null default '[]'::jsonb,
  global_discount         jsonb,
  total_duration          integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Calendar week query: filter by tenant_id, range-scan by date.
create index idx_appointments_tenant_date on public.appointments(tenant_id, date);
-- Client profile timeline: join from clients to appointments.
create index idx_appointments_client      on public.appointments(client_id) where client_id is not null;

-- updated_at maintenance — reuses the helper from 20260427_001_init_clients.sql.
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────
alter table public.appointments enable row level security;

create policy appointments_all_own on public.appointments for all
  to anon, authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
