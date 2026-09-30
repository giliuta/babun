-- Записи мастера тоже слушаются прав на календарь.
--
-- Утром права научился понимать СПИСОК календарей
-- (`list_operational_teams_safe`), а сами записи — нет: их мастеру отдаёт
-- отдельная безопасная функция `list_master_appointments_safe`, и она знала
-- только СТАРЫЙ механизм назначений — карточку мастера и списки внутри
-- команды.
--
-- Что это давало вживую (поймано по вопросу владельца «переключаюсь команды —
-- не переключается»): человеку выдали право `view` на календарь, он
-- переключается на него — календарь МЕНЯЕТСЯ (чип, метки дня, заголовок), а
-- записей нет ни одной. Со стороны это читается ровно как «не переключилось»,
-- хотя переключилось всё, кроме содержимого.
--
-- Проверено на симуляторе: до правки календарь «Команда 2» открывался пустым,
-- после — на своём месте стоит запись от 10 сентября 12:45.
--
-- Ветка добавлена ОБЕИМ половинам условия: и рабочим записям, и командным
-- событиям — право «видеть календарь» открывает календарь целиком, а не
-- половину. Старые ветки остались рядом: снимем их вместе с остальными, когда
-- экран прав научится выдавать доступ.
--
-- Правка записи (`update_master_appointment_safe`) НАМЕРЕННО не тронута:
-- смотреть и менять — разные права, и второе поедет вместе с `edit_all`.

create or replace function public.list_master_appointments_safe(
  p_offset integer default 0,
  p_limit integer default 1000
)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
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
   where public.current_user_role() = 'master'
     and a.tenant_id = public.current_tenant_id()
     and (
       (
         a.kind = 'work'
         and (
           a.master_id = public.current_user_master_id()
           or a.team_id = any(public.current_user_team_ids())
           or a.team_id in (select unnest(public.current_user_calendar_ids('view')))
         )
       )
       or (
         a.kind in ('event', 'personal')
         and a.team_id is not null
         and (
           a.team_id = any(public.current_user_team_ids())
           or a.team_id in (select unnest(public.current_user_calendar_ids('view')))
         )
       )
     )
   order by a.date, a.time_start, a.id
   offset greatest(coalesce(p_offset, 0), 0)
   limit greatest(1, least(coalesce(p_limit, 1000), 1000))
$$;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'list_master_appointments_safe'
       and position('current_user_calendar_ids' in p.prosrc) > 0
  ) then
    raise exception 'записи мастера не знают о правах на календарь';
  end if;
end $$;
