-- ВЫДАННОЕ ПРАВО ЗАМЕНЯЕТ РОЛЬ И НА ЭКРАНЕ КАЛЕНДАРЕЙ, А НЕ ТОЛЬКО В ЛЕНТЕ.
--
-- Владелец 2026-09-12: «если я приглашаю сотрудника в календарь — он видит
-- исключительно этот календарь».
--
-- Часом раньше это правило заведено в ленте календарей
-- (`my_calendars_sees_role_access`). Но экран календарей читает ДРУГУЮ
-- функцию, и там ветка роли осталась безусловной: `current_user_role() =
-- 'dispatcher'` открывает всю компанию независимо от того, какие права
-- человеку выдали. То есть обещание владельца выполнялось бы в ленте чипов и
-- НЕ выполнялось бы на самом экране — выдача права на один календарь ничего
-- бы не сузила.
--
-- Правило одно на продукт и звучит так: ПОЯВИЛАСЬ У ЧЕЛОВЕКА ХОТЬ ОДНА СТРОКА
-- ПРАВ В КОМПАНИИ — ВЕТКА РОЛИ ДЛЯ НЕГО ГАСНЕТ ЦЕЛИКОМ. Ни одна вторая
-- механика доступа не должна тихо добавлять календари сверху выданных: иначе
-- «сузил права» означает «не сузил ничего», и узнаётся это только жалобой.
--
-- Пока строк прав нет вовсе — поведение ровно сегодняшнее: диспетчеру вся
-- компания, мастеру его назначения. Людей, которые держатся на старой ветке
-- назначений, в базе на момент правки НОЛЬ (проверено запросом), поэтому
-- накат никому ничего не отбирает.
--
-- ЗАОДНО СНЯТА ЦЕНА ВЫЗОВОВ. Раньше `current_user_role()`,
-- `current_tenant_id()` и обе функции доступа считались НА КАЖДУЮ СТРОКУ:
-- `security definer` не инлайнится никогда. Замер на боевой (таблица 200 000
-- строк): прямой вызов 3412 мс против 21 мс тем же запросом, если значение
-- вычислено один раз, — 160×. Здесь личность считается один раз в
-- `materialized`-подзапросе. Восемь команд этого не замечают, восемь тысяч
-- заметили бы.
--
-- Архивные календари экран отдаёт по-прежнему: их чип виден намеренно, чтобы
-- в архивный календарь можно было заглянуть. Лента их не показывает — там
-- фильтр `is_active` стоял и остаётся. Это не расхождение, а разные вопросы:
-- «куда можно смотреть» и «между чем переключаться».

create or replace function public.list_operational_teams_safe()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $function$
  -- ЛИЧНОСТЬ СЧИТАЕТСЯ ОДИН РАЗ. `materialized` здесь не украшение: без него
  -- планировщик вправе подставить подзапрос в условие и вернуть повизитный
  -- вызов четырёх `security definer`-функций обратно.
  with me as materialized (
    select public.current_user_role()               as role,
           public.current_tenant_id()               as tenant_id,
           public.current_user_team_ids()           as legacy_team_ids,
           public.current_user_calendar_ids('view') as granted_team_ids,
           exists (
             select 1
               from public.calendar_members cm
              where cm.tenant_id = public.current_tenant_id()
                and cm.user_id = auth.uid()
           ) as has_explicit_grants
  )
  select jsonb_build_object(
    'id', t.id,
    'tenant_id', t.tenant_id,
    'name', t.name,
    'region', t.region,
    'color', t.color,
    'is_active', t.is_active,
    'position', t.position,
    'timezone', t.timezone,
    'default_city', t.default_city,
    'cities', t.cities,
    'tint_days_by_label', t.tint_days_by_label,
    'hide_cancelled', t.hide_cancelled,
    'allow_overtime', t.allow_overtime,
    'appointment_blocks', t.appointment_blocks,
    'buffer_minutes', t.buffer_minutes,
    'calendar_window_start', t.calendar_window_start,
    'calendar_window_end', t.calendar_window_end,
    'default_scroll_time', t.default_scroll_time,
    'default_slot_minutes', t.default_slot_minutes,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  )
    from public.teams t
    cross join me
   where me.role in ('dispatcher', 'master')
     and t.tenant_id = me.tenant_id
     and (
       t.id = any(me.granted_team_ids)
       or (
         -- ВЫКЛЮЧАТЕЛЬ. Считается по компании целиком, а не по строке
         -- календаря: иначе человек с правом на один календарь продолжал бы
         -- получать остальные «по роли», и сужение не работало бы вовсе.
         not me.has_explicit_grants
         and (
           me.role = 'dispatcher'
           or t.id = any(me.legacy_team_ids)
         )
       )
     )
   order by t.position, t.name, t.id
$function$;

comment on function public.list_operational_teams_safe() is
  'Календари, доступные диспетчеру или мастеру в активной компании. Есть '
  'выданные права — ровно они; нет ни одной строки прав — доступ по роли '
  '(диспетчеру компания, мастеру назначения). Архивные тоже отдаются.';

do $$
declare v_src text;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='list_operational_teams_safe';

  if position('has_explicit_grants' in v_src) = 0 then
    raise exception 'list_operational_teams_safe: выключатель ветки роли потерян — право перестало сужать';
  end if;

  -- Сторож против «оптимизации», которая вернёт повизитные вызовы.
  if position('materialized' in v_src) = 0 then
    raise exception 'list_operational_teams_safe: личность снова считается на каждую строку';
  end if;

  if position('current_user_team_ids' in v_src) = 0 then
    raise exception 'list_operational_teams_safe: ветка назначений потеряна — мастера ослепнут';
  end if;
end $$;
