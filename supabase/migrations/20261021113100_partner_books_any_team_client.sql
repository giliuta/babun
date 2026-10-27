-- ПАРТНЁР ЗАПИСЫВАЕТ КЛИЕНТА ЛЮБОЙ КОМАНДЫ КОМПАНИИ.
--
-- Правило продукта: партнёр с «Новыми записями» в команде записи может
-- поставить в свою запись клиента другой команды той же компании. Прежде
-- сервер пускал только клиента ЭТОЙ команды (`member_client_in_team`), а выбор
-- клиента в приложении показывал партнёру клиентов всех его команд: тап по
-- клиенту другой команды кончался отказом `access:client`.
--
-- Что меняется и почему:
-- 1. `member_client_bookable` — клиент годится для записи, если он живой
--    клиент активной компании. Команда клиента роли не играет. Право на саму
--    запись проверяют вызывающие (`calendar.create`, `record.client`).
-- 2. `member_appointment_create`, `member_appointment_update` и
--    `member_appointment_copy` спрашивают его вместо `member_client_in_team`:
--    копия несёт клиента той записи, которую партнёр видит, и записать его
--    он и так вправе. Копия давней записи давнего клиента не вернёт: запись
--    старше окна «Ограничения» он не видит и не копирует
--    (`member_record_hidden`). SMS из записи остаётся на
--    `member_client_in_team`: SMS — это номер клиента, а не запись.
-- 3. `list_master_clients_safe` отдаёт клиента записи, которую партнёр сам
--    завёл, — иначе имя клиента другой команды на его же будущей записи
--    пустое. Окно «Ограничения» записей соблюдается. Номер — прежним правилом
--    («Клиент» и «В день записи»): база и контакты не расширяются.
-- 4. `member_find_client_by_phone` — «Номер уже есть» для партнёра при
--    заведении клиента из записи. UNIQUE-индекс номера держит компания
--    целиком, а партнёр видит лишь часть базы: без этой двери он упирался в
--    23505 без выхода. Дверь отвечает только тому, у кого в команде записи
--    есть «Новые записи», только на полный номер и только именем: номер
--    партнёр набрал сам, остальные контакты — по его правам.
--
-- Не расширяется: чтение записей других команд, деньги, правка клиента
-- (`update_client_with_tags` / `current_user_can_edit_client`) и база
-- клиентов (`access_client_ids_in`, `list_member_clients`).

