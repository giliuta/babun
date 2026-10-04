-- ВОЗВРАТ КЛИЕНТУ ПЕРЕПЛАТЫ ПО ЗАПИСИ (владелец 04.10: «разделил платежи…
-- оплатил, потом изменил итог на 30 — и словила баг по оплате»).
--
-- Сценарий: клиент заплатил €50 (карта 20 + наличные 10 + карта 20), итог
-- записи снизили до €30. Форма честно показывала «Переплата €20», а
-- «Сохранить» падало: сервер не даёт итогу быть меньше полученного
-- (`protect_paid_appointment_finance`: «Полученная сумма больше итога
-- заявки»). Выхода из записи не было: «Снять» — это «деньги не поступили»
-- (сторно платежа целиком), а вернуть клиенту часть оплаты было нечем.
--
-- 1. `refund_appointment_overpayment(запись, сумма, id попытки)` — возврат
--    клиенту (`reversal_kind = 'client_refund'`) по платежам записи, от
--    последнего к первому: доплаты, потом предоплаты. Платёж, возвращённый
--    целиком, уходит из записи; частично — остаётся с остатком. В финансах —
--    строки «Возврат клиенту» с тем же счётом, что у платежа. Сумма записи не
--    трогается: её следом сохраняет форма.
-- 2. `cancel_appointment_payment` — снять платёж, у которого уже был
--    частичный возврат, теперь можно: сторно идёт на ОСТАТОК дохода, а не на
--    весь доход (раньше «По этому платежу уже есть возврат»).
--
-- Тела обеих функций — с живой базы 04.10 (`pg_get_functiondef`); изменены
-- только помеченные места.

create or replace function public.refund_appointment_overpayment(
  p_appointment_id uuid,
  p_amount numeric,
  p_request_id uuid
)
returns public.appointments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  appt public.appointments%rowtype;
  result_row public.appointments%rowtype;
  income public.finance_transactions%rowtype;
  entry record;
  entry_amount numeric(12,2);
  income_left numeric(12,2);
  piece numeric(12,2);
  remaining numeric(12,2);
  received numeric(12,2);
  refund_category_id uuid;
  business_today date;
  new_payments jsonb;
  new_prepayments jsonb;
  new_paid numeric(12,2);
  new_prepaid numeric(12,2);
  new_payment_status text;
  last_entry jsonb;
  first_piece boolean := true;
