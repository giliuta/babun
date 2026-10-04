-- ДОКУМЕНТ — ЗА ЧЕКОМ, А НЕ ЗА ДВЕРЬЮ ВОЗВРАТА; СТРОКИ — В КРЕДИТ-НОТЕ
-- (владелец 2026-10-04: «давай делай» — хвосты документов).
--
-- 1. Кредит-нота несёт строки: к инвойсу — его позиции с минусом, к чеку при
--    возврате всей суммы — его перечень с минусом. Бухгалтер видит, что
--    именно сторнировано, а не одну строку «Отмена инвойса …». Частичный
--    возврат по чеку — без строк (бумага печатает «Возврат по чеку …»).
-- 2. `issue_receipt_credit_note` — кредит-нота на деньги, возвращённые
--    ДРУГОЙ дверью (отмена визита, снятие оплаты в записи, возврат операцией):
--    возвращено по платежу чека минус уже покрытое нотами к нему. Так у любых
--    возвращённых денег есть документ, какой бы путь их ни вернул.
-- 3. Общий помощник `_issue_receipt_credit_note` — ноту к чеку выписывают
--    обе функции одинаково (`refund_receipt` переписана на него).
--
-- Правило снимков: вставка строк в кредит-ноту обнуляет снимок продавца
-- (`refresh_invoice_snapshots_from_line_change`), а правило запрещало ноте
-- менять стороны вообще — теперь при неизменных реквизитах документа оно
-- просто держит прежние снимки. Тело — из живого `pg_get_functiondef`.

set local lock_timeout = '5s';

-- ─── Снимки ноты при вставке её строк ───

do $patch$
declare
  def text;
  needle constant text := E'  if old.kind = \'credit_note\' then\n    raise exception \'Стороны кредит-ноты не обновляются — это стороны её инвойса\';\n  end if;';
  replacement constant text := E'  if old.kind = \'credit_note\' then\n    -- Строки ноты (04.10) задевают снимок через триггер строк — стороны\n    -- остаются прежними; менять реквизиты самой ноты по-прежнему нельзя.\n    if document_changed then\n      raise exception \'Стороны кредит-ноты не обновляются — это стороны её инвойса\';\n    end if;\n    new.seller_snapshot := old.seller_snapshot;\n    new.client_snapshot := old.client_snapshot;\n    return new;\n  end if;';
begin
  def := pg_get_functiondef('public.capture_invoice_document_snapshots()'::regprocedure);
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception 'capture_invoice_document_snapshots: правило ноты не найдено ровно один раз';
  end if;
  execute replace(def, needle, replacement);
end
$patch$;

-- ─── Кредит-нота к инвойсу — с его позициями ───

do $patch$
declare
  def text;
  needle constant text := E'  returning id into note_id;\n\n  return note_id;';
  replacement constant text := E'  returning id into note_id;\n\n  -- Позиции инвойса с минусом (04.10): видно, что именно сторнировано.\n  insert into public.invoice_lines (invoice_id, position, title, qty, unit_price, total, description, unit)\n  select note_id, line.position, line.title, line.qty, -line.unit_price, -line.total, line.description, line.unit\n    from public.invoice_lines line\n   where line.invoice_id = original.id;\n\n  return note_id;';
begin
  def := pg_get_functiondef('public._issue_credit_note(uuid, text)'::regprocedure);
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception '_issue_credit_note: конец вставки не найден ровно один раз';
  end if;
  execute replace(def, needle, replacement);
end
$patch$;

-- ─── Нота к чеку — один помощник ───

