-- НДС: ПЕРЕВОД — НЕ ВЫРУЧКА, А «БЕЗ НДС» — ЭТО «БЕЗ НДС».
--
-- Три дефекта одного триггера, и все три видит клиент — на бумажном чеке.
--
-- 1. ПЕРЕВОД МЕЖДУ СВОИМИ СЧЕТАМИ ОБЛАГАЛСЯ НАЛОГОМ.
--    `record_account_transfer` пишет две ноги type='transfer' и не передаёт
--    ни ставку, ни сумму налога. Триггер видел пустое поле, шёл в настройки
--    компании и честно «извлекал» НДС из перекладывания денег из кассы на
--    карту. Государству от этого ничего не причитается: выручки не возникло,
--    деньги как были нашими, так и остались. В отчёте по налогу появлялась
--    несуществующая база, причём ДВАЖДЫ — на обеих ногах.
--
-- 2. ЯВНОЕ «БЕЗ НДС» ПЕРЕБИВАЛОСЬ НАЛОГОМ КОМПАНИИ.
--    Владелец жмёт на операции «без НДС» (три клавиши: без НДС / включён /
--    плюс), а сервер всё равно проставляет ставку компании — и она уезжает в
--    ЧЕК КЛИЕНТУ. Клиент получает бумагу с налогом, которого не платил.
--    В версии, лежащей в репозитории (20260809110000_vat.sql), про 'none' не
--    знали вовсе; в проде проверка есть, но стоит ПОСЛЕ ветки «уважаем готовый
--    снимок» — то есть переданный откуда-то vat_amount перебивал явное «без».
--    Теперь «без НДС», сказанное вслух, сильнее любого наследования и любого
--    снимка: это единственная строка, которую владелец нажал руками.
--
-- 3. РЕЖИМ СЧЁТА СЕРВЕР НЕ ВИДЕЛ.
--    «Счёт с НДС» — обычная практика: на расчётный падают деньги с налогом, а
--    в кассу от частника — без. Цепочка теперь счёт → команда → компания.
--    Своей СТАВКИ у счёта нет намеренно (колонки такой не заводили): ставку
--    задаёт страна работы команды — Кипр 19, Греция 24 — а счёт отвечает
--    только на вопрос «здесь налог есть или нет».
--
-- Что НЕ меняется: математика. В базу всегда приходит ВАЛОВАЯ сумма, налог
-- извлекается из неё одной формулой gross × rate / (100 + rate), знак
-- сохраняется (возврат уносит и налог). inclusive и exclusive отличаются
-- только тем, как назначали цену, — на проводку это не влияет.

create or replace function public.fill_transaction_vat()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  mode text;
  rate numeric;
begin
  -- Перевод — не событие для налога: деньги не пришли и не ушли, они просто
  -- сменили карман. Обнуляем оба поля, а не только ставку: если кто-то
  -- передал снимок, он всё равно неверен.
  if new.type = 'transfer' then
    new.vat_rate := null;
    new.vat_amount := null;
    return new;
  end if;

  -- «Без НДС» сказано вслух — молчим, даже если у компании налог включён и
  -- даже если пришёл готовый снимок. Это самое сильное правило в функции.
  if new.vat_mode = 'none' then
    new.vat_rate := null;
    new.vat_amount := null;
    return new;
  end if;

  -- Явно переданный снимок уважаем: инвойс печатает свою ставку и она уже
  -- напечатана на бумаге — пересчитывать её задним числом нельзя.
  if new.vat_amount is not null then
    return new;
  end if;

  -- Режим: счёт → команда → компания. Ставка: команда → компания (у счёта
  -- своей ставки нет, см. шапку).
  select coalesce(a.vat_mode, s.vat_mode, t.vat_mode),
         coalesce(s.vat_rate, t.vat_rate)
    into mode, rate
    from public.tenants t
    left join public.team_finance_settings s
      on s.tenant_id = t.id and s.team_id = new.team_id
    left join public.accounts a
      on a.id = new.account_id and a.tenant_id = t.id
   where t.id = new.tenant_id;

  if mode is null or mode = 'off' or coalesce(rate, 0) <= 0 then
    return new;
  end if;

  new.vat_rate := rate;
  -- Из ВАЛОВОЙ суммы: в кассу пришло 480, налог внутри — 80.
  -- Знак сохраняем (возврат уносит и налог).
  new.vat_amount := round(new.amount * rate / (100 + rate), 2);
  return new;
