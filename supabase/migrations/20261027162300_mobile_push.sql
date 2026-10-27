-- ПУШ НА ТЕЛЕФОН ПРИ ЗАКРЫТОМ ПРИЛОЖЕНИИ — ПО ЖУРНАЛУ «ИСТОРИЯ ИЗМЕНЕНИЙ».
--
-- Цепочка: правка записи или дохода → `log_change` пишет строку `change_log` →
-- триггер `zz_push_activity` считает, КОМУ о ней сказать, и одним
-- `net.http_post` отдаёт номер строки и получателей функции `push_activity` →
-- функция пишет текст на языке телефона и шлёт его через Expo Push (APNs и FCM).
--
-- • КОМУ — тем, кто ВИДИТ календарь записи (`access_calendars_of`, блок
--   «calendar.records»; владельцу — все календари), а о доходе — тем, кто видит
--   доходы календаря («finance.income»). Автору правки — никогда.
-- • ПО ВЫБОРУ — строка `team_notification_prefs` человека в этой команде
--   (экран «Уведомления»): «Новые записи», «Переносы и изменения», «Отмены»,
--   «Оплаты». Строки нет — умолчания столбцов (новые, переносы, отмены — да;
--   оплаты — нет).
-- • О ЧЁМ — только рабочие записи и доходы. Правка без смены времени, места,
--   клиента или календаря (услуги, материалы, «выполнено», оплата внутри
--   записи) на локскрин не идёт: о деньгах говорит сам доход, а мелкие правки
--   на объекте будили бы владельца каждые пять минут.
-- • ИМЯ КЛИЕНТА — только тем, кому календарь показывает клиента («record.client»).
--
-- Выключатель — `app_settings.mobile_push_enabled` (отдельно от старого
-- веб-пуша `push_enabled`): пока у Expo нет ключей APNs/FCM, он «off», и
-- телефоны продолжают опрашивать журнал сами, пока приложение открыто.
-- Пуш — без гарантий: любая ошибка здесь только предупреждение, правка
-- записи от неё не откатывается.

-- ── 1. Устройства ─────────────────────────────────────────────────────────

create table if not exists public.push_devices (
  -- Expo push token: «ExponentPushToken[…]». Один телефон — одна строка; вошёл
  -- другой человек — строка переходит к нему (пушей прежнего телефон больше
  -- не получит).
  token text primary key
    check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  -- Язык интерфейса телефона (Кабинет → «Языки»): на нём пишется текст пуша.
  locale text not null default 'ru' check (locale ~ '^[a-z]{2}$'),
  created_at timestamptz not null default now(),
  -- Обновляется при каждом запуске приложения; телефон, молчащий больше
  -- 60 дней, пушей не получает (переустановили, потеряли).
  last_seen_at timestamptz not null default now()
);

create index if not exists push_devices_user_idx on public.push_devices (user_id);

alter table public.push_devices enable row level security;

-- Человек видит и удаляет только свои телефоны. Писать — только через
-- `register_push_device`: ей нужно забрать строку у прежнего владельца
-- телефона, а такого права у человека нет.
revoke all on public.push_devices from public, anon, authenticated;
grant select, delete on public.push_devices to authenticated;

drop policy if exists push_devices_select_own on public.push_devices;
create policy push_devices_select_own on public.push_devices
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists push_devices_delete_own on public.push_devices;
create policy push_devices_delete_own on public.push_devices
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── 2. Регистрация и отказ ─────────────────────────────────────────────────

