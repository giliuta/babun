-- ОПЕРАЦИЯ СЕГОДНЯШНЕГО ДНЯ — СО ВРЕМЕНЕМ.
--
-- Доход и расход форма пишет со временем, а перевод (`record_account_transfer`)
-- и оплата инвойса — только датой. Лента «Финансов» сортирует день по времени,
-- и строка без времени падала под все операции дня: перевод, сделанный в
-- 12:56, стоял ниже бензина 12:08 и без часов в подписи.
--
-- Один сторож на любой путь вставки, а не правка каждой функции: строка без
-- времени, записанная СЕГОДНЯШНИМ днём компании, получает текущее время
-- компании (до минуты, как у формы). Задним числом время не выдумываем —
-- там его правда никто не знает. Уже лежащие строки не трогаем: правка
-- проводок инвойса и строк с чеком закрыта своими сторожами.

create or replace function public.stamp_finance_transaction_time()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  tenant_timezone text;
  local_now timestamp;
begin
  if new.occurred_time is not null or new.occurred_on is null then
    return new;
  end if;
  select cs.timezone into tenant_timezone
    from public.calendar_settings cs
   where cs.tenant_id = new.tenant_id;
  tenant_timezone := coalesce(nullif(btrim(tenant_timezone), ''), 'Europe/Nicosia');
  begin
    local_now := current_timestamp at time zone tenant_timezone;
  exception when invalid_parameter_value then
    local_now := current_timestamp at time zone 'Europe/Nicosia';
  end;
  if new.occurred_on = local_now::date then
    new.occurred_time := date_trunc('minute', local_now)::time;
  end if;
  return new;
end;
$function$;

revoke all on function public.stamp_finance_transaction_time() from public, anon, authenticated;

drop trigger if exists trg_aa_stamp_finance_time on public.finance_transactions;
create trigger trg_aa_stamp_finance_time
  before insert on public.finance_transactions
  for each row execute function public.stamp_finance_transaction_time();
