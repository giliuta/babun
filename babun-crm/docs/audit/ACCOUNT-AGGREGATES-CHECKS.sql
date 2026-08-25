-- =====================================================================
-- ПРОВЕРКИ СЕРВЕРНЫХ АГРЕГАТОВ ПО СЧЕТАМ — прогонять ПОСЛЕ применения
-- миграции apps/web/supabase/migrations/20260810170400_account_aggregates.sql
--
-- ЭТО НЕ МИГРАЦИЯ. Здесь только SELECT'ы: ни одной строки не создаётся, не
-- меняется и не удаляется. Блоки begin … rollback нужны исключительно ради
-- `set local` (подстановка владельца) — они гарантируют, что сессия вернётся
-- в исходное состояние, даже если запрос упадёт.
--
-- ЗАЧЕМ. Агрегаты забирают у телефона расчёт денег. Ошибка знака здесь не
-- «косметика»: она печатает владельцу не ту сумму на главном экране. Поэтому
-- перед тем, как переводить клиент на RPC, каждая из проверок ниже обязана
-- дать ожидаемый ответ.
--
-- КАК ЧИТАТЬ. У каждой проверки написано, что она доказывает и какой ответ
-- считается правильным. Проверки, которые «ищут расхождения», правильны, когда
-- возвращают НОЛЬ СТРОК: любая строка в ответе — это найденное расхождение.
--
-- КАК ЗАПУСКАТЬ. По одному блоку за раз, а не файлом целиком: ПРОВЕРКА 6
-- ОБЯЗАНА упасть с ошибкой (в этом и смысл), а упавший запрос внутри одной
-- общей транзакции унёс бы за собой всё остальное.
--
-- ПОЧЕМУ ЧАСТЬ ПРОВЕРОК ИДЁТ ОТ ИМЕНИ ВЛАДЕЛЬЦА. Обе функции сознательно
-- owner-only и берут компанию из auth.uid(). В SQL-редакторе вы — postgres, у
-- него нет ни auth.uid(), ни компании, поэтому прямой вызов ответит
-- «Балансы счетов доступны только владельцу». Это не поломка, а работающая
-- защита; чтобы позвать функцию, надо подставить JWT владельца (Раздел 0).
-- =====================================================================


-- ---------------------------------------------------------------------
-- РАЗДЕЛ 0. Кого подставлять
--
-- Что доказывает: ничего, это подготовка. Запрос выдаёт владельца каждой
-- компании — его user_id идёт в "sub", а tenant_id в app_metadata подставного
-- JWT. Правильный ответ: строка на каждую компанию, где вообще есть счета.
-- ---------------------------------------------------------------------
select tn.name            as company,
       tm.tenant_id,
       tm.user_id         as owner_sub,
       count(a.id)        as accounts
  from public.tenant_members tm
  join public.tenants  tn on tn.id = tm.tenant_id
  left join public.accounts a on a.tenant_id = tm.tenant_id
 where tm.role = 'owner'
 group by tn.name, tm.tenant_id, tm.user_id
having count(a.id) > 0
 order by company;

-- Шаблон подстановки владельца (подставьте свои sub и tenant_id):
--   begin;
--   set local role authenticated;
--   set local "request.jwt.claims" =
--     '{"sub":"<owner_sub>","role":"authenticated","app_metadata":{"tenant_id":"<tenant_id>"}}';
--   … запрос …
--   rollback;
-- В проде на 2026-08-10 это:
--   Giliuta        sub 7f5d509c-27bf-4c2e-96bd-dc9fcba2b37e  tenant 11365a87-bef9-4f6c-a030-b15083fe646b
--   test@babun.dev sub 975d931c-cb57-45e0-b8c5-d93b4ff43414  tenant 0fc7451a-7648-49d2-b127-7570a2e7f038


