-- «ЗАКРЫТИЕ ДНЯ» УДАЛЕНО С СЕРВЕРА ЦЕЛИКОМ. ЗАПРЕТ ОПЕРАЦИЙ БУДУЩИМ ЧИСЛОМ
-- ОСТАЁТСЯ — В СВОЁМ СТОРОЖЕ.
--
-- Владелец: «удали это вообще, чтоб я этого больше не слышал». Экраны закрытия
-- дня и незакрытых дней из приложения сняты. Но пока на сервере живут таблица,
-- функции, сторожа и право `close_day`, функция не удалена, а спрятана: сторож
-- закрытого дня по-прежнему берёт замок на каждой денежной записи компании,
-- владелец по-прежнему получает право, которое ничего не открывает, а экран прав
-- по-прежнему показывает блок «Закрытие дня». Эта миграция убирает всё это.
--
-- ЧТО УХОДИТ
--
--   • `day_closures` — снимки закрытых дней. Снимок производный: сверки касс
--     (`account_cash_counts`) и их коррекции в журнале остаются, итог дня из них
--     пересчитывается. Потерять в таблице нечего.
--   • `close_business_day(date)` с обёрткой `close_business_day(date, bigint)`,
--     `reopen_business_day(date)`, `read_day_closure(date)` — входы экрана.
--     Старая сборка, которая их позовёт, получит «функции нет»: закрыть день
--     больше нельзя ни из какой сборки — это и значит «удалить вообще».
--   • `tenant_cash_ledger_cents(uuid, date)` — ожидаемая касса на дату. Её звал
--     только `read_day_closure`.
--   • Сторожа `guard_closed_day_finance_write` и `guard_closed_day_account_write`
--     вместе с триггерами на `finance_transactions` и `accounts`. Закрытых дней
--     нет — охранять нечего, а их замок `:day-closure-ledger` ставил в одну
--     очередь каждую запись в журнал и каждую правку кассового счёта компании.
--   • Блок прав `finance.close_day` в реестре и его уровни: уровень «Меняет» у
--     сотрудника обещал бы то, чего нет. Уровни, отложенные в ОТКРЫТЫХ
--     приглашениях, снимаются тем же шагом: иначе правка такого приглашения
--     упала бы на «неизвестный блок», а приём молча пропустил бы его.
--   • Право `close_day` в `calendar_members.grants` и в словаре
--     `calendar_members_grants_known`. Его не читала ни одна политика и ни одна
--     функция, а право без проверки на сервере — ложное обещание (AGENTS.md,
--     «у каждого блока есть права»). Словарь остаётся закрытым: вернуть право
--     можно только новой миграцией, а не опечаткой.
--   • `list_my_calendars()` больше не выдаёт владельцу `close_day`.
--
-- ЧТО ОСТАЁТСЯ
--
--   • ЗАПРЕТ ОПЕРАЦИЙ БУДУЩИМ ЧИСЛОМ. Он жил внутри сторожа закрытого дня, и
--     прямую запись в `finance_transactions` (её разрешают политики) больше не
--     держит ничто другое. На нём стоит пересчёт кассы: `record_cash_count`
--     считает остаток без фильтра по дате ровно потому, что операций будущим
--     числом не бывает. Поэтому правило переезжает в свой сторож
--     `guard_future_dated_finance_write`: та же дата компании
--     (`tenant_business_date`), тот же текст отказа и тот же код P0001 (`raise`
--     без `errcode`) — для приложения отказ не меняется. Без проверки закрытого
--     дня и без замка: сравнение даты строки с датой компании ни с кем не
--     гоняется. Проверка стоит на вставке и на правке всей строки, как стояла.
--   • Имя `finance_transactions_future_date_guard` занимает по алфавиту место
--     прежнего триггера — первое среди BEFORE-триггеров таблицы: будущая дата
--     отказывается раньше, чем строку начнут разбирать НДС, целостность и
--     платёж инвойса, и текст отказа остаётся прежним.
--   • Пропуск во время каскадного удаления компании перенесён из прежнего
--     сторожа как есть.
--   • `record_cash_count` по-прежнему берёт замок `:day-closure-ledger`; после
--     этой миграции его делят только пересчёты касс между собой. Функция в это
--     удаление не входит и не трогается.
--
-- Тела `list_my_calendars` и проверки будущей даты взяты из живой базы
-- (`pg_get_functiondef`), а не из файлов: тексты функций закрытия дня
-- переписывали две применённые миграции, у которых нет файла в репозитории
-- (`day_closure_texts_utf8_fix`, `day_closure_error_texts_utf8_fix`).
--
-- ПОРЯДОК. Сначала данные, на которые ссылаются (уровни → права календарей →
-- словарь → «мои календари» → реестр), затем новый сторож и только после него
-- снос старых сторожей, функций и таблицы. Сносится всё явно, без `if exists` и
-- без CASCADE: объект, которого нет, или неожиданная зависимость должны уронить
-- миграцию на своём операторе, а не исчезнуть молча. Замыкает сторож миграции.

