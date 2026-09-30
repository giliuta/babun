-- НДС ЗАПИСИ ВЫКЛЮЧЕН: «с НДС / без НДС» у записи больше ничего не решает
-- (шаг 1 плана «НДС в оплате записи», спецификация 2026-09-15, §8).
--
-- `20260915080000_appointment_vat_choice` дал записи свой выбор налога, сильнее
-- счёта. Разбор показал, что вопрос задан не тому: с налогом или без платит
-- не запись, а КАЖДЫЙ ПЛАТЁЖ — наличные без НДС и карта с НДС бывают у одной
-- заявки. Выбор переезжает на сам платёж (шаг 5), а этот шаг только снимает
-- механизм записи, не заводя ничего нового.
--
-- После миграции налог дохода по записи снова решает `fill_transaction_vat`:
-- счёт → команда → компания, ровно как до 080000. Явного «без НДС» по
-- умолчанию здесь нет — оно придёт на шаге 5 вместе с настройкой счёта; до тех
-- пор плитка оплаты Giliuta даёт тот же НДС, что и сегодня. Ни у одной записи
-- `appointments.vat_mode` не должен быть заполнен — миграция проверяет это
-- сама (сторож ниже) и откатывается, если выбор успели сделать.
--
-- Колонка `appointments.vat_mode` и функция `set_appointment_vat_mode`
-- остаются на один релиз. Ни одна выпущенная сборка их не знает: поле и дверь
-- есть только в незакоммиченном клиенте этого же дня (`makeServerRow`,
-- `useSetAppointmentVat`, `setAppointmentVatMode`), и он уходит тем же
-- релизом. Ждать офлайн-очередей не нужно — шаг 10 удаляет колонку и функцию,
-- как только этого кода нет. Дверь закрыта уже сейчас: выбор, который ни на
-- что не влияет, нельзя оставлять кнопкой.

-- ЗАМОК НЕ ЖДЁТ ДОЛГО. Снятие триггера берёт исключительный замок на
-- `appointments`; пока он ждёт чужую открытую транзакцию, за ним встают все
-- чтения и записи заявок. Через пять секунд миграция падает целиком — её
-- повторяют в тихую минуту, а календарь не замирает.
set local lock_timeout = '5s';

-- СТРАЖ СНИМАЕТСЯ. Он запрещал менять НДС записи после первой оплаты, потому
-- что выбор уходил в проводку. Выбор больше никуда не уходит — и запрещать
-- нечего.
drop trigger if exists trg_guard_appointment_vat_mode on public.appointments;
drop function if exists public.guard_appointment_vat_mode();

-- СТОРОЖ: выбор НДС записи ещё никто не сделал. Проверка стоит после снятия
-- триггера — замок на `appointments` уже взят, и до конца миграции выбор не
-- появится. Если он есть, оплата такой записи уже сняла свой налог в проводку
-- («без НДС»), а оплаты после миграции взяли бы НДС компании: одна запись с
-- двумя налогами. Тогда миграция откатывается — сначала разобрать эти записи.
do $$
begin
  if exists (select 1 from public.appointments where vat_mode is not null) then
    raise exception 'У записей уже выбран НДС (appointments.vat_mode) — разберите их до выключения выбора';
  end if;
end;
$$;

-- ДВЕРЬ ВЫБОРА ЗАКРЫТА. Функция остаётся до шага 10, но вызвать её из
-- приложения нельзя.
revoke execute on function public.set_appointment_vat_mode(uuid, text)
  from public, anon, authenticated;

comment on column public.appointments.vat_mode is
  'Не используется с 20260915090000: НДС дохода записи решают счёт/команда/компания. Колонка удаляется релизом позже.';

-- ДОХОД ЗАПИСИ СНОВА БЕЗ СНИМКА НДС. Из сверки убран блок «НДС записи»: строка
-- дохода не несёт ни `vat_mode`, ни ставки, ни суммы налога, и
-- `fill_transaction_vat` решает налог сам — счёт → команда → компания. Тело
-- функции байт в байт совпадает с телом, записанным в
-- `supabase_migrations.schema_migrations` под версией 20260906093659
-- (appointment_payment_rpcs). В файле репозитория
-- `20260906120000_appointment_payment_rpcs.sql` у этого тела три лишние
-- строки комментариев — живыми они не были. Остальное не менялось.
CREATE OR REPLACE FUNCTION public.reconcile_appointment_finance(p_appointment_id uuid, p_old_total numeric, p_old_prepaid numeric, p_old_paid numeric, p_old_payment_status text, p_old_status text, p_is_insert boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  meta_occurred_on date;
  meta_payment_id text;
begin
  if exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'invoice_payment'
       and entity_id = p_appointment_id
  ) then
    return;
  end if;
  if exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_payment_cancel'
       and entity_id = p_appointment_id
  ) then
    return;
  end if;

  select * into appointment_row
    from public.appointments
   where id = p_appointment_id
   for share;
  if not found then
    raise exception 'Заявка для синхронизации оплаты не найдена';
  end if;
  business_today := public.tenant_business_date(appointment_row.tenant_id);
  select c.occurred_on, c.payment_id
    into meta_occurred_on, meta_payment_id
    from public._finance_write_context c
   where c.transaction_id = txid_current()
     and c.kind = 'appointment_payment_meta'
     and c.entity_id = p_appointment_id
   limit 1;

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
    prepayment_delta := new_prepayment_target;
    settlement_delta := new_settlement_target;
  elsif legacy_income_count > 0 then
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
      resolved_account_id := public.resolve_appointment_payment_account(
        appointment_row.tenant_id,
        appointment_row.team_id,
        appointment_row.payment_method,
        appointment_row.payment_account_id
      );
      insert into public.finance_transactions (
        tenant_id, type, amount, category_id, account_id, appointment_id,
        client_id, team_id, master_id, payment_method, occurred_on, source,
        appointment_payment_kind, notes, appointment_payment_id
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
        coalesce(meta_occurred_on, business_today),
        'auto',
        case
          when adjustment.payment_kind = 'prepayment' then 'prepayment'
          else 'settlement'
        end,
        case
          when adjustment.payment_kind = 'prepayment' then 'Предоплата по заявке'
          else 'Оплата по заявке'
        end,
        meta_payment_id
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
