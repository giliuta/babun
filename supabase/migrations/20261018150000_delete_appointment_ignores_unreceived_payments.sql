-- ЗАПИСЬ, ОПЛАТА КОТОРОЙ «НЕ ПОСТУПИЛА», УДАЛЯЕТСЯ.
--
-- «Снять оплату: деньги не поступили» оставляет в журнале пару строк — доход
-- и его сторно (`reversal_kind = 'not_received'`) на ту же сумму. Денег по
-- записи не было: карточка показывает «К оплате», лента их пару не считает.
-- А сторож удаления видел «финансовую историю» в любой строке журнала и
-- навсегда запрещал удалить такую запись: в меню «Удалить» проходило проверку
-- приложения (оплаты на записи нет), а сервер отвечал «Заявку с оплатой или
-- финансовой историей нельзя удалить».
--
-- Теперь сторож не считает историей доход, целиком сторнированный как «не
-- поступили», и сами строки такого сторно. Настоящая оплата, возврат денег
-- клиенту и инвойс по-прежнему держат запись в истории. Пара строк после
-- удаления остаётся в журнале без записи (`on delete set null`) — в сумме
-- ноль, как и до удаления.
create or replace function public.guard_appointment_history_delete()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
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
       select 1 from public.finance_transactions t
        where t.appointment_id = old.id
          and not (t.type = 'refund' and t.reversal_kind = 'not_received')
          and not (
            t.type = 'income'
            and coalesce((
              select -sum(r.amount)
                from public.finance_transactions r
               where r.refund_of_id = t.id
                 and r.reversal_kind = 'not_received'
            ), 0) >= t.amount
          )
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

-- Удаление записи отвязывает её проводки (`appointment_id ON DELETE SET
-- NULL`). Это не движение денег — так же, как отвязка платежей удалённого
-- долга. До каскада доходит только удаление, которое пропустил сторож
-- записи выше, то есть пара «не поступили» без настоящих денег; иначе
-- сторож автоматических операций отказывал бы и ей. Меняется ровно
-- `appointment_id` → NULL, всё остальное в строке обязано совпасть.
do $patch$
declare
  v_def text;
  v_anchor text := $q$  if tg_op = 'INSERT' and new.source = 'auto' then$q$;
  v_block text := $q$  -- Отвязка проводок удалённой записи (каскад appointment_id → NULL).
  if tg_op = 'UPDATE'
     and old.appointment_id is not null
     and new.appointment_id is null
     and not exists (select 1 from public.appointments where id = old.appointment_id)
     and (to_jsonb(new) - 'appointment_id' - 'updated_at') = (to_jsonb(old) - 'appointment_id' - 'updated_at') then
    return new;
  end if;

$q$;
begin
  select pg_get_functiondef('public.assert_finance_transaction_integrity()'::regprocedure) into v_def;
  if position(v_anchor in v_def) = 0 then
    raise exception 'assert_finance_transaction_integrity: якорь не найден';
  end if;
  if position('Отвязка проводок удалённой записи' in v_def) > 0 then
    raise exception 'assert_finance_transaction_integrity: отвязка записи уже есть';
  end if;
  execute replace(v_def, v_anchor, v_block || v_anchor);
end
$patch$;
