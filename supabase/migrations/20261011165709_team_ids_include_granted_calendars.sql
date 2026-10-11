-- КОМАНДЫ СОТРУДНИКА = СТАРЫЕ ПРИВЯЗКИ + КАЛЕНДАРИ, ОТКРЫТЫЕ НА ПРОСМОТР
-- (аудит 11.10). Функция брала команды из карточки мастера и составов команд
-- (у партнёра — одна), а доступ с 01.10 выдаётся календарями. Записи и SMS
-- уже читали «старые ∪ открытые», а проверка доступа к записи (фото, файлы),
-- к клиенту, проекция услуг и оборудование — только старые: партнёр в
-- открытом ему календаре терял файлы и услуги. Теперь все читают одно.
-- Сверено на боевой от лица партнёра: было 1 команда из 5, стало 5.
create or replace function public.current_user_team_ids()
 returns text[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with identity as (
    select public.current_user_master_id() as master_id,
           public.current_tenant_id() as tenant_id
  ), assigned as (
    select m.team_id as team_id
      from public.masters m
      join identity i on i.tenant_id = m.tenant_id and i.master_id = m.id
     where m.team_id is not null
    union
    select t.id
      from public.teams t
      cross join identity i
     where t.tenant_id = i.tenant_id
       and i.master_id is not null
       and (
         coalesce(t.lead_ids, '[]'::jsonb) ? i.master_id
         or coalesce(t.helper_ids, '[]'::jsonb) ? i.master_id
         or exists (
           select 1
             from jsonb_array_elements(
               case
                 when jsonb_typeof(t.members) = 'array' then t.members
                 else '[]'::jsonb
               end
             ) member
            where case jsonb_typeof(member)
              when 'string' then member #>> '{}'
              when 'object' then coalesce(member ->> 'master_id', member ->> 'id')
              else null
            end = i.master_id
         )
       )
  ), legacy as (
    select team_id
      from assigned
     where team_id is not null
       and (
         public.current_user_role() is distinct from 'master'
         or team_id in (
           select mc.team_id
             from public.member_calendars mc
             join public.teams t on t.tenant_id = mc.tenant_id and t.id = mc.team_id and t.is_active
            where mc.tenant_id = public.current_tenant_id()
              and mc.user_id = auth.uid()
         )
       )
  ), granted as (
    select t.id as team_id
      from public.teams t
     where public.current_user_role() = 'master'
       and t.tenant_id = public.current_tenant_id()
       and t.is_active
       and t.id = any(public.current_user_calendar_ids('view'))
  )
  select coalesce(array_agg(distinct team_id order by team_id), array[]::text[])
    from (select team_id from legacy union select team_id from granted) s
$function$;
