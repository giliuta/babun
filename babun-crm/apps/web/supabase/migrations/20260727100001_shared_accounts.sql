-- Shared accounts: an account now has a scope — 'team' (exactly one brigade,
-- the previous invariant) or 'company' (one physical account, e.g. a business
-- Revolut card, explicitly attached to teams via account_teams). Per-team
-- inflow on a company account is derived from finance_transactions.team_id,
-- so every income/expense on a company account must carry a team that is a
-- member of the account (manual company-level rows may stay team-less).
-- Also adds balance_hidden (the "eye" toggle, synced across devices) and the
-- safe account picker RPC for non-owner payment surfaces.

-- ─── 1. accounts: scope + balance_hidden ─────────────────────────────
alter table public.accounts
  add column if not exists scope text not null default 'team',
  add column if not exists balance_hidden boolean not null default false;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.accounts'::regclass
       and conname = 'accounts_scope_check'
  ) then
    alter table public.accounts
      add constraint accounts_scope_check
      check (scope in ('team', 'company')) not valid;
  end if;
end;
$constraints$;
alter table public.accounts validate constraint accounts_scope_check;

alter table public.accounts alter column brigade_id drop not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.accounts'::regclass
       and conname = 'accounts_scope_brigade_check'
  ) then
    alter table public.accounts
      add constraint accounts_scope_brigade_check
      check (
        (scope = 'team' and brigade_id is not null)
        or (scope = 'company' and brigade_id is null)
      ) not valid;
  end if;
end;
$constraints$;
alter table public.accounts validate constraint accounts_scope_brigade_check;

-- The old plain unique treats NULL brigade_id rows as always-distinct, which
-- would allow duplicate company account names. Split it into partial indexes.
alter table public.accounts
  drop constraint if exists accounts_tenant_id_brigade_id_name_key;
create unique index if not exists ux_accounts_team_name
  on public.accounts (tenant_id, brigade_id, name) where scope = 'team';
create unique index if not exists ux_accounts_company_name
  on public.accounts (tenant_id, name) where scope = 'company';

-- ─── 2. account_teams: membership of a company account ───────────────
create table if not exists public.account_teams (
  account_id uuid not null references public.accounts(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  team_id    text not null,
  created_at timestamptz not null default now(),
  primary key (account_id, team_id)
);
create index if not exists idx_account_teams_tenant_team
  on public.account_teams (tenant_id, team_id);

alter table public.account_teams enable row level security;
drop policy if exists account_teams_owner_all on public.account_teams;
create policy account_teams_owner_all on public.account_teams
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );
-- Attach/detach are plain owner writes; rows are immutable (no UPDATE grant).
revoke all on table public.account_teams from public, anon, authenticated;
grant select, insert, delete on table public.account_teams to authenticated;

create or replace function public.assert_account_team_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  account_row public.accounts%rowtype;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Привязку команды нельзя изменить; отвяжите и привяжите заново';
  end if;
  select * into account_row
    from public.accounts
   where id = new.account_id
   for share;
  if not found or account_row.tenant_id <> new.tenant_id then
    raise exception 'Счёт не найден в этой компании';
  end if;
  if account_row.scope <> 'company' then
    raise exception 'Команды подключаются только к общему счёту компании';
  end if;
  if not exists (
    select 1 from public.teams
     where id = new.team_id and tenant_id = new.tenant_id
  ) then
    raise exception 'Команда не найдена в этой компании';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_assert_account_team_integrity on public.account_teams;
create trigger trg_assert_account_team_integrity
before insert or update on public.account_teams
for each row execute function public.assert_account_team_integrity();
revoke all on function public.assert_account_team_integrity()
  from public, anon, authenticated;

-- ─── 3. Single source of truth: does an account serve a team? ────────
-- A safe boolean probe: takes unguessable uuids, leaks nothing beyond
-- membership. Granted to authenticated because SECURITY INVOKER guards
-- (invoice payment validation) also rely on it.
create or replace function public.account_serves_team(
  p_account_id uuid,
  p_team_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.accounts a
     where a.id = p_account_id
       and (
         (a.scope = 'team' and a.brigade_id = p_team_id)
         or (a.scope = 'company' and exists (
           select 1 from public.account_teams att
            where att.account_id = a.id and att.team_id = p_team_id
         ))
       )
  )
