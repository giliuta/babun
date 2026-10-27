-- ОНЛАЙН-ЗАПИСЬ (идея №2 из docs/ideas/033): ПУБЛИЧНАЯ СТРАНИЦА babun.app/b/<токен>. Накачена 27.10.2026, md5 тел = файлу.
--
-- Заказчик без входа выбирает услугу, видит свободные окна на две недели
-- вперёд и оставляет имя и телефон. Запись падает в календарь команды с
-- пометкой «онлайн» (`source = 'online'`, `is_online_booking`, заметка
-- «Онлайн-запись»), клиент находится по номеру или заводится.
--
--   • `online_booking_pages` — одна страница на календарь: токен и
--     выключатель. Таблица закрыта: читают и пишут только функции ниже.
--     Токен выдаётся при первом включении и дальше тот же — ссылка в
--     Instagram и на визитке не ломается от «выключил и включил».
--   • Какие услуги видны — `services.online_enabled` (по умолчанию ложь:
--     публикация прайса — решение человека, см. 20260824140000).
--   • `online_booking_page` / `online_booking_slots` / `online_booking_create` —
--     страница заказчика (anon). Берут ТОЛЬКО токен. Наружу уходят имя
--     бизнеса, логотип, имя календаря, названия и длительности услуг и окна.
--     Цен, клиентов и записей страница не видит.
--   • Окна считаются на сервере тем же правилом, что зелёные кубики
--     календаря (`free-slots.ts`): рабочая полоса графика команды (правка на
--     дату → отпуск → день недели → общие часы), обед, буфер на дорогу в обе
--     стороны, отменённые записи свободны, «весь день» занимает сутки. Сверх
--     того: окно = длительность услуги, а сегодняшние окна — не раньше чем
--     через час: мастеру нужно время увидеть запись.
--   • Запись проверяет окно ЗАНОВО под замком календаря — два заказчика на
--     одно время не встанут.
--   • Спам: с одного номера в один календарь — не больше 3 заявок за сутки,
--     в один календарь — не больше 20 за час (`online_booking_requests`).
--   • `online_booking_settings` / `online_booking_set` /
--     `online_booking_set_service` — шестерёнка календаря, только владелец
--     компании календаря.

create table if not exists public.online_booking_pages (
  team_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token text not null unique,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint online_booking_pages_token_len check (length(token) between 10 and 64)
);

comment on table public.online_booking_pages is
  'Онлайн-запись календаря: токен публичной страницы /b и выключатель. Только через функции.';

alter table public.online_booking_pages enable row level security;
revoke all on table public.online_booking_pages from public, anon, authenticated;

create table if not exists public.online_booking_requests (
  id bigserial primary key,
  team_id text not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_e164 text not null,
  created_at timestamptz not null default now()
);

create index if not exists online_booking_requests_team_time_idx
  on public.online_booking_requests (team_id, created_at);
create index if not exists online_booking_requests_phone_time_idx
  on public.online_booking_requests (team_id, phone_e164, created_at);

comment on table public.online_booking_requests is
  'Журнал заявок онлайн-записи для лимита от спама. Только через функции.';

alter table public.online_booking_requests enable row level security;
revoke all on table public.online_booking_requests from public, anon, authenticated;
revoke all on sequence public.online_booking_requests_id_seq from public, anon, authenticated;

/** «ЧЧ:ММ» → минуты от полуночи; мусор — null. */
create or replace function public.online_booking_hm(p_value text)
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_value ~ '^\d{1,2}:\d{2}' then
      split_part(p_value, ':', 1)::integer * 60 + substr(split_part(p_value, ':', 2), 1, 2)::integer
    else null end;
$function$;

