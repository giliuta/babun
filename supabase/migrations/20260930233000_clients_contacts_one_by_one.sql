-- ЗАЩИТА БАЗЫ КЛИЕНТОВ, ПУНКТ 1: НОМЕР — ПО ОДНОМУ, «ОКОЛО ЗАПИСИ», «В ДЕНЬ ЗАПИСИ».
--
-- Владелец 30.09: сотрудник или партнёр не должен прийти на неделю, выгрузить
-- базу и уйти. Экран здесь ничего не решает — любое окно читается мимо
-- приложения запросом REST, значит сервер обязан отдавать минимум.
--
-- (1) СПИСКИ СОТРУДНИКА НИКОГДА НЕ НЕСУТ КОНТАКТОВ. `list_member_clients`,
--     `list_master_clients_safe` и всё, что идёт через `client_seen_by_caller`
--     (люди карточки, ответ правки), гасят телефоны, почту, мессенджеры и связи
--     у любого не-владельца. Вместо них строка несёт `contacts_hidden`:
--       null    — номер можно открыть сейчас (`member_client_contacts`);
--       'day'   — откроется в день записи;
--       'right' — права на телефон нет.
-- (2) НОМЕР — ОДНОЙ ДВЕРЬЮ `member_client_contacts(p_client)`, ПО ОДНОМУ КЛИЕНТУ.
--     Каждое открытие ложится в журнал `client_contact_views` (в том числе
--     отказы). Лимит — 30 разных клиентов за сутки; клиенты, которых сотрудник
--     завёл сам, в лимит не идут. Больше 15 клиентов за час или упор в лимит —
--     строка в `client_contact_alerts`, её читает владелец (журнал сотрудника —
--     пункт 2 плана).
-- (3) «КАКИЕ КЛИЕНТЫ»: Около записи · Своей команды · Вся база. «Около записи»
--     (умолчание — новый человек и партнёр) — клиент виден только в окне своей
--     записи в этой команде: за день до неё и неделю после. Клиенты, которых
--     человек завёл сам, видны ему всегда: их данные он и так знает.
-- (4) «ТЕЛЕФОН И КОНТАКТЫ»: Скрыт · В день записи · Всегда. «В день записи» —
--     номер открывается только в день, когда у клиента есть запись в этой
--     команде (день — по поясу компании, `tenant_business_date`).
-- (5) ПРАВИТЬ КОНТАКТЫ МОЖНО ТОЛЬКО ОТКРЫВ ИХ. Строка списка пришла с пустыми
--     полями; карточка, которая номер не открывала, записала бы пустоту поверх
--     настоящих номеров. `update_client_with_tags` требует открытия в журнале
--     за последние 12 часов.
--
-- Нынешние сотрудники НЕ сужаются молча: у кого «Клиенты» открыты в команде, а
-- «Какие клиенты» лежали умолчанием («Своей команды»), тому это положение
-- записывается явно. Умолчание «Около записи» получают только новые.
--
-- Тела функций сняты с базы 30.09 перед правкой (md5 prosrc):
--   access_client_ids_in 62214dc8…, list_member_clients d60c21e1…,
--   list_master_clients_safe a3b1299f…, client_seen_by_caller 0a092cb2…,
--   access_company_level 72923ecd…, update_client_with_tags 037a2525….

-- ─── Реестр: новые положения ────────────────────────────────────────────────

update public.access_blocks
   set levels = array['near', 'own', 'all'],
       enforced_by = array[
         'function:public.access_client_ids()',
         'function:public.access_client_ids_in(text[])',
         'function:public.access_company_level(text)'
       ]
 where key = 'clients.scope';

update public.access_blocks
   set levels = array['off', 'day', 'read'],
       title_ru = 'Телефон и контакты',
       enforced_by = array[
         'function:public.list_member_clients(uuid)',
         'function:public.list_master_clients_safe(uuid)',
         'function:public.client_seen_by_caller(jsonb)',
         'function:public.member_client_contacts(uuid)',
         'function:public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'
       ]
 where key = 'clients.contacts';

