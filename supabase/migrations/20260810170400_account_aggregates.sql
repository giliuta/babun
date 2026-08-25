-- СЕРВЕРНЫЕ АГРЕГАТЫ ПО СЧЕТАМ — слайс С2 (ТЗ docs/plans/ACCOUNTS-PAGE-REDESIGN-2026-08-10.md, §11.1 и §11.2).
--
-- ЗАЧЕМ.
--   Сегодня баланс счёта считается на телефоне: listAccountBalanceDeltas
--   (packages/shared/src/db/repositories/finance-transactions.ts:158) выкачивает
--   ВСЮ ленту тенанта страницами по 1000 строк и складывает знаки в памяти, а
--   карточка одного счёта поверх этого тянет ПОЛНЫЙ месячный срез по всем
--   счетам ради одного. Это работает, пока операций мало: порог отказа ~25 000
--   строк, дальше экран «Счета» просто не открывается — трафик, память, время.
--   Обе функции ниже считают то же самое в базе: один проход по леджеру, один
--   GROUP BY, ответ в несколько строк.
--
-- ГЛАВНОЕ В ЭТОМ ФАЙЛЕ — ЗНАК. Он ровно один на весь продукт:
--     expense  -> -amount        (расход хранится положительным)
--     refund   -> -abs(amount)   (возврат УЖЕ лежит в базе отрицательным,
--                                 -abs() вычитает его ОДИН раз, а не дважды)
--     income   -> +amount
--     transfer -> +amount        (нога перевода уже несёт свой знак:
--                                 списание -100, зачисление +100)
--   Формула не сочинена здесь заново — она дословно скопирована из
--   guard_account_financial_history (20260720210006_finance_integrity.sql) и
--   record_account_transfer (20260727100001_shared_accounts.sql), то есть из
--   тех мест, которые уже решают «можно ли закрыть счёт» и «хватает ли денег на
--   перевод». Любая витрина, считающая иначе, разъедется с этими проверками.
--   Живой контрпример: тенант Giliuta, июнь 2026, счёт «Карта» бригады
--   team-mp8379ea-i8ith — верный net €180, запрещённая формула
--   «доход − расход − возврат» даёт €280 (возврат хранится отрицательным, и
--   вычитание прибавляет его к приходу).
--
-- ДОСТУП. Обе функции SECURITY DEFINER (иначе RLS не даст сложить чужие строки
--   внутри тенанта) и потому обязаны сами быть границей: роль проверяется явно
--   (owner), тенант берётся из auth.uid() через current_tenant_id(), а
--   переданному клиентом p_tenant не верим — он только сверяется. Счета и
--   деньги в v1 видит только владелец (§«Счета и переводы в v1 — только
--   владелец»), поэтому отказ здесь — исключение, а не пустой ответ: пустой
--   ответ герой экрана напечатал бы как «€0», то есть соврал бы про деньги.


-- ── Индекс под оба агрегата ──────────────────────────────────────────
-- Существующие индексы ведут либо от счёта (idx_finance_tx_account_occurred),
-- либо от даты (idx_finance_tx_tenant_occurred). Обе функции ходят иначе: «вся
-- лента одной компании, сгруппированная по счёту». Покрывающий индекс
-- (tenant_id, account_id, occurred_on) INCLUDE (type, amount) отдаёт им ровно
-- те четыре колонки, которые участвуют в формуле, — то есть на десятках тысяч
-- строк агрегат читает индекс и не ходит в таблицу вовсе.
create index if not exists idx_finance_tx_tenant_account_occurred
  on public.finance_transactions (tenant_id, account_id, occurred_on)
  include (type, amount);


