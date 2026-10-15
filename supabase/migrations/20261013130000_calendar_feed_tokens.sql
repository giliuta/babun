-- «КАЛЕНДАРЬ В ТЕЛЕФОНЕ» — ЛЕНТА ЗАПИСЕЙ ПО ОТЗЫВНОЙ ССЫЛКЕ (13.10).
--
-- Функция `calendar-ics` лежит в коде с 25.08 и НЕ выложена, но в config.toml
-- стоит `verify_jwt = false`: общий деплой функций выложил бы её. Её ключ —
-- user_id: неотзываемый, а мастер видит UUID владельца в `created_by` каждой
-- записи. Подставил в адрес — забрал рабочий календарь компании без входа
-- (нашли сессии 007 и 025). Черновик 15.09 лежал в `supabase/parked/`.
--
-- ЧТО ДЕЛАЕМ:
--   • `calendar_feed_tokens` — случайный токен 192 бита на пару (компания,
--     человек); активный один, отзыв ставит `revoked_at`. Токен умирает вместе
--     с членством (каскад от `tenant_members`): вернувшийся человек получает
--     новую ссылку, а не старую с потерянного телефона. Клиенту таблица
--     закрыта целиком — только функции ниже.
--   • `my_calendar_feed()` / `issue_calendar_feed()` / `revoke_calendar_feed()` —
--     для приложения в АКТИВНОЙ компании (`current_tenant_id()` уже проверил
--     членство): узнать ссылку, выпустить, отозвать.
--   • `calendar_feed_events(p_token)` — строки ленты для `calendar-ics`, только
--     сервисному ключу. ВИДИМОСТЬ — РОВНО КАК В ПРИЛОЖЕНИИ, без второго
--     источника правды:
--       владелец — рабочие записи живых календарей компании (его политика
--         `appointments_select` — «всё»);
--       диспетчер — та же политика: без выданных прав вся компания, с правами —
--         календари с `view`;
--       мастер (все партнёры) — строки `list_master_appointments_safe` от его
--         лица: права на записи, «Ограничения», архив, прикрепление и
--         скрытые блоки (заметка, адрес) — одним местом, как в его календаре.
--     Личные события (`kind` не 'work') в ленту не идут никогда.
--
-- Экрана выпуска ссылки пока нет: без него токенов нет, и лента отвечает 404
-- на любой адрес — выкладывать функцию после наката безопасно.

create table if not exists public.calendar_feed_tokens (
  token      text primary key default encode(extensions.gen_random_bytes(24), 'hex'),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (tenant_id, user_id)
    references public.tenant_members (tenant_id, user_id) on delete cascade
);

create unique index if not exists calendar_feed_tokens_one_active
  on public.calendar_feed_tokens (tenant_id, user_id)
  where revoked_at is null;

alter table public.calendar_feed_tokens enable row level security;
revoke all on table public.calendar_feed_tokens from public, anon, authenticated;
grant select, insert, update on table public.calendar_feed_tokens to service_role;

create or replace function public.my_calendar_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_tenant uuid := (select public.current_tenant_id());
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501', hint = 'feed:not_signed_in';
  end if;
  if v_tenant is null then
    raise exception 'no active company' using errcode = '42501', hint = 'feed:no_company';
  end if;

  select t.token into v_token
    from public.calendar_feed_tokens t
   where t.tenant_id = v_tenant
     and t.user_id = auth.uid()
     and t.revoked_at is null;

  return jsonb_build_object('token', v_token);
end;
$function$;

create or replace function public.issue_calendar_feed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tenant uuid := (select public.current_tenant_id());
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501', hint = 'feed:not_signed_in';
  end if;
  if v_tenant is null then
    raise exception 'no active company' using errcode = '42501', hint = 'feed:no_company';
  end if;

  select t.token into v_token
    from public.calendar_feed_tokens t
   where t.tenant_id = v_tenant
     and t.user_id = auth.uid()
     and t.revoked_at is null;

  if v_token is null then
    begin
      insert into public.calendar_feed_tokens (tenant_id, user_id)
      values (v_tenant, auth.uid())
      returning token into v_token;
    exception when unique_violation then
      -- Два нажатия разом: второй выпуск упёрся в единственный активный
      -- токен — отдаём тот, что успел первым.
      select t.token into v_token
        from public.calendar_feed_tokens t
       where t.tenant_id = v_tenant
         and t.user_id = auth.uid()
         and t.revoked_at is null;
    end;
  end if;

  return jsonb_build_object('token', v_token);
end;
$function$;

