-- SMS, ВОЛНА 8 (STORY-089): ШАБЛОНЫ У КАЖДОЙ КОМАНДЫ, БАЛАНС — В КАБИНЕТЕ.
--
-- Владелец 29.09: «каждой команде присвоен свой шаблон SMS… открываю
-- Команда 1 → SMS — все шаблоны этой команды, Команда 3 — добавляю заново…
-- когда добавляю шаблон, полноценно настраиваю: когда отправлять, как
-- отправлять… не по блокам „до визита“… баланс единый, в Кабинете». И:
-- «главное — удобно: написал шаблон — отправил клиенту, без косяков».
--
-- МОДЕЛЬ. `sms_team_templates` — строка на шаблон команды. У шаблона свой
-- «когда» (`trigger`):
--   manual      — только вручную, из записи или карточки;
--   created     — сразу после заведения записи;
--   before      — за N часов до начала (`hours`, 1–168);
--   day_before  — накануне в ЧЧ:ММ по времени календаря (`at_time`);
--   rescheduled — дата или время записи поменялись;
--   cancelled   — запись отменена;
--   after       — через N часов после выполненной записи (`hours`, 1–72);
--   repeat      — через N месяцев после последнего визита (`months`, 1–24),
--                 если у клиента нет будущей записи.
-- Прежние «события компании» (`sms_rules`) уходят: строк в них нет
-- (сверено 29.09), тексты и сроки теперь живут у шаблона.
--
-- Сообщение помнит свой шаблон (`sms_messages.template_id`) и начало записи
-- (`for_start`): один автоматический шаблон — одно SMS на запись и её
-- время; после переноса напоминание уходит заново. Списание и отказ Twilio
-- с возвратом — как были.
--
-- ВРЕМЯ ОТПРАВКИ — У ШАБЛОНА, «ТИХИХ ЧАСОВ» БОЛЬШЕ НЕТ. Владелец 29.09:
-- «тихих часов такого понятия нет, мы программируем шаблон в определённое
-- время… назначенное время, в которое можем отправлять». «Накануне в ЧЧ:ММ»
-- уходит ровно в ЧЧ:ММ. Остальные автоматические шаблоны несут окно
-- «Отправлять с `send_from` до `send_to`» (часы календаря, по умолчанию
-- 8–21): событие вне окна ждёт его начала. `tenant_sms_config.quiet_*`
-- больше никем не читается.

-- ─── Шаблоны команды ────────────────────────────────────────────────────

create table if not exists public.sms_team_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  team_id text not null,
  name text not null,
  body text not null,
  trigger text not null default 'manual',
  hours integer,
  at_time text,
  months integer,
  send_from smallint not null default 8,
  send_to smallint not null default 21,
  enabled boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_team_templates_name_check check (length(trim(name)) between 1 and 60),
  constraint sms_team_templates_body_check check (length(trim(body)) between 1 and 1000),
  constraint sms_team_templates_trigger_check check (trigger in (
    'manual', 'created', 'before', 'day_before', 'rescheduled', 'cancelled', 'after', 'repeat'
  )),
  -- `coalesce(…, false)`: пустое `hours` у «до визита» дало бы NULL, а NULL
  -- проверка пропускает — шаблон без срока молча сохранился бы.
  constraint sms_team_templates_timing_check check (coalesce(
    case trigger
      when 'before' then hours between 1 and 168 and at_time is null and months is null
      when 'after' then hours between 1 and 72 and at_time is null and months is null
      when 'day_before' then at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and hours is null and months is null
      when 'repeat' then months between 1 and 24 and hours is null and at_time is null
      else hours is null and at_time is null and months is null
    end, false)
  ),
  constraint sms_team_templates_window_check check (
    send_from between 0 and 23 and send_to between 1 and 24 and send_from < send_to
  )
);

create index if not exists idx_sms_team_templates_team
  on public.sms_team_templates (tenant_id, team_id, position);

comment on table public.sms_team_templates is
  'Шаблоны SMS команды: текст и «когда отправлять» (STORY-089, 29.09). Только через RPC.';

alter table public.sms_team_templates enable row level security;
revoke all on table public.sms_team_templates from anon, authenticated;

