-- ВОЗВРАТ ПО ЧЕКУ — ДЕНЬГИ И ДОКУМЕНТ ОДНИМ ДВИЖЕНИЕМ (владелец 2026-10-04:
-- «оплатил, получил чек — а если вернули деньги, нужен какой-то документ?»).
--
-- До этого возврат по чеку оставлял только операцию: полный — гасил чек
-- «Аннулирован», частичный — не оставлял ничего. Встречной бумаги не было, и
-- налог с продажи так и числился. Теперь `refund_receipt`:
--
-- 1. Чек оплаты без инвойса (ручной доход) — возврат на всю сумму или часть,
--    и КРЕДИТ-НОТА К ЧЕКУ: серия CN юрлица чека, стороны и реквизиты — из
--    снимков чека, VAT — долей от VAT чека. Связь — новая колонка
--    `invoices.credit_note_of_receipt_id`.
-- 2. Чек оплаты инвойса — возврат ВСЕГО платежа и кредит-нота к ИНВОЙСУ (её
--    налоговый документ — инвойс): инвойс гаснет «Отменён», а не повисает
--    долгом. Если по инвойсу остаются другие платежи — сначала их.
-- 3. Чек оплаты записи — пока отказ с путём: деньги записи живут в её журнале
--    (`cancel_appointment_payment`, отмена записи), чужой возврат разошёлся бы
--    с ним.
--
-- Правило снимков (`capture_invoice_document_snapshots`) учит ноту к чеку
-- брать стороны с чека; тело — из живого `pg_get_functiondef`, правка —
-- точечной заменой «ровно один раз».

set local lock_timeout = '5s';

alter table public.invoices
  add column if not exists credit_note_of_receipt_id uuid
    references public.receipts(id) on delete restrict;

do $c$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.invoices'::regclass
       and conname = 'invoices_receipt_note_is_credit_note'
  ) then
    alter table public.invoices
      add constraint invoices_receipt_note_is_credit_note
      check (
        credit_note_of_receipt_id is null
        or (kind = 'credit_note' and credit_note_of_id is null)
      );
  end if;
end
$c$;

create index if not exists invoices_credit_note_of_receipt_idx
  on public.invoices (credit_note_of_receipt_id)
  where credit_note_of_receipt_id is not null;

-- ─── Снимки кредит-ноты к чеку — с чека ───

do $patch$
declare
  def text;
  edits text[][] := array[
    array[
      E'  source_invoice public.invoices%rowtype;\nbegin',
      E'  source_invoice public.invoices%rowtype;\n  source_receipt public.receipts%rowtype;\nbegin'
    ],
    array[
      E'    if new.kind = \'credit_note\' then\n      select * into source_invoice',
      E'    -- Кредит-нота к ЧЕКУ (возврат, 04.10): стороны и реквизиты — его.\n    if new.kind = \'credit_note\' and new.credit_note_of_receipt_id is not null then\n      select * into source_receipt\n        from public.receipts receipt\n       where receipt.id = new.credit_note_of_receipt_id\n         and receipt.tenant_id = new.tenant_id;\n      if not found then\n        raise exception \'Кредит-нота должна ссылаться на чек этой компании\';\n      end if;\n      if new.client_id is distinct from source_receipt.client_id then\n        raise exception \'Клиент кредит-ноты не совпадает с клиентом чека\';\n      end if;\n      new.seller_snapshot := source_receipt.seller_snapshot;\n      new.client_snapshot := source_receipt.client_snapshot;\n      new.company_id := source_receipt.company_id;\n      return new;\n    end if;\n\n    if new.kind = \'credit_note\' then\n      select * into source_invoice'
    ]
  ];
  i integer;
begin
  def := pg_get_functiondef('public.capture_invoice_document_snapshots()'::regprocedure);
  for i in 1 .. array_length(edits, 1) loop
    if (length(def) - length(replace(def, edits[i][1], ''))) / length(edits[i][1]) <> 1 then
      raise exception 'capture_invoice_document_snapshots: правка % не найдена ровно один раз', i;
    end if;
    def := replace(def, edits[i][1], edits[i][2]);
  end loop;
  execute def;
end
$patch$;

-- ─── Возврат по чеку ───

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
  note_year integer;
  note_seq integer;
  note_number text;
  note_vat numeric(12,2);
  reason_text text := nullif(btrim(p_reason), '');
  language_value text := coalesce(nullif(btrim(p_language), ''), 'en');
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
  note_year := extract(year from business_date)::integer;
  select numbering.seq, numbering.number
    into note_seq, note_number
    from public.next_document_number(
      tenant_uuid, receipt_row.company_id, 'credit_note', note_year
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
    tenant_uuid, note_number, note_year, note_seq, business_date,
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

  return note_row;
end;
$$;

revoke all on function public.refund_receipt(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.refund_receipt(uuid, uuid, numeric, text, text) to authenticated;

do $guard$
begin
  if not has_function_privilege('authenticated', 'public.refund_receipt(uuid, uuid, numeric, text, text)', 'execute') then
    raise exception 'сторож: владелец не может вернуть деньги по чеку';
  end if;
  if has_function_privilege('anon', 'public.refund_receipt(uuid, uuid, numeric, text, text)', 'execute') then
    raise exception 'сторож: refund_receipt открыта anon';
  end if;
  if position('credit_note_of_receipt_id' in (select prosrc from pg_proc
       where oid = 'public.capture_invoice_document_snapshots()'::regprocedure)) = 0 then
    raise exception 'сторож: снимки не знают кредит-ноту к чеку';
  end if;
end
$guard$;
