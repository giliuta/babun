-- SMS, ВОЛНА 10 (STORY-089): ИМЯ ОТПРАВИТЕЛЯ У КАЖДОЙ КОМАНДЫ, БЕЗ БЕСПЛАТНЫХ.
--
-- Владелец 29.09: «уберём бесплатные сообщения от Babun… от какого имени
-- отправляется — в каждой команде, можно написать имя».
--   • `sms_team_senders` — имя отправителя команды: так SMS подписана в
--     телефоне клиента. На Кипре буквенное имя не регистрируется заранее
--     (Twilio: Cyprus — pre-registration not required, dynamic supported),
--     поэтому имя действует сразу. Формат — как у операторов: до 11 знаков,
--     латиница, цифры, пробел, хотя бы одна буква.
--   • Без имени команда не отправляет: автоматическая SMS не ставится в
--     очередь, ручная отказывает «sms:sender». Подписи «Babun» больше нет.
--   • Через сервис SMS уходит только по записи — команда записи и даёт имя.
--     Из карточки без записи — «С телефона».
--   • Бесплатных SMS нет: остаток обнулён, новым компаниям не выдаётся.

-- ─── Бесплатные — долой ────────────────────────────────────────────────

alter table public.tenant_sms_config alter column free_sms_remaining set default 0;
update public.tenant_sms_config set free_sms_remaining = 0 where free_sms_remaining <> 0;

create or replace function public.bump_sms_balance(p_tenant_id uuid, p_amount_cents integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_balance integer;
begin
  if p_amount_cents <= 0 then
    return json_build_object('error', 'amount_must_be_positive');
  end if;

  insert into public.tenant_sms_config (tenant_id, balance_cents, free_sms_remaining)
  values (p_tenant_id, p_amount_cents, 0)
  on conflict (tenant_id) do update
    set balance_cents = tenant_sms_config.balance_cents + p_amount_cents
  returning balance_cents into v_balance;

  return json_build_object('balance_cents', v_balance);
end;
$function$;

-- ─── Имя отправителя команды ────────────────────────────────────────────

create table if not exists public.sms_team_senders (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  team_id text not null,
  sender_name text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, team_id),
  constraint sms_team_senders_name_check
    check (sender_name ~ '^[A-Za-z0-9 ]{1,11}$' and sender_name ~ '[A-Za-z]' and sender_name = trim(sender_name))
);

comment on table public.sms_team_senders is
  'Имя отправителя SMS команды (STORY-089, 29.09). Только через RPC.';

alter table public.sms_team_senders enable row level security;
revoke all on table public.sms_team_senders from anon, authenticated;

/** Имя отправителя команды или null. */
create or replace function public.sms_team_sender(p_tenant uuid, p_team text)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select s.sender_name from public.sms_team_senders s
   where s.tenant_id = p_tenant and s.team_id = p_team
$function$;

/** Сохранить имя отправителя команды; пусто — снять. Только владелец. */
create or replace function public.sms_save_team_sender(p_team_id text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms: owner only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = p_team_id) then
    raise exception 'sms: bad team' using errcode = '22023';
  end if;
  if v_name = '' then
    delete from public.sms_team_senders where tenant_id = v_tenant and team_id = p_team_id;
    return public.sms_account();
  end if;
  if not (v_name ~ '^[A-Za-z0-9 ]{1,11}$' and v_name ~ '[A-Za-z]') then
    raise exception 'sms:sender_format' using errcode = '22023';
  end if;
  insert into public.sms_team_senders (tenant_id, team_id, sender_name)
  values (v_tenant, p_team_id, v_name)
  on conflict (tenant_id, team_id) do update set sender_name = excluded.sender_name, updated_at = now();
  return public.sms_account();
end;
$function$;

-- ─── Постановка: без имени команда не отправляет ────────────────────────

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
  -- Без имени отправителя команда не отправляет (волна 10).
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

/** Вручную через сервис — только по записи: команда записи даёт имя
 *  отправителя. Без записи — «С телефона». */
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
  v_client uuid;
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
  if cfg.balance_cents < public.sms_price_cents() then
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

-- ─── Отправка: подпись — имя команды сообщения ──────────────────────────

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
  ), texts as (
    select c.*,
           coalesce(c.template_body, (
             select tpl ->> 'body'
               from public.tenant_state ts,
                    jsonb_array_elements(coalesce(ts.prototype_state -> 'smsTemplates', '[]'::jsonb)) tpl
              where ts.tenant_id = c.tenant_id and tpl ->> 'id' = c.template_id
              limit 1
           )) as tpl_text
      from claimed c
  )
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'to_phone', c.to_phone,
    'body', c.message_body,
    'trigger_type', c.trigger_type,
    'template_body', c.tpl_text,
    'sender', public.sms_team_sender(c.tenant_id, coalesce(a.team_id, c.team_id)),
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
      'currency', tn.currency,
      'link', case
        when c.appointment_id is not null and coalesce(c.tpl_text, '') ~ '\[(Ссылка|Link)\]'
          then public.appointment_link_url(c.appointment_id)
      end
    )
  )
    from texts c
    left join public.appointments a on a.id = c.appointment_id
    left join public.clients cl on cl.id = c.client_id
    left join public.teams t on t.tenant_id = c.tenant_id and t.id = coalesce(a.team_id, c.team_id)
    left join public.tenants tn on tn.id = c.tenant_id;
end;
$function$;

-- ─── Кабинет: имена команд, без бесплатных ──────────────────────────────

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
    'can_pay', coalesce(cfg.balance_cents, 0) >= price,
    -- Имя отправителя каждой команды: без него команда не отправляет.
    'senders', coalesce((
      select jsonb_object_agg(s.team_id, s.sender_name)
        from public.sms_team_senders s where s.tenant_id = v_tenant
    ), '{}'::jsonb)
  );
  if not is_owner then
    return base;
  end if;
  return base || jsonb_build_object(
    'balance_cents', coalesce(cfg.balance_cents, 0),
    'free_left', 0,
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

-- ─── Права ──────────────────────────────────────────────────────────────

revoke all on function public.sms_team_sender(uuid, text) from public, anon, authenticated;
revoke all on function public.sms_save_team_sender(text, text) from public, anon;
grant execute on function public.sms_save_team_sender(text, text) to authenticated;
revoke all on function public.bump_sms_balance(uuid, integer) from public, anon, authenticated;

do $audit$
begin
  if has_function_privilege('anon', 'public.sms_save_team_sender(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.sms_team_sender(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.bump_sms_balance(uuid, integer)', 'execute')
     or has_table_privilege('authenticated', 'public.sms_team_senders', 'select') then
    raise exception 'sms senders: wrong grants';
  end if;
end
$audit$;