create or replace function public.register_push_device(
  p_token text,
  p_platform text,
  p_locale text default 'ru'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  caller uuid := auth.uid();
  v_locale text := lower(coalesce(p_locale, ''));
begin
  if caller is null then
    raise exception 'push: sign in first' using errcode = '42501';
  end if;
  if p_token is null
     or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$' then
    raise exception 'push: bad token' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'push: bad platform' using errcode = '22023';
  end if;
  if v_locale !~ '^[a-z]{2}$' then
    v_locale := 'ru';
  end if;

  insert into public.push_devices as d (token, user_id, platform, locale)
  values (p_token, caller, p_platform, v_locale)
  on conflict (token) do update
     set user_id = excluded.user_id,
         platform = excluded.platform,
         locale = excluded.locale,
         last_seen_at = now(),
         created_at = case when d.user_id = excluded.user_id then d.created_at else now() end;

  -- Десяти телефонов на человека хватает с запасом; старые — прочь.
  delete from public.push_devices d
   where d.user_id = caller
     and d.token in (
       select x.token from public.push_devices x
        where x.user_id = caller
        order by x.last_seen_at desc
       offset 10
     );

  -- `live` — сервер действительно шлёт пуши: тогда телефон перестаёт сам
  -- опрашивать журнал, иначе одна новость пришла бы дважды.
  return jsonb_build_object(
    'live',
    coalesce(
      (select s.value from public.app_settings s where s.key = 'mobile_push_enabled'),
      'off'
    ) = 'on'
  );
end;
$function$;

-- Выход: `p_other_devices` — «Выйти на других устройствах», когда сессии
-- других телефонов отозваны, а их пуши иначе продолжали бы светить клиентов
-- на чужом локскрине.
create or replace function public.unregister_push_device(
  p_token text,
  p_other_devices boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    return;
  end if;
  if p_other_devices then
    delete from public.push_devices
     where user_id = caller
       and token is distinct from p_token;
  else
    delete from public.push_devices
     where user_id = caller
       and token = p_token;
  end if;
end;
$function$;

revoke all on function public.register_push_device(text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;
revoke all on function public.unregister_push_device(text, boolean) from public, anon;
grant execute on function public.unregister_push_device(text, boolean) to authenticated;

-- ── 3. Кому сказать о строке журнала ──────────────────────────────────────
--
-- kind:
--   new         — новая работа в календаре человека («Вам назначена работа»);
--   change      — перенос: время, место, клиент или календарь;
--   cancel      — работу отменили или удалили;
--   cancel_link — клиент отменил сам, по ссылке из SMS (автора у правки нет);
--   moved       — работу передали в календарь, которого человек не видит;
--   payment     — доход.

create or replace function public.push_activity_targets(p_log public.change_log)
returns table (user_id uuid, kind text, pref_team text, show_client boolean)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_kind text;
  v_team text := p_log.team_id;
  v_old_team text;
  v_block text := 'calendar.records';
  v_fields text[];
begin
  if p_log.entity = 'finance_transactions' then
    if p_log.action <> 'insert' or p_log.meta ->> 'type' is distinct from 'income' then
      return;
    end if;
    v_kind := 'payment';
    v_block := 'finance.income';
  elsif p_log.entity = 'appointments' then
    if coalesce(p_log.meta ->> 'kind', 'work') <> 'work' then
      return;
    end if;
    if p_log.action = 'insert' then
      v_kind := 'new';
    elsif p_log.action = 'delete' then
      v_kind := 'cancel';
    elsif p_log.action = 'update' then
      if jsonb_typeof(p_log.changes -> 'status') = 'array'
         and p_log.changes -> 'status' ->> 1 = 'cancelled' then
        v_kind := case when p_log.actor_id is null then 'cancel_link' else 'cancel' end;
      elsif jsonb_typeof(p_log.changes -> 'team_id') = 'array' then
        v_kind := 'change';
        v_old_team := p_log.changes -> 'team_id' ->> 0;
      else
        select coalesce(array_agg(k), array[]::text[]) into v_fields
          from jsonb_object_keys(coalesce(p_log.changes, '{}'::jsonb)) k;
        if not (v_fields && array['date', 'time_start', 'time_end', 'address', 'city', 'client_id', 'location_id']) then
          return;
        end if;
        v_kind := 'change';
      end if;
    else
      return;
    end if;
  else
    return;
  end if;

  return query
  with people as (
    select tm.user_id,
           tm.role,
           public.access_calendars_of(p_log.tenant_id, tm.user_id, v_block, 'read') as seen,
           public.access_calendars_of(p_log.tenant_id, tm.user_id, 'record.client', 'read') as clients_seen
      from public.tenant_members tm
     where tm.tenant_id = p_log.tenant_id
       and tm.user_id is distinct from p_log.actor_id
  ),
  scoped as (
    select p.user_id,
           case
             -- Запись без календаря видит только владелец.
             when v_team is null then case when p.role = 'owner' then v_kind end
             when v_old_team is null then case when v_team = any (p.seen) then v_kind end
             -- Смена календаря: видит оба — перенос; только новый — назначили;
             -- только прежний — работу у него забрали.
             when v_team = any (p.seen) and v_old_team = any (p.seen) then 'change'
             when v_team = any (p.seen) then 'new'
             when v_old_team = any (p.seen) then 'moved'
           end as kind,
           case
             when v_team is not null and v_old_team is not null
                  and not (v_team = any (p.seen)) then v_old_team
             else v_team
           end as pref_team,
           case
             when v_kind = 'payment' then true
             when p.role = 'owner' then true
             else coalesce(v_team = any (p.clients_seen), false)
           end as show_client
      from people p
  )
  select s.user_id, s.kind, s.pref_team, s.show_client
    from scoped s
    left join public.team_notification_prefs np
      on np.user_id = s.user_id
     and np.tenant_id = p_log.tenant_id
     and np.team_id = s.pref_team
   where s.kind is not null
     and case s.kind
           when 'new' then coalesce(np.notify_new, true)
           when 'change' then coalesce(np.notify_change, true)
           when 'payment' then coalesce(np.notify_payment, false)
           else coalesce(np.notify_cancel, true)
         end;
end;
$function$;

-- Функция-помощник триггера: читает права и выбор любого человека аккаунта.
revoke all on function public.push_activity_targets(public.change_log) from public, anon, authenticated;

-- ── 4. Отправка ────────────────────────────────────────────────────────────

insert into public.edge_cron_secrets (name, secret)
values ('push_activity', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

insert into public.app_settings (key, value)
values ('mobile_push_enabled', 'off')
on conflict (key) do nothing;

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
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'user_id', t.user_id,
             'kind', t.kind,
             'team_id', t.pref_team,
             'show_client', t.show_client
           )),
           '[]'::jsonb
         )
    into v_targets
    from public.push_activity_targets(new) t
   where exists (
     select 1 from public.push_devices d
      where d.user_id = t.user_id
        and d.last_seen_at > now() - interval '60 days'
   );
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

revoke all on function public.push_activity_dispatch() from public, anon, authenticated;

drop trigger if exists zz_push_activity on public.change_log;
create trigger zz_push_activity
  after insert on public.change_log
  for each row
  when (new.entity in ('appointments', 'finance_transactions'))
  execute function public.push_activity_dispatch();

-- ── 5. Сторож ──────────────────────────────────────────────────────────────

do $guard$
begin
  if has_function_privilege('anon', 'public.register_push_device(text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.unregister_push_device(text,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.push_activity_targets(public.change_log)', 'EXECUTE')
     or has_function_privilege('anon', 'public.push_activity_targets(public.change_log)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.push_activity_dispatch()', 'EXECUTE') then
    raise exception 'push: helper remains client-callable';
  end if;
  if has_table_privilege('authenticated', 'public.push_devices', 'INSERT')
     or has_table_privilege('authenticated', 'public.push_devices', 'UPDATE')
     or has_table_privilege('anon', 'public.push_devices', 'SELECT') then
    raise exception 'push: push_devices is writable from the client';
  end if;
  -- Умолчания выбора выше повторяют столбцы `team_notification_prefs`.
  if (select string_agg(column_name || '=' || column_default, ',' order by column_name)
        from information_schema.columns
       where table_schema = 'public' and table_name = 'team_notification_prefs'
         and column_name in ('notify_new', 'notify_change', 'notify_cancel', 'notify_payment'))
     is distinct from 'notify_cancel=true,notify_change=true,notify_new=true,notify_payment=false' then
    raise exception 'push: team_notification_prefs defaults drifted';
  end if;
end;
$guard$;