-- ─── Прежние события компании — под снос ───────────────────────────────

drop function if exists public.sms_save_rule(text, text, text, text, integer);
drop function if exists public.sms_rule_for(uuid, text, text);
drop function if exists public.sms_rule_default(text);
drop table if exists public.sms_rules;

-- Одно SMS на запись, ШАБЛОН и начало записи. Ручные и переносы —
-- сколько угодно.
drop index if exists public.uniq_sms_messages_appointment_trigger;
create unique index uniq_sms_messages_appointment_trigger
  on public.sms_messages (appointment_id, template_id, for_start)
  where appointment_id is not null and template_id is not null
    and trigger_type not in ('manual', 'reschedule');

/** Повод в журнале — прежние слова истории: по нему строка говорит
 *  «Напоминание», «Отмена», «Спасибо». */
create or replace function public.sms_trigger_kind(p_trigger text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case p_trigger
    when 'created' then 'new_appointment'
    when 'before' then 'reminder'
    when 'day_before' then 'reminder'
    when 'rescheduled' then 'reschedule'
    when 'cancelled' then 'cancellation'
    when 'after' then 'thank_you'
    when 'repeat' then 'repeat'
    else 'manual'
  end
$function$;

-- ─── Постановка в очередь ───────────────────────────────────────────────

drop function if exists public.sms_enqueue(uuid, text, timestamptz);

/** Поставить SMS шаблона по записи. Истина — если поставлено. Любое
 *  «нельзя» — тихое «нет»: запись от этого не падает. p_at — когда слать
 *  по расписанию (нет — сейчас); окно шаблона сдвигает. */
create or replace function public.sms_enqueue(p_appointment uuid, p_template uuid, p_at timestamptz default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  tpl public.sms_team_templates%rowtype;
  cfg public.tenant_sms_config%rowtype;
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
  select * into cfg from public.tenant_sms_config where tenant_id = a.tenant_id;
  if not found or not cfg.enabled or not (a.team_id = any(cfg.team_ids)) then
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

/** Все включённые шаблоны команды записи с этим «когда» — в очередь. */
create or replace function public.sms_enqueue_trigger(p_appointment uuid, p_trigger text, p_at timestamptz default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t record;
  queued boolean := false;
begin
  for t in
    select tpl.id
      from public.appointments a
      join public.sms_team_templates tpl
        on tpl.tenant_id = a.tenant_id and tpl.team_id = a.team_id
       and tpl.enabled and tpl.trigger = p_trigger
     where a.id = p_appointment
     order by tpl.position, tpl.created_at
  loop
    if public.sms_enqueue(p_appointment, t.id, p_at) then
      queued := true;
    end if;
  end loop;
  return queued;
end;
$function$;

create or replace function public.appointments_sms_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  queued boolean := false;
  t record;
  end_at timestamptz;
begin
  begin
    if tg_op = 'INSERT' then
      if new.kind = 'work' and new.status = 'scheduled' then
        queued := public.sms_enqueue_trigger(new.id, 'created');
      end if;
    elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      -- Отмена: неотправленное «до визита» уже ни к чему.
      delete from public.sms_messages
       where appointment_id = new.id and status = 'queued'
         and trigger_type in ('new_appointment', 'reminder', 'reschedule');
      queued := public.sms_enqueue_trigger(new.id, 'cancelled');
    elsif new.status = 'completed' and old.status is distinct from 'completed' then
      end_at := public.sms_appointment_end(new.id);
      for t in
        select tpl.id, tpl.hours
          from public.sms_team_templates tpl
         where tpl.tenant_id = new.tenant_id and tpl.team_id = new.team_id
           and tpl.enabled and tpl.trigger = 'after'
      loop
        -- Отметили выполненной через сутки после срока — «спасибо» уже не к месту.
        if end_at is not null and end_at + make_interval(hours => t.hours) > now() - interval '1 day' then
          if public.sms_enqueue(new.id, t.id, end_at + make_interval(hours => t.hours)) then
            queued := true;
          end if;
        end if;
      end loop;
    elsif new.status = 'scheduled'
      and (new.date is distinct from old.date or new.time_start is distinct from old.time_start) then
      -- Перенос: напоминания о прежнем времени не нужны, новые поставит
      -- расписание. Неотправленное подтверждение или перенос уйдут с новой
      -- датой сами (текст собирается при отправке) — второй не нужен.
      delete from public.sms_messages
       where appointment_id = new.id and status = 'queued' and trigger_type = 'reminder';
      if not exists (
        select 1 from public.sms_messages m
         where m.appointment_id = new.id and m.status = 'queued'
           and m.trigger_type in ('new_appointment', 'reschedule')
      ) then
        queued := public.sms_enqueue_trigger(new.id, 'rescheduled');
      end if;
    end if;
    if queued then
      perform public.sms_wake();
    end if;
  exception when others then
    -- SMS не имеет права уронить запись.
    raise warning 'appointments_sms_trigger: %', sqlerrm;
  end;
  return null;
end;
$function$;

drop trigger if exists appointments_sms on public.appointments;
create trigger appointments_sms
  after insert or update of status, date, time_start on public.appointments
  for each row execute function public.appointments_sms_trigger();

/** По расписанию: «за N часов», «накануне в ЧЧ:ММ» и «пора повторить». */
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
  for r in
    select a.id, a.created_at, a.date, tpl.id as tpl_id, tpl.trigger, tpl.hours, tpl.at_time
      from public.tenant_sms_config cfg
      join public.sms_team_templates tpl
        on tpl.tenant_id = cfg.tenant_id and tpl.enabled
       and tpl.trigger in ('before', 'day_before')
       and tpl.team_id = any(cfg.team_ids)
      join public.appointments a
        on a.tenant_id = cfg.tenant_id
       and a.team_id = tpl.team_id
       and a.kind = 'work'
       and a.status = 'scheduled'
       and a.client_id is not null
       and a.date between to_char(now() - interval '1 day', 'YYYY-MM-DD')
                      and to_char(now() + interval '8 days', 'YYYY-MM-DD')
     where cfg.enabled
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
      from public.tenant_sms_config cfg
      join public.sms_team_templates tpl
        on tpl.tenant_id = cfg.tenant_id and tpl.enabled and tpl.trigger = 'repeat'
       and tpl.team_id = any(cfg.team_ids)
      join public.appointments a
        on a.tenant_id = cfg.tenant_id
       and a.team_id = tpl.team_id
       and a.kind = 'work'
       and a.status = 'completed'
       and a.client_id is not null
       and a.date between to_char(now() - interval '25 months', 'YYYY-MM-DD')
                      and to_char(now() - interval '1 month', 'YYYY-MM-DD')
     where cfg.enabled
       and not exists (
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

-- ─── Для приложения ─────────────────────────────────────────────────────

/** Шаблон строкой ответа. */
create or replace function public.sms_team_template_json(t public.sms_team_templates)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', t.id,
    'team_id', t.team_id,
    'name', t.name,
    'body', t.body,
    'trigger', t.trigger,
    'hours', t.hours,
    'at_time', t.at_time,
    'months', t.months,
    'send_from', t.send_from,
    'send_to', t.send_to,
    'enabled', t.enabled,
    'position', t.position
  )
$function$;

/** Шаблоны: команды или всех видимых команд (p_team_id — пусто). Владелец
 *  видит все свои; сотрудник — команд, которые видит (для отправки). */
create or replace function public.sms_team_templates(p_team_id text default null)
returns setof jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  return query
  select public.sms_team_template_json(t)
    from public.sms_team_templates t
   where t.tenant_id = v_tenant
     and (p_team_id is null or t.team_id = p_team_id)
     and public.sms_can_see_team(t.team_id)
   order by t.team_id, t.position, t.created_at;
end;
$function$;

/** Сохранить шаблон (новый — без id). Только владелец. Срок чистится под
 *  выбранное «когда»: лишние поля обнуляются, недостающие — отказ. */
create or replace function public.sms_save_team_template(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_team text := nullif(trim(coalesce(p ->> 'team_id', '')), '');
  v_trigger text := coalesce(nullif(p ->> 'trigger', ''), 'manual');
  v_hours integer := case when v_trigger in ('before', 'after') then nullif(p ->> 'hours', '')::integer end;
  v_at text := case when v_trigger = 'day_before' then nullif(p ->> 'at_time', '') end;
  v_months integer := case when v_trigger = 'repeat' then nullif(p ->> 'months', '')::integer end;
  v_from smallint := coalesce(nullif(p ->> 'send_from', '')::smallint, 8);
  v_to smallint := coalesce(nullif(p ->> 'send_to', '')::smallint, 21);
  saved public.sms_team_templates%rowtype;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  if v_team is null or not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms: bad team' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.sms_team_templates (
      tenant_id, team_id, name, body, trigger, hours, at_time, months, send_from, send_to, enabled, position
    ) values (
      v_tenant, v_team, trim(p ->> 'name'), trim(p ->> 'body'), v_trigger, v_hours, v_at, v_months, v_from, v_to,
      coalesce((p ->> 'enabled')::boolean, true),
      coalesce((select max(position) + 1 from public.sms_team_templates
                 where tenant_id = v_tenant and team_id = v_team), 0)
    )
    returning * into saved;
  else
    update public.sms_team_templates set
      name = trim(p ->> 'name'),
      body = trim(p ->> 'body'),
      trigger = v_trigger,
      hours = v_hours,
      at_time = v_at,
      months = v_months,
      send_from = v_from,
      send_to = v_to,
      enabled = coalesce((p ->> 'enabled')::boolean, enabled),
      updated_at = now()
    where id = v_id and tenant_id = v_tenant and team_id = v_team
    returning * into saved;
    if not found then
      raise exception 'sms: template not found' using errcode = 'P0002';
    end if;
  end if;
  return public.sms_team_template_json(saved);
end;
$function$;

/** Включить / выключить шаблон одним тапом — только владелец. */
create or replace function public.sms_set_team_template_enabled(p_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  update public.sms_team_templates
     set enabled = coalesce(p_enabled, false), updated_at = now()
   where id = p_id and tenant_id = public.current_tenant_id();
  return coalesce(p_enabled, false);
end;
$function$;

/** Удалить шаблон — только владелец. Уже отправленные SMS остаются в
 *  истории; неотправленные по нему — снимаются. */
create or replace function public.sms_delete_team_template(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  delete from public.sms_messages
   where tenant_id = v_tenant and template_id = p_id::text and status = 'queued';
  delete from public.sms_team_templates where id = p_id and tenant_id = v_tenant;
  return found;
end;
$function$;

/** Кабинет SMS. Владельцу — баланс, отправка, счёт месяца по
 *  командам и сколько у каждой шаблонов. Сотруднику — можно ли отправлять
 *  через сервис и в каких календарях. */
create or replace function public.sms_account()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
  cfg public.tenant_sms_config%rowtype;
  price integer := public.sms_price_cents();
  base jsonb;
  month_start timestamptz := date_trunc('month', now());
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms: no access' using errcode = '42501';
  end if;
  select * into cfg from public.tenant_sms_config where tenant_id = v_tenant;
  base := jsonb_build_object(
    'service_on', public.sms_service_on(),
    'enabled', coalesce(cfg.enabled, false),
    'team_ids', to_jsonb(coalesce(cfg.team_ids, '{}'::text[])),
    'price_cents', price,
    'can_pay', coalesce(cfg.free_sms_remaining, 10) > 0 or coalesce(cfg.balance_cents, 0) >= price
  );
  if not is_owner then
    return base;
  end if;
  return base || jsonb_build_object(
    'balance_cents', coalesce(cfg.balance_cents, 0),
    'free_left', coalesce(cfg.free_sms_remaining, 10),
    'sender', case when cfg.sender_status = 'approved' then cfg.sender_name else 'Babun' end,
    'month', (
      select jsonb_build_object(
               'count', count(*) filter (where m.status in ('sending', 'sent', 'delivered')),
               'cents', coalesce(sum(m.cost_cents) filter (where m.status in ('sending', 'sent', 'delivered')), 0)
             )
        from public.sms_messages m
       where m.tenant_id = v_tenant and m.created_at >= month_start
    ),
    -- Счёт месяца по командам: ушло, частей, стоимость, доставлено, не дошло.
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'team_id', s.team_id,
               'count', s.sent,
               'segments', s.segments,
               'cents', s.cents,
               'delivered', s.delivered,
               'failed', s.failed
             ) order by s.team_id)
        from (
          select coalesce(m.team_id, '') as team_id,
                 count(*) filter (where m.status in ('sending', 'sent', 'delivered')) as sent,
                 coalesce(sum(m.segments) filter (where m.status in ('sending', 'sent', 'delivered')), 0) as segments,
                 coalesce(sum(m.cost_cents) filter (where m.status in ('sending', 'sent', 'delivered')), 0) as cents,
                 count(*) filter (where m.status = 'delivered') as delivered,
                 count(*) filter (where m.status in ('failed', 'undelivered', 'blocked')) as failed
            from public.sms_messages m
           where m.tenant_id = v_tenant and m.created_at >= month_start
           group by coalesce(m.team_id, '')
        ) s
    ), '[]'::jsonb),
    -- Сколько шаблонов у каждой команды — подпись строки команды.
    'template_counts', coalesce((
      select jsonb_object_agg(t.team_id, t.n)
        from (select team_id, count(*) as n from public.sms_team_templates
               where tenant_id = v_tenant group by team_id) t
    ), '{}'::jsonb)
  );
end;
$function$;

/** SMS записи: сообщения, шаблоны её команды для ручной отправки и ответ
 *  клиента по ссылке. */
create or replace function public.sms_for_appointment(p_appointment_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
  a record;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  select ap.id, ap.team_id into a
    from public.appointments ap
   where ap.id = p_appointment_id and ap.tenant_id = v_tenant;
  if not found or not public.sms_can_see_team(a.team_id) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'templates', coalesce((
      select jsonb_agg(public.sms_team_template_json(t) order by t.position, t.created_at)
        from public.sms_team_templates t
       where t.tenant_id = v_tenant and t.team_id = a.team_id and t.enabled
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(public.sms_message_json(m, is_owner) order by m.created_at desc)
        from public.sms_messages m
       where m.tenant_id = v_tenant and m.appointment_id = a.id
    ), '[]'::jsonb),
    'client_answer', (select l.answer from public.appointment_links l where l.appointment_id = a.id),
    'client_answered_at', (select l.answered_at from public.appointment_links l where l.appointment_id = a.id)
  );
end;
$function$;

/** История SMS — только владельцу; отбор по команде и поводу. Строка
 *  несёт имя шаблона, по которому ушло сообщение. */
create or replace function public.sms_history(
  p_before timestamptz default null,
  p_limit integer default 50,
  p_team_id text default null,
  p_trigger text default null
)
returns setof jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', m.id,
    'created_at', m.created_at,
    'send_after', m.send_after,
    'to_phone', m.to_phone,
    'client_id', m.client_id,
    'client_name', cl.full_name,
    'appointment_id', m.appointment_id,
    'team_id', m.team_id,
    'body', m.message_body,
    'template_body', m.template_body,
    'template_name', tpl.name,
    'status', m.status,
    'trigger', m.trigger_type,
    'segments', m.segments,
    'cost_cents', m.cost_cents,
    'was_free', m.was_free,
    'error', m.error_message
  )
    from public.sms_messages m
    left join public.clients cl on cl.id = m.client_id
    left join public.sms_team_templates tpl on tpl.id::text = m.template_id
   where public.current_user_role() = 'owner'
     and m.tenant_id = public.current_tenant_id()
     and (p_before is null or m.created_at < p_before)
     and (p_team_id is null or m.team_id = p_team_id)
     and (p_trigger is null or m.trigger_type = p_trigger)
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$function$;

