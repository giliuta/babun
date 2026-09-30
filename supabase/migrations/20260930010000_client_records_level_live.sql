-- «ЗАПИСИ КЛИЕНТОВ» — ПРАВО, КОТОРОЕ ПРОВЕРЯЕТ СЕРВЕР (владелец 29.09: «в
-- блоке „Главное" — видит он записи, не видит вообще записи и может ли
-- создавать запись»; «для уточнения — запись клиента»).
--
-- Право `calendar.records` заведено с 14.09 («Календарь и записи», ступени
-- off · read · write) и уже служит воротами календаря команды: при «off»
-- `access_calendars_of` закрывает в этой команде все остальные права, а
-- `access_map_for` не несёт её в карте сотрудника. Но само оно было неживым,
-- и сами записи команды шли мастеру мимо него: `list_master_appointments_safe`
-- отдавал работу по прикреплению к календарю. «Скрыты» на экране было бы
-- обещанием без проверки. Эта миграция:
--
--   1. оживляет право и даёт ему имя владельца — «Записи клиентов»;
--   2. закрывает им саму ленту записей: мастер получает работу и события
--      команды только там, где «Записи клиентов» не ниже «Видит»;
--   3. на всякий случай засевает «Видит» прикреплённым календарям без
--      явного положения (так прикрепление и засевает с 20.09,
--      `seed_records_level`): сегодня у каждого прикрепления оно есть, и
--      никто ничего не теряет в день наката.
--
-- Экран: строка «Записи клиентов» — «Скрыты · Только видит · Видит и
-- создаёт»; ступень «Видит и создаёт» ставит заодно «Новые записи: Может»
-- (`calendar.create`, его проверяет `member_appointment_create`), а строка
-- «Новые записи» отдельно не рисуется.
--
-- Тело `list_master_appointments_safe` снято с боевой базы 30.09
-- (md5 prosrc d10d9f89fa743bd30b3332b94ff985ed) и изменено ровно в двух
-- местах: `record_teams` в `me` и строка `a.team_id = any(me.record_teams)`.

update public.access_blocks
   set live = true,
       title_ru = 'Записи клиентов',
       enforced_by = array[
         'function:public.list_master_appointments_safe(integer,integer)',
         'function:public.access_calendars_of(uuid,uuid,text,text)',
         'function:public.access_map_for(uuid,uuid,boolean)'
       ]
 where key = 'calendar.records';

insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select mc.tenant_id, mc.user_id, 'calendar.records', mc.team_id, 'read', owner_row.user_id, now()
  from public.member_calendars mc
  join lateral (
    select tm.user_id
      from public.tenant_members tm
     where tm.tenant_id = mc.tenant_id and tm.role = 'owner'
     limit 1
  ) owner_row on true
 where not exists (
   select 1 from public.member_access ma
    where ma.tenant_id = mc.tenant_id and ma.user_id = mc.user_id
      and ma.block = 'calendar.records' and ma.team_id = mc.team_id
 )
on conflict do nothing;

