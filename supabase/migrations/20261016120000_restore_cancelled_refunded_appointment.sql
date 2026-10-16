-- ОТМЕНЁННУЮ ЗАЯВКУ С ВОЗВРАЩЁННЫМИ ДЕНЬГАМИ МОЖНО ВОССТАНОВИТЬ.
--
-- Отмена визита с деньгами — это возврат: сторож ставит заявке «возвращено»,
-- а сверка пишет на каждый авто-доход равное сторно, итог заявки в финансах —
-- ноль. После этого «Восстановить» падало: смена статуса считалась правкой
-- денег возвращённой оплаты («создайте новую заявку»), и отмена оказывалась
-- необратимой.
--
-- Теперь возврат статуса из «отменена» — это визит обратно в план, а его
-- деньги начинают новый круг с нуля: «не оплачено», без предоплаты, доплаты,
-- способа, счёта и строк платежей. Зеркала обнуляются самим сторожем — иначе
-- заявка показывала бы деньги, которых уже нет, а сверка на следующем
-- платеже не сошлась бы с журналом. История (доходы и их сторно) не
-- трогается: сверка при восстановлении видит цель ноль и проведённый ноль и
-- ничего не пишет. Новый платёж идёт обычной дверью, повторная отмена снова
-- вернёт уже его.
--
-- Отказ остаётся, пока на заявке лежат деньги, которые отмена не вернула
-- (доход, возвращённый не целиком, — например, ручной): обнулённые зеркала
-- разошлись бы с журналом.
--
-- Тело — боевое; добавлена одна ветка сразу после контекстов денежных
-- дверей. Триггер, владелец и права не меняются. Перед заменой сторож сверяет
-- `md5(prosrc)` живого тела с тем, на котором построена правка: чужая
-- миграция, успевшая переписать функцию, не будет молча откачена.
--
-- Новый круг денег после восстановления может начаться и с предоплаты.
-- `record_appointment_payment` запрещал предоплату, если у заявки когда-либо
-- была авто-доплата, даже возвращённая целиком (отмена визита, «деньги не
-- поступили»). Теперь в счёт идёт только доплата, возвращённая не целиком, —
-- так же, как считает сторож. Правка — точечная замена в боевом теле со
-- сверкой `md5`; якорь обязан встретиться ровно один раз.