/** Свободные начала дня для окна длиной p_duration минут — массив «ЧЧ:ММ». */
create or replace function public.online_booking_day_slots(
  p_tenant uuid,
  p_team text,
  p_date date,
  p_duration integer
)
returns text[]
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_team record;
  v_day jsonb;
  v_key text := to_char(p_date, 'YYYY-MM-DD');
  v_wd text := (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from p_date)::integer + 1];
  v_start integer;
  v_end integer;
  v_breaks jsonb := '[]'::jsonb;
  v_window integer;
  v_now timestamp;
  v_min_start integer := null;
  v_busy integer[][] := array[]::integer[][];
  v_all_day boolean := false;
  v_slot integer;
  v_out text[] := array[]::text[];
  a record;
  b jsonb;
  v_s integer;
  v_e integer;
  v_ok boolean;
  i integer;
begin
  select t.id,
         coalesce(t.default_slot_minutes, 30) as step,
         coalesce(t.buffer_minutes, cs.buffer_minutes, 0) as buffer,
         coalesce(nullif(t.timezone, ''), nullif(cs.timezone, ''), 'Europe/Nicosia') as tz,
         ts.schedule,
         coalesce(cs.work_start_hour, cs.start_hour, 6) as work_start,
         coalesce(cs.work_end_hour, cs.end_hour, 20) as work_end
    into v_team
    from public.teams t
    left join public.calendar_settings cs on cs.tenant_id = t.tenant_id
    left join public.team_schedules ts on ts.tenant_id = t.tenant_id and ts.team_id = t.id
   where t.tenant_id = p_tenant and t.id = p_team;
  if not found then
    return v_out;
  end if;

  -- Рабочая полоса дня — порядок `getDayScheduleForDate`.
  if v_team.schedule is not null and jsonb_typeof(v_team.schedule) = 'object' then
    v_day := v_team.schedule -> 'date_overrides' -> v_key;
    if v_day is null and exists (
      select 1
        from jsonb_array_elements(case when jsonb_typeof(v_team.schedule -> 'vacations') = 'array'
                                       then v_team.schedule -> 'vacations' else '[]'::jsonb end) vac
       where v_key between vac ->> 'start' and vac ->> 'end'
    ) then
      return v_out;
    end if;
    if v_day is null then
      v_day := v_team.schedule -> 'overrides' -> v_wd;
    end if;
    if v_day is null then
      v_day := jsonb_build_object(
        'is_working', true,
        'start', v_team.schedule ->> 'start',
        'end', v_team.schedule ->> 'end',
        'breaks', coalesce(v_team.schedule -> 'breaks', '[]'::jsonb)
      );
    end if;
    if (v_day ->> 'is_working')::boolean is false then
      return v_out;
    end if;
    v_start := public.online_booking_hm(v_day ->> 'start');
    v_end := public.online_booking_hm(v_day ->> 'end');
    if jsonb_typeof(v_day -> 'breaks') = 'array' then
      v_breaks := v_day -> 'breaks';
    end if;
  end if;
  -- Графика нет или он нечитаем — общие часы компании, как у сетки.
  if v_start is null or v_end is null or v_end <= v_start then
    v_start := v_team.work_start * 60;
    v_end := v_team.work_end * 60;
    v_breaks := '[]'::jsonb;
  end if;
  if v_end <= v_start then
    return v_out;
  end if;

  v_window := greatest(v_team.step, coalesce(p_duration, 0));

  v_now := timezone(v_team.tz, now());
  if p_date < v_now::date then
    return v_out;
  end if;
  if p_date = v_now::date then
    v_min_start := extract(hour from v_now)::integer * 60 + extract(minute from v_now)::integer + 60;
  end if;

  for a in
    select ap.time_start, ap.time_end, ap.event_all_day
      from public.appointments ap
     where ap.tenant_id = p_tenant
       and ap.team_id = p_team
       and ap.date = v_key
       and ap.status <> 'cancelled'
  loop
    if a.event_all_day then
      v_all_day := true;
      exit;
    end if;
    v_s := public.online_booking_hm(a.time_start);
    v_e := public.online_booking_hm(a.time_end);
    continue when v_s is null or v_e is null;
    -- Нулевая длительность всё равно стоит на сетке 15 минут.
    if v_e <= v_s then
      v_e := v_s + 15;
    end if;
    v_busy := v_busy || array[[v_s, v_e]];
  end loop;
  if v_all_day then
    return v_out;
  end if;

  v_slot := v_start;
  while v_slot + v_window <= v_end loop
    v_ok := v_min_start is null or v_slot >= v_min_start;
    if v_ok then
      for b in select * from jsonb_array_elements(v_breaks) loop
        v_s := public.online_booking_hm(b ->> 'start');
        v_e := public.online_booking_hm(b ->> 'end');
        if v_s is not null and v_e is not null and v_e > v_s
           and v_slot < v_e and v_slot + v_window > v_s then
          v_ok := false;
          exit;
        end if;
      end loop;
    end if;
    if v_ok and array_length(v_busy, 1) is not null then
      for i in 1 .. array_length(v_busy, 1) loop
        -- Буфер на дорогу — и после чужой записи, и перед ней.
        if v_slot < v_busy[i][2] + v_team.buffer
           and v_slot + v_window + v_team.buffer > v_busy[i][1] then
          v_ok := false;
          exit;
        end if;
      end loop;
    end if;
    if v_ok then
      v_out := array_append(v_out, lpad((v_slot / 60)::text, 2, '0') || ':' || lpad((v_slot % 60)::text, 2, '0'));
    end if;
    v_slot := v_slot + v_team.step;
  end loop;
  return v_out;
