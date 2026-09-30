-- КЛИЕНТЫ — ПРАВО КОМАНДЫ, А НЕ КОМПАНИИ (владелец 29.09: «мне важно, чтобы
-- в команде один он имел свой спектр опций… допустим, в команде один он может
-- видеть клиентов, в команде три — не может»).
--
-- Блоки «Клиенты», «Какие клиенты», «Телефоны и контакты» переходят в
-- календарь (`access_blocks.scope = 'calendar'`). Строк прав на них в базе на
-- 29.09 нет ни одной, открытых приглашений тоже — переносить нечего.
--
-- Что видит сотрудник:
--   • набор клиентов — объединение по его командам, где «Клиенты» ≥ «Видит»:
--     клиенты с записями в такой команде и заведённые им самим, а если в
--     такой команде «Какие клиенты: Все» — вся база (`access_client_ids_in`);
--   • телефоны — только у клиентов, которых он видит через команду с открытыми
--     «Телефонами» (`access_contact_client_ids`);
--   • править карточку — только клиента, видимого через команду с «Клиенты:
--     Меняет» (`current_user_can_edit_client`).
-- Остальные двери, что спрашивали «на всю компанию» (`access_company` для
-- 'clients' и 'clients.contacts', `access_company_level('clients.scope')`),
-- теперь читают «хотя бы в одной его команде» — их тела не меняются.
--
-- Тела переписаны со снятого `pg_get_functiondef`; изменены только помеченные
-- места. Права исполнения у `create or replace` сохраняются.

set local lock_timeout = '5s';

update public.access_blocks
   set scope = 'calendar'
 where key in ('clients', 'clients.scope', 'clients.contacts');

-- Положение календарного блока человека в одной команде (умолчание — первое
-- положение блока). Внутренний помощник: зовут только определители.
create or replace function public.access_team_level(
  p_tenant uuid,
  p_user uuid,
  p_block text,
  p_team text
)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select ma.level
       from public.member_access ma
      where ma.tenant_id = p_tenant
        and ma.user_id = p_user
        and ma.block = p_block
        and ma.team_id = p_team),
    (select b.levels[1] from public.access_blocks b where b.key = p_block)
  )
$function$;

revoke all on function public.access_team_level(uuid, uuid, text, text) from public, anon, authenticated;

-- Клиенты, видимые через перечисленные команды вызывающего.
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
begin
  if caller is null or active_tenant is null or coalesce(cardinality(p_teams), 0) = 0 then
    return array[]::uuid[];
  end if;

  -- «Какие клиенты: Все» в любой из этих команд — вся база.
  select exists (
    select 1
      from unnest(p_teams) as t(team_id)
     where public.access_team_level(active_tenant, caller, 'clients.scope', t.team_id) = 'all'
  ) into whole_base;

  return coalesce((
    select array_agg(c.id order by c.id)
      from public.clients c
     where c.tenant_id = active_tenant
       and c.deleted_at is null
       and (
         whole_base
         or c.created_by = caller
         or exists (
           select 1
             from public.appointments a
            where a.tenant_id = active_tenant
              and a.client_id = c.id
              and a.team_id = any(p_teams)
         )
       )
  ), array[]::uuid[]);
end;
$function$;

revoke all on function public.access_client_ids_in(text[]) from public, anon, authenticated;

