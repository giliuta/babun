-- СВЕРКА НАЛИЧНЫХ — слайс С6 (ТЗ docs/plans/ACCOUNTS-PAGE-REDESIGN-2026-08-10.md,
-- §5.5 и §11.8–11.10).
--
-- ЗАЧЕМ.
--   Пересчитать можно физическую кучу денег — то есть КАССУ, а не компанию и не
--   день. Поэтому единица учёта здесь ровно одна: строка в account_cash_counts
--   = «эту кассу пересчитали тогда-то, по учёту было столько, в руках оказалось
--   столько». Из этой строки живут все ответы продукта: «Сверяли 8 авг», «Не
--   сверяли 12 дней», «Сходится» (когда операции не возникает вовсе и другого
--   следа не осталось бы) и разница, списанная в леджер.
--
-- РЕШЕНИЕ ВЛАДЕЛЬЦА 2026-08-10 (дословно): «если делается сверка по дню, значит
--   передаются все значения в финансы; если делается в финансах, значит
--   передаются все значения в сверку по дню». Отсюда закон этого файла:
--   СВЕРКА КАССЫ И «ЗАКРЫТИЕ ДНЯ» — ОДНА МЕХАНИКА С ДВУМЯ ДВЕРЯМИ.
--   Записывает только эта таблица; «Закрытие дня» её ЧИТАЕТ и складывает, а не
--   заводит вторую фактическую сумму, набранную пальцем. Второе число, живущее
--   своей жизнью, — это второй ответ на вопрос «сколько было в кассе», и через
--   неделю они разъедутся.
--   Следствие для day_closures (отдельной миграцией того же слайса, см. отчёт):
--   close_business_day перестаёт принимать p_actual_cash_cents от клиента и
--   считает факт дня как сумму последних сверок за этот бизнес-день. Здесь эта
--   функция намеренно не трогается: сначала должно появиться то, что она будет
--   читать.
--
-- ЧТО СЧИТАЕТСЯ ОЖИДАЕМЫМ ОСТАТКОМ. Ровно та же формула, что в
--   guard_account_financial_history, record_account_transfer и account_balances:
--       opening_balance + Σ (expense: -amount, refund: -abs(amount), иначе amount)
--   Возврат лежит в базе ОТРИЦАТЕЛЬНЫМ, -abs() вычитает его один раз, а не
--   дважды (живой контрпример: Giliuta, июнь 2026, «Карта» team-mp8379ea —
--   верные €180 против ошибочных €280). Витрина, считающая иначе, покажет
--   недостачу там, где касса сошлась, и виноватым будет выглядеть бригадир.
--
-- ПОЧЕМУ ПОД БЛОКИРОВКОЙ. Между «прочитали ожидаемый остаток» и «записали
--   разницу» может пройти оплата: тогда базой сравнения окажется одно число, а
--   в ленте останется другое, и разница будет списана мимо. Берём тот же
--   тенантный advisory-lock, который берёт guard_closed_day_finance_write на
--   КАЖДОЙ записи в леджер, — снимок остатка становится атомарным со всеми
--   вставками, правками и удалениями операций.


-- ─── 1. Системные категории «Излишек» и «Недостача» ──────────────────
--
-- Категории заводятся глобальными (tenant_id is null), как все остальные
-- стандартные: RLS на finance_categories разрешает запись только строкам своего
-- тенанта, поэтому глобальную строку ни один тенант не может ни переименовать,
-- ни удалить — «неудаляемость» из §11.10 получается структурно, без ещё одного
-- триггера. is_system нужен не для защиты, а для ВИТРИН: по нему клиент
-- исключает излишки и недостачи из «Расхода» и из прибыли (это не расход
-- компании, а исправление учёта) и помечает их отдельной колонкой в выгрузке
-- бухгалтеру.
alter table public.finance_categories
  add column if not exists is_system boolean not null default false;

comment on column public.finance_categories.is_system is
  'Категория заведена продуктом, а не человеком (излишек/недостача кассы). Исключается из «Расхода» и прибыли и помечается в выгрузке.';

-- `unique (tenant_id, slug)` НЕ защищает глобальные строки: в обычном
-- уникальном ключе NULL-ы считаются различными, поэтому повторный прогон
-- сидирующей миграции спокойно заводит второй «Излишек». Частичный индекс
-- закрывает ровно наши две строки и не может упереться в чужие дубли.
create unique index if not exists ux_finance_categories_system_slug
  on public.finance_categories (slug)
  where tenant_id is null and is_system;

