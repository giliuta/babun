-- «ЗАКРЫТИЕ ДНЯ» ЧИТАЕТ СВЕРКИ КАСС — вторая половина слайса С6
-- (ТЗ docs/plans/ACCOUNTS-PAGE-REDESIGN-2026-08-10.md §5.5, §11.9; первая
-- половина — 20260811100000_cash_counts.sql, она завела account_cash_counts).
--
-- РЕШЕНИЕ ВЛАДЕЛЬЦА 2026-08-10: сверка кассы и «Закрытие дня» — ОДНА МЕХАНИКА
-- С ДВУМЯ ДВЕРЯМИ. Пишет только account_cash_counts; «Закрытие дня» её ЧИТАЕТ
-- и складывает. Второй фактической суммы, набранной пальцем на экране
-- закрытия, у продукта больше нет: это второй ответ на вопрос «сколько было в
-- кассе», и через неделю два ответа разъезжаются — а разошедшись, они не
-- говорят, какой из них правда.
--
-- ТРИ ВЕЩИ ЗДЕСЬ И ПОЧЕМУ ИМЕННО ТАК.
--
-- 1. ФАКТ ДНЯ = Σ ПОСЛЕДНИХ СВЕРОК ЭТОГО БИЗНЕС-ДНЯ по каждой кассе.
--    Клиентский параметр больше не участвует в расчёте вовсе.
--
-- 2. УЧЁТНАЯ БАЗА ДНЯ = Σ `expected` ТЕХ ЖЕ СВЕРОК, а НЕ остаток всех касс на
--    конец дня (`tenant_cash_ledger_cents`). Это главное решение файла, и оно
--    неочевидно, поэтому: `record_cash_count` при разнице ≠ 0 сразу пишет
--    операцию коррекции, то есть после пересчёта учёт РАВЕН насчитанному.
--    Если после пересчёта в 15:00 бригада приняла ещё €100, то к полуночи
--    «по учёту» = насчитанное + 100, и сравнение факта с полным остатком
--    напечатало бы недостачу €100 там, где не пропало ни цента. Сравнивать
--    сверку можно только с тем, против чего её и делали, — со снимком,
--    который сервер снял под замком в момент пересчёта.
--    Следствие, записанное явно: `delta_cash_cents` закрытого дня = сумма
--    разниц сверок этого дня, то есть ровно те деньги, которые сегодня
--    искали. Ноль по всем трём колонкам означает «в этот день кассы не
--    сверяли», и клиент печатает это словами, а не «€0».
--
-- 3. НЕЗАКРЫТЫХ КАСС МЫ НЕ ВЫДУМЫВАЕМ И НЕ ЗАПРЕЩАЕМ. Касса без сверки в
--    расчёт не входит ни одной из трёх колонок — ни фактом, ни учётом.
--    Подставить ей учётный остаток («наверное, сошлась») значит соврать той
--    самой цифрой, ради честности которой всё затевалось; запретить закрытие
--    дня до полного покрытия — значит поставить сервер в позу, из которой
--    компанию с забытой кассой компании не выпустит никто. Кто не сверен,
--    называет ЭКРАН закрытия дня: он видит и кассы, и их сверки, и предлагает
--    пересчитать прямо оттуда.