$$;
revoke all on function public.account_serves_team(uuid, text) from public, anon;
grant execute on function public.account_serves_team(uuid, text) to authenticated;

-- ─── 4. Index for the account detail page (per-month ledger) ─────────
create index if not exists idx_finance_tx_account_occurred
  on public.finance_transactions (account_id, occurred_on desc)
  where account_id is not null;

-- ─── 5. Transfers may now cross team↔company: request team is nullable ─
alter table public.finance_transfer_requests
  alter column team_id drop not null;

-- ─── 6. Ledger integrity: scope-aware team routing ───────────────────
-- Changes against 20260720210006:
--   • team-scope accounts keep the old lock (team = account's brigade);
--   • company-scope accounts: income/expense must carry a member team
--     (manual rows may be team-less "company operations"), auto rows must
--     always carry the appointment's team, refunds follow the original
--     row (membership deliberately NOT re-checked so history survives a
--     detached team), transfer legs are team-less;
--   • a NULL team is inherited from the refund original / appointment;
--   • every unconditional new.team_id read is now NULL-guarded.
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
    if account_row.scope = 'team' then
      if new.team_id is null then
        new.team_id := account_row.brigade_id;
      elsif new.team_id <> account_row.brigade_id then
        raise exception 'Финансовый счёт относится к другой команде';
      end if;
    elsif new.type = 'transfer' and new.team_id is not null then
      -- A company transfer leg carries no team attribution.
      raise exception 'У перевода со счёта компании не бывает команды';
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
      if new.team_id is null then
        new.team_id := original_income.team_id;
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
      if new.team_id is null then
        new.team_id := appointment_row.team_id;
      elsif appointment_row.team_id is distinct from new.team_id then
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

    if new.team_id is not null and not exists (
      select 1 from public.teams
       where id = new.team_id and tenant_id = new.tenant_id
    ) then
      raise exception 'Команда финансовой операции не найдена';
    end if;

    -- The company-account lock (requirement: per-team inflow attribution).
    -- Refunds are exempt: they follow the original row even after the team
    -- was detached from the account.
    if account_row.scope = 'company' then
      if new.source = 'auto' and new.team_id is null then
        raise exception 'Не определена команда автоматической операции';
      end if;
      if new.type in ('income', 'expense')
         and new.team_id is not null
         and not exists (
           select 1 from public.account_teams att
            where att.account_id = account_row.id
              and att.team_id = new.team_id
         ) then
        raise exception 'Команда не привязана к этому счёту';
      end if;
    end if;

    if new.client_id is not null and not exists (
      select 1 from public.clients
       where id = new.client_id and tenant_id = new.tenant_id
    ) then
      raise exception 'Клиент финансовой операции не найден';
    end if;
    if new.master_id is not null and new.team_id is not null and not exists (
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

-- ─── 7. Templates may target any account serving their team ──────────
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
  if not public.account_serves_team(template_account.id, new.brigade_id) then
    raise exception 'Счёт шаблона недоступен этой команде';
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

-- ─── 8. Account history guard: scope is frozen with history ──────────
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
  if new.scope is distinct from old.scope and exists (
    select 1 from public.finance_transactions where account_id = old.id
  ) then
    raise exception 'Тип охвата счёта с операциями нельзя изменить';
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

-- ─── 9. Appointment auto-income routing prefers the team's own account ─
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

  select a.id into account_id
    from public.accounts a
   where a.tenant_id = p_tenant_id
     and a.kind = required_kind
     and a.is_active = true
     and (
       (a.scope = 'team' and a.brigade_id = p_team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = p_team_id
       ))
     )
   order by (a.scope = 'team') desc, a.position, a.id
   limit 1;
  if account_id is null then
    raise exception 'Для этого способа оплаты нет активного счёта команды';
  end if;
  return account_id;
end;
$function$;

-- ─── 10. Transfers: team↔company and company↔company are legal ───────
-- Each leg carries the team of ITS account (NULL on a company leg); a direct
-- team-A↔team-B transfer stays forbidden — that money must route through a
-- company account to keep per-team attribution honest.
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
            and team_id is not distinct from (
              select brigade_id from public.accounts where id = p_from_account_id
            )
            and amount = -normalized_amount
       ) or not exists (
         select 1 from public.finance_transactions
          where transfer_group_id = p_request_id
            and tenant_id = tenant_uuid and account_id = p_to_account_id
            and team_id is not distinct from (
              select brigade_id from public.accounts where id = p_to_account_id
            )
            and amount = normalized_amount
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
  if from_account.scope = 'team' and to_account.scope = 'team'
     and from_account.brigade_id <> to_account.brigade_id then
    raise exception 'Перевод между командами идёт через счёт компании';
  end if;
  if from_account.brigade_id is not null and not exists (
    select 1 from public.teams
     where id = from_account.brigade_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Команда счетов не найдена';
  end if;
  if to_account.brigade_id is not null and not exists (
    select 1 from public.teams
     where id = to_account.brigade_id and tenant_id = tenant_uuid
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
    coalesce(from_account.brigade_id, to_account.brigade_id),
    normalized_amount, transfer_date, normalized_notes, auth.uid()
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
     to_account.brigade_id, normalized_notes, transfer_date,
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
          and team_id is not distinct from (
            select brigade_id from public.accounts where id = request_row.from_account_id
          )
          and amount = -request_row.amount
     ) or not exists (
       select 1 from public.finance_transactions
        where transfer_group_id = p_transfer_group_id
          and tenant_id = tenant_uuid and account_id = request_row.to_account_id
          and team_id is not distinct from (
            select brigade_id from public.accounts where id = request_row.to_account_id
          )
          and amount = request_row.amount
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

-- ─── 11. Invoice payments accept any account serving the invoice team ─
create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_request_id uuid,
  p_amount numeric,
  p_account_id uuid,
  p_payment_method text,
  p_occurred_on date default null,
  p_notes text default null
)
returns public.finance_transactions
language plpgsql
security invoker
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  account_row public.accounts%rowtype;
  payment_row public.finance_transactions%rowtype;
  income_total numeric(12,2) := 0;
  direct_refunds numeric(12,2) := 0;
  linked_refunds numeric(12,2) := 0;
  paid_total numeric(12,2) := 0;
  remaining_total numeric(12,2) := 0;
  amount_value numeric(12,2);
  payment_date date;
  affected integer := 0;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Недостаточно прав для оплаты инвойса';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор платежа';
  end if;

  amount_value := round(p_amount, 2);
  if amount_value is null or amount_value <= 0 then
    raise exception 'Сумма платежа должна быть больше нуля';
  end if;
  if amount_value is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  if amount_value > 999999999.99 then
    raise exception 'Сумма платежа слишком большая';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Некорректный способ оплаты';
  end if;
  payment_date := coalesce(
    p_occurred_on,
    public.tenant_business_date(tenant_uuid)
  );
  if payment_date > public.tenant_business_date(tenant_uuid) then
    raise exception 'Платёж нельзя записать будущей датой';
  end if;

  -- Idempotent network retry: return the payment committed by this request.
  select * into payment_row
    from public.finance_transactions
   where id = p_request_id
     and tenant_id = tenant_uuid
     and invoice_id = p_invoice_id
     and type = 'income';
  if found then
    if payment_row.amount <> amount_value
       or payment_row.account_id is distinct from p_account_id
       or payment_row.payment_method is distinct from p_payment_method
       or payment_row.occurred_on <> payment_date
       or (
         nullif(btrim(p_notes), '') is not null
         and payment_row.notes is distinct from nullif(btrim(p_notes), '')
       ) then
      raise exception 'Идентификатор платежа уже использован с другими данными';
    end if;
    return payment_row;
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_invoice_id
     and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден или недоступен';
  end if;

  -- A concurrent retry can pass the optimistic lookup before the first
  -- request commits, then wait here on the invoice lock. Recheck after the
  -- lock so that retry returns the committed row instead of a UUID conflict.
  select * into payment_row
    from public.finance_transactions
   where id = p_request_id
     and tenant_id = tenant_uuid
     and invoice_id = p_invoice_id
     and type = 'income';
  if found then
    if payment_row.amount <> amount_value
       or payment_row.account_id is distinct from p_account_id
       or payment_row.payment_method is distinct from p_payment_method
       or payment_row.occurred_on <> payment_date
       or (
         nullif(btrim(p_notes), '') is not null
         and payment_row.notes is distinct from nullif(btrim(p_notes), '')
       ) then
      raise exception 'Идентификатор платежа уже использован с другими данными';
    end if;
    return payment_row;
  end if;

  if invoice_row.status = 'void' then
    raise exception 'Аннулированный инвойс нельзя оплачивать';
  end if;

  select * into account_row
    from public.accounts
   where id = p_account_id
     and tenant_id = tenant_uuid
     and is_active = true;
  if not found then
    raise exception 'Финансовый счёт не найден или закрыт';
  end if;
  if account_row.kind <> (case p_payment_method
       when 'cash' then 'cash'
       when 'card' then 'card'
       when 'transfer' then 'bank'
       else 'other'
     end) then
    raise exception 'Способ оплаты не соответствует выбранному счёту';
  end if;
  if invoice_row.brigade_id is not null
     and not public.account_serves_team(account_row.id, invoice_row.brigade_id) then
    raise exception 'Счёт должен принадлежать команде инвойса';
  end if;

  select
    coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
    coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0)
    into income_total, direct_refunds
    from public.finance_transactions
   where tenant_id = tenant_uuid
     and invoice_id = p_invoice_id
     and type in ('income', 'refund');

  -- Older refund writers only set refund_of_id. Count those too, but not a
  -- refund already selected above through its own invoice_id.
  select coalesce(sum(abs(refund.amount)), 0)
    into linked_refunds
    from public.finance_transactions refund
    join public.finance_transactions original
      on original.id = refund.refund_of_id
   where original.tenant_id = tenant_uuid
     and original.invoice_id = p_invoice_id
     and original.type = 'income'
     and refund.tenant_id = tenant_uuid
     and refund.type = 'refund'
     and refund.invoice_id is null;

  paid_total := greatest(
    0,
    case
      when invoice_row.status = 'paid'
        then greatest(invoice_row.total, income_total)
      else income_total
    end - direct_refunds - linked_refunds
  );
  remaining_total := greatest(0, invoice_row.total - paid_total);

  if remaining_total <= 0 then
    raise exception 'Инвойс уже полностью оплачен';
  end if;
  if amount_value > remaining_total then
    raise exception 'Платёж превышает остаток % %', round(remaining_total, 2), invoice_row.currency;
  end if;

  insert into public.finance_transactions (
    id,
    tenant_id,
    type,
    amount,
    currency,
    account_id,
    appointment_id,
    client_id,
    team_id,
    payment_method,
    notes,
    occurred_on,
    invoice_id,
    source
  ) values (
    p_request_id,
    tenant_uuid,
    'income',
    amount_value,
    invoice_row.currency,
    account_row.id,
    invoice_row.appointment_id,
    invoice_row.client_id,
    coalesce(invoice_row.brigade_id, account_row.brigade_id),
    p_payment_method,
    coalesce(nullif(btrim(p_notes), ''), 'Оплата инвойса ' || invoice_row.number),
    payment_date,
    invoice_row.id,
    'manual'
  )
  returning * into payment_row;

  update public.invoices
     set status = case
       when paid_total + amount_value >= invoice_row.total then 'paid'
       else 'issued'
     end
   where id = invoice_row.id
     and tenant_id = tenant_uuid;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Статус инвойса не обновлён';
  end if;

  return payment_row;
end;
$function$;

create or replace function public.validate_invoice_payment_insert()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
declare
  invoice_row public.invoices%rowtype;
  original_row public.finance_transactions%rowtype;
  income_total numeric := 0;
  direct_refunds numeric := 0;
  linked_refunds numeric := 0;
  paid_total numeric := 0;
  remaining_total numeric := 0;
  refunded_original numeric := 0;
  account_team_id text;
  account_kind text;
begin
  if new.type = 'refund' and new.refund_of_id is not null then
    select * into original_row
      from public.finance_transactions
     where id = new.refund_of_id
       and tenant_id = new.tenant_id
       and type = 'income'
     for update;
    if not found then
      raise exception 'Исходный доход для возврата не найден';
    end if;
    if new.invoice_id is not null
       and new.invoice_id is distinct from original_row.invoice_id then
      raise exception 'Возврат относится к другому инвойсу';
    end if;
    if abs(new.amount) <= 0 then
      raise exception 'Сумма возврата должна быть больше нуля';
    end if;
    new.amount := -round(abs(new.amount), 2);
    if new.account_id is distinct from original_row.account_id
       or (
         new.team_id is not null
         and new.team_id is distinct from original_row.team_id
       ) then
      raise exception 'Возврат должен пройти по исходному счёту и команде';
    end if;
    if new.payment_method is not null
       and new.payment_method is distinct from original_row.payment_method then
      raise exception 'Возврат должен использовать способ исходного платежа';
    end if;

    select coalesce(sum(abs(amount)), 0) into refunded_original
      from public.finance_transactions
     where refund_of_id = original_row.id
       and type = 'refund';
    if refunded_original + abs(new.amount) > greatest(original_row.amount, 0) then
      raise exception 'Возврат превышает остаток исходного дохода';
    end if;

    new.invoice_id := original_row.invoice_id;
    new.currency := original_row.currency;
    new.appointment_id := original_row.appointment_id;
    new.client_id := original_row.client_id;
    new.team_id := original_row.team_id;
    new.master_id := original_row.master_id;
    new.payment_method := original_row.payment_method;
    if new.invoice_id is not null then
      select * into invoice_row
        from public.invoices
       where id = new.invoice_id
         and tenant_id = new.tenant_id
       for update;
      if not found or invoice_row.status = 'void' then
        raise exception 'Инвойс для возврата не найден или аннулирован';
      end if;
    end if;
    return new;
  end if;

  if new.invoice_id is null then
    return new;
  end if;
  if new.type <> 'income' or new.source <> 'manual' then
    raise exception 'К инвойсу можно добавить только ручной платёж или корректный возврат';
  end if;
  if new.amount <= 0 then
    raise exception 'Сумма платежа должна быть больше нуля';
  end if;
  if new.refund_of_id is not null or new.transfer_group_id is not null then
    raise exception 'Платёж инвойса не может быть возвратом или переводом';
  end if;
  if new.payment_method is null
     or new.payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Некорректный способ оплаты инвойса';
  end if;

  select * into invoice_row
    from public.invoices
   where id = new.invoice_id
     and tenant_id = new.tenant_id
   for update;
  if not found or invoice_row.status = 'void' then
    raise exception 'Инвойс не найден или аннулирован';
  end if;
  select brigade_id, kind into account_team_id, account_kind
    from public.accounts
   where id = new.account_id
     and tenant_id = new.tenant_id
     and is_active = true;
  if not found or (
    invoice_row.brigade_id is not null
    and not public.account_serves_team(new.account_id, invoice_row.brigade_id)
  ) then
    raise exception 'Финансовый счёт не найден или не относится к команде инвойса';
  end if;
  if account_kind <> (case new.payment_method
       when 'cash' then 'cash'
       when 'card' then 'card'
       when 'transfer' then 'bank'
       else 'other'
     end) then
    raise exception 'Способ оплаты не соответствует выбранному счёту';
  end if;

  new.currency := invoice_row.currency;
  new.appointment_id := invoice_row.appointment_id;
  new.client_id := invoice_row.client_id;
  new.team_id := coalesce(invoice_row.brigade_id, account_team_id);

  select
    coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
    coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0)
    into income_total, direct_refunds
    from public.finance_transactions
   where invoice_id = invoice_row.id
     and type in ('income', 'refund');
  select coalesce(sum(abs(refund.amount)), 0) into linked_refunds
    from public.finance_transactions refund
    join public.finance_transactions original on original.id = refund.refund_of_id
   where original.invoice_id = invoice_row.id
     and original.type = 'income'
     and refund.type = 'refund'
     and refund.invoice_id is null;
  paid_total := greatest(
    0,
    case
      when invoice_row.status = 'paid' then greatest(invoice_row.total, income_total)
      else income_total
    end - direct_refunds - linked_refunds
  );
  remaining_total := greatest(0, invoice_row.total - paid_total);
  if remaining_total <= 0 or new.amount > remaining_total then
    raise exception 'Платёж превышает остаток инвойса';
  end if;
  return new;
