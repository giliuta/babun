-- Finance redesign — Phase A (foundation)
--
-- See /root/.claude/plans/story-moonlit-biscuit.md for the full design.
-- This migration creates the per-brigade `accounts` ledger, extends
-- `finance_transactions` with the day/account/transfer/invoice/refund
-- fields the new /finances UI needs, adds `invoices` (+ lines) and
-- `finance_templates`, extends `tenants` with the company details
-- needed on a PDF invoice, creates the `invoices` + `tenant-assets`
-- storage buckets, backfills accounts for existing brigades, and
-- upgrades the `sync_appointment_finance` trigger to populate the
-- new `occurred_on` + `account_id` + `source='auto'` fields.

-- ─── 1. accounts ──────────────────────────────────────────────────────
create table if not exists public.accounts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  brigade_id      text not null,
  name            text not null,
  kind            text not null check (kind in ('cash','card','bank','other')),
  owner_master_id text,
  opening_balance numeric(12,2) not null default 0,
  icon            text,
  color           text,
  position        int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  unique (tenant_id, brigade_id, name)
);

create index if not exists idx_accounts_tenant_brigade
  on public.accounts(tenant_id, brigade_id)
  where is_active = true;

alter table public.accounts enable row level security;

create policy accounts_tenant_all on public.accounts
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- ─── 2. ALTER finance_transactions ─────────────────────────────────────
alter table public.finance_transactions
  add column if not exists account_id        uuid references public.accounts(id) on delete set null,
  add column if not exists occurred_on       date,
  add column if not exists receipt_url       text,
  add column if not exists transfer_group_id uuid,
  add column if not exists invoice_id        uuid,
  add column if not exists refund_of_id      uuid references public.finance_transactions(id) on delete set null,
  add column if not exists created_by        uuid references auth.users(id),
  add column if not exists updated_at        timestamptz not null default now(),
  add column if not exists source            text not null default 'manual' check (source in ('auto','manual'));

-- Backfill occurred_on (must run before SET NOT NULL).
update public.finance_transactions ft
   set occurred_on = coalesce(a.date::date, ft.created_at::date)
  from public.appointments a
 where ft.appointment_id = a.id
   and ft.occurred_on is null;

update public.finance_transactions
   set occurred_on = created_at::date
 where occurred_on is null;

alter table public.finance_transactions
  alter column occurred_on set not null,
  alter column occurred_on set default current_date;

-- Existing rows tied to an appointment were all trigger-created (no
-- manual path existed before this migration). Mark them auto so the
-- partial unique below applies retroactively.
update public.finance_transactions
   set source = 'auto'
 where appointment_id is not null and source = 'manual';

-- Replace the legacy total unique(appointment_id, type) with a partial
-- one scoped to source='auto'. Manual income/refund tx on the same
-- appointment are now allowed.
do $$
declare con_name text;
begin
  select conname into con_name
    from pg_constraint
   where conrelid = 'public.finance_transactions'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) ilike '%(appointment_id, type)%';
  if con_name is not null then
    execute format('alter table public.finance_transactions drop constraint %I', con_name);
  end if;
end $$;

create unique index if not exists ux_finance_tx_auto_appointment
  on public.finance_transactions(appointment_id, type)
  where source = 'auto' and appointment_id is not null;

create index if not exists idx_finance_tx_tenant_occurred
  on public.finance_transactions(tenant_id, occurred_on desc);
create index if not exists idx_finance_tx_account
  on public.finance_transactions(account_id) where account_id is not null;
create index if not exists idx_finance_tx_transfer_group
  on public.finance_transactions(transfer_group_id) where transfer_group_id is not null;
create index if not exists idx_finance_tx_invoice
  on public.finance_transactions(invoice_id) where invoice_id is not null;

create trigger finance_tx_set_updated_at
  before update on public.finance_transactions
  for each row execute function public.set_updated_at();

-- ─── 3. invoices + invoice_lines ──────────────────────────────────────
create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  number          text not null,
  year            int not null,
  seq             int not null,
  issued_on       date not null default current_date,
  due_on          date,
  client_id       uuid references public.clients(id) on delete set null,
  appointment_id  uuid references public.appointments(id) on delete set null,
  brigade_id      text,
  subtotal_net    numeric(12,2) not null,
  vat_percent     numeric(5,2) not null default 19,
  vat_amount      numeric(12,2) not null,
  total           numeric(12,2) not null,
  currency        text not null default 'EUR',
  status          text not null check (status in ('issued','paid','void')) default 'issued',
  pdf_url         text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  unique (tenant_id, year, seq)
);

create index if not exists idx_invoices_tenant_year
  on public.invoices(tenant_id, year desc, seq desc);
create index if not exists idx_invoices_client
  on public.invoices(client_id) where client_id is not null;
create index if not exists idx_invoices_appointment
  on public.invoices(appointment_id) where appointment_id is not null;

alter table public.invoices enable row level security;

create policy invoices_tenant_all on public.invoices
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- Wire the FK now that the target table exists.
alter table public.finance_transactions
  add constraint finance_tx_invoice_fkey
  foreign key (invoice_id) references public.invoices(id) on delete set null;

create table if not exists public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  position    int not null default 0,
  title       text not null,
  qty         numeric(10,3) not null default 1,
  unit_price  numeric(12,2) not null,
  total       numeric(12,2) not null
);

