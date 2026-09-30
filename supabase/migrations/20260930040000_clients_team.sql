-- КЛИЕНТ ПРИНАДЛЕЖИТ КОМАНДЕ (владелец 30.09: «такую же разбивку по
-- командам, чтоб клиенты относились к определённой команде»; «да, накатывай»).
--
-- До сих пор «команда клиента» была выводом — команда его последнего
-- выполненного визита, — и клиент без визитов не принадлежал никому. Теперь
-- это поле карточки: вкладка «Клиенты» показывает ленту «Все | Команда…», и
-- лента фильтрует по нему.
--
-- 1. `clients.team_id` — команда клиента. Пустая только у компании без
--    команд. Удаление команды гасит поле (а не клиента).
-- 2. Нынешним клиентам — команда их последней записи (работы, потом любой
--    неотменённой) среди живых команд; у кого записей нет — первая живая
--    команда компании.
-- 3. `create_client_with_tags` принимает `team_id`. Пусто — первая живая
--    команда, в которой создающему можно менять клиентов (владельцу — любая).
--    Сотрудник не может завести клиента в чужую ему команду: такая команда
--    молча заменяется его первой.
-- 4. `set_client_team` — смена команды клиента. Отдельной дверью, а не ключом
--    в `update_client_with_tags`: у правки карточки свой белый список, и
--    переезд между командами — не правка поля, а решение о доступе.
-- 5. `access_client_ids_in` — сотрудник видит и клиентов своих команд, не
--    только тех, у кого там были записи.
--
-- Тела 3 и 5 переписаны со снятого `pg_get_functiondef`
-- (md5 create_client_with_tags f8f4e38c…, access_client_ids_in 8bac7536…);
-- добавлены только помеченные «КОМАНДА КЛИЕНТА» места. Права исполнения у
-- `create or replace` сохраняются.

set local lock_timeout = '5s';

-- ── 1. Поле ──
alter table public.clients add column if not exists team_id text;

alter table public.clients drop constraint if exists clients_team_fk;
alter table public.clients
  add constraint clients_team_fk foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id) on delete set null (team_id);

create index if not exists clients_team_idx
  on public.clients (tenant_id, team_id);

-- ── 2. Нынешние клиенты ──
update public.clients c
   set team_id = coalesce(
     (select a.team_id
        from public.appointments a
        join public.teams t on t.tenant_id = a.tenant_id and t.id = a.team_id
       where a.tenant_id = c.tenant_id
         and a.client_id = c.id
         and a.status <> 'cancelled'
         and t.is_active
       order by (a.kind = 'work') desc, a.date desc, a.time_start desc
       limit 1),
     (select t.id
        from public.teams t
       where t.tenant_id = c.tenant_id
         and t.is_active
       order by t.position, t.created_at
       limit 1)
   )
 where c.team_id is null;

-- ── 3. Создание клиента ──
CREATE OR REPLACE FUNCTION public.create_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_client jsonb, p_tag_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant_id uuid := public.current_tenant_id();
  active_role text := public.current_user_role();
  input_row public.clients%rowtype;
  saved_row public.clients%rowtype;
  normalized_tag_ids uuid[];
  effective_client_id uuid := coalesce(p_client_id, gen_random_uuid());
