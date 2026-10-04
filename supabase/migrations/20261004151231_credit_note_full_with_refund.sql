-- КРЕДИТ-НОТА НА ВСЮ СУММУ ОПЛАЧЕННОГО ИНВОЙСА — ОДНИМ ДВИЖЕНИЕМ (владелец
-- 2026-10-04: «доделывай этот хвост»). «Вернуть» в платежах инвойса вело в
-- старый возврат без документа, и инвойс снова висел долгом. Теперь возврат
-- по инвойсу — только через форму кредит-ноты: часть — нота и возврат
-- разницы, вся сумма — возврат всего полученного и полная кредит-нота
-- (`_issue_credit_note`, инвойс «Отменён»). Возврат денег — общий помощник
-- `_refund_invoice_money` (ручные платежи, последние первыми).

set local lock_timeout = '5s';

-- Вернуть клиенту сумму с ручных платежей инвойса, последние первыми.
-- Деньги записи (авто) — только в записи.
create or replace function public._refund_invoice_money(
  p_invoice public.invoices,
  p_amount numeric,
  p_on date,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  income_row public.finance_transactions%rowtype;
  to_refund numeric(12,2) := round(coalesce(p_amount, 0), 2);
  refundable numeric(12,2);
  step numeric(12,2);
begin
  while to_refund > 0 loop
    select tx.* into income_row
      from public.finance_transactions tx
     where tx.tenant_id = p_invoice.tenant_id
       and tx.invoice_id = p_invoice.id
       and tx.type = 'income'
       and greatest(tx.amount, 0) > coalesce((
         select sum(abs(r.amount)) from public.finance_transactions r
          where r.refund_of_id = tx.id and r.type = 'refund'
       ), 0)
     order by tx.created_at desc
     limit 1
     for update;
    if not found then
      raise exception 'Не нашлось платежа инвойса для возврата';
    end if;
    if income_row.source = 'auto' or income_row.appointment_payment_kind is not null then
      raise exception 'Деньги по записи возвращаются в самой записи';
    end if;
    select greatest(income_row.amount, 0) - coalesce(sum(abs(r.amount)), 0)
      into refundable
      from public.finance_transactions r
     where r.refund_of_id = income_row.id and r.type = 'refund';
    step := least(to_refund, refundable);
    insert into public.finance_transactions (
      tenant_id, type, amount, currency, category_id, account_id,
      appointment_id, client_id, team_id, master_id, payment_method, notes,
      occurred_on, invoice_id, refund_of_id, source, created_by
    ) values (
      p_invoice.tenant_id, 'refund', -step, income_row.currency, income_row.category_id,
      income_row.account_id, income_row.appointment_id, income_row.client_id,
      income_row.team_id, income_row.master_id, income_row.payment_method,
      p_note,
      greatest(p_on, income_row.occurred_on),
      p_invoice.id, income_row.id, 'manual', auth.uid()
    );
    to_refund := to_refund - step;
  end loop;
end;
$$;

revoke all on function public._refund_invoice_money(public.invoices, numeric, date, text) from public, anon, authenticated;

create or replace function public.issue_partial_credit_note(
  p_invoice_id uuid,
  p_request_id uuid,
  p_amount numeric,
  p_reason text default null,
  p_language text default 'en'
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  note_row public.invoices%rowtype;
  amount_value numeric(12,2);
  effective numeric(12,2);
  income_total numeric(12,2);
  refunds_total numeric(12,2);
  paid_total numeric(12,2);
  to_refund numeric(12,2);
  note_vat numeric(12,2);
  business_date date;
  note_year integer;
  note_seq integer;
  note_number text;
  note_id uuid;
  full_cancel boolean;
  reason_text text := nullif(btrim(p_reason), '');
  language_value text := coalesce(nullif(btrim(p_language), ''), 'en');
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Выписать кредит-ноту может только владелец'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор кредит-ноты';
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_invoice_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден';
  end if;

  -- Повтор того же запроса — та же нота (id ноты = идентификатор запроса).
  select * into note_row from public.invoices where id = p_request_id and tenant_id = tenant_uuid;
  if found then
    return note_row;
  end if;

  if invoice_row.kind <> 'invoice' then
    raise exception 'Кредит-нота не сторнируется — она сама является сторно';
  end if;
  if invoice_row.status not in ('issued', 'paid') then
    raise exception 'Инвойс уже отменён — сторнировать нечего';
  end if;

  amount_value := round(p_amount, 2);
  if amount_value is null or amount_value = 'NaN'::numeric or amount_value <= 0 then
    raise exception 'Сумма кредит-ноты должна быть больше нуля';
  end if;
  if amount_value is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  effective := invoice_row.total - invoice_row.credited_amount;
  if amount_value > effective then
    raise exception 'Больше суммы инвойса сторнировать нельзя: % %', effective, invoice_row.currency;
  end if;
  full_cancel := amount_value = effective;

  -- Сколько получено по инвойсу сейчас.
  select
    coalesce(sum(case when tx.type = 'income' then greatest(tx.amount, 0) else 0 end), 0),
    coalesce(sum(case when tx.type = 'refund' then abs(tx.amount) else 0 end), 0)
    into income_total, refunds_total
    from public.finance_transactions tx
   where tx.tenant_id = tenant_uuid
     and tx.invoice_id = invoice_row.id
     and tx.type in ('income', 'refund');
  paid_total := greatest(0, income_total - refunds_total);
  to_refund := greatest(0, paid_total - (effective - amount_value));
  business_date := public.tenant_business_date(tenant_uuid);

  -- ВСЯ СУММА (04.10): вернуть клиенту всё полученное и отменить инвойс
  -- полной кредит-нотой — одним движением, как «Возврат» чека.
  if full_cancel then
    perform public._refund_invoice_money(invoice_row, to_refund, business_date, 'Возврат по отмене инвойса ' || invoice_row.number);
    note_id := public._issue_credit_note(invoice_row.id, reason_text);
    update public.invoices set status = 'cancelled', updated_at = now() where id = invoice_row.id;
    update public.invoices
       set language = case when language_value in ('ru', 'en', 'bg', 'el', 'uk', 'de', 'es') then language_value else language end
     where id = note_id and language is distinct from language_value;
    select * into note_row from public.invoices where id = note_id;
    return note_row;
  end if;

  -- Нота — из серии CN юрлица инвойса, стороны — снимками инвойса.
  note_year := extract(year from business_date)::integer;
  select numbering.seq, numbering.number
    into note_seq, note_number
    from public.next_document_number(
      tenant_uuid, invoice_row.company_id, 'credit_note', note_year
    ) as numbering;
  note_vat := case
    when coalesce(invoice_row.vat_amount, 0) > 0 and invoice_row.total > 0
      then round(invoice_row.vat_amount * amount_value / invoice_row.total, 2)
    else 0
  end;

  insert into public.invoices (
    id, tenant_id, number, year, seq, issued_on, client_id, appointment_id,
    brigade_id, subtotal_net, vat_percent, vat_amount, total, currency,
    status, kind, credit_note_of_id, credit_partial, notes, created_by,
    language, vat_mode, seller_snapshot, client_snapshot
  ) values (
    p_request_id, tenant_uuid, note_number, note_year, note_seq, business_date,
    invoice_row.client_id, invoice_row.appointment_id, invoice_row.brigade_id,
    -(amount_value - note_vat), invoice_row.vat_percent, -note_vat,
    -amount_value, invoice_row.currency, 'issued', 'credit_note',
    invoice_row.id, true,
    coalesce(reason_text, 'Частичная отмена инвойса ' || invoice_row.number),
    auth.uid(),
    case when language_value in ('ru', 'en', 'bg', 'el', 'uk', 'de', 'es')
      then language_value else 'en' end,
    invoice_row.vat_mode,
    invoice_row.seller_snapshot,
    invoice_row.client_snapshot
  )
  returning * into note_row;

  -- Сторнированное — до возврата: пересчёт статуса журналом видит новую сумму.
  update public.invoices
     set credited_amount = credited_amount + amount_value
   where id = invoice_row.id;

  -- Получено больше нового «к оплате» — разницу вернуть клиенту, с последних
  -- ручных платежей инвойса.
  perform public._refund_invoice_money(invoice_row, to_refund, business_date, 'Возврат по кредит-ноте ' || note_number);

  -- Статус — по новому «к оплате» (без движений журнала его некому пересчитать).
  select greatest(0,
           coalesce(sum(case when tx.type = 'income' then greatest(tx.amount, 0) else 0 end), 0)
         - coalesce(sum(case when tx.type = 'refund' then abs(tx.amount) else 0 end), 0))
    into paid_total
    from public.finance_transactions tx
   where tx.tenant_id = tenant_uuid
     and tx.invoice_id = invoice_row.id
     and tx.type in ('income', 'refund');
  update public.invoices
     set status = case
       when paid_total >= total - credited_amount then 'paid'
       else 'issued'
     end
   where id = invoice_row.id
     and status is distinct from case
       when paid_total >= total - credited_amount then 'paid'
       else 'issued'
     end;

  return note_row;
end;
$$;

revoke all on function public.issue_partial_credit_note(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.issue_partial_credit_note(uuid, uuid, numeric, text, text) to authenticated;

do $guard$
begin
  if has_function_privilege('authenticated', 'public._refund_invoice_money(public.invoices, numeric, date, text)', 'execute') then
    raise exception 'сторож: внутренний возврат открыт снаружи';
  end if;
  if not has_function_privilege('authenticated', 'public.issue_partial_credit_note(uuid, uuid, numeric, text, text)', 'execute') then
    raise exception 'сторож: владелец не может выписать кредит-ноту';
  end if;
end
$guard$;
