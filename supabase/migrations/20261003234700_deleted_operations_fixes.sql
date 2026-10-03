-- «УДАЛЁННЫЕ ОПЕРАЦИИ» — ТРИ ИСПРАВЛЕНИЯ (аудит сессии 017, 03.10; к
-- миграции 20261003224700).
--
--   1. «ВЕРНУТЬ» НЕ НАВЕШИВАЕТ VAT. Снимок старой операции без налога
--      (vat_amount пуст) вставлялся обратно, и `fill_transaction_vat` брал
--      режим «счёт → команда → компания» по СЕГОДНЯШНИМ настройкам: доход
--      €300 от 02.06 без налога возвращался с 19 % (€47,90). Теперь
--      `deleted_operation_ready` ставит такому снимку явное «Без VAT»
--      (`vat_mode = 'none'`) — самое сильное правило триггера: налог остаётся
--      пустым, как был. Снимок с налогом проходит как раньше (ветка «целый
--      снимок» сверяет его с суммой и хранит).
--   2. ДОХОД С ВЫПИСАННЫМ ЧЕКОМ В ЯЩИК НЕ УХОДИТ. Удаление дохода гасит его
--      чек (`void_receipt_on_income_delete`), а «Вернуть» чек не оживит:
--      документ неизменяем, аннулированный остаётся аннулированным. Обещание
--      «вернуть можно 30 дней» было бы ложным, поэтому `delete_operation`
--      такой доход не удаляет — отказ с причиной (`operation:has_receipt`).
--      Для этого триггер ящика переезжает в BEFORE DELETE: в AFTER чек к
--      тому времени уже отвязан (FK `on delete set null`, системный триггер
--      `RI_…` идёт раньше по имени) и проверка его не видит — прогон в
--      откате это поймал. Гасящий `trg_void_receipt_on_income_delete` тоже
--      BEFORE и стоит после ящика по имени (trg_t… < trg_v…). Снимок в
--      ящике из BEFORE безопасен: любой отказ дальше откатывает всё
--      удаление, а пропуск строки `delete_operation` превращает в отказ.
--   3. ОПЕРАЦИИ В ЯЩИКЕ — ИСТОРИЯ СЧЁТА. Счёт, все операции которого лежали
--      в «Удалённых операциях», считался пустым: его можно было стереть
--      насовсем (`guard_account_delete_with_history`) или ночная очистка
--      стирала его из «Удалённых счетов» (`account_has_history`), и потом
--      «Вернуть» операцию было некуда. Теперь снимки в ящике держат счёт.
--
-- Тела функций — с живой базы (pg_get_functiondef 03.10), изменены только
-- помеченные строки.

set local lock_timeout = '5s';

-- ─── 1. «Вернуть» — снимок без налога остаётся без налога ───