-- Вставка через `where not exists` по той же причине: `on conflict (tenant_id,
-- slug)` на глобальной строке не срабатывает никогда.
insert into public.finance_categories (tenant_id, slug, name, type, color, is_system)
select null::uuid, seed.slug, seed.name, seed.type, seed.color, true
  from (values
    ('cash_surplus',  'Излишек',   'income',  '#34C759'),
    ('cash_shortage', 'Недостача', 'expense', '#FF3B30')
  ) as seed(slug, name, type, color)
 where not exists (
   select 1 from public.finance_categories existing
    where existing.tenant_id is null
      and existing.slug = seed.slug
 );

-- Повторный прогон на среде, где строки уже есть, но флага ещё нет.
update public.finance_categories
   set is_system = true
 where tenant_id is null
   and slug in ('cash_surplus', 'cash_shortage')
   and not is_system;


-- ─── 2. Таблица сверок ───────────────────────────────────────────────
create table if not exists public.account_cash_counts (
  -- id — это p_request_id клиента: строка сверки САМА является записью
  -- идемпотентности, отдельной таблицы запросов заводить незачем (у перевода
  -- она нужна как надгробие отменённого перевода, у сверки отменять нечего).
  id             uuid primary key,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  -- on delete cascade, а не restrict: удалить счёт можно только когда у него
  -- нет ни одной операции (trg_guard_account_delete), а сверка с ненулевой
  -- разницей ВСЕГДА оставляет операцию. Значит каскад способен унести только
  -- отметку «пересчитали, сошлось» у пустой кассы — это заметка, а не деньги.
  account_id     uuid not null references public.accounts(id) on delete cascade,
  -- Бизнес-день, а не голый counted_at: «Закрытие дня» группирует сверки по
  -- дню компании, и если каждая поверхность будет сама переводить timestamptz в
  -- дату по своему часовому поясу, около полуночи получатся два разных ответа
  -- на вопрос «сверена ли касса сегодня». День назначает сервер, один раз.
  business_date  date not null,
  counted_at     timestamptz not null default now(),
  counted_by     uuid references auth.users(id) on delete set null,
  -- Остаток по учёту на момент пересчёта, снятый под блокировкой.
  expected       numeric(14,2) not null,
  -- Сколько денег человек насчитал руками.
  counted        numeric(14,2) not null,
  delta          numeric(14,2) not null,
  note           text,
  -- Операция «Излишек»/«Недостача». NULL ровно тогда, когда касса сошлась.
  transaction_id uuid references public.finance_transactions(id) on delete restrict,
  created_at     timestamptz not null default now(),
  constraint account_cash_counts_delta_exact
    check (delta = counted - expected),
  -- Физических отрицательных денег не бывает; ожидаемый остаток отрицательным
  -- быть может (счёт в долге), поэтому ограничение только на факт.
  constraint account_cash_counts_counted_nonnegative check (counted >= 0),
  constraint account_cash_counts_amounts_finite check (
    expected <> 'NaN'::numeric and counted <> 'NaN'::numeric
  ),
  -- Главный инвариант таблицы: разница списана тогда и только тогда, когда она
  -- есть. Строка, утверждающая «недостача €35» без операции, — это недостача,
  -- которую никто не увидит в деньгах.
  constraint account_cash_counts_correction_matches_delta
    check ((delta = 0) = (transaction_id is null))
);

-- «Когда эту кассу сверяли в последний раз» — подписи §3.5 и §6.2.
create index if not exists idx_account_cash_counts_account_counted
  on public.account_cash_counts (account_id, counted_at desc);

-- Вторая дверь: «что уже пересчитано за этот день компании».
create index if not exists idx_account_cash_counts_tenant_day
  on public.account_cash_counts (tenant_id, business_date desc);

-- Одна операция коррекции принадлежит ровно одной сверке.
create unique index if not exists ux_account_cash_counts_transaction
  on public.account_cash_counts (transaction_id)
  where transaction_id is not null;

alter table public.account_cash_counts enable row level security;

