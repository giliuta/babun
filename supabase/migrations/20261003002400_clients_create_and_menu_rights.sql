-- «ГЛАВНОЕ» КЛИЕНТОВ: «БАЗА» — СКРЫТА / ВИДИТ; «СОЗДАНИЕ КЛИЕНТА»; «МЕНЮ
-- КЛИЕНТА» (владелец 02.10, поздно вечером).
--
-- «Давай главную ещё раз переделаем: разрешение на кнопку создания клиента…
-- база клиентов — видеть или не видеть, редактировать убираем… и если я
-- зажимаю на клиенте — открывается менюшка, то же самое: может или не может,
-- как в календаре „Переносить"».
--
-- • «База клиентов» (`clients`) — «Скрыта · Видит». Кто стоял на
--   «Редактирует», получает «Видит», а с ним «Создание клиента: Может» и
--   «Меню клиента: Может» — ничего не теряет.
-- • «Создание клиента» (`clients.create`) — «Не может · Может»: кнопка
--   «Создать клиента» и `create_client_with_tags` (команда клиента — из тех,
--   где он может заводить).
-- • «Меню клиента» (`clients.menu`) — «Не может · Может»: долгое нажатие на
--   клиента и «⋯» в карточке — «Напомнить», «Закрепить», «В архив»,
--   «Удалить». Архив и корзина партнёра — `member_archive_client` (новая) и
--   `member_trash_client`; напоминание и закрепление — `update_client_with_tags`
--   по этому праву. «Выбрать несколько» партнёру не даётся (выгрузка).
--
-- Тела сняты с боевой базы 02.10 и изменены только в помеченных местах:
-- `access_client_blocks` (d5c98868…), `update_client_with_tags` (2426a7e4…),
-- `member_trash_client` (4b949974…), `create_client_with_tags` (b7dc5570…;
-- умолчание `p_tag_ids` сохранено). `create or replace` права исполнения не
-- трогает; новой `member_archive_client` права выдаются здесь же.

-- ─── 1. Реестр и строки тех, кто уже работает ────────────────────────────────

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  ('clients.create', 'clients', 'calendar', array['off', 'write'], 'Создание клиента', false, true,
   array['function:public.create_client_with_tags(uuid, uuid, jsonb, uuid[])'], 221),
  ('clients.menu', 'clients', 'calendar', array['off', 'write'], 'Меню клиента', false, true,
   array['function:public.member_trash_client(uuid)',
         'function:public.member_archive_client(uuid)',
         'function:public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'], 222)
on conflict (key) do update
  set area = excluded.area,
      scope = excluded.scope,
      levels = excluded.levels,
      title_ru = excluded.title_ru,
      owner_only = excluded.owner_only,
      live = excluded.live,
      enforced_by = excluded.enforced_by,
      position = excluded.position;

insert into public.member_access (tenant_id, user_id, block, team_id, level)
select ma.tenant_id, ma.user_id, b.block, ma.team_id, 'write'
  from public.member_access ma
 cross join (values ('clients.create'), ('clients.menu')) as b(block)
 where ma.block = 'clients'
   and ma.team_id is not null
   and ma.level = 'write'
on conflict (tenant_id, user_id, block, team_id) do nothing;

update public.member_access
   set level = 'read'
 where block = 'clients'
   and level = 'write';

update public.access_blocks
   set levels = array['off', 'read']
 where key = 'clients';

-- ─── 2. Функции ──────────────────────────────────────────────────────────────