-- ---------------------------------------------------------------------
-- ПРОВЕРКА 0. Функции применились и остались закрытыми
--
-- Что доказывает: обе функции существуют с нужной сигнатурой, они
-- SECURITY DEFINER, аноним их позвать не может, приложение — может, и у обеих
-- на месте comment on function (в нём записан контракт знаков; функция без
-- комментария — это функция, потребитель которой снова напишет «− refund»).
-- Правильный ответ: одна строка, во всех колонках true.
-- ---------------------------------------------------------------------
select
  to_regprocedure('public.account_balances(uuid)') is not null                                     as balances_exists,
  to_regprocedure('public.account_period_totals(uuid,date,date)') is not null                      as totals_exists,
  (select bool_and(p.prosecdef) from pg_proc p
    where p.oid in (to_regprocedure('public.account_balances(uuid)')::oid,
                    to_regprocedure('public.account_period_totals(uuid,date,date)')::oid))          as both_security_definer,
  not has_function_privilege('anon', 'public.account_balances(uuid)', 'EXECUTE')                    as anon_blocked_balances,
  not has_function_privilege('anon', 'public.account_period_totals(uuid,date,date)', 'EXECUTE')     as anon_blocked_totals,
  has_function_privilege('authenticated', 'public.account_balances(uuid)', 'EXECUTE')               as app_can_balances,
  has_function_privilege('authenticated', 'public.account_period_totals(uuid,date,date)', 'EXECUTE') as app_can_totals,
  obj_description(to_regprocedure('public.account_balances(uuid)')::oid, 'pg_proc') is not null      as balances_documented,
  obj_description(to_regprocedure('public.account_period_totals(uuid,date,date)')::oid, 'pg_proc') is not null as totals_documented,
  to_regclass('public.idx_finance_tx_tenant_account_occurred') is not null                          as index_exists;


-- ---------------------------------------------------------------------
-- ПРОВЕРКА 1. Живая функция построчно сходится со старым расчётом телефона
--
-- Что доказывает: account_balances даёт по каждому счёту ровно ту дельту,
-- которую сегодня считает listAccountBalanceDeltas на устройстве
-- (packages/shared/src/db/repositories/finance-transactions.ts:158) — то есть
-- перевод экрана на RPC не меняет ни одной цифры. Правая часть сравнения
-- читает таблицы напрямую под RLS владельца, то есть видит ровно те строки,
-- которые видит приложение.
--
-- Строка «деньги без счёта» (account_id IS NULL) из сравнения исключена
-- намеренно: у телефона для неё нет пары — он такие операции просто
-- пропускает. Ровно об этой дыре — ПРОВЕРКА 4.
--
-- Правильный ответ: НОЛЬ СТРОК. Любая строка — расхождение.
-- Повторить для КАЖДОЙ компании из Раздела 0, меняя sub и tenant_id.
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"7f5d509c-27bf-4c2e-96bd-dc9fcba2b37e","role":"authenticated","app_metadata":{"tenant_id":"11365a87-bef9-4f6c-a030-b15083fe646b"}}';

with server_side as (
  select b.account_id, b.delta, b.has_history
    from public.account_balances('11365a87-bef9-4f6c-a030-b15083fe646b'::uuid) b
   where b.account_id is not null
),
client_side as (
  -- Дословный перенос клиентской математики: знак строки, сумма по счёту,
  -- счета без операций дают 0.
  select a.id as account_id,
         round(coalesce(sum(
           case
             when t.type = 'expense' then -t.amount
             when t.type = 'refund' then -abs(t.amount)
             else t.amount
           end
         ), 0), 2) as delta,
         count(t.id) > 0 as has_history
    from public.accounts a
    left join public.finance_transactions t on t.account_id = a.id
   group by a.id
)
select coalesce(s.account_id, c.account_id) as account_id,
       s.delta        as server_delta,
       c.delta        as client_delta,
       s.has_history  as server_has_history,
       c.has_history  as client_has_history,
       case
         when s.account_id is null then 'счёта нет в ответе функции'
         when c.account_id is null then 'функция вернула лишний счёт'
         when s.delta is distinct from c.delta then 'разошлась дельта'
         else 'разошёлся признак истории'
       end as problem
  from server_side s
  -- Обе стороны здесь без NULL-ключей, поэтому обычное равенство: FULL JOIN в
  -- Postgres не умеет соединяться по `is not distinct from`.
  full join client_side c on c.account_id = s.account_id
 where s.account_id is null
    or c.account_id is null
    or s.delta is distinct from c.delta
    or s.has_history is distinct from c.has_history;

