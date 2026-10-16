-- ─────────────────────────────────────────────────────────────────────
-- P0 #13 + #14 (CRM Core brief, SPRINT-CRM-CORE-2026-05) — payment
-- columns on appointments + finance_transactions ledger + auto-sync
-- trigger.
--
-- Background.
--   The brief insists money never silently disappears: every appointment
--   that ends as «completed AND paid» should land in the finance ledger
--   the next time the operator opens /finances. Until this migration
--   the ledger was computed at read time by useFinanceData scanning
--   appointments + day-extras. That works for one user; for multi-device
--   sync (STORY-042 already moved appointments to Supabase) we need a
--   real ledger table so reports + future Stripe payouts have a stable
--   source of truth.
--
-- What this migration ships.
--   1. payment_status / payment_method / paid_amount columns on
--      `appointments`, with a backfill from existing prepaid_amount +
--      total_amount math.
--   2. `finance_categories` reference table seeded with the brief's
--      default income + expense buckets (per-tenant, tenant_id NULL
--      means global).
--   3. `finance_transactions` ledger — type / amount / currency / refs
--      / payment_method / notes. UNIQUE(appointment_id, type) so the
--      trigger is idempotent under replay.
--   4. Trigger on appointments that fires when (status, payment_status)
--      cross into a (completed, paid) pair → inserts an income row.
--      Refund path: payment_status flips from 'paid' to 'refunded' OR
--      a paid appointment is cancelled → inserts a refund row.
--
-- Notes for follow-up stories.
--   • STORY-042's existing `payment` jsonb column is left in place;
--     the explicit columns above are read by the trigger because SQL
--     CHECK constraints on jsonb fields are clumsy.
--   • Per-master payroll (#30) reads finance_transactions.master_id
--     once that field is populated by the UI.
-- ─────────────────────────────────────────────────────────────────────

-- ─── 1. Payment columns on appointments ───────────────────────────────
alter table public.appointments
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','partial','paid','refunded')),
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('cash','card','transfer','other')),
  add column if not exists paid_amount numeric not null default 0;

-- Backfill: derive a sensible payment_status from existing
-- prepaid_amount + total_amount so reports stop showing every
-- pre-migration row as «unpaid». Conservative — partial when the
-- prepaid covers some but not all, paid only when it covers the
-- full total. Cancelled rows stay unpaid (refund handling is a
-- separate UX flow we don't want to claim retroactively).
update public.appointments
   set paid_amount = greatest(prepaid_amount, 0),
       payment_status = case
         when total_amount <= 0                                            then 'unpaid'
         when status = 'cancelled'                                         then 'unpaid'
         when prepaid_amount >= total_amount                               then 'paid'
         when prepaid_amount > 0 and prepaid_amount < total_amount         then 'partial'
         else 'unpaid'
       end
 where payment_status = 'unpaid';

-- ─── 2. finance_categories ────────────────────────────────────────────
create table if not exists public.finance_categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,
  slug        text not null,
  name        text not null,
  type        text not null check (type in ('income','expense')),
  icon        text,
  color       text,
  created_at  timestamptz not null default now(),
  unique (tenant_id, slug)
);

-- Seed global defaults (tenant_id IS NULL) — every tenant inherits
-- these unless they override the slug locally. Mirrors the brief's
-- §16 income tab + §11 expense defaults (the latter was already in
-- the UI but never had a DB home).
insert into public.finance_categories (tenant_id, slug, name, type, icon, color) values
  (null, 'services',   'Услуги',   'income',  '⚙',  '#10b981'),
  (null, 'goods',      'Товары',   'income',  '📦', '#3b82f6'),
  (null, 'tips',       'Чаевые',   'income',  '💰', '#f59e0b'),
  (null, 'refund',     'Возврат',  'income',  '↩',  '#ef4444'),
  (null, 'other_inc',  'Иное',     'income',  '📋', '#6b7280'),
  (null, 'fuel',       'Топливо',  'expense', '⛽', '#fb923c'),
  (null, 'food',       'Еда',      'expense', '🍔', '#facc15'),
  (null, 'supplies',   'Материалы','expense', '🧰', '#0ea5e9'),
  (null, 'salary',     'Зарплата', 'expense', '👤', '#a855f7'),
  (null, 'other_exp',  'Иное',     'expense', '📋', '#6b7280')
on conflict (tenant_id, slug) do nothing;

-- ─── 3. finance_transactions ledger ───────────────────────────────────
create table if not exists public.finance_transactions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  type            text not null check (type in ('income','expense','transfer','refund')),
  amount          numeric not null,
  currency        text not null default 'EUR',
  category_id     uuid references public.finance_categories(id) on delete set null,
  appointment_id  uuid references public.appointments(id) on delete set null,
  client_id       uuid references public.clients(id) on delete set null,
  team_id         text,
  master_id       text,
  payment_method  text check (payment_method is null or payment_method in ('cash','card','transfer','other')),
  notes           text,
  created_at      timestamptz not null default now(),
  -- Idempotency: re-running the auto-sync trigger for the same
  -- (appointment, type) collapses to no-op. Refunds get their own
  -- pair (appointment_id, 'refund') so they don't collide with the
  -- original income row.
  unique (appointment_id, type)
);