begin
  perform set_config('babun.member_write', 'on', true);
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы вернуть деньги';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор операции';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 then
    raise exception 'Сумма возврата должна быть больше нуля';
  end if;
  if round(p_amount, 2) is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));
  select * into appt
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Запись не найдена';
  end if;
  if not public.current_user_can_pay_appointment(appt.team_id, appt.master_id) then
    raise exception 'Вернуть деньги по этой записи может владелец, диспетчер или её команда';
  end if;

  -- Повтор после оборванного ответа: первая строка возврата несёт id попытки.
  if exists (
    select 1 from public.finance_transactions
     where id = p_request_id and tenant_id = tenant_uuid
  ) then
    return appt;
  end if;
  if appt.status = 'cancelled' or appt.payment_status = 'refunded' then
    raise exception 'Оплата по записи уже закрыта возвратом';
  end if;

  received := round(coalesce(appt.prepaid_amount, 0), 2) + round(coalesce(appt.paid_amount, 0), 2);
  if p_amount > received then
    raise exception 'Вернуть можно не больше полученного: %', received;
  end if;

  select id into refund_category_id
    from public.finance_categories
   where slug = 'refund'
     and type = 'income'
     and (tenant_id is null or tenant_id = tenant_uuid)
   order by tenant_id nulls last
   limit 1;
  business_today := public.tenant_business_date(tenant_uuid);

  new_payments := coalesce(appt.payments, '[]'::jsonb);
  new_prepayments := coalesce(appt.prepayments, '[]'::jsonb);
  remaining := p_amount;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'appointment_auto', appt.id, tenant_uuid)
  on conflict do nothing;

  -- От последнего платежа к первому: сначала доплаты, потом предоплаты.
  for entry in
    select 'settlement'::text as kind, e.elem, e.ord
      from jsonb_array_elements(coalesce(appt.payments, '[]'::jsonb))
        with ordinality as e(elem, ord)
    union all
    select 'prepayment'::text as kind, e.elem, e.ord - 1000000
      from jsonb_array_elements(coalesce(appt.prepayments, '[]'::jsonb))
        with ordinality as e(elem, ord)
    order by 3 desc
  loop
    exit when remaining <= 0;
    entry_amount := round((entry.elem ->> 'amount')::numeric, 2);
    continue when entry_amount is null or entry_amount <= 0;

    select * into income
      from public.finance_transactions
     where appointment_id = appt.id
       and tenant_id = tenant_uuid
       and source = 'auto'
       and type = 'income'
       and appointment_payment_id = entry.elem ->> 'id'
     for update;
    if not found then
      raise exception 'Проводка платежа не найдена — верните деньги через «Финансы»';
    end if;
    if income.invoice_id is not null then
      raise exception 'Платёж связан с инвойсом — возврат оформляется на странице инвойса';
    end if;
    if not exists (
      select 1 from public.accounts a where a.id = income.account_id and a.is_active
    ) then
      raise exception 'Счёт платежа закрыт; снова откройте его, чтобы вернуть деньги';
    end if;
    select round(income.amount, 2) - coalesce(sum(round(abs(r.amount), 2)), 0)
      into income_left
      from public.finance_transactions r
     where r.refund_of_id = income.id and r.type = 'refund';
    piece := least(remaining, entry_amount, greatest(income_left, 0));
    continue when piece <= 0;

    insert into public.finance_transactions (
      id, tenant_id, type, amount, currency, category_id, account_id,
      appointment_id, client_id, team_id, master_id, payment_method,
      occurred_on, source, refund_of_id, invoice_id, appointment_payment_kind,
      appointment_payment_id, reversal_kind, notes
    ) values (
      case when first_piece then p_request_id else gen_random_uuid() end,
      tenant_uuid, 'refund', -piece, income.currency,
      refund_category_id, income.account_id,
      appt.id, income.client_id, income.team_id, income.master_id, income.payment_method,
      business_today, 'auto', income.id, null,
      coalesce(income.appointment_payment_kind, entry.kind),
      entry.elem ->> 'id', 'client_refund', 'Возврат клиенту: итог записи уменьшен'
    );
    first_piece := false;
    remaining := remaining - piece;

    -- Платёж в записи: целиком возвращённый уходит, частично — с остатком.
    if entry.kind = 'settlement' then
      select coalesce(jsonb_agg(
               case when e.elem ->> 'id' = entry.elem ->> 'id'
                 then jsonb_set(e.elem, '{amount}', to_jsonb(entry_amount - piece))
                 else e.elem end
               order by e.ord), '[]'::jsonb)
        into new_payments
        from jsonb_array_elements(new_payments) with ordinality as e(elem, ord)
       where not (e.elem ->> 'id' = entry.elem ->> 'id' and entry_amount - piece <= 0);
    else
      select coalesce(jsonb_agg(
               case when e.elem ->> 'id' = entry.elem ->> 'id'
                 then jsonb_set(e.elem, '{amount}', to_jsonb(entry_amount - piece))
                 else e.elem end
               order by e.ord), '[]'::jsonb)
        into new_prepayments
        from jsonb_array_elements(new_prepayments) with ordinality as e(elem, ord)
       where not (e.elem ->> 'id' = entry.elem ->> 'id' and entry_amount - piece <= 0);
    end if;
  end loop;

  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_auto'
     and entity_id = appt.id;

  if remaining > 0 then
    raise exception 'Не хватило платежей записи для возврата: осталось %', remaining;
  end if;

  select coalesce(sum(round((e.elem ->> 'amount')::numeric, 2)), 0)
    into new_paid
    from jsonb_array_elements(new_payments) as e(elem);
  select coalesce(sum(round((e.elem ->> 'amount')::numeric, 2)), 0)
    into new_prepaid
    from jsonb_array_elements(new_prepayments) as e(elem);
  new_payment_status := case
    when appt.total_amount > 0 and new_prepaid + new_paid >= appt.total_amount then 'paid'
    when new_paid > 0 then 'partial'
    else 'unpaid'
  end;
  select e.elem into last_entry
    from jsonb_array_elements(new_payments) with ordinality as e(elem, ord)
   order by e.ord desc
   limit 1;
  if last_entry is null then
    select e.elem into last_entry
      from jsonb_array_elements(new_prepayments) with ordinality as e(elem, ord)
     order by e.ord desc
     limit 1;
  end if;

  -- Тот же пропуск сверки и сторожа, что у снятия платежа: проводки уже
  -- написаны выше, запись лишь догоняет их.
  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'appointment_payment_cancel', appt.id, tenant_uuid)
  on conflict do nothing;
  update public.appointments
     set payments = new_payments,
         prepayments = new_prepayments,
         payment = public.appointment_payment_mirror(new_payments),
         paid_amount = new_paid,
         prepaid_amount = new_prepaid,
         payment_status = new_payment_status,
         payment_method = case
           when last_entry is null then null
           else last_entry ->> 'method'
         end,
         payment_account_id = case
           when last_entry is null then null
           else nullif(last_entry ->> 'account_id', '')::uuid
         end
   where id = appt.id and tenant_id = tenant_uuid
   returning * into result_row;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_payment_cancel'
     and entity_id = appt.id;
  return result_row;
