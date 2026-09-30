-- НАКАТ 16.09 (сессия 010) — ДВУМЯ ЧАСТЯМИ. Файл целиком не проходил одним вызовом
-- `apply_migration`, поэтому его операторы без комментариев накатаны двумя
-- миграциями; внутри каждой порядок файла сохранён:
--   `20260915225901 finance_access_levels_live_functions` — все функции, их права и
--   комментарии, отзыв `import_schedule`. Сотрудникам ничего не открывает: блоки
--   ещё не живые;
--   `20260915230517 finance_access_levels_live_policies` — снимок политик, политики,
--   живые блоки, сигнал `access_changed` и сторож.
-- Тела 12 функций в базе совпадают с этим файлом по md5. Видимое 19 владельцам в
-- деньгах (11 таблиц через RLS и обе функции остатков) сверено по отпечатку до,
-- между и после частей — без расхождений.
--
-- ПРАВА ПО БЛОКАМ, ЭТАП 2, СРЕЗ 1: ДЕНЬГИ СЛУШАЮТСЯ УРОВНЕЙ.
-- Живыми становятся три блока: «Доходы и расходы» (finance.operations),
-- «Счета и остатки» (finance.accounts), «Долги» (finance.debts).
-- «Категории, шаблоны, НДС» (finance.settings) остаётся НЕживым: его запись
-- откроет следующий срез вместе с НДС компании для сотрудника.
--
-- Владелец 15.09: «да, давай, чтоб всё сразу менялось в живом времени…
-- максимальное качество». Уровни «Скрыт / Смотрит / Меняет» до сих пор только
-- хранились. Деньги сотруднику открывала старая галочка `finance` в
-- `calendar_members` — её нет ни у одного живого человека; счета, остатки и
-- переводы закрывала роль «владелец»; долги были открыты диспетчеру по РОЛИ на
-- всю компанию, без календарей. Экран уже спрашивает уровень — теперь его
-- спрашивает и сервер.
--
-- ОДНО ПРАВИЛО НА ВЕСЬ СЕРВЕР
--   • `access_calendars(блок, минимум)` — календари активной компании, где
--     уровень человека не ниже минимума. Тело одно — `access_calendars_of`,
--     его зовут и политики (через обёртку), и счета.
--   • `access_accounts_for(блок, минимум)` — счета, которыми человек
--     пользуется по календарному блоку: счёт команды — по её календарю; общий
--     счёт компании — только на чтение и только по календарю, подключённому к
--     нему. Писать в общий счёт (перевод, отмена перевода, операция по нему)
--     сотруднику нельзя: общий счёт — деньги нескольких календарей.
--   • `access_accounts_totals()` — счета, чьи остатки и сводку человек видит:
--     счета команд «Счетов и остатков» и общий счёт, только если ВСЕ
--     подключённые к нему календари ему видны — иначе в итог попали бы деньги
--     чужих календарей.
--   • `access_company(блок, минимум)` — то же для блока компании; в этом срезе
--     её не зовёт ни одна политика (finance.settings не живой), она готова для
--     следующего.
--   • Владелец — всё: он права выдаёт, а не получает. Сотрудник — только ЖИВОЙ
--     блок. Нет входа, нет членства — ничего.
--   • Незнакомый ключ, чужая область и минимум, кроме `read` и `write`, — пусто
--     ДЛЯ ВСЕХ, владельца тоже.
--   • Порядок положений — место в массиве (`array_position`), а не сравнение
--     строк. Неизвестное положение не проходит нигде: зависимость от
--     «Календаря и записей» пропускает только `read` и `write`.
--   • В политиках правило стоит только подзапросом — `in (select unnest(…))`
--     или `(select …)`: голый вызов считается на каждую строку (4778 мс против
--     87 на боевой).
--
-- КАЛЕНДАРЬ ЖИВЁТ ВНУТРИ «КАЛЕНДАРЯ И ЗАПИСЕЙ»
--   Календарь, где «Календарь и записи» скрыт, денег не отдаёт. Сам блок ещё не
--   живой, поэтому зависимость читает ХРАНИМОЕ положение одной функцией
--   `access_records_level`; её зовут и сервер, и карта телефона
--   (`access_map_for`, где переписаны ровно две строки).
--
-- АРХИВ — НЕ ПРАВО: архивный календарь в правилах не отсекается, как и в
-- `access_map_for` (15.09).
--
-- ЧТО ПРОВЕРЯЕТ СЕРВЕР (было → стало; политики владельца не тронуты)
--   finance_transactions: галочка `finance` → «Доходы и расходы» по календарю
--     операции. Читает — Смотрит. Записывает — Меняет, и только доход или
--     расход: без инвойса, без возврата, без чужого автора, со счётом, которым
--     он пользуется по «Меняет», с долгом, который он «Меняет». Доход заявки
--     пишет только оплата заявки. Меняет и удаляет — только РАСХОД на тех же
--     условиях: правка дохода переписывает выданный чек
--     (`sync_receipt_with_income`), удаление возврата оживляет аннулированный
--     (`void_receipt_on_refund`), а чеки — блок следующего среза.
--     Платежи долга видит и тот, кто «Смотрит» этот долг: без них остаток долга
--     врёт.
--   day_extras: чтение — Смотрит; пишет только `replace_day_extras` (владелец
--     или «Меняет» в этом календаре). Прямой записи в таблицу у сотрудника нет:
--     она обходила бы проверки функции. `import_schedule` (старый импорт из
--     браузера, приложение его не зовёт) у клиентов отозван.
--   accounts: чтение — счета, которыми он пользуется по «Доходам и расходам»
--     (имена для выбора счёта) или по «Счетам и остаткам», плюс счёт команды
--     по календарю «Счетов» (иначе новый счёт не вернулся бы из INSERT …
--     RETURNING). Создать и поменять — счёт команды, «Счета» Меняет; удаление —
--     только владелец.
--   account_teams: чтение привязок своих календарей по любому из двух блоков.
--   finance_transfer_requests: перевод виден, только если видны ОБА счёта.
--   account_balances, account_period_totals: отказ всем, кроме владельца →
--     сотрудник получает ровно `access_accounts_totals()`.
--   record_account_transfer, delete_account_transfer: только владелец →
--     владелец или «Счета» Меняет на ОБОИХ счетах (общий счёт — никогда).
--   debts: владелец или диспетчер по роли → владелец; сотрудник — «Долги» по
--     календарю долга; долг без календаря — только владелец.
--   finance_categories, finance_category_hidden, finance_category_order: чтение
--     тем, у кого «Доходы и расходы» или «Долги» Смотрит хоть в одном
--     календаре (форма операции и форма долга без них пусты). finance_templates
--     и team_finance_settings: чтение по календарю «Доходов и расходов».
--     Запись всех справочников — только владелец.
--
-- ОСТАЁТСЯ СЛЕДУЮЩИМ СРЕЗАМ: оплата в записи (`record.payment`: её функции
-- пишут доходы и возвраты по своей проверке, реестр их здесь НЕ называет),
-- инвойсы и чеки, пересчёт кассы, счета для оплаты в записи,
-- справочники и НДС для сотрудника (`finance.settings`).
--
-- ЖИВОЕ ВРЕМЯ. Реестр помечает три блока живыми и называет места проверки
-- (`policy:схема.таблица.политика`, `function:схема.функция(аргументы)`).
-- Карта каждого сотрудника от этого меняется, поэтому версия его прав растёт и
-- уходит сигнал `access_changed`.

-- ─── Снимок политик до правки ───────────────────────────────────────────
-- Сторож в конце сверяет с ним: всё, чего миграция не касается (политики
-- владельца в том числе), обязано остаться байт в байт, и новых политик,
-- кроме объявленных здесь, быть не должно.

create temp table _finance_levels_policies_before as
select pp.tablename::text as tbl,
       pp.policyname::text as pol,
       pp.cmd::text as cmd,
       pp.permissive::text as permissive,
       pp.roles::text as roles,
       pp.qual,
       pp.with_check
  from pg_policies pp
 where pp.schemaname = 'public'
   and pp.tablename in (
     'finance_transactions', 'day_extras', 'accounts', 'account_teams',
     'finance_transfer_requests', 'debts', 'finance_categories',
     'finance_category_hidden', 'finance_category_order', 'finance_templates',
     'team_finance_settings'
   );

-- ─── Положение «Календаря и записей» для зависимости ────────────────────
--
-- Хранимое положение, без оглядки на живость блока: календарные блоки зависят
-- от «Календаря и записей» уже сейчас, до того как он оживёт сам. Нет строки —
-- умолчание реестра; блока нет в реестре — «off», то есть закрыто. Функцию зовут
-- только другие безопасные функции: уровень произвольного человека клиенту не
-- отдаётся.

create or replace function public.access_records_level(p_tenant uuid, p_user uuid, p_team text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select coalesce(ma.level, b.levels[1])
      from public.access_blocks b
      left join public.member_access ma
        on ma.tenant_id = p_tenant
       and ma.user_id = p_user
       and ma.block = b.key
       and ma.team_id = p_team
     where b.key = 'calendar.records'
  ), 'off')
$function$;

comment on function public.access_records_level(uuid, uuid, text) is
  'Хранимое положение calendar.records человека в календаре (без проверки live). '
  'Одна зависимость для access_calendars_of и access_map_for: сервер и карта телефона решают одинаково.';

