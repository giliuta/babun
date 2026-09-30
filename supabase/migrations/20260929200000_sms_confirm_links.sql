-- SMS, ВОЛНА 7 (STORY-089): ССЫЛКА «ПОДТВЕРДИТЬ / ОТМЕНИТЬ» В SMS.
--
-- Кипрские номера двусторонних SMS не принимают: ответить «да» клиент может
-- только ссылкой (разбор — STORY-089-sms-analysis.md, так у YCLIENTS,
-- Square, Vagaro, Jobber). В тексте SMS — поле [Ссылка]: короткий адрес
-- babun.app/r/<токен>. Клиент открывает страницу своей записи и жмёт
-- «Подтверждаю» или «Отменить запись».
--
--   • `appointment_links` — одна ссылка на запись (выдаётся при первой
--     нужде и дальше та же), ответ клиента и когда он был дан. Таблица
--     закрыта: читают и пишут только функции ниже.
--   • Токен — 12 знаков base62 (~71 бит): в SMS каждый знак — деньги,
--     кириллица и так 70 знаков на часть.
--   • `sms_claim` подставляет ссылку в поля (`vars.link`), только если в
--     тексте есть [Ссылка] / [Link] — ради обычного SMS запись не заводится.
--   • `sms_appointment_link` — ссылка для ручной отправки из записи (права
--     как у записи).
--   • `appointment_link_lookup` / `appointment_link_answer` — страница
--     клиента без входа (anon), как у ссылки «Куда приехать мастеру».
--     Ответ принимается, пока запись впереди и не отменена. «Отменить»
--     ставит записи статус «Отменена» с причиной — дальше работает обычная
--     цепочка отмены (SMS «Отмена», если она включена).

create table if not exists public.appointment_links (
  appointment_id uuid primary key references public.appointments(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  answer text,
  answered_at timestamptz,
  constraint appointment_links_answer_check check (answer is null or answer in ('confirmed', 'cancelled')),
  constraint appointment_links_token_len check (length(token) between 10 and 64)
);

comment on table public.appointment_links is
  'Ссылка «Подтвердить / Отменить» записи для SMS и ответ клиента (STORY-089). Только через функции.';

alter table public.appointment_links enable row level security;
revoke all on table public.appointment_links from anon, authenticated;

/** Токен ссылки: 12 знаков base62 из криптослучайных байтов. */
create or replace function public.appointment_link_token()
returns text
language plpgsql
volatile
set search_path to 'public', 'extensions'
as $function$
declare
  alphabet constant text := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  bytes bytea := gen_random_bytes(12);
  out text := '';
  i integer;
begin
  for i in 0..11 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % 62) + 1, 1);
  end loop;
  return out;
end;
$function$;

/** Ссылка записи — та же при каждом вызове; первая выдача заводит строку. */
create or replace function public.appointment_link_url(p_appointment uuid)
returns text
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
declare
  v_token text;
  v_tenant uuid;
begin
  select token into v_token from public.appointment_links where appointment_id = p_appointment;
  if found then
    return 'babun.app/r/' || v_token;
  end if;
  select tenant_id into v_tenant from public.appointments where id = p_appointment;
  if not found then
    return null;
  end if;
  insert into public.appointment_links (appointment_id, tenant_id, token)
  values (p_appointment, v_tenant, public.appointment_link_token())
  on conflict (appointment_id) do nothing;
  select token into v_token from public.appointment_links where appointment_id = p_appointment;
  return 'babun.app/r/' || v_token;
end;
$function$;

/** Забрать пачку очереди, которой пора (как в 20260925020000), плюс ссылка
 *  «Подтвердить / Отменить», когда текст её просит. */
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

/** Ссылка для ручной отправки из записи — права как у записи. */
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
  return public.appointment_link_url(p_appointment_id);
end;
$function$;

