-- SMS, ВОЛНА 2 (STORY-089): ОТПРАВКА ЧЕРЕЗ СЕРВИС — МОЗГ В БАЗЕ.
--
-- Владелец 24.09: «автоматически… через специальный сервис»; «он может
-- разрешать отправлять с этой командой СМС или не отправлять»; «видит сумму
-- баланса… и с его счёта просто списывается за каждую СМС».
--
-- РАЗДЕЛЕНИЕ РАБОТЫ. База решает всё: кому, когда, по какому шаблону, можно
-- ли, хватает ли денег. Функция `send_sms` только забирает очередь,
-- подставляет поля в текст (тот же код, что в приложении) и отдаёт Twilio.
--
--   • Очередь — `sms_messages` со статусом 'queued'. Пишут её:
--       - триггер записи: новая запись → 'new_appointment', отмена →
--         'cancellation';
--       - расписание раз в 5 минут: напоминание за N часов → 'reminder'
--         (тихие часы 21:00–08:00 по времени календаря — ждём утра);
--       - `sms_send_manual` — «Отправить через сервис» из листа «SMS».
--     После записи в очередь база будит функцию (`sms_wake`, pg_net уходит
--     после коммита). Пустая очередь функцию не будит вовсе: прежнее
--     расписание дёргало её каждые 5 минут впустую.
--   • Отправляет только разрешённое: общий выключатель платформы
--     (`app_settings.sms_enabled`), выключатель компании, календарь записи
--     среди разрешённых владельцем, у клиента есть номер, клиент не
--     отказался от SMS и не в чёрном списке, запись в будущем.
--   • Деньги — за ЧАСТЬ SMS (кириллица — 70 знаков на часть), цена части —
--     одно число в `app_settings.sms_price_cents_per_segment`. Сначала
--     тратятся бесплатные части, потом баланс; не хватает — сообщение
--     'blocked', без долга. Отказ Twilio возвращает списанное.
--
-- ЗАКРЫТЫ ДВЕ ДЫРЫ СТАРОЙ ЗАГОТОВКИ:
--   • журнал SMS (`sms_messages`, `sms_logs`) читал любой член компании —
--     номера и тексты клиентов; теперь история — только владельцу, RPC;
--   • `tenant_sms_config_owner_update` пускал владельца править строку
--     целиком, включая `balance_cents`: баланс можно было «пополнить»
--     одним UPDATE. Теперь настройки — только через `sms_save_settings`,
--     баланс меняют только списание и оплата.

-- ─── Цена и настройки ───────────────────────────────────────────────────

insert into public.app_settings (key, value, updated_at)
values ('sms_price_cents_per_segment', '10', now())
on conflict (key) do nothing;

alter table public.tenant_sms_config
  add column if not exists team_ids text[] not null default '{}',
  add column if not exists auto_new_template text,
  add column if not exists auto_reminder_template text,
  add column if not exists auto_cancel_template text,
  add column if not exists reminder_hours integer not null default 24;

alter table public.tenant_sms_config
  drop constraint if exists tenant_sms_config_reminder_hours_check,
  add constraint tenant_sms_config_reminder_hours_check
    check (reminder_hours between 1 and 168),
  drop constraint if exists tenant_sms_config_money_nonnegative,
  add constraint tenant_sms_config_money_nonnegative
    check (balance_cents >= 0 and free_sms_remaining >= 0);

drop policy if exists tenant_sms_config_owner_insert on public.tenant_sms_config;
drop policy if exists tenant_sms_config_owner_update on public.tenant_sms_config;
drop policy if exists sms_messages_tenant_select on public.sms_messages;
drop policy if exists sms_logs_select_member on public.sms_logs;

alter table public.clients
  add column if not exists sms_opt_out boolean not null default false;

comment on column public.clients.sms_opt_out is
  'Клиент просил не присылать SMS: сервис ему не пишет ни автоматически, ни вручную (STORY-089).';

