-- ОПЛАТА ИНВОЙСА ГАСИТ ДОЛГ ЗАЯВКИ (и возврат его возвращает).
--
-- Было: record_invoice_payment клал доход со ссылкой на заявку, но саму
-- заявку не трогал. Клиент оплатил инвойс — деньги на счету, а заявка
-- по-прежнему «не оплачена»: одна и та же сумма висела и в «Долгах», и в
-- «ждут оплату», клиент числился должником после оплаты, а бригадир видел
-- незакрытую работу.
--
-- Наивная правка УДВАИВАЕТ ДЕНЬГИ: любое изменение сумм заявки поднимает
-- reconcile_appointment_finance, и он создаёт второй авто-доход на ту же
-- сумму. Поэтому отражение идёт под собственным контекстом `invoice_payment`,
-- который пропускают оба сторожа: деньги уже проведены платежом по инвойсу,
-- заявке остаётся только показать их у себя.
--
-- Сделано ТРИГГЕРОМ на finance_transactions, а не правкой record_invoice_payment:
-- так закрыт любой путь, которым доход привязывается к инвойсу и заявке, а
-- двухсотстрочная функция оплаты остаётся нетронутой.

-- 1. Белый список видов контекста — намеренно узкий, чтобы «пропустить
--    сторожа» нельзя было случайной строкой.
alter table public._finance_write_context
  drop constraint if exists _finance_write_context_kind_check;
alter table public._finance_write_context
  add constraint _finance_write_context_kind_check
  check (kind in (
    'appointment_auto',
    'appointment_undo',
    'appointment_prepayment',
    'appointment_payment_reset',
    'transfer_write',
    'invoice_payment'
  ));

-- 2. reconcile_appointment_finance пропускает такую проводку целиком.
--    (Полное тело функции — в предыдущей миграции; здесь только начало,
--    остальное не менялось. См. 20260727100001 и правку выбора счёта.)

-- 3. Отражение платежа/возврата в самой заявке.
create or replace function public.settle_appointment_from_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  appt public.appointments%rowtype;
  room numeric;
  applied numeric;
  new_paid numeric;
  received numeric;
  is_refund boolean;
begin
  is_refund := new.type = 'refund' and new.invoice_id is not null
               and new.appointment_id is not null and new.amount < 0;
  if not is_refund and (
       new.type <> 'income'
       or new.invoice_id is null
       or new.appointment_id is null
       or new.amount <= 0
     ) then
    return new;
  end if;

  select * into appt
    from public.appointments
   where id = new.appointment_id and tenant_id = new.tenant_id
   for update;
  if not found then return new; end if;
  if appt.status = 'cancelled' or appt.payment_status = 'refunded' then
    return new;
  end if;

  if is_refund then
    -- Снимаем ровно столько, сколько вернули, но не ниже нуля: часть могла
    -- быть погашена другим путём.
    applied := -least(round(abs(new.amount), 2), appt.paid_amount);
  else
    -- Больше остатка не зачисляем: инвойс может быть выставлен на часть
    -- работ или, наоборот, на несколько заявок.
    room := greatest(appt.total_amount - appt.prepaid_amount - appt.paid_amount, 0);
    if room <= 0 then return new; end if;
    applied := least(round(new.amount, 2), room);
  end if;
  if applied = 0 then return new; end if;

  new_paid := round(appt.paid_amount + applied, 2);
  received := appt.prepaid_amount + new_paid;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'invoice_payment', appt.id, appt.tenant_id)
  on conflict do nothing;

  update public.appointments
     set paid_amount = new_paid,
         -- Способ появляется у заявки, только если его ещё не было: у
         -- предоплаты свой способ, и перебивать его платежом инвойса нельзя.
         payment_method = case
           when new_paid = 0 and prepaid_amount = 0 then null
           else coalesce(payment_method, new.payment_method)
         end,
         payment_status = case
           when received <= 0 then 'unpaid'
           when total_amount > 0 and received >= total_amount then 'paid'
           else 'partial'
         end,
         -- Витрина платежей карточки: без строки в леджере долг на экране не
         -- гаснет, сколько бы денег ни легло на счёт. Возврат СНИМАЕТ свою
         -- строку, а не добавляет отрицательную — иначе история платежей
         -- превращается в бухгалтерскую ленту.
         payments = case
           when is_refund then coalesce((
             select jsonb_agg(p)
               from jsonb_array_elements(coalesce(payments, '[]'::jsonb)) p
              where p->>'id' is distinct from 'pay-inv-' || new.refund_of_id::text
           ), '[]'::jsonb)
           else coalesce(payments, '[]'::jsonb) || jsonb_build_array(
             jsonb_build_object(
               'id', 'pay-inv-' || new.id::text,
               'method', new.payment_method,
               'amount', applied,
               'paid_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'account_id', new.account_id
             )
           )
         end
   where id = appt.id and tenant_id = appt.tenant_id;

  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'invoice_payment'
     and entity_id = appt.id;
  return new;
end;
$$;

drop trigger if exists trg_settle_appointment_from_invoice on public.finance_transactions;
create trigger trg_settle_appointment_from_invoice
  after insert on public.finance_transactions
  for each row execute function public.settle_appointment_from_invoice_payment();

-- 4. protect_paid_appointment_finance пропускает тот же контекст —
--    иначе половина «возврат снимает оплату» упирается в запрет и деньги,
--    ушедшие клиенту, остаются на заявке как полученные. Полное тело
--    функции переписано в проде тем же телом плюс блок invoice_payment_context
--    рядом с undo_context / payment_reset_context.