-- Права как у соседних RPC-таблиц денег (finance_transfer_requests,
-- day_closures): читать — владелец своей компании, писать — только через
-- record_cash_count. Прямой INSERT из приложения обошёл бы и блокировку, и
-- проверку ожидаемого остатка, то есть позволил бы объявить любую разницу.
drop policy if exists account_cash_counts_owner_select on public.account_cash_counts;
create policy account_cash_counts_owner_select
  on public.account_cash_counts for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

revoke all on table public.account_cash_counts from public, anon, authenticated;
grant select on table public.account_cash_counts to authenticated;

comment on table public.account_cash_counts is
  'Пересчёты наличных касс: по учёту / насчитали / разница. Единственный источник правды о сверке — «Закрытие дня» её читает и складывает, своей фактической суммы не хранит. Пишется только через record_cash_count.';


-- ─── 3. Операцию коррекции нельзя выдернуть из-под сверки ────────────
--
-- FK стоит restrict, но сырое «violates foreign key constraint» человеку в
-- поле ничего не объясняет. Тот же приём, что у guard_finance_category_history_delete:
-- отдельный маленький триггер, который говорит по-русски и срабатывает раньше FK.
create or replace function public.guard_cash_count_transaction_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Удаление компании каскадом обязано проходить насквозь.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  if exists (
    select 1 from public.account_cash_counts c where c.transaction_id = old.id
  ) then
    raise exception
      'Эту операцию создал пересчёт кассы: без неё сверка соврёт про разницу. Пересчитайте кассу заново.';
  end if;

  return old;
end;
$function$;

revoke all on function public.guard_cash_count_transaction_delete()
  from public, anon, authenticated;

drop trigger if exists trg_guard_cash_count_transaction_delete
  on public.finance_transactions;
create trigger trg_guard_cash_count_transaction_delete
  before delete on public.finance_transactions
  for each row execute function public.guard_cash_count_transaction_delete();


-- ─── 4. record_cash_count ────────────────────────────────────────────
create or replace function public.record_cash_count(
  p_account_id uuid,
  p_counted    numeric,
  p_note       text,
  p_request_id uuid
)
returns setof public.account_cash_counts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tenant_uuid        uuid := public.current_tenant_id();
  count_row          public.account_cash_counts%rowtype;
  account_row        public.accounts%rowtype;
  normalized_counted numeric(14,2);
  normalized_note    text := nullif(btrim(p_note), '');
  expected_balance   numeric(14,2);
  delta_amount       numeric(14,2);
  business_day       date;
  category_uuid      uuid;
  correction_id      uuid;