create or replace function public._issue_receipt_credit_note(
  p_receipt_id uuid,
  p_amount numeric,
  p_reason text,
  p_language text
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_row public.receipts%rowtype;
  note_row public.invoices%rowtype;
  business_date date;
  note_year integer;
  note_seq integer;
  note_number text;
  note_vat numeric(12,2);
  amount_value numeric(12,2) := round(p_amount, 2);
  reason_text text := nullif(btrim(p_reason), '');
  language_value text := coalesce(nullif(btrim(p_language), ''), 'en');
  line jsonb;
  pos integer := 0;
begin
  select * into receipt_row from public.receipts where id = p_receipt_id;
  if not found then
    raise exception 'Чек не найден';
  end if;
  business_date := public.tenant_business_date(receipt_row.tenant_id);
  note_year := extract(year from business_date)::integer;
  select numbering.seq, numbering.number
    into note_seq, note_number
    from public.next_document_number(
      receipt_row.tenant_id, receipt_row.company_id, 'credit_note', note_year
    ) as numbering;
  note_vat := case
    when coalesce(receipt_row.vat_amount, 0) > 0 and receipt_row.amount > 0
      then round(receipt_row.vat_amount * amount_value / receipt_row.amount, 2)
    else 0
  end;

  insert into public.invoices (
    tenant_id, number, year, seq, issued_on, client_id, appointment_id,
    brigade_id, subtotal_net, vat_percent, vat_amount, total, currency,
    status, kind, credit_note_of_receipt_id, notes, created_by, language,
    vat_mode, company_id, seller_snapshot
  ) values (
    receipt_row.tenant_id, note_number, note_year, note_seq, business_date,
    receipt_row.client_id, receipt_row.appointment_id, receipt_row.team_id,
    -(amount_value - note_vat), coalesce(receipt_row.vat_rate, 0), -note_vat,
    -amount_value, receipt_row.currency, 'issued', 'credit_note',
    receipt_row.id,
    coalesce(reason_text, 'Возврат по чеку ' || receipt_row.number),
    auth.uid(),
    case when language_value in ('ru', 'en', 'bg', 'el', 'uk', 'de', 'es')
      then language_value else 'en' end,
    case when note_vat > 0 then 'inclusive' else 'off' end,
    receipt_row.company_id,
    receipt_row.seller_snapshot
  )
  returning * into note_row;

  -- Вся сумма чека — его перечень с минусом; часть — без строк.
  if amount_value = round(receipt_row.amount, 2)
     and jsonb_typeof(receipt_row.lines) = 'array' then
    for line in select value from jsonb_array_elements(receipt_row.lines) loop
      insert into public.invoice_lines (invoice_id, position, title, qty, unit_price, total, description, unit)
      values (
        note_row.id,
        pos,
        coalesce(nullif(btrim(line ->> 'name'), ''), 'Оплата'),
        coalesce((line ->> 'qty')::numeric, 1),
        -coalesce((line ->> 'unitPrice')::numeric, (line ->> 'sum')::numeric, 0),
        -coalesce((line ->> 'sum')::numeric, 0),
        null,
        nullif(line ->> 'unit', '')
      );
      pos := pos + 1;
    end loop;
  end if;

  select * into note_row from public.invoices where id = note_row.id;
  return note_row;
end;
$$;

revoke all on function public._issue_receipt_credit_note(uuid, numeric, text, text) from public, anon, authenticated;

-- ─── refund_receipt — на помощнике ───

create or replace function public.refund_receipt(
  p_receipt_id uuid,
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
  receipt_row public.receipts%rowtype;
  income_row public.finance_transactions%rowtype;
  invoice_row public.invoices%rowtype;
  note_row public.invoices%rowtype;
  note_id uuid;
  amount_value numeric(12,2);
  already_refunded numeric(12,2);
  refundable numeric(12,2);
  held numeric(12,2);
  business_date date;
  reason_text text := nullif(btrim(p_reason), '');
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Вернуть деньги по чеку может только владелец'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор возврата';
  end if;

  select * into receipt_row
    from public.receipts
   where id = p_receipt_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Чек не найден';
  end if;

  -- Повтор того же запроса — тот же документ.
  if exists (
    select 1 from public.finance_transactions
     where id = p_request_id and tenant_id = tenant_uuid
  ) then
    select * into note_row
      from public.invoices note
     where note.tenant_id = tenant_uuid
       and note.kind = 'credit_note'
       and (note.credit_note_of_receipt_id = receipt_row.id
            or note.credit_note_of_id = receipt_row.invoice_id)
     order by note.created_at desc
     limit 1;
    if found then return note_row; end if;
    raise exception 'Идентификатор возврата уже использован';
  end if;

  if receipt_row.status <> 'issued' then
    raise exception 'Чек уже погашен — возвращать нечего';
  end if;
  if receipt_row.transaction_id is null then
    raise exception 'У чека нет платежа — вернуть нечего';
  end if;

  select * into income_row
    from public.finance_transactions
   where id = receipt_row.transaction_id
     and tenant_id = tenant_uuid
     and type = 'income'
   for update;
  if not found then
    raise exception 'Платёж чека не найден';
  end if;
  if income_row.source = 'auto' or income_row.appointment_payment_kind is not null then
    raise exception 'Деньги по записи возвращаются в самой записи';
  end if;
  if income_row.account_id is null or income_row.payment_method is null then
    raise exception 'У платежа нет счёта или способа оплаты';
  end if;

  amount_value := round(p_amount, 2);
  if amount_value is null or amount_value = 'NaN'::numeric or amount_value <= 0 then
    raise exception 'Сумма возврата должна быть больше нуля';
  end if;
  if amount_value is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;

  select coalesce(sum(abs(amount)), 0) into already_refunded
    from public.finance_transactions
   where tenant_id = tenant_uuid and refund_of_id = income_row.id and type = 'refund';
  refundable := round(greatest(0, greatest(income_row.amount, 0) - already_refunded), 2);
  if refundable <= 0 then
    raise exception 'Этот платёж уже возвращён полностью';
  end if;
  if amount_value > refundable then
    raise exception 'Возврат превышает доступный остаток % %', refundable, income_row.currency;
  end if;
  if income_row.invoice_id is not null and amount_value <> refundable then
    raise exception 'Платёж инвойса возвращается целиком — инвойс отменяется кредит-нотой';
  end if;

  business_date := public.tenant_business_date(tenant_uuid);

  insert into public.finance_transactions (
    id, tenant_id, type, amount, currency, category_id, account_id,
    appointment_id, client_id, team_id, master_id, payment_method, notes,
    occurred_on, invoice_id, refund_of_id, source, created_by
  ) values (
    p_request_id, tenant_uuid, 'refund', -amount_value, income_row.currency,
    income_row.category_id, income_row.account_id, income_row.appointment_id,
    income_row.client_id, income_row.team_id, income_row.master_id,
    income_row.payment_method,
    coalesce(reason_text, 'Возврат по чеку ' || receipt_row.number),
    greatest(business_date, income_row.occurred_on),
    income_row.invoice_id, income_row.id, 'manual', auth.uid()
  );

  -- ЧЕК ОПЛАТЫ ИНВОЙСА: документ — кредит-нота к инвойсу.
  if income_row.invoice_id is not null then
    select * into invoice_row
      from public.invoices
     where id = income_row.invoice_id and tenant_id = tenant_uuid
     for update;
    select greatest(0,
             coalesce(sum(case when tx.type = 'income' then greatest(tx.amount, 0) else 0 end), 0)
           - coalesce(sum(case when tx.type = 'refund' then abs(tx.amount) else 0 end), 0))
      into held
      from public.finance_transactions tx
     where tx.tenant_id = tenant_uuid
       and tx.invoice_id = invoice_row.id
       and tx.type in ('income', 'refund');
    if held > 0 then
      raise exception 'По инвойсу % остаются другие платежи — верните их на странице инвойса', invoice_row.number;
    end if;
    note_id := public._issue_credit_note(invoice_row.id, reason_text);
    update public.invoices
       set status = 'cancelled', updated_at = now()
     where id = invoice_row.id;
    select * into note_row from public.invoices where id = note_id;
    return note_row;
  end if;

  -- ЧЕК БЕЗ ИНВОЙСА: кредит-нота к чеку, на сумму возврата.
  return public._issue_receipt_credit_note(receipt_row.id, amount_value, reason_text, p_language);
end;
$$;

revoke all on function public.refund_receipt(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.refund_receipt(uuid, uuid, numeric, text, text) to authenticated;

-- ─── Документ на возврат, сделанный другой дверью ───

create or replace function public.issue_receipt_credit_note(
  p_receipt_id uuid,
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
  receipt_row public.receipts%rowtype;
  refunded numeric(12,2);
  covered numeric(12,2);
  uncovered numeric(12,2);
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Выписать кредит-ноту может только владелец'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  select * into receipt_row
    from public.receipts
   where id = p_receipt_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Чек не найден';
  end if;
  if receipt_row.invoice_id is not null then
    raise exception 'Чек оплаты инвойса отменяется кредит-нотой к инвойсу — на странице инвойса';
  end if;
  if receipt_row.transaction_id is null then
    raise exception 'У чека нет платежа — возвращать нечего';
  end if;

  select coalesce(sum(abs(amount)), 0) into refunded
    from public.finance_transactions
   where tenant_id = tenant_uuid
     and refund_of_id = receipt_row.transaction_id
     and type = 'refund';
  select coalesce(sum(-total), 0) into covered
    from public.invoices
   where tenant_id = tenant_uuid
     and kind = 'credit_note'
     and credit_note_of_receipt_id = receipt_row.id;
  if refunded <= 0 then
    raise exception 'По чеку ничего не возвращали — кредит-нота не нужна';
  end if;
  uncovered := round(least(refunded, receipt_row.amount) - covered, 2);
  if uncovered <= 0 then
    raise exception 'Каждый возврат по этому чеку уже с кредит-нотой';
  end if;

  return public._issue_receipt_credit_note(receipt_row.id, uncovered, p_reason, p_language);
end;
$$;

revoke all on function public.issue_receipt_credit_note(uuid, text, text) from public, anon;
grant execute on function public.issue_receipt_credit_note(uuid, text, text) to authenticated;

do $guard$
begin
  if not has_function_privilege('authenticated', 'public.issue_receipt_credit_note(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.refund_receipt(uuid, uuid, numeric, text, text)', 'execute') then
    raise exception 'сторож: владелец не может выписать документ возврата';
  end if;
  if has_function_privilege('anon', 'public.issue_receipt_credit_note(uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public._issue_receipt_credit_note(uuid, numeric, text, text)', 'execute') then
    raise exception 'сторож: внутренний выпуск ноты открыт снаружи';
  end if;
  if position('invoice_lines' in (select prosrc from pg_proc
       where oid = 'public._issue_credit_note(uuid, text)'::regprocedure)) = 0 then
    raise exception 'сторож: кредит-нота к инвойсу без строк';
  end if;
end
$guard$;
