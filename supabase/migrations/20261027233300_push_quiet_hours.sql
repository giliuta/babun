-- ЧЕРНОВИК, НЕ НАКАЧЕН. ТИХИЕ ЧАСЫ: ПУШ КОПИТСЯ И ПРИХОДИТ УТРОМ ОДНОЙ СВОДКОЙ.
--
-- Накатывать ПОСЛЕ `20261027233100_push_digests.sql`: окно живёт в той же
-- строке человека `push_settings` (минуты суток в его часовом поясе; оба
-- `null` или равны — тихих часов нет). Окно может переходить через полночь
-- (22:00–07:00).
--
-- Триггер журнала (`push_activity_dispatch`) тем, у кого сейчас тихие часы,
-- пуш не шлёт, а кладёт строку в `push_held` (кому, аккаунт, вид новости).
-- Раз в 5 минут cron зовёт `push_quiet_flush()`: у кого окно кончилось — его
-- строки забираются и уходят одной сводкой в `push_activity` (форма
-- `{ held: […] }`: «Новые работы: 2 · Переносы: 1 · Отмены: 1»).
--
-- `push_activity_dispatch` переписан целиком: тело — из
-- `migrations/20261027162300_mobile_push.sql` плюс развилка тихих часов.

alter table public.push_settings
  add column if not exists quiet_start smallint check (quiet_start between 0 and 1439),
  add column if not exists quiet_end smallint check (quiet_end between 0 and 1439);

create table if not exists public.push_held (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null,
  kind text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_held_user_idx on public.push_held (user_id);

alter table public.push_held enable row level security;
revoke all on public.push_held from public, anon, authenticated;

-- Сейчас у человека тихие часы?
create or replace function public.push_in_quiet(p_user uuid, p_now timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce((
    select case
             when s.quiet_start is null or s.quiet_end is null or s.quiet_start = s.quiet_end then false
             when s.quiet_start < s.quiet_end then t.m >= s.quiet_start and t.m < s.quiet_end
             else t.m >= s.quiet_start or t.m < s.quiet_end
           end
      from public.push_settings s
      cross join lateral (
        select (extract(hour from public.push_local_now(s.time_zone, p_now)) * 60
                + extract(minute from public.push_local_now(s.time_zone, p_now)))::int as m
      ) t
     where s.user_id = p_user
  ), false);
$function$;

create or replace function public.push_activity_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_on text;
  v_targets jsonb;
  v_secret text;
begin
  select s.value into v_on from public.app_settings s where s.key = 'mobile_push_enabled';
  if v_on is distinct from 'on' or current_setting('app.skip_push', true) = '1' then
    return null;
  end if;

  -- Только те, у кого есть живой телефон: остальным и звать функцию незачем.
  -- У кого сейчас тихие часы — новость в очередь, пуш придёт сводкой.
  with live as (
    select t.*, public.push_in_quiet(t.user_id) as quiet
      from public.push_activity_targets(new) t
     where exists (
       select 1 from public.push_devices d
        where d.user_id = t.user_id
          and d.last_seen_at > now() - interval '60 days'
     )
  ),
  held as (
    insert into public.push_held (user_id, tenant_id, kind)
    select l.user_id, new.tenant_id, l.kind from live l where l.quiet
    returning 1
  )
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'user_id', l.user_id,
             'kind', l.kind,
             'team_id', l.pref_team,
             'show_client', l.show_client
           )) filter (where not l.quiet),
           '[]'::jsonb
         )
    into v_targets
    from live l;
  if jsonb_array_length(v_targets) = 0 then
    return null;
  end if;
  if jsonb_array_length(v_targets) > 500 then
    raise warning 'push_activity: % targets, skipped', jsonb_array_length(v_targets);
    return null;
  end if;

  select s.secret into v_secret from public.edge_cron_secrets s where s.name = 'push_activity';
  if v_secret is null then
    raise warning 'push_activity: dispatch secret is missing';
    return null;
  end if;

  perform net.http_post(
    url := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/push_activity',
    body := jsonb_build_object('log_id', new.id, 'targets', v_targets),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', v_secret
    )
  );
  return null;
exception when others then
  raise warning 'push_activity_dispatch failed: %', sqlerrm;
  return null;
end;
$function$;

-- Окно кончилось — накопленное одной сводкой на человека и аккаунт.
create or replace function public.push_quiet_flush(p_now timestamptz default now())
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
  select s.secret into v_secret from public.edge_cron_secrets s where s.name = 'push_activity';
  if v_secret is null then
    return 0;
  end if;

  with ready as (
    select h.user_id
      from public.push_held h
     group by h.user_id
    having not public.push_in_quiet(h.user_id, p_now)
  ),
  taken as (
    delete from public.push_held h
     using ready r
     where h.user_id = r.user_id
    returning h.user_id, h.tenant_id, h.kind
  ),
  per_kind as (
    select user_id, tenant_id, kind, count(*) as n
      from taken
     group by user_id, tenant_id, kind
  ),
  grouped as (
    select user_id, tenant_id, jsonb_object_agg(kind, n) as counts
      from per_kind
     group by user_id, tenant_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', g.user_id,
           'tenant_id', g.tenant_id,
           'counts', g.counts
         )), '[]'::jsonb)
    into v_items
    from grouped g;

  if jsonb_array_length(v_items) = 0 then
    return 0;
  end if;
  perform net.http_post(
    url := 'https://rdtokosbqvgemicqeqwz.supabase.co/functions/v1/push_activity',
    body := jsonb_build_object('held', v_items),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret)
  );
  return jsonb_array_length(v_items);
exception when others then
  -- Ошибка откатывает и забор строк: сводка уйдёт следующим заходом.
  raise warning 'push_quiet_flush failed: %', sqlerrm;
  return 0;
end;
$function$;

revoke all on function public.push_in_quiet(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.push_activity_dispatch() from public, anon, authenticated;
revoke all on function public.push_quiet_flush(timestamptz) from public, anon, authenticated;

do $cron$
begin
  perform cron.unschedule('push_quiet_flush')
   where exists (select 1 from cron.job where jobname = 'push_quiet_flush');
  perform cron.schedule('push_quiet_flush', '*/5 * * * *', 'select public.push_quiet_flush()');
end;
$cron$;

do $guard$
begin
  if has_function_privilege('authenticated', 'public.push_quiet_flush(timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.push_in_quiet(uuid,timestamptz)', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.push_held', 'SELECT') then
    raise exception 'push_quiet: client-callable helper or table';
  end if;
end;
$guard$;
