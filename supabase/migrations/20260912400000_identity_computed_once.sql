-- ПОСЛЕДНИЕ ПОСТРОЧНЫЕ ВЫЗОВЫ ЛИЧНОСТИ СНЯТЫ: ТРИ ПОЛИТИКИ И ДВЕ ФУНКЦИИ.
--
-- Сегодня 006 перевёл 209 вхождений `current_tenant_id()`/`current_user_role()`
-- в политиках на скалярный подзапрос: `security definer` не встраивается в
-- план никогда, поэтому голый вызов считается НА КАЖДУЮ СТРОКУ. Замеры сошлись
-- у обоих: 3412 мс против 21 мс у меня, 4778 мс против 87 мс у него на том же
-- размере. Порядок величины один и тот же — примерно полсотни раз.
--
-- Тот заход намеренно оставил два хвоста, и оба здесь.
--
-- ХВОСТ ПЕРВЫЙ — ТРИ ПОЛИТИКИ С `current_user_team_ids()`. Она возвращает
-- МАССИВ и стоит в `team_id = any(current_user_team_ids())`. Обернуть её
-- скалярным подзапросом нельзя: `any((select …))` читается как «любой из строк
-- подзапроса», и запрос падает на `text = text[]`. Нужна другая форма —
-- `in (select unnest(…))`, — и это правка СМЫСЛА, а не записи, поэтому она
-- поехала отдельно и с отдельной проверкой. Форма уже канонична: политики
-- записей зовут `current_user_calendar_ids` ровно так с утра.
--
-- Смысл сохраняется точно: `x = any(arr)` и `x in (select unnest(arr))` дают
-- одно и то же на пустом массиве (ложь) и на `x is null` (неизвестно).
--
-- ХВОСТ ВТОРОЙ — МОИ СОБСТВЕННЫЕ ФУНКЦИИ, и одна из них хуже всех политик
-- вместе взятых. `list_master_appointments_safe` ходит по ЗАПИСЯМ — самой
-- большой таблице продукта — и на каждой строке считала пять функций: роль
-- (а она внутри зовёт компанию), компанию, карточку мастера и два списка
-- календарей. Это главный экран мастера: у него календарь и встаёт первым.
-- `list_my_calendars` считала компанию дважды на строку — в самом ответе и в
-- сортировке.
--
-- Обе получили личность отдельным `materialized`-подзапросом. `materialized`
-- здесь не украшение: без него планировщик вправе подставить подзапрос обратно
-- в условие и вернуть построчный счёт, не сказав ни слова.
--
-- ВНУТРИ УСЛОВИЯ `= any(me.…)` ОСТАЁТСЯ, и это правильно: там уже не вызов
-- функции, а готовый массив. Менять его на `in (select unnest(…))` значило бы
-- городить подзапрос ради значения, которое уже посчитано.
--
-- ПРОГНАНО НА БОЕВОЙ В `begin/rollback`: выдача всех трёх функций и всех трёх
-- таблиц сверена ДО и ПОСЛЕ по каждой живой связке «человек × компания» —
-- совпало посимвольно, расхождений ноль.

-- ─── Три политики ────────────────────────────────────────────────────

drop policy if exists team_schedules_select_role_scoped on public.team_schedules;
create policy team_schedules_select_role_scoped on public.team_schedules
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = any (array['owner','dispatcher'])
      or (
        (select public.current_user_role()) = 'master'
        and team_id in (select unnest(public.current_user_team_ids()))
      )
    )
  );

drop policy if exists day_cities_select_role_scoped on public.day_cities;
create policy day_cities_select_role_scoped on public.day_cities
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = any (array['owner','dispatcher'])
      or (
        (select public.current_user_role()) = 'master'
        and team_id in (select unnest(public.current_user_team_ids()))
      )
    )
  );

drop policy if exists equipment_select_by_role on public.equipment;
create policy equipment_select_by_role on public.equipment
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = any (array['owner','dispatcher'])
      or (
        (select public.current_user_role()) = 'master'
        and assigned_team_id in (select unnest(public.current_user_team_ids()))
      )
    )
  );

