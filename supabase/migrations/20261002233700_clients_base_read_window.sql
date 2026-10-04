-- «БАЗА КЛИЕНТОВ» — «СКРЫТА» ИЛИ «ТОЛЬКО ВИДИТ», С ОКНОМ ЗАПИСИ (владелец 02.10).
--
-- «Давай сделаем два варианта — скрыто или только видит, но при этом можно
-- поставить ограничения: две недели прошлых записей и две недели вперёд…
-- чтобы оно постоянно обновлялось. Или месяц назад и месяц вперёд». И про
-- блоки карточки: «если поставлено „Меняет" — может редактировать полноценно
-- объекты и всё, что нужно».
--
-- 1. «База клиентов» (`clients`) — две ступени: «Скрыта» и «Только видит».
--    Партнёр не заводит клиентов и не правит базу: имя, номера, мессенджеры,
--    имя для SMS, фото, напоминание. Кто стоял на «Видит и меняет», становится
--    «Только видит».
-- 2. «Какие клиенты» (`clients.scope`) — окно, которое едет вместе с днём:
--    «2 недели» (`near`) — клиент с записью команды от двух недель назад до
--    двух недель вперёд; «Месяц» (`month`) — от месяца назад до месяца
--    вперёд; «Своей команды» (`own`) — как было, все клиенты команды.
--    Прежнее «Около записи» (день до и неделя после) становится «2 недели».
-- 3. Блок карточки с «Меняет» правится сам по себе: раньше его «Меняет»
--    работало только при «Меняет» у базы (`access_client_blocks`), теперь
--    его даёт само право блока. Поля базы в `update_client_with_tags` —
--    только владельцу; поля блоков — по их «Меняет», как и раньше.
--
-- Тела функций сняты с боевой базы 02.10 (`pg_proc.prosrc`) и изменены только
-- в помеченных местах: `access_client_ids_in` (md5 fc650f2e…),
-- `access_company_level` (9f6e6015…),
-- `access_client_blocks` (287f90d2…), `update_client_with_tags` (e406b2e6…;
-- умолчание `p_tag_ids` сохранено — снять его `create or replace` не даёт).
-- `create or replace` права исполнения не трогает.

-- ─── 1. Ступени ──────────────────────────────────────────────────────────────

update public.member_access
   set level = 'read'
 where block = 'clients'
   and level = 'write';

update public.access_blocks
   set levels = array['off', 'read']
 where key = 'clients';

update public.access_blocks
   set levels = array['near', 'month', 'own']
 where key = 'clients.scope';

-- ─── 2. «Какие клиенты»: окно, которое едет с днём ──────────────────────────

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
  month_teams text[];
  near_teams text[];
  today date;
begin
  if caller is null or active_tenant is null or coalesce(cardinality(p_teams), 0) = 0 then
    return array[]::uuid[];
  end if;

  -- «Вся база» в любой из этих команд — вся база; «Своей команды» — клиенты
  -- команды и её записей за всё время; «Месяц» — запись команды от месяца
  -- назад до месяца вперёд; остальное (и неизвестное) — «2 недели».
  select coalesce(bool_or(s.level = 'all'), false),
         coalesce(array_agg(s.team_id) filter (where s.level in ('own', 'all')), array[]::text[]),
         coalesce(array_agg(s.team_id) filter (where s.level = 'month'), array[]::text[]),
         coalesce(array_agg(s.team_id) filter (where s.level not in ('own', 'all', 'month')), array[]::text[])
    into whole_base, team_wide, month_teams, near_teams
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
         -- «Месяц» (02.10): запись от месяца назад до месяца вперёд;
         -- отменённая запись окна не открывает.
         or exists (
           select 1
             from public.appointments a
            where a.tenant_id = active_tenant
              and a.client_id = c.id
              and a.team_id = any(month_teams)
              and a.status is distinct from 'cancelled'
              and a.date between (today - interval '1 month')::date::text
                             and (today + interval '1 month')::date::text
         )
         -- «2 недели» (02.10): запись от двух недель назад до двух недель
         -- вперёд; отменённая запись окна не открывает.
         or exists (
           select 1
             from public.appointments a
            where a.tenant_id = active_tenant
              and a.client_id = c.id
              and a.team_id = any(near_teams)
              and a.status is distinct from 'cancelled'
              and a.date between (today - 14)::text and (today + 14)::text
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
        when 'month' = any(scope_levels) then 'month'
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

-- ─── 3. Блок карточки с «Меняет» — без «Меняет» у базы ──────────────────────

create or replace function public.access_client_blocks()
 returns table(client_id uuid, blocks jsonb)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid := public.current_tenant_id();
  block_keys constant text[] := array[
    'clients.note', 'clients.people', 'clients.objects', 'clients.labels',
    'clients.personal', 'clients.files', 'clients.requisites',
    'clients.history', 'clients.money'
  ];
  -- Блоки, которые видно только НА СТРАНИЦЕ клиента. Последняя запись
  -- стоит и в строке списка — её держит своё право.
  page_only constant text[] := array[
    'clients.note', 'clients.people', 'clients.objects',
    'clients.personal', 'clients.files', 'clients.requisites', 'clients.money',
    'clients.labels'
  ];
begin
  if caller is null or active_tenant is null
     or public.current_user_role() is not distinct from 'owner' then
    return;
  end if;

  return query
    with teams as (
      select t.team_id,
             public.access_team_level(active_tenant, caller, 'clients', t.team_id) as card_level,
             public.access_team_level(active_tenant, caller, 'clients.open', t.team_id) as open_level,
             public.access_client_ids_in(array[t.team_id]) as ids
        from unnest(public.access_calendars('clients', 'read')) as t(team_id)
    ),
    levels as (
      -- Карточка — своим ключом. С 02.10 у базы только «Видит»: карточку
      -- (имя, номера) сотрудник не правит.
      select tm.team_id, 'clients'::text as block_key,
             case when tm.card_level = 'write' then 2 else 1 end as rank
        from teams tm
      union all
      -- «Открывает карточку» — своим ключом: по нему приложение гасит переход.
      select tm.team_id, 'clients.open'::text,
             case when tm.open_level = 'write' then 2 else 0 end
        from teams tm
      union all
      -- Блок «Меняет» — своим правом (02.10), без «Меняет» у базы.
      select tm.team_id, k.block_key,
             case
               when k.block_key = any(page_only) and tm.open_level is distinct from 'write' then 0
               when l.level = 'write' then 2
               when l.level in ('read', 'write') then 1
               else 0
             end
        from teams tm
       cross join unnest(block_keys) as k(block_key)
       cross join lateral (
         select public.access_team_level(active_tenant, caller, k.block_key, tm.team_id) as level
       ) l
    ),
    per_client as (
      select cid as client_id, lv.block_key, max(lv.rank) as rank
        from teams tm
        join levels lv on lv.team_id = tm.team_id
       cross join unnest(tm.ids) as cid
       group by cid, lv.block_key
    )
    select pc.client_id,
           jsonb_object_agg(
             pc.block_key,
             case pc.rank when 2 then 'write' when 1 then 'read' else 'off' end
           )
      from per_client pc
     group by pc.client_id;
end;
$function$;

-- ─── 4. Правка клиента: база — владельцу, блоки — по их «Меняет» ────────────

create or replace function public.update_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_patch jsonb, p_tag_ids uuid[] DEFAULT NULL::uuid[])
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
  card_blocks jsonb;
  denied_block text;
