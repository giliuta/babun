-- Financial integrity: immutable appointment ledger, atomic payment undo,
-- The 14-digit prefix is a unique Supabase CLI migration version.
-- account closure guards and idempotent two-leg transfers.

-- A closed, transaction-scoped capability table lets SECURITY DEFINER
-- functions author protected rows without a spoofable session GUC. API roles
-- have no privileges and no RLS policy on this table.
create table if not exists public._finance_write_context (
  transaction_id bigint not null,
  kind text not null check (
    kind in (
      'appointment_auto', 'appointment_undo', 'appointment_prepayment',
      'appointment_payment_reset', 'transfer_write'
    )
  ),
  entity_id uuid not null,
  tenant_id uuid not null,
  primary key (transaction_id, kind, entity_id)
);
alter table public._finance_write_context enable row level security;
revoke all on table public._finance_write_context from public, anon, authenticated;

-- Money uses the tenant's business date, never the database session date.
-- _009 reuses this helper for day closures; defining it here is necessary
-- because the prepayment backfill below executes before later migrations.
create or replace function public.tenant_business_date(p_tenant_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  tenant_timezone text;
begin
  select settings.timezone into tenant_timezone
    from public.calendar_settings settings
   where settings.tenant_id = p_tenant_id;
  tenant_timezone := coalesce(nullif(btrim(tenant_timezone), ''), 'Europe/Nicosia');
  begin
    return (current_timestamp at time zone tenant_timezone)::date;
  exception when invalid_parameter_value then
    return (current_timestamp at time zone 'Europe/Nicosia')::date;
  end;
end;
$function$;
revoke all on function public.tenant_business_date(uuid)
  from public, anon, authenticated;

-- A durable request row is both the idempotency record and the tombstone that
-- prevents a cancelled transfer from being recreated by a delayed retry.
create table if not exists public.finance_transfer_requests (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_account_id uuid not null,
  to_account_id uuid not null,
  team_id text not null,
  amount numeric(12,2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  occurred_on date not null,
  notes text,
  status text not null default 'active' check (status in ('active', 'deleted')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  check (from_account_id <> to_account_id)
);
create index if not exists idx_finance_transfer_requests_tenant
  on public.finance_transfer_requests(tenant_id, occurred_on desc);
alter table public.finance_transfer_requests enable row level security;
drop policy if exists finance_transfer_requests_owner_select
  on public.finance_transfer_requests;
create policy finance_transfer_requests_owner_select
  on public.finance_transfer_requests for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );
revoke all on table public.finance_transfer_requests from public, anon, authenticated;
grant select on table public.finance_transfer_requests to authenticated;

-- Preserve well-formed legacy transfers as active idempotency records. Broken
-- one-leg groups deliberately stay unregistered and fail closed in delete RPC.
insert into public.finance_transfer_requests (
  id, tenant_id, from_account_id, to_account_id, team_id, amount,
  occurred_on, notes, status, created_at, created_by
)
select
  transfer_group_id,
  (array_agg(tenant_id))[1],
  (array_agg(account_id) filter (where amount < 0))[1],
  (array_agg(account_id) filter (where amount > 0))[1],
  min(team_id),
  max(abs(amount)),
  min(occurred_on),
  min(notes),
  'active',
  min(created_at),
  (array_agg(created_by) filter (where created_by is not null))[1]
from public.finance_transactions
where type = 'transfer' and transfer_group_id is not null
group by transfer_group_id
having count(*) = 2
   and count(*) filter (where amount < 0) = 1
   and count(*) filter (where amount > 0) = 1
   and count(distinct tenant_id) = 1
   and count(distinct account_id) = 2
   and count(distinct team_id) = 1
   and count(team_id) = 2
   and min(team_id) is not null
   and max(abs(amount)) = min(abs(amount))
   and count(distinct occurred_on) = 1
   and count(distinct coalesce(notes, '')) = 1
on conflict (id) do nothing;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.accounts'::regclass
       and conname = 'accounts_opening_balance_finite'
  ) then
    alter table public.accounts
      add constraint accounts_opening_balance_finite
      check (opening_balance <> 'NaN'::numeric) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_transactions'::regclass
       and conname = 'finance_transactions_amount_finite'
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_amount_finite
      check (amount <> 'NaN'::numeric) not valid;
  end if;
end;
$constraints$;
alter table public.accounts validate constraint accounts_opening_balance_finite;
alter table public.finance_transactions validate constraint finance_transactions_amount_finite;

-- Appointment receipts are event rows. A booking can receive a prepayment,
-- another prepayment later, and a final settlement without rewriting money
-- already recorded. NULL remains the marker for legacy aggregate auto rows.
alter table public.finance_transactions
  add column if not exists appointment_payment_kind text;
do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_transactions'::regclass
       and conname = 'finance_transactions_appointment_payment_kind_check'
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_appointment_payment_kind_check
      check (
        appointment_payment_kind is null
        or appointment_payment_kind in ('prepayment', 'settlement')
      ) not valid;
  end if;
end;
$constraints$;
alter table public.finance_transactions
  validate constraint finance_transactions_appointment_payment_kind_check;

-- The former partial unique index allowed only one income and one refund per
-- appointment. Real payment history needs one immutable row per receipt and
-- potentially several linked refund rows.
drop index if exists public.ux_finance_tx_auto_appointment;
drop index if exists public.ux_finance_tx_appointment_type;
create index if not exists idx_finance_tx_appointment_payment_kind
  on public.finance_transactions(appointment_id, appointment_payment_kind, created_at)
  where source = 'auto' and appointment_id is not null;

create or replace function public.assert_finance_transaction_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  account_row public.accounts%rowtype;
  old_account public.accounts%rowtype;
  appointment_row public.appointments%rowtype;
  original_income public.finance_transactions%rowtype;
  context_ok boolean := false;
  allow_auto_invoice_link boolean := false;
  expected_account_kind text;
  expected_category_type text;
  already_refunded numeric := 0;
begin
  -- Company deletion must be able to cascade through immutable history.
  if tg_op in ('UPDATE', 'DELETE')
     and not exists (select 1 from public.tenants where id = old.tenant_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' and new.source = 'auto' then
    select exists (
      select 1 from public._finance_write_context
       where transaction_id = txid_current()
         and kind = 'appointment_auto'
         and entity_id = new.appointment_id
         and tenant_id = new.tenant_id
    ) into context_ok;
    if not context_ok or new.appointment_id is null then
      raise exception 'Автоматическую операцию может создать только заявка';
    end if;
    if new.appointment_payment_kind is null then
      raise exception 'Не определён этап оплаты заявки';
    end if;
  elsif tg_op = 'INSERT' and new.appointment_payment_kind is not null then
    raise exception 'Этап оплаты доступен только автоматической операции заявки';
  end if;

  if tg_op = 'INSERT' and new.type = 'transfer' then
    select exists (
      select 1 from public._finance_write_context
       where transaction_id = txid_current()
         and kind = 'transfer_write'
         and entity_id = new.transfer_group_id
         and tenant_id = new.tenant_id
    ) into context_ok;
    if not context_ok or new.transfer_group_id is null then
      raise exception 'Перевод можно создать только целиком через форму перевода';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.source = 'auto' or new.source = 'auto' then
      -- issue_invoice() may attach an existing appointment income to a legal
      -- invoice. This is the only non-economic auto-row update. The following
      -- _005 trigger validates target invoice, tenant, sum and absence of
      -- payments/refunds; every other field must remain byte-for-byte equal.
      allow_auto_invoice_link := old.source = 'auto'
        and new.source = 'auto'
        and old.invoice_id is null
        and new.invoice_id is not null
        and row(
          new.id, new.tenant_id, new.type, new.amount, new.currency,
          new.category_id, new.account_id, new.appointment_id, new.client_id,
          new.team_id, new.master_id, new.payment_method, new.notes,
          new.occurred_on, new.receipt_url, new.transfer_group_id,
          new.refund_of_id, new.source, new.appointment_payment_kind,
          new.created_at, new.created_by
        ) is not distinct from row(
          old.id, old.tenant_id, old.type, old.amount, old.currency,
          old.category_id, old.account_id, old.appointment_id, old.client_id,
          old.team_id, old.master_id, old.payment_method, old.notes,
          old.occurred_on, old.receipt_url, old.transfer_group_id,
          old.refund_of_id, old.source, old.appointment_payment_kind,
          old.created_at, old.created_by
        );
      if allow_auto_invoice_link then return new; end if;
      raise exception 'Автоматическую операцию нельзя редактировать; измените связанную заявку';
    end if;
    if old.type = 'transfer' or new.type = 'transfer' then
      raise exception 'Перевод нельзя редактировать; отмените его целиком';
    end if;
    if new.id is distinct from old.id
       or new.tenant_id is distinct from old.tenant_id
       or new.type is distinct from old.type
       or new.source is distinct from old.source
       or new.transfer_group_id is distinct from old.transfer_group_id
       or new.refund_of_id is distinct from old.refund_of_id
       or new.appointment_payment_kind is distinct from old.appointment_payment_kind
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'Системные поля финансовой операции нельзя изменять';
    end if;
  end if;

  if tg_op = 'DELETE' and old.source = 'auto' then
    select exists (
      select 1 from public._finance_write_context
       where transaction_id = txid_current()
         and kind = 'appointment_undo'
         and entity_id = old.appointment_id
         and tenant_id = old.tenant_id
    ) into context_ok;
    if not context_ok or old.appointment_id is null then
      raise exception 'Автоматическую операцию нельзя удалить; отмените оплату в заявке';
    end if;
  end if;

  if tg_op = 'DELETE' and old.type = 'transfer' then
    select exists (
      select 1 from public._finance_write_context
       where transaction_id = txid_current()
         and kind = 'transfer_write'
         and entity_id = old.transfer_group_id
         and tenant_id = old.tenant_id
    ) into context_ok;
    if not context_ok or old.transfer_group_id is null then
      raise exception 'Нельзя удалить одну часть перевода; отмените перевод целиком';
    end if;
  end if;

  -- Deleting or moving money out of a closed account would silently make its
  -- supposedly final balance non-zero.
  if tg_op in ('UPDATE', 'DELETE') and old.account_id is not null then
    select * into old_account from public.accounts where id = old.account_id for share;
    if found and not old_account.is_active then
      raise exception 'Сначала снова откройте финансовый счёт';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    if new.account_id is null then
      raise exception 'Выберите финансовый счёт';
    end if;
    select * into account_row
      from public.accounts
     where id = new.account_id
     for share;
    if not found or account_row.tenant_id <> new.tenant_id then
      raise exception 'Финансовый счёт не найден в этой компании';
    end if;
    if not account_row.is_active then
      raise exception 'Финансовый счёт закрыт';
    end if;
    if new.team_id is null then
      new.team_id := account_row.brigade_id;
    elsif new.team_id <> account_row.brigade_id then
      raise exception 'Финансовый счёт относится к другой команде';
    end if;
    if not exists (
      select 1 from public.teams
       where id = new.team_id and tenant_id = new.tenant_id
    ) then
      raise exception 'Команда финансовой операции не найдена';
    end if;

    -- A refund is not a free-standing negative row: it is a contra-income
    -- tied to one locked original. Copy nullable context from that original
    -- before validating the appointment and payment route below.
    if new.type = 'refund' then
      if new.refund_of_id is null then
        raise exception 'Выберите исходный доход для возврата';
      end if;
      select * into original_income
        from public.finance_transactions
       where id = new.refund_of_id
         and tenant_id = new.tenant_id
         and type = 'income'
       for update;
      if not found then
        raise exception 'Исходный доход для возврата не найден';
      end if;
      if original_income.source = 'auto' and new.source <> 'auto' then
        raise exception 'Возврат автоматической оплаты оформляется в связанной заявке';
      end if;
      if new.account_id is distinct from original_income.account_id
         or new.team_id is distinct from original_income.team_id then
        raise exception 'Возврат должен пройти по исходному счёту и команде';
      end if;
      if new.appointment_id is null then
        new.appointment_id := original_income.appointment_id;
      elsif new.appointment_id is distinct from original_income.appointment_id then
        raise exception 'Заявка возврата не совпадает с исходным доходом';
      end if;
      if new.client_id is null then
        new.client_id := original_income.client_id;
      elsif new.client_id is distinct from original_income.client_id then
        raise exception 'Клиент возврата не совпадает с исходным доходом';
      end if;
      if new.master_id is null then
        new.master_id := original_income.master_id;
      elsif new.master_id is distinct from original_income.master_id then
        raise exception 'Исполнитель возврата не совпадает с исходным доходом';
      end if;
      if new.payment_method is null then
        new.payment_method := original_income.payment_method;
      elsif new.payment_method is distinct from original_income.payment_method then
        raise exception 'Возврат должен использовать способ исходного платежа';
      end if;
      if new.invoice_id is null then
        new.invoice_id := original_income.invoice_id;
      elsif new.invoice_id is distinct from original_income.invoice_id then
        raise exception 'Возврат относится к другому инвойсу';
      end if;
      new.currency := original_income.currency;
      if new.source = 'auto'
         and new.appointment_payment_kind is distinct from coalesce(
           original_income.appointment_payment_kind,
           'settlement'
         ) then
        raise exception 'Этап возврата не совпадает с исходным платежом';
      end if;

      select coalesce(sum(abs(refund.amount)), 0)
        into already_refunded
        from public.finance_transactions refund
       where refund.refund_of_id = original_income.id
         and refund.type = 'refund'
         and refund.id is distinct from new.id;
      if already_refunded + abs(new.amount) > greatest(original_income.amount, 0) then
        raise exception 'Возврат превышает остаток исходного дохода';
      end if;
    elsif new.refund_of_id is not null then
      raise exception 'Исходный доход указан не для возврата';
    end if;

    if new.type = 'transfer' then
      if new.payment_method is not null then
        raise exception 'У перевода между счетами не бывает способа оплаты';
      end if;
    else
      if new.payment_method is null
         or new.payment_method not in ('cash', 'card', 'transfer', 'other') then
        raise exception 'Выберите способ оплаты';
      end if;
      expected_account_kind := case new.payment_method
        when 'cash' then 'cash'
        when 'card' then 'card'
        when 'transfer' then 'bank'
        when 'other' then 'other'
      end;
      if account_row.kind is distinct from expected_account_kind then
        raise exception 'Способ оплаты не соответствует выбранному счёту';
      end if;
    end if;

    if new.appointment_id is not null then
      select * into appointment_row
        from public.appointments appointment
       where appointment.id = new.appointment_id
         and appointment.tenant_id = new.tenant_id
       for share;
      if not found then
        raise exception 'Заявка финансовой операции не найдена';
      end if;
      if appointment_row.team_id is distinct from new.team_id then
        raise exception 'Заявка относится к другой команде';
      end if;
      if new.client_id is null then
        new.client_id := appointment_row.client_id;
      elsif new.client_id is distinct from appointment_row.client_id then
        raise exception 'Клиент финансовой операции не совпадает с заявкой';
      end if;
      if new.master_id is null then
        new.master_id := appointment_row.master_id;
      elsif new.master_id is distinct from appointment_row.master_id then
        raise exception 'Исполнитель финансовой операции не совпадает с заявкой';
      end if;
    end if;

    if new.client_id is not null and not exists (
      select 1 from public.clients
       where id = new.client_id and tenant_id = new.tenant_id
    ) then
      raise exception 'Клиент финансовой операции не найден';
    end if;
    if new.master_id is not null and not exists (
      select 1
        from public.masters master
        join public.teams team
          on team.id = new.team_id and team.tenant_id = new.tenant_id
       where master.id = new.master_id
         and master.tenant_id = new.tenant_id
         and (
           master.team_id = new.team_id
           or team.lead_id = master.id
           or coalesce(team.lead_ids, '[]'::jsonb) ? master.id
           or coalesce(team.helper_ids, '[]'::jsonb) ? master.id
           or exists (
             select 1
               from jsonb_array_elements(
                 case
                   when jsonb_typeof(team.members) = 'array' then team.members
                   else '[]'::jsonb
                 end
               ) member
              where case jsonb_typeof(member)
                when 'string' then member #>> '{}'
                when 'object' then coalesce(member ->> 'master_id', member ->> 'id')
                else null
              end = master.id
           )
           -- Historical attribution remains valid if the master was moved to
           -- another team after this authoritative appointment was created.
           or (
             appointment_row.id is not null
             and appointment_row.team_id = new.team_id
             and appointment_row.master_id = master.id
           )
         )
    ) then
      raise exception 'Исполнитель не входит в команду финансовой операции';
    end if;

    if new.type = 'transfer' then
      if new.category_id is not null then
        raise exception 'Переводу между счетами категория не нужна';
      end if;
    elsif new.category_id is not null then
      expected_category_type := case
        when new.type in ('income', 'refund') then 'income'
        when new.type = 'expense' then 'expense'
      end;
      if not exists (
        select 1 from public.finance_categories category
         where category.id = new.category_id
           and (category.tenant_id is null or category.tenant_id = new.tenant_id)
           and category.type = expected_category_type
      ) then
        raise exception 'Категория не соответствует виду финансовой операции';
      end if;
    end if;
    if new.amount = 'NaN'::numeric then
      raise exception 'Сумма операции некорректна';
    end if;
    if new.type in ('income', 'expense') and new.amount <= 0 then
      raise exception 'Сумма операции должна быть больше нуля';
    end if;
    if new.type = 'refund' and new.amount >= 0 then
      raise exception 'Возврат должен уменьшать остаток счёта';
    end if;
    if new.type <> 'transfer' and new.transfer_group_id is not null then
      raise exception 'Группа перевода указана для обычной операции';
    end if;
    if tg_op = 'INSERT' and new.created_by is null then
      new.created_by := auth.uid();
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists trg_assert_finance_transaction_integrity
  on public.finance_transactions;
create trigger trg_assert_finance_transaction_integrity
before insert or update or delete on public.finance_transactions
for each row execute function public.assert_finance_transaction_integrity();
revoke all on function public.assert_finance_transaction_integrity()
  from public, anon, authenticated;

-- Templates are future ledger writes, so they obey the same account routing
-- and category semantics before they can be surfaced as one-tap actions.
create or replace function public.assert_finance_template_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  template_account public.accounts%rowtype;
  expected_kind text;
  expected_category_type text;
begin
  if tg_op = 'UPDATE'
     and not exists (select 1 from public.tenants where id = old.tenant_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
  ) then
    raise exception 'Компания и идентификатор шаблона неизменяемы';
  end if;
  if btrim(coalesce(new.name, '')) = '' then
    raise exception 'Укажите название шаблона';
  end if;
  if new.amount is null or new.amount = 'NaN'::numeric or new.amount <= 0 then
    raise exception 'Сумма шаблона должна быть больше нуля';
  end if;
  if new.kind not in ('income', 'expense') then
    raise exception 'Некорректный вид шаблона';
  end if;
  if new.brigade_id is null or btrim(new.brigade_id) = '' then
    raise exception 'Выберите команду шаблона';
  end if;
  if new.payment_method is null
     or new.payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Выберите способ оплаты шаблона';
  end if;
  if new.account_id is null then
    raise exception 'Выберите финансовый счёт шаблона';
  end if;

  select * into template_account
    from public.accounts
   where id = new.account_id
     and tenant_id = new.tenant_id
   for share;
  if not found or not template_account.is_active then
    raise exception 'Финансовый счёт шаблона не найден или закрыт';
  end if;
  if template_account.brigade_id is distinct from new.brigade_id then
    raise exception 'Счёт шаблона относится к другой команде';
  end if;
  expected_kind := case new.payment_method
    when 'cash' then 'cash'
    when 'card' then 'card'
    when 'transfer' then 'bank'
    when 'other' then 'other'
  end;
  if template_account.kind is distinct from expected_kind then
    raise exception 'Способ оплаты шаблона не соответствует выбранному счёту';
  end if;
  if not exists (
    select 1 from public.teams
     where id = new.brigade_id and tenant_id = new.tenant_id
  ) then
    raise exception 'Команда шаблона не найдена';
  end if;

  if new.category_id is not null then
    expected_category_type := case new.kind
      when 'income' then 'income'
      when 'expense' then 'expense'
    end;
    if not exists (
      select 1 from public.finance_categories category
       where category.id = new.category_id
         and (category.tenant_id is null or category.tenant_id = new.tenant_id)
         and category.type = expected_category_type
    ) then
      raise exception 'Категория не соответствует виду шаблона';
    end if;
  end if;
  if new.master_id is not null and not exists (
    select 1
      from public.masters master
      join public.teams team
        on team.id = new.brigade_id and team.tenant_id = new.tenant_id
     where master.id = new.master_id
       and master.tenant_id = new.tenant_id
       and (
         master.team_id = new.brigade_id
         or team.lead_id = master.id
         or coalesce(team.lead_ids, '[]'::jsonb) ? master.id
         or coalesce(team.helper_ids, '[]'::jsonb) ? master.id
         or exists (
           select 1
             from jsonb_array_elements(
               case when jsonb_typeof(team.members) = 'array'
                 then team.members else '[]'::jsonb end
             ) member
            where case jsonb_typeof(member)
              when 'string' then member #>> '{}'
              when 'object' then coalesce(member ->> 'master_id', member ->> 'id')
              else null
            end = master.id
         )
       )
  ) then
    raise exception 'Исполнитель не входит в команду шаблона';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_assert_finance_template_integrity
  on public.finance_templates;
create trigger trg_assert_finance_template_integrity
before insert or update on public.finance_templates
for each row execute function public.assert_finance_template_integrity();
revoke all on function public.assert_finance_template_integrity()
  from public, anon, authenticated;

create or replace function public.guard_account_financial_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  ledger_balance numeric(14,2);
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'Компания финансового счёта неизменяема';
  end if;
  if new.brigade_id is distinct from old.brigade_id and exists (
    select 1 from public.finance_transactions where account_id = old.id
  ) then
    raise exception 'Команду счёта с операциями нельзя изменить';
  end if;
  if new.kind is distinct from old.kind and exists (
    select 1 from public.finance_transactions where account_id = old.id
  ) then
    raise exception 'Тип счёта с операциями нельзя изменить';
  end if;
  if new.opening_balance is distinct from old.opening_balance and exists (
    select 1 from public.finance_transactions where account_id = old.id
  ) then
    raise exception 'Начальный баланс счёта с операциями нельзя изменить';
  end if;
  if old.is_active and not new.is_active then
    select round(
      old.opening_balance + coalesce(sum(
        case
          when type = 'expense' then -amount
          when type = 'refund' then -abs(amount)
          else amount
        end
      ), 0),
      2
    ) into ledger_balance
    from public.finance_transactions
    where account_id = old.id;
    if ledger_balance <> 0 then
      raise exception 'Счёт с остатком % нельзя закрыть; сначала обнулите его', ledger_balance;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_account_financial_history on public.accounts;
create trigger trg_guard_account_financial_history
before update on public.accounts
for each row execute function public.guard_account_financial_history();
revoke all on function public.guard_account_financial_history()
  from public, anon, authenticated;

-- Deleting a paid appointment would otherwise invoke ON DELETE SET NULL and
-- silently detach the legal/financial history. Empty unpaid drafts remain
-- deletable, and tenant deletion can still cascade through all child tables.
create or replace function public.guard_appointment_history_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  has_nonempty_payments boolean := false;
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  has_nonempty_payments := case
    when old.payments is null then false
    when jsonb_typeof(old.payments) = 'array' then jsonb_array_length(old.payments) > 0
    when jsonb_typeof(old.payments) = 'object' then old.payments <> '{}'::jsonb
    else old.payments <> 'null'::jsonb
  end;
  if old.payment_status is distinct from 'unpaid'
     or coalesce(old.paid_amount, 0) > 0
     or coalesce(old.prepaid_amount, 0) > 0
     or has_nonempty_payments
     or old.payment is not null
     or old.payment_method is not null
     or exists (
       select 1 from public.finance_transactions
        where appointment_id = old.id
     )
     or exists (
       select 1 from public.invoices
        where appointment_id = old.id
     ) then
    raise exception 'Заявку с оплатой или финансовой историей нельзя удалить';
  end if;
  return old;
end;
$function$;

drop trigger if exists trg_guard_appointment_history_delete
  on public.appointments;
create trigger trg_guard_appointment_history_delete
before delete on public.appointments
for each row execute function public.guard_appointment_history_delete();
revoke all on function public.guard_appointment_history_delete()
  from public, anon, authenticated;

-- A client with operational history must be archived by the application,
-- never hard-deleted into anonymous appointments, ledger rows or invoices.
create or replace function public.guard_client_history_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;
  if exists (
       select 1 from public.appointments where client_id = old.id
     )
     or exists (
       select 1 from public.finance_transactions where client_id = old.id
     )
     or exists (
       select 1 from public.invoices where client_id = old.id
     ) then
    raise exception 'Клиента с заявками или финансовой историей нельзя удалить';
  end if;
  return old;
end;
$function$;

drop trigger if exists trg_guard_client_history_delete on public.clients;
create trigger trg_guard_client_history_delete
before delete on public.clients
for each row execute function public.guard_client_history_delete();
revoke all on function public.guard_client_history_delete()
  from public, anon, authenticated;

-- Category deletion used to null out historical transaction labels. Keep the
-- immutable ledger readable; only a tenant's unused custom category can go.
create or replace function public.guard_finance_category_history_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if old.tenant_id is not null
     and not exists (select 1 from public.tenants where id = old.tenant_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' and (
    exists (select 1 from public.finance_transactions where category_id = old.id)
    or exists (select 1 from public.finance_templates where category_id = old.id)
  ) then
    raise exception 'Категория используется в финансовой истории и не может быть удалена';
  end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.type is distinct from old.type
  ) and (
    exists (select 1 from public.finance_transactions where category_id = old.id)
    or exists (select 1 from public.finance_templates where category_id = old.id)
  ) then
    raise exception 'Тип и компания используемой категории неизменяемы';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_finance_category_history_delete
  on public.finance_categories;
create trigger trg_guard_finance_category_history_delete
before update or delete on public.finance_categories
for each row execute function public.guard_finance_category_history_delete();
revoke all on function public.guard_finance_category_history_delete()
  from public, anon, authenticated;

create or replace function public.resolve_appointment_finance_account(
  p_tenant_id uuid,
  p_team_id text,
  p_payment_method text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  account_id uuid;
  required_kind text;
begin
  if p_team_id is null or btrim(p_team_id) = '' then
    raise exception 'Укажите команду заявки перед оплатой';
  end if;
  if p_payment_method is null
     or p_payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Выберите способ оплаты заявки';
  end if;
  required_kind := case p_payment_method
    when 'cash' then 'cash'
    when 'card' then 'card'
    when 'transfer' then 'bank'
    else 'other'
  end;

  select id into account_id
    from public.accounts
   where tenant_id = p_tenant_id
     and brigade_id = p_team_id
     and kind = required_kind
     and is_active = true
   order by position, id
   limit 1;
  if account_id is null then
    raise exception 'Для этого способа оплаты нет активного счёта команды';
  end if;
  return account_id;
end;
$function$;
revoke all on function public.resolve_appointment_finance_account(uuid, text, text)
  from public, anon, authenticated;

-- Once an auto ledger exists, economic appointment fields are immutable until
-- an explicit refund or the atomic undo RPC. This prevents stale ledger rows.
create or replace function public.protect_paid_appointment_finance()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  has_any_auto_income boolean := false;
  has_linked_finance boolean := false;
  has_settlement boolean := false;
  undo_context boolean := false;
  prepayment_context boolean := false;
  payment_reset_context boolean := false;
  is_refund_transition boolean;
  is_cancel_transition boolean;
  financial_fields_changed boolean;
  received_amount numeric;
  old_settlement_target numeric := 0;
  new_settlement_target numeric := 0;
  settlement_growth boolean := false;
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'Компания заявки неизменяема';
  end if;
  select exists (
    select 1 from public.finance_transactions
     where appointment_id = old.id and source = 'auto' and type = 'income'
  ) into has_any_auto_income;
  select exists (
    select 1 from public.finance_transactions where appointment_id = old.id
  ) into has_linked_finance;
  select exists (
    select 1 from public.finance_transactions
     where appointment_id = old.id
       and source = 'auto'
       and type = 'income'
       and coalesce(appointment_payment_kind, 'settlement') = 'settlement'
  ) into has_settlement;

  -- Once any receipt names a party/team/master, changing that context would
  -- make the immutable row disagree with its appointment. Rescheduling and
  -- editing services/price remain available for a prepayment-only booking.
  if (
    has_linked_finance
    or exists (select 1 from public.invoices where appointment_id = old.id)
  ) and (
    new.client_id is distinct from old.client_id
    or new.team_id is distinct from old.team_id
    or new.master_id is distinct from old.master_id
  ) then
    raise exception 'Сначала верните оплату; клиента, команду и исполнителя менять нельзя';
  end if;

  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_undo'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into undo_context;
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_prepayment'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into prepayment_context;
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_payment_reset'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into payment_reset_context;
  if undo_context or payment_reset_context then return new; end if;

  -- A fully prepaid scheduled booking is marked paid. If its total changes,
  -- derive that marker again instead of rejecting an otherwise valid edit.
  -- There is still no settlement here: the immutable prepayment event stays
  -- untouched and completion will collect only the new remainder.
  if not has_settlement
     and new.status <> 'cancelled'
     and new.payment_status <> 'refunded'
     and new.prepaid_amount > 0
     and new.paid_amount = 0
     and new.total_amount is distinct from old.total_amount then
    new.payment_status := case
      when new.total_amount > 0 and new.prepaid_amount >= new.total_amount
        then 'paid'
      else 'unpaid'
    end;
  end if;

  financial_fields_changed :=
    new.total_amount is distinct from old.total_amount
    or new.prepaid_amount is distinct from old.prepaid_amount
    or new.paid_amount is distinct from old.paid_amount
    or new.payment_status is distinct from old.payment_status
    or new.payment_method is distinct from old.payment_method
    or new.status is distinct from old.status
    or new.payment is distinct from old.payment
    or new.payments is distinct from old.payments;

  if financial_fields_changed then
    if new.total_amount = 'NaN'::numeric
       or new.prepaid_amount = 'NaN'::numeric
       or new.paid_amount = 'NaN'::numeric
       or new.total_amount < 0
       or new.prepaid_amount < 0
       or new.paid_amount < 0 then
      raise exception 'Суммы оплаты заявки некорректны';
    end if;
    if new.prepaid_amount > new.total_amount then
      raise exception 'Предоплата не может быть больше итоговой суммы';
    end if;
    if (
      new.prepaid_amount > 0
      or new.paid_amount > 0
      or (new.payment_status = 'paid' and new.total_amount > 0)
    ) and (
      new.payment_method is null
      or new.payment_method not in ('cash', 'card', 'transfer', 'other')
    ) then
      raise exception 'Выберите способ оплаты заявки';
    end if;
    received_amount := new.prepaid_amount + case
      when new.payment_status in ('partial', 'paid') then new.paid_amount
      else 0
    end;
    if new.status <> 'cancelled' and new.payment_status <> 'refunded' then
      if received_amount > new.total_amount then
        raise exception 'Полученная сумма больше итога заявки';
      end if;
      if new.payment_status = 'paid'
         and new.total_amount > 0
         and received_amount < new.total_amount then
        raise exception 'Для статуса «Оплачено» не хватает полученной суммы';
      end if;
      if new.payment_status = 'partial'
         and (received_amount <= 0 or received_amount >= new.total_amount) then
        raise exception 'Частичная оплата должна быть меньше итога заявки';
      end if;
      if new.payment_status = 'unpaid' and new.paid_amount > 0 then
        raise exception 'Сумма доплаты указана для неоплаченной заявки';
      end if;
    end if;
  end if;

  if old.status <> 'cancelled' and old.payment_status <> 'refunded' then
    old_settlement_target := case old.payment_status
      when 'paid' then greatest(old.total_amount - old.prepaid_amount, 0)
      when 'partial' then greatest(old.paid_amount, 0)
      else 0
    end;
  end if;
  if new.status <> 'cancelled' and new.payment_status <> 'refunded' then
    new_settlement_target := case new.payment_status
      when 'paid' then greatest(new.total_amount - new.prepaid_amount, 0)
      when 'partial' then greatest(new.paid_amount, 0)
      else 0
    end;
  end if;
  settlement_growth := old.status <> 'cancelled'
    and old.payment_status <> 'refunded'
    and new_settlement_target > old_settlement_target;

  if has_any_auto_income and not prepayment_context
     and new.prepaid_amount is distinct from old.prepaid_amount then
    raise exception 'Предоплату и её способ меняйте через действие «Изменить предоплату»';
  end if;
  if has_any_auto_income and not prepayment_context
     and new.payment_method is distinct from old.payment_method
     and not settlement_growth then
    raise exception 'Способ предоплаты меняйте через действие «Изменить предоплату»';
  end if;

  is_cancel_transition := old.status is distinct from 'cancelled'
    and new.status = 'cancelled'
    and (
      has_any_auto_income
      or old.prepaid_amount > 0
      or old.paid_amount > 0
      or old.payment_status in ('partial', 'paid')
    );
  if is_cancel_transition then
    new.payment_status := 'refunded';
    new.paid_amount := 0;
  end if;
  is_refund_transition := old.payment_status is distinct from 'refunded'
    and new.payment_status = 'refunded';
  if is_refund_transition then
    new.paid_amount := 0;
  end if;

  -- The only caller able to hold this closed capability is the absolute
  -- prepayment RPC. It may adjust/refund a prepayment-only completed booking
  -- (including one linked to an invoice); reconciliation below keeps the
  -- immutable receipt and writes linked refund events.
  if prepayment_context and not has_settlement then
    return new;
  end if;

  -- Settlement is also an event stream: a partial cash receipt may later be
  -- followed by a card receipt for the remainder. Permit only a real increase
  -- in the cumulative settlement target and only payment mirrors (plus the
  -- one-way transition to completed). Every economic/context field stays
  -- frozen, and the AFTER trigger records exactly the positive delta.
  if settlement_growth then
    if new.tenant_id is distinct from old.tenant_id
       or new.client_id is distinct from old.client_id
       or new.team_id is distinct from old.team_id
       or new.master_id is distinct from old.master_id
       or new.kind is distinct from old.kind
       or new.date is distinct from old.date
       or new.total_amount is distinct from old.total_amount
       or new.custom_total is distinct from old.custom_total
       or new.discount_amount is distinct from old.discount_amount
       or new.services is distinct from old.services
       or new.service_ids is distinct from old.service_ids
       or new.service_price_overrides is distinct from old.service_price_overrides
       or new.global_discount is distinct from old.global_discount
       or new.prepaid_amount is distinct from old.prepaid_amount
       or (
         new.status is distinct from old.status
         and new.status is distinct from 'completed'
       ) then
      raise exception 'При доплате можно изменить только оплату и завершить заявку';
    end if;
    return new;
  end if;

  -- A prepayment-only booking is still editable: date/time, services and
  -- total may change while total remains >= prepayment. Completion will add
  -- only the remainder. The fields below lock only after settlement.
  if not has_settlement and not (
    old.status = 'completed' and old.payment_status = 'paid'
  ) then
    if old.status = 'cancelled' or old.payment_status = 'refunded' then
      if financial_fields_changed and not is_cancel_transition then
        raise exception 'Возвращённую оплату нельзя изменить; создайте новую заявку';
      end if;
    end if;
    return new;
  end if;

  -- A free/fully-discounted paid appointment intentionally has no zero-value
  -- ledger row, but it is still financially settled and must be undone before
  -- its total/services can become non-zero.
  if new.tenant_id is distinct from old.tenant_id
     or new.client_id is distinct from old.client_id
     or new.team_id is distinct from old.team_id
     or new.master_id is distinct from old.master_id
     or new.date is distinct from old.date
     or new.total_amount is distinct from old.total_amount
     or new.custom_total is distinct from old.custom_total
     or new.discount_amount is distinct from old.discount_amount
     or new.services is distinct from old.services
     or new.service_ids is distinct from old.service_ids
     or new.service_price_overrides is distinct from old.service_price_overrides
     or new.global_discount is distinct from old.global_discount
     or new.payment_method is distinct from old.payment_method
     or new.prepaid_amount is distinct from old.prepaid_amount
     or new.payment is distinct from old.payment
     or new.payments is distinct from old.payments
     or (new.status is distinct from old.status and not is_cancel_transition)
     or (new.paid_amount is distinct from old.paid_amount and not is_refund_transition)
     or (new.payment_status is distinct from old.payment_status and not is_refund_transition)
     or ((old.status = 'cancelled' or old.payment_status = 'refunded') and
       (new.status is distinct from old.status or new.payment_status is distinct from old.payment_status)) then
    raise exception 'Сначала отмените оплату или оформите возврат по заявке';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_protect_paid_appointment_finance
  on public.appointments;
create trigger trg_protect_paid_appointment_finance
before update on public.appointments
for each row execute function public.protect_paid_appointment_finance();
revoke all on function public.protect_paid_appointment_finance()
  from public, anon, authenticated;

-- Reconcile one appointment transition into immutable receipt/refund events.
-- Prepayment and settlement are separate so completing a prepaid appointment
-- records only the remainder. A single appointment update and every generated
-- ledger row commit or roll back together.
create or replace function public.reconcile_appointment_finance(
  p_appointment_id uuid,
  p_old_total numeric,
  p_old_prepaid numeric,
  p_old_paid numeric,
  p_old_payment_status text,
  p_old_status text,
  p_is_insert boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  appointment_row public.appointments%rowtype;
  services_category_id uuid;
  refund_category_id uuid;
  resolved_account_id uuid;
  old_prepayment_target numeric := 0;
  old_settlement_target numeric := 0;
  new_prepayment_target numeric := 0;
  new_settlement_target numeric := 0;
  prepayment_delta numeric := 0;
  settlement_delta numeric := 0;
  total_delta numeric := 0;
  income_count integer := 0;
  legacy_income_count integer := 0;
  received_amount numeric := 0;
  adjustment record;
  income_candidate record;
  remaining_refund numeric := 0;
  refund_piece numeric := 0;
  business_today date;
begin
  select * into appointment_row
    from public.appointments
   where id = p_appointment_id
   for share;
  if not found then
    raise exception 'Заявка для синхронизации оплаты не найдена';
  end if;
  business_today := public.tenant_business_date(appointment_row.tenant_id);

  if appointment_row.total_amount = 'NaN'::numeric
     or appointment_row.prepaid_amount = 'NaN'::numeric
     or appointment_row.paid_amount = 'NaN'::numeric
     or appointment_row.total_amount < 0
     or appointment_row.prepaid_amount < 0
     or appointment_row.paid_amount < 0 then
    raise exception 'Суммы оплаты заявки некорректны';
  end if;
  if appointment_row.prepaid_amount > appointment_row.total_amount then
    raise exception 'Предоплата не может быть больше итоговой суммы';
  end if;
  if round(appointment_row.total_amount, 2) is distinct from appointment_row.total_amount
     or round(appointment_row.prepaid_amount, 2) is distinct from appointment_row.prepaid_amount
     or round(appointment_row.paid_amount, 2) is distinct from appointment_row.paid_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  received_amount := appointment_row.prepaid_amount + case
    when appointment_row.payment_status in ('partial', 'paid')
      then appointment_row.paid_amount
    else 0
  end;
  if appointment_row.status <> 'cancelled'
     and appointment_row.payment_status <> 'refunded' then
    if received_amount > appointment_row.total_amount then
      raise exception 'Полученная сумма больше итога заявки';
    end if;
    if appointment_row.payment_status = 'paid'
       and appointment_row.total_amount > 0
       and received_amount < appointment_row.total_amount then
      raise exception 'Для статуса «Оплачено» не хватает полученной суммы';
    end if;
    if appointment_row.payment_status = 'partial'
       and (received_amount <= 0 or received_amount >= appointment_row.total_amount) then
      raise exception 'Частичная оплата должна быть меньше итога заявки';
    end if;
    if appointment_row.payment_status = 'unpaid'
       and appointment_row.paid_amount > 0 then
      raise exception 'Сумма доплаты указана для неоплаченной заявки';
    end if;
  end if;
  if received_amount > 0 and (
    appointment_row.payment_method is null
    or appointment_row.payment_method not in ('cash', 'card', 'transfer', 'other')
  ) then
    raise exception 'Выберите способ оплаты заявки';
  end if;

  if appointment_row.status <> 'cancelled'
     and appointment_row.payment_status <> 'refunded' then
    new_prepayment_target := greatest(appointment_row.prepaid_amount, 0);
    new_settlement_target := case appointment_row.payment_status
      when 'paid' then greatest(
        appointment_row.total_amount - appointment_row.prepaid_amount,
        0
      )
      when 'partial' then greatest(appointment_row.paid_amount, 0)
      else 0
    end;
  end if;

  if not p_is_insert
     and p_old_status <> 'cancelled'
     and p_old_payment_status <> 'refunded' then
    old_prepayment_target := greatest(coalesce(p_old_prepaid, 0), 0);
    old_settlement_target := case p_old_payment_status
      when 'paid' then greatest(
        coalesce(p_old_total, 0) - coalesce(p_old_prepaid, 0),
        0
      )
      when 'partial' then greatest(coalesce(p_old_paid, 0), 0)
      else 0
    end;
  end if;

  select
    count(*),
    count(*) filter (where appointment_payment_kind is null)
    into income_count, legacy_income_count
    from public.finance_transactions
   where appointment_id = appointment_row.id
     and source = 'auto'
     and type = 'income';

  if income_count = 0 then
    -- INSERT and repair of a pre-migration scheduled prepayment.
    prepayment_delta := new_prepayment_target;
    settlement_delta := new_settlement_target;
  elsif legacy_income_count > 0 then
    -- A legacy row represents the aggregate total and cannot be split without
    -- inventing historical tender dates. Preserve it and record only the net
    -- transition; all newly-created rows are explicitly typed.
    total_delta :=
      (new_prepayment_target + new_settlement_target)
      - (old_prepayment_target + old_settlement_target);
  else
    prepayment_delta := new_prepayment_target - old_prepayment_target;
    settlement_delta := new_settlement_target - old_settlement_target;
  end if;

  if prepayment_delta = 0 and settlement_delta = 0 and total_delta = 0 then
    return;
  end if;

  select id into services_category_id
    from public.finance_categories
   where slug = 'services'
     and (tenant_id is null or tenant_id = appointment_row.tenant_id)
   order by tenant_id nulls last
   limit 1;
  select id into refund_category_id
    from public.finance_categories
   where slug = 'refund'
     and type = 'income'
     and (tenant_id is null or tenant_id = appointment_row.tenant_id)
   order by tenant_id nulls last
   limit 1;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (
    txid_current(), 'appointment_auto', appointment_row.id, appointment_row.tenant_id
  )
  on conflict do nothing;

  for adjustment in
    select * from (values
      ('prepayment'::text, prepayment_delta),
      ('settlement'::text, settlement_delta),
      ('all'::text, total_delta)
    ) changes(payment_kind, amount)
    where amount <> 0
  loop
    if adjustment.amount > 0 then
      resolved_account_id := public.resolve_appointment_finance_account(
        appointment_row.tenant_id,
        appointment_row.team_id,
        appointment_row.payment_method
      );
      insert into public.finance_transactions (
        tenant_id, type, amount, category_id, account_id, appointment_id,
        client_id, team_id, master_id, payment_method, occurred_on, source,
        appointment_payment_kind, notes
      ) values (
        appointment_row.tenant_id,
        'income',
        round(adjustment.amount, 2),
        services_category_id,
        resolved_account_id,
        appointment_row.id,
        appointment_row.client_id,
        appointment_row.team_id,
        appointment_row.master_id,
        appointment_row.payment_method,
        business_today,
        'auto',
        case
          when adjustment.payment_kind = 'prepayment' then 'prepayment'
          else 'settlement'
        end,
        case
          when adjustment.payment_kind = 'prepayment' then 'Предоплата по заявке'
          else 'Оплата по заявке'
        end
      );
    else
      remaining_refund := abs(round(adjustment.amount, 2));
      for income_candidate in
        select
          income.id,
          income.account_id,
          income.client_id,
          income.team_id,
          income.master_id,
          income.payment_method,
          income.invoice_id,
          coalesce(income.appointment_payment_kind, 'settlement') as payment_kind,
          greatest(
            income.amount - coalesce((
              select sum(abs(refund.amount))
                from public.finance_transactions refund
               where refund.refund_of_id = income.id
                 and refund.type = 'refund'
            ), 0),
            0
          ) as refundable
        from public.finance_transactions income
        where income.appointment_id = appointment_row.id
          and income.source = 'auto'
          and income.type = 'income'
          and (
            adjustment.payment_kind = 'all'
            or coalesce(income.appointment_payment_kind, 'settlement') =
               adjustment.payment_kind
          )
        order by income.created_at desc, income.id desc
        for update of income
      loop
        exit when remaining_refund <= 0;
        if income_candidate.refundable <= 0 then continue; end if;
        refund_piece := least(remaining_refund, income_candidate.refundable);
        insert into public.finance_transactions (
          tenant_id, type, amount, category_id, account_id, appointment_id,
          client_id, team_id, master_id, payment_method, occurred_on, source,
          refund_of_id, invoice_id, appointment_payment_kind, notes
        ) values (
          appointment_row.tenant_id,
          'refund',
          -refund_piece,
          refund_category_id,
          income_candidate.account_id,
          appointment_row.id,
          income_candidate.client_id,
          income_candidate.team_id,
          income_candidate.master_id,
          income_candidate.payment_method,
          business_today,
          'auto',
          income_candidate.id,
          income_candidate.invoice_id,
          income_candidate.payment_kind,
          case
            when appointment_row.status = 'cancelled'
              then 'Возврат при отмене заявки'
            when appointment_row.payment_status = 'refunded'
              then 'Возврат оплаты заявки'
            else 'Изменение предоплаты по заявке'
          end
        );
        remaining_refund := remaining_refund - refund_piece;
      end loop;
      if remaining_refund > 0 then
        raise exception 'Не удалось вернуть всю сумму; финансовая история не изменена';
      end if;
    end if;
  end loop;

  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_auto'
     and entity_id = appointment_row.id;
end;
$function$;
revoke all on function public.reconcile_appointment_finance(
  uuid, numeric, numeric, numeric, text, text, boolean
) from public, anon, authenticated;

create or replace function public.sync_appointment_finance()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.reconcile_appointment_finance(
    new.id,
    old.total_amount,
    old.prepaid_amount,
    old.paid_amount,
    old.payment_status,
    old.status,
    false
  );
  return new;
end;
$function$;

create or replace function public.sync_appointment_finance_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.reconcile_appointment_finance(
    new.id, 0, 0, 0, 'unpaid', 'scheduled', true
  );
  return new;
end;
$function$;
revoke all on function public.sync_appointment_finance() from public, anon, authenticated;
revoke all on function public.sync_appointment_finance_insert() from public, anon, authenticated;

-- Absolute, idempotent prepayment adjustment. Direct appointment updates are
-- blocked after the first receipt; this RPC locks the row and lets the same
-- transaction create the additional income or linked refund event.
create or replace function public.set_appointment_prepayment(
  p_appointment_id uuid,
  p_amount numeric,
  p_payment_method text
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  appointment_row public.appointments%rowtype;
  result_row public.appointments%rowtype;
  normalized_amount numeric(12,2);
begin
  if auth.uid() is null
     or coalesce(public.current_user_role(), '') not in ('owner', 'dispatcher') then
    raise exception 'Изменить предоплату может владелец или диспетчер';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount < 0 then
    raise exception 'Предоплата не может быть отрицательной';
  end if;
  normalized_amount := round(p_amount, 2);
  if normalized_amount is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  if normalized_amount > 0 and (
    p_payment_method is null
    or p_payment_method not in ('cash', 'card', 'transfer', 'other')
  ) then
    raise exception 'Выберите способ предоплаты';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));
  select * into appointment_row
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if appointment_row.status = 'cancelled'
     or appointment_row.payment_status = 'refunded' then
    raise exception 'По отменённой заявке предоплата уже закрыта возвратом';
  end if;
  if appointment_row.status = 'completed' then
    raise exception 'После выполнения отмените оплату целиком и проведите её заново';
  end if;
  if normalized_amount > appointment_row.total_amount then
    raise exception 'Предоплата не может быть больше итоговой суммы';
  end if;
  if appointment_row.paid_amount > 0
     or exists (
       select 1 from public.finance_transactions
        where appointment_id = appointment_row.id
          and source = 'auto'
          and type = 'income'
          and coalesce(appointment_payment_kind, 'settlement') = 'settlement'
     ) then
    raise exception 'После оплаты остатка предоплату отдельно менять нельзя';
  end if;
  if appointment_row.prepaid_amount = normalized_amount
     and appointment_row.payment_method is not distinct from (case
       when normalized_amount > 0 then p_payment_method else null
     end) then
    return appointment_row;
  end if;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (
    txid_current(), 'appointment_prepayment', appointment_row.id, tenant_uuid
  )
  on conflict do nothing;
  -- Changing tender reclassifies the whole prepayment as two immutable
  -- events: refund on the old account, then a fresh receipt on the new one.
  -- Merely changing the appointment field would falsify the account ledger.
  if appointment_row.prepaid_amount > 0
     and normalized_amount > 0
     and appointment_row.payment_method is distinct from p_payment_method then
    update public.appointments
       set prepaid_amount = 0,
           payment_method = null,
           paid_amount = 0,
           payment_status = 'unpaid'
     where id = appointment_row.id and tenant_id = tenant_uuid;
  end if;
  update public.appointments
     set prepaid_amount = normalized_amount,
         payment_method = case
           when normalized_amount > 0 then p_payment_method else null
         end,
         paid_amount = 0,
         payment_status = case
           when normalized_amount > 0
                and normalized_amount >= total_amount
                and total_amount > 0 then 'paid'
           else 'unpaid'
         end
   where id = appointment_row.id and tenant_id = tenant_uuid
  returning * into result_row;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_prepayment'
     and entity_id = appointment_row.id;
  return result_row;
end;
$function$;
revoke all on function public.set_appointment_prepayment(uuid, numeric, text)
  from public, anon;
grant execute on function public.set_appointment_prepayment(uuid, numeric, text)
  to authenticated;

-- Best-effort migration of existing scheduled prepayments. Invalid legacy
-- rows are not guessed into cash: the warning identifies records that need a
-- real method/account before their next financial edit.
do $prepayment_backfill$
declare
  appointment_row public.appointments%rowtype;
begin
  for appointment_row in
    select appointment.*
      from public.appointments appointment
     where appointment.prepaid_amount > 0
       and appointment.status <> 'cancelled'
       and appointment.payment_status <> 'refunded'
       and appointment.payment_method in ('cash', 'card', 'transfer', 'other')
       and appointment.team_id is not null
       and not exists (
         select 1 from public.finance_transactions tx
          where tx.appointment_id = appointment.id
            and tx.source = 'auto'
            and tx.type = 'income'
       )
       and exists (
         select 1 from public.accounts account
          where account.tenant_id = appointment.tenant_id
            and account.brigade_id = appointment.team_id
            and account.is_active = true
            and account.kind = case appointment.payment_method
              when 'cash' then 'cash'
              when 'card' then 'card'
              when 'transfer' then 'bank'
              when 'other' then 'other'
            end
       )
  loop
    begin
      perform public.reconcile_appointment_finance(
        appointment_row.id, 0, 0, 0, 'unpaid', 'scheduled', true
      );
    exception when others then
      raise warning 'prepayment backfill skipped appointment %: %',
        appointment_row.id, sqlerrm;
    end;
  end loop;
end;
$prepayment_backfill$;

create or replace function public.undo_appointment_payment(p_appointment_id uuid)
returns setof public.appointments
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  appointment_row public.appointments%rowtype;
  settlement_count integer := 0;
  prepayment_method text;
begin
  if auth.uid() is null
     or coalesce(public.current_user_role(), '') not in ('owner', 'dispatcher') then
    raise exception 'Отменить оплату может владелец или диспетчер';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));
  select * into appointment_row
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if appointment_row.payment_status = 'refunded' then
    raise exception 'По оплате уже оформлен возврат';
  end if;
  if appointment_row.payment_status not in ('partial', 'paid') then
    raise exception 'Оплата ещё не синхронизирована или уже отменена';
  end if;
  perform 1
    from public.finance_transactions income
   where income.appointment_id = p_appointment_id
     and income.type = 'income'
     and income.source = 'auto'
     and coalesce(income.appointment_payment_kind, 'settlement') = 'settlement'
   order by income.id
   for update;
  select count(*) into settlement_count
    from public.finance_transactions income
   where income.appointment_id = p_appointment_id
     and income.type = 'income'
     and income.source = 'auto'
     and coalesce(income.appointment_payment_kind, 'settlement') = 'settlement';
  if settlement_count = 0 and appointment_row.total_amount > 0 then
    raise exception 'Оплата состоит только из предоплаты; оформите её возврат';
  end if;
  if exists (
    select 1
      from public.finance_transactions refund
      join public.finance_transactions income on income.id = refund.refund_of_id
     where income.appointment_id = p_appointment_id
       and income.type = 'income'
       and income.source = 'auto'
       and coalesce(income.appointment_payment_kind, 'settlement') = 'settlement'
       and refund.type = 'refund'
  ) then
    raise exception 'По оплате уже есть возврат; отмена недоступна';
  end if;
  if exists (
    select 1 from public.finance_transactions income
    left join public.accounts account
      on account.id = income.account_id and account.tenant_id = tenant_uuid
   where income.appointment_id = p_appointment_id
     and income.type = 'income'
     and income.source = 'auto'
     and coalesce(income.appointment_payment_kind, 'settlement') = 'settlement'
     and (account.id is null or not account.is_active)
  ) then
    raise exception 'Счёт оплаты закрыт; снова откройте его перед отменой';
  end if;

  select income.payment_method into prepayment_method
    from public.finance_transactions income
   where income.appointment_id = p_appointment_id
     and income.type = 'income'
     and income.source = 'auto'
     and income.appointment_payment_kind = 'prepayment'
   order by income.created_at desc, income.id desc
   limit 1;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'appointment_undo', p_appointment_id, tenant_uuid)
  on conflict do nothing;
  -- Do not delete receipts. The appointment transition fires reconciliation,
  -- which writes one linked refund per outstanding settlement piece. This
  -- also inherits invoice_id and atomically reopens an attached invoice.
  update public.appointments
     set payment_status = case
           when prepaid_amount > 0 and total_amount > 0
                and prepaid_amount >= total_amount then 'paid'
           else 'unpaid'
         end,
         payment_method = case
           when prepaid_amount > 0 then coalesce(prepayment_method, payment_method)
           else null
         end,
         paid_amount = 0,
         payment = null,
         payments = '[]'::jsonb
   where id = p_appointment_id and tenant_id = tenant_uuid;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_undo' and entity_id = p_appointment_id;
  return query select * from public.appointments where id = p_appointment_id;
