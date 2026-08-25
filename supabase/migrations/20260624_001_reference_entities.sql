-- ════════════════════════════════════════════════════════════════════
-- 20260624_001 — Canonical reference-entity tables (localStorage → cloud)
--
-- Closes the sync gap for the entity records that the mature live schema
-- already references by app-generated TEXT id but that only exist in
-- localStorage today:
--   teams (brigades), masters, services + service_categories, cities,
--   equipment (brigade inventory register).
--
-- ID-TYPE RULE: every PK here is `text` because the entire live schema
-- references these by text id (appointments.team_id/master_id/
-- service_ids[], accounts.brigade_id/owner_master_id, finance_transactions
-- .team_id/master_id, day_cities.team_id, team_schedules.team_id, etc.).
-- A uuid PK would invalidate every existing FK column. App ids are only
-- guaranteed unique PER TENANT, so PK is composite (tenant_id, id) and all
-- future referencing columns must join on (tenant_id, <col>).
--
-- Conventions mirror 20260528_002_finance_redesign.sql + 20260429_001_
-- rls_policies.sql: tenant_id uuid → tenants(id) ON DELETE CASCADE,
-- created_at/updated_at, ENABLE RLS, single `for all` policy keyed off
-- current_tenant_id() (anon → NULL → 0 rows, authenticated scoped),
-- public.set_updated_at() trigger, position int, is_active default true.
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY/TRIGGER
-- before CREATE.
--
-- NO FK constraints are added on existing text-id columns here — orphan/
-- mixed-id-family risk. See 20260624_004_reference_fk_hardening.sql
-- (REVIEW BEFORE APPLY).
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. teams (brigades) ──────────────────────────────────────────────
create table if not exists public.teams (
  id                    text not null,
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  name                  text not null,
  region                text,
  color                 text,
  default_city          text,
  lead_id               text,
  lead_ids              jsonb not null default '[]'::jsonb,
  helper_ids            jsonb not null default '[]'::jsonb,
  roles                 jsonb not null default '[]'::jsonb,
  members               jsonb not null default '[]'::jsonb,
  cities                jsonb not null default '[]'::jsonb,
  payout_percentage     numeric(5,2) not null default 0,
  default_scroll_time   text,
  calendar_window_start text,
  calendar_window_end   text,
  default_slot_minutes  int,
  buffer_minutes        int,
  hide_cancelled        boolean,
  allow_overtime        boolean,
  timezone              text,
  tint_days_by_label    boolean,
  appointment_blocks    jsonb,
  position              int not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (tenant_id, id)
);

create index if not exists idx_teams_tenant
  on public.teams(tenant_id) where is_active = true;
create index if not exists idx_teams_tenant_position
  on public.teams(tenant_id, position);

alter table public.teams enable row level security;
drop policy if exists teams_tenant_all on public.teams;
create policy teams_tenant_all on public.teams
  for all to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop trigger if exists teams_set_updated_at on public.teams;
create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.teams to authenticated;

-- ─── 2. masters ───────────────────────────────────────────────────────
create table if not exists public.masters (
  id              text not null,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  full_name       text not null,
  phone           text,
  team_id         text,
  role            text not null default 'helper'
                    check (role in ('admin','dispatcher','lead','helper')),
  title           text,
  avatar_url      text,
  color           text,
  account_status  text
                    check (account_status in ('invited','active','paused','terminated')),
  position        int not null default 0,
  is_active       boolean not null default true,
  profile         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  primary key (tenant_id, id)
);

create index if not exists idx_masters_tenant
  on public.masters(tenant_id) where is_active = true;
create index if not exists idx_masters_tenant_team
  on public.masters(tenant_id, team_id) where is_active = true;

alter table public.masters enable row level security;
drop policy if exists masters_tenant_all on public.masters;
create policy masters_tenant_all on public.masters
  for all to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop trigger if exists masters_set_updated_at on public.masters;
create trigger masters_set_updated_at
  before update on public.masters
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.masters to authenticated;

-- ─── 3. service_categories ────────────────────────────────────────────
create table if not exists public.service_categories (
  id          text not null,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  color       text,
  position    int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id)
);

create index if not exists idx_service_categories_tenant
  on public.service_categories(tenant_id) where is_active = true;

alter table public.service_categories enable row level security;
drop policy if exists service_categories_tenant_all on public.service_categories;
create policy service_categories_tenant_all on public.service_categories
  for all to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop trigger if exists service_categories_set_updated_at on public.service_categories;
create trigger service_categories_set_updated_at
  before update on public.service_categories
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.service_categories to authenticated;

-- ─── 4. services ──────────────────────────────────────────────────────
create table if not exists public.services (
  id                 text not null,
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  category_id        text,
  name               text not null,
  price              numeric(12,2) not null default 0,
  duration_minutes   int not null default 60,
  color              text not null default '#3b82f6',
  available_weekdays jsonb not null default '[]'::jsonb,
  online_enabled     boolean not null default true,
  material_costs     jsonb not null default '[]'::jsonb,
  bulk_threshold     int not null default 0,
  bulk_price         numeric(12,2) not null default 0,
  cost_per_unit      numeric(12,2) not null default 0,
  is_countable       boolean not null default true,
  brigade_ids        jsonb not null default '[]'::jsonb,
  price_tiers        jsonb,
  duration_tiers     jsonb,
  position           int not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (tenant_id, id)
);

create index if not exists idx_services_tenant
  on public.services(tenant_id) where is_active = true;
create index if not exists idx_services_tenant_category
  on public.services(tenant_id, category_id);

alter table public.services enable row level security;
drop policy if exists services_tenant_all on public.services;
create policy services_tenant_all on public.services
  for all to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.services to authenticated;

-- ─── 5. cities (per-tenant city/tag reference list) ───────────────────
-- NOTE: clients.city / day_cities.city store the city NAME (free text),
-- not this id. cities is a reference/picker list, not an FK target by id.
create table if not exists public.cities (
  id          text not null,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  country     text not null default '',
  color       text,
  position    int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, name)
);

create index if not exists idx_cities_tenant
  on public.cities(tenant_id) where is_active = true;

alter table public.cities enable row level security;
drop policy if exists cities_tenant_all on public.cities;
create policy cities_tenant_all on public.cities
  for all to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop trigger if exists cities_set_updated_at on public.cities;
create trigger cities_set_updated_at
  before update on public.cities
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.cities to authenticated;

-- ─── 6. equipment (brigade inventory register, + parked SLA fields) ───
-- Fleet register (tools/machines the brigades carry), NOT the client's
-- installed A/C units (those stay jsonb on clients.locations[].equipment[]).
create table if not exists public.equipment (
  id                       text not null,
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  name                     text not null,
  category                 text,
  serial                   text,
  assigned_team_id         text,
  notes                    text,
  color                    text,
  installed_at             date,
  last_service_at          date,
  service_interval_months  int,
  next_service_at          date,
  position                 int not null default 0,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (tenant_id, id)
);

create index if not exists idx_equipment_tenant
  on public.equipment(tenant_id) where is_active = true;
create index if not exists idx_equipment_tenant_team
  on public.equipment(tenant_id, assigned_team_id) where is_active = true;
create index if not exists idx_equipment_service_due
  on public.equipment(tenant_id, next_service_at)
  where is_active = true and service_interval_months is not null;

alter table public.equipment enable row level security;
drop policy if exists equipment_tenant_all on public.equipment;
create policy equipment_tenant_all on public.equipment
  for all to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop trigger if exists equipment_set_updated_at on public.equipment;
create trigger equipment_set_updated_at
  before update on public.equipment
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.equipment to authenticated;