-- 1. Годится ли клиент для записи партнёра. Вызывается только из функций
--    записи, поэтому у `authenticated` права нет.
create or replace function public.member_client_bookable(p_client uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p_client is not null
     and exists (
       select 1
         from public.clients c
        where c.id = p_client
          and c.tenant_id = public.current_tenant_id()
          and c.deleted_at is null
     );
$function$;

revoke all on function public.member_client_bookable(uuid) from public, anon, authenticated;

-- 2a. Новая запись партнёра.
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
  -- НОВАЯ ЗАПИСЬ — ЦЕЛИКОМ ЕГО. «Новые записи: Может» значит: клиента,
  -- объект, услуги, метку, цвет и заметку своей новой записи сотрудник
  -- выбирает сам — запись клиента без клиента не бывает. Блоки записи решают
  -- ПРАВКУ созданной, а не её рождение. Незнакомое поле по-прежнему не
  -- принимается; клиент — любой живой клиент компании (ниже).
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
    elsif k in ('comment', 'color_override', 'event_notes', 'event_url') then
      -- НОВОЕ СОБЫТИЕ — ЕГО: название, цвет и заметку своего нового события
      -- задаёт автор, как у новой рабочей записи; блоки события решают
      -- правку созданного.
      null;
    else
      perform public.member_check_appointment_field(
        k, v_rest -> k, v_kind, v_team, auth.uid(), 'scheduled'
      );
    end if;
  end loop;
  -- Клиент — любой живой клиент компании, в том числе другой команды:
  -- партнёр с «Новыми записями» в команде записи вправе записать его сюда.
  -- Видимость базы это не расширяет (`member_client_bookable`).
  if v_rest ? 'client_id' and jsonb_typeof(v_rest -> 'client_id') <> 'null' then
    if not public.member_client_bookable((v_rest ->> 'client_id')::uuid) then
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

-- 2b. Правка записи партнёром: смена клиента — тем же правилом, что новая
--     запись.
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
  -- «Ограничения» записей: работу старше окна он не видит и не правит.
  if public.member_record_hidden(a.kind, a.team_id, a.date) then
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

  -- ОТМЕНА ЗАПИСИ С ДЕНЬГАМИ — ЭТО ВОЗВРАТ: сверка финансов на отмене пишет
  -- возврат всех денег записи. Без права «Оплата в записи: Меняет» отмена
  -- такой записи не проходит.
  if p_patch ? 'status'
     and (p_patch ->> 'status') = 'cancelled'
     and a.status is distinct from 'cancelled'
     and (
       coalesce(a.prepaid_amount, 0) > 0
       or coalesce(a.paid_amount, 0) > 0
       or a.payment_status in ('paid', 'partial')
       or exists (
         select 1 from public.finance_transactions t
          where t.appointment_id = a.id and t.tenant_id = a.tenant_id and t.type = 'income'
       )
     )
     and public.member_can('record.payment', 'write', a.team_id) is not true then
    raise exception 'access:block:record.payment' using errcode = '42501';
  end if;

  -- Запись не уходит из своей команды: ни в его, ни в другую команду.
  if p_patch ? 'team_id' then
    v_new_team := p_patch ->> 'team_id';
    if v_new_team is distinct from a.team_id then
      raise exception 'access:team_move' using errcode = '42501';
    end if;
  end if;

  -- Клиент — любой живой клиент компании, как у новой записи. Проверяется
  -- только СМЕНА клиента: давняя запись с тем же клиентом правится как раньше.
  if p_patch ? 'client_id' and jsonb_typeof(p_patch -> 'client_id') <> 'null'
     and (p_patch ->> 'client_id')::uuid is distinct from a.client_id then
    if not public.member_client_bookable((p_patch ->> 'client_id')::uuid) then
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

-- 2c. Копия записи партнёром: клиент копии — тем же правилом, что новая
--     запись.
CREATE OR REPLACE FUNCTION public.member_appointment_copy(p_source uuid, p_date text, p_time_start text, p_time_end text, p_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.appointments%rowtype;
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this appointment copy' using errcode = '42501';
  end if;
  if p_source is null or p_date is null or p_time_start is null or p_time_end is null then
    raise exception 'source, date and time are required' using errcode = '22023';
  end if;

  -- ПОВТОР ПОСЛЕ ПОТЕРЯННОГО ОТВЕТА: копия с этим номером уже встала — её же
  -- и возвращаем. Только свою и только в своей компании: чужой номер так не
  -- подсмотреть (ответ — тот же номер, что и прислан).
  if p_id is not null and exists (
       select 1 from public.appointments x
        where x.id = p_id
          and x.tenant_id = public.current_tenant_id()
          and x.created_by = auth.uid()
     ) then
    return jsonb_build_object('id', p_id);
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
  -- «Ограничения» записей: старую работу он не видит и не копирует.
  if public.member_record_hidden(s.kind, s.team_id, s.date) then
    raise exception 'appointment not found or not in your calendars' using errcode = 'P0002';
  end if;
  -- «Перенос записей: Может» — всё меню записи, копия в том числе.
  if not public.member_can('calendar.move', 'write', s.team_id) then
    raise exception 'access:block:calendar.move' using errcode = '42501';
  end if;
  -- Клиент копии — любой живой клиент компании, как у новой записи: клиента
  -- другой команды партнёр вправе записать и сам. Давнюю запись он не
  -- копирует вовсе (окно «Ограничения» выше).
  if s.client_id is not null and not public.member_client_bookable(s.client_id) then
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

-- 3. Клиенты записей партнёра: и клиент записи, которую он сам завёл.
CREATE OR REPLACE FUNCTION public.list_master_clients_safe(p_client_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with client_teams as (
    select public.access_calendars('record.client', 'read') as ids
  ),
  contact_sets as (
    select public.access_contact_client_ids() || public.access_day_contact_client_ids() as open_ids,
           public.access_client_ids_in(public.access_day_contact_teams()) as day_ids,
           public.access_client_ids() as visible_ids,
           public.tenant_business_date(public.current_tenant_id()) as today,
           public.member_record_window_starts() as window_starts
  )
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'full_name', c.full_name,
    -- Номер открыт сразу, когда блок «Клиент» он видит; иначе пусто.
    'phone', case when c.id = any(cs.open_ids) then c.phone else '' end,
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
     -- Клиент записи, которую он видит: из видимой записи карточка
     -- открывается всегда.
     and exists (
       select 1
         from public.appointments a
        where a.tenant_id = c.tenant_id
          and a.client_id = c.id
          and a.kind = 'work'
          and a.team_id = any(ct.ids)
     )
     -- «Около записи» (защита базы): имя клиента мастер видит, пока клиент в
     -- окне записи этой команды, либо если клиент открыт ему правом «Клиенты»
     -- (набор `access_client_ids`), либо он завёл его сам, либо это клиент
     -- записи, которую он сам завёл, — так же, как клиент записи в
     -- `list_master_appointments_safe`. Иначе клиент другой команды на его же
     -- записи через неделю стоял бы без имени. Прошедшая запись старше окна
     -- «Ограничения» имени не открывает.
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
       or exists (
         select 1
           from public.appointments a
          where a.tenant_id = c.tenant_id
            and a.client_id = c.id
            and a.kind = 'work'
            and a.team_id = any(ct.ids)
            and a.created_by = auth.uid()
            and a.date >= coalesce(cs.window_starts ->> a.team_id, '')
       )
     )
   order by c.full_name, c.id
$function$;

-- 4. «Номер уже есть» для партнёра: существующий клиент по полному номеру.
create or replace function public.member_find_client_by_phone(p_phone_e164 text, p_team text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  caller_role text := public.current_user_role();
  hit public.clients%rowtype;
  is_open boolean;
  is_day boolean;
begin
  if auth.uid() is null or active_tenant is null or caller_role is null then
    raise exception 'нет членства в компании'
      using errcode = '42501', hint = 'access:not_member';
  end if;
  -- Только тому, кто сейчас заводит клиента для записи этой команды.
  if public.member_can('calendar.create', 'write', p_team) is not true then
    raise exception 'access:block:calendar.create' using errcode = '42501';
  end if;
  -- Только полный канонический номер: по куску номера базу не перебрать.
  if p_phone_e164 is null or p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' then
    return null;
  end if;

  select c.* into hit
    from public.clients c
   where c.tenant_id = active_tenant
     and c.phone_e164 = p_phone_e164
     and c.deleted_at is null
   order by c.created_at, c.id
   limit 1;
  if not found then
    return null;
  end if;

  -- Номер и причина его скрытия — тем же правилом, что строка клиента
  -- записи (`list_master_clients_safe`): «Клиент» и «В день записи».
  is_open := caller_role = 'owner'
    or hit.id = any(public.access_contact_client_ids() || public.access_day_contact_client_ids());
  is_day := not is_open
    and hit.id = any(public.access_client_ids_in(public.access_day_contact_teams()));

  return jsonb_build_object(
    'id', hit.id,
    'tenant_id', hit.tenant_id,
    'full_name', hit.full_name,
    'phone', case when is_open then hit.phone else '' end,
    'created_at', hit.created_at,
    'contacts_hidden', case
      when is_open then null
      when is_day then 'day'
      else 'right'
    end
  );
end;
$function$;

revoke all on function public.member_find_client_by_phone(text, text) from public, anon;
grant execute on function public.member_find_client_by_phone(text, text) to authenticated;

-- СТОРОЖ: правило клиента сменилось у создания, правки и копии записи; SMS
-- осталось на `member_client_in_team`; новые функции закрыты от анонима.
do $guard$
declare
  src text;
begin
  select prosrc into src from pg_proc where oid = 'public.member_appointment_create(jsonb)'::regprocedure;
  if src like '%member_client_in_team%' or src not like '%member_client_bookable((v_rest ->> ''client_id'')::uuid)%' then
    raise exception 'guard: member_appointment_create не перешла на member_client_bookable';
  end if;

  select prosrc into src from pg_proc where oid = 'public.member_appointment_update(uuid,jsonb)'::regprocedure;
  if src like '%member_client_in_team%' or src not like '%member_client_bookable((p_patch ->> ''client_id'')::uuid)%' then
    raise exception 'guard: member_appointment_update не перешла на member_client_bookable';
  end if;

  select prosrc into src from pg_proc where oid = 'public.member_appointment_copy(uuid,text,text,text,uuid)'::regprocedure;
  if src like '%member_client_in_team%' or src not like '%member_client_bookable(s.client_id)%'
     or src not like '%member_record_hidden(s.kind, s.team_id, s.date)%'
     or src not like '%member_can(''calendar.move'', ''write'', s.team_id)%' then
    raise exception 'guard: member_appointment_copy не перешла на member_client_bookable';
  end if;

  select prosrc into src from pg_proc where oid = 'public.sms_send_manual'::regproc;
  if src not like '%member_client_in_team%' then
    raise exception 'guard: SMS из записи потеряло проверку клиента команды';
  end if;

  select prosrc into src from pg_proc where oid = 'public.list_master_clients_safe(uuid)'::regprocedure;
  if src not like '%and a.created_by = auth.uid()%'
     or src not like '%a.date >= coalesce(cs.window_starts ->> a.team_id, '''')%' then
    raise exception 'guard: list_master_clients_safe не отдаёт клиента своей записи в окне';
  end if;

  if has_function_privilege('anon', 'public.member_client_bookable(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.member_client_bookable(uuid)', 'execute') then
    raise exception 'guard: member_client_bookable исполним снаружи';
  end if;
  if has_function_privilege('anon', 'public.member_find_client_by_phone(text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.member_find_client_by_phone(text,text)', 'execute') then
    raise exception 'guard: права member_find_client_by_phone не те';
  end if;
  if not has_function_privilege('authenticated', 'public.member_appointment_create(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.member_appointment_update(uuid,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.member_appointment_copy(uuid,text,text,text,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.list_master_clients_safe(uuid)', 'execute') then
    raise exception 'guard: переписанные функции потеряли право authenticated';
  end if;
end;
$guard$;