-- ─── 1. Каноническое определение «наличных денег компании» ───────────
--
-- ОДНО ОПРЕДЕЛЕНИЕ, И ОНО ЗДЕСЬ: физические наличные компании — это остатки
-- ВСЕХ АКТИВНЫХ счетов `kind='cash'`, независимо от `scope`. Касса компании —
-- такие же бумажные деньги в ящике, как касса бригады, и `record_cash_count`
-- пересчитывает ровно этот же набор (единственные его условия — `is_active` и
-- `kind='cash'`). Учёт и факт обязаны собираться по одному множеству.
--
-- ЧТО БЫЛО СЛОМАНО: фильтра `is_active` не было вовсе. Закрытый счёт — это
-- ёмкость, которой больше нет, но его `opening_balance` и вся его история
-- продолжали складываться в «Должно быть», и день закрывался против остатка,
-- включающего деньги, которых физически негде взять.
--
-- ЧЕМ ЭТО НЕ ЯВЛЯЕТСЯ: строка «Наличными на руках» на /accounts считает
-- ДРУГОЕ множество — только `scope='team'` и только положительные остатки, то
-- есть «выручка, которую бригады ещё не сдали». Это законный второй вопрос со
-- своим именем, и он никогда не подписывается словами «Должно быть».
create or replace function public.tenant_cash_ledger_cents(
  p_tenant_id uuid,
  p_as_of_date date
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  tenant_timezone text;
  ledger_cents bigint;
begin
  select cs.timezone into tenant_timezone
    from public.calendar_settings cs
   where cs.tenant_id = p_tenant_id;
  tenant_timezone := coalesce(nullif(btrim(tenant_timezone), ''), 'Europe/Nicosia');
  begin
    perform current_timestamp at time zone tenant_timezone;
  exception when invalid_parameter_value then
    tenant_timezone := 'Europe/Nicosia';
  end;

  select
    coalesce((
      select sum(round(a.opening_balance * 100)::bigint)
        from public.accounts a
       where a.tenant_id = p_tenant_id
         and a.kind = 'cash'
         and a.is_active
         and (a.created_at at time zone tenant_timezone)::date <= p_as_of_date
    ), 0)::bigint
    +
    coalesce((
      select sum(
        round(
          case
            when tx.type = 'expense' then -abs(tx.amount)
            when tx.type = 'refund' then -abs(tx.amount)
            else tx.amount
          end * 100
        )::bigint
      )
        from public.finance_transactions tx
        join public.accounts a
          on a.id = tx.account_id
         and a.tenant_id = tx.tenant_id
       where tx.tenant_id = p_tenant_id
         and a.kind = 'cash'
         and a.is_active
         and tx.occurred_on <= p_as_of_date
    ), 0)::bigint
    into ledger_cents;

  return coalesce(ledger_cents, 0);
end;
$function$;

revoke all on function public.tenant_cash_ledger_cents(uuid, date)
  from public, anon, authenticated;

comment on function public.tenant_cash_ledger_cents(uuid, date) is
$doc$Наличные деньги компании по учёту на дату: opening_balance + подписанные движения по ВСЕМ АКТИВНЫМ счетам kind='cash' любого scope. Каноническое определение «физических наличных» на весь продукт; тот же набор пересчитывает record_cash_count. Строка «Наличными на руках» на /accounts — другое множество (только команды и только плюсовые остатки) и другой вопрос: «что ещё не сдано».$doc$;


-- ─── 2. Закрытие дня по сверкам ──────────────────────────────────────
create or replace function public.close_business_day(p_business_date date)
returns setof public.day_closures
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  existing_row public.day_closures%rowtype;
  counted_cents bigint;
  expected_cents bigint;
begin
  if auth.uid() is null
     or tenant_uuid is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'Закрыть день может только владелец';
  end if;
  if p_business_date is null then
    raise exception 'Не удалось определить дату закрытия';
  end if;
  if p_business_date > public.tenant_business_date(tenant_uuid) then
    raise exception 'Нельзя закрыть будущую дату';
  end if;

  -- Тот же тенантный замок, который берёт guard_closed_day_finance_write на
  -- каждой записи в леджер и record_cash_count на каждой сверке: снимок дня
  -- атомарен и с операциями, и с пересчётами касс.
  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':day-closure-ledger', 0)
  );

  select * into existing_row
    from public.day_closures
   where day_closures.tenant_id = tenant_uuid
     and day_closures.business_date = p_business_date
   for update;

  -- Уже закрыт — возвращаем как есть. Прежняя версия умела падать «День уже
  -- закрыт с другой фактической суммой»: сравнивать было с чем, потому что
  -- сумму присылал клиент. Теперь число одно и оно серверное, поэтому повтор
  -- закрытия — это просто повтор, а не конфликт.
  if found and existing_row.is_closed then
    return query
      select * from public.day_closures
       where day_closures.tenant_id = tenant_uuid
         and day_closures.business_date = p_business_date;
    return;
  end if;

  -- ПОСЛЕДНЯЯ сверка каждой кассы за этот день: кассу пересчитывают дважды
  -- ровно тогда, когда первый результат оказался неверным, и вторая сверка
  -- отменяет первую (её разница уже списана отдельной операцией).
  select
    coalesce(sum(round(day_counts.counted * 100))::bigint, 0),
    coalesce(sum(round(day_counts.expected * 100))::bigint, 0)
    into counted_cents, expected_cents
    from (
      select distinct on (c.account_id) c.counted, c.expected
        from public.account_cash_counts c
       where c.tenant_id = tenant_uuid
         and c.business_date = p_business_date
       order by c.account_id, c.counted_at desc, c.created_at desc
    ) as day_counts;

  insert into public.day_closures (
    tenant_id, business_date, is_closed, expected_cash_cents,
    actual_cash_cents, delta_cash_cents, closed_at, closed_by,
    reopened_at, reopened_by, revision
  ) values (
    tenant_uuid, p_business_date, true, expected_cents,
    counted_cents, counted_cents - expected_cents,
    now(), auth.uid(), null, null,
    coalesce(existing_row.revision, 0) + 1
  )
  on conflict (tenant_id, business_date) do update
    set is_closed = true,
        expected_cash_cents = excluded.expected_cash_cents,
        actual_cash_cents = excluded.actual_cash_cents,
        delta_cash_cents = excluded.delta_cash_cents,
        currency = 'EUR',
        closed_at = excluded.closed_at,
        closed_by = excluded.closed_by,
        reopened_at = null,
        reopened_by = null,
        revision = public.day_closures.revision + 1,
        updated_at = now();

  return query
    select * from public.day_closures
     where day_closures.tenant_id = tenant_uuid
       and day_closures.business_date = p_business_date;
end;
$function$;

comment on function public.close_business_day(date) is
$doc$Закрытие дня (ТЗ §5.5). КАНОНИЧЕСКАЯ сигнатура: фактическую сумму кассы клиент не присылает.