-- ─── Журнал: одна таблица на всё ────────────────────────────────────────

alter table public.sms_messages
  add column if not exists segments integer,
  add column if not exists cost_cents integer not null default 0,
  add column if not exists was_free boolean not null default false,
  add column if not exists template_id text,
  add column if not exists team_id text,
  add column if not exists sent_by uuid;

alter table public.sms_messages alter column message_body drop not null;

alter table public.sms_messages
  drop constraint if exists sms_messages_status_check,
  add constraint sms_messages_status_check check (status = any (array[
    'queued', 'sending', 'sent', 'delivered', 'failed', 'undelivered', 'blocked'
  ])),
  drop constraint if exists sms_messages_trigger_type_check,
  add constraint sms_messages_trigger_type_check check (trigger_type = any (array[
    'reminder_24h', 'reminder_2h', 'manual', 'test',
    'new_appointment', 'reminder', 'cancellation'
  ]));

-- Автоматическое — не больше одного на запись и повод; ручных — сколько
-- угодно (прежний индекс запрещал и второе ручное SMS по той же записи).
drop index if exists public.uniq_sms_messages_appointment_trigger;
create unique index uniq_sms_messages_appointment_trigger
  on public.sms_messages (appointment_id, trigger_type)
  where appointment_id is not null and trigger_type <> 'manual';

create index if not exists idx_sms_messages_queue
  on public.sms_messages (created_at)
  where status in ('queued', 'sending');

-- ─── Внутренние помощники (наружу не торчат) ────────────────────────────

create or replace function public.sms_price_cents()
returns integer
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_price_cents_per_segment'),
    10
  )
$function$;

create or replace function public.sms_service_on()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce((select value from public.app_settings where key = 'sms_enabled'), 'off') = 'on'
$function$;

/** Начало записи как момент времени — в поясе её календаря, иначе компании. */
create or replace function public.sms_appointment_start(p_appointment uuid)
returns timestamptz
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  result timestamptz;
begin
  select (a.date || ' ' || left(a.time_start, 5))::timestamp at time zone coalesce(
           nullif(t.timezone, ''),
           nullif(cs.timezone, ''),
           'Europe/Nicosia'
         )
    into result
    from public.appointments a
    left join public.teams t on t.tenant_id = a.tenant_id and t.id = a.team_id
    left join public.calendar_settings cs on cs.tenant_id = a.tenant_id
   where a.id = p_appointment;
  return result;
exception when others then
  return null;
end;
$function$;

/** Будит функцию отправки. pg_net шлёт запрос после коммита. */
create or replace function public.sms_wake()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform net.http_post(
    url := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/send_sms',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select secret from public.edge_cron_secrets where name = 'send_sms')
    )
  );
exception when others then
  -- Не разбудили — очередь заберёт расписание через 5 минут.
  raise warning 'sms_wake: %', sqlerrm;
end;
$function$;

/** Поставить автоматическое SMS по записи в очередь. Истина — если
 *  поставлено. Любое «нельзя» — тихое «нет»: запись от этого не падает. */
create or replace function public.sms_enqueue(p_appointment uuid, p_trigger text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  cfg public.tenant_sms_config%rowtype;
  tpl text;
  c record;
  phone text;
  start_at timestamptz;
  inserted uuid;
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

  tpl := case p_trigger
    when 'new_appointment' then cfg.auto_new_template
    when 'reminder' then cfg.auto_reminder_template
    when 'cancellation' then cfg.auto_cancel_template
  end;
  if tpl is null or tpl = '' then
    return false;
  end if;

  -- Прошлое не извещаем: запись задним числом и отмена вчерашней — не
  -- повод писать клиенту.
  start_at := public.sms_appointment_start(a.id);
  if start_at is null or start_at <= now() then
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
    trigger_type, template_id, status, mode
  ) values (
    a.tenant_id, a.id, a.client_id, a.team_id, phone,
    p_trigger, tpl, 'queued', 'platform'
  )
  on conflict (appointment_id, trigger_type)
    where appointment_id is not null and trigger_type <> 'manual'
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
begin
  begin
    if tg_op = 'INSERT' and new.kind = 'work' and new.status = 'scheduled' then
      queued := public.sms_enqueue(new.id, 'new_appointment');
    elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      queued := public.sms_enqueue(new.id, 'cancellation');
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
  after insert or update of status on public.appointments
  for each row execute function public.appointments_sms_trigger();