end;
$function$;

revoke all on function public.refund_appointment_overpayment(uuid, numeric, uuid) from public, anon;
grant execute on function public.refund_appointment_overpayment(uuid, numeric, uuid) to authenticated;

-- ─── Снятие платежа после частичного возврата ───────────────────────────────

create or replace function public.cancel_appointment_payment(p_appointment_id uuid, p_payment_id text, p_request_id uuid)
 returns appointments
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  appt public.appointments%rowtype;
  result_row public.appointments%rowtype;
  income public.finance_transactions%rowtype;
  entry jsonb;
  entry_kind text;
  entry_amount numeric(12,2);
  entry_account uuid;
  refund_category_id uuid;
  business_today date;
  remaining_payments jsonb;
  remaining_prepayments jsonb;
  new_paid numeric(12,2);
  new_prepaid numeric(12,2);
  received numeric(12,2);
  new_payment_status text;
  last_entry jsonb;
  candidates integer := 0;
  -- 04.10: остаток дохода после частичного возврата клиенту.
  income_left numeric(12,2);
begin
  -- Пропуск сторожа колонок записи (03.10): право на деньги проверяет
  -- сама дверь ниже, а сторож пускает партнёра только с этим флагом.
  perform set_config('babun.member_write', 'on', true);
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Войдите в приложение, чтобы снять оплату';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор операции';
  end if;
  if p_payment_id is null or btrim(p_payment_id) = '' then
    raise exception 'Не указан платёж';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));
  select * into appt
    from public.appointments
   where id = p_appointment_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Заявка не найдена';
  end if;
  if not public.current_user_can_pay_appointment(appt.team_id, appt.master_id) then
    raise exception 'Снять оплату по этой заявке может владелец, диспетчер или её команда';
  end if;

  if exists (
    select 1 from public.finance_transactions
     where id = p_request_id and tenant_id = tenant_uuid
  ) then
    return appt;
  end if;
  if appt.status = 'cancelled' or appt.payment_status = 'refunded' then
    raise exception 'Оплата по заявке уже закрыта возвратом';
  end if;

  select e.elem into entry
    from jsonb_array_elements(coalesce(appt.payments, '[]'::jsonb)) as e(elem)
   where e.elem ->> 'id' = p_payment_id;
  if found then
    entry_kind := 'settlement';
  else
    select e.elem into entry
      from jsonb_array_elements(coalesce(appt.prepayments, '[]'::jsonb)) as e(elem)
     where e.elem ->> 'id' = p_payment_id;
    if not found then
      raise exception 'Платёж не найден в заявке';
    end if;
    entry_kind := 'prepayment';
  end if;
  entry_amount := round((entry ->> 'amount')::numeric, 2);
  entry_account := nullif(entry ->> 'account_id', '')::uuid;
  if entry_amount is null or entry_amount <= 0 then
    raise exception 'Сумма платежа некорректна';
  end if;

  select * into income
    from public.finance_transactions
   where appointment_id = appt.id
     and tenant_id = tenant_uuid
     and source = 'auto'
     and type = 'income'
     and appointment_payment_id = p_payment_id
   for update;
  if not found then
    select count(*) into candidates
      from public.finance_transactions f
     where f.appointment_id = appt.id
       and f.tenant_id = tenant_uuid
       and f.source = 'auto'
       and f.type = 'income'
       and f.appointment_payment_id is null
       and coalesce(f.appointment_payment_kind, 'settlement') = entry_kind
       and round(f.amount, 2) = entry_amount
       and (entry_account is null or f.account_id = entry_account)
       and not exists (
         select 1 from public.finance_transactions r
          where r.refund_of_id = f.id and r.type = 'refund'
       );
    if candidates <> 1 then
      raise exception 'Проводка этого платежа не определена однозначно; снимите оплату целиком через «Отменить оплату»';
    end if;
    select * into income
      from public.finance_transactions f
     where f.appointment_id = appt.id
       and f.tenant_id = tenant_uuid
       and f.source = 'auto'
       and f.type = 'income'
       and f.appointment_payment_id is null
       and coalesce(f.appointment_payment_kind, 'settlement') = entry_kind
       and round(f.amount, 2) = entry_amount
       and (entry_account is null or f.account_id = entry_account)
       and not exists (
         select 1 from public.finance_transactions r
          where r.refund_of_id = f.id and r.type = 'refund'
       )
     for update;
  end if;
  -- 04.10: частичный возврат клиенту не запирает платёж — сторно идёт на
  -- остаток дохода. Раньше «По этому платежу уже есть возврат».
  select round(income.amount, 2) - coalesce(sum(round(abs(r.amount), 2)), 0)
    into income_left
    from public.finance_transactions r
   where r.refund_of_id = income.id and r.type = 'refund';
  if income_left <= 0 then
    raise exception 'По этому платежу уже всё возвращено';
  end if;
  if income.invoice_id is not null then
    raise exception 'Платёж связан с инвойсом — снимайте его на странице инвойса';
  end if;
  if not exists (
    select 1 from public.accounts a where a.id = income.account_id and a.is_active
  ) then
    raise exception 'Счёт платежа закрыт; снова откройте его, чтобы снять оплату';
  end if;

  select id into refund_category_id
    from public.finance_categories
   where slug = 'refund'
     and type = 'income'
     and (tenant_id is null or tenant_id = tenant_uuid)
   order by tenant_id nulls last
   limit 1;
  business_today := public.tenant_business_date(tenant_uuid);

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'appointment_auto', appt.id, tenant_uuid)
  on conflict do nothing;
  insert into public.finance_transactions (
    id, tenant_id, type, amount, currency, category_id, account_id,
    appointment_id, client_id, team_id, master_id, payment_method,
    occurred_on, source, refund_of_id, invoice_id, appointment_payment_kind,
    appointment_payment_id, reversal_kind, notes
  ) values (
    p_request_id, tenant_uuid, 'refund', -least(income_left, entry_amount), income.currency,
    refund_category_id, income.account_id,
    appt.id, income.client_id, income.team_id, income.master_id, income.payment_method,
    business_today, 'auto', income.id, null,
    coalesce(income.appointment_payment_kind, 'settlement'),
    p_payment_id, 'not_received', 'Оплата снята: деньги не поступили'
  );
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_auto'
     and entity_id = appt.id;

  if entry_kind = 'settlement' then
    select coalesce(jsonb_agg(e.elem order by e.ord), '[]'::jsonb)
      into remaining_payments
      from jsonb_array_elements(coalesce(appt.payments, '[]'::jsonb))
        with ordinality as e(elem, ord)
     where e.elem ->> 'id' <> p_payment_id;
    remaining_prepayments := coalesce(appt.prepayments, '[]'::jsonb);
    new_prepaid := round(coalesce(appt.prepaid_amount, 0), 2);
  else
    remaining_payments := coalesce(appt.payments, '[]'::jsonb);
    select coalesce(jsonb_agg(e.elem order by e.ord), '[]'::jsonb)
      into remaining_prepayments
      from jsonb_array_elements(coalesce(appt.prepayments, '[]'::jsonb))
        with ordinality as e(elem, ord)
     where e.elem ->> 'id' <> p_payment_id;
    new_prepaid := greatest(round(coalesce(appt.prepaid_amount, 0) - entry_amount, 2), 0);
  end if;
  select coalesce(sum(round((e.elem ->> 'amount')::numeric, 2)), 0)
    into new_paid
    from jsonb_array_elements(remaining_payments) as e(elem);
  received := new_prepaid + new_paid;
  new_payment_status := case
    when appt.total_amount > 0 and received >= appt.total_amount then 'paid'
    when new_paid > 0 then 'partial'
    else 'unpaid'
  end;
  select e.elem into last_entry
    from jsonb_array_elements(remaining_payments) with ordinality as e(elem, ord)
   order by e.ord desc
   limit 1;
  if last_entry is null then
    select e.elem into last_entry
      from jsonb_array_elements(remaining_prepayments) with ordinality as e(elem, ord)
     order by e.ord desc
     limit 1;
  end if;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'appointment_payment_cancel', appt.id, tenant_uuid)
  on conflict do nothing;
  update public.appointments
     set payments = remaining_payments,
         prepayments = remaining_prepayments,
         payment = public.appointment_payment_mirror(remaining_payments),
         paid_amount = new_paid,
         prepaid_amount = new_prepaid,
         payment_status = new_payment_status,
         payment_method = case
           when last_entry is null then null
           else last_entry ->> 'method'
         end,
         payment_account_id = case
           when last_entry is null then null
           else nullif(last_entry ->> 'account_id', '')::uuid
         end
   where id = appt.id and tenant_id = tenant_uuid
   returning * into result_row;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_payment_cancel'
     and entity_id = appt.id;
  return result_row;
end;
$function$;