/** Страница клиента: что за запись и можно ли ещё ответить. */
create or replace function public.appointment_link_lookup(p_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  r record;
  start_at timestamptz;
begin
  if p_token is null or length(p_token) not between 10 and 64 then
    return jsonb_build_object('state', 'missing');
  end if;
  select l.appointment_id, l.answer, l.answered_at,
         a.status, a.date, a.time_start, a.address, a.services,
         tn.name as business_name, tn.logo_url,
         coalesce(nullif(trim(cl.sms_name), ''), split_part(trim(coalesce(cl.full_name, '')), ' ', 1)) as first_name
    into r
    from public.appointment_links l
    join public.appointments a on a.id = l.appointment_id
    join public.tenants tn on tn.id = l.tenant_id
    left join public.clients cl on cl.id = a.client_id
   where l.token = p_token;
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  start_at := public.sms_appointment_start(r.appointment_id);
  return jsonb_build_object(
    'state', case
      when r.status = 'cancelled' then 'cancelled'
      when r.answer = 'confirmed' then 'confirmed'
      when start_at is null or start_at <= now() or r.status <> 'scheduled' then 'past'
      else 'pending' end,
    'business_name', r.business_name,
    'logo_url', r.logo_url,
    'client_first_name', r.first_name,
    'date', r.date,
    'time', left(r.time_start, 5),
    'address', r.address,
    'services', coalesce((
      select jsonb_agg(line ->> 'serviceName')
        from jsonb_array_elements(case when jsonb_typeof(r.services) = 'array' then r.services else '[]'::jsonb end) line
       where coalesce(line ->> 'serviceName', '') <> ''
    ), '[]'::jsonb),
    'answered_at', r.answered_at
  );
end;
$function$;

/** Ответ клиента. 'confirmed' — отметка; 'cancelled' — запись отменяется.
 *  Отвечать можно, пока запись впереди и не отменена; повторное
 *  «Подтверждаю» — не ошибка. */
create or replace function public.appointment_link_answer(p_token text, p_answer text)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
declare
  l public.appointment_links%rowtype;
  a record;
  start_at timestamptz;
begin
  if p_answer not in ('confirmed', 'cancelled') then
    raise exception 'link: bad answer' using errcode = '22023';
  end if;
  select * into l from public.appointment_links where token = p_token for update;
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  select id, status into a from public.appointments where id = l.appointment_id for update;
  start_at := public.sms_appointment_start(l.appointment_id);
  if a.status = 'cancelled' then
    return public.appointment_link_lookup(p_token);
  end if;
  if a.status <> 'scheduled' or start_at is null or start_at <= now() then
    return public.appointment_link_lookup(p_token);
  end if;

  update public.appointment_links
     set answer = p_answer, answered_at = now()
   where appointment_id = l.appointment_id;
  if p_answer = 'cancelled' then
    update public.appointments
       set status = 'cancelled',
           cancel_reason = coalesce(nullif(cancel_reason, ''), 'Клиент отменил по ссылке из SMS')
     where id = l.appointment_id;
  end if;
  return public.appointment_link_lookup(p_token);
end;
$function$;

-- Ответ клиента — в блоке SMS записи.
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
    'confirm_body', coalesce(
      (select nullif(r.body, '') from public.sms_rules r
        where r.tenant_id = v_tenant and r.team_id = coalesce(a.team_id, '') and r.team_id <> ''
          and r.event = 'new_appointment' and r.mode = 'on'),
      (select nullif(r.body, '') from public.sms_rules r
        where r.tenant_id = v_tenant and r.team_id = '' and r.event = 'new_appointment'),
      (select d.body from public.sms_rule_default('new_appointment') d)
    ),
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

-- ─── Права вызова ───────────────────────────────────────────────────────

revoke all on function public.appointment_link_token() from public, anon, authenticated;
revoke all on function public.appointment_link_url(uuid) from public, anon, authenticated;
revoke all on function public.sms_claim(integer) from public, anon, authenticated;
grant execute on function public.sms_claim(integer) to service_role;
revoke all on function public.sms_appointment_link(uuid) from public, anon;
grant execute on function public.sms_appointment_link(uuid) to authenticated;
-- Страница клиента — без входа, как «Куда приехать мастеру».
revoke all on function public.appointment_link_lookup(text) from public;
revoke all on function public.appointment_link_answer(text, text) from public;
grant execute on function public.appointment_link_lookup(text) to anon, authenticated;
grant execute on function public.appointment_link_answer(text, text) to anon, authenticated;

do $audit$
begin
  if has_function_privilege('anon', 'public.appointment_link_url(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.appointment_link_url(uuid)', 'execute')
     or has_function_privilege('anon', 'public.sms_appointment_link(uuid)', 'execute')
     or has_function_privilege('anon', 'public.sms_claim(integer)', 'execute')
     or has_table_privilege('anon', 'public.appointment_links', 'select')
     or has_table_privilege('authenticated', 'public.appointment_links', 'select') then
    raise exception 'appointment links: wrong grants';
  end if;
end
$audit$;
