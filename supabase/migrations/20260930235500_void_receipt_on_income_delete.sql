-- ЧЕК ГАСНЕТ ВМЕСТЕ С ДОХОДОМ (аудит финансов 2026-09-30).
--
-- Удалили доход, на который выписан чек, — внешний ключ
-- `receipts.transaction_id` обнулялся (`on delete set null`), а сам чек
-- оставался «выданным»: документ на деньги, которых в журнале больше нет.
-- Возврат дохода чек уже гасил (`void_receipt_on_refund`); удаление — нет.
--
-- Теперь перед удалением дохода его выданный чек становится аннулированным.
-- Номер остаётся за чеком (пропуски в нумерации законны, аннулированный
-- документ хранит свой номер), связь с проводкой обнулит внешний ключ, как и
-- раньше. BEFORE, а не AFTER: к AFTER-триггеру связь уже обнулена, и чек
-- было бы не найти. Если удаление отклонит другой сторож, откатится и это.

create or replace function public.void_receipt_on_income_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.type <> 'income' then
    return old;
  end if;
  update public.receipts
     set status = 'void'
   where transaction_id = old.id
     and status = 'issued';
  return old;
end;
$function$;

-- Функция-триггер: звать её напрямую некому (новая функция по умолчанию
-- исполнима для PUBLIC и anon).
revoke all on function public.void_receipt_on_income_delete() from public, anon, authenticated;

drop trigger if exists trg_void_receipt_on_income_delete on public.finance_transactions;
create trigger trg_void_receipt_on_income_delete
  before delete on public.finance_transactions
  for each row execute function public.void_receipt_on_income_delete();

do $guard$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.finance_transactions'::regclass
       and tgname = 'trg_void_receipt_on_income_delete'
       and not tgisinternal
  ) then
    raise exception 'сторож: триггера гашения чека при удалении дохода нет';
  end if;
  if has_function_privilege('anon', 'public.void_receipt_on_income_delete()', 'execute') then
    raise exception 'сторож: функция-триггер исполнима для anon';
  end if;
end
$guard$;
