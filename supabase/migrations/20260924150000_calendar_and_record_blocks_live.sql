-- КАЛЕНДАРЬ И ЗАПИСЬ ПО БЛОКАМ ДЛЯ СОТРУДНИКА (STORY-088, волна 1).
--
-- Владелец 24.09: «по каждому блоку… может ли он менять время, метку…
-- до чего угодно выключать и включать». До сих пор сотрудник мог в записи
-- ровно две вещи — статус и заметку (`update_master_appointment_safe`), а
-- создание, перенос и удаление записи решали старые гранты
-- `calendar_members.grants` (`book`, `edit_all`), которых у мастера нет.
--
-- Что делает миграция:
--  1. Реестр: оживают «Новые записи», «Переносить и копировать», «Отменять и
--     удалять» (новый), «События», «Метка дня», «График команды», «Метка
--     записи», «Команда и мастер», «Цвет записи» (новый). «Клиент», «Объект»
--     и «Сумма» получают положение «Меняет». Состав услуг меняет сумму —
--     поэтому его меняет «Сумма: Меняет» (план 14.09), у «Услуг» остаётся
--     «Не видит / Видит». «Время записи» слито с переносом.
--  2. Три двери сотрудника — `member_appointment_update / _create / _delete`.
--     Каждое поле проверяется СВОИМ блоком в календаре ЭТОЙ записи; поле без
--     блока не принимается вовсе. Владелец по-прежнему пишет в таблицу сам.
--  3. Сторож колонок мастера пропускает только правку, уже проверенную этими
--     дверями: флаг транзакции `babun.member_write` И запись изнутри
--     definer-функции (`current_user` не `authenticated`). Флаг, выставленный
--     самим клиентом, не пропускает — проверено в откате.
--  4. Метки дня и график команды — по блокам, а не по роли.
--  5. События в окне мастера — по «События: Видит».
--  6. Прикреплённым сотрудникам засеяно «Видит» на события, метки дня и
--     график: то, что они видели до миграции, не пропадает.

-- ─── 1. Реестр ────────────────────────────────────────────────────────────
update public.access_blocks
   set levels = array['off', 'read', 'write']
 where key in ('record.client', 'record.object', 'record.amount');

update public.access_blocks
   set title_ru = 'Сумма и услуги записи'
 where key = 'record.amount';

update public.access_blocks set live = true
 where key in (
   'calendar.create', 'calendar.move', 'calendar.events',
   'calendar.day_labels', 'calendar.schedule', 'record.label', 'record.team'
 );

-- Команду и мастера видят всегда: без неё запись не понять. Меняет — по праву.
update public.access_blocks
   set levels = array['read', 'write']
 where key = 'record.team';

-- «Время записи» — это перенос: одна строка на странице прав, а не две.
update public.access_blocks set live = false where key = 'record.when';

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  ('calendar.cancel', 'calendar', 'calendar', array['off', 'write'], 'Отменять и удалять записи', false, true, '{}', 28),
  ('record.color', 'calendar', 'calendar', array['off', 'write'], 'Цвет записи', false, true, '{}', 37)
on conflict (key) do update
  set levels = excluded.levels, title_ru = excluded.title_ru, live = excluded.live,
      area = excluded.area, scope = excluded.scope, position = excluded.position;

update public.access_blocks
   set enforced_by = array[
     'function:public.member_appointment_update(uuid, jsonb)',
     'function:public.member_appointment_create(jsonb)'
   ]
 where key in ('record.client', 'record.object', 'record.amount', 'record.label',
               'record.team', 'record.color', 'calendar.move');
update public.access_blocks
   set enforced_by = array['function:public.member_appointment_create(jsonb)']
 where key = 'calendar.create';
update public.access_blocks
   set enforced_by = array[
     'function:public.member_appointment_update(uuid, jsonb)',
     'function:public.member_appointment_delete(uuid)'
   ]
 where key = 'calendar.cancel';