create or replace function public.deleted_operation_ready(p_operation jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  ready jsonb := p_operation;
  account uuid := nullif(p_operation->>'account_id', '')::uuid;
begin
  if account is not null and not exists (
    select 1 from public.accounts a where a.id = account and a.deleted_at is null
  ) then
    raise exception 'Счёт этой операции удалён — сначала верните его из «Удалённых счетов»'
      using errcode = '23503', hint = 'operation:account_deleted';
  end if;
  if ready->>'category_id' is not null and not exists (
    select 1 from public.finance_categories c where c.id = (ready->>'category_id')::uuid
  ) then
    ready := jsonb_set(ready, '{category_id}', 'null');
  end if;
  if ready->>'client_id' is not null and not exists (
    select 1 from public.clients c where c.id = (ready->>'client_id')::uuid
  ) then
    ready := jsonb_set(ready, '{client_id}', 'null');
  end if;
  if ready->>'appointment_id' is not null and not exists (
    select 1 from public.appointments a where a.id = (ready->>'appointment_id')::uuid
  ) then
    ready := jsonb_set(ready, '{appointment_id}', 'null');
  end if;
  if ready->>'debt_id' is not null and not exists (
    select 1 from public.debts d where d.id = (ready->>'debt_id')::uuid
  ) then
    ready := jsonb_set(ready, '{debt_id}', 'null');
  end if;
  -- Налога в снимке не было — и не будет: иначе триггер VAT навесил бы его
  -- по сегодняшним настройкам счёта, команды и компании.
  if ready->>'vat_amount' is null then
    ready := jsonb_set(ready, '{vat_mode}', '"none"');
  end if;
  return ready;
end;
$function$;

-- ─── 2. Доход с живым чеком — не в ящик ───

create or replace function public.trash_deleted_operation()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Только удаление «Удалить» из приложения (`delete_operation`): стирание
  -- календаря, отмена перевода и каскад компании флага не ставят.
  if coalesce(current_setting('babun.operation_trash', true), '') <> 'on' then
    return old;
  end if;
  -- Чек к доходу ещё жив (гасящий триггер идёт после этого): удаление
  -- погасило бы его насовсем, и «Вернуть» его не оживит.
  if old.type = 'income' and exists (
    select 1 from public.receipts r where r.transaction_id = old.id and r.status = 'issued'
  ) then
    raise exception 'К этому доходу выписан чек — такую операцию не удалить'
      using errcode = '23514', hint = 'operation:has_receipt';
  end if;
  insert into public.deleted_operations
    (id, tenant_id, team_id, type, operation, deleted_by, deleted_at, purge_at)
  values
    (old.id, old.tenant_id, old.team_id, old.type, to_jsonb(old), auth.uid(),
     now(), now() + interval '30 days');
  return old;
end;
$function$;

drop trigger trg_trash_deleted_operation on public.finance_transactions;
create trigger trg_trash_deleted_operation
  before delete on public.finance_transactions
  for each row execute function public.trash_deleted_operation();

-- ─── 3. Снимки в ящике — история счёта ───

create or replace function public.account_has_history(p_account_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.finance_transactions f where f.account_id = p_account_id)
      or exists (select 1 from public.receipts r where r.account_id = p_account_id)
      or exists (select 1 from public.appointments a where a.payment_account_id = p_account_id)
      or exists (select 1 from public.invoices i where i.account_id = p_account_id)
      -- Операция в «Удалённых операциях» вернётся на этот счёт.
      or exists (
        select 1 from public.deleted_operations d
         where d.operation->>'account_id' = p_account_id::text
      );
$function$;

create or replace function public.guard_account_delete_with_history()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  tx_count integer;
  receipt_count integer;
  template_count integer;
  appointment_count integer;
begin
  -- Каскад от удаления самого тенанта пропускаем: там уносится всё вместе.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  select count(*) into tx_count
    from public.finance_transactions where account_id = old.id;
  -- Операции в «Удалённых операциях» вернутся на этот счёт — тоже история.
  tx_count := tx_count + (
    select count(*) from public.deleted_operations d
     where d.operation->>'account_id' = old.id::text
  );
  select count(*) into receipt_count
    from public.receipts where account_id = old.id;
  select count(*) into template_count
    from public.finance_templates where account_id = old.id;
  select count(*) into appointment_count
    from public.appointments where payment_account_id = old.id;

  if tx_count > 0 or receipt_count > 0 or appointment_count > 0 then
    raise exception
      'Счёт «%» нельзя удалить: на нём % операц., % чек(ов), % оплат по заявкам. Закройте счёт — история останется целой.',
      old.name, tx_count, receipt_count, appointment_count;
  end if;

  -- Шаблон операции — не деньги, его можно просто отвязать.
  if template_count > 0 then
    update public.finance_templates set account_id = null where account_id = old.id;
  end if;

  return old;
end;
$function$;

-- Ящик ищется по счёту снимка: в стирании счёта и ночной очистке.
create index if not exists deleted_operations_account_idx
  on public.deleted_operations ((operation->>'account_id'));

-- ─── 4. Сторож ───

do $guard$
begin
  -- Права исполнения `create or replace` не меняет — сверяем, что остались.
  if has_function_privilege('authenticated', 'public.trash_deleted_operation()', 'execute')
     or has_function_privilege('anon', 'public.deleted_operation_ready(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.deleted_operation_ready(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.account_has_history(uuid)', 'execute') then
    raise exception 'сторож: права исполнения функций ящика изменились';
  end if;
  if position('operation:has_receipt' in (select prosrc from pg_proc where oid = 'public.trash_deleted_operation()'::regprocedure)) = 0
     or position('"none"' in (select prosrc from pg_proc where oid = 'public.deleted_operation_ready(jsonb)'::regprocedure)) = 0
     or position('deleted_operations' in (select prosrc from pg_proc where oid = 'public.account_has_history(uuid)'::regprocedure)) = 0
     or position('deleted_operations' in (select prosrc from pg_proc where oid = 'public.guard_account_delete_with_history()'::regprocedure)) = 0 then
    raise exception 'сторож: исправления ящика не на месте';
  end if;
  -- Ящик — до удаления (BEFORE = бит 2 в tgtype), иначе чек уже отвязан.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.finance_transactions'::regclass
       and tgname = 'trg_trash_deleted_operation'
       and tgenabled = 'O'
       and tgtype & 2 = 2
  ) then
    raise exception 'сторож: триггер ящика не стоит до удаления';
  end if;
end
$guard$;
