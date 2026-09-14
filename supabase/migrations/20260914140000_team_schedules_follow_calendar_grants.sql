-- ГРАФИК КОМАНДЫ ВИДЕН ТОМУ, КОМУ ВЫДАН ЕЁ КАЛЕНДАРЬ.
--
-- Владелец 2026-09-14 (передано через сессию 008): «у Команды 1 график с
-- 10:00, а у аккаунта после передачи сетка с 06:00».
--
-- ПРИЧИНА. Календарь человек видит по правам (`calendar_members`):
-- `list_operational_teams_safe` это знает и команду отдаёт. А политика чтения
-- графика `team_schedules_select_role_scoped` пускала мастера только через
-- старый `current_user_team_ids()` — назначение карточкой. У человека, которому
-- календарь ВЫДАН, карточки может не быть вовсе (airfix.cy в Giliuta: мастер
-- без карточки, `view` на «Команду 1»), и график 10–20 до него не доходил.
-- Без рабочей полосы клиент открывает сетку на рабочем начале компании —
-- 06:00. Настройки компании ни при чём: мастер получает их через
-- `read_operational_calendar_settings_safe`.
--
-- ЧТО ДЕЛАЕМ. Чтение графика считается ровно так же, как видимость самой
-- команды в `list_operational_teams_safe`: владелец — всё; выданное право
-- `view` — видно; ветка роли (диспетчер — все, мастер — свои по карточке)
-- работает, только пока у человека нет ни одной строки прав
-- (`current_user_has_calendar_grants`, канон `grants_narrow_role_in_policies`).
-- «Видишь календарь — видишь его график»: одно правило вместо двух.
--
-- ПРОГНАНО НА БОЕВОЙ В `begin/rollback` — отпечаток видимых графиков по ВСЕМ
-- 20 членствам до и после: изменилась одна строка (airfix.cy в Giliuta:
-- «ничего» → «Команда 1»), никто ничего не потерял. Запись графика не тронута —
-- по-прежнему только владелец.

drop policy if exists team_schedules_select_role_scoped on public.team_schedules;

create policy team_schedules_select_role_scoped on public.team_schedules
  for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (
    (select public.current_user_role()) = 'owner'
    or ((select public.current_user_role()) = 'dispatcher'
        and not (select public.current_user_has_calendar_grants()))
    or ((select public.current_user_role()) = 'master'
        and not (select public.current_user_has_calendar_grants())
        and team_id in (select unnest(public.current_user_team_ids())))
    or team_id in (select unnest(public.current_user_calendar_ids('view')))
  )
);

-- СТОРОЖ. Политика графика знает права по календарю и гасит ветку роли, когда
-- права выданы; вернуть её к «только роль» из старой копии не даст накат.
do $$
declare
  v_qual text;
begin
  select qual into v_qual
    from pg_policies
   where schemaname = 'public'
     and tablename = 'team_schedules'
     and policyname = 'team_schedules_select_role_scoped';
  if v_qual is null then
    raise exception 'team_schedules_select_role_scoped is missing';
  end if;
  if v_qual not like '%current_user_calendar_ids(''view''%' then
    raise exception 'team_schedules must be readable through calendar grants';
  end if;
  if v_qual not like '%current_user_has_calendar_grants%' then
    raise exception 'team_schedules role branch must switch off once grants exist';
  end if;
end $$;