-- ─── 1. Уровни блока «Закрытие дня» ─────────────────────────────────────

-- Внешний ключ `member_access_block_fkey` удаление блока не каскадирует: уровни
-- уходят первыми. Триггер `member_access_bump` поднимет версию доступа и пошлёт
-- `access_changed` — открытое приложение сотрудника перечитает свою карту.
delete from public.member_access ma
 where ma.block = 'finance.close_day';

-- Уровень, выставленный в открытом приглашении до «Пригласить», — тот же ответ
-- на тот же вопрос, только ещё не применённый. Принятые приглашения — история:
-- их приём уже прошёл и больше не повторится.
update public.invitations i
   set access_changes = coalesce((
         select jsonb_agg(c.change order by c.ord)
           from jsonb_array_elements(i.access_changes) with ordinality as c(change, ord)
          where c.change ->> 'block' is distinct from 'finance.close_day'
       ), '[]'::jsonb)
 where i.accepted_at is null
   and jsonb_typeof(i.access_changes) = 'array'
   and i.access_changes @> '[{"block": "finance.close_day"}]'::jsonb;

-- ─── 2. Право календаря `close_day` ─────────────────────────────────────

-- Остальные права строки не трогаются.
update public.calendar_members cm
   set grants = array_remove(cm.grants, 'close_day')
 where 'close_day' = any(cm.grants);

-- ─── 3. Словарь прав календаря без `close_day` ──────────────────────────

-- Словарь закрыт намеренно (20260912150000_calendar_members.sql): опечатка в
-- праве не применяется вовсе. Удалённое право закрывается тем же способом.
alter table public.calendar_members
  drop constraint calendar_members_grants_known;

alter table public.calendar_members
  add constraint calendar_members_grants_known check (
    grants <@ array[
      'view',      -- видеть календарь и его записи
      'book',      -- создавать записи
      'edit_all',  -- править чужие записи (без него — только свои)
      'clients',   -- видеть клиентов этого календаря
      'phones',    -- видеть контакты клиента
      'finance',   -- видеть деньги календаря
      'settings'   -- менять настройки календаря
    ]::text[]
  );

-- ─── 4. «Мои календари» не выдают владельцу `close_day` ─────────────────

