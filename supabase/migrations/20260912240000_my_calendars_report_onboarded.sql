-- Список календарей заодно говорит, пройден ли онбординг каждой компании.
--
-- Переход между компаниями упирается в сеть: сменить компанию в токене и
-- забрать новый токен — это две поездки на сервер, около пяти секунд. Убрать
-- их нельзя, а вот убрать ОЖИДАНИЕ с глаз — можно, если приложение заранее
-- знает всё, что понадобится в первую секунду после перехода.
--
-- Гейт «Открываем компанию» спрашивает ровно одно: заполнен ли у компании
-- `onboarded_at`. `activate_tenant` уже возвращает этот факт (миграция
-- activate_tenant_reports_onboarded), но возвращает его В КОНЦЕ перехода —
-- то есть ровно тогда, когда ждать уже поздно. Список календарей человек
-- получает ЗАРАНЕЕ, вместе с лентой: пусть факт приезжает там же, и тогда в
-- момент тапа приложение уже знает ответ и не показывает гейт вовсе.
--
-- Дороже запрос не становится: `tenants` в нём и так соединена — берём из неё
-- ещё одну колонку.

-- Тип возврата меняется, поэтому функция пересоздаётся, а не заменяется:
-- Postgres не даёт `create or replace` со сменой OUT-параметров.
drop function if exists public.list_my_calendars();

create function public.list_my_calendars()
returns table (
  tenant_id   uuid,
  tenant_name text,
  team_id     text,
  team_name   text,
  team_color  text,
  role        text,
  grants      text[],
  is_active   boolean,
  onboarded   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select t.tenant_id,
         tn.name,
         t.id,
         t.name,
         t.color,
         tm.role,
         case
           when tm.role = 'owner' then array[
             'view','book','edit_all','clients','phones','finance','close_day','settings'
           ]::text[]
           else coalesce(cm.grants, array[]::text[])
         end,
         t.tenant_id = public.current_tenant_id(),
         tn.onboarded_at is not null
    from public.tenant_members tm
    join public.tenants tn on tn.id = tm.tenant_id
    join public.teams t on t.tenant_id = tm.tenant_id
    left join public.calendar_members cm
      on cm.tenant_id = t.tenant_id
     and cm.team_id = t.id
     and cm.user_id = tm.user_id
   where tm.user_id = auth.uid()
     and (tm.role = 'owner' or cm.user_id is not null)
     and t.is_active
   order by (t.tenant_id = public.current_tenant_id()) desc, tn.name, t.position, t.name
$$;

revoke all on function public.list_my_calendars() from public, anon;
grant execute on function public.list_my_calendars() to authenticated;

do $$
begin
  if not exists (
    select 1
      from information_schema.routines r
      join information_schema.parameters p
        on p.specific_name = r.specific_name
     where r.routine_schema = 'public'
       and r.routine_name = 'list_my_calendars'
       and p.parameter_name = 'onboarded'
  ) then
    raise exception 'list_my_calendars: факт онбординга не возвращается';
  end if;
end $$;
