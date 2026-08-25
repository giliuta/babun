-- ОТКАЗ ОТ ИНВОЙСА ПОСЛЕ ПОЛНОГО ВОЗВРАТА.
--
-- Аннулирование блокировалось САМИМ ФАКТОМ платежа: «Инвойс с платежами
-- нельзя аннулировать» — даже когда деньги уже вернули полностью и по счёту
-- снова ноль. Один ошибочный платёж навсегда лишал документ кнопки «отказ»
-- (владелец 2026-08-09: «кнопка отказа от инвойса и автоматически создаётся
-- credit note»).
--
-- Правильный вопрос не «были ли платежи», а «остались ли у нас его деньги».
-- Запрет теперь считает СУММУ: приход плюс возвраты (возврат хранится
-- отрицательным). Ноль — документ можно закрыть; больше нуля — сначала
-- верните оплату.
--
-- Правило живёт в двух местах, и оба поправлены: RPC void_invoice и триггер
-- prevent_settled_invoice_rewrite (у него net_paid уже считался — им и
-- пользуемся вместо «были ли вообще проводки»).

create or replace function public.void_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
set search_path to 'public'
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  settled numeric := 0;
  affected integer := 0;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Недостаточно прав для аннулирования инвойса';
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_invoice_id
     and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден или недоступен';
  end if;
  if invoice_row.status = 'void' then
    return invoice_row;
  end if;
  if invoice_row.status <> 'issued' then
    raise exception 'Оплаченный инвойс нельзя аннулировать';
  end if;

  -- Деньги, оставшиеся у нас по этому документу: приход + возвраты.
  select coalesce(sum(t.amount), 0) into settled
    from public.finance_transactions t
   where t.tenant_id = tenant_uuid
     and t.invoice_id = invoice_row.id
     and t.type in ('income', 'refund');

  -- Возврат мог быть заведён без ссылки на инвойс — тогда он привязан к самой
  -- проводке прихода. Учитываем и такие.
  select settled + coalesce(sum(refund.amount), 0) into settled
    from public.finance_transactions refund
    join public.finance_transactions original
      on original.id = refund.refund_of_id
   where original.tenant_id = tenant_uuid
     and original.invoice_id = invoice_row.id
     and refund.tenant_id = tenant_uuid
     and refund.type = 'refund'
     and refund.invoice_id is null;

  if settled > 0 then
    raise exception 'По инвойсу получено % — сначала верните оплату', settled;
  end if;

  update public.invoices
     set status = 'void'
   where id = invoice_row.id
     and tenant_id = tenant_uuid
     and status = 'issued'
  returning * into invoice_row;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Аннулирование инвойса не подтверждено';
  end if;
  return invoice_row;
end;
$$;

-- Тот же вопрос в триггере: net_paid у него уже посчитан, им и пользуемся.
create or replace function public.prevent_settled_invoice_rewrite()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  income_total numeric := 0;
  direct_refunds numeric := 0;
  linked_refunds numeric := 0;
  net_paid numeric := 0;
  has_ledger boolean := false;
begin
  -- Never interpret an RLS-hidden tenant row as deletion. Only the
  -- service-role cleanup may bypass, and only after the parent is truly gone.
  if auth.role() = 'service_role'
     and not exists (
    select 1 from public.tenants tenant where tenant.id = old.tenant_id
  ) then
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'void' then
      raise exception 'Аннулированный инвойс нельзя открыть повторно';
    end if;

    select
      coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
      coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0),
      count(*) > 0
      into income_total, direct_refunds, has_ledger
      from public.finance_transactions
     where invoice_id = old.id
       and type in ('income', 'refund');
    select coalesce(sum(abs(refund.amount)), 0)
      into linked_refunds
      from public.finance_transactions refund
      join public.finance_transactions original on original.id = refund.refund_of_id
     where original.invoice_id = old.id
       and original.type = 'income'
       and refund.type = 'refund'
       and refund.invoice_id is null;
    has_ledger := has_ledger or linked_refunds > 0;
    net_paid := greatest(0, income_total - direct_refunds - linked_refunds);

    if old.status = 'paid' and not has_ledger then
      raise exception 'Архивный оплаченный инвойс нельзя изменить без журнала платежей';
    elsif new.status = 'paid' and net_paid < new.total then
      raise exception 'Статус «Оплачен» требует подтверждённых платежей на всю сумму';
    elsif new.status = 'issued' and net_paid >= new.total then
      raise exception 'Полностью оплаченный инвойс нельзя отметить неоплаченным';
    -- Аннулировать нельзя, пока деньги У НАС. Полностью возвращённый платёж
    -- документ не держит: в кассе по нему ноль.
    elsif new.status = 'void' and (old.status <> 'issued' or net_paid > 0) then
      raise exception 'Инвойс с полученной оплатой нельзя аннулировать — сначала верните деньги';
    elsif new.status not in ('issued', 'paid', 'void') then
      raise exception 'Некорректный статус инвойса';
    end if;
  end if;

  if row(
    new.tenant_id,
    new.number,
    new.year,
    new.seq,
    new.issued_on,
    new.due_on,
    new.client_id,
    new.appointment_id,
    new.brigade_id,
    new.subtotal_net,
    new.vat_percent,
    new.vat_amount,
    new.total,
    new.currency,
    new.notes,
    new.created_by
  ) is distinct from row(
    old.tenant_id,
    old.number,
    old.year,
    old.seq,
    old.issued_on,
    old.due_on,
    old.client_id,
    old.appointment_id,
    old.brigade_id,
    old.subtotal_net,
    old.vat_percent,
    old.vat_amount,
    old.total,
    old.currency,
    old.notes,
    old.created_by
  ) and (
    old.status <> 'issued' or exists (
      select 1
        from public.finance_transactions
       where invoice_id = old.id
         and type in ('income', 'refund')
    ) or exists (
      select 1
        from public.finance_transactions refund
        join public.finance_transactions original on original.id = refund.refund_of_id
       where original.invoice_id = old.id
         and original.type = 'income'
         and refund.type = 'refund'
    )
  ) then
    raise exception 'Инвойс с платежами нельзя редактировать';
  end if;
  return new;
end;
$$;