rollback;


-- ---------------------------------------------------------------------
-- ПРОВЕРКА 1С. Та же сверка, но СРАЗУ ПО ВСЕМ КОМПАНИЯМ
--
-- Что доказывает: живую функцию тут позвать нельзя — у postgres нет auth.uid(),
-- а подставить всех владельцев одним запросом невозможно. Поэтому слева стоит
-- ТЕЛО функции, обобщённое на все компании: тот же FULL JOIN, тот же coalesce,
-- тот же единственный GROUP BY. Справа — клиентская математика. Проверяется
-- ФОРМА запроса на всех данных сразу: не задвоил ли FULL JOIN строку, не
-- потерял ли счёт без операций, не приписал ли чужую дельту. Живой вызов
-- функции проверяет ПРОВЕРКА 1 — эти две дополняют друг друга.
--
-- Правильный ответ: НОЛЬ СТРОК.
-- ---------------------------------------------------------------------
with ledger as (
  select t.tenant_id as ledger_tenant_id,
         t.account_id as ledger_account_id,
         sum(
           case
             when t.type = 'expense' then -t.amount
             when t.type = 'refund' then -abs(t.amount)
             else t.amount
           end
         ) as ledger_delta,
         count(*) as tx_count
    from public.finance_transactions t
   group by t.tenant_id, t.account_id
),
server_side as (
  select coalesce(a.tenant_id, ledger.ledger_tenant_id) as tenant_id,
         coalesce(a.id, ledger.ledger_account_id) as account_id,
         round(coalesce(ledger.ledger_delta, 0), 2) as delta,
         coalesce(ledger.tx_count, 0) > 0 as has_history
    from public.accounts a
    full join ledger
      on ledger.ledger_account_id = a.id
     and ledger.ledger_tenant_id = a.tenant_id
   -- Строки «деньги без счёта» отброшены: у них нет пары на стороне телефона,
   -- ими занимается ПРОВЕРКА 4. Всё остальное сравнивается один к одному.
   where a.id is not null or ledger.ledger_account_id is not null
),
client_side as (
  -- Телефон фильтрует ленту по tenant_id компании и раскладывает её по
  -- account_id; строки без счёта он не видит вовсе, поэтому у «ничьих» денег
  -- пары справа нет — это ожидаемо и вынесено в ПРОВЕРКУ 4.
  select a.tenant_id,
         a.id as account_id,
         round(coalesce((
           select sum(
                    case
                      when t.type = 'expense' then -t.amount
                      when t.type = 'refund' then -abs(t.amount)
                      else t.amount
                    end
                  )
             from public.finance_transactions t
            where t.account_id = a.id
              and t.tenant_id = a.tenant_id
         ), 0), 2) as delta
    from public.accounts a
)
select coalesce(s.tenant_id, c.tenant_id) as tenant_id,
       coalesce(s.account_id, c.account_id) as account_id,
       s.delta as server_delta,
       c.delta as client_delta,
       case
         when s.account_id is null then 'счёт потерян витриной'
         when c.account_id is null then 'витрина вернула лишнюю строку'
         else 'разошлась дельта'
       end as problem
  from server_side s
  full join client_side c
    on c.account_id = s.account_id
   and c.tenant_id = s.tenant_id
 where s.account_id is null
    or c.account_id is null
    or s.delta is distinct from c.delta;

-- Спутник той же проверки: витрина обязана вернуть РОВНО одну строку на счёт
-- плюс по одной строке «деньги без счёта» на компанию, где такие операции есть.
-- Правильный ответ: одна строка, verdict = 'ОК'.
with ledger as (
  select t.tenant_id as ledger_tenant_id, t.account_id as ledger_account_id
    from public.finance_transactions t
   group by t.tenant_id, t.account_id
)
select (select count(*) from public.accounts) as accounts,
       (select count(*) from ledger where ledger_account_id is null) as no_account_buckets,
       (select count(*)
          from public.accounts a
          full join ledger
            on ledger.ledger_account_id = a.id
           and ledger.ledger_tenant_id = a.tenant_id) as view_rows,
       case
         when (select count(*) from public.accounts)
            + (select count(*) from ledger where ledger_account_id is null)
            = (select count(*)
                 from public.accounts a
                 full join ledger
                   on ledger.ledger_account_id = a.id
                  and ledger.ledger_tenant_id = a.tenant_id)
         then 'ОК' else 'ПРОВАЛ'
       end as verdict;