-- ─── Правило календарного блока: одно тело ──────────────────────────────
--
-- Компания и человек приходят аргументами, поэтому функцию зовут только другие
-- безопасные функции, которые уже прочитали вход и активную компанию: так
-- `access_accounts_for` не читает их второй раз. Клиенту она закрыта — иначе
-- любой узнал бы уровни любого человека.

create or replace function public.access_calendars_of(p_tenant uuid, p_user uuid, p_block text, p_min text)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  min_rank integer := array_position(array['off', 'read', 'write'], p_min);
  member_role text;
  block_row public.access_blocks%rowtype;
  granted text[];
begin
  if p_tenant is null or p_user is null or min_rank is null or min_rank < 2 then
    return array[]::text[];
  end if;

  select * into block_row
    from public.access_blocks b
   where b.key = p_block
     and b.scope = 'calendar';
  if not found then
    return array[]::text[];
  end if;

  select tm.role into member_role
    from public.tenant_members tm
   where tm.tenant_id = p_tenant
     and tm.user_id = p_user;
  if member_role is null then
    return array[]::text[];
  end if;

  if member_role = 'owner' then
    select coalesce(array_agg(t.id order by t.id), array[]::text[])
      into granted
      from public.teams t
     where t.tenant_id = p_tenant;
    return granted;
  end if;

  if not block_row.live or block_row.owner_only then
    return array[]::text[];
  end if;

  select coalesce(array_agg(mc.team_id order by mc.team_id), array[]::text[])
    into granted
    from public.member_calendars mc
    left join public.member_access ma
      on ma.tenant_id = mc.tenant_id
     and ma.user_id = mc.user_id
     and ma.block = block_row.key
     and ma.team_id = mc.team_id
   where mc.tenant_id = p_tenant
     and mc.user_id = p_user
     and array_position(array['off', 'read', 'write'], coalesce(ma.level, block_row.levels[1])) >= min_rank
     and (
       block_row.key = 'calendar.records'
       or array_position(array['read', 'write'], public.access_records_level(p_tenant, p_user, mc.team_id)) is not null
     );

  return granted;
end;
$function$;

comment on function public.access_calendars_of(uuid, uuid, text, text) is
  'Тело правила календарного блока для компании и человека из аргументов. Только для безопасных функций, '
  'уже прочитавших вход и активную компанию; клиенту закрыта.';

create or replace function public.access_calendars(p_block text, p_min text)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    return array[]::text[];
  end if;
  return public.access_calendars_of(public.current_tenant_id(), caller, p_block, p_min);
end;
$function$;

comment on function public.access_calendars(text, text) is
  'Календари активной компании, где уровень календарного блока не ниже p_min (read|write). '
  'Владелец — все календари; сотрудник — живой блок, прикреплённый календарь, calendar.records read или write. '
  'В политиках — только подзапросом: in (select unnest(public.access_calendars(...))).';

-- ─── Правило блока компании ─────────────────────────────────────────────

create or replace function public.access_company(p_block text, p_min text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  min_rank integer := array_position(array['off', 'read', 'write'], p_min);
  active_tenant uuid;
  caller_role text;
  block_row public.access_blocks%rowtype;
  stored_level text;
begin
  if caller is null or min_rank is null or min_rank < 2 then
    return false;
  end if;

  select * into block_row
    from public.access_blocks b
   where b.key = p_block
     and b.scope = 'company';
  if not found then
    return false;
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return false;
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return false;
  end if;

  if caller_role = 'owner' then
    return true;
  end if;

  if not block_row.live or block_row.owner_only then
    return false;
  end if;

  select ma.level into stored_level
    from public.member_access ma
   where ma.tenant_id = active_tenant
     and ma.user_id = caller
     and ma.block = block_row.key
     and ma.team_id is null;

  return coalesce(
    array_position(array['off', 'read', 'write'], coalesce(stored_level, block_row.levels[1])) >= min_rank,
    false
  );
end;
$function$;

comment on function public.access_company(text, text) is
  'Уровень блока компании не ниже p_min (read|write). Владелец — да; сотрудник — только живой блок. '
  'В политиках — только подзапросом: (select public.access_company(...)).';

-- ─── Счета по календарному блоку ────────────────────────────────────────
--
-- Счёт команды — по календарю команды. Общий счёт компании — только на чтение
-- и только по календарю, подключённому к нему (`account_teams`): он несёт
-- деньги нескольких календарей, поэтому писать в него, переводить с него и
-- отменять его переводы сотруднику нельзя ни в каком блоке.

create or replace function public.access_accounts_for(p_block text, p_min text)
returns uuid[]
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  min_rank integer := array_position(array['off', 'read', 'write'], p_min);
  active_tenant uuid;
  caller_role text;
  granted_calendars text[];
  visible uuid[];
begin
  if caller is null or min_rank is null or min_rank < 2 then
    return array[]::uuid[];
  end if;

  if not exists (
    select 1
      from public.access_blocks b
     where b.key = p_block
       and b.scope = 'calendar'
  ) then
    return array[]::uuid[];
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return array[]::uuid[];
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return array[]::uuid[];
  end if;

  if caller_role = 'owner' then
    select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
      into visible
      from public.accounts a
     where a.tenant_id = active_tenant;
    return visible;
  end if;

  granted_calendars := public.access_calendars_of(active_tenant, caller, p_block, p_min);
  if cardinality(granted_calendars) = 0 then
    return array[]::uuid[];
  end if;

  select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
    into visible
    from public.accounts a
   where a.tenant_id = active_tenant
     and (
       (a.scope = 'team' and a.brigade_id = any(granted_calendars))
       or (
         min_rank = 2
         and a.scope = 'company'
         and exists (
           select 1
             from public.account_teams att
            where att.account_id = a.id
              and att.tenant_id = active_tenant
              and att.team_id = any(granted_calendars)
         )
       )
     );

  return visible;
end;
$function$;

comment on function public.access_accounts_for(text, text) is
  'Счета активной компании по календарному блоку не ниже p_min (read|write): счёт команды — по её календарю, '
  'общий счёт — только read и только по подключённому календарю. Владелец — все счета. В политиках — только подзапросом.';

-- ─── Счета, чьи остатки видны ───────────────────────────────────────────
--
-- Остаток общего счёта — сумма денег всех подключённых календарей. Сотруднику
-- он виден, только если ему видны ВСЕ эти календари по «Счетам и остаткам»;
-- счёт без единой привязки — только владельцу. Зовут только функции остатков.

create or replace function public.access_accounts_totals()
returns uuid[]
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid;
  caller_role text;
  granted_calendars text[];
  visible uuid[];
begin
  if caller is null then
    return array[]::uuid[];
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return array[]::uuid[];
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return array[]::uuid[];
  end if;

  if caller_role = 'owner' then
    select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
      into visible
      from public.accounts a
     where a.tenant_id = active_tenant;
    return visible;
  end if;

  granted_calendars := public.access_calendars_of(active_tenant, caller, 'finance.accounts', 'read');
  if cardinality(granted_calendars) = 0 then
    return array[]::uuid[];
  end if;

  select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
    into visible
    from public.accounts a
   where a.tenant_id = active_tenant
     and (
       (a.scope = 'team' and a.brigade_id = any(granted_calendars))
       or (
         a.scope = 'company'
         and exists (
           select 1
             from public.account_teams att
            where att.account_id = a.id
              and att.tenant_id = active_tenant
         )
         and not exists (
           select 1
             from public.account_teams att
            where att.account_id = a.id
              and not (att.team_id = any(granted_calendars))
         )
       )
     );

  return visible;
end;
$function$;

comment on function public.access_accounts_totals() is
  'Счета активной компании, чьи остатки видны: владельцу — все; сотруднику — счета команд по finance.accounts read '
  'и общий счёт, только если ВСЕ его календари видны. Только для функций остатков; клиенту закрыта.';

revoke all on function public.access_records_level(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.access_calendars_of(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.access_accounts_totals() from public, anon, authenticated;
revoke all on function public.access_calendars(text, text) from public, anon;
revoke all on function public.access_company(text, text) from public, anon;
revoke all on function public.access_accounts_for(text, text) from public, anon;
grant execute on function public.access_calendars(text, text) to authenticated;
grant execute on function public.access_company(text, text) to authenticated;
grant execute on function public.access_accounts_for(text, text) to authenticated;

-- ─── Карта телефона считает зависимость так же ──────────────────────────
--
-- Тело перенесено из живой базы как есть; изменены ровно две строки.
--   • `records_level`: было — положение «Календаря и записей» из той же выборки
--     живых блоков, и пока сам блок не живой, у всех выходило «off»: карта
--     сотрудника (`p_include_off = false`) теряла бы все календари, как только
--     оживёт первый денежный блок. Стало — хранимое положение через
--     `access_records_level`, как у серверного правила.
--   • отбор календаря: было `<> 'off'`, стало «только read или write» — то же
--     условие, что у сервера; неизвестное положение календарь не открывает.
-- Режим владельца (`p_include_off = true`) это условие не читает и не меняется.

create or replace function public.access_map_for(p_tenant_id uuid, p_user_id uuid, p_include_off boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  member_role text;
  member_version bigint;
  company_levels jsonb;
  calendar_levels jsonb;
  attached jsonb;
begin
  select tm.role, tm.access_version
    into member_role, member_version
    from public.tenant_members tm
   where tm.tenant_id = p_tenant_id and tm.user_id = p_user_id;

  if member_role is null then
    return null;
  end if;

  if member_role = 'owner' then
    return jsonb_build_object(
      'tenant_id', p_tenant_id, 'is_owner', true, 'version', member_version,
      'company', '{}'::jsonb, 'calendars', '{}'::jsonb
    );
  end if;

  select coalesce(jsonb_object_agg(b.key, coalesce(ma.level, b.levels[1])), '{}'::jsonb)
    into company_levels
    from public.access_blocks b
    left join public.member_access ma
      on ma.tenant_id = p_tenant_id
     and ma.user_id = p_user_id
     and ma.block = b.key
     and ma.team_id is null
   where (b.live or p_include_off) and b.scope = 'company' and not b.owner_only;

  select coalesce(jsonb_object_agg(per_team.team_id, per_team.blocks), '{}'::jsonb)
    into calendar_levels
    from (
      select mc.team_id,
             jsonb_object_agg(b.key, coalesce(ma.level, b.levels[1])) as blocks,
             public.access_records_level(p_tenant_id, p_user_id, mc.team_id) as records_level
        from public.member_calendars mc
        cross join public.access_blocks b
        left join public.member_access ma
          on ma.tenant_id = mc.tenant_id
         and ma.user_id = mc.user_id
         and ma.block = b.key
         and ma.team_id = mc.team_id
       where mc.tenant_id = p_tenant_id
         and mc.user_id = p_user_id
         and (b.live or p_include_off)
         and b.scope = 'calendar'
       group by mc.team_id
    ) per_team
   where p_include_off or array_position(array['read', 'write'], per_team.records_level) is not null;

  if p_include_off then
    select coalesce(jsonb_agg(mc.team_id order by mc.team_id), '[]'::jsonb)
      into attached
      from public.member_calendars mc
     where mc.tenant_id = p_tenant_id and mc.user_id = p_user_id;
    return jsonb_build_object(
      'tenant_id', p_tenant_id, 'is_owner', false, 'version', member_version,
      'attached_calendars', attached,
      'company', company_levels, 'calendars', calendar_levels
    );
  end if;

  return jsonb_build_object(
    'tenant_id', p_tenant_id, 'is_owner', false, 'version', member_version,
    'company', company_levels, 'calendars', calendar_levels
  );
end;
$function$;

revoke all on function public.access_map_for(uuid, uuid, boolean) from public, anon, authenticated;

-- ─── Доходы и расходы: операции ─────────────────────────────────────────
-- `finance_transactions_owner_all` не трогается: владелец видит и пишет всё.

drop policy if exists finance_transactions_select_calendar on public.finance_transactions;
create policy finance_transactions_select_calendar on public.finance_transactions
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.operations', 'read')))
  );

-- Платёж долга — часть самого долга: без него остаток долга на экране врёт,
-- если «Долги» видны, а «Доходы и расходы» этого календаря — нет.
drop policy if exists finance_transactions_select_debt on public.finance_transactions;
create policy finance_transactions_select_debt on public.finance_transactions
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and debt_id in (
      select d.id
        from public.debts d
       where d.tenant_id = (select public.current_tenant_id())
         and d.team_id in (select unnest(public.access_calendars('finance.debts', 'read')))
    )
  );

-- Сотрудник записывает только доход или расход, и только такой, какой мог бы
-- записать сам: без инвойса и возврата (их защиты и чеки работают с правами
-- вызвавшего и не видят скрытого от него), доход — не от имени заявки (это
-- оплата в записи, свой срез), автор — он сам, счёт — которым он пользуется по
-- «Меняет», долг — который он «Меняет».
drop policy if exists finance_transactions_insert_calendar on public.finance_transactions;
create policy finance_transactions_insert_calendar on public.finance_transactions
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.operations', 'write')))
    and type in ('income', 'expense')
    and invoice_id is null
    and refund_of_id is null
    and (type = 'expense' or appointment_id is null)
    and created_by = (select auth.uid())
    and (
      account_id is null
      or account_id in (select unnest(public.access_accounts_for('finance.operations', 'write')))
    )
    and (
      debt_id is null
      or debt_id in (
        select d.id
          from public.debts d
         where d.tenant_id = (select public.current_tenant_id())
           and d.team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
      )
    )
  );

-- Меняет и удаляет сотрудник только расход — ровно тот, что мог бы записать сам.
-- Доход не трогает: его правка переписывает выданный чек, а удаление возврата
-- оживляет аннулированный.
drop policy if exists finance_transactions_update_calendar on public.finance_transactions;
create policy finance_transactions_update_calendar on public.finance_transactions
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.operations', 'write')))
    and type = 'expense'
    and invoice_id is null
    and refund_of_id is null
    and (
      account_id is null
      or account_id in (select unnest(public.access_accounts_for('finance.operations', 'write')))
    )
    and (
      debt_id is null
      or debt_id in (
        select d.id
          from public.debts d
         where d.tenant_id = (select public.current_tenant_id())
           and d.team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.operations', 'write')))
    and type = 'expense'
    and invoice_id is null
    and refund_of_id is null
    and (
      account_id is null
      or account_id in (select unnest(public.access_accounts_for('finance.operations', 'write')))
    )
    and (
      debt_id is null
      or debt_id in (
        select d.id
          from public.debts d
         where d.tenant_id = (select public.current_tenant_id())
           and d.team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
      )
    )
  );

drop policy if exists finance_transactions_delete_calendar on public.finance_transactions;
create policy finance_transactions_delete_calendar on public.finance_transactions
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.operations', 'write')))
    and type = 'expense'
    and invoice_id is null
    and refund_of_id is null
    and (
      account_id is null
      or account_id in (select unnest(public.access_accounts_for('finance.operations', 'write')))
    )
    and (
      debt_id is null
      or debt_id in (
        select d.id
          from public.debts d
         where d.tenant_id = (select public.current_tenant_id())
           and d.team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
      )
    )
  );

-- ─── Доходы и расходы: ручные строки дня ────────────────────────────────
-- Лист дня читает их у каждого, кто «Смотрит» этот календарь. Пишет их только
-- `replace_day_extras`: прямая запись обходила бы её проверки.

drop policy if exists day_extras_select_calendar on public.day_extras;
create policy day_extras_select_calendar on public.day_extras
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.operations', 'read')))
  );