update public.access_blocks
   set enforced_by = array[
     'function:public.list_master_appointments_safe(integer, integer)',
     'function:public.member_appointment_create(jsonb)',
     'function:public.member_appointment_update(uuid, jsonb)',
     'function:public.member_appointment_delete(uuid)'
   ]
 where key = 'calendar.events';
update public.access_blocks
   set enforced_by = array['policy:public.day_cities.day_cities_select_access',
                           'policy:public.day_cities.day_cities_write_access']
 where key = 'calendar.day_labels';
update public.access_blocks
   set enforced_by = array['policy:public.team_schedules.team_schedules_select_access',
                           'policy:public.team_schedules.team_schedules_write_access']
 where key = 'calendar.schedule';
update public.access_blocks
   set enforced_by = array[
     'function:public.update_master_appointment_safe(uuid, jsonb)',
     'function:public.member_appointment_update(uuid, jsonb)'
   ]
 where key = 'record.status';

-- ─── 6. Засев: видимое до миграции не пропадает ───────────────────────────
insert into public.member_access (tenant_id, user_id, team_id, block, level)
select mc.tenant_id, mc.user_id, mc.team_id, b.block, 'read'
  from public.member_calendars mc
  join public.tenant_members tm on tm.tenant_id = mc.tenant_id and tm.user_id = mc.user_id
  cross join (values ('calendar.events'), ('calendar.day_labels'), ('calendar.schedule')) b(block)
 where tm.role <> 'owner'
on conflict do nothing;

-- ─── 3. Сторож колонок мастера ────────────────────────────────────────────
create or replace function public.appointments_master_column_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if public.current_user_role() is distinct from 'master' then
    return new;
  end if;
  -- Правка уже проверена дверью сотрудника поле за полем
  -- (`member_appointment_update`). Флага одного мало: `set_config` доступен
  -- любому, кто пишет SQL. Поэтому пропуск ещё и требует, чтобы запись шла
  -- изнутри definer-функции, а не от роли `authenticated`.
  if current_setting('babun.member_write', true) = 'on'
     and current_user <> 'authenticated' then
    return new;
  end if;

  if old.kind = 'work' then
    if new.id is distinct from old.id
      or new.tenant_id is distinct from old.tenant_id
      or new.client_id is distinct from old.client_id
      or new.team_id is distinct from old.team_id
      or new.master_id is distinct from old.master_id
      or new.location_id is distinct from old.location_id
      or new.date is distinct from old.date
      or new.time_start is distinct from old.time_start
      or new.time_end is distinct from old.time_end
      or new.kind is distinct from old.kind
      or new.total_amount is distinct from old.total_amount
      or new.custom_total is distinct from old.custom_total
      or new.discount_amount is distinct from old.discount_amount
      or new.prepaid_amount is distinct from old.prepaid_amount
      or new.paid_amount is distinct from old.paid_amount
      or new.payment_status is distinct from old.payment_status
      or new.payment_method is distinct from old.payment_method
      or new.address is distinct from old.address
      or new.address_note is distinct from old.address_note
      or new.address_lat is distinct from old.address_lat
      or new.address_lng is distinct from old.address_lng
      or new.cancel_reason is distinct from old.cancel_reason
      or new.source is distinct from old.source
      or new.is_online_booking is distinct from old.is_online_booking
      or new.consent_given is distinct from old.consent_given
      or new.color_override is distinct from old.color_override
      or new.reminder_enabled is distinct from old.reminder_enabled
      or new.reminder_offsets is distinct from old.reminder_offsets
      or new.reminder_template is distinct from old.reminder_template
      or new.service_ids is distinct from old.service_ids
      or new.services is distinct from old.services
      or new.service_price_overrides is distinct from old.service_price_overrides
      or new.expenses is distinct from old.expenses
      or new.payments is distinct from old.payments
      or new.payment is distinct from old.payment
      or new.global_discount is distinct from old.global_discount
      or new.total_duration is distinct from old.total_duration
      or new.event_all_day is distinct from old.event_all_day
      or new.event_notes is distinct from old.event_notes
      or new.event_url is distinct from old.event_url
      or new.event_push_enabled is distinct from old.event_push_enabled
      or new.event_push_offsets is distinct from old.event_push_offsets
      or new.event_push_at is distinct from old.event_push_at
      or new.event_repeat is distinct from old.event_repeat
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.updated_at is distinct from old.updated_at then
      raise exception 'master role can only update status and comment on work appointments'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.kind in ('event', 'personal') then
    if old.created_by is distinct from auth.uid()
      or new.id is distinct from old.id
      or new.tenant_id is distinct from old.tenant_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.kind is distinct from old.kind
      or new.client_id is distinct from old.client_id
      or new.team_id is distinct from old.team_id
      or new.master_id is distinct from old.master_id
      or new.location_id is distinct from old.location_id
      or new.total_amount is distinct from old.total_amount
      or new.custom_total is distinct from old.custom_total
      or new.discount_amount is distinct from old.discount_amount
      or new.prepaid_amount is distinct from old.prepaid_amount
      or new.paid_amount is distinct from old.paid_amount
      or new.payment_status is distinct from old.payment_status
      or new.payment_method is distinct from old.payment_method
      or new.service_ids is distinct from old.service_ids
      or new.services is distinct from old.services
      or new.service_price_overrides is distinct from old.service_price_overrides
      or new.expenses is distinct from old.expenses
      or new.payments is distinct from old.payments
      or new.payment is distinct from old.payment
      or new.global_discount is distinct from old.global_discount
      or new.source is distinct from old.source
      or new.is_online_booking is distinct from old.is_online_booking
      or new.consent_given is distinct from old.consent_given
      or new.reminder_enabled is distinct from old.reminder_enabled
      or new.reminder_offsets is distinct from old.reminder_offsets
      or new.reminder_template is distinct from old.reminder_template then
      raise exception 'master role cannot change assignment, client or finance fields on a personal event'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'unsupported appointment kind for master role'
    using errcode = '42501';
