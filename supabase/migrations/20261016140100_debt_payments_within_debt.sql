-- ПЛАТЕЖИ ПО ДОЛГУ НЕ БОЛЬШЕ САМОГО ДОЛГА.
--
-- Остаток долга — сумма минус Σ |платежей| (`debt_id`). Сервер не ограничивал
-- ни платёж, ни правку суммы долга: оплата €700 по остатку €600 уходила в
-- доход и на счёт, остаток становился −€100, и строка долга пропадала из
-- списка — переплату нигде не было видно. То же давали правка платежа вверх,
-- «Вернуть» платёж из корзины после повторной оплаты и уменьшение суммы долга
-- ниже уже уплаченного со второго телефона.
--
-- Считает определитель (security definer): партнёр может не видеть часть
-- платежей по окну финансов, а лимит обязан учитывать все. Строка долга
-- блокируется — две оплаты разом не проскочат вместе.

create or replace function public.guard_debt_payment_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_debt public.debts%rowtype;
  v_paid numeric;
begin
  if new.debt_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.debt_id is not distinct from old.debt_id
     and abs(new.amount) <= abs(old.amount) then
    return new;
  end if;

  select * into v_debt from public.debts where id = new.debt_id for update;
  if not found then
    return new;
  end if;

  select coalesce(sum(abs(tx.amount)), 0) into v_paid
    from public.finance_transactions tx
   where tx.debt_id = new.debt_id
     and tx.id <> new.id;

  if v_paid + abs(new.amount) > v_debt.amount then
    raise exception 'По долгу осталось % — платёж не может быть больше', greatest(v_debt.amount - v_paid, 0)
      using errcode = 'P0001', hint = 'debt:overpay';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_debt_payment_total() from public, anon, authenticated;

drop trigger if exists trg_guard_debt_payment_total on public.finance_transactions;
create trigger trg_guard_debt_payment_total
  before insert or update of amount, debt_id on public.finance_transactions
  for each row execute function public.guard_debt_payment_total();

create or replace function public.guard_debt_amount_not_below_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_paid numeric;
begin
  if new.amount >= old.amount then
    return new;
  end if;
  select coalesce(sum(abs(tx.amount)), 0) into v_paid
    from public.finance_transactions tx
   where tx.debt_id = new.id;
  if new.amount < v_paid then
    raise exception 'По долгу уже уплачено % — сумма долга не может стать меньше', v_paid
      using errcode = 'P0001', hint = 'debt:below_paid';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_debt_amount_not_below_paid() from public, anon, authenticated;

drop trigger if exists trg_guard_debt_amount_not_below_paid on public.debts;
create trigger trg_guard_debt_amount_not_below_paid
  before update of amount on public.debts
  for each row execute function public.guard_debt_amount_not_below_paid();

-- Удаление долга с платежом на закрытом счёте отбивалось чужими словами
-- («Сначала снова откройте финансовый счёт»): каскад SET NULL — это UPDATE
-- платежа. Живое тело функции, одна вставка в начале.
CREATE OR REPLACE FUNCTION public.assert_finance_transaction_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Удаление долга отвязывает его платежи (`debt_id ON DELETE SET NULL`). Это
  -- не движение денег: закрытый счёт платежа не должен держать удаление долга
  -- отказом «Сначала снова откройте финансовый счёт».
  if tg_op = 'UPDATE'
     and old.debt_id is not null
     and new.debt_id is null
     and (to_jsonb(new) - 'debt_id' - 'updated_at') = (to_jsonb(old) - 'debt_id' - 'updated_at') then
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
    -- Сумму дохода нельзя опустить ниже уже возвращённого: иначе по леджеру
    -- вернули больше, чем получали.
    if old.type = 'income' and new.amount < old.amount then
      select coalesce(sum(abs(refund.amount)), 0)
        into already_refunded
        from public.finance_transactions refund
       where refund.refund_of_id = old.id
         and refund.type = 'refund';
      if already_refunded > new.amount then
        raise exception 'По этому доходу уже возвращено %; сумма не может стать меньше', already_refunded;
      end if;
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

  -- Доход с возвратами не удаляется: FK on delete set null оставил бы
  -- возвраты-сироты, которые продолжают минусовать счёт без своего дохода.
  if tg_op = 'DELETE' and old.type = 'income' and exists (
    select 1 from public.finance_transactions refund
     where refund.refund_of_id = old.id and refund.type = 'refund'
  ) then
    raise exception 'У этого дохода есть возвраты; сначала удалите сами возвраты';
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
           and (category.tenant_id is null or category.tenant_id = new.tenant_id) and (category.team_id is null or new.team_id is null or category.team_id = new.team_id)
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