-- ─── Счета и остатки ────────────────────────────────────────────────────
-- Ветка владельца в чтении прежняя. Имена счетов нужны и тому, кто записывает
-- операции (выбор счёта), поэтому чтение открыто по обоим блокам. Ветка
-- `brigade_id` по календарю «Счетов» — ради INSERT … RETURNING: новой строки
-- ещё нет в выборке правила. `accounts_scope_brigade_check` держит `brigade_id`
-- пустым у общего счёта, поэтому общий счёт сотруднику не создать и не
-- поменять. Удаление — только `accounts_owner_all`.

drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or brigade_id in (select unnest(public.access_calendars('finance.accounts', 'read')))
      or id in (select unnest(public.access_accounts_for('finance.operations', 'read')))
      or id in (select unnest(public.access_accounts_for('finance.accounts', 'read')))
    )
  );

drop policy if exists accounts_insert_calendar on public.accounts;
create policy accounts_insert_calendar on public.accounts
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and brigade_id in (select unnest(public.access_calendars('finance.accounts', 'write')))
    and (created_by is null or created_by = (select auth.uid()))
  );

drop policy if exists accounts_update_calendar on public.accounts;
create policy accounts_update_calendar on public.accounts
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and brigade_id in (select unnest(public.access_calendars('finance.accounts', 'write')))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and brigade_id in (select unnest(public.access_calendars('finance.accounts', 'write')))
  );

-- Привязки общего счёта: сотрудник видит только привязки своих календарей и не
-- узнаёт, какие ещё календари пользуются общим счётом. Пишет их владелец.
drop policy if exists account_teams_select_calendar on public.account_teams;
create policy account_teams_select_calendar on public.account_teams
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      team_id in (select unnest(public.access_calendars('finance.operations', 'read')))
      or team_id in (select unnest(public.access_calendars('finance.accounts', 'read')))
    )
  );

-- Перевод виден, только если видны ОБА его счёта: иначе чужой календарь
-- показал бы, сколько денег ушло с его счёта. Правило считается один раз на
-- запрос (скалярный подзапрос). Пишут переводы только функции в обход.
drop policy if exists finance_transfer_requests_select_calendar on public.finance_transfer_requests;
create policy finance_transfer_requests_select_calendar on public.finance_transfer_requests
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and array[from_account_id, to_account_id] <@ (select public.access_accounts_for('finance.accounts', 'read'))
  );

-- ─── Долги ──────────────────────────────────────────────────────────────
-- Ветка диспетчера по роли снята: долги открывались ему на всю компанию, мимо
-- календарей (диспетчеров на боевой нет). Долг без календаря остаётся только
-- владельцу; автор нового долга сотрудника — он сам.

drop policy if exists debts_read on public.debts;
create policy debts_read on public.debts
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (select unnest(public.access_calendars('finance.debts', 'read')))
    )
  );

drop policy if exists debts_insert on public.debts;
create policy debts_insert on public.debts
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (
        team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
        and (created_by is null or created_by = (select auth.uid()))
      )
    )
  );

drop policy if exists debts_update on public.debts;
create policy debts_update on public.debts
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
    )
  );

