-- ЧАСТИЧНАЯ КРЕДИТ-НОТА К ИНВОЙСУ (владелец 2026-10-04: «давай выполняй» —
-- последний хвост инвойсов). Вернуть клиенту часть, а инвойс оставить в силе.
--
-- Правило одно: К ОПЛАТЕ = СУММА ИНВОЙСА − УЖЕ СТОРНИРОВАНО. «Сторнировано»
-- живёт колонкой `invoices.credited_amount` (её пишет только выпуск частичной
-- ноты), и от неё считают все, кто решает «оплачен / к оплате»:
-- `sync_invoice_status_from_ledger`, `validate_invoice_payment_insert`,
-- `record_invoice_payment`, `refund_invoice_payment`,
-- `prevent_settled_invoice_rewrite`. Полная отмена (`_issue_credit_note`)
-- после частичных сторнирует только остаток и без строк.
--
-- `issue_partial_credit_note`: нота на сумму X ≤ остатка; если после неё
-- получено больше, чем к оплате, разница возвращается клиенту тем же
-- движением с платежа инвойса (последнего ручного). Деньги записи — в записи.
-- Отменённый инвойс статус больше не меняет от поздних движений журнала.
--
-- Тела функций — из живого `pg_get_functiondef`, правки — точечными заменами
-- с проверкой «ровно одно вхождение».

set local lock_timeout = '5s';

alter table public.invoices
  add column if not exists credited_amount numeric(12,2) not null default 0,
  add column if not exists credit_partial boolean not null default false;

create or replace function pg_temp.patch(p_sig text, p_edits text[][])
returns void
language plpgsql
as $$
declare
  def text;
  i integer;
begin
  def := pg_get_functiondef(p_sig::regprocedure);
  for i in 1 .. array_length(p_edits, 1) loop
    if (length(def) - length(replace(def, p_edits[i][1], ''))) / length(p_edits[i][1]) <> 1 then
      raise exception '%: правка % не найдена ровно один раз', p_sig, i;
    end if;
    def := replace(def, p_edits[i][1], p_edits[i][2]);
  end loop;
  execute def;
end;
$$;

select pg_temp.patch('public.sync_invoice_status_from_ledger()', array[
  array[
    E'    select total, status into invoice_total, invoice_status',
    E'    select total - coalesce(credited_amount, 0), status into invoice_total, invoice_status'
  ],
  array[
    E'    if not found or invoice_status = \'void\' then',
    E'    -- Отменённый кредит-нотой статус от поздних движений не меняет (04.10).\n    if not found or invoice_status in (\'void\', \'cancelled\') then'
  ]
]);

select pg_temp.patch('public.validate_invoice_payment_insert()', array[
  array[
    E'      when invoice_row.status = \'paid\' then greatest(invoice_row.total, income_total)',
    E'      when invoice_row.status = \'paid\' then greatest(invoice_row.total - invoice_row.credited_amount, income_total)'
  ],
  array[
    E'  remaining_total := greatest(0, invoice_row.total - paid_total);',
    E'  remaining_total := greatest(0, invoice_row.total - invoice_row.credited_amount - paid_total);'
  ]
]);

select pg_temp.patch('public.record_invoice_payment(uuid, uuid, numeric, uuid, text, date, text)', array[
  array[
    E'then greatest(invoice_row.total, income_total)',
    E'then greatest(invoice_row.total - invoice_row.credited_amount, income_total)'
  ],
  array[
    E'  remaining_total := greatest(0, invoice_row.total - paid_total);',
    E'  remaining_total := greatest(0, invoice_row.total - invoice_row.credited_amount - paid_total);'
  ],
  array[
    E'when paid_total + amount_value >= invoice_row.total then \'paid\'',
    E'when paid_total + amount_value >= invoice_row.total - invoice_row.credited_amount then \'paid\''
  ]
]);

