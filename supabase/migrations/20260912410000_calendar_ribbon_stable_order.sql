-- ПОРЯДОК ЛЕНТЫ КАЛЕНДАРЕЙ НЕ ЗАВИСИТ ОТ ТОГО, ГДЕ ЧЕЛОВЕК СЕЙЧАС.
--
-- Владелец 2026-09-12: «как установлено — Y&D первая, вторая Команда 1 — оно
-- не должно прыгать вправо-влево».
--
-- Лента начиналась с календарей АКТИВНОЙ компании: и на сервере
-- (`order by (t.tenant_id = current_tenant_id()) desc`), и на клиенте. Значит
-- ряд переставлялся ровно в ту секунду, когда человек на него смотрит: он
-- переходил в соседнюю компанию, бывший чужой календарь становился своим и
-- уезжал в начало ряда.
--
-- Жалоба воспроизводится одним запросом на боевой, тем же человеком:
--   стоя в AirFix  → AirFix LTD/Y&D → Giliuta/Команда 1
--   стоя в Giliuta → Giliuta/Команда 1 → AirFix LTD/Y&D
--
-- Место в ряду человек читает как «так установлено», а не как «я сейчас
-- здесь». Где он сейчас, говорит ЗАЛИВКА чипа — форма уже несёт этот смысл, и
-- второго носителя ей не нужно.
--
-- Сортировка теперь по (имя компании, position, имя календаря) и не
-- упоминает активную компанию вовсе. Колонка `is_active` остаётся: она
-- отвечает на другой вопрос — не «где место в ряду», а «какой чип залит».
--
-- Клиентская половина правила уехала тем же заходом (`useCalendarChips`):
-- одного сервера мало, потому что свои чипы лента берёт из списка экрана — в
-- нём есть ещё и архивные календари с незакрытой работой, которых эта функция
-- не отдаёт вовсе.

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
set search_path = public
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
           when tm.role = 'owner' then array[
             'view','book','edit_all','clients','phones','finance','close_day','settings'
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