-- Спутник той же проверки: строки леджера, чей account_id не резолвится в счёт
-- СВОЕЙ компании. Такие деньги не увидит ни один из двух расчётов.
-- Правильный ответ: НОЛЬ СТРОК.
select t.id, t.tenant_id, t.account_id, t.type, t.amount, t.occurred_on
  from public.finance_transactions t
 where t.account_id is not null
   and not exists (
     select 1 from public.accounts a
      where a.id = t.account_id and a.tenant_id = t.tenant_id
   );


-- ---------------------------------------------------------------------
-- ПРОВЕРКА 2. Тест знака: €180 и €190, а не €280 и €310
--
-- Что доказывает: net считается канонической формулой (возврат вычитается ОДИН
-- раз), а не запрещённой «доход − расход − возврат», которая прибавляет
-- отрицательный возврат к приходу. Эталон снят с живых данных: Giliuta,
-- июнь 2026, счета «Карта» двух бригад.
--
-- Правильный ответ: ДВЕ строки, в обеих verdict = 'ОК'. Колонка
-- forbidden_net существует не для красоты: если она вдруг совпадёт с
-- net_ok, тест перестал различать формулы, и доверять ему больше нельзя
-- (например, из тенанта пропали возвраты — тогда нужен новый эталон).
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"7f5d509c-27bf-4c2e-96bd-dc9fcba2b37e","role":"authenticated","app_metadata":{"tenant_id":"11365a87-bef9-4f6c-a030-b15083fe646b"}}';

with expected (account_id, label, net_ok, net_forbidden) as (
  values
    ('a1111111-1111-4111-8111-111111111111'::uuid, 'Карта · бригада team-mp8379ea-i8ith', 180.00::numeric, 280.00::numeric),
    ('a2222222-2222-4222-8222-222222222222'::uuid, 'Карта · бригада team-mp8qhxe3-55axz', 190.00::numeric, 310.00::numeric)
),
fact as (
  select p.account_id, p.opening_before, p.income, p.expense, p.refund,
         p.transfer_in, p.transfer_out, p.net
    from public.account_period_totals(
           '11365a87-bef9-4f6c-a030-b15083fe646b'::uuid,
           date '2026-06-01', date '2026-06-30'
         ) p
),
forbidden as (
  -- Запрещённая формула целиком: возврат лежит в базе отрицательным, и
  -- вычитание превращает его в прибавку.
  select t.account_id,
         coalesce(sum(t.amount) filter (where t.type = 'income'), 0)
       - coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)
       - coalesce(sum(t.amount) filter (where t.type = 'refund'), 0) as net
    from public.finance_transactions t
   where t.occurred_on between date '2026-06-01' and date '2026-06-30'
   group by t.account_id
)
select e.label,
       f.net           as net_fact,
       e.net_ok,
       fb.net          as forbidden_fact,
       e.net_forbidden,
       -- Вторая половина проверки: колонки складываются в net сами, без
       -- единого знака со стороны клиента.
       (f.income + f.expense + f.refund) as sum_of_columns,
       case
         when f.net = e.net_ok
          and fb.net = e.net_forbidden
          and f.income + f.expense + f.refund = f.net then 'ОК'
         else 'ПРОВАЛ'
       end as verdict
  from expected e
  left join fact f       on f.account_id  = e.account_id
  left join forbidden fb on fb.account_id = e.account_id;

rollback;


