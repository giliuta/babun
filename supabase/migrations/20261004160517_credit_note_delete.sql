-- УДАЛИТЬ КРЕДИТ-НОТУ, ПОКА ЕЁ НЕ ОТПРАВИЛИ (владелец 2026-10-04: «отменяю
-- инвойс, а он такой: ладно, я плачу — и я удаляю кредит-ноту, пока ему её
-- не скинул»).
--
-- `delete_credit_note`: как удаление инвойса и чека — только ПОСЛЕДНЯЯ нота
-- серии CN своего юрлица и года, номер возвращается в серию. Документ, за
-- которым нота закреплена, возвращается как был:
--   • полная нота к инвойсу — инвойс снова «Выставлен» / «Оплачен» по журналу;
--   • частичная — «к оплате» снова больше на её сумму;
--   • нота к чеку без движения денег (документ на возврат другой дверью) —
--     просто исчезает.
-- Если нота САМА вернула клиенту деньги (возврат тем же движением), удалить
-- её нельзя: деньги уже ушли, и документ на них обязан остаться.
--
-- Правило «отменённый инвойс не открывается» (`prevent_settled_invoice_rewrite`)
-- пропускает ровно этот откат; тело — из живого `pg_get_functiondef`.

set local lock_timeout = '5s';

do $patch$
declare
  def text;
  needle constant text := E'    if old.status = \'cancelled\' then\n      raise exception';
  replacement constant text := E'    if old.status = \'cancelled\'\n       and current_setting(\'babun.credit_note_undo\', true) is distinct from old.id::text then\n      raise exception';
begin
  def := pg_get_functiondef('public.prevent_settled_invoice_rewrite()'::regprocedure);
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception 'prevent_settled_invoice_rewrite: правило отмены не найдено ровно один раз';
  end if;
  execute replace(def, needle, replacement);
end
$patch$;

create or replace function public.delete_credit_note(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
  note public.invoices%rowtype;
  original public.invoices%rowtype;
  receipt_row public.receipts%rowtype;
  last_seq integer;
  moved numeric(12,2) := 0;
  paid_total numeric(12,2);
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Удалить кредит-ноту может только владелец'
      using errcode = '42501', hint = 'access:owner_only';
  end if;
  select * into note
    from public.invoices
   where id = p_note_id and tenant_id = tenant_uuid
   for update;
  if not found or note.kind <> 'credit_note' then
    raise exception 'Кредит-нота не найдена';
  end if;

  -- Деньги, которые нота вернула клиенту тем же движением (одна транзакция —
  -- одно время записи).
  if note.credit_note_of_id is not null then
    select coalesce(sum(abs(tx.amount)), 0) into moved
      from public.finance_transactions tx
     where tx.tenant_id = tenant_uuid
       and tx.type = 'refund'
       and tx.invoice_id = note.credit_note_of_id
       and tx.created_at = note.created_at;
  elsif note.credit_note_of_receipt_id is not null then
    select * into receipt_row from public.receipts where id = note.credit_note_of_receipt_id;
    select coalesce(sum(abs(tx.amount)), 0) into moved
      from public.finance_transactions tx
     where tx.tenant_id = tenant_uuid
       and tx.type = 'refund'
       and tx.refund_of_id = receipt_row.transaction_id
       and tx.created_at = note.created_at;
  end if;
  if moved > 0 then
    raise exception 'Кредит-нота вернула клиенту % % — её не удалить: документ на эти деньги остаётся', moved, note.currency;
  end if;

  -- Только последняя в серии: номер вернётся, дыры нет.
  perform 1 from public.document_sequences s
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from note.company_id
     and s.doc_type = 'credit_note'
     and s.year = note.year
   for update;
  select max(i.seq) into last_seq
    from public.invoices i
   where i.tenant_id = tenant_uuid
     and i.kind = 'credit_note'
     and i.company_id is not distinct from note.company_id
     and i.year = note.year;
  if last_seq is distinct from note.seq then
    raise exception 'Удалить можно только последнюю кредит-ноту серии (%) — после неё уже выписаны другие', last_seq;
  end if;

  perform set_config('babun.invoice_delete', note.id::text, true);
  delete from public.invoices where id = note.id;
  perform set_config('babun.invoice_delete', '', true);

  update public.document_sequences s
     set last_number = note.seq - 1,
         updated_at = now()
   where s.tenant_id = tenant_uuid
     and s.legal_entity_id is not distinct from note.company_id
     and s.doc_type = 'credit_note'
     and s.year = note.year
     and s.last_number = note.seq;

  -- Инвойс — как был до ноты.
  if note.credit_note_of_id is not null then
    select * into original
      from public.invoices
     where id = note.credit_note_of_id and tenant_id = tenant_uuid
     for update;
    if note.credit_partial then
      update public.invoices
         set credited_amount = greatest(0, credited_amount + note.total)
       where id = original.id;
      select * into original from public.invoices where id = original.id;
    end if;
    select greatest(0,
             coalesce(sum(case when tx.type = 'income' then greatest(tx.amount, 0) else 0 end), 0)
           - coalesce(sum(case when tx.type = 'refund' then abs(tx.amount) else 0 end), 0))
      into paid_total
      from public.finance_transactions tx
     where tx.tenant_id = tenant_uuid
       and tx.invoice_id = original.id
       and tx.type in ('income', 'refund');
    perform set_config('babun.credit_note_undo', original.id::text, true);
    update public.invoices
       set status = case
         when paid_total >= original.total - original.credited_amount then 'paid'
         else 'issued'
       end,
           updated_at = now()
     where id = original.id
       and status is distinct from case
         when paid_total >= original.total - original.credited_amount then 'paid'
         else 'issued'
       end;
    perform set_config('babun.credit_note_undo', '', true);
  end if;
end;
$$;

revoke all on function public.delete_credit_note(uuid) from public, anon;
grant execute on function public.delete_credit_note(uuid) to authenticated;

do $guard$
begin
  if not has_function_privilege('authenticated', 'public.delete_credit_note(uuid)', 'execute') then
    raise exception 'сторож: владелец не может удалить кредит-ноту';
  end if;
  if has_function_privilege('anon', 'public.delete_credit_note(uuid)', 'execute') then
    raise exception 'сторож: delete_credit_note открыта anon';
  end if;
  if position('babun.credit_note_undo' in (select prosrc from pg_proc
       where oid = 'public.prevent_settled_invoice_rewrite()'::regprocedure)) = 0 then
    raise exception 'сторож: отмена инвойса не знает удаления ноты';
  end if;
end
$guard$;
