-- ДИРЕКТОР НЕ ВЫДАЁТ «ЗАПИСИ» ВЫШЕ СВОИХ (аудит 035, cab/R-08, часть 1).
--
-- Прикрепляя человека к календарю (`set_member_calendars`), сервер сеет ему
-- «Записи клиентов: Видит» (`seed_records_level`), чтобы календарь не был
-- пустым. Если прикрепляет директор, у которого в этом календаре «Записи:
-- Скрыт», новый человек получал больше, чем у самого директора, — мимо
-- правила «ставит права не выше своих» (`partners_check_caps` при этом не
-- зовётся). Теперь посев от не-владельца — не выше уровня директора в этом
-- календаре: у него «Скрыт» — и новому «Скрыт».
--
-- Остальные края R-08 (сравнение с действующим, а не хранимым уровнем;
-- партнёры вне общей команды) — отдельным шагом: они меняют модель прав
-- директора, а не одну строку посева.

create or replace function public.seed_records_level(p_tenant uuid, p_user uuid, p_by uuid)
returns void
language sql
security definer
set search_path = public
as $function$
  insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
  select mc.tenant_id, mc.user_id, 'calendar.records', mc.team_id,
         case
           when exists (
             select 1 from public.tenant_members tm
              where tm.tenant_id = p_tenant and tm.user_id = p_by and tm.role = 'owner'
           ) then 'read'
           when public.access_team_level(p_tenant, p_by, 'calendar.records', mc.team_id) in ('read', 'write') then 'read'
           else 'off'
         end,
         p_by, now()
    from public.member_calendars mc
   where mc.tenant_id = p_tenant
     and mc.user_id = p_user
     and not exists (
       select 1 from public.member_access ma
        where ma.tenant_id = mc.tenant_id and ma.user_id = mc.user_id
          and ma.block = 'calendar.records' and ma.team_id = mc.team_id
     )
  on conflict do nothing
$function$;
