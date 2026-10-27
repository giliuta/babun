-- ИНВОЙС ПО ЗАПИСИ УЧИТЫВАЕТ ДЕНЬГИ, УЖЕ ПРИНЯТЫЕ ЗАПИСЬЮ (035·3, F-56).
--
-- Решение 035: деньги записи — доходы с `appointment_id` записи и без
-- `invoice_id` минус их возвраты — засчитываются последнему живому
-- (issued/paid) инвойсу этой записи. Приложение так уже считает остаток.
-- Сервер считал инвойс только по его собственным платежам:
--   • предоплата записи €260 + инвойс €300 → инвойс навсегда «выставлен»,
--     даже когда записи заплачено всё;
--   • `record_invoice_payment` и триггер `validate_invoice_payment_insert`
--     отказывали в оплате целиком («аннулируйте инвойс и выставьте новый на
--     остаток»), а остаток €40 не принимали.
--
-- Теперь:
--   • `invoice_appointment_credit` — сколько денег записи засчитано инвойсу;
--     не ноль только у последнего живого инвойса записи;
--   • статус инвойса (`refresh_invoice_status`) = платежи инвойса + деньги
--     записи; пересчёт — при движении денег записи (журнал), при выпуске
--     инвойса и при смене статуса или кредита у инвойсов записи;
--   • оплата инвойса: потолок — остаток за вычетом денег записи. Отказ
--     «оплата вне инвойса» остаётся там, где деньги записи инвойсу не
--     засчитаны (другой, не последний инвойс записи);
--   • последняя доля VAT добирает налог бумаги только у инвойса без денег
--     записи: деньги записи несли свой налог;
--   • сторож `prevent_settled_invoice_rewrite` и кредит-ноты считают
--     «оплачен» так же; отмена кредит-нотой по-прежнему смотрит только на
--     деньги самого инвойса — деньги записи принадлежат записи.
--
-- Долгов клиента и записи SQL не считает (считает приложение) — трогать
-- там нечего.
--
-- Тела `record_invoice_payment`, `validate_invoice_payment_insert`,
-- `prevent_settled_invoice_rewrite`, `issue_partial_credit_note` и
-- `delete_credit_note` правятся по якорям в живых определениях;
-- `sync_invoice_status_from_ledger` переписан целиком.

