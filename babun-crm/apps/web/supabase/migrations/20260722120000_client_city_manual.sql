-- Клиентская «Метка» из библиотеки Кабинета (cities) — флаг ручного выбора.
-- The 14-digit prefix is a unique Supabase CLI migration version.
--
-- city остаётся строкой-именем метки (вся система меток строковая:
-- day_cities, teams.cities[], каскад переименования). city_manual=true —
-- владелец выбрал метку руками, автоприсвоение из метки дня её не трогает.
-- «Убрать метку» возвращает city_manual=false (авто-режим).

alter table public.clients
  add column if not exists city_manual boolean not null default false;

-- Бэкфилл (решение владельца 2026-07-22): свободный текст, не совпавший
-- ни с одной активной меткой библиотеки тенанта, набран руками — защищаем
-- от автоперезаписи. Совпавшие значения остаются в авто-режиме.
update public.clients c
   set city_manual = true
 where btrim(coalesce(c.city, '')) <> ''
   and not exists (
     select 1
       from public.cities l
      where l.tenant_id = c.tenant_id
        and l.is_active = true
        and lower(btrim(l.name)) = lower(btrim(c.city))
   );

-- Совпавшие trim/case-insensitive — нормализуем к каноничному написанию
-- библиотеки (при дублях побеждает верхняя по position, затем старшая).
update public.clients c
   set city = m.name
  from (
    select distinct on (l.tenant_id, lower(btrim(l.name)))
           l.tenant_id,
           lower(btrim(l.name)) as norm,
           l.name
      from public.cities l
     where l.is_active = true
     order by l.tenant_id, lower(btrim(l.name)), l.position, l.created_at
  ) m
 where m.tenant_id = c.tenant_id
   and m.norm = lower(btrim(c.city))
   and c.city is distinct from m.name;

-- Пересоздание атомарных RPC из 20260720210012 с city_manual в белых
-- списках — иначе любой клиентский save с новым ключом отвергается
-- («client payload contains a protected or unknown field»).

create or replace function public.create_client_with_tags(
  p_tenant_id uuid,
  p_client_id uuid,
  p_client jsonb,
  p_tag_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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
     or active_role not in ('owner', 'dispatcher') then
    raise exception 'only an owner or dispatcher can create a client'
      using errcode = '42501';
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
       'created_at'
     )
  ) then
    raise exception 'client payload contains a protected or unknown field'
      using errcode = '22023';
  end if;

  input_row := jsonb_populate_record(null::public.clients, p_client);

  if nullif(btrim(input_row.full_name), '') is null then
    raise exception 'client name is required'
      using errcode = '23514';
  end if;

  if jsonb_typeof(coalesce(input_row.phones, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.locations, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.notes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.equipment, '[]'::jsonb)) <> 'array' then
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
    created_at
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
    coalesce(input_row.created_at, now())
  )
  returning * into saved_row;

  insert into public.client_tag_assignments (
    tenant_id,
    client_id,
    tag_id
  )
  select active_tenant_id, saved_row.id, supplied.tag_id
    from unnest(normalized_tag_ids) supplied(tag_id);

  return to_jsonb(saved_row)
    || jsonb_build_object('tag_ids', to_jsonb(normalized_tag_ids));
end;
$function$;

revoke all on function public.create_client_with_tags(uuid, uuid, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.create_client_with_tags(uuid, uuid, jsonb, uuid[])
  to authenticated;

create or replace function public.update_client_with_tags(
  p_tenant_id uuid,
  p_client_id uuid,
  p_patch jsonb,
  p_tag_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
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
     or active_role not in ('owner', 'dispatcher') then
    raise exception 'only an owner or dispatcher can update a client'
      using errcode = '42501';
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
       'favorite_master_id'
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

  next_row := jsonb_populate_record(current_row, p_patch);

  if nullif(btrim(next_row.full_name), '') is null then
    raise exception 'client name is required'
      using errcode = '23514';
  end if;

  if jsonb_typeof(coalesce(next_row.phones, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.locations, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.notes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.equipment, '[]'::jsonb)) <> 'array' then
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
         favorite_master_id = next_row.favorite_master_id
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

  return to_jsonb(saved_row)
    || jsonb_build_object('tag_ids', to_jsonb(result_tag_ids));
end;
$function$;

revoke all on function public.update_client_with_tags(uuid, uuid, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.update_client_with_tags(uuid, uuid, jsonb, uuid[])
  to authenticated;

do $$
begin
  if has_function_privilege(
       'anon',
       'public.create_client_with_tags(uuid,uuid,jsonb,uuid[])',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.update_client_with_tags(uuid,uuid,jsonb,uuid[])',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.create_client_with_tags(uuid,uuid,jsonb,uuid[])',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.update_client_with_tags(uuid,uuid,jsonb,uuid[])',
       'EXECUTE'
     ) then
    raise exception 'client city_manual: unsafe RPC grants';
  end if;
end;
$$;
