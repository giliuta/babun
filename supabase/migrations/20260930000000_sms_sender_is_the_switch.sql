-- SMS, ВОЛНА 11 (STORY-089): ИМЯ ОТПРАВИТЕЛЯ И ЕСТЬ ВЫКЛЮЧАТЕЛЬ.
--
-- Владелец 29.09: «отправка через сервис — что это такое, удали вообще
-- блок». Выключатели «Отправлять через сервис» и «отправляет ли команда»
-- (`tenant_sms_config.enabled`, `team_ids`) больше никто не читает: команда
-- отправляет, когда у неё есть имя отправителя (`sms_team_senders`), и
-- пока хватает баланса. Снял имя — команда молчит.

create or replace function public.sms_enqueue(p_appointment uuid, p_template uuid, p_at timestamptz default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  tpl public.sms_team_templates%rowtype;
  c record;
  phone text;
  start_at timestamptz;
  send_at timestamptz;
  inserted uuid;
begin
  if not public.sms_service_on() then
    return false;
  end if;
  select ap.id, ap.tenant_id, ap.client_id, ap.team_id, ap.kind
    into a
    from public.appointments ap
   where ap.id = p_appointment;
  if not found or a.kind <> 'work' or a.client_id is null or a.team_id is null then
    return false;
  end if;
  select * into tpl from public.sms_team_templates
   where id = p_template and tenant_id = a.tenant_id and team_id = a.team_id and enabled;
  if not found or tpl.trigger = 'manual' then
    return false;
  end if;
  -- Имя отправителя и есть выключатель команды (волна 11).
  if public.sms_team_sender(a.tenant_id, a.team_id) is null then
    return false;
  end if;

  start_at := public.sms_appointment_start(a.id);
  if start_at is null then
    return false;
  end if;
  -- Окно шаблона «с send_from до send_to»: вне окна — ждать его начала
  -- (`sms_quiet_shift` считает «нельзя» от конца окна до начала). «Накануне
  -- в ЧЧ:ММ» уходит ровно в своё время — окно у него не действует.
  send_at := greatest(coalesce(p_at, now()), now());
  if tpl.trigger <> 'day_before' then
    send_at := public.sms_quiet_shift(send_at, public.sms_appointment_tz(a.id), tpl.send_to, tpl.send_from);
  end if;
  -- До визита — только пока визит впереди: запись задним числом и отмена
  -- вчерашней — не повод писать клиенту, как и сообщение, которое окно
  -- отодвинуло за начало.
  if tpl.trigger in ('created', 'before', 'day_before', 'rescheduled', 'cancelled') and send_at >= start_at then
    return false;
  end if;

  select cl.phone, cl.phone_e164, cl.sms_opt_out, cl.blacklisted, cl.deleted_at
    into c
    from public.clients cl
   where cl.id = a.client_id and cl.tenant_id = a.tenant_id;
  if not found or c.deleted_at is not null or c.sms_opt_out or coalesce(c.blacklisted, false) then
    return false;
  end if;
  phone := coalesce(nullif(trim(c.phone_e164), ''), nullif(trim(c.phone), ''));
  if phone is null then
    return false;
  end if;

  insert into public.sms_messages (
    tenant_id, appointment_id, client_id, team_id, to_phone,
    trigger_type, template_id, template_body, for_start, send_after, status, mode
  ) values (
    a.tenant_id, a.id, a.client_id, a.team_id, phone,
    public.sms_trigger_kind(tpl.trigger), tpl.id::text, tpl.body, start_at,
    case when send_at > now() then send_at end,
    'queued', 'platform'
  )
  on conflict (appointment_id, template_id, for_start)
    where appointment_id is not null and template_id is not null
      and trigger_type not in ('manual', 'reschedule')
    do nothing
  returning id into inserted;
  return inserted is not null;
end;
$function$;

create or replace function public.sms_enqueue_due()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  start_at timestamptz;
  moment timestamptz;
  tz text;
  n integer := 0;
begin
  if not public.sms_service_on() then
    return 0;
  end if;

  -- «ЗА N ЧАСОВ» и «НАКАНУНЕ В ЧЧ:ММ». Момент отправки: начало минус N
  -- часов / накануне в ЧЧ:ММ по времени календаря. Запись (или перенос)
  -- должна быть заведена ДО момента — иначе её закрывает подтверждение.
  -- Проспали момент больше чем на 3 часа (сервис был выключен, шаблон
  -- завели поздно) — не шлём: «напоминание» в полночь хуже, чем никакого.
  -- Команды — только с именем отправителя (волна 11).
  for r in
    select a.id, a.created_at, a.date, tpl.id as tpl_id, tpl.trigger, tpl.hours, tpl.at_time
      from public.sms_team_senders snd
      join public.sms_team_templates tpl
        on tpl.tenant_id = snd.tenant_id and tpl.team_id = snd.team_id and tpl.enabled
       and tpl.trigger in ('before', 'day_before')
      join public.appointments a
        on a.tenant_id = snd.tenant_id
       and a.team_id = snd.team_id
       and a.kind = 'work'
       and a.status = 'scheduled'
       and a.client_id is not null
       and a.date between to_char(now() - interval '1 day', 'YYYY-MM-DD')
                      and to_char(now() + interval '8 days', 'YYYY-MM-DD')
  loop
    start_at := public.sms_appointment_start(r.id);
    continue when start_at is null or start_at <= now();
    if r.trigger = 'before' then
      moment := start_at - make_interval(hours => r.hours);
    else
      tz := public.sms_appointment_tz(r.id);
      begin
        moment := ((r.date::date - 1)::text || ' ' || r.at_time)::timestamp at time zone tz;
      exception when others then
        continue;
      end;
    end if;
    continue when now() < moment
      or now() > moment + interval '3 hours'
      or r.created_at > moment;
    continue when exists (
      select 1 from public.sms_messages m
       where m.appointment_id = r.id
         and (
           (m.template_id = r.tpl_id::text and m.for_start = start_at)
           or (m.trigger_type in ('new_appointment', 'reschedule') and m.created_at > moment)
         )
    );
    if public.sms_enqueue(r.id, r.tpl_id) then
      n := n + 1;
    end if;
  end loop;

  -- «ПОРА ПОВТОРИТЬ»: последний выполненный визит клиента был N месяцев
  -- назад (окно — неделя, чтобы старая история не ушла разом), будущей
  -- записи нет.
  for r in
    select a.id, a.date, tpl.id as tpl_id, tpl.months
      from public.sms_team_senders snd
      join public.sms_team_templates tpl
        on tpl.tenant_id = snd.tenant_id and tpl.team_id = snd.team_id and tpl.enabled and tpl.trigger = 'repeat'
      join public.appointments a
        on a.tenant_id = snd.tenant_id
       and a.team_id = snd.team_id
       and a.kind = 'work'
       and a.status = 'completed'
       and a.client_id is not null
       and a.date between to_char(now() - interval '25 months', 'YYYY-MM-DD')
                      and to_char(now() - interval '1 month', 'YYYY-MM-DD')
     where not exists (
         select 1 from public.sms_messages m
          where m.appointment_id = a.id and m.template_id = tpl.id::text
       )
       and not exists (
         select 1 from public.appointments later
          where later.tenant_id = a.tenant_id and later.client_id = a.client_id
            and later.kind = 'work' and later.id <> a.id
            and (
              (later.status = 'completed' and later.date > a.date)
              or (later.status in ('scheduled', 'in_progress') and later.date >= to_char(now(), 'YYYY-MM-DD'))
            )
       )
  loop
    continue when not (
      r.date::date + make_interval(months => r.months) <= current_date
      and r.date::date + make_interval(months => r.months) > current_date - 7
    );
    if public.sms_enqueue(r.id, r.tpl_id) then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$function$;

/** Вручную через сервис — только по записи команды с именем отправителя
 *  и пока хватает баланса. */
create or replace function public.sms_send_manual(
  p_appointment_id uuid,
  p_client_id uuid,
  p_body text,
  p_template_id text default null
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
  v_client uuid;
  v_team text;
  c record;
  phone text;
  v_body text := trim(coalesce(p_body, ''));
  v_balance integer;
  v_id uuid;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not public.sms_service_on() then
    raise exception 'sms:service_off' using errcode = 'P0001';
  end if;
  if length(v_body) = 0 or length(v_body) > 1000 then
    raise exception 'sms:body' using errcode = '22023';
  end if;
  if p_appointment_id is null then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;

  select ap.client_id, ap.team_id into a
    from public.appointments ap
   where ap.id = p_appointment_id and ap.tenant_id = v_tenant;
  if not found or a.client_id is null then
    raise exception 'sms:appointment' using errcode = 'P0001';
  end if;
  v_client := a.client_id;
  v_team := a.team_id;
  if v_team is null then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  -- Календарь, который человек видит, — тем же правилом, что окно записей
  -- (`list_master_appointments_safe`): прикреплённый живой календарь.
  if not is_owner
     and not (v_team = any(public.current_user_calendar_ids('view'))
              or v_team = any(public.current_user_team_ids())) then
    raise exception 'sms:rights' using errcode = '42501';
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
  phone := coalesce(nullif(trim(c.phone_e164), ''), nullif(trim(c.phone), ''));
  if phone is null then
    raise exception 'sms:phone' using errcode = 'P0001';
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
