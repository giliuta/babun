-- SMS, ВОЛНА 4 (STORY-089): СОБЫТИЯ × КОМАНДЫ, ТИХИЕ ЧАСЫ, СТАТИСТИКА.
--
-- Владелец 24.09: «новая запись — свой шаблон, напоминание — свой, отмена —
-- свой… настройка каждого… плюс шаблон под каждую команду… сколько сообщений
-- ушло через команду один, сколько через команду три». Решения: всё живёт в
-- «Клиенты» → «SMS», внутри — раздел на каждую команду; цена — €0,12 за
-- часть. Разбор конкурентов — docs/stories/STORY-089-sms-analysis.md.
--
-- МОДЕЛЬ. `sms_rules` — строка на (компания, команда, событие):
--   • строка компании (team_id = '') — текст по умолчанию, вкл/выкл и срок;
--     строки нет — действует умолчание из `sms_rule_default` (подтверждение
--     и напоминание включены, остальное выключено: пока владелец не включит
--     сервис и команду, не уходит ничего);
--   • строка команды — «свой текст» (mode 'on') или «не отправлять»
--     ('off'); строки нет — «как у компании».
-- Текст события живёт в правиле, а не в справочнике ручных шаблонов: у
-- каждого события свой текст, как просил владелец. Справочник остаётся для
-- ручной отправки из листа «SMS».
--
-- СОБЫТИЯ:
--   new_appointment — сразу после заведения записи;
--   reminder, reminder_2 — за N часов до начала;
--   reschedule — дата или время записи поменялись;
--   cancellation — запись отменена;
--   thank_you — через N часов после выполненной записи;
--   repeat — через N месяцев после последнего выполненного визита, если
--            у клиента нет будущей записи.
--
-- ТИХИЕ ЧАСЫ — настройка компании (по умолчанию 21–08, в поясе календаря).
-- Сообщение, выпавшее на тихие часы, ждёт утра (`send_after`); если утро
-- наступит уже после начала записи, сообщение до визита не ставится вовсе.
--
-- Автоматическое сообщение помнит, о каком начале записи оно (`for_start`):
-- после переноса напоминание уходит заново — уже о новом времени.

-- ─── Цена части: €0,12 (слово владельца 24.09) ──────────────────────────

update public.app_settings
   set value = '12', updated_at = now()
 where key = 'sms_price_cents_per_segment';

-- ─── Правила ────────────────────────────────────────────────────────────

create table if not exists public.sms_rules (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- '' — правило компании (текст по умолчанию); иначе — команда.
  team_id text not null default '',
  event text not null,
  mode text not null,
  body text,
  -- Срок: часы до начала (напоминания), часы после (спасибо), месяцы
  -- после (пора повторить). У правила команды не бывает.
  timing integer,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, team_id, event),
  constraint sms_rules_event_check check (event = any (array[
    'new_appointment', 'reminder', 'reminder_2', 'reschedule',
    'cancellation', 'thank_you', 'repeat'
  ])),
  constraint sms_rules_mode_check check (mode = any (array['on', 'off'])),
  constraint sms_rules_body_check check (body is null or length(body) between 1 and 1000),
  constraint sms_rules_team_body check (team_id = '' or mode = 'off' or body is not null),
  constraint sms_rules_timing_check check (
    timing is null
    or (team_id = '' and (
      (event in ('reminder', 'reminder_2') and timing between 1 and 168)
      or (event = 'thank_you' and timing between 1 and 72)
      or (event = 'repeat' and timing between 1 and 24)
    ))
  )
);

