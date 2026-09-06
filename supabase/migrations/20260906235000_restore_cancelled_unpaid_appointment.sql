-- Восстановление отменённой заявки без денег.
--
-- Владелец 2026-09-06: в меню долгого нажатия календаря у отменённой записи
-- есть «Восстановить». На проде оно падало: protect_paid_appointment_finance
-- считал ЛЮБОЙ выход из status = 'cancelled' изменением возвращённой оплаты
-- (financial_fields_changed включает смену статуса) и бросал «Возвращённую
-- оплату нельзя изменить; создайте новую заявку» — даже у заявки, где денег
-- не было вовсе (payment_status = 'unpaid', предоплаты и проводок нет).
--
-- Правка одна: заморозка распространяется на возвращённые деньги (refunded)
-- и на отменённые заявки с предоплатой/доплатой/проводками; отменённая
-- заявка без денег возвращается в план. Остальное тело функции — без
-- изменений относительно 20260906120000_appointment_payment_rpcs.sql.

create or replace function public.protect_paid_appointment_finance()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  has_any_auto_income boolean := false;
  has_linked_finance boolean := false;
  has_settlement boolean := false;
  undo_context boolean := false;
  prepayment_context boolean := false;
  payment_reset_context boolean := false;
  invoice_payment_context boolean := false;
  payment_cancel_context boolean := false;
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
  -- Деньги уже проведены платежом (или возвратом) по инвойсу; заявка лишь
  -- отражает их у себя, и своих проводок здесь не рождается.
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'invoice_payment'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into invoice_payment_context;
  -- Платёж снят RPC `cancel_appointment_payment`: сторно уже написано, зеркала
  -- пересчитала сама RPC — сторож пропускает так же, как сброс оплаты.
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_payment_cancel'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into payment_cancel_context;
  if undo_context or payment_reset_context or invoice_payment_context
     or payment_cancel_context then
    return new;
  end if;

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

  if prepayment_context and not has_settlement then
    return new;
  end if;

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

  if not has_settlement and not (
    old.status = 'completed' and old.payment_status = 'paid'
  ) then
    -- Заморожены только ДЕНЬГИ: возвращённая оплата (refunded) и отменённая
    -- заявка, у которой были предоплата, доплата или проводки. Отменённую
    -- заявку БЕЗ денег можно вернуть в план («Восстановить» в меню долгого
    -- нажатия, владелец 2026-09-06): раньше любой выход из cancelled падал
    -- здесь как «изменение возвращённой оплаты», хотя оплаты не было.
    if old.payment_status = 'refunded'
       or (old.status = 'cancelled' and (
         has_linked_finance
         or old.prepaid_amount > 0
         or old.paid_amount > 0
         or old.payment_status in ('partial', 'paid')
       )) then
      if financial_fields_changed and not is_cancel_transition then
        raise exception 'Возвращённую оплату нельзя изменить; создайте новую заявку';
      end if;
    end if;
    return new;
  end if;

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
$$;