-- ИЗМЕНЕНО: набор — по командам с «Клиенты» ≥ «Видит», а не по компании.
create or replace function public.access_client_ids()
 returns uuid[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid;
  caller_role text;
begin
  if caller is null then
    return array[]::uuid[];
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return array[]::uuid[];
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;

  -- Владельца пускает своя ветка окна; набор — только для сотрудника.
  if caller_role is null or caller_role = 'owner' then
    return array[]::uuid[];
  end if;

  return public.access_client_ids_in(public.access_calendars('clients', 'read'));
end;
$function$;

-- ИЗМЕНЕНО: телефоны — у клиентов, видимых через команду, где открыты и
-- «Клиенты», и «Телефоны».
create or replace function public.access_contact_client_ids()
 returns uuid[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when public.current_user_role() is distinct from 'owner'
      then public.access_client_ids_in(array(
        select t.team_id
          from unnest(public.access_calendars('clients', 'read')) as t(team_id)
         where t.team_id = any(public.access_calendars('clients.contacts', 'read'))
      ))
    else array[]::uuid[]
  end
$function$;

-- ИЗМЕНЕНО: править — клиента, видимого через команду с «Клиенты: Меняет».
create or replace function public.current_user_can_edit_client(p_client_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when auth.uid() is null then false
    when not exists (
      select 1
        from public.clients c
       where c.id = p_client_id
         and c.tenant_id = public.current_tenant_id()
    ) then false
    when public.current_user_role() = 'owner' then true
    else p_client_id = any(public.access_client_ids_in(public.access_calendars('clients', 'write')))
  end
$function$;

-- ИЗМЕНЕНО: телефоны прячутся у конкретного клиента, а не у всех разом.
create or replace function public.client_seen_by_caller(p_client jsonb)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when public.current_user_role() = 'owner' then p_client
    when (p_client ->> 'id')::uuid = any(public.access_contact_client_ids())
      then public.client_without_money(p_client)
    else public.client_without_money(public.client_without_contacts(p_client))
  end
$function$;

-- ИЗМЕНЕНО: телефоны — построчно, по набору контактов (один расчёт на вызов).
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
  contact_ids uuid[] := array[]::uuid[];
  hide_money boolean;
begin
  if auth.uid() is null or active_tenant is null or caller_role is null then
    return;
  end if;

  hide_money := caller_role <> 'owner';

  if caller_role <> 'owner' then
    visible := public.access_client_ids();
    if cardinality(visible) = 0 then
      return;
    end if;
    contact_ids := public.access_contact_client_ids();
  end if;

  return query
    select case when hide_money then public.client_without_money(shown.row_json) else shown.row_json end
      from (
        select case
                 when caller_role <> 'owner' and not (r.id = any(contact_ids))
                   then public.client_without_contacts(r.row_json)
                 else r.row_json
               end as row_json,
               r.full_name,
               r.id
          from (
            select to_jsonb(c) || jsonb_build_object(
                     'tag_ids',
                     coalesce((
                       select jsonb_agg(ta.tag_id order by ta.tag_id)
                         from public.client_tag_assignments ta
                        where ta.tenant_id = c.tenant_id
                          and ta.client_id = c.id
                     ), '[]'::jsonb)
                   ) as row_json,
                   c.full_name,
                   c.id
              from public.clients c
             where c.tenant_id = active_tenant
               and c.deleted_at is null
               and (p_client_id is null or c.id = p_client_id)
               and (caller_role = 'owner' or c.id = any(visible))
          ) r
      ) shown
     order by shown.full_name, shown.id;
end;
$function$;

-- ИЗМЕНЕНО: 'clients' и 'clients.contacts' — «хотя бы в одной его команде».
-- Владелец проверяется до поиска блока: у него всё открыто при любом объёме
-- компании (раньше так же — блок компании находился всегда).
create or replace function public.access_company(p_block text, p_min text)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  min_rank integer := array_position(array['off', 'read', 'write'], p_min);
  active_tenant uuid;
  caller_role text;
  block_row public.access_blocks%rowtype;
  stored_level text;
begin
  if caller is null or min_rank is null or min_rank < 2 then
    return false;
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return false;
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return false;
  end if;

  select * into block_row
    from public.access_blocks b
   where b.key = p_block
     and b.scope = 'company';
  if not found then
    if p_block in ('clients', 'clients.contacts') and exists (
      select 1 from public.access_blocks b where b.key = p_block
    ) then
      return caller_role = 'owner'
        or cardinality(public.access_calendars(p_block, p_min)) > 0;
    end if;
    return false;
  end if;

  if caller_role = 'owner' then
    return true;
  end if;

  if not block_row.live or block_row.owner_only then
    return false;
  end if;

  select ma.level into stored_level
    from public.member_access ma
   where ma.tenant_id = active_tenant
     and ma.user_id = caller
     and ma.block = block_row.key
     and ma.team_id is null;

  return coalesce(
    array_position(array['off', 'read', 'write'], coalesce(stored_level, block_row.levels[1])) >= min_rank,
    false
  );
end;
$function$;

-- ИЗМЕНЕНО: «Какие клиенты» — «Все», если так хоть в одной команде, где он
-- видит клиентов; иначе «Свои».
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
      return case when exists (
        select 1
          from unnest(public.access_calendars('clients', 'read')) as t(team_id)
         where public.access_team_level(active_tenant, caller, 'clients.scope', t.team_id) = 'all'
      ) then 'all' else 'own' end;
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

-- СТОРОЖ: блоки клиентов — календарные; новые помощники закрыты снаружи.
do $guard$
begin
  if exists (
    select 1 from public.access_blocks
     where key in ('clients', 'clients.scope', 'clients.contacts') and scope <> 'calendar'
  ) then
    raise exception 'блоки клиентов не стали календарными';
  end if;
  if has_function_privilege('anon', 'public.access_client_ids_in(text[])', 'execute')
     or has_function_privilege('authenticated', 'public.access_client_ids_in(text[])', 'execute')
     or has_function_privilege('anon', 'public.access_team_level(uuid, uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.access_team_level(uuid, uuid, text, text)', 'execute') then
    raise exception 'внутренние помощники прав клиентов открыты снаружи';
  end if;
end;
$guard$;