-- Нынешним — их прежнее «Своей команды» явно (см. заголовок).
insert into public.member_access (tenant_id, user_id, block, team_id, level)
select mc.tenant_id, mc.user_id, 'clients.scope', mc.team_id, 'own'
  from public.member_calendars mc
  join public.tenant_members tm
    on tm.tenant_id = mc.tenant_id
   and tm.user_id = mc.user_id
   and tm.role <> 'owner'
 where exists (
         select 1
           from public.member_access ma
          where ma.tenant_id = mc.tenant_id
            and ma.user_id = mc.user_id
            and ma.team_id = mc.team_id
            and ma.block = 'clients'
            and ma.level in ('read', 'write')
       )
   and not exists (
         select 1
           from public.member_access ma
          where ma.tenant_id = mc.tenant_id
            and ma.user_id = mc.user_id
            and ma.team_id = mc.team_id
            and ma.block = 'clients.scope'
       );

-- ─── Журнал открытий номера и тревоги ───────────────────────────────────────

-- Журнал живёт дольше клиента и дольше членства: стёртый клиент или ушедший
-- сотрудник не стирают того, что номер открывали. Поэтому без внешних ключей
-- на клиента и человека.
create table if not exists public.client_contact_views (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  client_id uuid not null,
  outcome text not null check (outcome in ('open', 'day', 'right', 'limit')),
  counted boolean not null default false,
  opened_at timestamptz not null default now()
);

create index if not exists client_contact_views_user_idx
  on public.client_contact_views (tenant_id, user_id, opened_at desc);

alter table public.client_contact_views enable row level security;

-- Читает владелец; пишет только `member_client_contacts` (definer).
drop policy if exists client_contact_views_select_owner on public.client_contact_views;
create policy client_contact_views_select_owner
  on public.client_contact_views
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  );

revoke all on public.client_contact_views from anon;
revoke insert, update, delete, truncate on public.client_contact_views from authenticated;

create table if not exists public.client_contact_alerts (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('spike', 'limit')),
  clients_count integer not null,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);

create index if not exists client_contact_alerts_tenant_idx
  on public.client_contact_alerts (tenant_id, created_at desc);

alter table public.client_contact_alerts enable row level security;

drop policy if exists client_contact_alerts_select_owner on public.client_contact_alerts;
create policy client_contact_alerts_select_owner
  on public.client_contact_alerts
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  );

revoke all on public.client_contact_alerts from anon;
revoke insert, update, delete, truncate on public.client_contact_alerts from authenticated;

-- ─── «Какие клиенты»: окно записи ───────────────────────────────────────────