drop policy if exists debts_delete on public.debts;
create policy debts_delete on public.debts
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (select unnest(public.access_calendars('finance.debts', 'write')))
    )
  );

-- ─── Справочники денег: только чтение ───────────────────────────────────
-- Категории, скрытые и порядок читает тот, кто «Смотрит» операции или долги хоть
-- в одном календаре: форма операции и форма долга без них пусты (у долгов свои
-- семь стандартных категорий). Шаблоны и НДС календаря — по календарю
-- «Доходов и расходов». Меняет справочники по-прежнему только владелец:
-- «Категории, шаблоны, НДС» оживут отдельным срезом.

drop policy if exists finance_categories_select_access on public.finance_categories;
create policy finance_categories_select_access on public.finance_categories
  for select to authenticated
  using (
    (tenant_id is null or tenant_id = (select public.current_tenant_id()))
    and (
      (select cardinality(public.access_calendars('finance.operations', 'read'))) > 0
      or (select cardinality(public.access_calendars('finance.debts', 'read'))) > 0
    )
  );

drop policy if exists finance_category_hidden_select_access on public.finance_category_hidden;
create policy finance_category_hidden_select_access on public.finance_category_hidden
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select cardinality(public.access_calendars('finance.operations', 'read'))) > 0
      or (select cardinality(public.access_calendars('finance.debts', 'read'))) > 0
    )
  );

drop policy if exists finance_category_order_select_access on public.finance_category_order;
create policy finance_category_order_select_access on public.finance_category_order
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select cardinality(public.access_calendars('finance.operations', 'read'))) > 0
      or (select cardinality(public.access_calendars('finance.debts', 'read'))) > 0
    )
  );

drop policy if exists finance_templates_select_access on public.finance_templates;
create policy finance_templates_select_access on public.finance_templates
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and brigade_id in (select unnest(public.access_calendars('finance.operations', 'read')))
  );

drop policy if exists team_finance_settings_select_access on public.team_finance_settings;
create policy team_finance_settings_select_access on public.team_finance_settings
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.operations', 'read')))
  );

-- ─── Остатки и сводка по счетам ─────────────────────────────────────────
--
-- Тела перенесены из живой базы. Изменено: отказ всем, кроме владельца, заменён
-- фильтром по `access_accounts_totals()` — сотрудник получает остатки счетов
-- команд своих календарей «Счетов и остатков» и общего счёта, только если ему
-- видны ВСЕ календари этого счёта. Для владельца фильтр выключен
-- (`caller_is_owner`), и выборка совпадает с прежней байт в байт. Сигнатуры,
-- форма ответа, проверки компании и периода — прежние. Сообщение на пустой вход
-- больше не говорит «только владельцу»: теперь это неправда.

create or replace function public.account_balances(p_tenant uuid)
returns table(account_id uuid, delta numeric, has_history boolean, is_active boolean, last_outflow_on date, last_tx_on date, first_tx_on date)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  caller_is_owner boolean;
  visible_accounts uuid[];
begin
  if auth.uid() is null then
    raise exception 'Балансы счетов доступны только участникам компании';
  end if;
  if tenant_uuid is null then
    raise exception 'Компания не определена';
  end if;
  if p_tenant is not null and p_tenant is distinct from tenant_uuid then
    raise exception 'Счета другой компании недоступны';
  end if;

  caller_is_owner := coalesce(public.current_user_role() = 'owner', false);
  if not caller_is_owner then
    visible_accounts := public.access_accounts_totals();
  end if;

  return query
  with ledger as (
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
      max(t.occurred_on) filter (
        where t.type = 'transfer' and t.amount < 0
      ) as ledger_last_outflow_on,
      max(t.occurred_on) as ledger_last_tx_on,
      min(t.occurred_on) as ledger_first_tx_on
    from public.finance_transactions t
    where t.tenant_id = tenant_uuid
      and (caller_is_owner or t.account_id = any(visible_accounts))
    group by t.account_id
  ),
  tenant_accounts as (
    select a.id, a.is_active
    from public.accounts a
    where a.tenant_id = tenant_uuid
      and (caller_is_owner or a.id = any(visible_accounts))
  )
  select
    coalesce(tenant_accounts.id, ledger.ledger_account_id) as account_id,
    round(coalesce(ledger.ledger_delta, 0), 2) as delta,
    coalesce(ledger.tx_count, 0) > 0 as has_history,
    coalesce(tenant_accounts.is_active, true) as is_active,
    ledger.ledger_last_outflow_on as last_outflow_on,
    ledger.ledger_last_tx_on as last_tx_on,
    ledger.ledger_first_tx_on as first_tx_on
  from tenant_accounts
  full join ledger on ledger.ledger_account_id = tenant_accounts.id;
end;
$function$;

revoke all on function public.account_balances(uuid) from public, anon;
grant execute on function public.account_balances(uuid) to authenticated;

