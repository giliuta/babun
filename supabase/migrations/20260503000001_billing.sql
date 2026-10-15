-- ─────────────────────────────────────────────────────────────────────
-- STORY-052 G1 — Stripe billing (Free / Pro / Business / Lifetime).
--
-- Three concerns:
--   1. Extend `public.tenants` with billing state (plan, stripe ids,
--      subscription status, period markers).
--   2. New `public.billing_events` history table for webhook audit +
--      idempotency dedup.
--   3. Helper functions for the quota tiers — read-only SQL that the
--      Settings UI + repo wrappers + Edge Functions all share.
--
-- Pricing matrix lives ONLY in the helper functions. Hardcoding tiers
-- in the database keeps Postgres + TS in sync via a single edit, and
-- avoids the temptation to put the matrix in `app_settings` where a
-- typo would slow-roll-out break billing.
--
-- RLS shape:
--   * tenants: existing select_member + update_owner policies
--     unchanged. NEW: service_role can UPDATE/INSERT (webhook
--     mutates plan + stripe ids cross-tenant). Tightened from the
--     STORY-047 G3 hotfix's read-only grant to read+write.
--   * billing_events: tenant-scoped SELECT for any member (history
--     visibility), service_role-only writes (webhook).
--
-- Forward rule: STORY-052b is logged for adding Postgres BEFORE
-- INSERT triggers on clients/appointments/invitations to backstop
-- the repo-layer quota enforcement landing in G4.
--
-- Convention notes embedded for future maintainers:
--   * 999999999 sentinel = unlimited. UI displays ∞ when value
--     > 1_000_000_000. A `isUnlimited(n)` helper in shared utils
--     wraps the comparison for the G5 Settings UI.
--   * billing_events.tenant_id NULL = orphan webhook event (Stripe
--     event landed before we matched a customer to a tenant, or
--     state corruption). Only service_role can SELECT those —
--     forensic forward-compat.
--   * tenant_sms_config.free_quota_per_month NULL = "use the plan
--     tier default" (resolved via tenant_quota_sms_month). Non-null
--     = manual override — rare by design (support extensions,
--     promo grants, debug). Document any use.
-- ─────────────────────────────────────────────────────────────────────

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ 1. Tenant billing columns                                         ║
-- ╚═══════════════════════════════════════════════════════════════════╝

alter table public.tenants
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'pro', 'business')),
  add column if not exists plan_override text
    check (plan_override is null or plan_override in ('lifetime', 'beta_unlimited')),
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text unique,
  add column if not exists subscription_status text
    check (
      subscription_status is null
      or subscription_status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')
    ),
  add column if not exists trial_ends_at timestamptz,
  add column if not exists current_period_end timestamptz;

comment on column public.tenants.plan is
  'STORY-052 — paid tier from Stripe webhook. free is the default. '
  'plan_override (when set) wins over this value via tenant_effective_plan().';
comment on column public.tenants.plan_override is
  'STORY-052 — manual grant: lifetime (AirFix one-shot), beta_unlimited '
  '(internal beta tenants). NULL by default. Visible to Owner — not a '
  'security boundary, just operational convenience.';
comment on column public.tenants.stripe_customer_id is
  'STORY-052 — Stripe Customer object id (cus_xxx). Set by the upgrade '
  'server action when a tenant first reaches Stripe Checkout.';
comment on column public.tenants.stripe_subscription_id is
  'STORY-052 — Stripe Subscription id (sub_xxx). Set by the webhook on '
  'customer.subscription.created. Null when canceled.';

-- Looking up "which tenant owns this Stripe customer" during webhook
-- processing — UNIQUE constraints above already create the indexes,
-- but be explicit for the planner.
create index if not exists idx_tenants_stripe_customer
  on public.tenants(stripe_customer_id) where stripe_customer_id is not null;
create index if not exists idx_tenants_stripe_subscription
  on public.tenants(stripe_subscription_id) where stripe_subscription_id is not null;