end;
$function$;
revoke all on function public.undo_appointment_payment(uuid) from public, anon;
grant execute on function public.undo_appointment_payment(uuid) to authenticated;

-- Permanent, discoverable "cancel payment" action. Unlike the short-lived
-- settlement undo above, this resets every receipt (prepayment + one or more
-- settlements), reopens appointment debt and reopens any linked invoice.
-- Receipts are never deleted: reconciliation appends exact linked refunds.
create or replace function public.reset_appointment_payment(
  p_appointment_id uuid
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  appointment_row public.appointments%rowtype;
  result_row public.appointments%rowtype;
  outstanding_count integer := 0;
  outstanding_amount numeric := 0;
  expected_receipts numeric := 0;
begin
  if auth.uid() is null
     or coalesce(public.current_user_role(), '') not in ('owner', 'dispatcher') then
    raise exception 'Отменить оплату может владелец или диспетчер';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));
  select * into appointment_row
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then raise exception 'Заявка не найдена'; end if;
  if appointment_row.status = 'cancelled'
     or appointment_row.payment_status = 'refunded' then
    raise exception 'Оплата уже закрыта возвратом';
  end if;

  expected_receipts := greatest(appointment_row.prepaid_amount, 0) + case
    when appointment_row.payment_status = 'paid' then greatest(
      appointment_row.total_amount - appointment_row.prepaid_amount,
      0
    )
    when appointment_row.payment_status = 'partial' then
      greatest(appointment_row.paid_amount, 0)
    else 0
  end;
  if expected_receipts <= 0 then
    raise exception 'В заявке нет оплаты для отмены';
  end if;

  perform 1
    from public.finance_transactions income
   where income.appointment_id = p_appointment_id
     and income.type = 'income'
     and income.source = 'auto'
   order by income.id
   for update;
  select
    count(*) filter (where receipt.outstanding > 0),
    coalesce(sum(receipt.outstanding), 0)
    into outstanding_count, outstanding_amount
    from (
      select greatest(
        income.amount - coalesce((
          select sum(abs(refund.amount))
            from public.finance_transactions refund
           where refund.refund_of_id = income.id
             and refund.type = 'refund'
        ), 0),
        0
      ) as outstanding
      from public.finance_transactions income
     where income.appointment_id = p_appointment_id
       and income.type = 'income'
       and income.source = 'auto'
    ) receipt;
  if outstanding_count = 0 then
    raise exception 'Все платежи уже возвращены';
  end if;
  -- Previous short-lived settlement undo may already have refunded only the
  -- settlement while a prepayment remains. That history is valid: refund the
  -- still-outstanding receipts, but fail closed if mirrors and ledger differ.
  if round(outstanding_amount, 2) is distinct from round(expected_receipts, 2) then
    raise exception 'Сумма оплаты не совпадает с финансовой историей';
  end if;
  if exists (
    select 1
      from public.finance_transactions income
      left join public.accounts account
        on account.id = income.account_id and account.tenant_id = tenant_uuid
     where income.appointment_id = p_appointment_id
       and income.type = 'income'
       and income.source = 'auto'
       and income.amount > coalesce((
         select sum(abs(refund.amount))
           from public.finance_transactions refund
          where refund.refund_of_id = income.id
            and refund.type = 'refund'
       ), 0)
       and (account.id is null or not account.is_active)
  ) then
    raise exception 'Счёт оплаты закрыт; снова откройте его перед возвратом';
  end if;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (
    txid_current(), 'appointment_payment_reset', p_appointment_id, tenant_uuid
  )
  on conflict do nothing;
  update public.appointments
     set prepaid_amount = 0,
         paid_amount = 0,
         payment_status = 'unpaid',
         payment_method = null,
         payment = null,
         payments = '[]'::jsonb
   where id = p_appointment_id and tenant_id = tenant_uuid
  returning * into result_row;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_payment_reset'
     and entity_id = p_appointment_id;
  return result_row;