create or replace function public.access_client_ids_in(p_teams text[])
 returns uuid[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid := public.current_tenant_id();
  whole_base boolean;
  team_wide text[];
  near_teams text[];
  today date;
begin
  if caller is null or active_tenant is null or coalesce(cardinality(p_teams), 0) = 0 then
    return array[]::uuid[];
  end if;

  -- «Вся база» в любой из этих команд — вся база; «Своей команды» — клиенты
  -- команды и её записей за всё время; остальное (и неизвестное) — «Около
  -- записи»: только окно записи.
  select coalesce(bool_or(s.level = 'all'), false),
         coalesce(array_agg(s.team_id) filter (where s.level in ('own', 'all')), array[]::text[]),
         coalesce(array_agg(s.team_id) filter (where s.level not in ('own', 'all')), array[]::text[])
    into whole_base, team_wide, near_teams
    from (
      select t.team_id,
             coalesce(public.access_team_level(active_tenant, caller, 'clients.scope', t.team_id), 'near') as level
        from unnest(p_teams) as t(team_id)
    ) s;

  today := public.tenant_business_date(active_tenant);

  return coalesce((
    select array_agg(c.id order by c.id)
      from public.clients c
     where c.tenant_id = active_tenant
       and c.deleted_at is null
       and (
         whole_base
         -- Завёл сам — видит всегда: эти данные он и так знает.
         or c.created_by = caller
         -- КОМАНДА КЛИЕНТА (30.09): клиент этой команды.
         or c.team_id = any(team_wide)
         or exists (
           select 1
             from public.appointments a
            where a.tenant_id = active_tenant
              and a.client_id = c.id
              and a.team_id = any(team_wide)
         )
         -- «Около записи»: за день до записи и неделю после; отменённая
         -- запись окна не открывает.
         or exists (
           select 1
             from public.appointments a
            where a.tenant_id = active_tenant
              and a.client_id = c.id
              and a.team_id = any(near_teams)
              and a.status is distinct from 'cancelled'
              and a.date between (today - 7)::text and (today + 1)::text
         )
       )
  ), array[]::uuid[]);
end;
$function$;

create or replace function public.access_company_level(p_block text)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid;
  caller_role text;
  block_row public.access_blocks%rowtype;
  stored_level text;
  scope_levels text[];
begin
  if caller is null then
    return null;
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return null;
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return null;
  end if;

  select * into block_row
    from public.access_blocks b
   where b.key = p_block
     and b.scope = 'company';
  if not found then
    if p_block = 'clients.scope' then
      if caller_role = 'owner' then
        return 'all';
      end if;
      -- Самое широкое положение среди команд, где «Клиенты» открыты.
      select coalesce(array_agg(public.access_team_level(active_tenant, caller, 'clients.scope', t.team_id)), array[]::text[])
        into scope_levels
        from unnest(public.access_calendars('clients', 'read')) as t(team_id);
      return case
        when 'all' = any(scope_levels) then 'all'
        when 'own' = any(scope_levels) then 'own'
        else 'near'
      end;
    end if;
    return null;
  end if;

  -- Владелец права выдаёт, а не получает: у него самое полное положение.
  if caller_role = 'owner' then
    return block_row.levels[array_length(block_row.levels, 1)];
  end if;

  if not block_row.live or block_row.owner_only then
    return block_row.levels[1];
  end if;

  select ma.level into stored_level
    from public.member_access ma
   where ma.tenant_id = active_tenant
     and ma.user_id = caller
     and ma.block = block_row.key
     and ma.team_id is null;

  return coalesce(stored_level, block_row.levels[1]);
end;
$function$;

-- ─── «Телефон и контакты»: «В день записи» ──────────────────────────────────

-- Команды, где «Клиенты» открыты, а телефон — «В день записи». «Всегда» и
-- дальше считает `access_contact_client_ids`: ранг `access_calendars` положения
-- 'day' не знает, и через него 'day' никогда не сойдёт за 'read'.
create or replace function public.access_day_contact_teams()
 returns text[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when auth.uid() is null or public.current_user_role() is not distinct from 'owner'
      then array[]::text[]
    else coalesce(array(
      select t.team_id
        from unnest(public.access_calendars('clients', 'read')) as t(team_id)
       where public.access_team_level(public.current_tenant_id(), auth.uid(), 'clients.contacts', t.team_id) = 'day'
    ), array[]::text[])
  end
$function$;

-- Клиенты, у которых СЕГОДНЯ запись в команде с «В день записи».
create or replace function public.access_day_contact_client_ids()
 returns uuid[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  day_teams text[];
  today text;
begin
  if auth.uid() is null or active_tenant is null then
    return array[]::uuid[];
  end if;
  day_teams := public.access_day_contact_teams();
  if cardinality(day_teams) = 0 then
    return array[]::uuid[];
  end if;
  today := public.tenant_business_date(active_tenant)::text;
  return coalesce((
    select array_agg(distinct a.client_id)
      from public.appointments a
      join public.clients c
        on c.id = a.client_id
       and c.tenant_id = a.tenant_id
       and c.deleted_at is null
     where a.tenant_id = active_tenant
       and a.client_id is not null
       and a.team_id = any(day_teams)
       and a.status is distinct from 'cancelled'
       and a.date = today
  ), array[]::uuid[]);
end;
$function$;

-- Те же поля, что гасит `client_without_contacts`, — только они и открываются.
create or replace function public.client_contacts_of(p_client jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'phone', coalesce(p_client -> 'phone', to_jsonb(''::text)),
    'whatsapp_phone', coalesce(p_client -> 'whatsapp_phone', to_jsonb(''::text)),
    'email', coalesce(p_client -> 'email', to_jsonb(''::text)),
    'telegram_username', coalesce(p_client -> 'telegram_username', to_jsonb(''::text)),
    'instagram_username', coalesce(p_client -> 'instagram_username', to_jsonb(''::text)),
    'phones', coalesce(p_client -> 'phones', '[]'::jsonb),
    'phone_e164', coalesce(p_client -> 'phone_e164', 'null'::jsonb),
    'memberships', coalesce(p_client -> 'memberships', '[]'::jsonb)
  )
$function$;

-- ─── Списки: без контактов ──────────────────────────────────────────────────

-- Сотруднику — всегда без контактов и денег; владельцу — всё.
create or replace function public.client_seen_by_caller(p_client jsonb)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when public.current_user_role() = 'owner' then p_client
    else public.client_without_money(public.client_without_contacts(p_client))
  end
$function$;

create or replace function public.list_member_clients(p_client_id uuid default null::uuid)
 returns setof jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  caller_role text := public.current_user_role();
  visible uuid[] := array[]::uuid[];
  open_ids uuid[] := array[]::uuid[];
  day_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or active_tenant is null or caller_role is null then
    return;
  end if;

  if caller_role = 'owner' then
    return query
      select to_jsonb(c) || jsonb_build_object(
               'tag_ids',
               coalesce((
                 select jsonb_agg(ta.tag_id order by ta.tag_id)
                   from public.client_tag_assignments ta
                  where ta.tenant_id = c.tenant_id
                    and ta.client_id = c.id
               ), '[]'::jsonb)
             )
        from public.clients c
       where c.tenant_id = active_tenant
         and c.deleted_at is null
         and (p_client_id is null or c.id = p_client_id)
       order by c.full_name, c.id;
    return;
  end if;

  visible := public.access_client_ids();
  if cardinality(visible) = 0 then
    return;
  end if;
  open_ids := public.access_contact_client_ids() || public.access_day_contact_client_ids();
  day_ids := public.access_client_ids_in(public.access_day_contact_teams());

  -- Контактов в списке нет НИКОГДА: номер — только дверью по одному клиенту.
  return query
    select public.client_without_money(public.client_without_contacts(
             to_jsonb(c) || jsonb_build_object(
               'tag_ids',
               coalesce((
                 select jsonb_agg(ta.tag_id order by ta.tag_id)
                   from public.client_tag_assignments ta
                  where ta.tenant_id = c.tenant_id
                    and ta.client_id = c.id
               ), '[]'::jsonb)
             )
           )) || jsonb_build_object(
             'contacts_hidden',
             case
               when c.id = any(open_ids) then null
               when c.id = any(day_ids) then 'day'
               else 'right'
             end
           )
      from public.clients c
     where c.tenant_id = active_tenant
       and c.deleted_at is null
       and (p_client_id is null or c.id = p_client_id)
       and c.id = any(visible)
     order by c.full_name, c.id;
end;
$function$;

create or replace function public.list_master_clients_safe(p_client_id uuid default null::uuid)
 returns setof jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with client_teams as (
    select public.access_calendars('record.client', 'read') as ids
  ),
  contact_sets as (
    select public.access_contact_client_ids() || public.access_day_contact_client_ids() as open_ids,
           public.access_client_ids_in(public.access_day_contact_teams()) as day_ids
  )
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'full_name', c.full_name,
    -- Номер — только дверью `member_client_contacts`.
    'phone', '',
    'created_at', c.created_at,
    'contacts_hidden', case
      when c.id = any(cs.open_ids) then null
      when c.id = any(cs.day_ids) then 'day'
      else 'right'
    end
  )
    from public.clients c
   cross join client_teams ct
   cross join contact_sets cs
   where public.current_user_role() = 'master'
     and c.tenant_id = public.current_tenant_id()
     and c.deleted_at is null
     and (p_client_id is null or c.id = p_client_id)
     and public.current_user_can_access_client(c.id)
     and exists (
       select 1
         from public.appointments a
        where a.tenant_id = c.tenant_id
          and a.client_id = c.id
          and a.kind = 'work'
          and a.team_id = any(ct.ids)
     )
   order by c.full_name, c.id
$function$;

-- ─── Дверь номера ───────────────────────────────────────────────────────────

-- Ответ: {status: 'open'|'day'|'right'|'limit', …поля контактов при 'open'}.
-- Отказ — ответом, а не ошибкой: ошибка откатила бы и строку журнала, а упор в
-- лимит владелец должен увидеть.
create or replace function public.member_client_contacts(p_client uuid)
 returns jsonb
 language plpgsql
 volatile security definer
 set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid := public.current_tenant_id();
  caller_role text := public.current_user_role();
  row_client public.clients%rowtype;
  state text;
  own_entry boolean;
  already boolean := false;
  opened_day integer := 0;
  opened_hour integer := 0;
  -- Умолчания владельца 30.09 (пункт 1 плана): 30 клиентов в сутки, тревога —
  -- больше 15 за час.
  daily_limit constant integer := 30;
  hourly_alert constant integer := 15;
begin
  if caller is null or active_tenant is null or caller_role is null then
    raise exception 'нет членства в компании'
      using errcode = '42501', hint = 'access:not_member';
  end if;

  select c.* into row_client
    from public.clients c
   where c.id = p_client
     and c.tenant_id = active_tenant
     and c.deleted_at is null;
  if not found then
    raise exception 'client not found' using errcode = 'P0002';
  end if;

  if caller_role = 'owner' then
    return jsonb_build_object('status', 'open') || public.client_contacts_of(to_jsonb(row_client));
  end if;

  -- Клиент вне набора — как будто его нет: ответ не подтверждает, что uuid жив.
  if not (p_client = any(public.access_client_ids())) then
    raise exception 'client not found' using errcode = 'P0002';
  end if;

  if p_client = any(public.access_contact_client_ids())
     or p_client = any(public.access_day_contact_client_ids()) then
    state := 'open';
  elsif p_client = any(public.access_client_ids_in(public.access_day_contact_teams())) then
    state := 'day';
  else
    state := 'right';
  end if;

  own_entry := coalesce(row_client.created_by = caller, false);

  -- Один человек — по очереди: два параллельных открытия не проскочат лимит.
  perform pg_advisory_xact_lock(
    hashtextextended('client-contacts:' || active_tenant::text || ':' || caller::text, 0)
  );

  if state = 'open' then
    select exists (
      select 1
        from public.client_contact_views v
       where v.tenant_id = active_tenant
         and v.user_id = caller
         and v.client_id = p_client
         and v.outcome = 'open'
         and v.opened_at > now() - interval '24 hours'
    ) into already;

    if not already and not own_entry then
      select count(distinct v.client_id) into opened_day
        from public.client_contact_views v
       where v.tenant_id = active_tenant
         and v.user_id = caller
         and v.counted
         and v.opened_at > now() - interval '24 hours';
      if opened_day >= daily_limit then
        state := 'limit';
      end if;
    end if;
  end if;

  -- Повтор того же ответа в пределах 5 минут журнал не множит.
  if not exists (
    select 1
      from public.client_contact_views v
     where v.tenant_id = active_tenant
       and v.user_id = caller
       and v.client_id = p_client
       and v.outcome = state
       and v.opened_at > now() - interval '5 minutes'
  ) then
    insert into public.client_contact_views (tenant_id, user_id, client_id, outcome, counted)
    values (active_tenant, caller, p_client, state, state = 'open' and not own_entry);
  end if;

  if state in ('open', 'limit') then
    select count(distinct v.client_id) into opened_hour
      from public.client_contact_views v
     where v.tenant_id = active_tenant
       and v.user_id = caller
       and v.outcome in ('open', 'limit')
       and not exists (
         select 1 from public.clients own
          where own.id = v.client_id
            and own.created_by = caller
       )
       and v.opened_at > now() - interval '1 hour';

    -- Одна тревога на человека в час.
    if (state = 'limit' or opened_hour > hourly_alert)
       and not exists (
         select 1
           from public.client_contact_alerts al
          where al.tenant_id = active_tenant
            and al.user_id = caller
            and al.created_at > now() - interval '1 hour'
       ) then
      insert into public.client_contact_alerts (tenant_id, user_id, kind, clients_count)
      values (
        active_tenant,
        caller,
        case when state = 'limit' then 'limit' else 'spike' end,
        greatest(opened_hour, opened_day)
      );
    end if;
  end if;

  if state <> 'open' then
    return jsonb_build_object('status', state);
  end if;
  return jsonb_build_object('status', 'open') || public.client_contacts_of(to_jsonb(row_client));
end;
$function$;

-- ─── Правка клиента: контакты — только открыв их ────────────────────────────

create or replace function public.update_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_patch jsonb, p_tag_ids uuid[] default null::uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  active_tenant_id uuid := public.current_tenant_id();
  active_role text := public.current_user_role();
  current_row public.clients%rowtype;
  next_row public.clients%rowtype;
  saved_row public.clients%rowtype;
  result_tag_ids uuid[];
begin
  if auth.uid() is null
     or active_tenant_id is null
     or active_role is null
     or not (active_role = 'owner' or public.access_company('clients', 'write')) then
    raise exception 'only an owner or an employee who can change clients can update a client'
      using errcode = '42501', hint = 'block:clients';
  end if;

  if p_tenant_id is null
     or p_tenant_id is distinct from active_tenant_id then
    raise exception 'client tenant does not match the active tenant'
      using errcode = '42501';
  end if;

  if p_client_id is null then
    raise exception 'client id is required'
      using errcode = '22023';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'client patch must be an object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_object_keys(p_patch) key
     where key not in (
       'full_name',
       'phone',
       'whatsapp_phone',
       'email',
       'sms_name',
       'telegram_username',
       'instagram_username',
       'balance',
       'discount',
       'comment',
       'acquisition_source',
       'referred_by_client_id',
       'first_contact_date',
       'address',
       'city',
       'city_manual',
       'property_type',
       'language',
       'birthday',
       'blacklisted',
       'pinned_at',
       'reminder_at',
       'phones',
       'locations',
       'notes',
       'equipment',
       'phone_e164',
       'avatar_url',
       'deleted_at',
       'favorite_master_id',
       'legal_name',
       'vat_number',
       'reg_number',
       'billing_address',
       'memberships',
       'requisites'
     )
  ) then
    raise exception 'client patch contains a protected or unknown field'
      using errcode = '22023';
  end if;

  select client.*
    into current_row
    from public.clients client
   where client.id = p_client_id
     and client.tenant_id = active_tenant_id
   for update;

  if not found then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;
  if not public.current_user_can_edit_client(p_client_id) then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;

  if active_role <> 'owner' then
    -- Корзина, деньги клиента и общие пометки — дело владельца.
    -- 085: реквизиты компании — туда же, их сотрудник и не видит.
    if p_patch ?| array['deleted_at', 'balance', 'discount', 'blacklisted',
                        'pinned_at', 'favorite_master_id',
                        'vat_number', 'reg_number', 'billing_address',
                        'requisites'] then
      raise exception 'only the owner archives a client, changes its money or company-wide marks'
        using errcode = '42501', hint = 'block:clients';
    end if;
    -- Контакты, которых сотрудник не видит, он и не правит: пустые поля его
    -- карточки затёрли бы настоящие номера.
    --
    -- 086: `memberships` — в том же списке. Маска гасит связи до `[]`, и без
    -- этого запрета урезанный маской массив можно было бы записать обратно и
    -- молча стереть настоящие связи. Роль («жена», «жилец») — сведения того же
    -- порядка, что телефон.
    --
    -- 30.09: списки сотрудника контактов не несут никогда, номер открывается
    -- дверью `member_client_contacts`. Править контакты можно только у того,
    -- чей номер открыт СЕЙЧАС («Всегда» или «В день записи» в день записи), и
    -- только открыв его — иначе карточка с пустыми полями списка записала бы
    -- пустоту поверх настоящих номеров.
    if p_patch ?| array['phone', 'whatsapp_phone', 'email', 'telegram_username',
                        'instagram_username', 'phones', 'phone_e164',
                        'memberships'] then
      if not (p_client_id = any(public.access_contact_client_ids())
              or p_client_id = any(public.access_day_contact_client_ids())) then
        raise exception 'contacts are hidden for this employee'
          using errcode = '42501', hint = 'block:clients.contacts';
      end if;
      if not exists (
        select 1
          from public.client_contact_views v
         where v.tenant_id = active_tenant_id
           and v.user_id = auth.uid()
           and v.client_id = p_client_id
           and v.outcome = 'open'
           and v.opened_at > now() - interval '12 hours'
      ) then
        raise exception 'open the contacts before changing them'
          using errcode = '42501', hint = 'access:contacts_closed';
      end if;
    end if;
  end if;

  next_row := jsonb_populate_record(current_row, p_patch);

  if nullif(btrim(next_row.full_name), '') is null then
    raise exception 'client name is required'
      using errcode = '23514';
  end if;

  if jsonb_typeof(coalesce(next_row.phones, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.locations, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.notes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.equipment, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.memberships, '[]'::jsonb)) <> 'array' then
    raise exception 'client nested collections must be arrays'
      using errcode = '22023';
  end if;

  if p_patch ? 'referred_by_client_id'
     and next_row.referred_by_client_id = p_client_id then
    raise exception 'client cannot refer itself'
      using errcode = '23514';
  end if;

  if p_patch ? 'referred_by_client_id'
     and next_row.referred_by_client_id is not null
     and not exists (
       select 1
         from public.clients referrer
        where referrer.tenant_id = active_tenant_id
          and referrer.id = next_row.referred_by_client_id
     ) then
    raise exception 'referring client does not belong to the active tenant'
      using errcode = '23503';
  end if;

  if p_patch ? 'favorite_master_id'
     and next_row.favorite_master_id is not null
     and not exists (
       select 1
         from public.masters master
        where master.tenant_id = active_tenant_id
          and master.id = next_row.favorite_master_id
     ) then
    raise exception 'favorite master does not belong to the active tenant'
      using errcode = '23503';
  end if;

  if p_tag_ids is not null then
    result_tag_ids := public.normalize_client_tag_ids(
      active_tenant_id,
      p_tag_ids
    );
  end if;

  update public.clients client
     set full_name = next_row.full_name,
         phone = next_row.phone,
         whatsapp_phone = next_row.whatsapp_phone,
         email = next_row.email,
         sms_name = next_row.sms_name,
         telegram_username = next_row.telegram_username,
         instagram_username = next_row.instagram_username,
         balance = next_row.balance,
         discount = next_row.discount,
         comment = next_row.comment,
         acquisition_source = next_row.acquisition_source,
         referred_by_client_id = next_row.referred_by_client_id,
         first_contact_date = next_row.first_contact_date,
         address = next_row.address,
         city = next_row.city,
         city_manual = next_row.city_manual,
         property_type = next_row.property_type,
         language = next_row.language,
         birthday = next_row.birthday,
         blacklisted = next_row.blacklisted,
         pinned_at = next_row.pinned_at,
         reminder_at = next_row.reminder_at,
         phones = next_row.phones,
         locations = next_row.locations,
         notes = next_row.notes,
         equipment = next_row.equipment,
         phone_e164 = next_row.phone_e164,
         avatar_url = next_row.avatar_url,
         deleted_at = next_row.deleted_at,
         favorite_master_id = next_row.favorite_master_id,
         legal_name = nullif(btrim(next_row.legal_name), ''),
         vat_number = nullif(btrim(next_row.vat_number), ''),
         reg_number = nullif(btrim(next_row.reg_number), ''),
         billing_address = nullif(btrim(next_row.billing_address), ''),
         memberships = coalesce(next_row.memberships, '[]'::jsonb),
         requisites = coalesce(next_row.requisites, '[]'::jsonb)
   where client.id = p_client_id
     and client.tenant_id = active_tenant_id
  returning client.* into saved_row;

  if p_tag_ids is not null then
    delete from public.client_tag_assignments assignment
     where assignment.tenant_id = active_tenant_id
       and assignment.client_id = p_client_id;

    insert into public.client_tag_assignments (
      tenant_id,
      client_id,
      tag_id
    )
    select active_tenant_id, p_client_id, supplied.tag_id
      from unnest(result_tag_ids) supplied(tag_id);
  else
    select coalesce(
             array_agg(assignment.tag_id order by assignment.tag_id),
             array[]::uuid[]
           )
      into result_tag_ids
      from public.client_tag_assignments assignment
     where assignment.tenant_id = active_tenant_id
       and assignment.client_id = p_client_id;
  end if;

  return public.client_seen_by_caller(to_jsonb(saved_row))
    || jsonb_build_object('tag_ids', to_jsonb(result_tag_ids));
end;
$function$;

-- ─── Доступ к функциям ──────────────────────────────────────────────────────

-- Новые функции по умолчанию исполнимы для PUBLIC и anon.
revoke all on function public.member_client_contacts(uuid) from public, anon;
grant execute on function public.member_client_contacts(uuid) to authenticated;

-- Помощники — только изнутри definer-функций.
revoke all on function public.access_day_contact_teams() from public, anon, authenticated;
revoke all on function public.access_day_contact_client_ids() from public, anon, authenticated;
revoke all on function public.client_contacts_of(jsonb) from public, anon, authenticated;