comment on table public.sms_rules is
  'Автоматические SMS: текст и вкл/выкл события у компании (team_id = '''') и у команды (STORY-089). Только через RPC.';

alter table public.sms_rules enable row level security;
revoke all on table public.sms_rules from anon, authenticated;

alter table public.tenant_sms_config
  add column if not exists quiet_from integer not null default 21,
  add column if not exists quiet_to integer not null default 8;

alter table public.tenant_sms_config
  drop constraint if exists tenant_sms_config_quiet_check,
  add constraint tenant_sms_config_quiet_check
    check (quiet_from between 0 and 23 and quiet_to between 0 and 23);

-- Прежние «какой шаблон на повод» и «за сколько часов» переехали в правила.
-- Строк настроек в базе нет (сверено 24.09), переносить нечего.
alter table public.tenant_sms_config
  drop constraint if exists tenant_sms_config_reminder_hours_check,
  drop column if exists auto_new_template,
  drop column if exists auto_reminder_template,
  drop column if exists auto_cancel_template,
  drop column if exists reminder_hours;

-- ─── Журнал ─────────────────────────────────────────────────────────────

alter table public.sms_messages
  add column if not exists template_body text,
  add column if not exists for_start timestamptz,
  add column if not exists send_after timestamptz;

alter table public.sms_messages
  drop constraint if exists sms_messages_trigger_type_check,
  add constraint sms_messages_trigger_type_check check (trigger_type = any (array[
    'reminder_24h', 'reminder_2h', 'manual', 'test',
    'new_appointment', 'reminder', 'reminder_2', 'reschedule',
    'cancellation', 'thank_you', 'repeat'
  ]));

-- Одно автоматическое на запись, повод и начало: после переноса
-- напоминание о новом времени — другое сообщение. Переносов может быть
-- сколько угодно, ручных — тоже.
drop index if exists public.uniq_sms_messages_appointment_trigger;
create unique index uniq_sms_messages_appointment_trigger
  on public.sms_messages (appointment_id, trigger_type, for_start)
  where appointment_id is not null and trigger_type not in ('manual', 'reschedule');

create index if not exists idx_sms_messages_month
  on public.sms_messages (tenant_id, created_at);

-- ─── Помощники ──────────────────────────────────────────────────────────

/** Правило по умолчанию: пока владелец не поменял событие. Тексты — без
 *  полей, которых у записи может не быть (адрес, услуга): шаблон с пустым
 *  полем не отправляется вовсе. */
create or replace function public.sms_rule_default(p_event text)
returns table (mode text, body text, timing integer)
language sql
immutable
set search_path to 'public'
as $function$
  select d.mode, d.body, d.timing from (values
    ('new_appointment', 'on',  '[Имя], вы записаны: [День], [Дата] в [Время]. [Компания]', null::integer),
    ('reminder',        'on',  '[Имя], напоминаем: [День], [Дата] в [Время]. [Компания]', 24),
    ('reminder_2',      'off', '[Имя], ждём вас сегодня в [Время]. [Компания]', 2),
    ('reschedule',      'off', '[Имя], запись перенесена: [День], [Дата] в [Время]. [Компания]', null),
    ('cancellation',    'off', '[Имя], запись на [Дата] в [Время] отменена. [Компания]', null),
    ('thank_you',       'off', '[Имя], спасибо, что выбрали нас! [Компания]', 2),
    ('repeat',          'off', '[Имя], пора повторить обслуживание. Будем рады вас видеть! [Компания]', 6)
  ) d(event, mode, body, timing)
  where d.event = p_event
$function$;

/** Действующее правило события для команды: текст и срок, если слать;
 *  ничего — если не слать. Команда без своей строки — как у компании. */
create or replace function public.sms_rule_for(p_tenant uuid, p_team text, p_event text)
returns table (body text, timing integer)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  d record;
  company public.sms_rules%rowtype;
  team public.sms_rules%rowtype;
  c_mode text;
  c_body text;
  c_timing integer;
begin
  select * into d from public.sms_rule_default(p_event);
  if not found then
    return;
  end if;
  select * into company from public.sms_rules r
   where r.tenant_id = p_tenant and r.team_id = '' and r.event = p_event;
  c_mode := coalesce(company.mode, d.mode);
  c_body := coalesce(nullif(company.body, ''), d.body);
  c_timing := coalesce(company.timing, d.timing);

  select * into team from public.sms_rules r
   where r.tenant_id = p_tenant and r.team_id = coalesce(p_team, '') and r.team_id <> '' and r.event = p_event;
  if found then
    if team.mode = 'off' then
      return;
    end if;
    return query select team.body, c_timing;
    return;
  end if;
  if c_mode = 'on' then
    return query select c_body, c_timing;
  end if;
end;
$function$;

/** Первый разрешённый момент не раньше p_at: вне тихих часов компании.
 *  from = to — тихих часов нет. */
create or replace function public.sms_quiet_shift(p_at timestamptz, p_tz text, p_from integer, p_to integer)
returns timestamptz
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  tz text := coalesce(nullif(p_tz, ''), 'Europe/Nicosia');
  local_ts timestamp;
  h integer;
  quiet boolean;
  morning timestamp;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return p_at;
  end if;
  begin
    local_ts := p_at at time zone tz;
  exception when others then
    tz := 'Europe/Nicosia';
    local_ts := p_at at time zone tz;
  end;
  h := extract(hour from local_ts);
  quiet := case when p_from > p_to then h >= p_from or h < p_to
                else h >= p_from and h < p_to end;
  if not quiet then
    return p_at;
  end if;
  morning := date_trunc('day', local_ts) + make_interval(hours => p_to);
  if morning <= local_ts then
    morning := morning + interval '1 day';
  end if;
  return morning at time zone tz;
end;
$function$;

/** Пояс записи: календаря, иначе компании, иначе Кипр. */
create or replace function public.sms_appointment_tz(p_appointment uuid)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(nullif(t.timezone, ''), nullif(cs.timezone, ''), 'Europe/Nicosia')
    from public.appointments a
    left join public.teams t on t.tenant_id = a.tenant_id and t.id = a.team_id
    left join public.calendar_settings cs on cs.tenant_id = a.tenant_id
   where a.id = p_appointment
$function$;

/** Конец записи как момент времени (нет конца — начало). */
create or replace function public.sms_appointment_end(p_appointment uuid)
returns timestamptz
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  result timestamptz;
begin
  select (a.date || ' ' || left(coalesce(nullif(a.time_end, ''), a.time_start), 5))::timestamp
         at time zone public.sms_appointment_tz(a.id)
    into result
    from public.appointments a
   where a.id = p_appointment;
  return result;
exception when others then
  return null;
end;
$function$;

-- Прежняя постановка в очередь (два аргумента) уступает новой.
drop function if exists public.sms_enqueue(uuid, text);

/** Поставить автоматическое SMS по записи в очередь. Истина — если
 *  поставлено. Любое «нельзя» — тихое «нет»: запись от этого не падает.
 *  p_at — когда слать по расписанию (нет — сейчас); тихие часы сдвигают. */
create or replace function public.sms_enqueue(p_appointment uuid, p_trigger text, p_at timestamptz default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  cfg public.tenant_sms_config%rowtype;
  rule record;
  c record;
  phone text;
  start_at timestamptz;
  send_at timestamptz;
  inserted uuid;
  before_visit boolean := p_trigger in ('new_appointment', 'reminder', 'reminder_2', 'reschedule', 'cancellation');
begin
  if not public.sms_service_on() then
    return false;
  end if;

  select ap.id, ap.tenant_id, ap.client_id, ap.team_id, ap.kind, ap.status
    into a
    from public.appointments ap
   where ap.id = p_appointment;
  if not found or a.kind <> 'work' or a.client_id is null or a.team_id is null then
    return false;
  end if;

  select * into cfg from public.tenant_sms_config where tenant_id = a.tenant_id;
  if not found or not cfg.enabled or not (a.team_id = any(cfg.team_ids)) then
    return false;
  end if;

  select * into rule from public.sms_rule_for(a.tenant_id, a.team_id, p_trigger);
  if not found or coalesce(rule.body, '') = '' then
    return false;
  end if;

  start_at := public.sms_appointment_start(a.id);
  if start_at is null then
    return false;
  end if;
  send_at := public.sms_quiet_shift(
    greatest(coalesce(p_at, now()), now()),
    public.sms_appointment_tz(a.id),
    cfg.quiet_from,
    cfg.quiet_to
  );
  -- До визита — только пока визит впереди: запись задним числом и отмена
  -- вчерашней — не повод писать клиенту, как и сообщение, которое тихие
  -- часы отодвинули за начало.
  if before_visit and send_at >= start_at then
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
    trigger_type, template_body, for_start, send_after, status, mode
  ) values (
    a.tenant_id, a.id, a.client_id, a.team_id, phone,
    p_trigger, rule.body, start_at,
    case when send_at > now() then send_at end,
    'queued', 'platform'
  )
  on conflict (appointment_id, trigger_type, for_start)
    where appointment_id is not null and trigger_type not in ('manual', 'reschedule')
    do nothing
  returning id into inserted;

  return inserted is not null;
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
  thanks integer;
  end_at timestamptz;
begin
  begin
    if tg_op = 'INSERT' then
      if new.kind = 'work' and new.status = 'scheduled' then
        queued := public.sms_enqueue(new.id, 'new_appointment');
      end if;
    elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      -- Отмена: неотправленное «до визита» уже ни к чему.
      delete from public.sms_messages
       where appointment_id = new.id and status = 'queued'
         and trigger_type in ('new_appointment', 'reminder', 'reminder_2', 'reschedule');
      queued := public.sms_enqueue(new.id, 'cancellation');
    elsif new.status = 'completed' and old.status is distinct from 'completed' then
      select timing into thanks from public.sms_rule_for(new.tenant_id, new.team_id, 'thank_you');
      if found then
        end_at := public.sms_appointment_end(new.id);
        -- Отметили выполненной через сутки после срока — «спасибо» уже не к месту.
        if end_at is not null and end_at + make_interval(hours => thanks) > now() - interval '1 day' then
          queued := public.sms_enqueue(new.id, 'thank_you', end_at + make_interval(hours => thanks));
        end if;
      end if;
    elsif new.status = 'scheduled'
      and (new.date is distinct from old.date or new.time_start is distinct from old.time_start) then
      -- Перенос: напоминания о прежнем времени не нужны, новые поставит
      -- расписание. Неотправленное подтверждение или перенос уйдут с новой
      -- датой сами (текст собирается при отправке) — второй не нужен.
      delete from public.sms_messages
       where appointment_id = new.id and status = 'queued'
         and trigger_type in ('reminder', 'reminder_2');
      if not exists (
        select 1 from public.sms_messages m
         where m.appointment_id = new.id and m.status = 'queued'
           and m.trigger_type in ('new_appointment', 'reschedule')
      ) then
        queued := public.sms_enqueue(new.id, 'reschedule');
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

/** По расписанию: напоминания (оба) и «пора повторить». */
create or replace function public.sms_enqueue_due()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  ev text;
  rule record;
  start_at timestamptz;
  n integer := 0;
begin
  if not public.sms_service_on() then
    return 0;
  end if;

  -- Напоминания: запись впереди, окно «за N часов» открылось, о ЭТОМ
  -- начале напоминания ещё не было, и запись (или перенос) заведена раньше
  -- окна — заведённую за час до начала закрывает подтверждение.
  foreach ev in array array['reminder', 'reminder_2'] loop
    for r in
      select a.id, a.tenant_id, a.team_id, a.created_at
        from public.tenant_sms_config cfg
        join public.appointments a
          on a.tenant_id = cfg.tenant_id
         and a.team_id = any(cfg.team_ids)
         and a.kind = 'work'
         and a.status = 'scheduled'
         and a.client_id is not null
         and a.date between to_char(now() - interval '1 day', 'YYYY-MM-DD')
                        and to_char(now() + interval '8 days', 'YYYY-MM-DD')
       where cfg.enabled
    loop
      select * into rule from public.sms_rule_for(r.tenant_id, r.team_id, ev);
      continue when not found or rule.timing is null;
      start_at := public.sms_appointment_start(r.id);
      continue when start_at is null
        or start_at <= now()
        or start_at > now() + make_interval(hours => rule.timing)
        or r.created_at > start_at - make_interval(hours => rule.timing);
      continue when exists (
        select 1 from public.sms_messages m
         where m.appointment_id = r.id
           and (
             (m.trigger_type = ev and m.for_start = start_at)
             or (m.trigger_type in ('new_appointment', 'reschedule')
                 and m.created_at > start_at - make_interval(hours => rule.timing))
           )
      );
      if public.sms_enqueue(r.id, ev) then
        n := n + 1;
      end if;
    end loop;
  end loop;

  -- «Пора повторить»: последний выполненный визит клиента был N месяцев
  -- назад (окно — неделя, чтобы старая история не ушла разом), будущей
  -- записи нет.
  for r in
    select a.id, a.tenant_id, a.team_id, a.client_id, a.date
      from public.tenant_sms_config cfg
      join public.appointments a
        on a.tenant_id = cfg.tenant_id
       and a.team_id = any(cfg.team_ids)
       and a.kind = 'work'
       and a.status = 'completed'
       and a.client_id is not null
       and a.date between to_char(now() - interval '25 months', 'YYYY-MM-DD')
                      and to_char(now() - interval '1 month', 'YYYY-MM-DD')
     where cfg.enabled
       and not exists (
         select 1 from public.sms_messages m
          where m.appointment_id = a.id and m.trigger_type = 'repeat'
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
    select * into rule from public.sms_rule_for(r.tenant_id, r.team_id, 'repeat');
    continue when not found or rule.timing is null;
    continue when not (
      r.date::date + make_interval(months => rule.timing) <= current_date
      and r.date::date + make_interval(months => rule.timing) > current_date - 7
    );
    if public.sms_enqueue(r.id, 'repeat') then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$function$;

/** Тик расписания: события по сроку — в очередь; зависшие отправки — в
 *  отказ с возвратом; есть что слать сейчас — разбудить функцию. */
create or replace function public.sms_tick()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  stuck record;
begin
  if not public.sms_service_on() then
    return;
  end if;
  perform public.sms_enqueue_due();
  for stuck in
    select id from public.sms_messages
     where status = 'sending' and created_at < now() - interval '15 minutes'
  loop
    perform public.sms_mark(stuck.id, 'failed', null, 'timeout', 'Отправка не завершилась');
  end loop;
  if exists (
    select 1 from public.sms_messages
     where status = 'queued' and (send_after is null or send_after <= now())
  ) then
    perform public.sms_wake();
  end if;
end;
$function$;

/** Забрать пачку очереди, которой пора. Текст события — из самого
 *  сообщения (снят с правила при постановке), ручного шаблона — из
 *  справочника. */
create or replace function public.sms_claim(p_limit integer default 20)
returns setof jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return query
  with picked as (
    select m.id
      from public.sms_messages m
     where m.status = 'queued'
       and (m.send_after is null or m.send_after <= now())
     order by coalesce(m.send_after, m.created_at)
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  ), claimed as (
    update public.sms_messages m
       set status = 'sending'
      from picked
     where m.id = picked.id
    returning m.*
  )
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'to_phone', c.to_phone,
    'body', c.message_body,
    'trigger_type', c.trigger_type,
    'template_body', coalesce(c.template_body, (
      select tpl ->> 'body'
        from public.tenant_state ts,
             jsonb_array_elements(coalesce(ts.prototype_state -> 'smsTemplates', '[]'::jsonb)) tpl
       where ts.tenant_id = c.tenant_id and tpl ->> 'id' = c.template_id
       limit 1
    )),
    'sender', (
      select case when cfg.sender_status = 'approved' then cfg.sender_name end
        from public.tenant_sms_config cfg where cfg.tenant_id = c.tenant_id
    ),
    'vars', jsonb_build_object(
      'name', coalesce(nullif(trim(cl.sms_name), ''), split_part(trim(coalesce(cl.full_name, '')), ' ', 1)),
      'date', a.date,
      'time', a.time_start,
      'calendar', t.name,
      'services', coalesce((
        select jsonb_agg(line ->> 'serviceName')
          from jsonb_array_elements(case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end) line
      ), '[]'::jsonb),
      'address', a.address,
      'total', a.total_amount,
      'company', tn.name,
      'currency', tn.currency
    )
  )
    from claimed c
    left join public.appointments a on a.id = c.appointment_id
    left join public.clients cl on cl.id = c.client_id
    left join public.teams t on t.tenant_id = c.tenant_id and t.id = coalesce(a.team_id, c.team_id)
    left join public.tenants tn on tn.id = c.tenant_id;
end;
$function$;

-- ─── Для приложения ─────────────────────────────────────────────────────

/** Кабинет SMS. Владельцу — всё: баланс, события компании и команд,
 *  тихие часы, счёт месяца по командам. Сотруднику — можно ли отправлять
 *  через сервис и в каких календарях (без денег компании). */
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
    'quiet_from', coalesce(cfg.quiet_from, 21),
    'quiet_to', coalesce(cfg.quiet_to, 8),
    -- События компании — с умолчаниями, чтобы экран не знал своих копий.
    'events', (
      select jsonb_agg(jsonb_build_object(
               'event', e.event,
               'mode', coalesce(r.mode, d.mode),
               'body', coalesce(nullif(r.body, ''), d.body),
               'timing', coalesce(r.timing, d.timing),
               'custom', r.body is not null and r.body <> d.body
             ) order by e.ord)
        from unnest(array['new_appointment', 'reminder', 'reminder_2', 'reschedule',
                          'cancellation', 'thank_you', 'repeat']) with ordinality e(event, ord)
        cross join lateral public.sms_rule_default(e.event) d
        left join public.sms_rules r on r.tenant_id = v_tenant and r.team_id = '' and r.event = e.event
    ),
    -- Свои правила команд: только то, что отличается от компании.
    'team_rules', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', r.team_id, 'event', r.event, 'mode', r.mode, 'body', r.body)
                       order by r.team_id, r.event)
        from public.sms_rules r
       where r.tenant_id = v_tenant and r.team_id <> ''
    ), '[]'::jsonb),
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
    ), '[]'::jsonb)
  );
end;
$function$;

/** Настройки SMS компании — только владелец и только эти поля. */
create or replace function public.sms_save_settings(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  teams text[];
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sms: bad settings' using errcode = '22023';
  end if;
  if p ? 'team_ids' then
    if jsonb_typeof(p -> 'team_ids') <> 'array' then
      raise exception 'sms: bad team_ids' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct t.id order by t.id), '{}')
      into teams
      from jsonb_array_elements_text(p -> 'team_ids') x(id)
      join public.teams t on t.tenant_id = v_tenant and t.id = x.id;
  end if;

  insert into public.tenant_sms_config (tenant_id) values (v_tenant)
  on conflict (tenant_id) do nothing;

  update public.tenant_sms_config set
    enabled = case when p ? 'enabled' then coalesce((p ->> 'enabled')::boolean, enabled) else enabled end,
    team_ids = case when p ? 'team_ids' then teams else team_ids end,
    quiet_from = case when p ? 'quiet_from' then (p ->> 'quiet_from')::integer else quiet_from end,
    quiet_to = case when p ? 'quiet_to' then (p ->> 'quiet_to')::integer else quiet_to end,
    updated_at = now()
  where tenant_id = v_tenant;

  return public.sms_account();
end;
$function$;

/** Правило события — только владелец. Команда '' — текст компании
 *  ('on'/'off', текст, срок); у команды: 'inherit' — как у компании,
 *  'on' — свой текст, 'off' — не отправлять. */
create or replace function public.sms_save_rule(
  p_team_id text,
  p_event text,
  p_mode text,
  p_body text default null,
  p_timing integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_team text := coalesce(p_team_id, '');
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  d record;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  select * into d from public.sms_rule_default(p_event);
  if not found then
    raise exception 'sms: bad event' using errcode = '22023';
  end if;
  if v_team <> '' and not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms: bad team' using errcode = '22023';
  end if;

  if v_team = '' then
    if p_mode not in ('on', 'off') then
      raise exception 'sms: bad mode' using errcode = '22023';
    end if;
    insert into public.sms_rules (tenant_id, team_id, event, mode, body, timing)
    values (v_tenant, '', p_event, p_mode, v_body, coalesce(p_timing, d.timing))
    on conflict (tenant_id, team_id, event) do update
       set mode = excluded.mode, body = excluded.body, timing = excluded.timing, updated_at = now();
  elsif p_mode = 'inherit' then
    delete from public.sms_rules where tenant_id = v_tenant and team_id = v_team and event = p_event;
  elsif p_mode in ('on', 'off') then
    if p_mode = 'on' and v_body is null then
      raise exception 'sms: empty body' using errcode = '22023';
    end if;
    insert into public.sms_rules (tenant_id, team_id, event, mode, body, timing)
    values (v_tenant, v_team, p_event, p_mode, case when p_mode = 'on' then v_body end, null)
    on conflict (tenant_id, team_id, event) do update
       set mode = excluded.mode, body = excluded.body, timing = null, updated_at = now();
  else
    raise exception 'sms: bad mode' using errcode = '22023';
  end if;

  return public.sms_account();
end;
$function$;

-- Прежняя история (два аргумента) уступает истории с отбором.
drop function if exists public.sms_history(timestamptz, integer);

/** История SMS компании — только владельцу; отбор по команде и событию. */
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
    'status', m.status,
    'trigger', m.trigger_type,
    'segments', m.segments,
    'cost_cents', m.cost_cents,
    'was_free', m.was_free,
    'error', m.error_message
  )
    from public.sms_messages m
    left join public.clients cl on cl.id = m.client_id
   where public.current_user_role() = 'owner'
     and m.tenant_id = public.current_tenant_id()
     and (p_before is null or m.created_at < p_before)
     and (p_team_id is null or m.team_id = p_team_id)
     and (p_trigger is null or m.trigger_type = p_trigger)
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$function$;

-- ─── Права вызова ───────────────────────────────────────────────────────

revoke all on function public.sms_rule_default(text) from public, anon, authenticated;
revoke all on function public.sms_rule_for(uuid, text, text) from public, anon, authenticated;
revoke all on function public.sms_quiet_shift(timestamptz, text, integer, integer) from public, anon, authenticated;
revoke all on function public.sms_appointment_tz(uuid) from public, anon, authenticated;
revoke all on function public.sms_appointment_end(uuid) from public, anon, authenticated;
revoke all on function public.sms_enqueue(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.appointments_sms_trigger() from public, anon, authenticated;
revoke all on function public.sms_enqueue_due() from public, anon, authenticated;
revoke all on function public.sms_tick() from public, anon, authenticated;
revoke all on function public.sms_claim(integer) from public, anon, authenticated;
grant execute on function public.sms_claim(integer) to service_role;

revoke all on function public.sms_account() from public, anon;
revoke all on function public.sms_save_settings(jsonb) from public, anon;
revoke all on function public.sms_save_rule(text, text, text, text, integer) from public, anon;
revoke all on function public.sms_history(timestamptz, integer, text, text) from public, anon;
grant execute on function public.sms_account() to authenticated;
grant execute on function public.sms_save_settings(jsonb) to authenticated;
grant execute on function public.sms_save_rule(text, text, text, text, integer) to authenticated;
grant execute on function public.sms_history(timestamptz, integer, text, text) to authenticated;

do $audit$
declare
  f text;
begin
  foreach f in array array[
    'public.sms_rule_for(uuid, text, text)', 'public.sms_enqueue(uuid, text, timestamptz)',
    'public.sms_enqueue_due()', 'public.sms_tick()', 'public.sms_claim(integer)',
    'public.sms_appointment_tz(uuid)', 'public.sms_appointment_end(uuid)'
  ] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'internal sms function % is callable from outside', f;
    end if;
  end loop;
  foreach f in array array[
    'public.sms_account()', 'public.sms_save_settings(jsonb)',
    'public.sms_save_rule(text, text, text, text, integer)',
    'public.sms_history(timestamptz, integer, text, text)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'sms function % is callable by anon', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.sms_rules', 'select')
     or has_table_privilege('anon', 'public.sms_rules', 'select') then
    raise exception 'sms_rules is readable directly';
  end if;
  if (select count(*) from pg_proc where proname in ('sms_enqueue', 'sms_history')
        and pronamespace = 'public'::regnamespace) <> 2 then
    raise exception 'sms_enqueue / sms_history left a second overload';
  end if;
end
$audit$;