end;
$function$;

-- ─── 2. Двери сотрудника ──────────────────────────────────────────────────

/** Может ли вызывающий положение `p_min` блока `p_block` в календаре. */
create or replace function public.member_can(p_block text, p_min text, p_team text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p_team is not null and p_team = any(public.access_calendars(p_block, p_min));
$function$;

/** Прикреплён ли вызывающий к календарю и видит ли его записи. «Календарь и
 *  записи» не живой блок (он засевается «Видит» при прикреплении), поэтому
 *  `access_calendars` о нём молчит — уровень читает `access_records_level`. */
create or replace function public.member_sees_calendar(p_team text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p_team is not null
     and exists (
       select 1 from public.member_calendars mc
        where mc.tenant_id = public.current_tenant_id()
          and mc.user_id = auth.uid()
          and mc.team_id = p_team
     )
     and public.access_records_level(public.current_tenant_id(), auth.uid(), p_team) in ('read', 'write');
$function$;

/** Проверка ОДНОГО поля правки сотрудника. Бросает 42501 с именем поля. */
create or replace function public.member_check_appointment_field(
  p_key text,
  p_value jsonb,
  p_kind text,
  p_team text,
  p_created_by uuid,
  p_old_status text
)
 returns void
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_block text;
  v_ok boolean;
begin
  -- СОБЫТИЯ: своё событие правит автор при «События: Меняет» — всё, кроме
  -- денег, клиента и назначения.
  if p_kind in ('event', 'personal') then
    if p_created_by is distinct from auth.uid()
       or not public.member_can('calendar.events', 'write', p_team) then
      raise exception 'access:block:calendar.events' using errcode = '42501';
    end if;
    if p_key not in ('date', 'time_start', 'time_end', 'total_duration', 'status', 'comment',
                     'color_override', 'city', 'event_all_day', 'event_notes', 'event_url',
                     'event_push_enabled', 'event_push_offsets', 'event_push_at', 'event_repeat',
                     'cancel_reason', 'address', 'address_note', 'address_lat', 'address_lng') then
      raise exception 'access:field:%', p_key using errcode = '42501';
    end if;
    return;
  end if;

  v_block := case
    when p_key in ('date', 'time_start', 'time_end', 'total_duration') then 'calendar.move'
    when p_key = 'comment' then 'record.status'
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
  v_ok := public.member_can(v_block, 'write', p_team);
  if not v_ok then
    raise exception 'access:block:%', v_block using errcode = '42501';
  end if;
end;
$function$;

create or replace function public.member_appointment_update(p_appointment_id uuid, p_patch jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  a public.appointments%rowtype;
  r public.appointments%rowtype;
  k text;
  v_new_team text;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this appointment update' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'appointment patch must be a non-empty object' using errcode = '22023';
  end if;

  select * into a
    from public.appointments x
   where x.id = p_appointment_id
     and x.tenant_id = public.current_tenant_id()
   for update;
  if not found
     or a.team_id is null
     or not public.member_sees_calendar(a.team_id) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;

  for k in select jsonb_object_keys(p_patch) loop
    perform public.member_check_appointment_field(
      k, p_patch -> k, a.kind, a.team_id, a.created_by, a.status
    );
  end loop;

  if p_patch ? 'status'
     and (p_patch ->> 'status') not in ('scheduled', 'in_progress', 'completed', 'cancelled') then
    raise exception 'unsupported appointment status' using errcode = '22023';
  end if;

  -- Перевод в другой календарь: «Команда и мастер: Меняет» и в новом.
  if p_patch ? 'team_id' then
    v_new_team := p_patch ->> 'team_id';
    if not public.member_can('record.team', 'write', v_new_team) then
      raise exception 'access:block:record.team' using errcode = '42501';
    end if;
  end if;

  -- Клиент — только тот, кого человек и так видит.
  if p_patch ? 'client_id' and jsonb_typeof(p_patch -> 'client_id') <> 'null' then
    if not public.current_user_can_access_client((p_patch ->> 'client_id')::uuid)
       and not ((p_patch ->> 'client_id')::uuid = any(public.access_client_ids())) then
      raise exception 'access:client' using errcode = '42501';
    end if;
  end if;

  r := jsonb_populate_record(a, p_patch);

  perform set_config('babun.member_write', 'on', true);
  update public.appointments x
     set team_id = r.team_id,
         master_id = r.master_id,
         client_id = r.client_id,
         location_id = r.location_id,
         date = r.date,
         time_start = r.time_start,
         time_end = r.time_end,
         total_duration = r.total_duration,
         status = r.status,
         comment = r.comment,
         cancel_reason = r.cancel_reason,
         address = r.address,
         address_note = r.address_note,
         address_lat = r.address_lat,
         address_lng = r.address_lng,
         services = r.services,
         service_ids = r.service_ids,
         total_amount = r.total_amount,
         custom_total = r.custom_total,
         discount_amount = r.discount_amount,
         global_discount = r.global_discount,
         service_price_overrides = r.service_price_overrides,
         vat_mode = r.vat_mode,
         vat_rate = r.vat_rate,
         city = r.city,
         color_override = r.color_override,
         event_all_day = r.event_all_day,
         event_notes = r.event_notes,
         event_url = r.event_url,
         event_push_enabled = r.event_push_enabled,
         event_push_offsets = r.event_push_offsets,
         event_push_at = r.event_push_at,
         event_repeat = r.event_repeat
   where x.id = a.id;
  perform set_config('babun.member_write', 'off', true);

  return jsonb_build_object('id', a.id);
end;
$function$;

create or replace function public.member_appointment_create(p_row jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_kind text := coalesce(p_row ->> 'kind', 'work');
  v_team text := p_row ->> 'team_id';
  v_id uuid;
  v_rest jsonb;
  k text;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this appointment create' using errcode = '42501';
  end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception 'appointment row must be an object' using errcode = '22023';
  end if;
  if v_kind not in ('work', 'event') then
    raise exception 'unsupported appointment kind' using errcode = '22023';
  end if;
  if v_team is null or (p_row ->> 'date') is null
     or (p_row ->> 'time_start') is null or (p_row ->> 'time_end') is null then
    raise exception 'team, date and time are required' using errcode = '22023';
  end if;
  if v_kind = 'work' and not public.member_can('calendar.create', 'write', v_team) then
    raise exception 'access:block:calendar.create' using errcode = '42501';
  end if;
  if v_kind = 'event' and not public.member_can('calendar.events', 'write', v_team) then
    raise exception 'access:block:calendar.events' using errcode = '42501';
  end if;

  v_id := coalesce(nullif(p_row ->> 'id', '')::uuid, gen_random_uuid());
  -- Остальные поля — той же проверкой, что правка: создать запись с клиентом
  -- можно только при «Клиент: Меняет» и т. д.
  v_rest := p_row - array['id', 'kind', 'team_id', 'date', 'time_start', 'time_end',
                          'total_duration', 'status', 'tenant_id', 'created_by'];
  for k in select jsonb_object_keys(v_rest) loop
    perform public.member_check_appointment_field(
      k, v_rest -> k, v_kind, v_team, auth.uid(), 'scheduled'
    );
  end loop;
  if v_rest ? 'client_id' and jsonb_typeof(v_rest -> 'client_id') <> 'null' then
    if not public.current_user_can_access_client((v_rest ->> 'client_id')::uuid)
       and not ((v_rest ->> 'client_id')::uuid = any(public.access_client_ids())) then
      raise exception 'access:client' using errcode = '42501';
    end if;
  end if;

  insert into public.appointments (id, tenant_id, team_id, kind, date, time_start, time_end,
                                   total_duration, status, created_by)
  values (v_id, public.current_tenant_id(), v_team, v_kind, p_row ->> 'date',
          p_row ->> 'time_start', p_row ->> 'time_end',
          coalesce(
            nullif(p_row ->> 'total_duration', '')::integer,
            greatest(0, (extract(epoch from ((p_row ->> 'time_end')::time
                                             - (p_row ->> 'time_start')::time)) / 60)::integer)
          ),
          'scheduled', auth.uid());

  if v_rest <> '{}'::jsonb then
    perform set_config('babun.member_write', 'on', true);
    update public.appointments x
       set (client_id, location_id, comment, address, address_note, address_lat, address_lng,
            services, service_ids, total_amount, custom_total, discount_amount, global_discount,
            service_price_overrides, vat_mode, vat_rate, city, color_override, master_id,
            event_all_day, event_notes, event_url, event_push_enabled, event_push_offsets,
            event_push_at, event_repeat)
         = (select r.client_id, r.location_id, r.comment, r.address, r.address_note, r.address_lat,
                   r.address_lng, r.services, r.service_ids, r.total_amount, r.custom_total,
                   r.discount_amount, r.global_discount, r.service_price_overrides, r.vat_mode,
                   r.vat_rate, r.city, r.color_override, r.master_id, r.event_all_day,
                   r.event_notes, r.event_url, r.event_push_enabled, r.event_push_offsets,
                   r.event_push_at, r.event_repeat
              from jsonb_populate_record(x, v_rest) r)
     where x.id = v_id;
    perform set_config('babun.member_write', 'off', true);
  end if;

  return jsonb_build_object('id', v_id);
end;
$function$;

create or replace function public.member_appointment_delete(p_appointment_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  a public.appointments%rowtype;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this appointment delete' using errcode = '42501';
  end if;
  select * into a
    from public.appointments x
   where x.id = p_appointment_id
     and x.tenant_id = public.current_tenant_id()
   for update;
  if not found or a.team_id is null then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;
  if a.kind = 'work' then
    if not public.member_can('calendar.cancel', 'write', a.team_id) then
      raise exception 'access:block:calendar.cancel' using errcode = '42501';
    end if;
  else
    if a.created_by is distinct from auth.uid()
       or not public.member_can('calendar.events', 'write', a.team_id) then
      raise exception 'access:block:calendar.events' using errcode = '42501';
    end if;
  end if;
  delete from public.appointments x where x.id = a.id;
end;
$function$;

revoke all on function public.member_can(text, text, text) from public, anon, authenticated;
revoke all on function public.member_sees_calendar(text) from public, anon, authenticated;
revoke all on function public.member_check_appointment_field(text, jsonb, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.member_appointment_update(uuid, jsonb) from public, anon;
revoke all on function public.member_appointment_create(jsonb) from public, anon;
revoke all on function public.member_appointment_delete(uuid) from public, anon;
grant execute on function public.member_appointment_update(uuid, jsonb) to authenticated;
grant execute on function public.member_appointment_create(jsonb) to authenticated;
grant execute on function public.member_appointment_delete(uuid) to authenticated;


-- ─── 5. События в окне мастера — по «События: Видит» ──────────────────────
-- Тело переписано со снятого `pg_proc.prosrc` (память: `create or replace`
-- и умолчания), изменены ровно две строки: `event_teams` и условие событий.
create or replace function public.list_master_appointments_safe(p_offset integer default 0, p_limit integer default 1000)
 returns setof jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
           public.access_calendars('calendar.events', 'read') as event_teams
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

-- ─── 4. Метки дня и график — по блокам ────────────────────────────────────
drop policy if exists day_cities_write_operator on public.day_cities;
drop policy if exists day_cities_select_role_scoped on public.day_cities;
create policy day_cities_select_access on public.day_cities
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (select unnest(public.access_calendars('calendar.day_labels', 'read')))
    )
  );
create policy day_cities_write_access on public.day_cities
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (select unnest(public.access_calendars('calendar.day_labels', 'write')))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (select unnest(public.access_calendars('calendar.day_labels', 'write')))
    )
  );

drop policy if exists team_schedules_write_owner on public.team_schedules;
drop policy if exists team_schedules_select_role_scoped on public.team_schedules;
create policy team_schedules_select_access on public.team_schedules
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (select unnest(public.access_calendars('calendar.schedule', 'read')))
    )
  );