begin
  -- Роль проверяется явно: функция SECURITY DEFINER, то есть она сама себе
  -- граница. Допуск бригадира (§14.12) — это ОДНА строка условия здесь, а не
  -- пересборка экрана: поверхность уже рисует только доступные кассы.
  if auth.uid() is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Пересчитать кассу может только владелец';
  end if;
  if tenant_uuid is null then
    raise exception 'Компания не определена';
  end if;
  if p_request_id is null then
    raise exception 'Не удалось определить запрос пересчёта';
  end if;
  if p_account_id is null then
    raise exception 'Выберите кассу';
  end if;
  if p_counted is null or p_counted = 'NaN'::numeric or p_counted < 0 then
    raise exception 'Введите сумму, которая сейчас есть в кассе';
  end if;
  if p_counted > 999999999999.99 then
    raise exception 'Сумма слишком велика';
  end if;
  normalized_counted := round(p_counted, 2);
  if normalized_counted <> p_counted then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;

  -- Дедуп ДО всякой работы: повтор того же запроса (потеря сети, второй тап)
  -- обязан вернуть уже записанную сверку, а не завести вторую и не списать
  -- разницу дважды. Урок §11.11: проверки, стоящие перед поиском строки
  -- запроса, ломают именно ту идемпотентность, ради которой всё затевалось, —
  -- поэтому выше остались только проверки самих аргументов, одинаковые у
  -- первого вызова и у повтора.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into count_row
    from public.account_cash_counts
   where id = p_request_id
   for update;
  if found then
    if count_row.tenant_id <> tenant_uuid then
      raise exception 'Этот пересчёт уже использован';
    end if;
    if count_row.account_id <> p_account_id
       or count_row.counted <> normalized_counted
       or count_row.note is distinct from normalized_note then
      raise exception 'Этот пересчёт уже записан с другими данными';
    end if;
    return query
      select * from public.account_cash_counts where id = p_request_id;
    return;
  end if;

  select * into account_row
    from public.accounts
   where id = p_account_id
   for update;
  if not found or account_row.tenant_id <> tenant_uuid then
    raise exception 'Касса не найдена в этой компании';
  end if;
  if not account_row.is_active then
    raise exception 'Счёт закрыт. Чтобы пересчитать кассу, сначала откройте его снова';
  end if;
  if account_row.kind <> 'cash' then
    raise exception 'Пересчитать можно только наличные: на карте и в банке остаток считает банк';
  end if;

  -- Тот же тенантный замок, который берёт guard_closed_day_finance_write на
  -- каждой записи в леджер и close_business_day на закрытии дня. С этого места
  -- и до конца транзакции ни одна операция компании не может проскочить между
  -- нашим чтением остатка и нашей же записью разницы.
  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':day-closure-ledger', 0)
  );

  business_day := public.tenant_business_date(tenant_uuid);

  -- Каноническая формула баланса счёта. Без фильтра по дате намеренно: операций
  -- будущим числом не существует (их запрещает тот же guard), а «остаток на
  -- вчера» — это не то, что человек держит в руках.
  select round(
    account_row.opening_balance + coalesce(sum(
      case
        when tx.type = 'expense' then -tx.amount
        when tx.type = 'refund' then -abs(tx.amount)
        else tx.amount
      end
    ), 0),
    2
  )
    into expected_balance
    from public.finance_transactions tx
   where tx.tenant_id = tenant_uuid
     and tx.account_id = account_row.id;

  delta_amount := round(normalized_counted - expected_balance, 2);

  if delta_amount <> 0 then
    -- id категории клиенту не отдаётся и от клиента не принимается (§11.10):
    -- иначе недостачу можно было бы записать в «Зарплату» и она растворилась
    -- бы в расходах компании. Тенантное переопределение слага имеет приоритет
    -- над глобальным — тем же правилом, что и остальные справочники.
    select category.id into category_uuid
      from public.finance_categories category
     where category.slug = case
             when delta_amount > 0 then 'cash_surplus'
             else 'cash_shortage'
           end
       and category.is_system
       and (category.tenant_id is null or category.tenant_id = tenant_uuid)
     order by (category.tenant_id is not null) desc
     limit 1;
    if category_uuid is null then
      raise exception 'Системная категория пересчёта не найдена';
    end if;

    -- team_id не передаём: триггер целостности сам поставит бригаду командному
    -- счёту, а счёту компании оставит NULL (операция компании без команды).
    -- Один источник правды про маршрут команды — и здесь он не мы.
    -- vat_mode = 'none' обязателен: излишек и недостача — не выручка, налога с
    -- них не бывает, а по умолчанию триггер НДС взял бы ставку компании.
    insert into public.finance_transactions (
      tenant_id, type, amount, account_id, category_id,
      payment_method, notes, occurred_on, source, vat_mode, created_by
    ) values (
      tenant_uuid,
      case when delta_amount > 0 then 'income' else 'expense' end,
      abs(delta_amount),
      account_row.id,
      category_uuid,
      'cash',
      concat_ws(
        ' · ',
        'Пересчёт кассы ' || to_char(business_day, 'DD.MM.YYYY'),
        normalized_note
      ),
      business_day,
      'manual',
      'none',
      auth.uid()
    )
    returning id into correction_id;
  end if;

  insert into public.account_cash_counts (
    id, tenant_id, account_id, business_date, counted_at, counted_by,
    expected, counted, delta, note, transaction_id
  ) values (
    p_request_id, tenant_uuid, account_row.id, business_day, now(), auth.uid(),
    expected_balance, normalized_counted, delta_amount, normalized_note,
    correction_id
  );

  return query
    select * from public.account_cash_counts where id = p_request_id;
end;
$function$;

comment on function public.record_cash_count(uuid, numeric, text, uuid) is
$doc$Пересчёт наличной кассы (ТЗ §5.5, §11.9). Только владелец; тенант берётся из auth.uid().

Ожидаемый остаток считает СЕРВЕР под тенантным замком ledger-а — тем же, который берёт guard_closed_day_finance_write на каждой записи в леджер. Клиент своё ожидание не присылает и не может: между показом экрана и нажатием кнопки могла пройти оплата. Печатать в тосте нужно то, что вернула эта функция, а не то, что было на экране.

