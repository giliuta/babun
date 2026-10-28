-- ПОЛ ДАТЫ ПЕРЕВОДА — И НА СЕРВЕРЕ (аудит 035, №171 / F-20).
--
-- Лист перевода не даёт выбрать день раньше первой операции компании (без
-- операций — раньше начала прошлого месяца, `transferDateFloor`), а
-- `record_account_transfer` принимал любую прошлую дату: прямой вызов
-- записывал перевод хоть в 1900 год, и выписка счёта начиналась с него.
-- Теперь сервер держит тот же пол и ни у кого не строже листа: первая
-- операция считается по всей компании (лист партнёра видит не все счета — его
-- пол тот же или позже), а начало прошлого месяца — нижняя граница и для
-- компании, где первая операция недавняя.
--
-- Минус источника за прошлые дни не запрещается: минус разрешён всем (решение
-- 035), лист предупреждает о нём под кнопкой. Повтор того же запроса отвечает
-- раньше проверки — уже записанный перевод она не отбивает.
--
-- Тело правится по якорям в живом определении.

do $migration$
declare
  d text := pg_get_functiondef('public.record_account_transfer(uuid, uuid, uuid, numeric, date, text)'::regprocedure);
  a1 constant text := E'  transfer_date date;\n';
  r1 constant text := E'  transfer_date date;\n'
    || E'  transfer_floor date;\n';
  a2 constant text := E'  select round(\n'
    || E'    from_account.opening_balance + coalesce(sum(\n';
  r2 constant text := E'  -- Пол — как у листа перевода, но не позже начала прошлого месяца.\n'
    || E'  transfer_floor := (date_trunc(''month'', public.tenant_business_date(tenant_uuid)) - interval ''1 month'')::date;\n'
    || E'  select least(coalesce(min(t.occurred_on), transfer_floor), transfer_floor)\n'
    || E'    into transfer_floor\n'
    || E'    from public.finance_transactions t\n'
    || E'   where t.tenant_id = tenant_uuid;\n'
    || E'  if transfer_date < transfer_floor then\n'
    || E'    raise exception ''Выберите дату не раньше первой операции компании'';\n'
    || E'  end if;\n'
    || E'\n'
    || a2;
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'record_account_transfer: якоря пола даты не найдены ровно один раз';
  end if;
  execute replace(replace(d, a1, r1), a2, r2);
end;
$migration$;

do $guard$
begin
  if position('if transfer_date < transfer_floor then' in pg_get_functiondef(
       'public.record_account_transfer(uuid, uuid, uuid, numeric, date, text)'::regprocedure)) = 0 then
    raise exception 'record_account_transfer: пол даты не записан';
  end if;
  if has_function_privilege('anon', 'public.record_account_transfer(uuid, uuid, uuid, numeric, date, text)', 'execute') then
    raise exception 'record_account_transfer исполним для anon';
  end if;
end;
$guard$;