begin
  if auth.uid() is null
     or active_tenant_id is null
     or active_role is null
     or not (active_role = 'owner' or public.access_company('clients', 'write')) then
    raise exception 'only an owner or an employee who can change clients can create a client'
      using errcode = '42501', hint = 'block:clients';
  end if;

  if p_tenant_id is null
     or p_tenant_id is distinct from active_tenant_id then
    raise exception 'client tenant does not match the active tenant'
      using errcode = '42501';
  end if;

  if p_client is null or jsonb_typeof(p_client) <> 'object' then
    raise exception 'client payload must be an object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_object_keys(p_client) key
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
       'created_at',
       'legal_name',
       'vat_number',
       'reg_number',
       'billing_address',
       'memberships',
       'requisites',
       'team_id'
     )
  ) then
    raise exception 'client payload contains a protected or unknown field'
      using errcode = '22023';
  end if;

  input_row := jsonb_populate_record(null::public.clients, p_client);

  -- Деньги клиента, корзина и общие пометки — дело владельца.
  if active_role <> 'owner' then
    input_row.balance := 0;
    input_row.discount := 0;
    input_row.deleted_at := null;
    input_row.blacklisted := false;
    input_row.pinned_at := null;
    input_row.favorite_master_id := null;
    -- 085: реквизиты компании — к деньгам, их заводит владелец.
    input_row.vat_number := null;
    input_row.reg_number := null;
    input_row.billing_address := null;
    input_row.requisites := '[]'::jsonb;
  end if;

  if nullif(btrim(input_row.full_name), '') is null then
    raise exception 'client name is required'
      using errcode = '23514';
  end if;

  if jsonb_typeof(coalesce(input_row.phones, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.locations, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.notes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.equipment, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.memberships, '[]'::jsonb)) <> 'array' then
    raise exception 'client nested collections must be arrays'
      using errcode = '22023';
  end if;

  if input_row.referred_by_client_id = effective_client_id then
    raise exception 'client cannot refer itself'
      using errcode = '23514';
  end if;

  if input_row.referred_by_client_id is not null
     and not exists (
       select 1
         from public.clients referrer
        where referrer.tenant_id = active_tenant_id
          and referrer.id = input_row.referred_by_client_id
     ) then
    raise exception 'referring client does not belong to the active tenant'
      using errcode = '23503';
  end if;

  if input_row.favorite_master_id is not null
     and not exists (
       select 1
         from public.masters master
        where master.tenant_id = active_tenant_id
          and master.id = input_row.favorite_master_id
     ) then
    raise exception 'favorite master does not belong to the active tenant'
      using errcode = '23503';
  end if;

  -- КОМАНДА КЛИЕНТА (30.09). Чужая компании команда — ошибка; команда, где
  -- сотруднику нельзя менять клиентов, — заменяется его первой; пусто —
  -- первая живая команда, доступная создающему.
  if input_row.team_id is not null
     and not exists (
       select 1
         from public.teams team
        where team.tenant_id = active_tenant_id
          and team.id = input_row.team_id
     ) then
    raise exception 'client team does not belong to the active tenant'
      using errcode = '23503';
  end if;
  if active_role <> 'owner'
     and input_row.team_id is not null
     and (input_row.team_id = any(public.access_calendars('clients', 'write'))) is not true then
    input_row.team_id := null;
  end if;
  if input_row.team_id is null then
    input_row.team_id := (
      select team.id
        from public.teams team
       where team.tenant_id = active_tenant_id
         and team.is_active
         and (active_role = 'owner'
              or team.id = any(public.access_calendars('clients', 'write')))
       order by team.position, team.created_at
       limit 1
    );
  end if;

  normalized_tag_ids := public.normalize_client_tag_ids(
    active_tenant_id,
    p_tag_ids
  );

  insert into public.clients (
    id,
    tenant_id,
    full_name,
    phone,
    whatsapp_phone,
    email,
    sms_name,
    telegram_username,
    instagram_username,
    balance,
    discount,
    comment,
    acquisition_source,
    referred_by_client_id,
    first_contact_date,
    address,
    city,
    city_manual,
    property_type,
    language,
    birthday,
    blacklisted,
    pinned_at,
    reminder_at,
    phones,
    locations,
    notes,
    equipment,
    phone_e164,
    avatar_url,
    deleted_at,
    favorite_master_id,
    created_at,
    legal_name,
    vat_number,
    reg_number,
    billing_address,
    memberships,
    requisites,
    team_id
  ) values (
    effective_client_id,
    active_tenant_id,
    input_row.full_name,
    coalesce(input_row.phone, ''),
    coalesce(input_row.whatsapp_phone, ''),
    coalesce(input_row.email, ''),
    coalesce(input_row.sms_name, ''),
    coalesce(input_row.telegram_username, ''),
    coalesce(input_row.instagram_username, ''),
    coalesce(input_row.balance, 0),
    coalesce(input_row.discount, 0),
    coalesce(input_row.comment, ''),
    coalesce(input_row.acquisition_source, 'unknown'),
    input_row.referred_by_client_id,
    input_row.first_contact_date,
    coalesce(input_row.address, ''),
    coalesce(input_row.city, ''),
    coalesce(input_row.city_manual, false),
    coalesce(input_row.property_type, ''),
    input_row.language,
    coalesce(input_row.birthday, ''),
    coalesce(input_row.blacklisted, false),
    input_row.pinned_at,
    input_row.reminder_at,
    coalesce(input_row.phones, '[]'::jsonb),
    coalesce(input_row.locations, '[]'::jsonb),
    coalesce(input_row.notes, '[]'::jsonb),
    coalesce(input_row.equipment, '[]'::jsonb),
    input_row.phone_e164,
    input_row.avatar_url,
    input_row.deleted_at,
    input_row.favorite_master_id,
    coalesce(input_row.created_at, now()),
    nullif(btrim(input_row.legal_name), ''),
    nullif(btrim(input_row.vat_number), ''),
    nullif(btrim(input_row.reg_number), ''),
    nullif(btrim(input_row.billing_address), ''),
    coalesce(input_row.memberships, '[]'::jsonb),
    coalesce(input_row.requisites, '[]'::jsonb),
    input_row.team_id
  )
  returning * into saved_row;

  insert into public.client_tag_assignments (
    tenant_id,
    client_id,
    tag_id
  )
  select active_tenant_id, saved_row.id, supplied.tag_id
    from unnest(normalized_tag_ids) supplied(tag_id);

  return public.client_seen_by_caller(to_jsonb(saved_row))
    || jsonb_build_object('tag_ids', to_jsonb(normalized_tag_ids));
