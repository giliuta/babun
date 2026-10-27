-- ОПЕРАЦИЯ УДАЛЯЕТСЯ ТОЛЬКО ЧЕРЕЗ «УДАЛЁННЫЕ ОПЕРАЦИИ» (аудит 035, dat/M-05).
--
-- `delete_operation` — invoker: удаляет строку под RLS человека и ставит флаг
-- `babun.operation_trash`, по которому `trash_deleted_operation` кладёт снимок
-- в ящик на 30 дней и проверяет «к доходу выписан чек». Но те же DELETE-
-- политики пускают и прямой `DELETE /rest/v1/finance_transactions?id=eq.…`:
-- он идёт мимо флага — операция стирается навсегда, а чек к доходу гасится
-- без вопроса. Приложение так не делает; старая сборка или прямой запрос — да.
--
-- Политики не снимаются: через них `delete_operation` и проверяет право
-- человека на строку. Вместо этого — сторож: запрос с ролью человека
-- (`authenticated`/`anon`, не изнутри SECURITY DEFINER-функции) удаляет
-- операцию только под флагом корзины. Определители (`delete_calendar`,
-- `delete_account_transfer`), каскад аккаунта (service_role) и pg_cron
-- работают под своей ролью и сторожа не видят.

create or replace function public.finance_delete_only_through_trash()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if current_user in ('authenticated', 'anon')
     and coalesce(current_setting('babun.operation_trash', true), '') <> 'on' then
    raise exception 'Операцию удаляют кнопкой «Удалить» — она уходит в «Удалённые операции»'
      using errcode = '42501', hint = 'operation:delete_through_trash';
  end if;
  return old;
end;
$function$;

comment on function public.finance_delete_only_through_trash() is
  'Прямой DELETE операции человеком мимо delete_operation — отказ: удаление только через «Удалённые операции».';

-- Триггерная функция: вызывать её как RPC нечем и незачем.
revoke all on function public.finance_delete_only_through_trash() from public, anon, authenticated;

drop trigger if exists trg_aa_finance_delete_only_through_trash on public.finance_transactions;
create trigger trg_aa_finance_delete_only_through_trash
  before delete on public.finance_transactions
  for each row execute function public.finance_delete_only_through_trash();