create policy team_schedules_write_access on public.team_schedules
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (select unnest(public.access_calendars('calendar.schedule', 'write')))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (select unnest(public.access_calendars('calendar.schedule', 'write')))
    )
  );

-- ─── Сторож ──────────────────────────────────────────────────────────────
do $audit$
declare
  fn text;
begin
  foreach fn in array array[
    'public.member_appointment_update(uuid, jsonb)',
    'public.member_appointment_create(jsonb)',
    'public.member_appointment_delete(uuid)'
  ] loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception '% is callable by anon', fn;
    end if;
  end loop;
  foreach fn in array array[
    'public.member_can(text, text, text)',
    'public.member_sees_calendar(text)',
    'public.member_check_appointment_field(text, jsonb, text, text, uuid, text)'
  ] loop
    if has_function_privilege('authenticated', fn, 'execute') then
      raise exception '% must stay internal', fn;
    end if;
  end loop;
  if exists (
    select 1 from public.access_blocks
     where live and not owner_only and cardinality(enforced_by) = 0
  ) then
    raise exception 'a live block has no enforcement point';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename in ('day_cities', 'team_schedules')
       and coalesce(qual, '') || coalesce(with_check, '') ilike '%dispatcher%'
  ) then
    raise exception 'day labels or schedule still read the dispatcher role';
  end if;
end
$audit$;