-- ---------------------------------------------------------------------
-- ПРОВЕРКА 3. Периоды склеиваются: opening_before не выдуман
--
-- Что доказывает: остаток на начало текущего месяца в точности равен остатку
-- на начало прошлого плюс сумма всех колонок прошлого месяца. Это и есть
-- смысл opening_before — при выборе «Прошлый месяц» колонка обязана печатать
-- реальный остаток на 1-е число, а не результат вычитания из сегодняшнего
-- баланса. Заодно проверяется, что все шесть колонок подписаны: сумма
-- складывается БЕЗ единого минуса, поставленного вручную.
--
-- Правильный ответ: НОЛЬ СТРОК.
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"7f5d509c-27bf-4c2e-96bd-dc9fcba2b37e","role":"authenticated","app_metadata":{"tenant_id":"11365a87-bef9-4f6c-a030-b15083fe646b"}}';

with prev_month as (
  select p.*
    from public.account_period_totals(
           '11365a87-bef9-4f6c-a030-b15083fe646b'::uuid,
           (date_trunc('month', current_date) - interval '1 month')::date,
           (date_trunc('month', current_date) - interval '1 day')::date
         ) p
),
this_month as (
  select p.*
    from public.account_period_totals(
           '11365a87-bef9-4f6c-a030-b15083fe646b'::uuid,
           date_trunc('month', current_date)::date,
           current_date
         ) p
),
keys as (
  -- UNION (не ALL) склеивает и NULL-ключ строки «деньги без счёта»; дальше
  -- только LEFT JOIN — FULL JOIN по `is not distinct from` Postgres не умеет.
  select account_id from prev_month
  union
  select account_id from this_month
)
select k.account_id,
       p.opening_before                     as prev_opening,
       (p.opening_before + p.income + p.expense + p.refund
        + p.transfer_in + p.transfer_out)   as prev_closing,
       t.opening_before                     as this_opening
  from keys k
  left join prev_month p on p.account_id is not distinct from k.account_id
  left join this_month t on t.account_id is not distinct from k.account_id
 -- coalesce с обеих сторон: строка «деньги без счёта» может появиться впервые
 -- в текущем месяце — тогда пары в прошлом нет, и это не расхождение, а
 -- нормальная жизнь. Без coalesce такая строка дала бы ложную тревогу.
 where coalesce(t.opening_before, 0) is distinct from
       coalesce(p.opening_before + p.income + p.expense + p.refund
                + p.transfer_in + p.transfer_out, 0);

rollback;


-- ---------------------------------------------------------------------
-- ПРОВЕРКА 4. Итог агрегата против того, что экран показывает сегодня
--
-- Что доказывает: сумма по account_balances совпадает с сегодняшним итогом
-- экрана РОВНО НА ВЕЛИЧИНУ денег без счёта — и ни на цент больше. Разница,
-- равная строке «Операции без счёта», это не регресс, а та самая дыра, ради
-- которой в агрегате заведена строка с account_id IS NULL: сегодня экран
-- занижает «Всего денег» на эту сумму молча.
--
-- Правильный ответ: одна строка, verdict = 'ОК'. На проде 2026-08-10 ожидается:
--   Giliuta        screen_today 945.00, no_account 0.00,   server_total 945.00
--   test@babun.dev screen_today 500.00, no_account 120.00, server_total 620.00
-- Разница, НЕ равная no_account_total, означает ошибку в агрегате.
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"975d931c-cb57-45e0-b8c5-d93b4ff43414","role":"authenticated","app_metadata":{"tenant_id":"0fc7451a-7648-49d2-b127-7570a2e7f038"}}';

with balances as (
  select b.account_id, b.delta
    from public.account_balances('0fc7451a-7648-49d2-b127-7570a2e7f038'::uuid) b
),
server_total as (
  -- Как считает новый экран: остаток счёта = opening_balance + delta,
  -- плюс отдельной строкой деньги без счёта. coalesce обязателен: у компании
  -- без «ничьих» операций filter даёт NULL, и без него итог сравнения был бы
  -- NULL, то есть проверка молча объявила бы ПРОВАЛ на здоровых данных.
  select round(coalesce(sum(coalesce(a.opening_balance, 0) + b.delta), 0), 2) as total,
         round(coalesce(sum(b.delta) filter (where b.account_id is null), 0), 2) as no_account_total
    from balances b
    left join public.accounts a on a.id = b.account_id
),
screen_today as (
  -- Как считает экран сегодня: счета из listAccounts плюс дельты из
  -- listAccountBalanceDeltas, где строки без счёта просто пропущены.
  select round(coalesce(sum(a.opening_balance + coalesce(d.delta, 0)), 0), 2) as total
    from public.accounts a
    left join lateral (
      select sum(
               case
                 when t.type = 'expense' then -t.amount
                 when t.type = 'refund' then -abs(t.amount)
                 else t.amount
               end
             ) as delta
        from public.finance_transactions t
       where t.account_id = a.id
    ) d on true
)
select s.total          as screen_today,
       st.no_account_total,
       st.total         as server_total,
       st.total - s.total as difference,
       case
         when st.total - s.total = st.no_account_total then 'ОК'
         else 'ПРОВАЛ'
       end as verdict
  from server_total st, screen_today s;