-- Тело перенесено из живой базы; изменён только список прав владельца.
create or replace function public.list_my_calendars()
returns table(
  tenant_id uuid,
  tenant_name text,
  team_id text,
  team_name text,
  team_color text,
  role text,
  grants text[],
  is_active boolean,
  onboarded boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as materialized (
    select auth.uid() as user_id, public.current_tenant_id() as tenant_id
  )
  select t.tenant_id,
         tn.name,
         t.id,
         t.name,
         t.color,
         tm.role,
         case
           -- Владелец получает все права календаря; «Закрытие дня» удалено.
           when tm.role = 'owner' then array[
             'view','book','edit_all','clients','phones','finance','settings'
           ]::text[]
           when cm.user_id is not null then coalesce(cm.grants, array[]::text[])
           when tm.role = 'dispatcher' then array[
             'view','book','edit_all','clients','phones'
           ]::text[]
           else array['view']::text[]
         end,
         t.tenant_id = me.tenant_id,
         tn.onboarded_at is not null
    from public.tenant_members tm
    cross join me
    join public.tenants tn on tn.id = tm.tenant_id
    join public.teams t on t.tenant_id = tm.tenant_id
    left join public.calendar_members cm
      on cm.tenant_id = t.tenant_id
     and cm.team_id = t.id
     and cm.user_id = tm.user_id
   where tm.user_id = me.user_id
     and t.is_active
     and (
       tm.role = 'owner'
       or cm.user_id is not null
       or (
         not exists (
           select 1 from public.calendar_members c2
            where c2.tenant_id = tm.tenant_id
              and c2.user_id = tm.user_id
         )
         and (
           tm.role = 'dispatcher'
           or (
             tm.master_id is not null
             and (
               exists (
                 select 1 from public.masters m
                  where m.tenant_id = tm.tenant_id
                    and m.id = tm.master_id
                    and m.team_id = t.id
               )
               or coalesce(t.lead_ids, '[]'::jsonb) ? tm.master_id
               or coalesce(t.helper_ids, '[]'::jsonb) ? tm.master_id
               or exists (
                 select 1
                   from jsonb_array_elements(
                     case when jsonb_typeof(t.members) = 'array'
                          then t.members else '[]'::jsonb end
                   ) member
                  where case jsonb_typeof(member)
                          when 'string' then member #>> '{}'
                          when 'object' then coalesce(member ->> 'master_id', member ->> 'id')
                          else null
                        end = tm.master_id
               )
             )
           )
         )
       )
     )
   order by tn.name, t.position, t.name
$function$;

revoke all on function public.list_my_calendars() from public, anon;
grant execute on function public.list_my_calendars() to authenticated;

-- ─── 5. Блок «Закрытие дня» уходит из реестра ───────────────────────────

-- Реестр пишут только миграции. Уровней блока к этому месту уже нет (шаг 1):
-- внешний ключ `member_access` без каскада иначе не отпустил бы строку.
delete from public.access_blocks b
 where b.key = 'finance.close_day';

-- ─── 6. Запрет будущей даты — свой сторож ───────────────────────────────

create or replace function public.guard_future_dated_finance_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tenant_uuid uuid;
  new_date date;
  business_today date;
begin
  tenant_uuid := new.tenant_id;
  new_date := new.occurred_on;

  -- Во время каскадного удаления компании её строка уже не видна дочернему
  -- триггеру. Отказ здесь превратил бы восстановимое удаление компании в
  -- оборванную половину — пропуск перенесён из прежнего сторожа как есть.
  if not exists (select 1 from public.tenants t where t.id = tenant_uuid) then
    return new;
  end if;

  -- Дата компании, текст и код отказа (P0001) — те же, что у прежнего сторожа.
  -- Замка нет: сравнение даты строки с датой компании ни с кем не гоняется.
  business_today := public.tenant_business_date(tenant_uuid);
  if new_date is not null and new_date > business_today then
    raise exception 'Финансовую операцию нельзя датировать будущим числом';
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_future_dated_finance_write() from public, anon, authenticated;

-- Вставка и правка всей строки — ровно там, где прежний сторож проверял дату:
-- удаление новой даты не несёт, а `update of occurred_on` сузил бы правило.
drop trigger if exists finance_transactions_future_date_guard on public.finance_transactions;
create trigger finance_transactions_future_date_guard
  before insert or update on public.finance_transactions
  for each row execute function public.guard_future_dated_finance_write();

-- ─── 7. Триггеры закрытого дня ──────────────────────────────────────────

drop trigger finance_transactions_closed_day_guard on public.finance_transactions;
drop trigger accounts_closed_day_guard on public.accounts;

-- ─── 8. Сторожа закрытого дня ───────────────────────────────────────────

drop function public.guard_closed_day_finance_write();
drop function public.guard_closed_day_account_write();

-- ─── 9. Функции закрытия дня ────────────────────────────────────────────

-- Обёртка первой: она зовёт основную форму. Читатель ожидаемой кассы уходит
-- раньше функции, которую он звал.
drop function public.close_business_day(date, bigint);
drop function public.close_business_day(date);
drop function public.reopen_business_day(date);
drop function public.read_day_closure(date);
drop function public.tenant_cash_ledger_cents(uuid, date);

-- ─── 10. Таблица закрытых дней ──────────────────────────────────────────

-- Функции, возвращавшие её строку, уже снесены. Политика, индекс, проверки и
-- права уходят вместе с таблицей; всё остальное, что от неё зависит, должно
-- уронить миграцию здесь.
drop table public.day_closures;

-- ─── Сторож ─────────────────────────────────────────────────────────────

do $guard$
declare
  v_removed text;
  v_future_oid oid := to_regprocedure('public.guard_future_dated_finance_write()');
  v_future text;
  v_calendars text;
  v_check text;
  v_leftover text;
begin
  -- 1. Снесённого нет ни в одной форме.
  if to_regclass('public.day_closures') is not null then
    raise exception 'миграция: таблица закрытых дней осталась';
  end if;

  foreach v_removed in array array[
    'public.close_business_day(date)',
    'public.close_business_day(date, bigint)',
    'public.reopen_business_day(date)',
    'public.read_day_closure(date)',
    'public.tenant_cash_ledger_cents(uuid, date)',
    'public.guard_closed_day_finance_write()',
    'public.guard_closed_day_account_write()'
  ] loop
    if to_regprocedure(v_removed) is not null then
      raise exception 'миграция: осталась функция %', v_removed;
    end if;
  end loop;

  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'close_business_day', 'reopen_business_day', 'read_day_closure',
         'tenant_cash_ledger_cents', 'guard_closed_day_finance_write',
         'guard_closed_day_account_write'
       )
  ) then
    raise exception 'миграция: осталась другая форма функции закрытия дня';
  end if;

  if exists (
    select 1 from pg_trigger t
     where not t.tgisinternal
       and t.tgname in ('finance_transactions_closed_day_guard', 'accounts_closed_day_guard')
  ) then
    raise exception 'миграция: остался триггер закрытого дня';
  end if;

  -- 2. Запрет будущей даты стоит, включён и проверяет то же, что прежний сторож.
  if v_future_oid is null or not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.finance_transactions'::regclass
       and t.tgname = 'finance_transactions_future_date_guard'
       and not t.tgisinternal
       and t.tgenabled in ('O', 'A')
       and t.tgfoid = v_future_oid
       and (t.tgtype & 1) <> 0   -- на каждую строку
       and (t.tgtype & 2) <> 0   -- до записи
       and (t.tgtype & 4) <> 0   -- вставка
       and (t.tgtype & 16) <> 0  -- правка
       and cardinality(t.tgattr::int2[]) = 0
  ) then
    raise exception 'миграция: запрет будущей даты не стоит на вставке и правке операций или выключен';
  end if;

  select p.prosrc
    into v_future
    from pg_proc p
   where p.oid = v_future_oid
     and p.prosecdef
     and 'search_path=public' = any(coalesce(p.proconfig, array[]::text[]));

  if v_future is null
     or strpos(v_future, 'business_today := public.tenant_business_date(tenant_uuid);') = 0
     or strpos(v_future, 'if new_date is not null and new_date > business_today then') = 0
     or strpos(v_future, 'raise exception ''Финансовую операцию нельзя датировать будущим числом'';') = 0
     or strpos(v_future, 'pg_advisory_xact_lock') > 0
     or strpos(v_future, 'day_closures') > 0 then
    raise exception 'миграция: запрет будущей даты проверяет не то, что прежний сторож';
  end if;

  if has_function_privilege('anon', v_future_oid, 'execute')
     or has_function_privilege('authenticated', v_future_oid, 'execute') then
    raise exception 'миграция: сторож будущей даты открыт клиенту';
  end if;

  if to_regprocedure('public.tenant_business_date(uuid)') is null then
    raise exception 'миграция: сторожу будущей даты не на что опереться — нет даты компании';
  end if;

  -- 3. Права, реестр и приглашения больше не знают «Закрытие дня».
  if exists (select 1 from public.calendar_members cm where 'close_day' = any(cm.grants)) then
    raise exception 'миграция: у календаря осталось право close_day';
  end if;

  if exists (select 1 from public.access_blocks b where strpos(b.key, 'close_day') > 0)
     or exists (select 1 from public.member_access ma where strpos(ma.block, 'close_day') > 0) then
    raise exception 'миграция: «Закрытие дня» осталось в реестре блоков или в уровнях';
  end if;

  if exists (
    select 1 from public.invitations i
     where i.accepted_at is null
       and strpos(i.access_changes::text, 'close_day') > 0
  ) then
    raise exception 'миграция: открытое приглашение несёт уровень «Закрытия дня»';
  end if;

  -- 4. «Мои календари» и словарь прав.
  select p.prosrc
    into v_calendars
    from pg_proc p
   where p.oid = to_regprocedure('public.list_my_calendars()');

  if v_calendars is null
     or strpos(v_calendars, 'close_day') > 0
     or strpos(v_calendars, '''view'',''book'',''edit_all'',''clients'',''phones'',''finance'',''settings''') = 0 then
    raise exception 'миграция: «мои календари» выдают владельцу close_day или потеряли его права';
  end if;

  if has_function_privilege('anon', 'public.list_my_calendars()', 'execute')
     or not has_function_privilege('authenticated', 'public.list_my_calendars()', 'execute') then
    raise exception 'миграция: права на «мои календари» шире или уже прежних';
  end if;

  select pg_get_constraintdef(c.oid)
    into v_check
    from pg_constraint c
   where c.conrelid = 'public.calendar_members'::regclass
     and c.conname = 'calendar_members_grants_known'
     and c.contype = 'c'
     and c.convalidated;

  if v_check is null
     or strpos(v_check, 'close_day') > 0
     or strpos(v_check, 'settings') = 0 then
    raise exception 'миграция: словарь прав календаря пропал или всё ещё разрешает close_day';
  end if;

  if exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.calendar_members'::regclass
       and strpos(pg_get_constraintdef(c.oid), 'close_day') > 0
  ) then
    raise exception 'миграция: другая проверка calendar_members разрешает close_day';
  end if;

  -- 5. Ни одна функция не ссылается на снесённое: иначе она упадёт при первом вызове.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into v_leftover
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (
       strpos(p.prosrc, 'day_closures') > 0
       or strpos(p.prosrc, 'close_business_day') > 0
       or strpos(p.prosrc, 'reopen_business_day') > 0
       or strpos(p.prosrc, 'read_day_closure') > 0
       or strpos(p.prosrc, 'tenant_cash_ledger_cents') > 0
       or strpos(p.prosrc, 'guard_closed_day_') > 0
       or strpos(p.prosrc, 'close_day') > 0
     );

  if v_leftover is not null then
    raise exception 'миграция: на закрытие дня всё ещё ссылаются функции: %', v_leftover;
  end if;
end
$guard$;
