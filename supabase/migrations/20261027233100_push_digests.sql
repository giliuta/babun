-- ЧЕРНОВИК, НЕ НАКАЧЕН. СВОДКИ ПУШЕМ: УТРОМ «СЕГОДНЯ N ВИЗИТОВ», ВЕЧЕРОМ «ЗАВТРА N».
--
-- Настройка — человека, а не команды (`push_settings`, одна строка на
-- человека, по умолчанию выключено): сводка говорит про весь его день во всех
-- календарях, которые он видит. Время — 08:00 и 20:00 в часовом поясе
-- телефона, с которого её включили.
--
-- Каждый час на :00 cron зовёт `push_digest_dispatch()`: тем, у кого сейчас
-- 08:00 или 20:00 и кто включил сводку, считается число рабочих записей
-- (не отменённых) на сегодня/завтра в их видимых календарях
-- (`access_calendars_of`, «calendar.records») — по каждому аккаунту — и одним
-- `net.http_post` уходит в функцию `push_activity` (форма `{ digest: […] }`).
-- Пусто — сводки нет. Тот же выключатель `mobile_push_enabled`.
--
-- Отдельная таблица, а не столбцы `team_notification_prefs`: настройки команд
-- читает и пишет каждый экран «Уведомлений», и столбец до наката сломал бы
-- сохранение всех их тумблеров.

create table if not exists public.push_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  digest_morning boolean not null default false,
  digest_evening boolean not null default false,
  -- IANA-пояс телефона, с которого правили; битый — Asia/Nicosia (`push_local_now`).
  time_zone text not null default 'Asia/Nicosia' check (length(time_zone) between 1 and 64),
  updated_at timestamptz not null default now()
);

alter table public.push_settings enable row level security;
revoke all on public.push_settings from public, anon, authenticated;
grant select, insert, update on public.push_settings to authenticated;

drop policy if exists push_settings_own on public.push_settings;
create policy push_settings_own on public.push_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Местное «сейчас»; неизвестный пояс не роняет рассылку.
create or replace function public.push_local_now(p_tz text, p_now timestamptz default now())
returns timestamp
language plpgsql
stable
set search_path = public
as $function$
begin
  return p_now at time zone p_tz;
exception when others then
  return p_now at time zone 'Asia/Nicosia';
end;
$function$;

create or replace function public.push_digest_dispatch(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_on text;
  v_items jsonb;
  v_secret text;
begin
  select s.value into v_on from public.app_settings s where s.key = 'mobile_push_enabled';
  if v_on is distinct from 'on' then
    return 0;
  end if;

  with due as (
    select s.user_id,
           case
             when s.digest_morning and extract(hour from public.push_local_now(s.time_zone, p_now)) = 8 then 'morning'
             when s.digest_evening and extract(hour from public.push_local_now(s.time_zone, p_now)) = 20 then 'evening'
           end as slot,
           public.push_local_now(s.time_zone, p_now)::date as today
      from public.push_settings s
     where (s.digest_morning or s.digest_evening)
       and exists (
         select 1 from public.push_devices d
          where d.user_id = s.user_id
            and d.last_seen_at > p_now - interval '60 days'
       )
  ),
  per_tenant as (
    select d.user_id,
           d.slot,
           case d.slot when 'morning' then d.today else d.today + 1 end as day,
           tm.tenant_id,
           public.access_calendars_of(tm.tenant_id, d.user_id, 'calendar.records', 'read') as seen
      from due d
      join public.tenant_members tm on tm.user_id = d.user_id
     where d.slot is not null
  ),
  counted as (
    select p.user_id, p.slot, p.day, p.tenant_id,
           count(a.id) as n,
           (array_agg(a.time_start order by a.time_start nulls last))[1] as first_time,
           (array_agg(a.city order by a.time_start nulls last))[1] as first_city
      from per_tenant p
      join public.appointments a
        on a.tenant_id = p.tenant_id
       and a.team_id = any (p.seen)
       and a.kind = 'work'
       and a.date = to_char(p.day, 'YYYY-MM-DD')
       and coalesce(a.status, '') <> 'cancelled'
     group by p.user_id, p.slot, p.day, p.tenant_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', c.user_id,
           'tenant_id', c.tenant_id,
           'slot', c.slot,
           'date', to_char(c.day, 'YYYY-MM-DD'),
           'count', c.n,
           'first_time', c.first_time,
           'first_city', c.first_city
         )), '[]'::jsonb)
    into v_items
    from counted c
   where c.n > 0;

  if jsonb_array_length(v_items) = 0 then
    return 0;
  end if;

  select s.secret into v_secret from public.edge_cron_secrets s where s.name = 'push_activity';
  if v_secret is null then
    raise warning 'push_digest: dispatch secret is missing';
    return 0;
  end if;

  perform net.http_post(
    url := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/push_activity',
    body := jsonb_build_object('digest', v_items),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret)
  );
  return jsonb_array_length(v_items);
exception when others then
  raise warning 'push_digest_dispatch failed: %', sqlerrm;
  return 0;
end;
$function$;

revoke all on function public.push_local_now(text, timestamptz) from public, anon, authenticated;
revoke all on function public.push_digest_dispatch(timestamptz) from public, anon, authenticated;

do $cron$
begin
  perform cron.unschedule('push_digest')
   where exists (select 1 from cron.job where jobname = 'push_digest');
  perform cron.schedule('push_digest', '0 * * * *', 'select public.push_digest_dispatch()');
end;
$cron$;

do $guard$
begin
  if has_function_privilege('authenticated', 'public.push_digest_dispatch(timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.push_digest_dispatch(timestamptz)', 'EXECUTE')
     or has_table_privilege('anon', 'public.push_settings', 'SELECT')
     or has_table_privilege('authenticated', 'public.push_settings', 'DELETE') then
    raise exception 'push_digest: client-callable helper or table';
  end if;
end;
$guard$;
