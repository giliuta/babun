-- ЗАЩИТА БАЗЫ КЛИЕНТОВ: ОБХОДНЫЕ ДОРОГИ ЗАКРЫТЫ (аудит 30.09).
--
-- Владелец 30.09: «проверь самостоятельно, чтобы потом в будущем не было
-- каких-либо проблем или багов». Аудит сервера нашёл дороги, которыми данные
-- клиента уходили сотруднику мимо «номер по одному», «Около записи» и блоков
-- карточки. Каждая закрыта здесь; тела сняты с базы перед правкой и сверены
-- по md5 (sms_send_manual — с ЖИВОГО тела c923bcb5…: в файлах его версии нет).
--
--   1. sms_message_json — `to_phone` только владельцу: история SMS записи и
--      клиента отдавала номер получателя каждому, кто видит команду.
--   2. sms_for_client — сотруднику только о клиенте из его набора.
--   3. sms_send_manual — клиент по правилу команды (`member_client_in_team`),
--      выбор номера (`p_phone`) — только при открытом номере.
--   4. sms_appointment_link — ссылка записи (имя, адрес, услуги без входа)
--      только при «Клиент в записи».
--   5–6. Чеки: телефон клиента из снимка чека убран и больше туда не ложится
--      (триггер `receipts_client_snapshot_no_phone`). Его не читает никто —
--      приложение берёт из снимка только имя, бумага чека номер не печатает
--      (013, 30.09), — а политика `receipts_read_own_money` и повтор
--      `issue_receipt` отдавали его сотруднику пачкой. Видимость чеков прежняя.
--   7. member_client_in_team — давний клиент команды проходит только в окне
--      записи; всю историю даёт «Своей команды».
--   8. member_appointment_copy — копия давней записи не несёт клиента вне окна.
--   9. member_appointment_update — клиент проверяется только при СМЕНЕ.
--  10. list_master_clients_safe / list_master_appointments_safe — имя и адрес
--      клиента давней записи мастер видит, только если клиент открыт ему
--      правом «Клиенты», он завёл его сам или запись в окне.

create or replace function public.sms_message_json(m public.sms_messages, p_owner boolean)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', m.id,
    'created_at', m.created_at,
    'send_after', m.send_after,
    'status', m.status,
    'trigger', m.trigger_type,
    'appointment_id', m.appointment_id,
    'team_id', m.team_id,
    -- Номер получателя — только владельцу (защита базы 30.09): история SMS
    -- иначе вытягивала бы номера мимо двери «номер по одному».
    'to_phone', case when p_owner then m.to_phone else '' end,
    'body', m.message_body,
    'template_body', m.template_body,
    'segments', m.segments,
    'error', m.error_message,
    'cost_cents', case when p_owner then m.cost_cents else 0 end,
    'was_free', case when p_owner then m.was_free else false end
  )
$function$;

create or replace function public.sms_for_client(p_client_id uuid, p_limit integer default 50)
returns setof jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- Сотрудник — только о клиенте, которого видит (защита базы 30.09).
  if not is_owner and not (p_client_id = any(public.access_client_ids())) then
    return;
  end if;
  return query
  select public.sms_message_json(m, is_owner)
    from public.sms_messages m
   where m.tenant_id = v_tenant
     and m.client_id = p_client_id
     and (is_owner or (m.team_id is not null and public.sms_can_see_team(m.team_id)))
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$;

