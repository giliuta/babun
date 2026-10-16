-- STORY-036 — Supabase foundation, clients vertical only.
-- RLS intentionally OFF here. Locked down in STORY-038.
-- Schema mirrors @babun/shared/local/clients.ts. Nested data
-- (phones, locations, notes, equipment) stays as jsonb so we
-- don't fan out into 4 satellite tables before we have to.

create extension if not exists "pgcrypto";

-- ─── Tenants ───────────────────────────────────────────────────
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vertical text,                   -- "hvac" / "cleaning" / "salon" / ...
  created_at timestamptz not null default now()
);

-- Seed the dev tenant so the app has a concrete tenant_id to write
-- against until STORY-037 introduces real auth.
insert into public.tenants (id, name, vertical)
values (
  '00000000-0000-0000-0000-00000000babb',
  'Babun Dev',
  'hvac'
);

-- ─── Client tags ───────────────────────────────────────────────
create table public.client_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  color text not null
);

create index client_tags_tenant_idx on public.client_tags(tenant_id);

-- ─── Clients ───────────────────────────────────────────────────
-- Field set mirrors @babun/shared/local/clients.ts → Client interface.
-- Nested fields (phones, locations, notes, equipment) live in jsonb.
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  full_name text not null,
  phone text not null default '',
  whatsapp_phone text not null default '',
  email text not null default '',
  sms_name text not null default '',
  telegram_username text not null default '',
  instagram_username text not null default '',

  -- Money / commercial
  balance numeric(12,2) not null default 0,
  discount int not null default 0 check (discount between 0 and 100),

  -- Free text
  comment text not null default '',

  -- Acquisition
  acquisition_source text not null default 'unknown',
  referred_by_client_id uuid references public.clients(id) on delete set null,
  first_contact_date date,

  -- Address (legacy single — kept until full migration to locations)
  address text not null default '',
  city text not null default '',
  property_type text not null default '',

  -- Per-client metadata
  language text,
  birthday text not null default '',
  blacklisted boolean not null default false,
  pinned_at timestamptz,
  reminder_at timestamptz,

  -- Nested arrays — see PhoneEntry / Location / ClientNote / ACUnit in clients.ts
  phones jsonb not null default '[]'::jsonb,
  locations jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  equipment jsonb not null default '[]'::jsonb,  -- legacy; kept to mirror local model

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_tenant_idx on public.clients(tenant_id);
create index clients_tenant_full_name_idx on public.clients(tenant_id, full_name);
create index clients_tenant_phone_idx on public.clients(tenant_id, phone);

-- ─── Client tag assignments (junction) ─────────────────────────
create table public.client_tag_assignments (
  client_id uuid not null references public.clients(id) on delete cascade,
  tag_id uuid not null references public.client_tags(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  primary key (client_id, tag_id)
);

create index client_tag_assignments_tenant_idx
  on public.client_tag_assignments(tenant_id);

-- ─── Default tags for the dev tenant ───────────────────────────
insert into public.client_tags (tenant_id, name, color) values
  ('00000000-0000-0000-0000-00000000babb', 'VIP',         '#f59e0b'),
  ('00000000-0000-0000-0000-00000000babb', 'Постоянный',  '#10b981'),
  ('00000000-0000-0000-0000-00000000babb', 'Новый',       '#3b82f6'),
  ('00000000-0000-0000-0000-00000000babb', 'Проблемный',  '#ef4444');

-- ─── updated_at trigger ────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- NOTE: RLS is intentionally NOT enabled. STORY-038 will:
--   alter table public.tenants enable row level security;
--   alter table public.clients enable row level security;
--   alter table public.client_tags enable row level security;
--   alter table public.client_tag_assignments enable row level security;
-- and create per-table policies based on auth.tenant_id().