create or replace function public.access_client_blocks()
 returns table(client_id uuid, blocks jsonb)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid := public.current_tenant_id();
  -- 02.10: «Клиент», «История» и «SMS» — свои права, как остальные блоки;
  -- «Меню клиента» — тоже по клиенту (архив, удаление, закрепить, напомнить).
  block_keys constant text[] := array[
    'clients.client', 'clients.note', 'clients.people', 'clients.history',
    'clients.objects', 'clients.files', 'clients.requisites', 'clients.labels',
    'clients.personal', 'clients.money', 'clients.sms', 'clients.menu'
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
             public.access_client_ids_in(array[t.team_id]) as ids
        from unnest(public.access_calendars('clients', 'read')) as t(team_id)
    ),
    levels as (
      -- База — своим ключом: с 02.10 только «Видит» (создание и меню — свои права).
      select tm.team_id, 'clients'::text as block_key,
             case when tm.card_level = 'write' then 2 else 1 end as rank
        from teams tm
      union all
      -- Блок «Меняет» — своим правом (02.10), без «Меняет» у базы. Страницу
      -- клиента открывает каждый, кому клиент виден (02.10: «Открывает
      -- карточку» убрано) — блоки страницы больше не гаснут.
      select tm.team_id, k.block_key,
             case
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
    -- с 30.09 — свой блок карточки (ниже). В корзину и архив партнёр с
    -- «Меню клиента: Меняет» кладёт клиента своими дверями (02.10).
    if p_patch ?| array['deleted_at', 'balance', 'discount', 'blacklisted',
                        'favorite_master_id'] then
      raise exception 'only the owner archives a client, changes its money or company-wide marks'
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
    -- БЛОК «КЛИЕНТ» (02.10): имя, номера и мессенджеры, фото — по его
    -- «Меняет». Напоминание и закрепление — «Меню клиента» (ниже). Судим по значению, а не по ключу: карточка, которая
    -- пронесла то же имя рядом с заметкой, ничего в блоке не меняет. Имя для
    -- SMS — блок «SMS» (ниже).
    if coalesce(card_blocks ->> 'clients.client', 'off') <> 'write'
       and exists (
         select 1
           from unnest(array['full_name', 'phone', 'whatsapp_phone', 'email',
                             'telegram_username', 'instagram_username', 'phones',
                             'phone_e164', 'avatar_url']) as f(field)
          where (to_jsonb(next_row) -> f.field) is distinct from (to_jsonb(current_row) -> f.field)
       ) then
      raise exception 'this block of the client card is closed for this employee'
        using errcode = '42501', hint = 'block:clients.client';
    end if;
    -- Номера сотруднику приходят пустыми и открываются дверью по одному: править
    -- их можно, только открыв (иначе пустота поверх настоящих номеров).
    if exists (
         select 1
           from unnest(array['phone', 'whatsapp_phone', 'email', 'telegram_username',
                             'instagram_username', 'phones', 'phone_e164']) as f(field)
          where (to_jsonb(next_row) -> f.field) is distinct from (to_jsonb(current_row) -> f.field)
       )
       and not exists (
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
    select g.block_key into denied_block
      from (values
        ('clients.note', array['comment', 'notes']),
        ('clients.people', array['memberships']),
        ('clients.objects', array['locations', 'equipment', 'address', 'property_type']),
        ('clients.labels', array['city', 'city_manual']),
        ('clients.personal', array['birthday', 'language', 'acquisition_source',
                                   'referred_by_client_id', 'first_contact_date']),
        ('clients.requisites', array['legal_name', 'vat_number', 'reg_number',
                                     'billing_address', 'requisites']),
        ('clients.sms', array['sms_name']),
        ('clients.menu', array['reminder_at', 'pinned_at'])
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

create or replace function public.member_trash_client(p_client_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  base_level text;
begin
  if auth.uid() is null or active_tenant is null or p_client_id is null then
    raise exception 'sign in to delete a client'
      using errcode = '42501';
  end if;
  if public.current_user_role() is distinct from 'owner' then
    -- 02.10: «Меню клиента: Меняет» (раньше — «База: Редактирует»).
    select b.blocks ->> 'clients.menu' into base_level
      from public.access_client_blocks() b
     where b.client_id = p_client_id;
    if base_level is distinct from 'write' then
      raise exception 'only the owner or an employee who manages clients from the menu deletes a client'
        using errcode = '42501', hint = 'block:clients.menu';
    end if;
  end if;
  update public.clients c
     set deleted_at = now(),
         purge_at = case
           when exists (
             select 1 from public.appointments a
              where a.tenant_id = c.tenant_id and a.client_id = c.id
           ) then null
           else now() + interval '30 days'
         end
   where id = p_client_id
     and tenant_id = active_tenant
     and deleted_at is null;
  if not found then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;
end;
$function$;

create or replace function public.member_archive_client(p_client_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  base_level text;
begin
  if auth.uid() is null or active_tenant is null or p_client_id is null then
    raise exception 'sign in to archive a client'
      using errcode = '42501';
  end if;
  if public.current_user_role() is distinct from 'owner' then
    -- 02.10: «Меню клиента: Меняет» (раньше — «База: Редактирует»).
    select b.blocks ->> 'clients.menu' into base_level
      from public.access_client_blocks() b
     where b.client_id = p_client_id;
    if base_level is distinct from 'write' then
      raise exception 'only the owner or an employee who manages clients from the menu archives a client'
        using errcode = '42501', hint = 'block:clients.menu';
    end if;
  end if;
  -- Архив — без срока стирания: история цела, вернуть может владелец.
  update public.clients c
     set deleted_at = now(),
         purge_at = null
   where id = p_client_id
     and tenant_id = active_tenant
     and deleted_at is null;
  if not found then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;
end;
$function$;

create or replace function public.create_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_client jsonb, p_tag_ids uuid[] DEFAULT ARRAY[]::uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  active_tenant_id uuid := public.current_tenant_id();
  active_role text := public.current_user_role();
  input_row public.clients%rowtype;
  saved_row public.clients%rowtype;
  normalized_tag_ids uuid[];
  effective_client_id uuid := coalesce(p_client_id, gen_random_uuid());
  labels_open boolean := true;
begin
  if auth.uid() is null
     or active_tenant_id is null
     or active_role is null
     or not (active_role = 'owner'
             or cardinality(public.access_calendars('clients.create', 'write')) > 0) then
    -- 02.10: заводит клиентов право «Создание клиента», а не «База».
    raise exception 'only an owner or an employee who can create clients can create a client'
      using errcode = '42501', hint = 'block:clients.create';
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
  -- сотруднику нельзя заводить клиентов («Создание клиента», 02.10), —
  -- заменяется его первой; пусто — первая живая команда, доступная создающему.
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
     and (input_row.team_id = any(public.access_calendars('clients.create', 'write'))) is not true then
    input_row.team_id := null;
  end if;
  if input_row.team_id is null then
    input_row.team_id := (
      select team.id
        from public.teams team
       where team.tenant_id = active_tenant_id
         and team.is_active
         and (active_role = 'owner'
              or team.id = any(public.access_calendars('clients.create', 'write')))
       order by team.position, team.created_at
       limit 1
    );
  end if;

  -- БЛОКИ КАРТОЧКИ (30.09): сотрудник заводит только то, что в команде
  -- клиента может менять; поля остальных блоков ложатся пустыми, без отказа —
  -- экран этих блоков ему не показывает.
  if active_role <> 'owner' then
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.note', input_row.team_id) is distinct from 'write' then
      input_row.comment := '';
      input_row.notes := '[]'::jsonb;
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.people', input_row.team_id) is distinct from 'write' then
      input_row.memberships := '[]'::jsonb;
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.objects', input_row.team_id) is distinct from 'write' then
      input_row.locations := '[]'::jsonb;
      input_row.equipment := '[]'::jsonb;
      input_row.address := '';
      input_row.property_type := '';
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.labels', input_row.team_id) is distinct from 'write' then
      input_row.city := '';
      input_row.city_manual := false;
      labels_open := false;
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.personal', input_row.team_id) is distinct from 'write' then
      input_row.birthday := '';
      input_row.language := null;
      input_row.acquisition_source := 'unknown';
      input_row.referred_by_client_id := null;
      input_row.first_contact_date := null;
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.requisites', input_row.team_id) is distinct from 'write' then
      input_row.legal_name := null;
      input_row.vat_number := null;
      input_row.reg_number := null;
      input_row.billing_address := null;
      input_row.requisites := '[]'::jsonb;
    end if;
  end if;

  normalized_tag_ids := public.normalize_client_tag_ids(
    active_tenant_id,
    case when labels_open then p_tag_ids else array[]::uuid[] end
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

  -- Теги — внутрь маски: закрытые «Метка и тег» сотруднику не вернутся.
  return public.client_seen_by_caller(
    to_jsonb(saved_row) || jsonb_build_object('tag_ids', to_jsonb(normalized_tag_ids))
  );
end;
$function$;

revoke all on function public.member_archive_client(uuid) from public, anon;
grant execute on function public.member_archive_client(uuid) to authenticated;