end;
$function$;
revoke all on function public.reset_appointment_payment(uuid)
  from public, anon;
grant execute on function public.reset_appointment_payment(uuid)
  to authenticated;

create or replace function public.record_account_transfer(
  p_request_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_occurred_on date default null,
  p_notes text default null
)
returns setof public.finance_transactions
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  request_row public.finance_transfer_requests%rowtype;
  from_account public.accounts%rowtype;
  to_account public.accounts%rowtype;
  normalized_amount numeric(12,2);
  normalized_notes text := nullif(btrim(p_notes), '');
  source_balance numeric(14,2);
  transfer_date date;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Переводы между счетами доступны только владельцу';
  end if;
  if p_request_id is null then raise exception 'Не удалось определить запрос перевода'; end if;
  if p_from_account_id is null or p_to_account_id is null then
    raise exception 'Выберите оба счёта';
  end if;
  if p_from_account_id = p_to_account_id then raise exception 'Выберите разные счета'; end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 then
    raise exception 'Введите сумму больше нуля';
  end if;
  normalized_amount := round(p_amount, 2);
  if normalized_amount <> p_amount then raise exception 'Укажите не больше двух знаков после запятой'; end if;
  transfer_date := coalesce(
    p_occurred_on,
    public.tenant_business_date(tenant_uuid)
  );
  if transfer_date > public.tenant_business_date(tenant_uuid) then
    raise exception 'Финансовую операцию нельзя записать будущей датой';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into request_row
    from public.finance_transfer_requests
   where id = p_request_id
   for update;
  if found then
    if request_row.tenant_id <> tenant_uuid then raise exception 'Запрос перевода уже использован'; end if;
    if request_row.from_account_id <> p_from_account_id
       or request_row.to_account_id <> p_to_account_id
       or request_row.amount <> normalized_amount
       or request_row.occurred_on <> transfer_date
       or request_row.notes is distinct from normalized_notes then
      raise exception 'Запрос перевода уже использован с другими данными';
    end if;
    if request_row.status = 'deleted' then raise exception 'Этот перевод уже отменён'; end if;
    if (select count(*) from public.finance_transactions
         where transfer_group_id = p_request_id and type = 'transfer') <> 2
       or not exists (
         select 1 from public.finance_transactions
          where transfer_group_id = p_request_id
            and tenant_id = tenant_uuid and account_id = p_from_account_id
            and team_id = request_row.team_id and amount = -normalized_amount
       ) or not exists (
         select 1 from public.finance_transactions
          where transfer_group_id = p_request_id
            and tenant_id = tenant_uuid and account_id = p_to_account_id
            and team_id = request_row.team_id and amount = normalized_amount
       ) then
      raise exception 'Перевод повреждён; данные не изменены';
    end if;
    return query
      select * from public.finance_transactions
       where transfer_group_id = p_request_id
       order by amount;
    return;
  end if;

  perform 1 from public.accounts
   where id in (p_from_account_id, p_to_account_id)
   order by id for update;
  select * into from_account from public.accounts where id = p_from_account_id;
  select * into to_account from public.accounts where id = p_to_account_id;
  if not found or from_account.id is null or to_account.id is null
     or from_account.tenant_id <> tenant_uuid or to_account.tenant_id <> tenant_uuid then
    raise exception 'Один из счетов не найден в этой компании';
  end if;
  if not from_account.is_active or not to_account.is_active then
    raise exception 'Перевод доступен только между активными счетами';
  end if;
  if from_account.brigade_id <> to_account.brigade_id then
    raise exception 'Счета должны относиться к одной команде';
  end if;
  if not exists (
    select 1 from public.teams
     where id = from_account.brigade_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Команда счетов не найдена';
  end if;

  select round(
    from_account.opening_balance + coalesce(sum(
      case
        when type = 'expense' then -amount
        when type = 'refund' then -abs(amount)
        else amount
      end
    ), 0),
    2
  ) into source_balance
  from public.finance_transactions
  where account_id = from_account.id;
  if source_balance < normalized_amount then
    raise exception 'На исходном счёте недостаточно средств';
  end if;

  insert into public.finance_transfer_requests (
    id, tenant_id, from_account_id, to_account_id, team_id, amount,
    occurred_on, notes, created_by
  ) values (
    p_request_id, tenant_uuid, p_from_account_id, p_to_account_id,
    from_account.brigade_id, normalized_amount, transfer_date,
    normalized_notes, auth.uid()
  );
  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'transfer_write', p_request_id, tenant_uuid)
  on conflict do nothing;
  insert into public.finance_transactions (
    tenant_id, type, amount, account_id, team_id, notes, occurred_on,
    transfer_group_id, source, created_by
  ) values
    (tenant_uuid, 'transfer', -normalized_amount, p_from_account_id,
     from_account.brigade_id, normalized_notes, transfer_date,
     p_request_id, 'manual', auth.uid()),
    (tenant_uuid, 'transfer', normalized_amount, p_to_account_id,
     from_account.brigade_id, normalized_notes, transfer_date,
     p_request_id, 'manual', auth.uid());
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'transfer_write' and entity_id = p_request_id;
  return query
    select * from public.finance_transactions
     where transfer_group_id = p_request_id
     order by amount;