end;
$function$;

-- ── 4. Смена команды клиента ──
create or replace function public.set_client_team(p_client_id uuid, p_team_id text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  active_role text := public.current_user_role();
begin
  if auth.uid() is null or active_tenant is null or active_role is null then
    raise exception 'sign in to change a client'
      using errcode = '42501';
  end if;

  if p_team_id is null
     or not exists (
       select 1
         from public.teams team
        where team.tenant_id = active_tenant
          and team.id = p_team_id
     ) then
    raise exception 'client team does not belong to the active tenant'
      using errcode = '23503';
  end if;

  if public.current_user_can_edit_client(p_client_id) is not true then
    raise exception 'only an owner or an employee who can change this client can move it'
      using errcode = '42501', hint = 'block:clients';
  end if;

  -- Сотрудник переводит клиента только в команду, где ему можно менять
  -- клиентов: иначе он отдал бы клиента туда, где сам его больше не увидит.
  if active_role <> 'owner'
     and (p_team_id = any(public.access_calendars('clients', 'write'))) is not true then
    raise exception 'an employee can move a client only into a team where they change clients'
      using errcode = '42501', hint = 'block:clients';
  end if;

  update public.clients
     set team_id = p_team_id
   where id = p_client_id
     and tenant_id = active_tenant;
end;
$function$;

revoke all on function public.set_client_team(uuid, text) from public, anon;
grant execute on function public.set_client_team(uuid, text) to authenticated;

-- ── 5. Кого видит сотрудник ──
CREATE OR REPLACE FUNCTION public.access_client_ids_in(p_teams text[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         -- КОМАНДА КЛИЕНТА (30.09): клиент этой команды.
         or c.team_id = any(p_teams)
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

-- ── Сторожа ──
do $guard$
begin
  if exists (
    select 1
      from public.clients c
     where c.team_id is null
       and exists (select 1 from public.teams t where t.tenant_id = c.tenant_id and t.is_active)
  ) then
    raise exception 'clients_team: a client of a company with teams was left without a team';
  end if;
  if has_function_privilege('anon', 'public.set_client_team(uuid, text)', 'execute') then
    raise exception 'clients_team: anon can move clients between teams';
  end if;
end;
$guard$;
