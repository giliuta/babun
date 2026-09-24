-- «КАЛЕНДАРЬ В ТЕЛЕФОНЕ» — ЛЕНТА ЗАПИСЕЙ ПО ОТЗЫВНОЙ ССЫЛКЕ.
--
-- Владелец 2026-09-15: Кабинет полноценный — «Календарь в телефоне» (свои записи
-- в Календаре iPhone и Google по ссылке). Функция `calendar-ics` лежит в коде с
-- 25.08, но НЕ выложена, и выкладывать её как есть нельзя: ключ ленты — user_id.
-- Он неотзываемый, а мастер видит UUID владельца в `created_by` каждой записи —
-- подставил в адрес и забрал рабочий календарь всей компании без входа.
--
-- ЧТО ДЕЛАЕМ:
--   • `calendar_feed_tokens` — случайный токен 192 бита на пару (компания,
--     человек); активный один (частичный уникальный индекс), отзыв ставит
--     `revoked_at`. Клиенту таблица закрыта целиком — только функции ниже.
--   • `my_calendar_feed()` / `issue_calendar_feed()` / `revoke_calendar_feed()` —
--     для приложения, в АКТИВНОЙ компании (`current_tenant_id()` уже проверил
--     членство по заголовку): узнать ссылку, выпустить, отозвать.
--   • `calendar_feed_events(p_token)` — строки ленты для функции `calendar-ics`,
--     только сервисному ключу. ВИДИМОСТЬ — КАК В ПРИЛОЖЕНИИ, одним местом в SQL:
--       владелец — все рабочие записи компании;
--       есть выданные права — календари с `view`;
--       диспетчер без выданных прав — вся компания (ветка роли, как в приложении);
--       мастер — записи своей карточки и календари с `view`.
--     Токен ушедшего из компании не работает: строка ленты берётся только при
--     живом членстве. Личные события (`kind` не 'work') в ленту не идут никогда.

-- ТОКЕН УМИРАЕТ ВМЕСТЕ С ЧЛЕНСТВОМ (замечание 006): ссылка на пару (компания,
-- человек) держится внешним ключом на `tenant_members` с каскадом. Иначе при
-- возврате человека в компанию ожила бы СТАРАЯ ссылка — например, на
-- потерянном телефоне, где календарь был подписан. После возврата — новая.
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
      -- Два нажатия «Подключить» разом: второй выпуск упёрся в единственный
      -- активный токен — отдаём тот, что успел первым.
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
  comment text,
  calendar_name text,
  company_name text
)
language sql
stable
security definer
set search_path = public
as $function$
  with feed as (
    select t.tenant_id, t.user_id, m.role, m.master_id
      from public.calendar_feed_tokens t
      join public.tenant_members m
        on m.tenant_id = t.tenant_id
       and m.user_id = t.user_id
     where t.token = p_token
       and t.revoked_at is null
  ),
  rights as (
    select cm.team_id, cm.grants
      from public.calendar_members cm
      join feed f on f.tenant_id = cm.tenant_id and f.user_id = cm.user_id
  )
  select a.id::text,
         a.date,
         a.time_start,
         a.time_end,
         a.status,
         a.address,
         a.comment,
         tm.name,
         tn.name
    from feed f
    join public.appointments a on a.tenant_id = f.tenant_id
    left join public.teams tm on tm.tenant_id = a.tenant_id and tm.id = a.team_id
    join public.tenants tn on tn.id = f.tenant_id
   where a.kind = 'work'
     and coalesce(a.status, '') <> 'cancelled'
     and a.date >= to_char(current_date - 30, 'YYYY-MM-DD')
     and a.date <= to_char(current_date + 180, 'YYYY-MM-DD')
     and (
       f.role = 'owner'
       or a.team_id in (select r.team_id from rights r where 'view' = any (r.grants))
       or (f.role = 'dispatcher' and not exists (select 1 from rights))
       or (f.role = 'master' and f.master_id is not null and a.master_id = f.master_id)
     )
   order by a.date, a.time_start;
$function$;

revoke all on function public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_events(text) to service_role;

-- СТОРОЖ. Клиенту таблица токенов закрыта, лента — только сервисному ключу.
do $guard$
begin
  if has_table_privilege('authenticated', 'public.calendar_feed_tokens', 'select') then
    raise exception 'миграция: authenticated читает токены лент напрямую';
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