begin
  -- 02.10: сотрудник с «Только видит» у базы правит блоки карточки, где у
  -- него «Меняет», поэтому вход — по «Видит», а поля — ниже, по блокам.
  if auth.uid() is null
     or active_tenant_id is null
     or active_role is null
     or not (active_role = 'owner' or public.access_company('clients', 'read')) then
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
  -- Сотрудник правит только клиента, которого видит (02.10: по «Видит», а не
  -- по «Меняет» базы — «Меняет» у неё больше нет).
  if active_role <> 'owner'
     and (p_client_id = any(public.access_client_ids_in(public.access_calendars('clients', 'read')))) is not true then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;

  next_row := jsonb_populate_record(current_row, p_patch);

  if active_role <> 'owner' then
    -- Корзина, деньги клиента и общие пометки — дело владельца. Реквизиты
    -- с 30.09 — свой блок карточки (ниже).
    if p_patch ?| array['deleted_at', 'balance', 'discount', 'blacklisted',
                        'pinned_at', 'favorite_master_id'] then
      raise exception 'only the owner archives a client, changes its money or company-wide marks'
        using errcode = '42501', hint = 'block:clients';
    end if;
    -- БАЗА — ТОЛЬКО ВЛАДЕЛЬЦУ (02.10): имя, номера и мессенджеры, имя для
    -- SMS, фото, напоминание. Судим по значению, а не по ключу: карточка,
    -- которая пронесла то же имя рядом с заметкой, ничего в базе не меняет.
    -- Номера сотруднику приходят пустыми — пустота поверх настоящих номеров
    -- тоже изменение, и она не пройдёт.
    if exists (
      select 1
        from unnest(array['full_name', 'phone', 'whatsapp_phone', 'email', 'sms_name',
                          'telegram_username', 'instagram_username', 'phones',
                          'phone_e164', 'avatar_url', 'reminder_at']) as f(field)
       where (to_jsonb(next_row) -> f.field) is distinct from (to_jsonb(current_row) -> f.field)
    ) then
      raise exception 'only the owner changes the client base'
        using errcode = '42501', hint = 'block:clients';
    end if;
    -- БЛОКИ КАРТОЧКИ (30.09): каждое поле — под своим блоком; «Меняет» блока —
    -- по командам, через которые клиент виден (`access_client_blocks`). Связи
    -- с 30.09 — блок «Люди»: он же их и показывает, маска контактов тут ни при
    -- чём.
    card_blocks := coalesce((
      select b.blocks
        from public.access_client_blocks() b
       where b.client_id = p_client_id
    ), '{}'::jsonb);
    select g.block_key into denied_block
      from (values
        ('clients.note', array['comment', 'notes']),
        ('clients.people', array['memberships']),
        ('clients.objects', array['locations', 'equipment', 'address', 'property_type']),
        ('clients.labels', array['city', 'city_manual']),
        ('clients.personal', array['birthday', 'language', 'acquisition_source',
                                   'referred_by_client_id', 'first_contact_date']),
        ('clients.requisites', array['legal_name', 'vat_number', 'reg_number',
                                     'billing_address', 'requisites'])
      ) as g(block_key, fields)
     where p_patch ?| g.fields
       and coalesce(card_blocks ->> g.block_key, 'off') <> 'write'
     limit 1;
    if denied_block is null
       and p_tag_ids is not null
       and coalesce(card_blocks ->> 'clients.labels', 'off') <> 'write' then
      denied_block := 'clients.labels';
    end if;
    if denied_block is not null then
      raise exception 'this block of the client card is closed for this employee'
        using errcode = '42501', hint = 'block:' || denied_block;
    end if;
  end if;

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

  -- Теги — внутрь маски: закрытые «Метка и тег» сотруднику не вернутся.
  return public.client_seen_by_caller(
    to_jsonb(saved_row) || jsonb_build_object('tag_ids', to_jsonb(result_tag_ids))
  );
end;
$function$;
