-- НДС: настройка компании, переопределение на команду, налог на операциях.
--
-- Владелец 2026-08-09: «если оплачено 400 и плюс НДС — это 480; 400 моё, а
-- 80 отдельно; то же в расходах; считать наперёд». На счёт падает ВАЛОВАЯ
-- сумма, но налог внутри неё нужно видеть отдельно — иначе прибыль завышена
-- на чужие деньги, и в конце квартала выясняется, что часть «заработанного»
-- надо отдать.
--
-- Режим (`inclusive` / `exclusive`) описывает, как НАЗНАЧАЮТ ЦЕНУ: включён ли
-- налог в прайс или добавляется сверху. На саму проводку это не влияет — в
-- кассу в обоих случаях приходит валовая сумма, а налог из неё ИЗВЛЕКАЕТСЯ
-- одной формулой gross × rate / (100 + rate). Поэтому у транзакции хранится
-- не режим, а факт: ставка и сумма налога снимком.

alter table public.tenants
  add column if not exists vat_mode text not null default 'off',
  add column if not exists vat_rate numeric not null default 0,
  add column if not exists vat_exemption_note text,
  add column if not exists document_language text not null default 'en';

alter table public.tenants drop constraint if exists tenants_vat_mode_check;
alter table public.tenants add constraint tenants_vat_mode_check
  check (vat_mode in ('off', 'inclusive', 'exclusive'));
alter table public.tenants drop constraint if exists tenants_vat_rate_check;
alter table public.tenants add constraint tenants_vat_rate_check
  check (vat_rate >= 0 and vat_rate < 100);

-- Команды работают в разных странах: Кипр 19, Греция 24 одновременно.
create table if not exists public.team_finance_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  team_id text not null,
  vat_mode text,
  vat_rate numeric,
  vat_exemption_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, team_id),
  constraint team_vat_mode_check
    check (vat_mode is null or vat_mode in ('off', 'inclusive', 'exclusive')),
  constraint team_vat_rate_check
    check (vat_rate is null or (vat_rate >= 0 and vat_rate < 100))
);

alter table public.team_finance_settings enable row level security;

drop policy if exists team_finance_settings_owner on public.team_finance_settings;
create policy team_finance_settings_owner on public.team_finance_settings
  for all
  using (tenant_id = public.current_tenant_id() and public.current_user_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_user_role() = 'owner');

-- Налог на проводке: ставка и сумма СНИМКОМ. NULL у операций, созданных до
-- включения НДС, — это «налога не было», а не «ноль по ставке 0».
alter table public.finance_transactions
  add column if not exists vat_rate numeric,
  add column if not exists vat_amount numeric;

comment on column public.finance_transactions.vat_amount is
  'Налог внутри суммы операции (валовая сумма × ставка / (100 + ставка)). NULL — операция без НДС.';

-- Действующие настройки для команды: своё, иначе компанейское. Одна функция
-- на весь продукт — иначе «какая ставка у этой бригады» получит три разных
-- ответа в трёх местах.
create or replace function public.effective_vat_settings(p_team_id text)
returns table (vat_mode text, vat_rate numeric, vat_exemption_note text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    coalesce(s.vat_mode, t.vat_mode) as vat_mode,
    coalesce(s.vat_rate, t.vat_rate) as vat_rate,
    coalesce(s.vat_exemption_note, t.vat_exemption_note) as vat_exemption_note
  from public.tenants t
  left join public.team_finance_settings s
    on s.tenant_id = t.id
   and s.team_id = p_team_id
  where t.id = public.current_tenant_id();
$$;

-- Налог считается ОДИН РАЗ, в момент проводки, и замораживается в строке.
-- Считать его на лету по текущей ставке нельзя: подняли ставку с 19 на 21 —
-- и вся прошлогодняя отчётность бесшумно переписалась бы.
create or replace function public.fill_transaction_vat()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  mode text;
  rate numeric;
begin
  -- Явно переданный снимок уважаем: инвойс печатает свою ставку.
  if new.vat_amount is not null then
    return new;
  end if;

  select coalesce(s.vat_mode, t.vat_mode), coalesce(s.vat_rate, t.vat_rate)
    into mode, rate
    from public.tenants t
    left join public.team_finance_settings s
      on s.tenant_id = t.id and s.team_id = new.team_id
   where t.id = new.tenant_id;

  if mode is null or mode = 'off' or coalesce(rate, 0) <= 0 then
    return new;
  end if;

  new.vat_rate := rate;
  -- Из ВАЛОВОЙ суммы: в кассу пришло 480, налог внутри — 80.
  -- Знак сохраняем (возврат уносит и налог).
  new.vat_amount := round(new.amount * rate / (100 + rate), 2);
  return new;
end;
$$;

drop trigger if exists trg_fill_transaction_vat on public.finance_transactions;
create trigger trg_fill_transaction_vat
  before insert on public.finance_transactions
  for each row execute function public.fill_transaction_vat();