end;
$function$;

-- ─── Разовая уборка: снять налог с уже записанных ног переводов ──────
--
-- В проде на 2026-08-10 таких строк ноль, и блок ниже честно ничего не делает.
-- Но миграция обязана быть верной и для клиента, у которого НДС включён давно:
-- у него ноги переводов лежат с налогом, и без этой уборки исправленный
-- триггер починит только будущее.
--
-- ПОЧЕМУ ЗДЕСЬ ГЛУШАТСЯ ТРИГГЕРЫ. `trg_assert_finance_transaction_integrity`
-- запрещает редактировать перевод («Перевод нельзя редактировать; отмените его
-- целиком»), а `finance_transactions_closed_day_guard` запрещает трогать
-- закрытый день. Оба правила верны для человека и оба мешают технической
-- уборке, которая не двигает ни копейки: меняются только vat_rate и
-- vat_amount. Тот же приём с тем же обоснованием уже применяет
-- `delete_sole_owned_tenants_for_account` при чистке атрибуции.
--
-- Всё завёрнуто в ОДИН do-блок намеренно: это одна инструкция верхнего уровня,
-- поэтому даже при runner-е без внешней транзакции ошибка внутри откатит и
-- UPDATE, и снятие триггеров. Оставить базу с выключенными триггерами
-- невозможно. `enable trigger user` возвращает всем триггерам состояние 'O'
-- (origin) — ровно то, в котором они были.
do $transfer_vat_cleanup$
declare
  affected integer := 0;
begin
  if not exists (
    select 1 from public.finance_transactions
     where type = 'transfer'
       and (vat_rate is not null or vat_amount is not null)
  ) then
    -- Чинить нечего — не берём ACCESS EXCLUSIVE на денежную таблицу.
    return;
  end if;

  alter table public.finance_transactions disable trigger user;

  update public.finance_transactions
     set vat_rate = null,
         vat_amount = null
   where type = 'transfer'
     and (vat_rate is not null or vat_amount is not null);
  get diagnostics affected = row_count;

  alter table public.finance_transactions enable trigger user;

  raise notice 'НДС снят с % ног переводов', affected;
end;
$transfer_vat_cleanup$;

-- ─── Deploy assertions ───────────────────────────────────────────────
do $audit$
begin
  if to_regprocedure('public.fill_transaction_vat()') is null then
    raise exception 'НДС: функция fill_transaction_vat пропала';
  end if;

  if (select count(*) from pg_trigger
       where not tgisinternal
         and tgrelid = 'public.finance_transactions'::regclass
         and tgname = 'trg_fill_transaction_vat') <> 1 then
    raise exception 'НДС: триггер trg_fill_transaction_vat не подключён к finance_transactions';
  end if;

  -- Защита от «откатили более старой миграцией»: в репозитории лежит файл
  -- 20260809110000_vat.sql со СТАРЫМ телом функции (без счёта и без 'none').
  -- Если он когда-нибудь применится следом, налог снова поедет в чек.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'fill_transaction_vat'
       and p.prosrc like '%transfer%'
       and p.prosrc like '%none%'
       and p.prosrc like '%a.vat_mode%'
  ) then
    raise exception 'НДС: в fill_transaction_vat старое тело — нет ветки перевода, none или режима счёта';
  end if;

  if exists (
    select 1 from public.finance_transactions
     where type = 'transfer'
       and (vat_rate is not null or vat_amount is not null)
  ) then
    raise exception 'НДС: остались ноги переводов с налогом';
  end if;
end;
$audit$;

-- Триггер BEFORE INSERT, поэтому проверка «операция с «Без НДС» не получает
-- налог» делается на живой вставке, а не здесь: миграция ничего не пишет в
-- ленту. Сценарий приёмки — в docs/plans/ACCOUNTS-PAGE-REDESIGN-2026-08-10.md,
-- слайс С3.