create or replace function public.sms_send_manual(
  p_appointment_id uuid,
  p_client_id uuid,
  p_body text,
  p_template_id text default null,
  p_team_id text default null,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
  a record;
  v_client uuid := p_client_id;
  v_team text := nullif(trim(coalesce(p_team_id, '')), '');
  c record;
  phone text;
  v_body text := trim(coalesce(p_body, ''));
  v_balance integer;
  v_id uuid;
  cap_member integer := coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_member_daily_cap'), 100);
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not public.sms_service_on() then
    raise exception 'sms:service_off' using errcode = 'P0001';
  end if;
  if public.sms_frozen(v_tenant) then
    raise exception 'sms:frozen' using errcode = 'P0001';
  end if;
  if length(v_body) = 0 or length(v_body) > 1000 then
    raise exception 'sms:body' using errcode = '22023';
  end if;
  if p_appointment_id is not null then
    select ap.client_id, ap.team_id into a
      from public.appointments ap
     where ap.id = p_appointment_id and ap.tenant_id = v_tenant;
    if not found or a.client_id is null then
      raise exception 'sms:appointment' using errcode = 'P0001';
    end if;
    v_client := a.client_id;
    v_team := a.team_id;
  end if;
  if v_team is null or v_client is null then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if not is_owner and not public.sms_can_see_team(v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- Клиент — только тот, кого сотрудник видит в этой команде (защита базы
  -- 30.09): иначе SMS уходило бы любому клиенту компании по его uuid.
  if not is_owner and not public.member_client_in_team(v_client, v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not is_owner and (
    select count(*) from public.sms_messages
     where sent_by = auth.uid() and created_at > now() - interval '1 day'
  ) >= cap_member then
    raise exception 'sms:limit' using errcode = 'P0001';
  end if;
  if public.sms_team_sender(v_tenant, v_team) is null then
    raise exception 'sms:sender' using errcode = 'P0001';
  end if;
  select cl.phone, cl.phone_e164, cl.sms_opt_out, cl.blacklisted, cl.deleted_at
    into c
    from public.clients cl
   where cl.id = v_client and cl.tenant_id = v_tenant;
  if not found or c.deleted_at is not null then
    raise exception 'sms:client' using errcode = 'P0001';
  end if;
  if c.sms_opt_out or coalesce(c.blacklisted, false) then
    raise exception 'sms:opt_out' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_phone, '')), '') is not null then
    -- Выбрать номер может только тот, кому номер открыт (30.09): иначе дверь
    -- служила бы проверкой угаданного номера.
    if not is_owner
       and not (v_client = any(public.access_contact_client_ids())
                or v_client = any(public.access_day_contact_client_ids())) then
      raise exception 'sms:phone' using errcode = 'P0001';
    end if;
    if not public.sms_client_owns_phone(v_client, p_phone) then
      raise exception 'sms:phone' using errcode = 'P0001';
    end if;
    phone := trim(p_phone);
  else
    phone := coalesce(nullif(trim(c.phone_e164), ''), nullif(trim(c.phone), ''));
  end if;
  if phone is null then
    raise exception 'sms:phone' using errcode = 'P0001';
  end if;
  if not public.sms_phone_allowed(phone) then
    raise exception 'sms:country' using errcode = 'P0001';
  end if;
  select balance_cents into v_balance from public.tenant_sms_config where tenant_id = v_tenant;
  if coalesce(v_balance, 0) < public.sms_price_cents() then
    raise exception 'sms:funds' using errcode = 'P0001';
  end if;
  insert into public.sms_messages (
    tenant_id, appointment_id, client_id, team_id, to_phone, message_body,
    trigger_type, template_id, status, mode, sent_by
  ) values (
    v_tenant, p_appointment_id, v_client, v_team, phone, v_body,
    'manual', nullif(p_template_id, ''), 'queued', 'platform', auth.uid()
  )
  returning sms_messages.id into v_id;
  perform public.sms_wake();
  return v_id;
end;
$function$;

