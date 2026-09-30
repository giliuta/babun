-- МЕТКА ЗАПИСИ И СОБЫТИЯ — ПОД «МЕТКОЙ ДНЯ» (владелец 30.09: «на главной
-- метку скрыл, а в записи клиентов поставил, что видит метку, — странно
-- выглядит… если отключаю на главной метку, отключается и в записи»).
--
-- Запись без своей метки показывает метку своего дня, поэтому скрытая
-- «Метка дня» при открытой «Метке» записи давала половину картины. Теперь
-- метку записи и события сотрудник видит и меняет, только если «Метка дня»
-- в этой команде у него не скрыта. Положение самой «Метки» записи не
-- стирается: откроют «Метку дня» — вернётся то, что стояло.
--
-- Тела сняты с `20260930060000_record_event_blocks` (живые, md5
-- 04ebbda3… и f9a96fd0…); изменены только помеченные места.

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
           public.access_calendars('calendar.records', 'read') as record_teams,
           -- БЛОКИ ЗАПИСИ И СОБЫТИЯ (30.09): «Заметка» записи — своё право;
           -- у события — свои блоки.
           public.access_calendars('record.note', 'read')     as note_teams,
           public.access_calendars('event.label', 'read')    as ev_label_teams,
           public.access_calendars('event.client', 'read')   as ev_client_teams,
           public.access_calendars('event.object', 'read')   as ev_object_teams,
           public.access_calendars('event.type', 'read')     as ev_type_teams,
           public.access_calendars('event.note', 'read')     as ev_note_teams,
           -- МЕТКА ЗАПИСИ И СОБЫТИЯ — ПОД «МЕТКОЙ ДНЯ» (30.09).
           public.access_calendars('calendar.day_labels', 'read') as day_label_teams
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
    -- У записи «comment» — её заметка; у события — его название (тип).
    'comment', case when v.see_comment then a.comment else '' end,
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
    'city', case
      when not coalesce(a.team_id = any(me.day_label_teams), false) then null
      when a.kind = 'work' and a.team_id = any(me.label_teams) then a.city
      when a.kind <> 'work' and a.team_id = any(me.ev_label_teams) then a.city
    end,
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
    'event_notes', case when v.see_event_note then a.event_notes else '' end,
    'event_url', case when v.see_event_note then a.event_url else '' end,
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
        coalesce(case when a.kind = 'work' then a.team_id = any(me.client_teams)
                      else a.team_id = any(me.ev_client_teams) end, false)          as see_client,
        coalesce(case when a.kind = 'work' then a.team_id = any(me.object_teams)
                      else a.team_id = any(me.ev_object_teams) end, false)          as see_object,
        coalesce(case when a.kind = 'work' then a.team_id = any(me.note_teams)
                      else a.team_id = any(me.ev_type_teams) end, false)            as see_comment,
        coalesce(a.kind <> 'work' and a.team_id = any(me.ev_note_teams), false)    as see_event_note,
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

CREATE OR REPLACE FUNCTION public.member_check_appointment_field(p_key text, p_value jsonb, p_kind text, p_team text, p_created_by uuid, p_old_status text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_block text;
begin
  -- СОБЫТИЯ: своё событие правит автор при «Записи событий: Видит и создаёт»;
  -- что именно в нём — по блокам события (30.09): метка, клиент, объект,
  -- тип (название и цвет), заметка. Время, статус, «весь день», напоминания
  -- и повтор — вместе с самим событием.
  if p_kind in ('event', 'personal') then
    if p_created_by is distinct from auth.uid()
       or public.member_can('calendar.events', 'write', p_team) is not true then
      raise exception 'access:block:calendar.events' using errcode = '42501';
    end if;
    if p_key in ('date', 'time_start', 'time_end', 'total_duration', 'status', 'event_all_day',
                 'event_push_enabled', 'event_push_offsets', 'event_push_at', 'event_repeat',
                 'cancel_reason') then
      return;
    end if;
    v_block := case
      when p_key = 'city' then 'event.label'
      when p_key = 'client_id' then 'event.client'
      when p_key in ('location_id', 'address', 'address_note', 'address_lat', 'address_lng') then 'event.object'
      when p_key in ('comment', 'color_override') then 'event.type'
      when p_key in ('event_notes', 'event_url') then 'event.note'
      else null
    end;
    if v_block is null then
      raise exception 'access:field:%', p_key using errcode = '42501';
    end if;
    if public.member_can(v_block, 'write', p_team) is not true then
      raise exception 'access:block:%', v_block using errcode = '42501';
    end if;
    -- Метка события — только пока «Метка дня» не скрыта (30.09).
    if p_key = 'city' and public.member_can('calendar.day_labels', 'read', p_team) is not true then
      raise exception 'access:block:calendar.day_labels' using errcode = '42501';
    end if;
    return;
  end if;

  v_block := case
    when p_key in ('date', 'time_start', 'time_end', 'total_duration') then 'calendar.move'
    -- Заметка записи — своё право (30.09), раньше шла со статусом.
    when p_key = 'comment' then 'record.note'
    when p_key = 'cancel_reason' then 'calendar.cancel'
    when p_key = 'client_id' then 'record.client'
    when p_key in ('location_id', 'address', 'address_note', 'address_lat', 'address_lng') then 'record.object'
    when p_key in ('services', 'service_ids', 'total_amount', 'custom_total', 'discount_amount',
                   'global_discount', 'service_price_overrides', 'vat_mode', 'vat_rate') then 'record.amount'
    when p_key = 'city' then 'record.label'
    when p_key = 'color_override' then 'record.color'
    when p_key in ('team_id', 'master_id') then 'record.team'
    when p_key = 'status' then
      case
        when (p_value #>> '{}') = 'cancelled' or p_old_status = 'cancelled' then 'calendar.cancel'
        else 'record.status'
      end
    else null
  end;
  if v_block is null then
    raise exception 'access:field:%', p_key using errcode = '42501';
  end if;
  -- `is not true`, а не `not …`: пустой ответ проверки не пускает.
  if public.member_can(v_block, 'write', p_team) is not true then
    raise exception 'access:block:%', v_block using errcode = '42501';
  end if;
  -- Метка записи — только пока «Метка дня» не скрыта (30.09).
  if p_key = 'city' and public.member_can('calendar.day_labels', 'read', p_team) is not true then
    raise exception 'access:block:calendar.day_labels' using errcode = '42501';
  end if;
end;
$function$;

update public.access_blocks
   set enforced_by = enforced_by || array['function:public.list_master_appointments_safe(integer, integer)']
 where key = 'calendar.day_labels'
   and not ('function:public.list_master_appointments_safe(integer, integer)' = any(enforced_by));
update public.access_blocks
   set enforced_by = enforced_by || array['function:public.member_check_appointment_field(text, jsonb, text, text, uuid, text)']
 where key = 'calendar.day_labels'
   and not ('function:public.member_check_appointment_field(text, jsonb, text, text, uuid, text)' = any(enforced_by));