create or replace function public.account_period_totals(p_tenant uuid, p_from date, p_to date)
returns table(account_id uuid, opening_before numeric, income numeric, expense numeric, refund numeric, transfer_in numeric, transfer_out numeric, net numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  caller_is_owner boolean;
  visible_accounts uuid[];
begin
  if auth.uid() is null then
    raise exception 'Сводка по счетам доступна только участникам компании';
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
  if p_from > p_to then
    raise exception 'Начало периода позже его конца';
  end if;

  caller_is_owner := coalesce(public.current_user_role() = 'owner', false);
  if not caller_is_owner then
    visible_accounts := public.access_accounts_totals();
  end if;

  return query
  with ledger as (
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
      sum(-t.amount) filter (
        where t.type = 'expense' and t.occurred_on >= p_from
      ) as expense_total,
      sum(-abs(t.amount)) filter (
        where t.type = 'refund' and t.occurred_on >= p_from
      ) as refund_total,
      sum(t.amount) filter (
        where t.type = 'transfer' and t.amount > 0 and t.occurred_on >= p_from
      ) as transfer_in_total,
      sum(t.amount) filter (
        where t.type = 'transfer' and t.amount < 0 and t.occurred_on >= p_from
      ) as transfer_out_total,
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
      and (caller_is_owner or t.account_id = any(visible_accounts))
    group by t.account_id
  ),
  tenant_accounts as (
    select a.id, a.opening_balance
    from public.accounts a
    where a.tenant_id = tenant_uuid
      and (caller_is_owner or a.id = any(visible_accounts))
  )
  select
    coalesce(tenant_accounts.id, ledger.ledger_account_id) as account_id,
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
$function$;

revoke all on function public.account_period_totals(uuid, date, date) from public, anon;
grant execute on function public.account_period_totals(uuid, date, date) to authenticated;

-- ─── Переводы между счетами ─────────────────────────────────────────────
--
-- Тела перенесены из живой базы. Изменено ровно два места в каждой функции:
--   • отказ всем, кроме владельца, заменён отказом без входа и без компании;
--   • сотрудник проходит, только если ОБА счёта перевода есть в
--     `access_accounts_for('finance.accounts', 'write')`: оба — счета команд, и
--     у каждого календарь, где «Счета и остатки» стоят «Меняет». Перевод меняет
--     остатки обоих счетов, поэтому «Меняет» на одном и «Смотрит» на другом —
--     мало; общий счёт компании в эту выборку не входит никогда. Проверка стоит
--     ДО блокировки и повтора запроса: повтор чужого перевода по тому же номеру
--     не обходит права.
-- Путь владельца прежний: для него проверка не выполняется.

create or replace function public.record_account_transfer(p_request_id uuid, p_from_account_id uuid, p_to_account_id uuid, p_amount numeric, p_occurred_on date default null::date, p_notes text default null::text)
returns setof public.finance_transactions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  request_row public.finance_transfer_requests%rowtype;
  from_account public.accounts%rowtype;
  to_account public.accounts%rowtype;
  normalized_amount numeric(12,2);
  normalized_notes text := nullif(btrim(p_notes), '');
  source_balance numeric(14,2);
  transfer_date date;
  caller_is_owner boolean;
  writable_accounts uuid[];
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Переводы между счетами доступны только участникам компании';
  end if;
  caller_is_owner := coalesce(public.current_user_role() = 'owner', false);
  if p_request_id is null then raise exception 'Не удалось определить запрос перевода'; end if;
  if p_from_account_id is null or p_to_account_id is null then
    raise exception 'Выберите оба счёта';
  end if;
  if p_from_account_id = p_to_account_id then raise exception 'Выберите разные счета'; end if;
  if not caller_is_owner then
    writable_accounts := public.access_accounts_for('finance.accounts', 'write');
    if not (p_from_account_id = any(writable_accounts) and p_to_account_id = any(writable_accounts)) then
      raise exception 'Перевод между этими счетами вам не открыт'
        using errcode = '42501', hint = 'block:finance.accounts';
    end if;
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 then
    raise exception 'Введите сумму больше нуля';
  end if;
  normalized_amount := round(p_amount, 2);
  if normalized_amount <> p_amount then raise exception 'Укажите не больше двух знаков после запятой'; end if;
  transfer_date := coalesce(
    p_occurred_on,
    public.tenant_business_date(tenant_uuid)
  );
  if transfer_date > public.tenant_business_date(tenant_uuid) then
    raise exception 'Финансовую операцию нельзя записать будущей датой';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into request_row
    from public.finance_transfer_requests
   where id = p_request_id
   for update;
  if found then
    if request_row.tenant_id <> tenant_uuid then raise exception 'Запрос перевода уже использован'; end if;
    if request_row.from_account_id <> p_from_account_id
       or request_row.to_account_id <> p_to_account_id
       or request_row.amount <> normalized_amount
       or request_row.occurred_on <> transfer_date
       or request_row.notes is distinct from normalized_notes then
      raise exception 'Запрос перевода уже использован с другими данными';
    end if;
    if request_row.status = 'deleted' then raise exception 'Этот перевод уже отменён'; end if;
    if (select count(*) from public.finance_transactions
         where transfer_group_id = p_request_id and type = 'transfer') <> 2
       or not exists (
         select 1 from public.finance_transactions
          where transfer_group_id = p_request_id
            and tenant_id = tenant_uuid and account_id = p_from_account_id
            and amount = -normalized_amount
       ) or not exists (
         select 1 from public.finance_transactions
          where transfer_group_id = p_request_id
            and tenant_id = tenant_uuid and account_id = p_to_account_id
            and amount = normalized_amount
       ) then
      raise exception 'Перевод повреждён; данные не изменены';
    end if;
    return query
      select * from public.finance_transactions
       where transfer_group_id = p_request_id
       order by amount;
    return;
  end if;

  perform 1 from public.accounts
   where id in (p_from_account_id, p_to_account_id)
   order by id for update;
  select * into from_account from public.accounts where id = p_from_account_id;
  select * into to_account from public.accounts where id = p_to_account_id;
  if not found or from_account.id is null or to_account.id is null
     or from_account.tenant_id <> tenant_uuid or to_account.tenant_id <> tenant_uuid then
    raise exception 'Один из счетов не найден в этой компании';
  end if;
  if not from_account.is_active or not to_account.is_active then
    raise exception 'Перевод доступен только между активными счетами';
  end if;
  if from_account.brigade_id is not null and not exists (
    select 1 from public.teams
     where id = from_account.brigade_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Команда счетов не найдена';
  end if;
  if to_account.brigade_id is not null and not exists (
    select 1 from public.teams
     where id = to_account.brigade_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Команда счетов не найдена';
  end if;

  select round(
    from_account.opening_balance + coalesce(sum(
      case
        when type = 'expense' then -amount
        when type = 'refund' then -abs(amount)
        else amount
      end
    ), 0),
    2
  ) into source_balance
  from public.finance_transactions
  where account_id = from_account.id;
  if source_balance < normalized_amount then
    raise exception 'На исходном счёте недостаточно средств';
  end if;

  insert into public.finance_transfer_requests (
    id, tenant_id, from_account_id, to_account_id, team_id, amount,
    occurred_on, notes, created_by
  ) values (
    p_request_id, tenant_uuid, p_from_account_id, p_to_account_id,
    coalesce(from_account.brigade_id, to_account.brigade_id),
    normalized_amount, transfer_date, normalized_notes, auth.uid()
  );
  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'transfer_write', p_request_id, tenant_uuid)
  on conflict do nothing;
  insert into public.finance_transactions (
    tenant_id, type, amount, account_id, team_id, notes, occurred_on,
    transfer_group_id, source, created_by
  ) values
    (tenant_uuid, 'transfer', -normalized_amount, p_from_account_id,
     from_account.brigade_id, normalized_notes, transfer_date,
     p_request_id, 'manual', auth.uid()),
    (tenant_uuid, 'transfer', normalized_amount, p_to_account_id,
     to_account.brigade_id, normalized_notes, transfer_date,
     p_request_id, 'manual', auth.uid());
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'transfer_write' and entity_id = p_request_id;
  return query
    select * from public.finance_transactions
     where transfer_group_id = p_request_id
     order by amount;
end;
$function$;

revoke all on function public.record_account_transfer(uuid, uuid, uuid, numeric, date, text) from public, anon;
grant execute on function public.record_account_transfer(uuid, uuid, uuid, numeric, date, text) to authenticated;

create or replace function public.delete_account_transfer(p_transfer_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  request_row public.finance_transfer_requests%rowtype;
  destination_balance numeric(14,2);
  caller_is_owner boolean;
  writable_accounts uuid[];
begin
  if auth.uid() is null or tenant_uuid is null then
    raise exception 'Отменить перевод может только участник компании';
  end if;
  caller_is_owner := coalesce(public.current_user_role() = 'owner', false);
  if p_transfer_group_id is null then raise exception 'Перевод не найден'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_transfer_group_id::text, 0));
  select * into request_row
    from public.finance_transfer_requests
   where id = p_transfer_group_id
   for update;
  if not found then
    if exists (
      select 1 from public.finance_transactions
       where transfer_group_id = p_transfer_group_id
         and tenant_id = tenant_uuid
    ) then
      raise exception 'Перевод повреждён; данные не изменены';
    end if;
    return false;
  end if;
  if request_row.tenant_id <> tenant_uuid then raise exception 'Перевод не найден'; end if;
  if not caller_is_owner then
    writable_accounts := public.access_accounts_for('finance.accounts', 'write');
    if not (request_row.from_account_id = any(writable_accounts)
            and request_row.to_account_id = any(writable_accounts)) then
      raise exception 'Отменить перевод между этими счетами вам не открыто'
        using errcode = '42501', hint = 'block:finance.accounts';
    end if;
  end if;
  if request_row.status = 'deleted' then return false; end if;

  perform 1 from public.accounts
   where id in (request_row.from_account_id, request_row.to_account_id)
   order by id for update;
  if (select count(*) from public.accounts
       where id in (request_row.from_account_id, request_row.to_account_id)
         and tenant_id = tenant_uuid and is_active = true) <> 2 then
    raise exception 'Один из счетов закрыт или недоступен';
  end if;
  perform 1 from public.finance_transactions
   where transfer_group_id = p_transfer_group_id
   order by id for update;
  if (select count(*) from public.finance_transactions
       where transfer_group_id = p_transfer_group_id and type = 'transfer') <> 2
     or not exists (
       select 1 from public.finance_transactions
        where transfer_group_id = p_transfer_group_id
          and tenant_id = tenant_uuid and account_id = request_row.from_account_id
          and amount = -request_row.amount
     ) or not exists (
       select 1 from public.finance_transactions
        where transfer_group_id = p_transfer_group_id
          and tenant_id = tenant_uuid and account_id = request_row.to_account_id
          and amount = request_row.amount
     ) then
    raise exception 'Перевод повреждён; данные не изменены';
  end if;

  select round(
    account.opening_balance + coalesce(sum(
      case
        when tx.type = 'expense' then -tx.amount
        when tx.type = 'refund' then -abs(tx.amount)
        else tx.amount
      end
    ), 0),
    2
  ) into destination_balance
  from public.accounts account
  left join public.finance_transactions tx on tx.account_id = account.id
  where account.id = request_row.to_account_id
  group by account.opening_balance;
  if destination_balance < request_row.amount then
    raise exception 'На счёте назначения уже недостаточно средств для отмены перевода';
  end if;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'transfer_write', p_transfer_group_id, tenant_uuid)
  on conflict do nothing;
  delete from public.finance_transactions
   where transfer_group_id = p_transfer_group_id and tenant_id = tenant_uuid;
  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'transfer_write' and entity_id = p_transfer_group_id;
  update public.finance_transfer_requests
     set status = 'deleted', deleted_at = now(), deleted_by = auth.uid()
   where id = p_transfer_group_id;
  return true;
end;
$function$;

revoke all on function public.delete_account_transfer(uuid) from public, anon;
grant execute on function public.delete_account_transfer(uuid) to authenticated;

-- ─── Ручные строки дня ──────────────────────────────────────────────────
--
-- Тело перенесено из живой базы. Изменено: вместо «только владелец» — владелец
-- или «Доходы и расходы: Меняет» в ЭТОМ календаре. Слова отказа те же, что
-- телефон пишет сам до запроса (`useSetDayExtras`), а `hint = block:…` даёт
-- телефону сбросить карту прав на любом отказе блока.

create or replace function public.replace_day_extras(p_team_id text, p_date text, p_extras jsonb)
returns setof public.day_extras
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  item jsonb;
  amount_value numeric;