create index if not exists idx_finance_tx_tenant_date
  on public.finance_transactions(tenant_id, created_at desc);
create index if not exists idx_finance_tx_client
  on public.finance_transactions(client_id) where client_id is not null;

alter table public.finance_transactions enable row level security;

create policy finance_tx_all_own on public.finance_transactions for all
  to anon, authenticated
  using      (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ─── 4. Auto-sync trigger ─────────────────────────────────────────────
-- Fires on every appointments row update. Two paths:
--   • Income path: status goes to 'completed' AND payment_status is
--     'paid' (and it wasn't already, to avoid duplicates) → insert an
--     income row. ON CONFLICT keeps the trigger idempotent under
--     out-of-order replays.
--   • Refund path: payment_status flips from 'paid' to 'refunded',
--     OR a 'completed'+'paid' row is cancelled → insert a negative
--     refund row.
--
-- Service-category resolution: when finance_categories has a row
-- with slug='services' (seeded above) we use its id, else NULL.
-- We intentionally don't look up tenant-overridden slugs here to
-- keep the trigger SQL boring; a follow-up can swap in a SECURITY
-- DEFINER function that prefers the tenant's overrides.

create or replace function public.sync_appointment_finance()
returns trigger language plpgsql as $$
declare
  cat_id uuid;
begin
  -- INCOME path
  if NEW.status = 'completed' and NEW.payment_status = 'paid'
     and (OLD.status is distinct from 'completed' or OLD.payment_status is distinct from 'paid') then
    select id into cat_id from public.finance_categories
      where slug = 'services' and (tenant_id is null or tenant_id = NEW.tenant_id)
      order by tenant_id nulls last limit 1;
    insert into public.finance_transactions
      (tenant_id, type, amount, category_id, appointment_id, client_id, team_id, master_id, payment_method)
    values
      (NEW.tenant_id, 'income', NEW.total_amount, cat_id, NEW.id, NEW.client_id,
       NEW.team_id, NEW.master_id, NEW.payment_method)
    on conflict (appointment_id, type) do nothing;
  end if;

  -- REFUND path
  if (OLD.payment_status = 'paid' and NEW.payment_status = 'refunded')
     or (OLD.status = 'completed' and NEW.status = 'cancelled' and OLD.payment_status = 'paid') then
    select id into cat_id from public.finance_categories
      where slug = 'refund' and (tenant_id is null or tenant_id = NEW.tenant_id)
      order by tenant_id nulls last limit 1;
    insert into public.finance_transactions
      (tenant_id, type, amount, category_id, appointment_id, client_id, team_id, master_id, payment_method, notes)
    values
      (NEW.tenant_id, 'refund', -coalesce(NEW.total_amount, 0), cat_id, NEW.id, NEW.client_id,
       NEW.team_id, NEW.master_id, NEW.payment_method, 'Возврат по записи')
    on conflict (appointment_id, type) do nothing;
  end if;

  return NEW;
end;
$$;

drop trigger if exists appointments_finance_sync on public.appointments;
create trigger appointments_finance_sync
  after update on public.appointments
  for each row execute function public.sync_appointment_finance();

-- INSERT path: a row created already as completed+paid (rare but
-- possible from a batch import) should also book. Same function,
-- different fork via a thin shim — INSERT trigger fires with OLD
-- as NULL so the function above guards against the null-tolerant
-- IS DISTINCT FROM correctly.
create or replace function public.sync_appointment_finance_insert()
returns trigger language plpgsql as $$
declare
  cat_id uuid;
begin
  if NEW.status = 'completed' and NEW.payment_status = 'paid' then
    select id into cat_id from public.finance_categories
      where slug = 'services' and (tenant_id is null or tenant_id = NEW.tenant_id)
      order by tenant_id nulls last limit 1;
    insert into public.finance_transactions
      (tenant_id, type, amount, category_id, appointment_id, client_id, team_id, master_id, payment_method)
    values
      (NEW.tenant_id, 'income', NEW.total_amount, cat_id, NEW.id, NEW.client_id,
       NEW.team_id, NEW.master_id, NEW.payment_method)
    on conflict (appointment_id, type) do nothing;
  end if;
  return NEW;
end;
$$;

drop trigger if exists appointments_finance_sync_insert on public.appointments;
create trigger appointments_finance_sync_insert
  after insert on public.appointments
  for each row execute function public.sync_appointment_finance_insert();
