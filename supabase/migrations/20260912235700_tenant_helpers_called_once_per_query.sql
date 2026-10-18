-- ЛИЧНОСТЬ СЧИТАЕТСЯ ОДИН РАЗ НА ЗАПРОС, А НЕ НА КАЖДУЮ СТРОКУ.
--
-- `current_tenant_id()` и `current_user_role()` — `security definer`, а такие
-- функции Postgres НИКОГДА не встраивает в запрос. Поэтому в условии вида
-- `tenant_id = current_tenant_id()` функция вызывается на КАЖДУЮ строку
-- таблицы. Обёрнутая в скалярный подзапрос, она становится InitPlan и
-- считается ОДИН раз.
--
-- Замер на боевой (200 000 строк, построчное условие):
--   `= current_tenant_id()`          → 4778 мс, в плане `Filter: … = current_tenant_id()`
--   `= (select current_tenant_id())` →   87 мс, в плане `InitPlan 1` (11 мс, один раз)
-- Пятьдесят пять раз. Сегодня это не болит — в самой большой компании 18
-- записей, — но заболит у первого клиента с тысячами, и выглядеть будет не как
-- «медленно», а как «приложение зависло». Ровно эту ловушку репозиторий уже
-- описывал у `current_user_calendar_ids` (миграция `calendar_members`): там
-- правило записали, а на саму `current_tenant_id()` не распространили.
--
-- Правка МЕХАНИЧЕСКАЯ и смысл не меняет: заменяется только форма вызова, сам
-- предикат остаётся тем же. Проверено прогоном в `begin/rollback` на боевой:
-- три связки «человек × компания» (владелец AirFix, тот же человек гостем в
-- Giliuta, владелец Giliuta) × восемь таблиц = 24 замера, 145 строк — доступ
-- совпал ДО и ПОСЛЕ по всем двадцати четырём, расхождений ноль.
--
-- `current_user_team_ids()` НЕ ТРОГАЕМ, и это не забывчивость. Она возвращает
-- МАССИВ и стоит в условиях вида `team_id = any(current_user_team_ids())`.
-- Скалярный подзапрос там меняет смысл: `any((select …))` читается уже как
-- «любой из строк подзапроса», а не «любой из элементов массива», и Postgres
-- падает с `operator does not exist: text = text[]`. Это поймал прогон.
-- Правильная форма для неё — `= any (select unnest(current_user_team_ids()))`,
-- но это правка СМЫСЛА выражения, а не формы вызова, и ей место в отдельном
-- заходе. Таких политик три.
--
-- Идемпотентна: берёт только политики, где вызов ещё голый.

do $$
declare
  p      record;
  v_q    text;
  v_c    text;
  v_sql  text;
  v_fn   text;
  v_n    integer := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname in ('public', 'storage')
       and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~
           '(current_tenant_id\(\)|current_user_role\(\))'
  loop
    v_q := p.qual;
    v_c := p.with_check;

    -- Точечная замена по имени с пустыми скобками: у обеих функций нет
    -- аргументов, поэтому строка однозначна и подставить её некуда ещё.
    -- Уже обёрнутый вызов выглядит как `( SELECT current_tenant_id() …)` и
    -- сюда не попадает — фильтр выше отбирает только голые.
    foreach v_fn in array array['current_tenant_id()', 'current_user_role()'] loop
      v_q := replace(v_q, v_fn, '(select ' || v_fn || ')');
      v_c := replace(v_c, v_fn, '(select ' || v_fn || ')');
    end loop;

    -- USING и WITH CHECK подставляются ТОЛЬКО те, что у политики есть:
    -- `alter policy … with check` на политике FOR SELECT — ошибка.
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_q is not null then v_sql := v_sql || format(' using (%s)', v_q); end if;
    if v_c is not null then v_sql := v_sql || format(' with check (%s)', v_c); end if;

    execute v_sql;
    v_n := v_n + 1;
  end loop;

  raise notice 'форма вызова исправлена у % политик', v_n;
end $$;

-- СТОРОЖ. Голых вызовов не остаётся ни одного: если кто-то заведёт новую
-- политику со старой формой, накат на чистую базу об этом скажет.
do $$
declare
  v_bare integer;
  v_left text;
begin
  select count(*),
         string_agg(schemaname || '.' || tablename || '.' || policyname, ', ')
    into v_bare, v_left
    from pg_policies
   where schemaname in ('public', 'storage')
     and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~
         '(?<!SELECT )(current_tenant_id\(\)|current_user_role\(\))';

  if v_bare > 0 then
    raise exception 'личность всё ещё считается на каждую строку в % политиках: %',
      v_bare, v_left;
  end if;
end $$;