-- ── 1. account_balances(p_tenant) ────────────────────────────────────
-- Заменяет выкачивание ленты на телефон. Одна строка на счёт компании плюс —
-- обязательно — строка «деньги без счёта» с account_id IS NULL.
create or replace function public.account_balances(p_tenant uuid)
returns table (
  account_id      uuid,
  delta           numeric,
  has_history     boolean,
  is_active       boolean,
  last_outflow_on date,
  last_tx_on      date,
  first_tx_on     date
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Балансы счетов доступны только владельцу';
  end if;
  if tenant_uuid is null then
    raise exception 'Компания не определена';
  end if;
  -- p_tenant существует ради явности вызова и ошибки при рассинхроне сессии;
  -- считаем ВСЕГДА по tenant_uuid из auth.uid(), а не по тому, что прислал клиент.
  if p_tenant is not null and p_tenant is distinct from tenant_uuid then
    raise exception 'Счета другой компании недоступны';
  end if;

  return query
  with ledger as (
    -- ЕДИНСТВЕННЫЙ GROUP BY функции. NULL-группа здесь появляется сама: строки
    -- с account_id IS NULL — это деньги, потерявшие адрес (в проде такая есть,
    -- €120 у тенанта test@babun.dev). Без них герой «Всего денег» врёт ровно на
    -- эту сумму, поэтому группа не отфильтровывается, а доезжает до клиента.
    select
      t.account_id as ledger_account_id,
      sum(
        case
          when t.type = 'expense' then -t.amount
          when t.type = 'refund' then -abs(t.amount)
          else t.amount
        end
      ) as ledger_delta,
      count(*) as tx_count,
      -- «Сдача кассы»: нога перевода, уносящая деньги СО счёта. Из неё и из
      -- first_tx_on считается подпись «На руках N дней» — периодный агрегат тут
      -- не помог бы, кассу могли сдавать задолго до выбранного периода.
      max(t.occurred_on) filter (
        where t.type = 'transfer' and t.amount < 0
      ) as ledger_last_outflow_on,
      max(t.occurred_on) as ledger_last_tx_on,
      min(t.occurred_on) as ledger_first_tx_on
    from public.finance_transactions t
    where t.tenant_id = tenant_uuid
    group by t.account_id
  ),
  tenant_accounts as (
    select a.id, a.is_active
    from public.accounts a
    where a.tenant_id = tenant_uuid
  )
  select
    -- FULL JOIN, а не LEFT: слева нужны счета без единой операции (баланс =
    -- один только opening_balance), справа — группа без счёта. Ключ
    -- «ledger.ledger_account_id = tenant_accounts.id» для NULL-группы не
    -- совпадает ни с чем, поэтому она выходит отдельной строкой с NULL.
    coalesce(tenant_accounts.id, ledger.ledger_account_id) as account_id,
    -- Только дельта леджера: opening_balance счёта клиент уже знает из listAccounts
    -- и прибавляет сам (balance = opening_balance + delta).
    round(coalesce(ledger.ledger_delta, 0), 2) as delta,
    coalesce(ledger.tx_count, 0) > 0 as has_history,
    -- У строки «деньги без счёта» счёта нет, а спрятать её нельзя: клиент
    -- фильтрует список по is_active, и NULL здесь означал бы потерянные деньги.
    coalesce(tenant_accounts.is_active, true) as is_active,
    ledger.ledger_last_outflow_on as last_outflow_on,
    ledger.ledger_last_tx_on as last_tx_on,
    ledger.ledger_first_tx_on as first_tx_on
  from tenant_accounts
  full join ledger on ledger.ledger_account_id = tenant_accounts.id;
end;
$$;

comment on function public.account_balances(uuid) is
$doc$Балансы всех счетов компании одним запросом (ТЗ §11.1). Только владелец; тенант берётся из auth.uid(), p_tenant лишь сверяется.

delta — сумма подписанных операций счёта БЕЗ opening_balance: expense = -amount, refund = -abs(amount) (возврат хранится отрицательным и вычитается ОДИН раз), income и нога перевода = +amount. Та же формула, что в guard_account_financial_history и record_account_transfer. Баланс счёта = accounts.opening_balance + delta.

has_history — были ли у счёта операции вообще (счёт без истории возвращается с delta = 0).
is_active — из accounts; у строки «деньги без счёта» его нет, поэтому отдаётся true, иначе фильтр по активным потерял бы эти деньги.
last_outflow_on — дата последней ноги перевода СО счёта (type='transfer' и amount < 0), то есть последней сдачи кассы; из неё и first_tx_on считается «На руках N дней».
last_tx_on / first_tx_on — крайние даты операций счёта; last_tx_on отвечает на «были ли операции с прошлой сверки».

Строка с account_id IS NULL — операции без счёта (FK on delete set null оставил их без адреса). Она обязана попадать в «Всего денег», иначе итог занижен ровно на её сумму.$doc$;

revoke all on function public.account_balances(uuid) from public, anon;
grant execute on function public.account_balances(uuid) to authenticated;


-- ── 2. account_period_totals(p_tenant, p_from, p_to) ─────────────────
-- Колонка «ЗА ПЕРИОД» карточки счёта и герой экрана — одним запросом на весь
-- экран. Период включает обе границы.
create or replace function public.account_period_totals(
  p_tenant uuid,
  p_from   date,
  p_to     date
)
returns table (
  account_id     uuid,
  opening_before numeric,
  income         numeric,
  expense        numeric,
  refund         numeric,
  transfer_in    numeric,
  transfer_out   numeric,
  net            numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Сводка по счетам доступна только владельцу';
  end if;
  if tenant_uuid is null then
    raise exception 'Компания не определена';
  end if;
  if p_tenant is not null and p_tenant is distinct from tenant_uuid then
    raise exception 'Счета другой компании недоступны';
  end if;
  if p_from is null or p_to is null then
    raise exception 'Укажите период целиком';
  end if;
  -- Не косметика: единственный проход по леджеру обрезан сверху по p_to, и
  -- перевёрнутый период молча потерял бы часть истории в opening_before.
  if p_from > p_to then
    raise exception 'Начало периода позже его конца';
  end if;

  return query
  with ledger as (
    -- ЕДИНСТВЕННЫЙ GROUP BY функции: одно чтение ленты до конца периода,
    -- «до начала» и «внутри» разводятся через FILTER, а не вторым запросом.
    -- Верхняя граница стоит один раз здесь, в WHERE, поэтому ниже в FILTER
    -- хватает нижней.
    select
      t.account_id as ledger_account_id,
      sum(
        case
          when t.type = 'expense' then -t.amount
          when t.type = 'refund' then -abs(t.amount)
          else t.amount
        end
      ) filter (where t.occurred_on < p_from) as delta_before,
      sum(t.amount) filter (
        where t.type = 'income' and t.occurred_on >= p_from
      ) as income_total,
      -- Расход хранится положительным — отдаём его уже с минусом (см. комментарий функции).
      sum(-t.amount) filter (
        where t.type = 'expense' and t.occurred_on >= p_from
      ) as expense_total,
      -- Возврат уже лежит отрицательным; -abs() делает знак независимым от того,
      -- как строка попала в базу, и не даёт вычесть возврат дважды.
      sum(-abs(t.amount)) filter (
        where t.type = 'refund' and t.occurred_on >= p_from
      ) as refund_total,
      sum(t.amount) filter (
        where t.type = 'transfer' and t.amount > 0 and t.occurred_on >= p_from
      ) as transfer_in_total,
      sum(t.amount) filter (
        where t.type = 'transfer' and t.amount < 0 and t.occurred_on >= p_from
      ) as transfer_out_total,
      -- net — то единственное, что читает герой. Перевод исключён: он меняет
      -- место денег, а не их количество.
      sum(
        case
          when t.type = 'expense' then -t.amount
          when t.type = 'refund' then -abs(t.amount)
          else t.amount
        end
      ) filter (
        where t.type <> 'transfer' and t.occurred_on >= p_from
      ) as net_total
    from public.finance_transactions t
    where t.tenant_id = tenant_uuid
      and t.occurred_on <= p_to
    group by t.account_id
  ),
  tenant_accounts as (
    select a.id, a.opening_balance
    from public.accounts a
    where a.tenant_id = tenant_uuid
  )
  select
    coalesce(tenant_accounts.id, ledger.ledger_account_id) as account_id,
    -- Остаток на начало периода = стартовый остаток счёта плюс всё, что было
    -- ДО p_from. Считается здесь, а не вычитанием из текущего баланса: при
    -- выборе «Прошлый месяц» вычитание напечатало бы не тот остаток.
    -- У строки «деньги без счёта» стартового остатка нет — берём 0.
    round(
      coalesce(tenant_accounts.opening_balance, 0) + coalesce(ledger.delta_before, 0),
      2
    ) as opening_before,
    round(coalesce(ledger.income_total, 0), 2) as income,
    round(coalesce(ledger.expense_total, 0), 2) as expense,
    round(coalesce(ledger.refund_total, 0), 2) as refund,
    round(coalesce(ledger.transfer_in_total, 0), 2) as transfer_in,
    round(coalesce(ledger.transfer_out_total, 0), 2) as transfer_out,
    round(coalesce(ledger.net_total, 0), 2) as net
  from tenant_accounts
  full join ledger on ledger.ledger_account_id = tenant_accounts.id;
end;
$$;

comment on function public.account_period_totals(uuid, date, date) is
$doc$Движение по счетам за период (ТЗ §11.2). Только владелец; тенант берётся из auth.uid(), p_tenant лишь сверяется. Границы периода включены обе.

ВСЕ ДЕНЕЖНЫЕ КОЛОНКИ ВОЗВРАЩАЮТСЯ УЖЕ СО ЗНАКОМ. Клиент не складывает знаки и не ставит минусы сам — он печатает то, что пришло, и складывает подряд:
  income       >= 0  (приход)
  expense      <= 0  (-sum(amount): расход хранится положительным, минус ставит сервер)
  refund       <= 0  (-sum(abs(amount)): возврат УЖЕ лежит в базе отрицательным, поэтому берётся abs и вычитается ОДИН раз)
  transfer_in  >= 0  (ноги переводов НА счёт)
  transfer_out <= 0  (ноги переводов СО счёта, знак уже в базе)
Отсюда правило вёрстки: «− refund» и «− expense» писать НЕЛЬЗЯ — это удвоит вычитание. Живая проверка: Giliuta, июнь 2026, «Карта» бригады team-mp8379ea-i8ith даёт net €180, а запрещённая формула «доход − расход − возврат» — €280.

opening_before — остаток счёта на начало периода: accounts.opening_balance + все подписанные операции ДО p_from. Не выводится вычитанием из текущего баланса, иначе «Прошлый месяц» показал бы не тот остаток.
Остаток на конец = opening_before + income + expense + refund + transfer_in + transfer_out (просто сумма колонок, потому что все они подписаны).

net — единственное, что читает герой экрана: подписанная сумма всего, кроме переводов (income + expense + refund). Перевод не доход и не расход: он меняет место денег, а не их количество.

Строка с account_id IS NULL — операции без счёта, как и в account_balances.$doc$;

revoke all on function public.account_period_totals(uuid, date, date) from public, anon;
grant execute on function public.account_period_totals(uuid, date, date) to authenticated;


-- ── 3. Deploy-assertions ─────────────────────────────────────────────
-- Миграция обязана быть no-op на проде и создавать всё на чистой среде; блок
-- ниже проверяет, что после применения обе стороны одинаковы. Комментарии
-- функций проверяются наравне с правами: в них записан контракт знаков, и
-- функция без комментария — это функция, потребитель которой снова напишет
-- «− refund».
do $audit$
begin
  if to_regprocedure('public.account_balances(uuid)') is null
     or to_regprocedure('public.account_period_totals(uuid,date,date)') is null then
    raise exception 'account aggregates: функции не созданы с ожидаемой сигнатурой';
  end if;

  if not exists (
    select 1 from pg_proc p
     where p.oid in (
             to_regprocedure('public.account_balances(uuid)')::oid,
             to_regprocedure('public.account_period_totals(uuid,date,date)')::oid
           )
       and p.prosecdef
     having count(*) = 2
  ) then
    raise exception 'account aggregates: функции должны быть SECURITY DEFINER';
  end if;

  if has_function_privilege('anon', 'public.account_balances(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.account_period_totals(uuid,date,date)', 'EXECUTE') then
    raise exception 'account aggregates: агрегаты вызываются анонимом';
  end if;

  if not has_function_privilege('authenticated', 'public.account_balances(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.account_period_totals(uuid,date,date)', 'EXECUTE') then
    raise exception 'account aggregates: приложение не может вызвать агрегаты';
  end if;

  if obj_description(to_regprocedure('public.account_balances(uuid)')::oid, 'pg_proc') is null
     or obj_description(to_regprocedure('public.account_period_totals(uuid,date,date)')::oid, 'pg_proc') is null then
    raise exception 'account aggregates: потерян comment on function с контрактом знаков';
  end if;

  if to_regclass('public.idx_finance_tx_tenant_account_occurred') is null then
    raise exception 'account aggregates: покрывающий индекс не создан';
  end if;
end;
$audit$;