select pg_temp.patch('public.refund_invoice_payment(uuid, uuid, numeric, date, text)', array[
  array[
    E'    when paid_total >= invoice_row.total then \'paid\'',
    E'    when paid_total >= invoice_row.total - invoice_row.credited_amount then \'paid\''
  ]
]);

select pg_temp.patch('public.prevent_settled_invoice_rewrite()', array[
  array[
    E'    elsif new.status = \'paid\' and net_paid < new.total then',
    E'    elsif new.status = \'paid\' and net_paid < new.total - new.credited_amount then'
  ],
  array[
    E'    elsif new.status = \'issued\' and net_paid >= new.total then',
    E'    elsif new.status = \'issued\' and net_paid >= new.total - new.credited_amount then'
  ]
]);

-- Полная отмена после частичных — только остаток, без строк; повтор не
-- принимает частичную ноту за выписанную полную.
select pg_temp.patch('public._issue_credit_note(uuid, text)', array[
  array[
    E'     and note.kind = \'credit_note\'\n   order by note.created_at, note.id',
    E'     and note.kind = \'credit_note\'\n     and not note.credit_partial\n   order by note.created_at, note.id'
  ],
  array[
    E'    -original.subtotal_net,\n    original.vat_percent,\n    -original.vat_amount,\n    -original.total,',
    E'    -(original.total - original.credited_amount\n      - round(original.vat_amount * (original.total - original.credited_amount) / nullif(original.total, 0), 2)),\n    original.vat_percent,\n    -round(original.vat_amount * (original.total - original.credited_amount) / nullif(original.total, 0), 2),\n    -(original.total - original.credited_amount),'
  ],
  array[
    E'   where line.invoice_id = original.id;',
    E'   where line.invoice_id = original.id\n     and original.credited_amount = 0;'
  ]
]);

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
  income_row public.finance_transactions%rowtype;
  amount_value numeric(12,2);
  effective numeric(12,2);
  income_total numeric(12,2);
  refunds_total numeric(12,2);
  paid_total numeric(12,2);
  to_refund numeric(12,2);
  refundable numeric(12,2);
  step numeric(12,2);
  note_vat numeric(12,2);
  business_date date;
  note_year integer;
  note_seq integer;
  note_number text;
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
  if amount_value >= effective then
    raise exception 'На всю сумму инвойс отменяется полной кредит-нотой';
  end if;

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

  -- Нота — из серии CN юрлица инвойса, стороны — снимками инвойса.
  business_date := public.tenant_business_date(tenant_uuid);
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
  while to_refund > 0 loop
    select tx.* into income_row
      from public.finance_transactions tx
     where tx.tenant_id = tenant_uuid
       and tx.invoice_id = invoice_row.id
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
      tenant_uuid, 'refund', -step, income_row.currency, income_row.category_id,
      income_row.account_id, income_row.appointment_id, income_row.client_id,
      income_row.team_id, income_row.master_id, income_row.payment_method,
      'Возврат по кредит-ноте ' || note_number,
      greatest(business_date, income_row.occurred_on),
      invoice_row.id, income_row.id, 'manual', auth.uid()
    );
    to_refund := to_refund - step;
  end loop;

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
  if not has_function_privilege('authenticated', 'public.issue_partial_credit_note(uuid, uuid, numeric, text, text)', 'execute') then
    raise exception 'сторож: владелец не может выписать частичную кредит-ноту';
  end if;
  if has_function_privilege('anon', 'public.issue_partial_credit_note(uuid, uuid, numeric, text, text)', 'execute') then
    raise exception 'сторож: частичная кредит-нота открыта anon';
  end if;
  if position('credited_amount' in (select prosrc from pg_proc
       where oid = 'public.sync_invoice_status_from_ledger()'::regprocedure)) = 0
     or position('credited_amount' in (select prosrc from pg_proc
       where oid = 'public.record_invoice_payment(uuid, uuid, numeric, uuid, text, date, text)'::regprocedure)) = 0 then
    raise exception 'сторож: «к оплате» считается без сторнированного';
  end if;
end
$guard$;