do $$
begin
  if (select md5(prosrc) from pg_proc
       where oid = 'public.protect_paid_appointment_finance()'::regprocedure)
     is distinct from '5368f274e264613c0851e54b9a6efed5' then
    raise exception 'protect_paid_appointment_finance изменилась после сверки — пересоберите миграцию от живого тела';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.protect_paid_appointment_finance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Полученное по НОВОЙ строке, без оглядки на статус.
  received_now numeric := 0;
  -- Статус сам сходил за изменившимся итогом — эта смена разрешена.
  status_follows_total boolean := false;
  -- Работы и цену править можно: деньги получены, леджер не тронут, итог их
  -- покрывает.
  bill_edit_allowed boolean := false;
  -- Номер инвойса, деньги которого ещё лежат на заявке.
  invoice_money_number text;
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
  -- Доплата, возвращённая целиком («деньги не поступили»), доплатой больше не
  -- считается.
  select exists (
    select 1 from public.finance_transactions income
     where income.appointment_id = old.id
       and income.source = 'auto'
       and income.type = 'income'
       and coalesce(income.appointment_payment_kind, 'settlement') = 'settlement'
       and income.amount > coalesce((
         select sum(abs(refund.amount))
           from public.finance_transactions refund
          where refund.refund_of_id = income.id
            and refund.type = 'refund'
       ), 0)
  ) into has_settlement;
  -- КЛИЕНТ, КОМАНДА И ИСПОЛНИТЕЛЬ — ПОКА НА ЗАЯВКЕ ЖИВЫЕ ДЕНЬГИ (03.10).
  -- Раньше держала ЛЮБАЯ строка финансов, и снятая оплата («деньги не
  -- поступили» — доход и равный ему возврат) запирала клиента навсегда, хотя
  -- ответ обещает обратное: «Сначала верните оплату». Теперь держат доход,
  -- возвращённый не целиком, любая иная строка финансов заявки и инвойс.
  -- Сторно остаётся в истории со своим клиентом.
  if (
    exists (
      select 1 from public.finance_transactions income
       where income.appointment_id = old.id
         and income.type = 'income'
         and income.amount > coalesce((
           select sum(abs(refund.amount))
             from public.finance_transactions refund
            where refund.refund_of_id = income.id
              and refund.type = 'refund'
         ), 0)
    )
    or exists (
      select 1 from public.finance_transactions other
       where other.appointment_id = old.id
         and other.type not in ('income', 'refund')
    )
    or exists (select 1 from public.invoices where appointment_id = old.id)
  ) and (
    new.client_id is distinct from old.client_id
    or new.team_id is distinct from old.team_id
    or new.master_id is distinct from old.master_id
  ) then
    raise exception 'Сначала верните оплату; клиента, команду и исполнителя менять нельзя';
  end if;
  -- ОТМЕНА С ДЕНЬГАМИ ИНВОЙСА. Платёж инвойса — ручная строка: сверка его не
  -- вернёт, и заявка стала бы «возвращённой» с деньгами на счёте.
  if (old.status is distinct from 'cancelled' and new.status = 'cancelled')
     or (old.payment_status is distinct from 'refunded' and new.payment_status = 'refunded') then
    select i.number into invoice_money_number
      from public.invoices i
     where i.appointment_id = old.id
       and i.tenant_id = old.tenant_id
       and i.kind = 'invoice'
       and coalesce((
         select sum(tx.amount)
           from public.finance_transactions tx
           left join public.finance_transactions original
             on original.id = tx.refund_of_id
          where tx.tenant_id = old.tenant_id
            and tx.source = 'manual'
            and tx.type in ('income', 'refund')
            and coalesce(tx.invoice_id, original.invoice_id) = i.id
       ), 0) > 0
     order by i.issued_on, i.number
     limit 1;
    if invoice_money_number is not null then
      raise exception 'Сначала верните оплату инвойса %', invoice_money_number;
    end if;
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
  -- Деньги уже проведены платежом (или возвратом) по инвойсу.
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'invoice_payment'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into invoice_payment_context;
  -- Платёж снят RPC `cancel_appointment_payment`: сторно уже написано.
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
  -- ВОССТАНОВЛЕНИЕ ПОСЛЕ ОТМЕНЫ С ВОЗВРАТОМ. Деньги прошлого круга уже
  -- вернула отмена (доход и его сторно), поэтому визит возвращается с
  -- чистыми зеркалами — дальше это обычная неоплаченная заявка. Пока на
  -- заявке есть доход, возвращённый не целиком, обнулять нечестно.
  if old.status = 'cancelled'
     and new.status is distinct from 'cancelled'
     and old.payment_status = 'refunded' then
    if exists (
      select 1 from public.finance_transactions income
       where income.appointment_id = old.id
         and income.type = 'income'
         and income.amount > coalesce((
           select sum(abs(refund.amount))
             from public.finance_transactions refund
            where refund.refund_of_id = income.id
              and refund.type = 'refund'
         ), 0)
    ) then
      raise exception 'По заявке остались невозвращённые деньги; сначала верните их';
    end if;
    new.payment_status := 'unpaid';
    new.prepaid_amount := 0;
    new.paid_amount := 0;
    new.payment_method := null;
    new.payment_account_id := null;
    new.payment := null;
    new.payments := '[]'::jsonb;
    new.prepayments := '[]'::jsonb;
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
  -- СТАТУС ИДЁТ ЗА ИТОГОМ. Итог вырос выше полученного — заявка частично
  -- оплачена; опустился до полученного — оплачена. Деньги не трогаются: цель
  -- проводки у `partial` равна уже полученному.
  --
  -- Только когда деньги ДЕЙСТВИТЕЛЬНО получены: у заявки, помеченной
  -- оплаченной без единого платежа, полученное равно нулю, и падение в
  -- `unpaid` подсказало бы сверке вернуть несуществующий доход.
  received_now := coalesce(new.prepaid_amount, 0) + coalesce(new.paid_amount, 0);
  if new.status <> 'cancelled'
     and new.payment_status <> 'refunded'
     and old.payment_status in ('paid', 'partial')
     and new.payment_status is not distinct from old.payment_status
     and new.total_amount is distinct from old.total_amount
     and new.paid_amount is not distinct from old.paid_amount
     and new.prepaid_amount is not distinct from old.prepaid_amount
     and coalesce(new.paid_amount, 0) > 0
     and received_now > 0 then
    new.payment_status := case
      when new.total_amount > 0 and received_now >= new.total_amount then 'paid'
      else 'partial'
    end;
    status_follows_total := new.payment_status is distinct from old.payment_status;
  end if;
  bill_edit_allowed :=
    new.status <> 'cancelled'
    and new.payment_status <> 'refunded'
    and coalesce(new.paid_amount, 0) > 0
    and new.payment_status in ('paid', 'partial')
    and new.paid_amount is not distinct from old.paid_amount
    and new.prepaid_amount is not distinct from old.prepaid_amount
    and new.payment is not distinct from old.payment
    and new.payments is not distinct from old.payments
    and new.total_amount >= received_now;
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
    -- Заморожены только ДЕНЬГИ: возвращённая оплата и отменённая заявка, у
    -- которой были предоплата, доплата или проводки.
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
     or new.payment_method is distinct from old.payment_method
     or new.prepaid_amount is distinct from old.prepaid_amount
     or new.payment is distinct from old.payment
     or new.payments is distinct from old.payments
     or (new.status is distinct from old.status and not is_cancel_transition)
     or (new.paid_amount is distinct from old.paid_amount and not is_refund_transition)
     or (
       new.payment_status is distinct from old.payment_status
       and not is_refund_transition
       and not status_follows_total
     )
     or ((old.status = 'cancelled' or old.payment_status = 'refunded') and
       (new.status is distinct from old.status or new.payment_status is distinct from old.payment_status))
     -- РАБОТЫ И ЦЕНА: замораживаются только когда правка не разрешена.
     or (not bill_edit_allowed and (
       new.total_amount is distinct from old.total_amount
       or new.custom_total is distinct from old.custom_total
       or new.discount_amount is distinct from old.discount_amount
       or new.services is distinct from old.services
       or new.service_ids is distinct from old.service_ids
       or new.service_price_overrides is distinct from old.service_price_overrides
       or new.global_discount is distinct from old.global_discount
     )) then
    raise exception 'Сначала отмените оплату или оформите возврат по заявке';
  end if;
  return new;