CREATE OR REPLACE FUNCTION public.list_master_appointments_safe(p_offset integer DEFAULT 0, p_limit integer DEFAULT 1000)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as materialized (
    select public.current_user_role()                        as role,
           public.current_tenant_id()                        as tenant_id,
           public.current_user_master_id()                   as master_id,
           public.current_user_team_ids()                    as legacy_team_ids,
           public.current_user_calendar_ids('view')          as granted_team_ids,
           public.access_calendars('record.client', 'read')   as client_teams,
           public.access_calendars('record.object', 'read')   as object_teams,
           public.access_calendars('record.services', 'read') as services_teams,
           public.access_calendars('record.amount', 'read')   as amount_teams,
           public.access_calendars('record.payment', 'read')  as payment_teams,
           public.access_calendars('calendar.events', 'read') as event_teams,
           public.access_calendars('record.label', 'read')    as label_teams,
           -- «Записи клиентов» (30.09): команды, где он видит записи.
           public.access_calendars('calendar.records', 'read') as record_teams
  )
  select jsonb_build_object(
    'id', a.id,
    'tenant_id', a.tenant_id,
    'client_id', case when v.see_client then a.client_id end,
    'team_id', a.team_id,
    'master_id', a.master_id,
    'location_id', case when v.see_object then a.location_id end,
    'date', a.date,
    'time_start', a.time_start,
    'time_end', a.time_end,
    'kind', a.kind,
    'status', a.status,
    'comment', a.comment,
    'address', case when v.see_object then a.address else '' end,
    'address_note', case when v.see_object then a.address_note else '' end,
    'address_lat', case when v.see_object then a.address_lat end,
    'address_lng', case when v.see_object then a.address_lng end,
    'cancel_reason', a.cancel_reason,
    'source', a.source,
    'is_online_booking', a.is_online_booking,
    'consent_given', a.consent_given,
    'color_override', a.color_override,
    -- Метка записи — по «Метка записи: Видит» (аудит 24.09: поле не
    -- приходило вовсе, и строка права ничего не открывала).
    'city', case when a.kind <> 'work' or a.team_id = any(me.label_teams) then a.city end,
    'reminder_enabled', a.reminder_enabled,
    'reminder_offsets', a.reminder_offsets,
    'reminder_template', a.reminder_template,
    'service_ids', case
      when v.see_services then coalesce(a.service_ids, '[]'::jsonb)
      else '[]'::jsonb
    end,
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
    'total_amount', case when v.see_amount then coalesce(a.total_amount, 0) else 0 end,
    'custom_total', case when v.see_amount then coalesce(a.custom_total, false) else false end,
    'discount_amount', case when v.see_amount then coalesce(a.discount_amount, 0) else 0 end,
    'prepaid_amount', 0,
    'paid_amount', case
      when v.see_payment and v.see_amount then coalesce(a.paid_amount, 0)
      else 0
    end,
    'payment_status', case
      when v.see_payment then coalesce(a.payment_status, 'unpaid')
      else 'unpaid'
    end,
    'payment_method', null,
    'payments', '[]'::jsonb,
    'payment', null,
    'expenses', '[]'::jsonb,
    'services', case
      when not v.see_services or jsonb_typeof(a.services) is distinct from 'array'
        then '[]'::jsonb
      when v.see_amount then a.services
      else (
        select coalesce(jsonb_agg(
                 jsonb_strip_nulls(jsonb_build_object(
                   'serviceId', line -> 'serviceId',
                   'serviceName', line -> 'serviceName',
                   'quantity', line -> 'quantity',
                   'unit', line -> 'unit',
                   'duration', line -> 'duration',
                   'variantId', line -> 'variantId'
                 )) || '{"pricePerUnit": 0, "originalPrice": 0, "totalPrice": 0}'::jsonb
                 order by ord), '[]'::jsonb)
          from jsonb_array_elements(a.services) with ordinality as l(line, ord)
      )
    end,
    'service_price_overrides', '{}'::jsonb,
    'global_discount', null
  )
    from public.appointments a
    cross join me
    cross join lateral (
      select
        coalesce(a.kind <> 'work' or a.team_id = any(me.client_teams), false)   as see_client,
        coalesce(a.kind <> 'work' or a.team_id = any(me.object_teams), false)   as see_object,
        coalesce(a.kind <> 'work' or a.team_id = any(me.services_teams), false) as see_services,
        coalesce(a.kind <> 'work' or a.team_id = any(me.amount_teams), false)   as see_amount,
        coalesce(a.kind <> 'work' or a.team_id = any(me.payment_teams), false)  as see_payment
    ) v
   where me.role = 'master'
     and a.tenant_id = me.tenant_id
     -- «Записи клиентов: Скрыты» (30.09) — ни работы, ни событий команды:
     -- её календарь у него пустой.
     and a.team_id = any(me.record_teams)
     -- Архивный календарь сотруднику не показывается (аудит 24.09).
     and exists (
       select 1 from public.teams t
        where t.tenant_id = a.tenant_id and t.id = a.team_id and t.is_active
     )
     and (
       (
         a.kind = 'work'
         -- Только прикреплённые календари (аудит 24.09): ветка «мастер записи»
         -- пускала к работе в календаре, от которого человека открепили.
         and (
           a.team_id = any(me.legacy_team_ids)
           or a.team_id = any(me.granted_team_ids)
         )
       )
       or (
         a.kind in ('event', 'personal')
         and a.team_id is not null
         -- STORY-088: события команды — по «События: Видит».
         and a.team_id = any(me.event_teams)
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