begin
  if auth.uid() is null
     or tenant_uuid is null then
    raise exception 'Ручные финансы доступны только участникам компании'
      using errcode = '42501';
  end if;
  if public.current_user_role() is distinct from 'owner'
     and not coalesce(p_team_id = any(public.access_calendars('finance.operations', 'write')), false) then
    raise exception 'Менять доходы и расходы в этом календаре вам не открыто'
      using errcode = '42501', hint = 'block:finance.operations';
  end if;
  if nullif(btrim(coalesce(p_team_id, '')), '') is null
     or not exists (
       select 1 from public.teams team
        where team.tenant_id = tenant_uuid and team.id = p_team_id
     ) then
    raise exception 'Команда не найдена в этой компании'
      using errcode = '23503';
  end if;
  if p_date is null
     or p_date !~ '^\d{4}-\d{2}-\d{2}$'
     or (p_date::date)::text <> p_date then
    raise exception 'Дата ручной операции некорректна'
      using errcode = '22023';
  end if;
  if p_extras is null or jsonb_typeof(p_extras) <> 'array' then
    raise exception 'Список ручных операций повреждён'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_extras) > 200 then
    raise exception 'Слишком много ручных операций за один день'
      using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_extras)
  loop
    if jsonb_typeof(item) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(item) key
          where key not in (
            'id', 'name', 'amount', 'kind', 'category',
            'payment_method', 'receipt_url'
          )
       )
       or jsonb_typeof(item -> 'id') <> 'string'
       or jsonb_typeof(item -> 'name') <> 'string'
       or jsonb_typeof(item -> 'amount') <> 'number'
       or jsonb_typeof(item -> 'kind') <> 'string'
       or nullif(btrim(item ->> 'name'), '') is null
       or char_length(btrim(item ->> 'name')) > 500
       or (item ->> 'kind') not in ('income', 'expense')
       or (
         item ? 'category'
         and item -> 'category' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'category') <> 'string'
           or (item ->> 'category') not in ('fuel', 'food', 'supplies', 'other')
         )
       )
       or (
         item ? 'payment_method'
         and item -> 'payment_method' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'payment_method') <> 'string'
           or (item ->> 'payment_method') not in ('cash', 'card', 'transfer', 'other')
         )
       )
       or (
         item ? 'receipt_url'
         and item -> 'receipt_url' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'receipt_url') <> 'string'
           or char_length(item ->> 'receipt_url') > 2048
         )
       ) then
      raise exception 'Ручная операция содержит некорректные поля'
        using errcode = '22023';
    end if;

    begin
      perform (item ->> 'id')::uuid;
      amount_value := (item ->> 'amount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Идентификатор или сумма ручной операции некорректны'
        using errcode = '22023';
    end;
    if amount_value = 'NaN'::numeric
       or amount_value < 0
       or amount_value > 999999999.99
       or round(amount_value, 2) is distinct from amount_value then
      raise exception 'Сумма ручной операции некорректна'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select count(distinct (value ->> 'id')::uuid)
      from jsonb_array_elements(p_extras)
  ) <> jsonb_array_length(p_extras) then
    raise exception 'Ручные операции не должны повторяться'
      using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':' || p_team_id || ':' || p_date, 0)
  );

  delete from public.day_extras extra
   where extra.tenant_id = tenant_uuid
     and extra.team_id = p_team_id
     and extra.date = p_date;

  insert into public.day_extras (
    id, tenant_id, team_id, date, name, amount, kind, category,
    payment_method, receipt_url
  )
  select
    (value ->> 'id')::uuid,
    tenant_uuid,
    p_team_id,
    p_date,
    btrim(value ->> 'name'),
    (value ->> 'amount')::numeric,
    value ->> 'kind',
    value ->> 'category',
    value ->> 'payment_method',
    value ->> 'receipt_url'
  from jsonb_array_elements(p_extras);

  return query
    select extra.*
      from public.day_extras extra
     where extra.tenant_id = tenant_uuid
       and extra.team_id = p_team_id
       and extra.date = p_date
     order by extra.created_at, extra.id;
end;
$function$;

revoke all on function public.replace_day_extras(text, text, jsonb) from public, anon;
grant execute on function public.replace_day_extras(text, text, jsonb) to authenticated;

-- ─── Старый импорт расписания ───────────────────────────────────────────
-- `import_schedule` (security invoker, 2026-04-30) удаляет и заново вставляет
-- ручные строки дня мимо проверок `replace_day_extras` и открыт даже анониму.
-- Приложение его не зовёт: в apps/mobile и packages/shared есть только
-- сгенерированный тип. Клиентам вызов закрыт; сервисный ключ остаётся.