create index if not exists idx_invoice_lines_invoice
  on public.invoice_lines(invoice_id);

alter table public.invoice_lines enable row level security;

create policy invoice_lines_via_invoice on public.invoice_lines
  for all
  using (
    invoice_id in (select id from public.invoices where tenant_id = public.current_tenant_id())
  )
  with check (
    invoice_id in (select id from public.invoices where tenant_id = public.current_tenant_id())
  );

-- ─── 4. finance_templates ─────────────────────────────────────────────
create table if not exists public.finance_templates (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null,
  kind            text not null check (kind in ('income','expense')),
  amount          numeric(12,2) not null,
  account_id      uuid references public.accounts(id) on delete set null,
  category_id     uuid references public.finance_categories(id) on delete set null,
  brigade_id      text,
  master_id       text,
  payment_method  text,
  position        int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_finance_templates_tenant
  on public.finance_templates(tenant_id)
  where is_active = true;

alter table public.finance_templates enable row level security;

create policy finance_templates_tenant_all on public.finance_templates
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create trigger finance_templates_set_updated_at
  before update on public.finance_templates
  for each row execute function public.set_updated_at();

-- ─── 5. ALTER tenants — company details for PDF invoices ──────────────
alter table public.tenants
  add column if not exists legal_name     text,
  add column if not exists vat_number     text,
  add column if not exists address        text,
  add column if not exists iban           text,
  add column if not exists bank_name      text,
  add column if not exists logo_url       text,
  add column if not exists contact_email  text,
  add column if not exists contact_phone  text,
  add column if not exists invoice_prefix text not null default 'INV';

-- ─── 6. Storage buckets ───────────────────────────────────────────────
insert into storage.buckets (id, name, public) values
  ('invoices',      'invoices',      false),
  ('tenant-assets', 'tenant-assets', false)
on conflict (id) do nothing;

-- ─── 7. Backfill accounts ─────────────────────────────────────────────
-- One «Наличка» per (tenant, brigade) that has any historical work.
insert into public.accounts (tenant_id, brigade_id, name, kind, opening_balance, icon)
select distinct
  a.tenant_id,
  a.team_id,
  'Наличка',
  'cash',
  0,
  '💵'
from public.appointments a
where a.team_id is not null
  and a.team_id <> ''
on conflict (tenant_id, brigade_id, name) do nothing;

-- Backfill finance_transactions.account_id from the matching cash
-- account (best-effort: by tenant + brigade).
update public.finance_transactions ft
   set account_id = a.id
  from public.accounts a
 where ft.team_id = a.brigade_id
   and ft.tenant_id = a.tenant_id
   and a.name = 'Наличка'
   and ft.account_id is null;

-- ─── 8. UPDATE sync_appointment_finance trigger ───────────────────────
-- Now writes occurred_on (from the appointment's date), account_id (the
-- brigade's default Наличка), and source='auto' so the partial unique
-- discriminates auto vs manual rows on the same appointment.
create or replace function public.sync_appointment_finance()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  cat_id uuid;
  acc_id uuid;
begin
  if NEW.status = 'completed' and NEW.payment_status = 'paid'
     and (OLD.status is distinct from 'completed' or OLD.payment_status is distinct from 'paid') then

    select id into cat_id from public.finance_categories
      where slug = 'services' and (tenant_id is null or tenant_id = NEW.tenant_id)
      order by tenant_id nulls last limit 1;

    select id into acc_id from public.accounts
      where tenant_id = NEW.tenant_id
        and brigade_id = NEW.team_id
        and name = 'Наличка'
        and is_active = true
      limit 1;

    insert into public.finance_transactions
      (tenant_id, type, amount, category_id, account_id, appointment_id, client_id,
       team_id, master_id, payment_method, occurred_on, source)
    values
      (NEW.tenant_id, 'income', NEW.total_amount, cat_id, acc_id, NEW.id, NEW.client_id,
       NEW.team_id, NEW.master_id, NEW.payment_method, NEW.date::date, 'auto')
    on conflict (appointment_id, type)
      where source = 'auto' and appointment_id is not null
      do nothing;
  end if;

  if (OLD.payment_status = 'paid' and NEW.payment_status = 'refunded')
     or (OLD.status = 'completed' and NEW.status = 'cancelled' and OLD.payment_status = 'paid') then

    select id into cat_id from public.finance_categories
      where slug = 'refund' and (tenant_id is null or tenant_id = NEW.tenant_id)
      order by tenant_id nulls last limit 1;

    select id into acc_id from public.accounts
      where tenant_id = NEW.tenant_id
        and brigade_id = NEW.team_id
        and name = 'Наличка'
        and is_active = true
      limit 1;

    insert into public.finance_transactions
      (tenant_id, type, amount, category_id, account_id, appointment_id, client_id,
       team_id, master_id, payment_method, occurred_on, source, notes)
    values
      (NEW.tenant_id, 'refund', -coalesce(NEW.total_amount, 0), cat_id, acc_id, NEW.id, NEW.client_id,
       NEW.team_id, NEW.master_id, NEW.payment_method, NEW.date::date, 'auto', 'Возврат по записи')
    on conflict (appointment_id, type)
      where source = 'auto' and appointment_id is not null
      do nothing;
  end if;

  return NEW;
end;
$function$;