-- Service-role write access (the webhook needs to update plan +
-- stripe ids cross-tenant via service-role JWT). Tightening the
-- STORY-047 G3 hotfix that was SELECT-only for tenants.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'tenants'
       and policyname = 'tenants_service_role_write'
  ) then
    create policy tenants_service_role_write
      on public.tenants
      for update to service_role
      using (true) with check (true);
  end if;
end $$;

grant update on public.tenants to service_role;

comment on policy tenants_service_role_write on public.tenants is
  'STORY-052 — Stripe webhook updates tenants.plan + stripe_* across '
  'tenants via service-role JWT. SELECT bypass landed in STORY-047 G3 '
  'hotfix; this adds the write half scoped narrowly to UPDATE.';

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ 2. billing_events — webhook audit + idempotency                   ║
-- ╚═══════════════════════════════════════════════════════════════════╝

create table if not exists public.billing_events (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        references public.tenants(id) on delete cascade,
  -- Stripe event id (evt_xxx). UNIQUE so a retried webhook delivery
  -- short-circuits without re-applying the event. Same idempotency
  -- pattern as STORY-047 sms_messages.twilio_sid UNIQUE.
  stripe_event_id text        not null unique,
  event_type      text        not null,
  payload         jsonb       not null,
  processed_at    timestamptz not null default now()
);

-- Owner Settings UI: list invoice events for the tenant ordered by
-- most-recent first.
create index if not exists idx_billing_events_tenant_processed
  on public.billing_events(tenant_id, processed_at desc);

-- Webhook idempotency lookup — already covered by the UNIQUE
-- constraint on stripe_event_id but make the implicit index explicit
-- for grep-ability.
-- (Postgres auto-creates a btree for UNIQUE; no separate CREATE
-- INDEX needed.)

comment on table public.billing_events is
  'STORY-052 — Stripe webhook audit + idempotency. Append-only. Tenant '
  'members can read their own; only the webhook (service role) writes.';
comment on column public.billing_events.stripe_event_id is
  'Stripe evt_xxx id; UNIQUE for webhook idempotency. A retried '
  'delivery hits the unique constraint and the route returns 200 '
  'without re-applying the event.';

alter table public.billing_events enable row level security;

-- Tenant members can SELECT their own history. No INSERT/UPDATE
-- policy for authenticated → RLS denies; only the webhook (service
-- role) writes.
create policy billing_events_tenant_select
  on public.billing_events
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

grant all on public.billing_events to service_role;

create policy billing_events_service_role_all
  on public.billing_events
  for all to service_role
  using (true) with check (true);

comment on policy billing_events_service_role_all on public.billing_events is
  'STORY-052 — Stripe webhook inserts events here via service-role JWT.';

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ 3. Helper functions — quota tier matrix                           ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Single source of truth for the pricing matrix. UI + repo wrappers +
-- Edge Functions all call these. Editing a tier limit = one SQL
-- migration; nothing in TS to update except the user-facing copy.
--
-- All functions are STABLE so per-row RLS evaluation caches the
-- result within a query. SECURITY DEFINER + search_path pin so they
-- work uniformly under anon, authenticated, and service_role.