end;
$function$;

-- ─── 12. Safe account picker for payment surfaces ────────────────────
-- Slim projection, no balances and no balance_hidden: masters see the names
-- of accounts they can receive money into, never the money itself.
create or replace function public.list_payment_accounts_safe(p_team_id text)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id,
    'name', a.name,
    'kind', a.kind,
    'scope', a.scope,
    'icon', a.icon,
    'color', a.color,
    'position', a.position
  )
    from public.accounts a
   where p_team_id is not null
     and btrim(p_team_id) <> ''
     and a.tenant_id = public.current_tenant_id()
     and a.is_active = true
     and (
       public.current_user_role() in ('owner', 'dispatcher')
       or p_team_id = any(public.current_user_team_ids())
     )
     and (
       (a.scope = 'team' and a.brigade_id = p_team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = p_team_id
       ))
     )
   order by (a.scope = 'team') desc, a.position, a.name, a.id
$$;
revoke all on function public.list_payment_accounts_safe(text)
  from public, anon;
grant execute on function public.list_payment_accounts_safe(text)
  to authenticated;

-- ─── 13. Deploy assertions ───────────────────────────────────────────
do $audit$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.accounts'::regclass
       and conname in ('accounts_scope_check', 'accounts_scope_brigade_check')
     having count(*) = 2
  ) then
    raise exception 'shared accounts: scope constraints are missing';
  end if;
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.accounts'::regclass
       and attname = 'brigade_id'
       and attnotnull
  ) then
    raise exception 'shared accounts: brigade_id is still NOT NULL';
  end if;
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.finance_transfer_requests'::regclass
       and attname = 'team_id'
       and attnotnull
  ) then
    raise exception 'shared accounts: transfer request team_id is still NOT NULL';
  end if;
  if not exists (
    select 1 from pg_class
     where oid = 'public.account_teams'::regclass
       and relrowsecurity
  ) then
    raise exception 'shared accounts: account_teams RLS is disabled';
  end if;
  if has_table_privilege('authenticated', 'public.account_teams', 'UPDATE') then
    raise exception 'shared accounts: account_teams rows must be immutable';
  end if;
  if has_function_privilege(
       'anon', 'public.account_serves_team(uuid,text)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.list_payment_accounts_safe(text)', 'EXECUTE'
     ) then
    raise exception 'shared accounts: helper is callable by anon';
  end if;
  if (select count(*) from pg_trigger
       where not tgisinternal
         and tgname = 'trg_assert_account_team_integrity') <> 1 then
    raise exception 'shared accounts: account_teams trigger is missing';
  end if;
  if to_regclass('public.ux_accounts_team_name') is null
     or to_regclass('public.ux_accounts_company_name') is null
     or to_regclass('public.idx_finance_tx_account_occurred') is null then
    raise exception 'shared accounts: expected indexes are missing';
  end if;
end;
$audit$;
