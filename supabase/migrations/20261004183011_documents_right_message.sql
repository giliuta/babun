-- ОТКАЗ ПО «ДОКУМЕНТАМ» — СЛОВОМ СТРАНИЦЫ ПРАВ (04.10). Миграция
-- 20261004173942 писала «Документы: Видит и меняет», а положение на странице
-- прав называется «Выставляет»: человек искал бы слово, которого нет.
-- Тела — из живого `pg_get_functiondef`, замена «ровно столько, сколько есть».

set local lock_timeout = '5s';

do $patch$
declare
  sig text;
  def text;
  old_msg constant text := 'Нужно право «Документы: Видит и меняет» в команде документа';
  new_msg constant text := 'Нужно право «Документы: Выставляет» в команде документа';
begin
  foreach sig in array array[
    'public.update_invoice_draft(uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, date, text, text)',
    'public.delete_invoice(uuid)',
    'public.cancel_invoice(uuid, text)',
    'public.issue_partial_credit_note(uuid, uuid, numeric, text, text)',
    'public.delete_credit_note(uuid)',
    'public.record_invoice_payment(uuid, uuid, numeric, uuid, text, date, text)',
    'public.refund_receipt(uuid, uuid, numeric, text, text)',
    'public.issue_receipt_credit_note(uuid, text, text)',
    'public.delete_receipt(uuid)'
  ] loop
    def := pg_get_functiondef(sig::regprocedure);
    if position(old_msg in def) = 0 then
      raise exception '%: прежнего отказа нет', sig;
    end if;
    execute replace(def, old_msg, new_msg);
  end loop;
end
$patch$;

do $guard$
begin
  if exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace
       and position('Документы: Видит и меняет' in prosrc) > 0
  ) then
    raise exception 'сторож: старое слово отказа осталось';
  end if;
end
$guard$;