/** Напоминания, которым пора: запись в окне «за N часов», напоминания ещё
 *  не было, и запись заведена РАНЬШЕ этого окна (заведённую за час до
 *  начала закрывает подтверждение). Тихие часы — 21:00–08:00 в поясе
 *  календаря: ждём утра, если начало ещё впереди. */
create or replace function public.sms_enqueue_due()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  start_at timestamptz;
  local_hour integer;
  n integer := 0;
begin
  if not public.sms_service_on() then
    return 0;
  end if;
  for r in
    select a.id, a.created_at, cfg.reminder_hours,
           coalesce(nullif(t.timezone, ''), nullif(cs.timezone, ''), 'Europe/Nicosia') as tz
      from public.tenant_sms_config cfg
      join public.appointments a
        on a.tenant_id = cfg.tenant_id
       and a.team_id = any(cfg.team_ids)
       and a.kind = 'work'
       and a.status = 'scheduled'
       and a.client_id is not null
       and a.date between to_char(now() - interval '1 day', 'YYYY-MM-DD')
                      and to_char(now() + interval '8 days', 'YYYY-MM-DD')
      left join public.teams t on t.tenant_id = a.tenant_id and t.id = a.team_id
      left join public.calendar_settings cs on cs.tenant_id = a.tenant_id
     where cfg.enabled
       and coalesce(cfg.auto_reminder_template, '') <> ''
       and not exists (
         select 1 from public.sms_messages m
          where m.appointment_id = a.id and m.trigger_type = 'reminder'
       )
  loop
    start_at := public.sms_appointment_start(r.id);
    continue when start_at is null
      or start_at <= now()
      or start_at > now() + make_interval(hours => r.reminder_hours)
      or r.created_at > start_at - make_interval(hours => r.reminder_hours);
    begin
      local_hour := extract(hour from now() at time zone r.tz);
    exception when others then
      local_hour := 12;
    end;
    continue when local_hour < 8 or local_hour >= 21;
    if public.sms_enqueue(r.id, 'reminder') then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$function$;

/** Тик расписания: напоминания в очередь; зависшие отправки — в отказ с
 *  возвратом; если очередь не пуста — разбудить функцию. */
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
  if exists (select 1 from public.sms_messages where status = 'queued') then
    perform public.sms_wake();
  end if;
end;
$function$;

-- ─── Для функции отправки (только service_role) ─────────────────────────

/** Забрать пачку очереди. Возвращает всё, что нужно, чтобы собрать текст
 *  тем же кодом, что в приложении: текст шаблона и поля записи. */
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
     order by m.created_at
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
    'template_body', (
      select tpl ->> 'body'
        from public.tenant_state ts,
             jsonb_array_elements(coalesce(ts.prototype_state -> 'smsTemplates', '[]'::jsonb)) tpl
       where ts.tenant_id = c.tenant_id and tpl ->> 'id' = c.template_id
       limit 1
    ),
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

/** Списать за сообщение: сначала бесплатные части, потом баланс.
 *  'free' | 'paid' — можно слать; 'no_funds' — сообщение 'blocked';
 *  'gone' — сообщения нет или оно уже не в отправке. */