create or replace function public.tenant_effective_plan(t_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(plan_override, plan)
    from public.tenants
   where id = t_id;
$$;

revoke all on function public.tenant_effective_plan(uuid) from public;
grant execute on function public.tenant_effective_plan(uuid)
  to anon, authenticated, service_role;

comment on function public.tenant_effective_plan(uuid) is
  'STORY-052 — resolves the active tier name for a tenant. Returns '
  'plan_override when present (lifetime / beta_unlimited), else plan '
  '(free / pro / business). NULL if the tenant id is unknown.';

-- Clients quota.
create or replace function public.tenant_quota_clients(t_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case public.tenant_effective_plan(t_id)
    when 'lifetime'        then 999999999
    when 'beta_unlimited'  then 999999999
    when 'business'        then 999999999
    when 'pro'             then 1000
    else 100
  end;
$$;
revoke all on function public.tenant_quota_clients(uuid) from public;
grant execute on function public.tenant_quota_clients(uuid)
  to anon, authenticated, service_role;

-- Appointments / month quota.
create or replace function public.tenant_quota_appointments_month(t_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case public.tenant_effective_plan(t_id)
    when 'lifetime'        then 999999999
    when 'beta_unlimited'  then 999999999
    when 'business'        then 999999999
    when 'pro'             then 999999999
    else 50
  end;
$$;
revoke all on function public.tenant_quota_appointments_month(uuid) from public;
grant execute on function public.tenant_quota_appointments_month(uuid)
  to anon, authenticated, service_role;

-- Team-members quota.
create or replace function public.tenant_quota_team_members(t_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case public.tenant_effective_plan(t_id)
    when 'lifetime'        then 999999999
    when 'beta_unlimited'  then 999999999
    when 'business'        then 999999999
    when 'pro'             then 5
    else 1
  end;
$$;
revoke all on function public.tenant_quota_team_members(uuid) from public;
grant execute on function public.tenant_quota_team_members(uuid)
  to anon, authenticated, service_role;

-- SMS / month quota.
-- Decision D1: keep tenant_sms_config.free_quota_per_month as a
-- per-tenant override. coalesce(override, tier_default).
-- Override is rare by design — support extensions, promo grants,
-- one-off debug overrides. Use sparingly.
--
-- BYOK tenants (mode='byok') have no platform quota; the tenant
-- pays Twilio directly. Return a giant number so the Edge Function's
-- gate is a no-op for them.
create or replace function public.tenant_quota_sms_month(t_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- Per-tenant override wins.
    (select c.free_quota_per_month
       from public.tenant_sms_config c
      where c.tenant_id = t_id),
    -- Else tier default.
    case public.tenant_effective_plan(t_id)
      when 'lifetime'        then 999999999
      when 'beta_unlimited'  then 999999999
      when 'business'        then 999999999  -- BYOK; quota irrelevant
      when 'pro'             then 200
      else 10
    end
  );
$$;
revoke all on function public.tenant_quota_sms_month(uuid) from public;
grant execute on function public.tenant_quota_sms_month(uuid)
  to anon, authenticated, service_role;

comment on function public.tenant_quota_sms_month(uuid) is
  'STORY-052 D1 — coalesce(tenant_sms_config.free_quota_per_month, '
  'tier_default). Override is rare; document any use.';

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║ 4. tenant_sms_config — flip free_quota_per_month to nullable      ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Pre-STORY-052, every row had `default 50` baked in. Now NULL means
-- "fall through to the plan tier default". Backfill ONLY the rows
-- that still hold the old default value (50) — leaves any
-- intentional manual overrides (rare by design) intact.

alter table public.tenant_sms_config
  alter column free_quota_per_month drop not null;

update public.tenant_sms_config
   set free_quota_per_month = null
 where free_quota_per_month = 50;

alter table public.tenant_sms_config
  alter column free_quota_per_month drop default;

comment on column public.tenant_sms_config.free_quota_per_month is
  'STORY-052 — NULL = use the plan tier default via '
  'tenant_quota_sms_month(). Non-null = per-tenant override; rare '
  'by design (support extensions, promo grants).';

-- Convenience: a single call returning all four quotas as a JSON
-- object so the Settings UI can fetch in one round-trip.
create or replace function public.tenant_quota_summary(t_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'plan',                public.tenant_effective_plan(t_id),
    'clients',             public.tenant_quota_clients(t_id),
    'appointments_month',  public.tenant_quota_appointments_month(t_id),
    'team_members',        public.tenant_quota_team_members(t_id),
    'sms_month',           public.tenant_quota_sms_month(t_id)
  );
$$;
revoke all on function public.tenant_quota_summary(uuid) from public;
grant execute on function public.tenant_quota_summary(uuid)
  to anon, authenticated, service_role;
