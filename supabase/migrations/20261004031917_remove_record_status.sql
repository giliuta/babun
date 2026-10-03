-- «СТАТУС» ЗАПИСИ УДАЛЁН (владелец 03.10: «статус удаляй полностью, он не
-- нужен; почисти всю CRM от этого статуса — в работе и так далее»).
--
-- «Запланирована / В работе / Выполнена» больше нигде не ставится руками и не
-- показывается: ни в меню записи, ни в карточке команды, ни в правах. Визит
-- закрывает оплата («Закрыть визит» — `record_appointment_payment`), и
-- внутреннее `completed` остаётся служебным для долгов и аналитики.
-- Отмена и возврат из неё — по-прежнему право «Отменять» (`calendar.cancel`).
--
-- Сервер:
--  1. `member_check_appointment_field`: статус рабочей записи сотрудник
--     меняет только отменой и возвратом из неё; иной статус — отказ
--     (`access:field:status`), тот же статус — не правка. Тело переписано
--     целиком из `pg_proc.prosrc`, снятого 04.10 (md5 сверяется), —
--     изменена только ветка статуса и проверка «тот же статус».
--  2. `update_master_appointment_safe` (старая дверь «статус и заметка»,
--     приложение её не зовёт): только заметка, и по праву «Заметка», а не
--     «Статус записи».
--  3. Право `record.status` уходит из реестра (строк прав и приглашений с
--     ним нет — сверено 04.10; записей «В работе» в базе ноль).

set local lock_timeout = '5s';

do $check$
begin
  if (select md5(prosrc) from pg_proc
       where oid = 'public.member_check_appointment_field(text,jsonb,text,text,uuid,text)'::regprocedure)
     is distinct from '623f78a31ac37f1f2ff57d32892875fc' then
    raise exception 'member_check_appointment_field изменилась после 04.10 — перечитать тело перед правкой';
  end if;
  if (select md5(prosrc) from pg_proc
       where oid = 'public.update_master_appointment_safe(uuid,jsonb)'::regprocedure)
     is distinct from '278b537ffb7806bca472ff4a07e12d01' then
    raise exception 'update_master_appointment_safe изменилась после 04.10 — перечитать тело перед правкой';
  end if;
end
$check$;

create or replace function public.member_check_appointment_field(p_key text, p_value jsonb, p_kind text, p_team text, p_created_by uuid, p_old_status text)
 returns void
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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

  -- Тот же статус в правке — не правка (04.10): права на него не нужно.
  if p_key = 'status' and (p_value #>> '{}') is not distinct from p_old_status then
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
    -- Статуса записи нет (03.10): сотрудник меняет его только отменой и
    -- возвратом из неё; «В работе» / «Выполнена» не ставит никто — визит
    -- закрывает оплата.
    when p_key = 'status' then
      case
        when (p_value #>> '{}') = 'cancelled' or p_old_status = 'cancelled' then 'calendar.cancel'
        else null
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

-- Старая дверь мастера: только заметка, по праву «Заметка».
do $migration$
declare
  fn regprocedure := 'public.update_master_appointment_safe(uuid,jsonb)'::regprocedure;
  def text;
  old_keys text := $old$     where key not in ('status', 'comment')
  ) then
    raise exception 'master can update only status and comment'$old$;
  new_keys text := $new$     where key <> 'comment'
  ) then
    -- Статуса записи нет (03.10) — дверь правит только заметку.
    raise exception 'master can update only the appointment note'$new$;
  old_team text := $old$public.access_calendars('record.status', 'write')$old$;
  new_team text := $new$public.access_calendars('record.note', 'write')$new$;
begin
  def := pg_get_functiondef(fn);
  if (length(def) - length(replace(def, old_keys, ''))) / length(old_keys) <> 1 then
    raise exception 'список полей update_master_appointment_safe не найден ровно один раз';
  end if;
  if (length(def) - length(replace(def, old_team, ''))) / length(old_team) <> 1 then
    raise exception 'проверка «Статуса» в update_master_appointment_safe не найдена ровно один раз';
  end if;
  execute replace(replace(def, old_keys, new_keys), old_team, new_team);
end
$migration$;

delete from public.member_access where block = 'record.status';
delete from public.access_blocks where key = 'record.status';

do $guard$
begin
  if exists (select 1 from public.access_blocks where key = 'record.status') then
    raise exception 'сторож: «Статус записи» остался в реестре';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc like '%record.status%'
  ) then
    raise exception 'сторож: функция всё ещё спрашивает «Статус записи»';
  end if;
  if has_function_privilege('anon', 'public.member_check_appointment_field(text,jsonb,text,text,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.update_master_appointment_safe(uuid,jsonb)', 'execute') then
    raise exception 'сторож: дверь записи открылась anon';
  end if;
end
$guard$;