-- ─── Календарь мастера ───────────────────────────────────────────────

create or replace function public.list_master_appointments_safe(
  p_offset integer default 0,
  p_limit integer default 1000
)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $function$
  with me as materialized (
    select public.current_user_role()               as role,
           public.current_tenant_id()               as tenant_id,
           public.current_user_master_id()          as master_id,
           public.current_user_team_ids()           as legacy_team_ids,
           public.current_user_calendar_ids('view') as granted_team_ids
  )
  select jsonb_build_object(
    'id', a.id,
    'tenant_id', a.tenant_id,
    'client_id', a.client_id,
    'team_id', a.team_id,
    'master_id', a.master_id,
    'location_id', a.location_id,
    'date', a.date,
    'time_start', a.time_start,
    'time_end', a.time_end,
    'kind', a.kind,
    'status', a.status,
    'comment', a.comment,
    'address', a.address,
    'address_note', a.address_note,
    'address_lat', a.address_lat,
    'address_lng', a.address_lng,
    'cancel_reason', a.cancel_reason,
    'source', a.source,
    'is_online_booking', a.is_online_booking,
    'consent_given', a.consent_given,
    'color_override', a.color_override,
    'reminder_enabled', a.reminder_enabled,
    'reminder_offsets', a.reminder_offsets,
    'reminder_template', a.reminder_template,
    'service_ids', a.service_ids,
    'total_duration', a.total_duration,
    'created_by', a.created_by,
    'created_at', a.created_at,
    'updated_at', a.updated_at,
    'event_all_day', a.event_all_day,
    'event_notes', a.event_notes,
    'event_url', a.event_url,
    'event_push_enabled', a.event_push_enabled,
    'event_push_offsets', a.event_push_offsets,
    'event_push_at', a.event_push_at,
    'event_repeat', a.event_repeat,
    'total_amount', 0,
    'custom_total', false,
    'discount_amount', 0,
    'prepaid_amount', 0,
    'paid_amount', 0,
    'payment_status', 'unpaid',
    'payment_method', null,
    'payments', '[]'::jsonb,
    'payment', null,
    'expenses', '[]'::jsonb,
    'services', '[]'::jsonb,
    'service_price_overrides', '{}'::jsonb,
    'global_discount', null
  )
    from public.appointments a
    cross join me
   where me.role = 'master'
     and a.tenant_id = me.tenant_id
     and (
       (
         a.kind = 'work'
         and (
           a.master_id = me.master_id
           or a.team_id = any(me.legacy_team_ids)
           or a.team_id = any(me.granted_team_ids)
         )
       )
       or (
         a.kind in ('event', 'personal')
         and a.team_id is not null
         and (
           a.team_id = any(me.legacy_team_ids)
           or a.team_id = any(me.granted_team_ids)
         )
       )
     )
   order by a.date, a.time_start, a.id
   offset greatest(coalesce(p_offset, 0), 0)
   limit greatest(1, least(coalesce(p_limit, 1000), 1000))
$function$;

-- ─── Лента календарей ────────────────────────────────────────────────

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
   order by (t.tenant_id = me.tenant_id) desc, tn.name, t.position, t.name
$function$;

do $$
declare v_src text; v_bad int;
begin
  -- Ни одной политики с построчным вызовом списка назначений не осталось.
  select count(*) into v_bad from pg_policies
   where schemaname='public'
     and (qual like '%any(current_user_team_ids())%'
       or qual like '%ANY (current_user_team_ids())%');
  if v_bad > 0 then
    raise exception 'осталось % политик со списком назначений на каждую строку', v_bad;
  end if;

  for v_src in
    select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and p.proname in ('list_master_appointments_safe','list_my_calendars')
  loop
    if position('materialized' in v_src) = 0 then
      raise exception 'личность снова считается на каждую строку';
    end if;
  end loop;
end $$;