end;
$function$;

/** Страница по токену: открыта ли запись и кто принимает. Внутренняя. */
create or replace function public.online_booking_resolve(p_token text)
returns table (
  tenant_id uuid,
  team_id text,
  state text,
  business_name text,
  logo_url text,
  calendar_name text,
  country text,
  tz text
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  if p_token is null or p_token !~ '^[0-9A-Za-z]{10,64}$' then
    return;
  end if;
  select p.tenant_id, p.team_id, p.enabled, t.is_active, t.name as calendar_name,
         tn.name as business_name, tn.logo_url, tn.country,
         coalesce(nullif(t.timezone, ''), nullif(cs.timezone, ''), 'Europe/Nicosia') as tz
    into r
    from public.online_booking_pages p
    join public.teams t on t.tenant_id = p.tenant_id and t.id = p.team_id
    join public.tenants tn on tn.id = p.tenant_id
    left join public.calendar_settings cs on cs.tenant_id = p.tenant_id
   where p.token = p_token;
  if not found then
    return;
  end if;
  tenant_id := r.tenant_id;
  team_id := r.team_id;
  business_name := r.business_name;
  logo_url := r.logo_url;
  calendar_name := r.calendar_name;
  country := r.country;
  tz := r.tz;
  -- Закрыто: выключили, календарь в архиве, сверх тарифа или тариф без
  -- записей клиентов — запись всё равно не встала бы.
  state := case
    when r.enabled is not true or r.is_active is not true then 'closed'
    when not public.team_is_working(r.tenant_id, r.team_id) then 'closed'
    when public.tenant_effective_plan(r.tenant_id) is not distinct from 'free' then 'closed'
    else 'open' end;
  return next;
end;
$function$;

/** Услуги, открытые для онлайн-записи в календаре. Внутренняя. */
create or replace function public.online_booking_services(p_tenant uuid, p_team text)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'name', s.name,
           'duration', greatest(coalesce(s.duration_minutes, 0), 0)
         ) order by s.position, s.name), '[]'::jsonb)
    from public.services s
   where s.tenant_id = p_tenant
     and s.team_id = p_team
     and s.is_active
     and s.online_enabled
     and btrim(s.name) <> '';
$function$;

