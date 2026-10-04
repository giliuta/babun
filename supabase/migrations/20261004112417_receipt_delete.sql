-- УДАЛИТЬ ЧЕК ЦЕЛИКОМ — КАК ИНВОЙС (владелец 2026-10-04: «чек тоже нужно
-- удалить»). Только ПОСЛЕДНИЙ чек серии своего юрлица и года, действующий, без
-- возврата и кредит-ноты: номер возвращается в серию, дыры нет. Деньги не
-- трогаются — платёж остаётся в журнале, а чек на него можно выписать снова.
-- Чек из середины серии — правкой на месте или возвратом с кредит-нотой.

create or replace function public.delete_receipt(p_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
  target public.receipts%rowtype;
  last_seq integer;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Удалить чек может только владелец'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  select * into target
    from public.receipts
   where id = p_receipt_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Чек не найден';
  end if;
  if target.status <> 'issued' then
    raise exception 'Погашенный чек не удаляется — его номер уже в истории';
  end if;
  if exists (
    select 1 from public.invoices note
     where note.tenant_id = tenant_uuid and note.credit_note_of_receipt_id = target.id
  ) then
    raise exception 'По чеку выписана кредит-нота — его не удалить';
  end if;
  if target.transaction_id is not null and exists (
    select 1 from public.finance_transactions refund
     where refund.tenant_id = tenant_uuid
       and refund.refund_of_id = target.transaction_id
       and refund.type = 'refund'
  ) then
    raise exception 'По чеку был возврат — его не удалить';
  end if;

  -- Серия — замком, чтобы параллельная выдача не встала между проверкой и
  -- возвратом номера.
  perform 1 from public.document_sequences s
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from target.company_id
     and s.doc_type = 'receipt'
     and s.year = target.year
   for update;
  select max(r.seq) into last_seq
    from public.receipts r
   where r.tenant_id = tenant_uuid
     and r.company_id is not distinct from target.company_id
     and r.year = target.year;
  if last_seq is distinct from target.seq then
    raise exception 'Удалить можно только последний чек серии (%) — этот исправьте или оформите возврат', last_seq;
  end if;

  delete from public.receipts where id = target.id;

  update public.document_sequences s
     set last_number = target.seq - 1,
         updated_at = now()
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from target.company_id
     and s.doc_type = 'receipt'
     and s.year = target.year
     and s.last_number = target.seq;
end;
$$;

revoke all on function public.delete_receipt(uuid) from public, anon;
grant execute on function public.delete_receipt(uuid) to authenticated;

do $guard$
begin
  if not has_function_privilege('authenticated', 'public.delete_receipt(uuid)', 'execute') then
    raise exception 'сторож: владелец не может удалить чек';
  end if;
  if has_function_privilege('anon', 'public.delete_receipt(uuid)', 'execute') then
    raise exception 'сторож: delete_receipt открыта anon';
  end if;
end
$guard$;
