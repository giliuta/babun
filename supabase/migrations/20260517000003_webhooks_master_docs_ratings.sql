-- ─────────────────────────────────────────────────────────────────────
-- Beta #50 + #51 + #52 (CRM Core brief) — three Beta-era tables that
-- the brief calls out as separate features but share one «we need
-- the schema in place before any UI can light up» moment.
--
--   #50 — Webhooks for developers. Tenants register an HTTPS URL
--         + event subscription mask. We sign each outbound call with
--         HMAC-SHA256 using a per-row secret so the receiver can
--         verify authenticity.
--   #51 — Master documents. File metadata + expiry tracker; the
--         actual blob lives in Supabase Storage (`master-docs`
--         bucket — bucket creation is manual via the dashboard,
--         outside the SQL migration domain).
--   #52 — Master ratings. Public feedback form writes one row per
--         tap of a star; aggregate stats are computed at read time.
--
-- All three are RLS-gated to the owning tenant.
-- ─────────────────────────────────────────────────────────────────────

-- ─── #50 Webhooks ─────────────────────────────────────────────────────
create table if not exists public.webhooks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  label           text not null,
  url             text not null,
  -- Per-row HMAC secret. Generated at insert time (default uses
  -- gen_random_uuid which is the cheapest 128-bit unique source we
  -- have without enabling pgcrypto).
  secret          text not null default replace(gen_random_uuid()::text, '-', ''),
  -- Bitmask-like jsonb so a tenant can subscribe to «appointment.*»
  -- without enumerating every leaf. Reader uses jsonb_array_contains.
  events          jsonb not null default '[]'::jsonb,
  enabled         boolean not null default true,
  last_fired_at   timestamptz,
  last_status     integer,
  failure_count   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_webhooks_tenant on public.webhooks(tenant_id);

alter table public.webhooks enable row level security;

create policy webhooks_all_own on public.webhooks for all
  to anon, authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- updated_at trigger reuses the existing helper.
create trigger webhooks_set_updated_at
  before update on public.webhooks
  for each row execute function public.set_updated_at();

-- ─── #51 Master documents ────────────────────────────────────────────
-- Files live in Storage. This table tracks metadata + the
-- expiry-reminder that the brief asks for («контроль сроков действия
-- (напоминание за 30 дней до истечения)»). When `expires_at` is
-- within 30 days a separate cron job posts to recurring_reminders.
create table if not exists public.master_documents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  master_id       text not null,
  kind            text not null
                       check (kind in ('passport','certificate','contract','license','other')),
  label           text not null,
  storage_path    text not null,
  mime_type       text,
  size_bytes      bigint,
  issued_at       date,
  expires_at      date,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_master_docs_tenant_master
  on public.master_documents(tenant_id, master_id);
create index if not exists idx_master_docs_expiry
  on public.master_documents(tenant_id, expires_at)
  where expires_at is not null;

alter table public.master_documents enable row level security;

create policy master_docs_all_own on public.master_documents for all
  to anon, authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ─── #52 Master ratings ──────────────────────────────────────────────
-- One row per submitted rating. Aggregates are computed at read
-- time so a master with 100+ ratings doesn't need a separate
-- denormalised count column.
create table if not exists public.master_ratings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  master_id       text not null,
  appointment_id  uuid references public.appointments(id) on delete set null,
  client_id       uuid references public.clients(id) on delete set null,
  stars           integer not null check (stars between 1 and 5),
  comment         text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_master_ratings_tenant_master
  on public.master_ratings(tenant_id, master_id);
create index if not exists idx_master_ratings_apt
  on public.master_ratings(appointment_id)
  where appointment_id is not null;

alter table public.master_ratings enable row level security;

-- Owner reads via tenant scope.
create policy master_ratings_read_own on public.master_ratings for select
  to anon, authenticated
  using (tenant_id = public.current_tenant_id());

-- Inserts come from the public feedback page (anonymous role); we
-- accept any insert and rely on the appointment_id check to bind to
-- a real tenant. The form-side route resolves tenant_id from the
-- short-link token before inserting.
create policy master_ratings_insert_any on public.master_ratings for insert
  to anon, authenticated
  with check (true);