create or replace function public.sms_appointment_link(p_appointment_id uuid)
returns text
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_team text;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  select team_id into v_team from public.appointments
   where id = p_appointment_id and tenant_id = v_tenant and kind = 'work';
  if not found or not public.sms_can_see_team(v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- Ссылка открывает без входа имя, адрес и услуги записи — сотруднику только
  -- там, где он сам видит клиента записи (защита базы 30.09).
  if public.current_user_role() is distinct from 'owner'
     and (v_team = any(public.access_calendars('record.client', 'read'))) is not true then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  return public.appointment_link_url(p_appointment_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.member_client_in_team(p_client uuid, p_team text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_client is not null
     and p_team is not null
     and (
       -- у клиента есть работа этой команды
       exists (
         select 1 from public.appointments a
          where a.tenant_id = public.current_tenant_id()
            and a.client_id = p_client
            and a.team_id = p_team
            and a.kind = 'work'
            -- «Около записи» (защита базы 30.09): давний клиент команды сюда
            -- не проходит — только запись в окне (день до, неделя после); всю
            -- историю команды даёт «Своей команды» (ветка ниже).
            and a.status is distinct from 'cancelled'
            and a.date between (public.tenant_business_date(public.current_tenant_id()) - 7)::text
                           and (public.tenant_business_date(public.current_tenant_id()) + 1)::text
       )
       -- или ему открыта база клиентов этой команды («Какие клиенты: Все»)
       or (
         p_team = any(public.access_calendars('clients', 'read'))
         and p_client = any(public.access_client_ids_in(array[p_team]))
       )
       -- или клиента завёл он сам
       or exists (
         select 1 from public.clients c
          where c.id = p_client
            and c.tenant_id = public.current_tenant_id()
            and c.created_by = auth.uid()
            and c.deleted_at is null
       )
     );
$function$;

CREATE OR REPLACE FUNCTION public.member_appointment_copy(p_source uuid, p_date text, p_time_start text, p_time_end text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.appointments%rowtype;
  v_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this appointment copy' using errcode = '42501';
  end if;
  if p_source is null or p_date is null or p_time_start is null or p_time_end is null then
    raise exception 'source, date and time are required' using errcode = '22023';
  end if;

  select * into s
    from public.appointments x
   where x.id = p_source
     and x.tenant_id = public.current_tenant_id();
  if not found
     or s.team_id is null
     or s.kind <> 'work'
     or not public.member_sees_calendar(s.team_id) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;
  -- «Перенос записей: Может» — всё меню записи, копия в том числе.
  if not public.member_can('calendar.move', 'write', s.team_id) then
    raise exception 'access:block:calendar.move' using errcode = '42501';
  end if;
  -- Клиента копия несёт, только если он виден человеку в этой команде (защита
  -- базы 30.09): копия давней записи на сегодня не возвращает давнего клиента
  -- в окно «Около записи».
  if s.client_id is not null and not public.member_client_in_team(s.client_id, s.team_id) then
    raise exception 'access:client' using errcode = '42501';
  end if;

  -- КОПИЯ — В ТУ ЖЕ КОМАНДУ: команды в вызове нет, она берётся у оригинала.
  -- Оплата, статус, отмена, фото и напоминания не копируются — как у копии
  -- владельца (`duplicateAppointment`).
  insert into public.appointments (id, tenant_id, team_id, kind, date, time_start, time_end,
                                   total_duration, status, created_by)
  values (v_id, s.tenant_id, s.team_id, 'work', p_date, p_time_start, p_time_end,
          greatest(0, (extract(epoch from (p_time_end::time - p_time_start::time)) / 60)::integer),
          'scheduled', auth.uid());

  perform set_config('babun.member_write', 'on', true);
  update public.appointments x
     set (client_id, location_id, comment, address, address_note, address_lat, address_lng,
          services, service_ids, total_amount, custom_total, discount_amount, global_discount,
          service_price_overrides, vat_mode, vat_rate, city, color_override, master_id)
       = (s.client_id, s.location_id, s.comment, s.address, s.address_note, s.address_lat,
          s.address_lng, s.services, s.service_ids, s.total_amount, s.custom_total,
          s.discount_amount, s.global_discount, s.service_price_overrides, s.vat_mode,
          s.vat_rate, s.city, s.color_override, s.master_id)
   where x.id = v_id;
  perform set_config('babun.member_write', 'off', true);

  return jsonb_build_object('id', v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.member_appointment_update(p_appointment_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Запись не уходит из своей команды (30.09): ни в его, ни в другую команду.
  if p_patch ? 'team_id' then
    v_new_team := p_patch ->> 'team_id';
    if v_new_team is distinct from a.team_id then
      raise exception 'access:team_move' using errcode = '42501';
    end if;
  end if;

  -- Клиент — только тот, кого человек видит в ЭТОЙ команде (30.09).
  -- Проверяется только СМЕНА клиента (30.09): окно «Около записи» не должно
  -- мешать править давнюю запись, где клиент тот же.
  if p_patch ? 'client_id' and jsonb_typeof(p_patch -> 'client_id') <> 'null'
     and (p_patch ->> 'client_id')::uuid is distinct from a.client_id then
    if not public.member_client_in_team((p_patch ->> 'client_id')::uuid, a.team_id) then
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

create or replace function public.list_master_clients_safe(p_client_id uuid default null::uuid)
 returns setof jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with client_teams as (
    select public.access_calendars('record.client', 'read') as ids
  ),
  contact_sets as (
    select public.access_contact_client_ids() || public.access_day_contact_client_ids() as open_ids,
           public.access_client_ids_in(public.access_day_contact_teams()) as day_ids,
           public.access_client_ids() as visible_ids,
           public.tenant_business_date(public.current_tenant_id()) as today
  )
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'full_name', c.full_name,
    -- Номер — только дверью `member_client_contacts`.
    'phone', '',
    'created_at', c.created_at,
    'contacts_hidden', case
      when c.id = any(cs.open_ids) then null
      when c.id = any(cs.day_ids) then 'day'
      else 'right'
    end
  )
    from public.clients c
   cross join client_teams ct
   cross join contact_sets cs
   where public.current_user_role() = 'master'
     and c.tenant_id = public.current_tenant_id()
     and c.deleted_at is null
     and (p_client_id is null or c.id = p_client_id)
     and public.current_user_can_access_client(c.id)
     and exists (
       select 1
         from public.appointments a
        where a.tenant_id = c.tenant_id
          and a.client_id = c.id
          and a.kind = 'work'
          and a.team_id = any(ct.ids)
     )
     -- «Около записи» (защита базы 30.09): имя клиента мастер видит, пока
     -- клиент в окне записи этой команды, либо если клиент открыт ему правом
     -- «Клиенты» (набор `access_client_ids`), либо он завёл его сам.
     and (
       c.id = any(cs.visible_ids)
       or c.created_by = auth.uid()
       or exists (
         select 1
           from public.appointments a
          where a.tenant_id = c.tenant_id
            and a.client_id = c.id
            and a.kind = 'work'
            and a.team_id = any(ct.ids)
            and a.status is distinct from 'cancelled'
            and a.date between (cs.today - 7)::text and (cs.today + 1)::text
       )
     )
   order by c.full_name, c.id
$function$;

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
           public.access_calendars('calendar.day_labels', 'read') as day_label_teams,
           -- «ОКОЛО ЗАПИСИ» (защита базы 30.09): клиент и адрес давней записи —
           -- только если клиент открыт правом «Клиенты» или завёл его он сам.
           public.access_client_ids()                        as visible_clients,
           public.tenant_business_date(public.current_tenant_id()) as today
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
        a.client_id is null
          or a.client_id = any(me.visible_clients)
          or a.created_by = auth.uid()
          or (a.status is distinct from 'cancelled'
              and a.date between (me.today - 7)::text and (me.today + 1)::text) as near_ok
    ) w
    cross join lateral (
      select
        coalesce(case when a.kind = 'work' then a.team_id = any(me.client_teams)
                      else a.team_id = any(me.ev_client_teams) end, false) and w.near_ok as see_client,
        coalesce(case when a.kind = 'work' then a.team_id = any(me.object_teams)
                      else a.team_id = any(me.ev_object_teams) end, false) and w.near_ok as see_object,
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

-- ЧЕК БЕЗ ТЕЛЕФОНА КЛИЕНТА (защита базы 30.09): снимок клиента в чеке —
-- только имя. Ложится ли номер из `_issue_receipt_core` или из правки — триггер
-- снимает его до записи; прежние строки вычищаются здесь же.
create or replace function public.receipts_client_snapshot_no_phone()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.client_snapshot is not null and jsonb_typeof(new.client_snapshot) = 'object' then
    new.client_snapshot := new.client_snapshot - 'phone';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_receipts_client_snapshot_no_phone on public.receipts;
create trigger trg_receipts_client_snapshot_no_phone
  before insert or update on public.receipts
  for each row execute function public.receipts_client_snapshot_no_phone();

revoke all on function public.receipts_client_snapshot_no_phone() from public, anon, authenticated;

update public.receipts
   set client_snapshot = client_snapshot - 'phone'
 where client_snapshot ? 'phone';