create or replace function public.revoke_calendar_feed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tenant uuid := (select public.current_tenant_id());
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501', hint = 'feed:not_signed_in';
  end if;
  if v_tenant is null then
    raise exception 'no active company' using errcode = '42501', hint = 'feed:no_company';
  end if;

  update public.calendar_feed_tokens t
     set revoked_at = now()
   where t.tenant_id = v_tenant
     and t.user_id = auth.uid()
     and t.revoked_at is null;
  get diagnostics v_count = row_count;

  return jsonb_build_object('revoked', v_count > 0);
end;
$function$;

revoke all on function public.my_calendar_feed() from public, anon;
revoke all on function public.issue_calendar_feed() from public, anon;
revoke all on function public.revoke_calendar_feed() from public, anon;
grant execute on function public.my_calendar_feed() to authenticated;
grant execute on function public.issue_calendar_feed() to authenticated;
grant execute on function public.revoke_calendar_feed() to authenticated;

create or replace function public.calendar_feed_events(p_token text)
returns table (
  id text,
  date text,
  time_start text,
  time_end text,
  status text,
  address text,
  comment text
)
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_tenant uuid;
  v_user uuid;
  v_role text;
  v_from text := to_char(current_date - 30, 'YYYY-MM-DD');
  v_to text := to_char(current_date + 180, 'YYYY-MM-DD');
  v_page integer := 0;
  v_rows integer;
  v_row jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    return;
  end if;

  -- Токен живой только при живом членстве: строка ленты берётся через join.
  select t.tenant_id, t.user_id, m.role
    into v_tenant, v_user, v_role
    from public.calendar_feed_tokens t
    join public.tenant_members m
      on m.tenant_id = t.tenant_id
     and m.user_id = t.user_id
   where t.token = p_token
     and t.revoked_at is null;
  if v_tenant is null then
    return;
  end if;

  -- ОТ ЛИЦА ВЛАДЕЛЬЦА ССЫЛКИ, только на эту транзакцию: `auth.uid()` и
  -- `current_tenant_id()` читают именно эти настройки — дальше видимость
  -- решают те же функции, что у приложения.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    jsonb_build_object('x-babun-tenant', v_tenant)::text, true);

  if v_role = 'master' then
    loop
      v_rows := 0;
      for v_row in select * from public.list_master_appointments_safe(v_page * 1000, 1000) loop
        v_rows := v_rows + 1;
        if v_row ->> 'kind' = 'work'
           and coalesce(v_row ->> 'status', '') <> 'cancelled'
           and v_row ->> 'date' between v_from and v_to then
          id := v_row ->> 'id';
          date := v_row ->> 'date';
          time_start := v_row ->> 'time_start';
          time_end := v_row ->> 'time_end';
          status := v_row ->> 'status';
          address := nullif(v_row ->> 'address', '');
          comment := nullif(v_row ->> 'comment', '');
          return next;
        end if;
      end loop;
      exit when v_rows < 1000;
      v_page := v_page + 1;
    end loop;
    return;
  end if;

  -- Владелец и диспетчер — ветки политики `appointments_select`.
  return query
    select a.id::text, a.date, a.time_start, a.time_end, a.status, a.address, a.comment
      from public.appointments a
     where a.tenant_id = v_tenant
       and a.kind = 'work'
       and coalesce(a.status, '') <> 'cancelled'
       and a.date between v_from and v_to
       and exists (
         select 1 from public.teams tm
          where tm.tenant_id = a.tenant_id and tm.id = a.team_id and tm.is_active
       )
       and (
         v_role = 'owner'
         or (v_role = 'dispatcher' and not public.current_user_has_calendar_grants())
         or (v_role = 'dispatcher' and a.team_id = any (public.current_user_calendar_ids('view')))
       )
     order by a.date, a.time_start, a.id;
end;
$function$;

revoke all on function public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_events(text) to service_role;

-- СТОРОЖ. Клиенту таблица токенов закрыта, лента — только сервисному ключу.
do $guard$
begin
  if has_table_privilege('authenticated', 'public.calendar_feed_tokens', 'select')
     or has_table_privilege('anon', 'public.calendar_feed_tokens', 'select') then
    raise exception 'миграция: токены лент читаются напрямую';
  end if;
  if has_function_privilege('authenticated', 'public.calendar_feed_events(text)', 'execute')
     or has_function_privilege('anon', 'public.calendar_feed_events(text)', 'execute') then
    raise exception 'миграция: строки ленты доступны не только сервисному ключу';
  end if;
  if has_function_privilege('anon', 'public.issue_calendar_feed()', 'execute') then
    raise exception 'миграция: anon может выпустить ленту';
  end if;
end
$guard$;