create or replace function public.sms_charge(p_id uuid, p_body text, p_segments integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.sms_messages%rowtype;
  cfg public.tenant_sms_config%rowtype;
  segs integer := greatest(1, coalesce(p_segments, 1));
  cost integer;
begin
  select * into m from public.sms_messages where id = p_id for update;
  if not found or m.status <> 'sending' then
    return 'gone';
  end if;
  select * into cfg from public.tenant_sms_config where tenant_id = m.tenant_id for update;
  if not found then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'no_config', error_message = 'SMS у компании не настроены'
     where id = p_id;
    return 'no_funds';
  end if;

  cost := segs * public.sms_price_cents();
  if cfg.free_sms_remaining >= segs then
    update public.tenant_sms_config
       set free_sms_remaining = free_sms_remaining - segs,
           total_sent_count = total_sent_count + 1,
           updated_at = now()
     where tenant_id = m.tenant_id;
    update public.sms_messages
       set message_body = p_body, segments = segs, cost_cents = 0, was_free = true
     where id = p_id;
    return 'free';
  elsif cfg.balance_cents >= cost then
    update public.tenant_sms_config
       set balance_cents = balance_cents - cost,
           total_sent_count = total_sent_count + 1,
           updated_at = now()
     where tenant_id = m.tenant_id;
    update public.sms_messages
       set message_body = p_body, segments = segs, cost_cents = cost, was_free = false
     where id = p_id;
    return 'paid';
  end if;

  update public.sms_messages
     set status = 'blocked', message_body = p_body, segments = segs,
         error_code = 'no_funds', error_message = 'Не хватило баланса'
   where id = p_id;
  return 'no_funds';
end;
$function$;

/** Итог отправки. Отказ возвращает списанное — бесплатные части или деньги. */
create or replace function public.sms_mark(
  p_id uuid,
  p_status text,
  p_sid text,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.sms_messages%rowtype;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'sms_mark: bad status %', p_status using errcode = '22023';
  end if;
  select * into m from public.sms_messages where id = p_id for update;
  if not found or m.status <> 'sending' then
    return;
  end if;
  if p_status = 'sent' then
    update public.sms_messages
       set status = 'sent', twilio_sid = nullif(p_sid, ''), error_code = null, error_message = null
     where id = p_id;
    return;
  end if;
  update public.sms_messages
     set status = 'failed', error_code = p_error_code, error_message = left(p_error_message, 500)
   where id = p_id;
  if m.segments is not null then
    update public.tenant_sms_config
       set free_sms_remaining = free_sms_remaining + case when m.was_free then m.segments else 0 end,
           balance_cents = balance_cents + case when m.was_free then 0 else m.cost_cents end,
           total_sent_count = greatest(0, total_sent_count - 1),
           updated_at = now()
     where tenant_id = m.tenant_id;
    update public.sms_messages set cost_cents = 0 where id = p_id;
  end if;
end;
$function$;

/** Оплата пополнения: запись и зачисление — одной транзакцией. Повтор той
 *  же оплаты ничего не делает (UNIQUE по платёжному намерению). */
create or replace function public.sms_credit_topup(
  p_tenant uuid,
  p_amount_cents integer,
  p_session text,
  p_payment_intent text,
  p_pack text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted uuid;
begin
  if p_amount_cents is null or p_amount_cents <= 0 or p_payment_intent is null then
    raise exception 'sms_credit_topup: bad payment' using errcode = '22023';
  end if;
  insert into public.sms_topups (
    tenant_id, amount_cents, credits_added, pack_label,
    stripe_session_id, stripe_payment_intent_id, status, completed_at
  ) values (
    p_tenant, p_amount_cents, p_amount_cents / greatest(1, public.sms_price_cents()), p_pack,
    p_session, p_payment_intent, 'completed', now()
  )
  on conflict (stripe_payment_intent_id) do nothing
  returning id into inserted;
  if inserted is null then
    return false;
  end if;
  insert into public.tenant_sms_config (tenant_id, balance_cents)
  values (p_tenant, p_amount_cents)
  on conflict (tenant_id) do update
     set balance_cents = public.tenant_sms_config.balance_cents + excluded.balance_cents,
         updated_at = now();
  return true;
end;
$function$;

-- ─── Для приложения ─────────────────────────────────────────────────────

/** Кабинет SMS. Владельцу — всё; сотруднику — можно ли отправлять через
 *  сервис и в каких календарях (без баланса: это деньги компании). */
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
    'auto_new_template', cfg.auto_new_template,
    'auto_reminder_template', cfg.auto_reminder_template,
    'auto_cancel_template', cfg.auto_cancel_template,
    'reminder_hours', coalesce(cfg.reminder_hours, 24),
    'sender', case when cfg.sender_status = 'approved' then cfg.sender_name else 'Babun' end,
    'month_count', (
      select count(*) from public.sms_messages m
       where m.tenant_id = v_tenant and m.status in ('sending', 'sent', 'delivered')
         and m.created_at >= date_trunc('month', now())
    ),
    'month_cents', (
      select coalesce(sum(m.cost_cents), 0) from public.sms_messages m
       where m.tenant_id = v_tenant and m.status in ('sending', 'sent', 'delivered')
         and m.created_at >= date_trunc('month', now())
    )
  );
end;
$function$;

/** Настройки SMS компании — только владелец и только эти поля. Баланс
 *  отсюда не меняется. */
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
    auto_new_template = case when p ? 'auto_new_template' then nullif(p ->> 'auto_new_template', '') else auto_new_template end,
    auto_reminder_template = case when p ? 'auto_reminder_template' then nullif(p ->> 'auto_reminder_template', '') else auto_reminder_template end,
    auto_cancel_template = case when p ? 'auto_cancel_template' then nullif(p ->> 'auto_cancel_template', '') else auto_cancel_template end,
    reminder_hours = case when p ? 'reminder_hours' then (p ->> 'reminder_hours')::integer else reminder_hours end,
    updated_at = now()
  where tenant_id = v_tenant;

  return public.sms_account();
end;
$function$;

/** История SMS компании — только владельцу. */
create or replace function public.sms_history(p_before timestamptz default null, p_limit integer default 50)
returns setof jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', m.id,
    'created_at', m.created_at,
    'to_phone', m.to_phone,
    'client_id', m.client_id,
    'client_name', cl.full_name,
    'appointment_id', m.appointment_id,
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
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
$function$;

/** «Отправить через сервис» из листа «SMS». По записи — тот, кому открыт
 *  её календарь, и только если владелец разрешил SMS в этом календаре; из
 *  карточки без записи — только владелец. Текст — тот, что человек видел. */
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
  cfg public.tenant_sms_config%rowtype;
  a record;
  v_client uuid := p_client_id;
  v_team text;
  c record;
  phone text;
  v_body text := trim(coalesce(p_body, ''));
  v_id uuid;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not public.sms_service_on() then
    raise exception 'sms:service_off' using errcode = 'P0001';
  end if;
  select * into cfg from public.tenant_sms_config where tenant_id = v_tenant;
  if not found or not cfg.enabled then
    raise exception 'sms:disabled' using errcode = 'P0001';
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
    if v_team is null or not (v_team = any(cfg.team_ids)) then
      raise exception 'sms:calendar' using errcode = 'P0001';
    end if;
    -- Календарь, который человек видит, — тем же правилом, что окно записей
    -- (`list_master_appointments_safe`): прикреплённый живой календарь.
    if not is_owner
       and not (v_team = any(public.current_user_calendar_ids('view'))
                or v_team = any(public.current_user_team_ids())) then
      raise exception 'sms:rights' using errcode = '42501';
    end if;
  elsif not is_owner then
    raise exception 'sms:rights' using errcode = '42501';
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
  if cfg.free_sms_remaining <= 0 and cfg.balance_cents < public.sms_price_cents() then
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

/** Клиент просил не присылать SMS. Правит тот, кто правит клиента. */
create or replace function public.set_client_sms_opt_out(p_client_id uuid, p_value boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not coalesce(public.current_user_can_edit_client(p_client_id), false) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  update public.clients
     set sms_opt_out = coalesce(p_value, false)
   where id = p_client_id and tenant_id = public.current_tenant_id();
  return coalesce(p_value, false);
end;
$function$;

-- ─── Расписание ─────────────────────────────────────────────────────────

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'sms_reminder_check') then
    perform cron.unschedule('sms_reminder_check');
  end if;
  if exists (select 1 from cron.job where jobname = 'sms_tick') then
    perform cron.unschedule('sms_tick');
  end if;
  perform cron.schedule('sms_tick', '*/5 * * * *', 'select public.sms_tick()');
end
$cron$;

-- ─── Права вызова ───────────────────────────────────────────────────────

revoke all on function public.sms_price_cents() from public, anon, authenticated;
revoke all on function public.sms_service_on() from public, anon, authenticated;
revoke all on function public.sms_appointment_start(uuid) from public, anon, authenticated;
revoke all on function public.sms_wake() from public, anon, authenticated;
revoke all on function public.sms_enqueue(uuid, text) from public, anon, authenticated;
revoke all on function public.appointments_sms_trigger() from public, anon, authenticated;
revoke all on function public.sms_enqueue_due() from public, anon, authenticated;
revoke all on function public.sms_tick() from public, anon, authenticated;
revoke all on function public.sms_claim(integer) from public, anon, authenticated;
revoke all on function public.sms_charge(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.sms_mark(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.sms_credit_topup(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.sms_claim(integer) to service_role;
grant execute on function public.sms_charge(uuid, text, integer) to service_role;
grant execute on function public.sms_mark(uuid, text, text, text, text) to service_role;
grant execute on function public.sms_credit_topup(uuid, integer, text, text, text) to service_role;

revoke all on function public.sms_account() from public, anon;
revoke all on function public.sms_save_settings(jsonb) from public, anon;
revoke all on function public.sms_history(timestamptz, integer) from public, anon;
revoke all on function public.sms_send_manual(uuid, uuid, text, text) from public, anon;
revoke all on function public.set_client_sms_opt_out(uuid, boolean) from public, anon;
grant execute on function public.sms_account() to authenticated;
grant execute on function public.sms_save_settings(jsonb) to authenticated;
grant execute on function public.sms_history(timestamptz, integer) to authenticated;
grant execute on function public.sms_send_manual(uuid, uuid, text, text) to authenticated;
grant execute on function public.set_client_sms_opt_out(uuid, boolean) to authenticated;

-- Старое чтение настроек — с шаблонами {client_name} и без баланса — снято:
-- его место занял `sms_account`.
revoke all on function public.read_tenant_sms_config_safe() from public, anon, authenticated;
revoke all on function public.tenant_sms_summary() from public, anon, authenticated;

do $audit$
declare
  f text;
begin
  foreach f in array array[
    'public.sms_wake()', 'public.sms_enqueue(uuid, text)', 'public.sms_tick()',
    'public.sms_claim(integer)', 'public.sms_charge(uuid, text, integer)',
    'public.sms_mark(uuid, text, text, text, text)',
    'public.sms_credit_topup(uuid, integer, text, text, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'internal sms function % is callable from outside', f;
    end if;
  end loop;
  foreach f in array array[
    'public.sms_account()', 'public.sms_save_settings(jsonb)', 'public.sms_history(timestamptz, integer)',
    'public.sms_send_manual(uuid, uuid, text, text)', 'public.set_client_sms_opt_out(uuid, boolean)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'sms function % is callable by anon', f;
    end if;
  end loop;
  if exists (select 1 from pg_policies where tablename in ('sms_messages', 'sms_logs')
               and policyname in ('sms_messages_tenant_select', 'sms_logs_select_member')) then
    raise exception 'sms journal is still readable by every member';
  end if;
  if exists (select 1 from pg_policies where tablename = 'tenant_sms_config'
               and policyname in ('tenant_sms_config_owner_insert', 'tenant_sms_config_owner_update')) then
    raise exception 'owner can still write the sms config row directly';
  end if;
end
$audit$;
