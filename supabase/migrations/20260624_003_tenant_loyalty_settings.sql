-- ════════════════════════════════════════════════════════════════════
-- 20260624_003 — tenant_loyalty_settings (one singleton row per tenant)
--
-- Mirrors packages/shared/src/local/loyalty.ts (LoyaltySettings:
-- { enabled, tiers: LoyaltyTier[] }). Per-tenant owner-edited config, so
-- it needs tenant-scoped RLS via current_tenant_id() (NOT app_settings,
-- which is a global service-role-only KV store with no tenant column).
-- PK = tenant_id (singleton), matching the calendar_settings pattern.
-- tiers is a small bounded list always read/written as a unit → jsonb on
-- the row (TS sanitizer remains the source of truth). clients.discount is
-- a separate per-client manual override and is intentionally untouched.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.tenant_loyalty_settings (
  tenant_id  uuid primary key references public.tenants(id) on delete cascade,
  enabled    boolean not null default false,
  tiers      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_loyalty_settings enable row level security;

drop policy if exists tenant_loyalty_settings_tenant_all on public.tenant_loyalty_settings;
create policy tenant_loyalty_settings_tenant_all on public.tenant_loyalty_settings
  for all to anon, authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop trigger if exists tenant_loyalty_settings_set_updated_at on public.tenant_loyalty_settings;
create trigger tenant_loyalty_settings_set_updated_at
  before update on public.tenant_loyalty_settings
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.tenant_loyalty_settings to authenticated;