Формула ожидаемого остатка ровно одна на продукт: opening_balance + Σ (expense: -amount, refund: -abs(amount), income и нога перевода: +amount).

Разница ≠ 0 → создаётся операция payment_method='cash', vat_mode='none', категория выбирается сервером по слагу (cash_surplus / cash_shortage), сумма всегда положительная, вид операции несёт знак (income / expense). Разница = 0 → операции нет вовсе, но строка сверки есть: только из неё видно, что кассу пересчитали и она сошлась.

Идемпотентность по p_request_id: повтор с теми же данными возвращает уже записанную сверку, повтор с другими — падает. Строка сверки сама является записью запроса.

Закрытый день: операция датируется сегодняшним бизнес-днём и упирается в guard_closed_day_finance_write. Это не дефект, а порядок ритуала — сначала пересчитать кассы, потом закрыть день.$doc$;

revoke all on function public.record_cash_count(uuid, numeric, text, uuid)
  from public, anon;
grant execute on function public.record_cash_count(uuid, numeric, text, uuid)
  to authenticated;


-- ─── 5. Deploy-assertions ────────────────────────────────────────────
-- Миграция обязана либо создать всю поверхность целиком, либо упасть. Половина
-- этой поверхности (таблица без прав, функция без категорий) — это экран, где
-- «Пересчитать» есть, а записать разницу нечем.
do $audit$
declare
  system_categories integer;
begin
  if to_regclass('public.account_cash_counts') is null then
    raise exception 'сверка кассы: таблица account_cash_counts не создана';
  end if;

  if not exists (
    select 1 from pg_class
     where oid = 'public.account_cash_counts'::regclass
       and relrowsecurity
  ) then
    raise exception 'сверка кассы: на account_cash_counts не включён RLS';
  end if;

  if has_table_privilege('authenticated', 'public.account_cash_counts', 'INSERT')
     or has_table_privilege('authenticated', 'public.account_cash_counts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.account_cash_counts', 'DELETE') then
    raise exception 'сверка кассы: приложение может писать в account_cash_counts мимо RPC';
  end if;
  if not has_table_privilege('authenticated', 'public.account_cash_counts', 'SELECT') then
    raise exception 'сверка кассы: приложение не может прочитать свои сверки';
  end if;

  if to_regclass('public.ux_account_cash_counts_transaction') is null then
    raise exception 'сверка кассы: нет уникальности операции коррекции';
  end if;

  if to_regprocedure('public.record_cash_count(uuid,numeric,text,uuid)') is null then
    raise exception 'сверка кассы: record_cash_count не создан с ожидаемой сигнатурой';
  end if;
  if not exists (
    select 1 from pg_proc
     where oid = to_regprocedure('public.record_cash_count(uuid,numeric,text,uuid)')::oid
       and prosecdef
  ) then
    raise exception 'сверка кассы: record_cash_count должен быть SECURITY DEFINER';
  end if;
  if has_function_privilege(
       'anon', 'public.record_cash_count(uuid,numeric,text,uuid)', 'EXECUTE'
     ) then
    raise exception 'сверка кассы: record_cash_count вызывается анонимом';
  end if;
  if not has_function_privilege(
       'authenticated', 'public.record_cash_count(uuid,numeric,text,uuid)', 'EXECUTE'
     ) then
    raise exception 'сверка кассы: приложение не может вызвать record_cash_count';
  end if;
  -- В комментарии записан контракт «сервер считает ожидаемое сам»; функция без
  -- него — это функция, потребитель которой снова пришлёт своё ожидание.
  if obj_description(
       to_regprocedure('public.record_cash_count(uuid,numeric,text,uuid)')::oid,
       'pg_proc'
     ) is null then
    raise exception 'сверка кассы: потерян comment on function с контрактом';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.finance_transactions'::regclass
       and tgname = 'trg_guard_cash_count_transaction_delete'
       and not tgisinternal
  ) then
    raise exception 'сверка кассы: операцию коррекции можно удалить из-под сверки';
  end if;

  select count(*) into system_categories
    from public.finance_categories
   where tenant_id is null
     and is_system
     and (
       (slug = 'cash_surplus' and type = 'income')
       or (slug = 'cash_shortage' and type = 'expense')
     );
  if system_categories <> 2 then
    raise exception
      'сверка кассы: системных категорий % вместо двух (Излишек/доход и Недостача/расход)',
      system_categories;
  end if;
end;
$audit$;