rollback;


-- ---------------------------------------------------------------------
-- ПРОВЕРКА 5. Контракт знаков колонок (дополнительная)
--
-- Что доказывает: колонки приходят подписанными ровно так, как обещает
-- comment on function — приход и приток переводов неотрицательны, расход,
-- возврат и отток переводов неположительны, а net равен сумме трёх неденежных
-- колонок. Если это перестанет быть правдой, вёрстка карточки начнёт
-- удваивать минусы, а «Остаток на конец» перестанет сходиться с героем.
--
-- Правильный ответ: НОЛЬ СТРОК. Период возьмите пошире, чтобы захватить все
-- типы операций.
-- Сравнение точное, до цента: сегодня все суммы в базе с двумя знаками после
-- запятой (проверено `amount <> round(amount, 2)` — ноль строк). Расхождение
-- ровно в один цент означает, что в леджер просочилась сумма с третьим знаком,
-- и это само по себе находка, а не погрешность проверки.
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"7f5d509c-27bf-4c2e-96bd-dc9fcba2b37e","role":"authenticated","app_metadata":{"tenant_id":"11365a87-bef9-4f6c-a030-b15083fe646b"}}';

select p.account_id, p.income, p.expense, p.refund,
       p.transfer_in, p.transfer_out, p.net,
       case
         when p.income < 0       then 'приход отрицателен'
         when p.expense > 0      then 'расход положителен — знак потерян'
         when p.refund > 0       then 'возврат положителен — знак потерян'
         when p.transfer_in < 0  then 'приток перевода отрицателен'
         when p.transfer_out > 0 then 'отток перевода положителен'
         else 'net не равен income + expense + refund'
       end as problem
  from public.account_period_totals(
         '11365a87-bef9-4f6c-a030-b15083fe646b'::uuid,
         date '2000-01-01', current_date
       ) p
 where p.income < 0
    or p.expense > 0
    or p.refund > 0
    or p.transfer_in < 0
    or p.transfer_out > 0
    or p.net is distinct from (p.income + p.expense + p.refund);

rollback;


-- ---------------------------------------------------------------------
-- ПРОВЕРКА 6. Дверь закрыта (дополнительная)
--
-- Что доказывает: агрегаты не отдают деньги никому, кроме владельца этой
-- компании. Два вызова обязаны УПАСТЬ с ошибкой — это и есть правильный ответ:
--   а) от имени postgres (без auth.uid())      → «доступны только владельцу»;
--   б) с чужим p_tenant под своим JWT          → «Счета другой компании недоступны».
-- Если хотя бы один вернул строки — защита не работает, экран нельзя выпускать.
-- ---------------------------------------------------------------------
-- (а) без подстановки владельца — ожидается ошибка «Балансы счетов доступны только владельцу»
select * from public.account_balances(null);

-- (б) под владельцем Giliuta, но с компанией test@babun.dev —
--     ожидается ошибка «Счета другой компании недоступны»
begin;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"7f5d509c-27bf-4c2e-96bd-dc9fcba2b37e","role":"authenticated","app_metadata":{"tenant_id":"11365a87-bef9-4f6c-a030-b15083fe646b"}}';

select * from public.account_balances('0fc7451a-7648-49d2-b127-7570a2e7f038'::uuid);

-- Вызов выше обязан упасть, а упавшая транзакция остаётся открытой и
-- «сломанной» — закройте её, иначе следующий запрос в этой же сессии ответит
-- «current transaction is aborted».
rollback;
