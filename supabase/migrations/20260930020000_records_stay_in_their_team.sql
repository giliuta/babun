-- ЗАПИСЬ НЕ УХОДИТ ИЗ СВОЕЙ КОМАНДЫ (владелец 30.09: «если я передаю ему
-- команду номер один, он не может её копировать в свою команду… только в
-- этой команде; он не может выбирать свою команду или ту, с которой у него
-- другой доступ»).
--
-- До этой миграции сотрудник мог увести данные команды в другую свою команду
-- двумя дорогами:
--   • перевод записи: `member_appointment_update` пускал смену `team_id`, если
--     «Команда и мастер: Меняет» стояло и в старой, и в новой команде;
--   • копия как новая запись: `member_appointment_create` принимал клиента,
--     если тот виден сотруднику хоть в какой-то его команде.
-- Теперь:
--   1. смена команды записи сотрудником запрещена всегда (`access:team_move`);
--      мастера внутри команды «Команда и мастер: Меняет» по-прежнему меняет;
--   2. клиент новой записи и смена клиента — только клиент ЭТОЙ команды
--      (`member_client_in_team`: у клиента есть работа этой команды, или ему
--      открыта вся база этой команды, или клиента завёл сам сотрудник);
--   3. копия записи — своей дверью `member_appointment_copy`: копия встаёт в
--      ту же команду, что оригинал (команды в вызове нет вовсе), по праву
--      «Перенос записей» (владелец: «перенос — значит свободное перемещение,
--      перенести, копировать, цвет»). Копия делается на сервере с настоящей
--      записи: у сотрудника на телефоне скрытые поля приходят пустыми, и
--      копия с телефона вышла бы без клиента и с нулями вместо цен.
--
-- Тела `member_appointment_create` (md5 prosrc 18a87f1c…) и
-- `member_appointment_update` (618abca9…) сняты с боевой базы 30.09 и
-- изменены только в отмеченных местах.

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

revoke all on function public.member_client_in_team(uuid, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.member_appointment_create(p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- НОВАЯ ЗАПИСЬ — ЦЕЛИКОМ ЕГО (20260924170000). «Новые записи: Может»
  -- значит: клиента, объект, услуги, метку, цвет и заметку своей новой
  -- записи сотрудник выбирает сам — запись клиента без клиента не бывает.
  -- Блоки записи решают ПРАВКУ созданной, а не её рождение. Незнакомое поле
  -- по-прежнему не принимается, клиент — только тот, кого он и так видит.
  -- Событие — прежним правилом: «События: Меняет», поля своего события.
  v_rest := p_row - array['id', 'kind', 'team_id', 'date', 'time_start', 'time_end',
                          'total_duration', 'status', 'tenant_id', 'created_by'];
  for k in select jsonb_object_keys(v_rest) loop
    if v_kind = 'work' then
      if k not in ('comment', 'client_id', 'location_id', 'address', 'address_note',
                   'address_lat', 'address_lng', 'services', 'service_ids', 'total_amount',
                   'custom_total', 'discount_amount', 'global_discount',
                   'service_price_overrides', 'vat_mode', 'vat_rate', 'city',
                   'color_override', 'master_id') then
        raise exception 'access:field:%', k using errcode = '42501';
      end if;
    else
      perform public.member_check_appointment_field(
        k, v_rest -> k, v_kind, v_team, auth.uid(), 'scheduled'
      );
    end if;
  end loop;
  -- Клиент — только ЭТОЙ команды (30.09): клиент другой его команды сюда не
  -- встаёт (`member_client_in_team`).
  if v_rest ? 'client_id' and jsonb_typeof(v_rest -> 'client_id') <> 'null' then
    if not public.member_client_in_team((v_rest ->> 'client_id')::uuid, v_team) then
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
  if p_patch ? 'client_id' and jsonb_typeof(p_patch -> 'client_id') <> 'null' then
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

revoke all on function public.member_appointment_copy(uuid, text, text, text) from public, anon;
grant execute on function public.member_appointment_copy(uuid, text, text, text) to authenticated;

update public.access_blocks
   set enforced_by = enforced_by || array['function:public.member_appointment_copy(uuid, text, text, text)']
 where key = 'calendar.move'
   and not ('function:public.member_appointment_copy(uuid, text, text, text)' = any(enforced_by));
