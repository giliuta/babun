-- МЕТКА ДНЯ КОМАНДЫ ВИДНА ТОМУ, КОМУ ВЫДАН ЕЁ КАЛЕНДАРЬ.
--
-- Таблица зовётся `day_cities` исторически; в продукте её строка — МЕТКА ДНЯ:
-- ярлык под числом в календаре (тап по числу → `DayLabelSheet`), имя берётся
-- из справочника меток `location_labels`. Владелец 2026-09-14: «это не города,
-- а метка».
--
-- Хвост того же случая, что `team_schedules_follow_calendar_grants`
-- (владелец 2026-09-14: «у Команды 1 график с 10:00, а у аккаунта после
-- передачи сетка с 06:00»). Замечание сессии 006, переданное через 008:
-- политика `day_cities_select_role_scoped` устроена так же, как была политика
-- графика, — мастера пускает только через старый `current_user_team_ids()`
-- (назначение карточкой). У человека, которому календарь ВЫДАН правом
-- (`calendar_members`), карточки может не быть вовсе, и метки дня на его сетке
-- оставались пустыми, хотя сам календарь и график он уже видит.
--
-- ЧТО ДЕЛАЕМ — ту же форму, одно правило на весь календарь: владелец — всё;
-- выданное право `view` — видно; ветка роли (диспетчер — все, мастер — свои по
-- карточке) работает, только пока у человека нет ни одной строки прав
-- (`current_user_has_calendar_grants`, канон `grants_narrow_role_in_policies`).
-- Справочник меток (`location_labels_operational_read`) уже открыт всем членам
-- компании — его не трогаем. Запись меток дня не тронута. Инвентарь
-- (`equipment_select_by_role`) правом календаря НЕ открывается: это другой блок.
--
-- ПРОГНАНО НА БОЕВОЙ В `begin/rollback` — отпечаток видимых строк по командам
-- для ВСЕХ 20 членств до и после: изменилась одна строка (airfix.cy в Giliuta:
-- «ничего» → 2 метки «Команды 1»); владелец Giliuta видит те же 32 (включая
-- `__personal__` и 4 строки команды, которой больше нет); посторонний с
-- заголовком Giliuta — 0. Потерь ноль.

drop policy if exists day_cities_select_role_scoped on public.day_cities;

create policy day_cities_select_role_scoped on public.day_cities
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

-- СТОРОЖ. Политика меток дня знает права по календарю и гасит ветку роли,
-- когда права выданы; вернуть её к «только роль» из старой копии не даст накат.
do $$
declare
  v_qual text;
begin
  select qual into v_qual
    from pg_policies
   where schemaname = 'public'
     and tablename = 'day_cities'
     and policyname = 'day_cities_select_role_scoped';
  if v_qual is null then
    raise exception 'day_cities_select_role_scoped is missing';
  end if;
  if v_qual not like '%current_user_calendar_ids(''view''%' then
    raise exception 'day_cities must be readable through calendar grants';
  end if;
  if v_qual not like '%current_user_has_calendar_grants%' then
    raise exception 'day_cities role branch must switch off once grants exist';
  end if;
end $$;
