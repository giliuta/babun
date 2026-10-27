-- ДАТА ЧЕКА И ИНВОЙСА — ДЕНЬ ВЫПУСКА, НОМЕРА ИДУТ ПО ДАТАМ (аудит 035:
-- fin/F-01, fin/F-02).
--
-- Закон о VAT требует сплошной нумерации в хронологии выпуска. Было:
--   • чек датировался днём ОПЛАТЫ (`coalesce(p_issued_on, p_tx.occurred_on)`):
--     чек к старой оплате получал следующий номер серии и раннюю дату —
--     `RC-2026-017` от 17.06 после `RC-2026-016` от 30.09;
--   • инвойс выпускался любой прошедшей датой, даже прошлого года: выпуск
--     05.01 датой 30.12 брал номер уже закрытой серии прошлого года.
--
-- Теперь одно правило для обоих — `assert_document_date`: дата документа не в
-- будущем, в текущем году и не раньше последнего документа своей серии
-- (компания-продавец × вид × год). Чек без явной даты датируется днём
-- выпуска (рабочий день компании). Дата оплаты остаётся у самой операции.

create or replace function public.assert_document_date(
  p_tenant uuid,
  p_company uuid,
  p_doc_type text,
  p_date date
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  today date := coalesce(public.tenant_business_date(p_tenant), current_date);
  last_date date;
begin
  if p_date is null then
    raise exception 'Не указана дата документа' using errcode = '22023';
  end if;
  if p_date > today then
    raise exception 'Документ нельзя датировать будущим числом'
      using errcode = '22023', hint = 'document:future_date';
  end if;
  if extract(year from p_date) <> extract(year from today) then
    raise exception 'Документ выпускается датой текущего года'
      using errcode = '22023', hint = 'document:other_year';
  end if;
  if p_doc_type = 'receipt' then
    select max(r.issued_on) into last_date
      from public.receipts r
     where r.tenant_id = p_tenant
       and r.company_id is not distinct from p_company
       and r.year = extract(year from p_date)::integer;
  else
    select max(i.issued_on) into last_date
      from public.invoices i
     where i.tenant_id = p_tenant
       and i.company_id is not distinct from p_company
       and i.kind = p_doc_type
       and i.year = extract(year from p_date)::integer;
  end if;
  if last_date is not null and p_date < last_date then
    raise exception 'Дата документа раньше последнего в серии (%) — номера пошли бы не по датам',
      to_char(last_date, 'DD.MM.YYYY')
      using errcode = '22023', hint = 'document:before_last';
  end if;
end;
$function$;

comment on function public.assert_document_date(uuid, uuid, text, date) is
  'Дата документа серии: не в будущем, в текущем году и не раньше последнего документа той же серии.';

revoke all on function public.assert_document_date(uuid, uuid, text, date) from public, anon, authenticated;

do $migration$
declare
  d text := pg_get_functiondef('public._issue_receipt_core(public.finance_transactions, jsonb, uuid, date, text, text)'::regprocedure);
  r_date_old constant text := 'receipt_date date := coalesce(p_issued_on, p_tx.occurred_on);';
  r_date_new constant text := 'receipt_date date := coalesce(p_issued_on, public.tenant_business_date(p_tx.tenant_id), current_date);';
  r_anchor constant text := E'  select numbering.seq, numbering.number\n    into receipt_seq, receipt_number\n';
  r_block constant text := E'  perform public.assert_document_date(p_tx.tenant_id, company_uuid, ''receipt'', receipt_date);\n';
  i text := pg_get_functiondef('public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text)'::regprocedure);
  i_anchor constant text := E'  invoice_year := extract(year from p_issued_on)::integer;\n';
  i_block constant text := E'  perform public.assert_document_date(tenant_uuid, resolved_company_id, ''invoice'', p_issued_on);\n';
begin
  if (length(d) - length(replace(d, r_date_old, ''))) / length(r_date_old) <> 1
     or (length(d) - length(replace(d, r_anchor, ''))) / length(r_anchor) <> 1 then
    raise exception '_issue_receipt_core: якоря не найдены ровно по одному разу';
  end if;
  if (length(i) - length(replace(i, i_anchor, ''))) / length(i_anchor) <> 1 then
    raise exception 'issue_invoice: якорь invoice_year не найден ровно один раз';
  end if;
  execute replace(replace(d, r_date_old, r_date_new), r_anchor, r_block || r_anchor);
  execute replace(i, i_anchor, i_block || i_anchor);
end;
$migration$;