end;
$function$;

do $$
declare
  fn constant regprocedure :=
    'public.record_appointment_payment(uuid,uuid,numeric,uuid,text,timestamp with time zone,boolean)'::regprocedure;
  body text;
  anchor constant text := E'  select exists (\n    select 1 from public.finance_transactions\n     where appointment_id = appt.id\n       and source = ''auto''\n       and type = ''income''\n       and coalesce(appointment_payment_kind, ''settlement'') = ''settlement''\n  ) into has_settlement;';
  replacement constant text := E'  select exists (\n    select 1 from public.finance_transactions income\n     where income.appointment_id = appt.id\n       and income.source = ''auto''\n       and income.type = ''income''\n       and coalesce(income.appointment_payment_kind, ''settlement'') = ''settlement''\n       and income.amount > coalesce((\n         select sum(abs(refund.amount))\n           from public.finance_transactions refund\n          where refund.refund_of_id = income.id\n            and refund.type = ''refund''\n       ), 0)\n  ) into has_settlement;';
begin
  if (select md5(prosrc) from pg_proc where oid = fn)
     is distinct from 'b41928e2470b45e4bb2b91b87b2ae84c' then
    raise exception 'record_appointment_payment изменилась после сверки — пересоберите миграцию от живого тела';
  end if;
  body := pg_get_functiondef(fn);
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'record_appointment_payment: якорь доплаты не найден ровно один раз';
  end if;
  execute replace(body, anchor, replacement);
end;
$$;

-- Сторож: ветка восстановления на месте, тело осталось SECURITY DEFINER с
-- прежним search_path, триггер висит на заявках, предоплата смотрит на
-- доплату за вычетом возвратов.
do $$
declare
  fn_src text;
  fn_secdef boolean;
  fn_config text[];
begin
  select p.prosrc, p.prosecdef, p.proconfig
    into fn_src, fn_secdef, fn_config
    from pg_proc p
   where p.oid = 'public.protect_paid_appointment_finance()'::regprocedure;
  if fn_src not like '%new.prepayments := ''[]''::jsonb;%'
     or fn_src not like '%По заявке остались невозвращённые деньги%' then
    raise exception 'protect_paid_appointment_finance: ветка восстановления не применилась';
  end if;
  if not fn_secdef or fn_config is distinct from array['search_path=public'] then
    raise exception 'protect_paid_appointment_finance: изменились security definer или search_path';
  end if;
  if (select prosrc from pg_proc
       where oid = 'public.record_appointment_payment(uuid,uuid,numeric,uuid,text,timestamp with time zone,boolean)'::regprocedure)
     not like '%where refund.refund_of_id = income.id%' then
    raise exception 'record_appointment_payment: доплата не считается за вычетом возвратов';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.appointments'::regclass
       and tgname = 'trg_protect_paid_appointment_finance'
       and not tgisinternal
  ) then
    raise exception 'protect_paid_appointment_finance: триггер на заявках не найден';
  end if;
end;
$$;