end;
$function$;
revoke all on function public.record_account_transfer(uuid, uuid, uuid, numeric, date, text)
  from public, anon;
grant execute on function public.record_account_transfer(uuid, uuid, uuid, numeric, date, text)
  to authenticated;

create or replace function public.delete_account_transfer(p_transfer_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  request_row public.finance_transfer_requests%rowtype;
  destination_balance numeric(14,2);
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Отменить перевод может только владелец';
  end if;
  if p_transfer_group_id is null then raise exception 'Перевод не найден'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_transfer_group_id::text, 0));
  select * into request_row
    from public.finance_transfer_requests
   where id = p_transfer_group_id
   for update;
  if not found then
    if exists (
      select 1 from public.finance_transactions
       where transfer_group_id = p_transfer_group_id
         and tenant_id = tenant_uuid
    ) then
      raise exception 'Перевод повреждён; данные не изменены';
    end if;
    return false;
  end if;
  if request_row.tenant_id <> tenant_uuid then raise exception 'Перевод не найден'; end if;
  if request_row.status = 'deleted' then return false; end if;

  perform 1 from public.accounts
   where id in (request_row.from_account_id, request_row.to_account_id)
   order by id for update;
  if (select count(*) from public.accounts
       where id in (request_row.from_account_id, request_row.to_account_id)
         and tenant_id = tenant_uuid and is_active = true) <> 2 then
    raise exception 'Один из счетов закрыт или недоступен';
  end if;
  perform 1 from public.finance_transactions
   where transfer_group_id = p_transfer_group_id
   order by id for update;
  if (select count(*) from public.finance_transactions
       where transfer_group_id = p_transfer_group_id and type = 'transfer') <> 2
     or not exists (
       select 1 from public.finance_transactions
        where transfer_group_id = p_transfer_group_id
          and tenant_id = tenant_uuid and account_id = request_row.from_account_id
          and team_id = request_row.team_id and amount = -request_row.amount
     ) or not exists (
       select 1 from public.finance_transactions
        where transfer_group_id = p_transfer_group_id
          and tenant_id = tenant_uuid and account_id = request_row.to_account_id
          and team_id = request_row.team_id and amount = request_row.amount
     ) then
    raise exception 'Перевод повреждён; данные не изменены';
  end if;

  select round(
    account.opening_balance + coalesce(sum(
      case
        when tx.type = 'expense' then -tx.amount
        when tx.type = 'refund' then -abs(tx.amount)
        else tx.amount
      end
    ), 0),
    2
  ) into destination_balance
  from public.accounts account
  left join public.finance_transactions tx on tx.account_id = account.id
  where account.id = request_row.to_account_id
  group by account.opening_balance;
  if destination_balance < request_row.amount then
    raise exception 'На счёте назначения уже недостаточно средств для отмены перевода';
  end if;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'transfer_write', p_transfer_group_id, tenant_uuid)
  on conflict do nothing;
  delete from public.finance_transactions
   where transfer_group_id = p_transfer_group_id and tenant_id = tenant_uuid;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'transfer_write' and entity_id = p_transfer_group_id;
  update public.finance_transfer_requests
     set status = 'deleted', deleted_at = now(), deleted_by = auth.uid()
   where id = p_transfer_group_id;
  return true;
