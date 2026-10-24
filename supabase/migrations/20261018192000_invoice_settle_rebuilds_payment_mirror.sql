-- Платёж и возврат по инвойсу пересобирают сводку `payment` заявки.
--
-- У заявки две записи о деньгах: список `payments` и его сводка `payment`
-- (наличные + карта, её строит `appointment_payment_mirror`). Приложение
-- считает полученное как большее из суммы списка и сводки. Триггер платежа
-- инвойса (`settle_appointment_from_invoice_payment`) менял только список,
-- а сводку оставлял прежней. Её пересобирала следующая доплата из карточки —
-- уже с деньгами инвойса, — и после возврата по инвойсу сводка оставалась
-- завышенной: возвращённые деньги продолжали считаться полученными, долг
-- на экране показывал ноль. Обратный случай — платёж инвойса без доплаты:
-- сводка оставалась пустой, хотя деньги на заявке есть.
--
-- Теперь триггер ставит список и сводку одним присваиванием из одного и того
-- же выражения: обе ветки (платёж и возврат) получают сводку от НОВОГО
-- списка. Тело правится заменой по якорям, а не целиком: чужие правки в
-- других местах функции переживают эту миграцию.

set local lock_timeout = '5s';

do $patch$
declare
  fn_def text := pg_get_functiondef(
    'public.settle_appointment_from_invoice_payment()'::regprocedure
  );
  head_anchor constant text := $a$         payments = case
           when is_refund then coalesce(($a$;
  head_replacement constant text := $a$         -- Список и его сводка — из одного выражения: сводку строит тот же
         -- `appointment_payment_mirror`, что и у доплаты из карточки.
         (payments, payment) = (
           select v.p, public.appointment_payment_mirror(v.p)
             from (select case
           when is_refund then coalesce(($a$;
  tail_anchor constant text := $a$           )
         end
   where id = appt.id and tenant_id = appt.tenant_id;$a$;
  tail_replacement constant text := $a$           )
         end as p) v
         )
   where id = appt.id and tenant_id = appt.tenant_id;$a$;
begin
  if position('public.appointment_payment_mirror(v.p)' in fn_def) > 0 then
    raise notice 'settle_appointment_from_invoice_payment уже строит сводку';
    return;
  end if;
  if (length(fn_def) - length(replace(fn_def, head_anchor, ''))) / length(head_anchor) <> 1 then
    raise exception 'Якорь начала списка платежей не найден ровно один раз';
  end if;
  if (length(fn_def) - length(replace(fn_def, tail_anchor, ''))) / length(tail_anchor) <> 1 then
    raise exception 'Якорь конца списка платежей не найден ровно один раз';
  end if;
  fn_def := replace(fn_def, head_anchor, head_replacement);
  fn_def := replace(fn_def, tail_anchor, tail_replacement);
  execute fn_def;
end
$patch$;

-- Заявки, где сводка уже разошлась со списком из-за платежа инвойса.
-- Только строки с элементом `pay-inv-…`: остальные расхождения (если
-- появятся) — не этой ошибки, и переписывать их молча нельзя. Правка денег
-- оплаченной заявки проходит сторож `protect_paid_appointment_finance` по
-- тому же пропуску, что и сам триггер платежа инвойса: суммы не меняются,
-- меняется только сводка.
do $backfill$
declare
  stale record;
begin
  for stale in
    select a.id, a.tenant_id
      from public.appointments a
     where a.payment is distinct from public.appointment_payment_mirror(a.payments)
       and exists (
         select 1
           from jsonb_array_elements(coalesce(a.payments, '[]'::jsonb)) e
          where e ->> 'id' like 'pay-inv-%'
       )
  loop
    insert into public._finance_write_context
      (transaction_id, kind, entity_id, tenant_id)
    values (txid_current(), 'invoice_payment', stale.id, stale.tenant_id)
    on conflict do nothing;
    update public.appointments a
       set payment = public.appointment_payment_mirror(a.payments)
     where a.id = stale.id and a.tenant_id = stale.tenant_id;
    delete from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'invoice_payment'
       and entity_id = stale.id;
  end loop;
end
$backfill$;

do $guard$
declare
  fn_def text := pg_get_functiondef(
    'public.settle_appointment_from_invoice_payment()'::regprocedure
  );
begin
  if position('(payments, payment) = (' in fn_def) = 0
     or position('public.appointment_payment_mirror(v.p)' in fn_def) = 0 then
    raise exception 'settle_appointment_from_invoice_payment не пересобирает сводку payment';
  end if;
  if exists (
    select 1
      from public.appointments a
     where a.payment is distinct from public.appointment_payment_mirror(a.payments)
       and exists (
         select 1
           from jsonb_array_elements(coalesce(a.payments, '[]'::jsonb)) e
          where e ->> 'id' like 'pay-inv-%'
       )
  ) then
    raise exception 'Остались заявки со сводкой, расходящейся с платежами инвойса';
  end if;
end
$guard$;