revoke all on function public.import_schedule(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- ─── Реестр: три блока оживают ──────────────────────────────────────────
-- Места проверки названы так, чтобы их можно было найти в каталоге:
-- `policy:схема.таблица.политика` и `function:схема.функция(аргументы)`.
-- Сторож ниже проверяет, что каждое место существует и спрашивает свой блок.
-- Оплату в записи (`record_appointment_payment`, `cancel_appointment_payment`)
-- реестр не называет: она пишет доходы по своей проверке и перейдёт на уровни
-- в срезе `record.payment`.

update public.access_blocks
   set live = true,
       enforced_by = array[
         'policy:public.finance_transactions.finance_transactions_select_calendar',
         'policy:public.finance_transactions.finance_transactions_insert_calendar',
         'policy:public.finance_transactions.finance_transactions_update_calendar',
         'policy:public.finance_transactions.finance_transactions_delete_calendar',
         'policy:public.day_extras.day_extras_select_calendar',
         'function:public.replace_day_extras(text, text, jsonb)',
         'policy:public.accounts.accounts_select',
         'policy:public.account_teams.account_teams_select_calendar',
         'policy:public.finance_categories.finance_categories_select_access',
         'policy:public.finance_category_hidden.finance_category_hidden_select_access',
         'policy:public.finance_category_order.finance_category_order_select_access',
         'policy:public.finance_templates.finance_templates_select_access',
         'policy:public.team_finance_settings.team_finance_settings_select_access'
       ]
 where key = 'finance.operations';

update public.access_blocks
   set live = true,
       enforced_by = array[
         'policy:public.accounts.accounts_select',
         'policy:public.accounts.accounts_insert_calendar',
         'policy:public.accounts.accounts_update_calendar',
         'policy:public.account_teams.account_teams_select_calendar',
         'policy:public.finance_transfer_requests.finance_transfer_requests_select_calendar',
         'function:public.account_balances(uuid)',
         'function:public.account_period_totals(uuid, date, date)',
         'function:public.record_account_transfer(uuid, uuid, uuid, numeric, date, text)',
         'function:public.delete_account_transfer(uuid)'
       ]
 where key = 'finance.accounts';

update public.access_blocks
   set live = true,
       enforced_by = array[
         'policy:public.debts.debts_read',
         'policy:public.debts.debts_insert',
         'policy:public.debts.debts_update',
         'policy:public.debts.debts_delete',
         'policy:public.finance_transactions.finance_transactions_select_debt',
         'policy:public.finance_transactions.finance_transactions_insert_calendar',
         'policy:public.finance_transactions.finance_transactions_update_calendar',
         'policy:public.finance_transactions.finance_transactions_delete_calendar',
         'policy:public.finance_categories.finance_categories_select_access',
         'policy:public.finance_category_hidden.finance_category_hidden_select_access',
         'policy:public.finance_category_order.finance_category_order_select_access'
       ]
 where key = 'finance.debts';

-- ─── Живое время ────────────────────────────────────────────────────────
-- Живые блоки меняют карту каждого сотрудника, хотя его уровни не менялись.
-- Тот же сигнал, что даёт правка прав: версия растёт, телефон перечитывает
-- карту и сразу открывает или гасит деньги.

do $signal$
declare
  person record;
begin
  for person in
    update public.tenant_members tm
       set access_version = tm.access_version + 1
     where tm.role <> 'owner'
    returning tm.tenant_id, tm.user_id, tm.access_version
  loop
    perform realtime.send(
      jsonb_build_object('tenant_id', person.tenant_id, 'version', person.access_version),
      'access_changed',
      'access:' || person.user_id::text,
      true
    );
  end loop;
end
$signal$;

-- ─── Сторож ─────────────────────────────────────────────────────────────

do $guard$
declare
  v_created constant text[] := array[
    'finance_transactions.finance_transactions_select_calendar',
    'finance_transactions.finance_transactions_select_debt',
    'finance_transactions.finance_transactions_insert_calendar',
    'finance_transactions.finance_transactions_update_calendar',
    'finance_transactions.finance_transactions_delete_calendar',
    'day_extras.day_extras_select_calendar',
    'accounts.accounts_select',
    'accounts.accounts_insert_calendar',
    'accounts.accounts_update_calendar',
    'account_teams.account_teams_select_calendar',
    'finance_transfer_requests.finance_transfer_requests_select_calendar',
    'debts.debts_read',
    'debts.debts_insert',
    'debts.debts_update',
    'debts.debts_delete',
    'finance_categories.finance_categories_select_access',
    'finance_category_hidden.finance_category_hidden_select_access',
    'finance_category_order.finance_category_order_select_access',
    'finance_templates.finance_templates_select_access',
    'team_finance_settings.team_finance_settings_select_access'
  ];
  v_money_tables constant text[] := array[
    'finance_transactions', 'day_extras', 'accounts', 'account_teams',
    'finance_transfer_requests', 'debts', 'finance_categories',
    'finance_category_hidden', 'finance_category_order', 'finance_templates',
    'team_finance_settings'
  ];
  v_tenant constant text := '^\(tenant_id = \( SELECT (public\.)?current_tenant_id\(\) AS current_tenant_id\)\)$';
  v_owner constant text := 'current_user_role\(\)( AS current_user_role\))? = ''owner''::text';
  v_helper text;
  v_entry record;
  v_clause record;
  v_live text[];
  v_block record;
  v_place text;
  v_place_text text;
  v_def text;
  v_body text;
  v_inner text;
  v_conjuncts text[];
  v_depth integer;
  v_quoted boolean;
  v_start integer;
  v_match integer;
  v_i integer;
  v_char text;
begin
  -- Правила блоков: есть, stable security definer со своим search_path, аноним
  -- их не зовёт. Политики зовут три правила от имени вошедшего; тела с чужим
  -- человеком в аргументах и остатки — только безопасные функции.
  foreach v_helper in array array[
    'public.access_records_level(uuid, uuid, text)',
    'public.access_calendars_of(uuid, uuid, text, text)',
    'public.access_calendars(text, text)',
    'public.access_company(text, text)',
    'public.access_accounts_for(text, text)',
    'public.access_accounts_totals()'
  ] loop
    if to_regprocedure(v_helper) is null then
      raise exception 'миграция: нет правила %', v_helper;
    end if;
    if not exists (
      select 1 from pg_proc p
       where p.oid = to_regprocedure(v_helper)
         and p.prosecdef
         and p.provolatile = 's'
         and p.proconfig @> array['search_path=public']
    ) then
      raise exception 'миграция: правило % не stable security definer с search_path', v_helper;
    end if;
    if has_function_privilege('anon', v_helper, 'execute') then
      raise exception 'миграция: правило % открыто анониму', v_helper;
    end if;
  end loop;
  foreach v_helper in array array[
    'public.access_calendars(text, text)',
    'public.access_company(text, text)',
    'public.access_accounts_for(text, text)'
  ] loop
    if not has_function_privilege('authenticated', v_helper, 'execute') then
      raise exception 'миграция: политики не смогут позвать %', v_helper;
    end if;
  end loop;
  foreach v_helper in array array[
    'public.access_records_level(uuid, uuid, text)',
    'public.access_calendars_of(uuid, uuid, text, text)',
    'public.access_accounts_totals()'
  ] loop
    if has_function_privilege('authenticated', v_helper, 'execute') then
      raise exception 'миграция: внутреннее правило % открыто клиенту', v_helper;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.import_schedule(jsonb, jsonb, jsonb, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.import_schedule(jsonb, jsonb, jsonb, jsonb)', 'execute') then
    raise exception 'миграция: import_schedule пишет ручные строки дня мимо replace_day_extras';
  end if;

  -- Без входа правила не отдают ничего (проверяется, только когда накат идёт
  -- без личности, как у обычной миграции).
  if auth.uid() is null and (
       cardinality(public.access_calendars('finance.operations', 'read')) <> 0
       or public.access_company('finance.settings', 'read')
       or cardinality(public.access_accounts_for('finance.accounts', 'read')) <> 0
       or cardinality(public.access_accounts_totals()) <> 0
     ) then
    raise exception 'миграция: правило блока отдаёт доступ без входа';
  end if;

  -- Возврат платежа инвойса всегда несёт invoice_id: иначе он выглядел бы
  -- ручной строкой. Сотрудник возвраты и так не трогает — это проверка посылки.
  if exists (
    select 1
      from public.finance_transactions refund_row
      join public.finance_transactions paid_row on paid_row.id = refund_row.refund_of_id
     where refund_row.invoice_id is null
       and paid_row.invoice_id is not null
  ) then
    raise exception 'миграция: возврат платежа инвойса лежит без invoice_id';
  end if;

  -- Ровно объявленные политики: для authenticated, разрешающие, нужной команды.
  for v_entry in
    select * from (values
      ('finance_transactions', 'finance_transactions_select_calendar', 'SELECT'),
      ('finance_transactions', 'finance_transactions_select_debt', 'SELECT'),
      ('finance_transactions', 'finance_transactions_insert_calendar', 'INSERT'),
      ('finance_transactions', 'finance_transactions_update_calendar', 'UPDATE'),
      ('finance_transactions', 'finance_transactions_delete_calendar', 'DELETE'),
      ('day_extras', 'day_extras_select_calendar', 'SELECT'),
      ('accounts', 'accounts_select', 'SELECT'),
      ('accounts', 'accounts_insert_calendar', 'INSERT'),
      ('accounts', 'accounts_update_calendar', 'UPDATE'),
      ('account_teams', 'account_teams_select_calendar', 'SELECT'),
      ('finance_transfer_requests', 'finance_transfer_requests_select_calendar', 'SELECT'),
      ('debts', 'debts_read', 'SELECT'),
      ('debts', 'debts_insert', 'INSERT'),
      ('debts', 'debts_update', 'UPDATE'),
      ('debts', 'debts_delete', 'DELETE'),
      ('finance_categories', 'finance_categories_select_access', 'SELECT'),
      ('finance_category_hidden', 'finance_category_hidden_select_access', 'SELECT'),
      ('finance_category_order', 'finance_category_order_select_access', 'SELECT'),
      ('finance_templates', 'finance_templates_select_access', 'SELECT'),
      ('team_finance_settings', 'team_finance_settings_select_access', 'SELECT')
    ) as p(tbl, pol, cmd)
  loop
    if not exists (
      select 1 from pg_policies pp
       where pp.schemaname = 'public'
         and pp.tablename = v_entry.tbl
         and pp.policyname = v_entry.pol
         and pp.cmd = v_entry.cmd
         and pp.permissive = 'PERMISSIVE'
         and pp.roles = array['authenticated']::name[]
         and (pp.cmd in ('SELECT', 'DELETE') or pp.with_check is not null)
         and (pp.cmd = 'INSERT' or pp.qual is not null)
    ) then
      raise exception 'миграция: нет политики %.% (%) для authenticated', v_entry.tbl, v_entry.pol, v_entry.cmd;
    end if;
  end loop;

  -- Всё, чего миграция не касалась, осталось байт в байт; ничего не пропало и
  -- не появилось сверх объявленного.
  if exists (
       select 1
         from pg_policies pp
        where pp.schemaname = 'public'
          and pp.tablename = any(v_money_tables)
          and not ((pp.tablename || '.' || pp.policyname) = any(v_created))
          and not exists (
            select 1 from _finance_levels_policies_before b
             where b.tbl = pp.tablename
               and b.pol = pp.policyname
               and b.cmd = pp.cmd
               and b.permissive = pp.permissive
               and b.roles = pp.roles::text
               and b.qual is not distinct from pp.qual
               and b.with_check is not distinct from pp.with_check
          )
     )
     or exists (
       select 1
         from _finance_levels_policies_before b
        where not ((b.tbl || '.' || b.pol) = any(v_created))
          and not exists (
            select 1 from pg_policies pp
             where pp.schemaname = 'public'
               and pp.tablename = b.tbl
               and pp.policyname = b.pol
          )
     ) then
    raise exception 'миграция: у денежных таблиц политика появилась, пропала или изменилась мимо объявленных';
  end if;

  -- Политики владельца на месте и по-прежнему про владельца — и в USING, и в
  -- WITH CHECK.
  for v_entry in
    select * from (values
      ('finance_transactions', 'finance_transactions_owner_all', 'ALL'),
      ('accounts', 'accounts_owner_all', 'ALL'),
      ('account_teams', 'account_teams_owner_all', 'ALL'),
      ('day_extras', 'day_extras_owner_all', 'ALL'),
      ('finance_transfer_requests', 'finance_transfer_requests_owner_select', 'SELECT'),
      ('finance_categories', 'finance_categories_owner_select', 'SELECT'),
      ('finance_categories', 'finance_categories_owner_write', 'ALL'),
      ('finance_category_hidden', 'finance_category_hidden_owner_all', 'ALL'),
      ('finance_category_order', 'finance_category_order_owner_all', 'ALL'),
      ('finance_templates', 'finance_templates_owner_all', 'ALL'),
      ('team_finance_settings', 'team_finance_settings_owner', 'ALL')
    ) as p(tbl, pol, cmd)
  loop
    if not exists (
      select 1 from pg_policies pp
       where pp.schemaname = 'public'
         and pp.tablename = v_entry.tbl
         and pp.policyname = v_entry.pol
         and pp.cmd = v_entry.cmd
         and coalesce(pp.qual, '') ~ v_owner
         and (pp.cmd = 'SELECT' or coalesce(pp.with_check, '') ~ v_owner)
    ) then
      raise exception 'миграция: политика владельца %.% пропала или изменилась', v_entry.tbl, v_entry.pol;
    end if;
  end loop;

  -- Старая галочка и роль диспетчера не остались ни в одной политике денег;
  -- внутренние правила не зовёт ни одна политика; объявленные зовут правила
  -- ТОЛЬКО подзапросом.
  if exists (
    select 1 from pg_policies pp
     where pp.schemaname = 'public'
       and pp.tablename = any(v_money_tables)
       and (
         (coalesce(pp.qual, '') || ' ' || coalesce(pp.with_check, '')) ~ 'current_user_calendar_ids|dispatcher'
         or (coalesce(pp.qual, '') || ' ' || coalesce(pp.with_check, '')) ~ 'access_(calendars_of|accounts_totals|records_level)\('
       )
  ) then
    raise exception 'миграция: у денежных таблиц осталась старая галочка, роль диспетчера или внутреннее правило';
  end if;

  -- Каждое условие каждой объявленной политики — отдельно: правило зовётся
  -- подзапросом, а обязательные условия стоят на верхнем уровне через AND,
  -- так что «… OR invoice_id IS NULL» их не подменит.
  for v_clause in
    select pp.tablename::text as tbl, pp.policyname::text as pol, part.kind, part.expr
      from pg_policies pp
     cross join lateral (values ('using', pp.qual), ('check', pp.with_check)) as part(kind, expr)
     where pp.schemaname = 'public'
       and (pp.tablename || '.' || pp.policyname) = any(v_created)
       and part.expr is not null
  loop
    v_body := btrim(regexp_replace(v_clause.expr, '\s+', ' ', 'g'));

    if v_body !~ 'access_(calendars|accounts_for)\(' then
      raise exception 'миграция: %.% (%) не зовёт правило блока', v_clause.tbl, v_clause.pol, v_clause.kind;
    end if;
    if regexp_replace(
         v_body,
         'SELECT (unnest\(|cardinality\()?(public\.)?access_(calendars|company|accounts_for)\(',
         'SELECT (',
         'g'
       ) ~ 'access_(calendars|company|accounts_for)\(' then
      raise exception 'миграция: %.% зовёт правило блока без подзапроса — счёт на каждую строку', v_clause.tbl, v_clause.pol;
    end if;

    -- Верхние условия через AND: снять внешние скобки, резать по « AND » на
    -- нулевой глубине вне кавычек.
    v_inner := null;
    if left(v_body, 1) = '(' then
      v_depth := 0;
      v_quoted := false;
      v_match := 0;
      for v_i in 1..length(v_body) loop
        v_char := substr(v_body, v_i, 1);
        if v_quoted then
          if v_char = '''' then v_quoted := false; end if;
        elsif v_char = '''' then
          v_quoted := true;
        elsif v_char = '(' then
          v_depth := v_depth + 1;
        elsif v_char = ')' then
          v_depth := v_depth - 1;
          if v_depth = 0 then
            v_match := v_i;
            exit;
          end if;
        end if;
      end loop;
      if v_match = length(v_body) then
        v_inner := substr(v_body, 2, length(v_body) - 2);
      end if;
    end if;

    v_conjuncts := array[]::text[];
    if v_inner is not null then
      v_depth := 0;
      v_quoted := false;
      v_start := 1;
      v_i := 1;
      while v_i <= length(v_inner) loop
        v_char := substr(v_inner, v_i, 1);
        if v_quoted then
          if v_char = '''' then v_quoted := false; end if;
        elsif v_char = '''' then
          v_quoted := true;
        elsif v_char = '(' then
          v_depth := v_depth + 1;
        elsif v_char = ')' then
          v_depth := v_depth - 1;
        elsif v_depth = 0 and substr(v_inner, v_i, 5) = ' AND ' then
          v_conjuncts := v_conjuncts || substr(v_inner, v_start, v_i - v_start);
          v_start := v_i + 5;
          v_i := v_i + 4;
        end if;
        v_i := v_i + 1;
      end loop;
      v_conjuncts := v_conjuncts || substr(v_inner, v_start);
    end if;
    if cardinality(v_conjuncts) < 2 then
      raise exception 'миграция: %.% (%) без верхних условий через AND', v_clause.tbl, v_clause.pol, v_clause.kind;
    end if;

    if v_clause.pol = 'finance_categories_select_access' then
      if not exists (
        select 1 from unnest(v_conjuncts) c
         where c ~ '^\(\(tenant_id IS NULL\) OR \(tenant_id = \( SELECT (public\.)?current_tenant_id\(\) AS current_tenant_id\)\)\)$'
      ) then
        raise exception 'миграция: % потеряла проверку компании', v_clause.pol;
      end if;
    elsif not exists (select 1 from unnest(v_conjuncts) c where c ~ v_tenant) then
      raise exception 'миграция: %.% (%) потеряла проверку компании', v_clause.tbl, v_clause.pol, v_clause.kind;
    end if;

    if v_clause.tbl = 'finance_transactions'
       and v_clause.pol in (
         'finance_transactions_insert_calendar',
         'finance_transactions_update_calendar',
         'finance_transactions_delete_calendar'
       ) then
      if not exists (select 1 from unnest(v_conjuncts) c where c = '(invoice_id IS NULL)')
         or not exists (select 1 from unnest(v_conjuncts) c where c = '(refund_of_id IS NULL)')
         or not exists (
           select 1 from unnest(v_conjuncts) c
            where c ~ '^\(team_id IN \( SELECT unnest\((public\.)?access_calendars\(''finance\.operations''::text, ''write''::text\)\) AS unnest\)\)$'
         )
         or not exists (
           select 1 from unnest(v_conjuncts) c
            where c = case
              when v_clause.pol = 'finance_transactions_insert_calendar'
                then '(type = ANY (ARRAY[''income''::text, ''expense''::text]))'
              else '(type = ''expense''::text)'
            end
         )
         or (
           v_clause.pol = 'finance_transactions_insert_calendar'
           and not exists (
             select 1 from unnest(v_conjuncts) c where c ~ '^\(created_by = \( SELECT auth\.uid\(\) AS uid\)\)$'
           )
         ) then
        raise exception 'миграция: %.% (%) пишет инвойс, возврат, доход или чужого автора мимо проверки', v_clause.tbl, v_clause.pol, v_clause.kind;
      end if;
    end if;
  end loop;

  -- Живы по меньшей мере эти три блока (следующие срезы добавят свои), и у
  -- каждого названные места проверки существуют и спрашивают именно его.
  select coalesce(array_agg(b.key order by b.key), array[]::text[])
    into v_live
    from public.access_blocks b
   where b.live;
  if not (v_live @> array['finance.accounts', 'finance.debts', 'finance.operations']) then
    raise exception 'миграция: живые блоки не те: %', v_live;
  end if;

  for v_block in
    select b.key, b.enforced_by
      from public.access_blocks b
     where b.key in ('finance.accounts', 'finance.debts', 'finance.operations')
  loop
    if cardinality(v_block.enforced_by) = 0 then
      raise exception 'миграция: у живого блока % не названы места проверки', v_block.key;
    end if;
    foreach v_place in array v_block.enforced_by loop
      if v_place ~ 'appointment_payment' then
        raise exception 'миграция: % проверяет оплату в записи по своей галочке, а не по блоку %', v_place, v_block.key;
      end if;
      v_place_text := null;
      if v_place like 'policy:public.%' then
        select coalesce(pp.qual, '') || ' ' || coalesce(pp.with_check, '')
          into v_place_text
          from pg_policies pp
         where pp.schemaname = 'public'
           and pp.tablename = split_part(substr(v_place, 15), '.', 1)
           and pp.policyname = split_part(substr(v_place, 15), '.', 2);
      elsif v_place like 'function:public.%' and to_regprocedure(substr(v_place, 10)) is not null then
        v_place_text := pg_get_functiondef(to_regprocedure(substr(v_place, 10)));
      end if;
      if v_place_text is null then
        raise exception 'миграция: место проверки % блока % не найдено', v_place, v_block.key;
      end if;
      if position(v_block.key in v_place_text) = 0
         and not (v_block.key = 'finance.accounts' and position('access_accounts_totals()' in v_place_text) > 0) then
        raise exception 'миграция: % не проверяет блок %', v_place, v_block.key;
      end if;
    end loop;
  end loop;

  -- Функции в обход решают через те же правила, отказ «только владельцу» ушёл,
  -- проверка чужой компании осталась.
  foreach v_helper in array array[
    'public.account_balances(uuid)',
    'public.account_period_totals(uuid, date, date)'
  ] loop
    v_def := pg_get_functiondef(v_helper::regprocedure);
    if position('visible_accounts := public.access_accounts_totals();' in v_def) = 0
       or position('Счета другой компании недоступны' in v_def) = 0
       or position('только владел' in v_def) > 0 then
      raise exception 'миграция: % отдаёт сотруднику чужие остатки или потеряла проверку компании', v_helper;
    end if;
  end loop;
  foreach v_helper in array array[
    'public.record_account_transfer(uuid, uuid, uuid, numeric, date, text)',
    'public.delete_account_transfer(uuid)'
  ] loop
    v_def := pg_get_functiondef(v_helper::regprocedure);
    if position('writable_accounts := public.access_accounts_for(''finance.accounts'', ''write'');' in v_def) = 0
       or position('block:finance.accounts' in v_def) = 0
       or position('только владел' in v_def) > 0 then
      raise exception 'миграция: % переводит мимо «Счетов и остатков»', v_helper;
    end if;
  end loop;
  v_def := pg_get_functiondef('public.replace_day_extras(text, text, jsonb)'::regprocedure);
  if position('public.access_calendars(''finance.operations'', ''write'')' in v_def) = 0
     or position('только владел' in v_def) > 0 then
    raise exception 'миграция: ручные строки дня пишутся мимо «Доходов и расходов»';
  end if;

  -- Сервер и карта телефона считают «Календарь и записи» одной функцией, без
  -- оглядки на живость, и пропускают только read и write.
  if position(
       'public.access_records_level(p_tenant_id, p_user_id, mc.team_id) as records_level'
       in pg_get_functiondef('public.access_map_for(uuid, uuid, boolean)'::regprocedure)
     ) = 0
     or position(
       'where p_include_off or array_position(array[''read'', ''write''], per_team.records_level) is not null;'
       in pg_get_functiondef('public.access_map_for(uuid, uuid, boolean)'::regprocedure)
     ) = 0
     or position(
       'array_position(array[''read'', ''write''], public.access_records_level(p_tenant, p_user, mc.team_id)) is not null'
       in pg_get_functiondef('public.access_calendars_of(uuid, uuid, text, text)'::regprocedure)
     ) = 0
     or position('<> ''off''' in pg_get_functiondef('public.access_map_for(uuid, uuid, boolean)'::regprocedure)) > 0
     or position('<> ''off''' in pg_get_functiondef('public.access_calendars_of(uuid, uuid, text, text)'::regprocedure)) > 0
     or pg_get_functiondef('public.access_records_level(uuid, uuid, text)'::regprocedure) ~ '\mlive\M' then
    raise exception 'миграция: карта телефона и правило сервера считают «Календарь и записи» по-разному';
  end if;
end
$guard$;

drop table _finance_levels_policies_before;