create or replace function public.appointment_money_outside_invoices(p_appointment uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $function$
  select greatest(0,
    coalesce((
      select sum(greatest(income.amount, 0))
        from public.finance_transactions income
       where income.appointment_id = p_appointment
         and income.invoice_id is null
         and income.type = 'income'
    ), 0)
    - coalesce((
      select sum(abs(refund.amount))
        from public.finance_transactions refund
       where refund.appointment_id = p_appointment
         and refund.invoice_id is null
         and refund.type = 'refund'
         and (
           refund.refund_of_id is null
           or exists (
             select 1 from public.finance_transactions original
              where original.id = refund.refund_of_id
                and original.invoice_id is null
           )
         )
    ), 0)
  )
$function$;

revoke all on function public.appointment_money_outside_invoices(uuid) from public, anon, authenticated;

create or replace function public.invoice_appointment_credit(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce((
    select public.appointment_money_outside_invoices(invoice.appointment_id)
      from public.invoices invoice
     where invoice.id = p_invoice
       and (auth.uid() is null or invoice.tenant_id = public.current_tenant_id())
       and invoice.appointment_id is not null
       and invoice.kind = 'invoice'
       and invoice.status in ('issued', 'paid')
       and invoice.id = (
         select latest.id
           from public.invoices latest
          where latest.tenant_id = invoice.tenant_id
            and latest.appointment_id = invoice.appointment_id
            and latest.kind = 'invoice'
            and latest.status in ('issued', 'paid')
          order by latest.created_at desc, latest.id desc
          limit 1
       )
  ), 0)
$function$;

-- Зовёт и триггер `validate_invoice_payment_insert` от лица пользователя.
revoke all on function public.invoice_appointment_credit(uuid) from public, anon;
grant execute on function public.invoice_appointment_credit(uuid) to authenticated;

create or replace function public.refresh_invoice_status(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  invoice_due numeric(12,2);
  invoice_status text;
  income_total numeric(12,2);
  direct_refunds numeric(12,2);
  linked_refunds numeric(12,2);
  paid_total numeric(12,2);
  next_status text;
begin
  select total - coalesce(credited_amount, 0), status
    into invoice_due, invoice_status
    from public.invoices
   where id = p_invoice
     and kind = 'invoice'
   for update;
  -- Отменённый кредит-нотой и аннулированный статус от поздних движений не меняют.
  if not found or invoice_status in ('void', 'cancelled') then
    return;
  end if;

  select
    coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
    coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0)
    into income_total, direct_refunds
    from public.finance_transactions
   where invoice_id = p_invoice
     and type in ('income', 'refund');
  select coalesce(sum(abs(refund.amount)), 0)
    into linked_refunds
    from public.finance_transactions refund
    join public.finance_transactions original
      on original.id = refund.refund_of_id
   where original.invoice_id = p_invoice
     and original.type = 'income'
     and refund.type = 'refund'
     and refund.invoice_id is null;

  paid_total := greatest(0, income_total - direct_refunds - linked_refunds)
    + public.invoice_appointment_credit(p_invoice);
  next_status := case when paid_total >= invoice_due then 'paid' else 'issued' end;
  update public.invoices
     set status = next_status
   where id = p_invoice
     and status is distinct from next_status;
end;
$function$;

revoke all on function public.refresh_invoice_status(uuid) from public, anon, authenticated;

create or replace function public.sync_invoice_status_from_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  invoice_ids uuid[] := '{}';
  appointment_ids uuid[] := '{}';
  row_invoice uuid;
  target uuid;
begin
  -- Инвойс строки: свой или исходного дохода (старые возвраты знали только его).
  if tg_op <> 'INSERT' then
    row_invoice := old.invoice_id;
    if row_invoice is null and old.type = 'refund' and old.refund_of_id is not null then
      select invoice_id into row_invoice from public.finance_transactions where id = old.refund_of_id;
    end if;
    invoice_ids := invoice_ids || row_invoice;
    -- Строка без инвойса — деньги записи: их инвойс пересчитывается тоже.
    if row_invoice is null and old.appointment_id is not null then
      appointment_ids := appointment_ids || old.appointment_id;
    end if;
  end if;
  if tg_op <> 'DELETE' then
    row_invoice := new.invoice_id;
    if row_invoice is null and new.type = 'refund' and new.refund_of_id is not null then
      select invoice_id into row_invoice from public.finance_transactions where id = new.refund_of_id;
    end if;
    invoice_ids := invoice_ids || row_invoice;
    if row_invoice is null and new.appointment_id is not null then
      appointment_ids := appointment_ids || new.appointment_id;
    end if;
  end if;

  for target in
    select x.id from unnest(invoice_ids) as x(id) where x.id is not null
    union
    select invoice.id
      from public.invoices invoice
     where invoice.appointment_id = any(appointment_ids)
       and invoice.kind = 'invoice'
       and invoice.status in ('issued', 'paid')
  loop
    perform public.refresh_invoice_status(target);
  end loop;
  return null;
end;
$function$;

revoke all on function public.sync_invoice_status_from_ledger() from public, anon, authenticated;

-- Выпуск инвойса по уже оплаченной записи, кредит-нота или отмена одного из
-- инвойсов записи: статус живых инвойсов записи — заново. Пересчёт пишет
-- только изменившийся статус, поэтому повторный вызов здесь же затихает.
create or replace function public.invoice_status_follows_appointment_money()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  target uuid;
begin
  for target in
    select invoice.id
      from public.invoices invoice
     where invoice.tenant_id = new.tenant_id
       and invoice.appointment_id = new.appointment_id
       and invoice.kind = 'invoice'
       and invoice.status in ('issued', 'paid')
  loop
    perform public.refresh_invoice_status(target);
  end loop;
  return null;
end;
$function$;

revoke all on function public.invoice_status_follows_appointment_money() from public, anon, authenticated;

drop trigger if exists invoice_status_follows_appointment_money on public.invoices;
create trigger invoice_status_follows_appointment_money
  after insert or update of status, credited_amount on public.invoices
  for each row
  when (new.appointment_id is not null and new.kind = 'invoice')
  execute function public.invoice_status_follows_appointment_money();

-- Сторож статуса: «оплачен» = платежи инвойса + деньги записи; отмена и
-- аннулирование по-прежнему смотрят только на деньги самого инвойса.
do $migration$
declare
  d text := pg_get_functiondef('public.prevent_settled_invoice_rewrite()'::regprocedure);
  a_decl constant text := E'  has_ledger boolean := false;\n';
  b_decl constant text := E'  has_ledger boolean := false;\n  appointment_credit numeric := 0;\n';
  a_net constant text := E'    net_paid := greatest(0, income_total - direct_refunds - linked_refunds);\n';
  b_net constant text := E'    net_paid := greatest(0, income_total - direct_refunds - linked_refunds);\n'
    || E'    -- Деньги записи вне инвойса засчитаны её последнему живому инвойсу.\n'
    || E'    appointment_credit := public.invoice_appointment_credit(old.id);\n'
    || E'    has_ledger := has_ledger or (old.appointment_id is not null and exists (\n'
    || E'      select 1 from public.finance_transactions money\n'
    || E'       where money.appointment_id = old.appointment_id\n'
    || E'         and money.invoice_id is null\n'
    || E'         and money.type in (''income'', ''refund'')\n'
    || E'    ));\n';
  a_paid constant text := E'    elsif new.status = ''paid'' and net_paid < new.total - new.credited_amount then\n';
  b_paid constant text := E'    elsif new.status = ''paid'' and net_paid + appointment_credit < new.total - new.credited_amount then\n';
  a_issued constant text := E'    elsif new.status = ''issued'' and net_paid >= new.total - new.credited_amount then\n';
  b_issued constant text := E'    elsif new.status = ''issued'' and net_paid + appointment_credit >= new.total - new.credited_amount then\n';
begin
  if (length(d) - length(replace(d, a_decl, ''))) / length(a_decl) <> 1
     or (length(d) - length(replace(d, a_net, ''))) / length(a_net) <> 1
     or (length(d) - length(replace(d, a_paid, ''))) / length(a_paid) <> 1
     or (length(d) - length(replace(d, a_issued, ''))) / length(a_issued) <> 1 then
    raise exception 'prevent_settled_invoice_rewrite: якоря не найдены ровно по одному разу';
  end if;
  execute replace(replace(replace(replace(d, a_decl, b_decl), a_net, b_net), a_paid, b_paid), a_issued, b_issued);
end;
$migration$;

-- Оплата инвойса: остаток за вычетом денег записи — и в RPC, и в триггере
-- вставки платежа (он ловит любую дорогу).
do $migration$
declare
  fn text;
  d text;
  a_decl constant text := E'  invoice_work numeric := 0;\n';
  b_decl constant text := E'  invoice_work numeric := 0;\n  appointment_credit numeric := 0;\n';
  a_rest constant text := E'  remaining_total := greatest(0, invoice_row.total - invoice_row.credited_amount - paid_total);\n';
  b_rest constant text := E'  -- Деньги записи вне инвойса засчитаны её последнему живому инвойсу.\n'
    || E'  appointment_credit := public.invoice_appointment_credit(invoice_row.id);\n'
    || E'  paid_total := paid_total + appointment_credit;\n'
    || E'  remaining_total := greatest(0, invoice_row.total - invoice_row.credited_amount - paid_total);\n';
  a_other constant text := E'      if other_money > 0\n         and other_money + invoice_work > appointment_row.total_amount then\n';
  b_other constant text := E'      if appointment_credit = 0\n         and other_money > 0\n         and other_money + invoice_work > appointment_row.total_amount then\n';
  a_vat constant text := E'    if amount_value = remaining_total and direct_refunds = 0 and linked_refunds = 0 then\n';
  b_vat constant text := E'    if amount_value = remaining_total and direct_refunds = 0 and linked_refunds = 0\n'
    || E'       and appointment_credit = 0 then\n';
begin
  foreach fn in array array[
    'public.validate_invoice_payment_insert()',
    'public.record_invoice_payment(uuid, uuid, numeric, uuid, text, date, text)'
  ] loop
    d := pg_get_functiondef(fn::regprocedure);
    if (length(d) - length(replace(d, a_decl, ''))) / length(a_decl) <> 1
       or (length(d) - length(replace(d, a_rest, ''))) / length(a_rest) <> 1
       or (length(d) - length(replace(d, a_other, ''))) / length(a_other) <> 1 then
      raise exception '%: якоря остатка не найдены ровно по одному разу', fn;
    end if;
    d := replace(replace(replace(d, a_decl, b_decl), a_rest, b_rest), a_other, b_other);
    if fn like 'public.record_invoice_payment%' then
      if (length(d) - length(replace(d, a_vat, ''))) / length(a_vat) <> 1 then
        raise exception '%: якорь последней доли VAT не найден ровно один раз', fn;
      end if;
      d := replace(d, a_vat, b_vat);
    end if;
    execute d;
  end loop;
end;
$migration$;

-- Кредит-ноты пишут статус своей формулой — теперь с деньгами записи.
do $migration$
declare
  d text;
  a_partial constant text := 'when paid_total >= total - credited_amount then ''paid''';
  b_partial constant text := 'when paid_total + public.invoice_appointment_credit(invoice_row.id) >= total - credited_amount then ''paid''';
  a_undo constant text := 'when paid_total >= original.total - original.credited_amount then ''paid''';
  b_undo constant text := 'when paid_total + public.invoice_appointment_credit(original.id) >= original.total - original.credited_amount then ''paid''';
begin
  d := pg_get_functiondef('public.issue_partial_credit_note(uuid, uuid, numeric, text, text, uuid)'::regprocedure);
  if (length(d) - length(replace(d, a_partial, ''))) / length(a_partial) <> 2 then
    raise exception 'issue_partial_credit_note: формула статуса найдена не дважды';
  end if;
  execute replace(d, a_partial, b_partial);
  d := pg_get_functiondef('public.delete_credit_note(uuid)'::regprocedure);
  if (length(d) - length(replace(d, a_undo, ''))) / length(a_undo) <> 2 then
    raise exception 'delete_credit_note: формула статуса найдена не дважды';
  end if;
  execute replace(d, a_undo, b_undo);
end;
$migration$;

-- Разово: живые инвойсы, которым засчитаны деньги записи, — статус заново.
do $backfill$
declare
  target uuid;
begin
  for target in
    select invoice.id
      from public.invoices invoice
     where invoice.appointment_id is not null
       and invoice.kind = 'invoice'
       and invoice.status in ('issued', 'paid')
       and public.invoice_appointment_credit(invoice.id) > 0
  loop
    perform public.refresh_invoice_status(target);
  end loop;
end;
$backfill$;

do $guard$
begin
  if not exists (select 1 from pg_trigger where tgname = 'invoice_status_follows_appointment_money'
                    and tgrelid = 'public.invoices'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'trg_sync_invoice_status_from_ledger'
                    and tgrelid = 'public.finance_transactions'::regclass) then
    raise exception 'F-56: триггеры статуса инвойса не на месте';
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('record_invoice_payment', 'validate_invoice_payment_insert',
                           'prevent_settled_invoice_rewrite', 'issue_partial_credit_note',
                           'delete_credit_note', 'refresh_invoice_status')
         and position('invoice_appointment_credit' in pg_get_functiondef(p.oid)) > 0) <> 6 then
    raise exception 'F-56: не все функции считают деньги записи';
  end if;
  if has_function_privilege('anon', 'public.invoice_appointment_credit(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.refresh_invoice_status(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.appointment_money_outside_invoices(uuid)', 'execute') then
    raise exception 'F-56: служебные функции открыты не тем ролям';
  end if;
end;
$guard$;