end;
$function$;
revoke all on function public.delete_account_transfer(uuid) from public, anon;
grant execute on function public.delete_account_transfer(uuid) to authenticated;

do $audit$
begin
  if has_table_privilege('authenticated', 'public._finance_write_context', 'SELECT')
     or has_table_privilege('authenticated', 'public._finance_write_context', 'INSERT')
     or has_table_privilege('authenticated', 'public._finance_write_context', 'UPDATE')
     or has_table_privilege('authenticated', 'public._finance_write_context', 'DELETE') then
    raise exception 'finance integrity: write context leaked to API role';
  end if;
  if has_table_privilege('authenticated', 'public.finance_transfer_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.finance_transfer_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.finance_transfer_requests', 'DELETE') then
    raise exception 'finance integrity: transfer requests are directly mutable';
  end if;
  if has_function_privilege(
       'anon',
       'public.record_account_transfer(uuid,uuid,uuid,numeric,date,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.delete_account_transfer(uuid)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.undo_appointment_payment(uuid)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.set_appointment_prepayment(uuid,numeric,text)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.reset_appointment_payment(uuid)', 'EXECUTE'
     ) then
    raise exception 'finance integrity: mutation RPC is callable by anon';
  end if;
  if has_function_privilege(
       'authenticated',
       'public.resolve_appointment_finance_account(uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.reconcile_appointment_finance(uuid,numeric,numeric,numeric,text,text,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated', 'public.tenant_business_date(uuid)', 'EXECUTE'
     ) then
    raise exception 'finance integrity: internal account resolver is exposed';
  end if;
  if (select count(*) from pg_trigger
       where not tgisinternal
         and tgname in (
           'trg_assert_finance_transaction_integrity',
           'trg_assert_finance_template_integrity',
           'trg_guard_account_financial_history',
           'trg_guard_appointment_history_delete',
           'trg_guard_client_history_delete',
           'trg_guard_finance_category_history_delete',
           'trg_protect_paid_appointment_finance'
         )) <> 7 then
    raise exception 'finance integrity: expected protection triggers are missing';
  end if;
  if to_regclass('public.ux_finance_tx_auto_appointment') is not null
     or to_regclass('public.ux_finance_tx_appointment_type') is not null then
    raise exception 'finance integrity: legacy one-row appointment index still exists';
  end if;
end;
$audit$;