Факт дня = Σ ПОСЛЕДНИХ сверок этого бизнес-дня по каждой кассе (account_cash_counts). Учётная база дня = Σ expected ТЕХ ЖЕ сверок, а не остаток всех касс на конец дня: record_cash_count списывает разницу сразу, поэтому оплата, принятая ПОСЛЕ пересчёта, при сравнении с полным остатком печаталась бы недостачей. Отсюда delta_cash_cents = сумма разниц сверок дня.

Касса без сверки в расчёт не входит вовсе — ни фактом, ни учётом. Ноль по всем трём колонкам означает «в этот день кассы не сверяли»; называть непересчитанные кассы — работа экрана закрытия дня.

Идемпотентность: повторное закрытие возвращает уже записанную строку.$doc$;

revoke all on function public.close_business_day(date) from public, anon;
grant execute on function public.close_business_day(date) to authenticated;


-- ─── 3. Старая сигнатура: жива, но обезоружена ───────────────────────
--
-- РЕШЕНИЕ: старую функцию НЕ удаляем и НЕ ломаем — она остаётся точкой входа
-- для уже установленных сборок приложения (обновление у владельца на телефоне
-- не совпадает по времени с накаткой миграции), но её второй аргумент
-- ИГНОРИРУЕТСЯ. Альтернатива «удалить» означала бы, что вчерашняя сборка не
-- может закрыть день вовсе; альтернатива «оставить как было» означала бы, что
-- второе число живо ровно там, где мы его убиваем. Игнорирование закрывает обе
-- дыры сразу: старый клиент продолжает работать, но его цифра ни на что не
-- влияет, а в ответе он получает то, что посчитал сервер, — и печатает уже
-- правду.
--
-- Удалить эту функцию можно, когда в проде не останется сборок, зовущих её с
-- двумя аргументами.
create or replace function public.close_business_day(
  p_business_date date,
  p_actual_cash_cents bigint
)
returns setof public.day_closures
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Значение намеренно не используется: факт дня складывается из сверок касс.
  -- Проверять его тоже незачем — отказ из-за числа, которое ни на что не
  -- влияет, был бы чистой формальностью.
  perform p_actual_cash_cents;

  return query select * from public.close_business_day(p_business_date);
end;
$function$;

comment on function public.close_business_day(date, bigint) is
$doc$УСТАРЕВШАЯ сигнатура закрытия дня. Оставлена ради уже установленных сборок приложения; p_actual_cash_cents ИГНОРИРУЕТСЯ и делегирует в close_business_day(date). Второй фактической суммы, набранной пальцем, у продукта нет: факт дня считается из account_cash_counts. Удалить, когда в проде не останется клиентов с двумя аргументами.$doc$;

revoke all on function public.close_business_day(date, bigint) from public, anon;
grant execute on function public.close_business_day(date, bigint) to authenticated;


-- ─── 4. Deploy-assertions ────────────────────────────────────────────
-- Половина этой поверхности — это экран, который закрывает день числом из
-- ниоткуда. Либо всё целиком, либо миграция падает.
do $audit$
begin
  -- Читать нечего — закрывать нечем.
  if to_regclass('public.account_cash_counts') is null then
    raise exception
      'закрытие дня: нет account_cash_counts — сначала примените 20260811100000_cash_counts.sql';
  end if;

  if to_regprocedure('public.close_business_day(date)') is null then
    raise exception 'закрытие дня: канонической сигнатуры close_business_day(date) нет';
  end if;
  if not exists (
    select 1 from pg_proc
     where oid = to_regprocedure('public.close_business_day(date)')::oid
       and prosecdef
  ) then
    raise exception 'закрытие дня: close_business_day(date) должен быть SECURITY DEFINER';
  end if;
  if obj_description(
       to_regprocedure('public.close_business_day(date)')::oid, 'pg_proc'
     ) is null then
    raise exception 'закрытие дня: потерян comment on function с контрактом';
  end if;
  if has_function_privilege('anon', 'public.close_business_day(date)', 'EXECUTE') then
    raise exception 'закрытие дня: close_business_day вызывается анонимом';
  end if;
  if not has_function_privilege(
       'authenticated', 'public.close_business_day(date)', 'EXECUTE'
     ) then
    raise exception 'закрытие дня: приложение не может закрыть день';
  end if;

  -- Уже установленные сборки зовут старую сигнатуру: её исчезновение — это
  -- телефон, который перестал закрывать день после накатки миграции.
  if to_regprocedure('public.close_business_day(date,bigint)') is null then
    raise exception 'закрытие дня: старая сигнатура снесена — вчерашние сборки останутся без закрытия дня';
  end if;

  -- Канарейка на определение наличных: если более старая миграция когда-нибудь
  -- прокатится поверх и вернёт функцию без фильтра активности, «Должно быть»
  -- снова начнёт считать деньги закрытых счетов, и заметить это будет нечем.
  if not exists (
    select 1 from pg_proc
     where oid = to_regprocedure('public.tenant_cash_ledger_cents(uuid,date)')::oid
       and prosrc like '%a.is_active%'
  ) then
    raise exception
      'закрытие дня: tenant_cash_ledger_cents снова считает закрытые счета';
  end if;
end;
$audit$;
