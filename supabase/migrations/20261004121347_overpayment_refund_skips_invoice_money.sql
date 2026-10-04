-- ВОЗВРАТ ПЕРЕПЛАТЫ ОБХОДИТ ДЕНЬГИ ИНВОЙСА (прогон оплаты 04.10).
--
-- `refund_appointment_overpayment` (20261004024913) шёл по платежам записи
-- от последнего к первому и на первом же зачёте инвойса падал: у элемента
-- `pay-inv-…` нет авто-проводки, и человек читал «Проводка платежа не
-- найдена — верните деньги через «Финансы»», хотя деньги инвойса
-- возвращаются на странице инвойса. Платёж плиткой, привязанный к инвойсу,
-- обрывал возврат так же, даже если более ранние плитки покрывали сумму.
--
-- Теперь деньги инвойса пропускаются, а возврат идёт с платежей плиткой.
-- Если плиток не хватило, а инвойс в записи был, ответ называет, где
-- вернуть остаток. Тело — с живой базы 04.10 (md5 совпал с файлом
-- 20261004024913); изменены только помеченные места.

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
  invoice_money boolean := false;
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
    -- Деньги инвойса здесь не возвращаются: их держит инвойс, и возврат
    -- оформляется на его странице. Плитки возвращаются, инвойс — мимо.
    if (entry.elem ->> 'id') like 'pay-inv-%' then
      invoice_money := true;
      continue;
    end if;

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
      invoice_money := true;
      continue;
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
    if invoice_money then
      raise exception 'Остаток переплаты — деньги инвойса: верните их на странице инвойса';
    end if;
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