-- ─── Права вызова ───────────────────────────────────────────────────────

revoke all on function public.sms_trigger_kind(text) from public, anon, authenticated;
revoke all on function public.sms_enqueue(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.sms_enqueue_trigger(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.appointments_sms_trigger() from public, anon, authenticated;
revoke all on function public.sms_enqueue_due() from public, anon, authenticated;
revoke all on function public.sms_team_template_json(public.sms_team_templates) from public, anon, authenticated;
revoke all on function public.sms_team_templates(text) from public, anon;
revoke all on function public.sms_save_team_template(jsonb) from public, anon;
revoke all on function public.sms_set_team_template_enabled(uuid, boolean) from public, anon;
revoke all on function public.sms_delete_team_template(uuid) from public, anon;
grant execute on function public.sms_team_templates(text) to authenticated;
grant execute on function public.sms_save_team_template(jsonb) to authenticated;
grant execute on function public.sms_set_team_template_enabled(uuid, boolean) to authenticated;
grant execute on function public.sms_delete_team_template(uuid) to authenticated;

do $audit$
declare
  f text;
begin
  foreach f in array array[
    'public.sms_enqueue(uuid, uuid, timestamptz)', 'public.sms_enqueue_trigger(uuid, text, timestamptz)',
    'public.sms_enqueue_due()'
  ] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'internal sms function % is callable from outside', f;
    end if;
  end loop;
  foreach f in array array[
    'public.sms_team_templates(text)', 'public.sms_save_team_template(jsonb)',
    'public.sms_set_team_template_enabled(uuid, boolean)', 'public.sms_delete_team_template(uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'sms function % is callable by anon', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.sms_team_templates', 'select')
     or has_table_privilege('anon', 'public.sms_team_templates', 'select') then
    raise exception 'sms_team_templates is readable directly';
  end if;
  if (select count(*) from pg_proc where proname = 'sms_enqueue' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'sms_enqueue left a second overload';
  end if;
end
$audit$;

-- ─── Готовый набор каждой команде ──────────────────────────────────────
--
-- Владелец 29.09: «сразу шаблоны хочу сделать на каждую команду». Каждая
-- существующая команда получает набор, который дальше правится как угодно.
-- Тексты — только из полей, которые у записи есть всегда (имя, день, дата,
-- время): шаблон с пустым полем не уходит. Подтверждение компании, если
-- она его уже писала (`tenant_state.prototype_state.smsTemplates`,
-- «Новая запись»), берётся её текстом. Отправка у всех выключена
-- (`tenant_sms_config.enabled`), так что набор сам ничего не шлёт.
-- Повторный накат не дублирует: команда, у которой шаблоны уже есть,
-- пропускается.

insert into public.sms_team_templates (
  tenant_id, team_id, name, body, trigger, hours, at_time, months, enabled, position
)
select tm.tenant_id, tm.id, s.name,
       case when s.pos = 0 then coalesce(own.body, s.body) else s.body end,
       s.trigger, s.hours, s.at_time, null, true, s.pos
  from public.teams tm
  cross join (values
    (0, 'Подтверждение записи', '[Имя], вы записаны: [День], [Дата] в [Время]. Ждём вас!', 'created', null::integer, null::text),
    (1, 'Напоминание накануне', '[Имя], напоминаем: завтра, [Дата], в [Время] у вас запись.', 'day_before', null, '18:00'),
    (2, 'Перенос', '[Имя], ваша запись перенесена: [День], [Дата] в [Время].', 'rescheduled', null, null),
    (3, 'Отмена', '[Имя], ваша запись на [Дата] в [Время] отменена.', 'cancelled', null, null),
    (4, 'Спасибо', '[Имя], спасибо, что выбрали нас! Будем рады видеть снова.', 'after', 2, null),
    (5, 'Выехал к вам', '[Имя], мастер выехал к вам.', 'manual', null, null)
  ) as s(pos, name, body, trigger, hours, at_time)
  left join lateral (
    select nullif(trim(x ->> 'body'), '') as body
      from public.tenant_state ts,
           jsonb_array_elements(coalesce(ts.prototype_state -> 'smsTemplates', '[]'::jsonb)) x
     where ts.tenant_id = tm.tenant_id
       and x ->> 'kind' = 'new_appointment'
       and coalesce(x ->> 'enabled', 'true') <> 'false'
     limit 1
  ) own on true
 where not exists (
   select 1 from public.sms_team_templates e where e.tenant_id = tm.tenant_id and e.team_id = tm.id
 );