/** Публичная страница: кто, какой календарь, какие услуги. */
create or replace function public.online_booking_page(p_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_services jsonb := '[]'::jsonb;
begin
  select * into r from public.online_booking_resolve(p_token);
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  if r.state = 'open' then
    v_services := public.online_booking_services(r.tenant_id, r.team_id);
    if jsonb_array_length(v_services) = 0 then
      r.state := 'closed';
    end if;
  end if;
  return jsonb_build_object(
    'state', r.state,
    'business_name', r.business_name,
    'logo_url', r.logo_url,
    'calendar_name', r.calendar_name,
    'country', r.country,
    'services', case when r.state = 'open' then v_services else '[]'::jsonb end
  );
end;
$function$;

/** Свободные окна услуги на 14 дней вперёд, начиная с сегодня. */
create or replace function public.online_booking_slots(p_token text, p_service text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_duration integer;
  v_today date;
  v_days jsonb := '[]'::jsonb;
  v_times text[];
  d integer;
begin
  select * into r from public.online_booking_resolve(p_token);
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  if r.state <> 'open' then
    return jsonb_build_object('state', r.state, 'days', '[]'::jsonb);
  end if;
  select greatest(coalesce(s.duration_minutes, 0), 0) into v_duration
    from public.services s
   where s.tenant_id = r.tenant_id and s.team_id = r.team_id and s.id = p_service
     and s.is_active and s.online_enabled;
  if not found then
    return jsonb_build_object('state', 'open', 'days', '[]'::jsonb);
  end if;
  v_today := timezone(r.tz, now())::date;
  for d in 0 .. 13 loop
    v_times := public.online_booking_day_slots(r.tenant_id, r.team_id, v_today + d, v_duration);
    if cardinality(v_times) > 0 then
      v_days := v_days || jsonb_build_object('date', to_char(v_today + d, 'YYYY-MM-DD'), 'times', to_jsonb(v_times));
    end if;
  end loop;
  return jsonb_build_object('state', 'open', 'days', v_days);
end;
$function$;

/** Заявка заказчика: запись в календарь команды. Ответ — что записано. */
create or replace function public.online_booking_create(
  p_token text,
  p_service text,
  p_date text,
  p_time text,
  p_name text,
  p_phone text
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
declare
  r record;
  s record;
  v_name text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 80);
  v_phone text := btrim(coalesce(p_phone, ''));
  v_date date;
  v_start integer;
  v_duration integer;
  v_end integer;
  v_today date;
  v_client uuid;
  v_appointment uuid := gen_random_uuid();
begin
  select * into r from public.online_booking_resolve(p_token);
  if not found then
    raise exception 'Ссылка не найдена' using errcode = 'P0001', hint = 'online:missing';
  end if;
  if r.state <> 'open' then
    raise exception 'Онлайн-запись сейчас закрыта' using errcode = 'P0001', hint = 'online:closed';
  end if;
  if length(v_name) < 2 then
    raise exception 'Напишите, как вас зовут' using errcode = '22023', hint = 'online:name';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Проверьте номер телефона' using errcode = '22023', hint = 'online:phone';
  end if;
  select sv.id, sv.name, sv.price, greatest(coalesce(sv.duration_minutes, 0), 0) as duration, sv.unit
    into s
    from public.services sv
   where sv.tenant_id = r.tenant_id and sv.team_id = r.team_id and sv.id = p_service
     and sv.is_active and sv.online_enabled;
  if not found then
    raise exception 'Эта услуга больше не записывается онлайн' using errcode = 'P0001', hint = 'online:service';
  end if;
  if coalesce(p_date, '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_time, '') !~ '^\d{2}:\d{2}$' then
    raise exception 'Выберите время' using errcode = '22023', hint = 'online:slot';
  end if;
  v_date := p_date::date;
  v_today := timezone(r.tz, now())::date;
  if v_date < v_today or v_date > v_today + 13 then
    raise exception 'Выберите время' using errcode = '22023', hint = 'online:slot';
  end if;

  -- Один календарь — одна очередь: второй заказчик на то же время ждёт
  -- первого и видит, что окно уже занято.
  perform pg_advisory_xact_lock(hashtextextended('online-booking:' || r.tenant_id::text || ':' || r.team_id, 0));

  if (select count(*) from public.online_booking_requests q
       where q.team_id = r.team_id and q.phone_e164 = v_phone
         and q.created_at > now() - interval '1 day') >= 3 then
    raise exception 'С этого номера уже есть заявки — позвоните нам' using errcode = 'P0001', hint = 'online:rate';
  end if;
  if (select count(*) from public.online_booking_requests q
       where q.team_id = r.team_id and q.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Слишком много заявок — попробуйте позже' using errcode = 'P0001', hint = 'online:rate';
  end if;

  v_duration := s.duration;
  if not (p_time = any(public.online_booking_day_slots(r.tenant_id, r.team_id, v_date, v_duration))) then
    raise exception 'Это время уже заняли — выберите другое' using errcode = 'P0001', hint = 'online:taken';
  end if;
  v_start := public.online_booking_hm(p_time);
  -- Услуга без длительности занимает шаг сетки — тот же, что проверен выше.
  v_end := least(v_start + greatest(v_duration, (
    select coalesce(t.default_slot_minutes, 30) from public.teams t
     where t.tenant_id = r.tenant_id and t.id = r.team_id
  )), 23 * 60 + 59);

  insert into public.online_booking_requests (team_id, tenant_id, phone_e164)
  values (r.team_id, r.tenant_id, v_phone);

  -- Клиент — по номеру во всей контактной базе компании; нового заводим.
  select c.id into v_client
    from public.clients c
   where c.tenant_id = r.tenant_id and c.phone_e164 = v_phone and c.deleted_at is null
   limit 1;
  if v_client is null then
    insert into public.clients (tenant_id, full_name, phone, phone_e164, team_id)
    values (r.tenant_id, v_name, v_phone, v_phone, r.team_id)
    returning id into v_client;
  end if;

  insert into public.appointments (
    id, tenant_id, client_id, team_id, date, time_start, time_end, kind, status,
    total_amount, comment, source, is_online_booking, service_ids, services, total_duration
  ) values (
    v_appointment, r.tenant_id, v_client, r.team_id, p_date, p_time,
    lpad((v_end / 60)::text, 2, '0') || ':' || lpad((v_end % 60)::text, 2, '0'),
    'work', 'scheduled', coalesce(s.price, 0), 'Онлайн-запись', 'online', true,
    jsonb_build_array(s.id),
    jsonb_build_array(jsonb_build_object(
      'serviceId', s.id,
      'serviceName', s.name,
      'quantity', 1,
      'duration', v_duration,
      'unit', s.unit,
      'pricePerUnit', coalesce(s.price, 0),
      'originalPrice', coalesce(s.price, 0),
      'totalPrice', coalesce(s.price, 0)
    )),
    v_duration
  );

  return jsonb_build_object(
    'state', 'booked',
    'business_name', r.business_name,
    'service', s.name,
    'date', p_date,
    'time', p_time
  );
end;
$function$;

/** Владелец компании календаря? Внутренняя. */
create or replace function public.online_booking_owner_tenant(p_team text)
returns uuid
language sql
stable security definer
set search_path to 'public'
as $function$
  select t.tenant_id
    from public.teams t
    join public.tenant_members m on m.tenant_id = t.tenant_id
   where t.id = p_team
     and m.user_id = auth.uid()
     and m.role = 'owner'
   limit 1;
$function$;

/** Шестерёнка: выключатель, ссылка и услуги календаря. */
create or replace function public.online_booking_settings(p_team text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.online_booking_owner_tenant(p_team);
  p record;
begin
  if v_tenant is null then
    raise exception 'Онлайн-запись настраивает владелец' using errcode = '42501', hint = 'access:owner';
  end if;
  select bp.enabled, bp.token into p
    from public.online_booking_pages bp
   where bp.team_id = p_team and bp.tenant_id = v_tenant;
  return jsonb_build_object(
    'enabled', coalesce(p.enabled, false),
    'token', p.token,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id,
               'name', s.name,
               'duration', greatest(coalesce(s.duration_minutes, 0), 0),
               'online', s.online_enabled
             ) order by s.position, s.name)
        from public.services s
       where s.tenant_id = v_tenant and s.team_id = p_team and s.is_active
    ), '[]'::jsonb)
  );
end;
$function$;

/** Включить или выключить онлайн-запись календаря. */
create or replace function public.online_booking_set(p_team text, p_enabled boolean)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.online_booking_owner_tenant(p_team);
begin
  if v_tenant is null then
    raise exception 'Онлайн-запись настраивает владелец' using errcode = '42501', hint = 'access:owner';
  end if;
  if p_enabled is null then
    raise exception 'online_booking_set: p_enabled is null' using errcode = '22023';
  end if;
  insert into public.online_booking_pages (team_id, tenant_id, token, enabled)
  values (p_team, v_tenant, public.appointment_link_token(), p_enabled)
  on conflict (team_id) do update
     set enabled = excluded.enabled, updated_at = now()
   where online_booking_pages.tenant_id = v_tenant;
  return public.online_booking_settings(p_team);
end;
$function$;

/** Открыть или закрыть услугу для онлайн-записи. */
create or replace function public.online_booking_set_service(p_team text, p_service text, p_online boolean)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.online_booking_owner_tenant(p_team);
begin
  if v_tenant is null then
    raise exception 'Онлайн-запись настраивает владелец' using errcode = '42501', hint = 'access:owner';
  end if;
  if p_online is null then
    raise exception 'online_booking_set_service: p_online is null' using errcode = '22023';
  end if;
  update public.services
     set online_enabled = p_online
   where tenant_id = v_tenant and team_id = p_team and id = p_service;
  if not found then
    raise exception 'Услуга не найдена' using errcode = 'P0002';
  end if;
  return public.online_booking_settings(p_team);
end;
$function$;

-- ПРАВА: новая функция здесь по умолчанию исполнима для PUBLIC и anon.
revoke all on function public.online_booking_hm(text) from public, anon, authenticated;
revoke all on function public.online_booking_day_slots(uuid, text, date, integer) from public, anon, authenticated;
revoke all on function public.online_booking_resolve(text) from public, anon, authenticated;
revoke all on function public.online_booking_services(uuid, text) from public, anon, authenticated;
revoke all on function public.online_booking_owner_tenant(text) from public, anon, authenticated;

revoke all on function public.online_booking_page(text) from public;
revoke all on function public.online_booking_slots(text, text) from public;
revoke all on function public.online_booking_create(text, text, text, text, text, text) from public;
grant execute on function public.online_booking_page(text) to anon, authenticated;
grant execute on function public.online_booking_slots(text, text) to anon, authenticated;
grant execute on function public.online_booking_create(text, text, text, text, text, text) to anon, authenticated;

revoke all on function public.online_booking_settings(text) from public, anon;
revoke all on function public.online_booking_set(text, boolean) from public, anon;
revoke all on function public.online_booking_set_service(text, text, boolean) from public, anon;
grant execute on function public.online_booking_settings(text) to authenticated;
grant execute on function public.online_booking_set(text, boolean) to authenticated;
grant execute on function public.online_booking_set_service(text, text, boolean) to authenticated;

-- СТОРОЖ: anon достаёт ровно три двери страницы, внутренние закрыты всем.
do $guard$
begin
  if has_function_privilege('anon', 'public.online_booking_day_slots(uuid, text, date, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.online_booking_day_slots(uuid, text, date, integer)', 'execute')
     or has_function_privilege('anon', 'public.online_booking_resolve(text)', 'execute')
     or has_function_privilege('anon', 'public.online_booking_owner_tenant(text)', 'execute')
     or has_function_privilege('anon', 'public.online_booking_settings(text)', 'execute')
     or has_function_privilege('anon', 'public.online_booking_set(text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.online_booking_set_service(text, text, boolean)', 'execute')
     or not has_function_privilege('anon', 'public.online_booking_create(text, text, text, text, text, text)', 'execute')
     or has_table_privilege('anon', 'public.online_booking_pages', 'select')
     or has_table_privilege('authenticated', 'public.online_booking_pages', 'select')
     or has_table_privilege('anon', 'public.online_booking_requests', 'insert') then
    raise exception 'online_booking: права функций или таблиц не те';
  end if;
end;
$guard$;
