-- КЛИЕНТ — СЕМЬЯ ИЛИ КОМПАНИЯ, ВНУТРИ ЛЮДИ (STORY-085, волна 1: база).
--
-- Владелец 2026-09-21: «звонит Павел, заказывает чистку… потом звонит его
-- жена Екатерина… объект один и тот же, клиент по сути один и тот же, но
-- разные люди… и то же самое компания: Павел — владелец, Ольга —
-- управляющая». Модель:
--
--   · КЛИЕНТ — тот, кому принадлежат объекты и кому выставляют счёт:
--     `kind = 'person'` (человек, семья) или `'company'` (юрлицо);
--   · у компании — реквизиты: `legal_name`, `vat_number`, `reg_number`,
--     `billing_address` (те же имена, что у реквизитов продавца `companies`);
--   · ЛЮДИ — `people jsonb`: [{id, name, role, phone, whatsapp_phone, email}].
--     Живут списком внутри клиента, как объекты (`locations`), и запись
--     ссылается на человека по id, как на объект (`appointments.location_id`);
--   · запись помнит, КТО ЗАКАЗАЛ: `appointments.person_id` (пусто — главный).
--
-- У клиента-человека главный человек — сам клиент (`full_name`, `phone`), и
-- всё, что читает `client.phone` (SMS, WhatsApp, поиск дублей), работает без
-- правок.
--
-- ДОСТУП СОТРУДНИКА:
--   · телефоны людей — это контакты: без блока `clients.contacts` сотрудник
--     видит имена и роли, но не номера, и не может переписать список людей
--     (пустые номера его карточки затёрли бы настоящие) — то же правило, что у
--     `phones`;
--   · реквизиты компании (VAT, рег. номер, адрес для счетов) — документы и
--     деньги: их видит и правит только владелец, как баланс и скидку.
--
-- ДАННЫЕ ДО ЗАПУСКА ТЕСТОВЫЕ (владелец 21.09), поэтому единственная правка
-- строк — перенос: доп. номер С ИМЕНЕМ (сценарий v309 «Жена · Мария») — это
-- человек, а не номер. На день миграции таких нет ни одного.

begin;

set local lock_timeout = '5s';

-- ─── Колонки ─────────────────────────────────────────────────────────────
-- Умолчания здесь постоянные ('person', пустой список) — прошивка ими прошлых
-- строк и есть правда: до сегодня каждый клиент был человеком без людей.
alter table public.clients
  add column if not exists kind text not null default 'person',
  add column if not exists legal_name text,
  add column if not exists vat_number text,
  add column if not exists reg_number text,
  add column if not exists billing_address text,
  add column if not exists people jsonb not null default '[]'::jsonb;

alter table public.clients drop constraint if exists clients_kind_check;
alter table public.clients
  add constraint clients_kind_check check (kind in ('person', 'company'));

alter table public.clients drop constraint if exists clients_people_is_array;
alter table public.clients
  add constraint clients_people_is_array check (jsonb_typeof(people) = 'array');

comment on column public.clients.kind is
  'Кто клиент: person — человек или семья, company — юрлицо (печатается получателем инвойса с реквизитами).';
comment on column public.clients.people is
  'Люди клиента, кроме главного: [{id, name, role, phone, whatsapp_phone, email}]. Главный человек клиента — сам клиент (full_name, phone).';

alter table public.appointments
  add column if not exists person_id text;

comment on column public.appointments.person_id is
  'Кто заказал: id человека из clients.people. Пусто — главный человек клиента.';

-- ─── Перенос: номер с именем — это человек ───────────────────────────────
update public.clients c
   set people = c.people || (
         select coalesce(jsonb_agg(jsonb_build_object(
                  'id', coalesce(nullif(e.value ->> 'id', ''), gen_random_uuid()::text),
                  'name', btrim(e.value ->> 'name'),
                  'role', coalesce(nullif(btrim(e.value ->> 'label'), ''), ''),
                  'phone', coalesce(e.value ->> 'number', '')
                ) order by e.position), '[]'::jsonb)
           from jsonb_array_elements(c.phones) with ordinality as e(value, position)
          where nullif(btrim(e.value ->> 'name'), '') is not null
       ),
       phones = (
         select coalesce(jsonb_agg(e.value order by e.position), '[]'::jsonb)
           from jsonb_array_elements(c.phones) with ordinality as e(value, position)
          where nullif(btrim(e.value ->> 'name'), '') is null
       )
 where jsonb_typeof(c.phones) = 'array'
   and exists (
     select 1 from jsonb_array_elements(c.phones) e
      where nullif(btrim(e ->> 'name'), '') is not null
   );

-- ─── Маскировка для сотрудника ───────────────────────────────────────────
-- Без блока контактов — номера людей пустые, имена и роли остаются: человек
-- без номера всё ещё отвечает на вопрос «кто заказал».
create or replace function public.client_without_contacts(p_client jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  select p_client || jsonb_build_object(
    'phone', '',
    'whatsapp_phone', '',
    'email', '',
    'telegram_username', '',
    'instagram_username', '',
    'phones', '[]'::jsonb,
    'phone_e164', null,
    'people', coalesce((
      select jsonb_agg(person || jsonb_build_object(
               'phone', '', 'whatsapp_phone', '', 'email', ''))
        from jsonb_array_elements(
               case when jsonb_typeof(p_client -> 'people') = 'array'
                    then p_client -> 'people' else '[]'::jsonb end
             ) person
    ), '[]'::jsonb)
  )
$function$;

-- Реквизиты компании — к деньгам: их видит только владелец.
create or replace function public.client_without_money(p_client jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  select p_client || jsonb_build_object(
    'balance', 0,
    'discount', 0,
    'vat_number', null,
    'reg_number', null,
    'billing_address', null
  )
$function$;

-- ─── Создание клиента ────────────────────────────────────────────────────
-- Тело — живое определение из базы на 2026-09-21, изменения помечены «085».
create or replace function public.create_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_client jsonb, p_tag_ids uuid[] default array[]::uuid[])
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
       'kind',
       'legal_name',
       'vat_number',
       'reg_number',
       'billing_address',
       'people'
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
  end if;

  if nullif(btrim(input_row.full_name), '') is null then
    raise exception 'client name is required'
      using errcode = '23514';
  end if;

  if jsonb_typeof(coalesce(input_row.phones, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.locations, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.notes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.equipment, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.people, '[]'::jsonb)) <> 'array' then
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
    created_at,
    kind,
    legal_name,
    vat_number,
    reg_number,
    billing_address,
    people
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
    coalesce(input_row.kind, 'person'),
    nullif(btrim(input_row.legal_name), ''),
    nullif(btrim(input_row.vat_number), ''),
    nullif(btrim(input_row.reg_number), ''),
    nullif(btrim(input_row.billing_address), ''),
    coalesce(input_row.people, '[]'::jsonb)
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

-- ─── Правка клиента ──────────────────────────────────────────────────────
-- Тело — живое определение из базы на 2026-09-21, изменения помечены «085».
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
       'kind',
       'legal_name',
       'vat_number',
       'reg_number',
       'billing_address',
       'people'
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
                        'vat_number', 'reg_number', 'billing_address'] then
      raise exception 'only the owner archives a client, changes its money or company-wide marks'
        using errcode = '42501', hint = 'block:clients';
    end if;
    -- Контакты, которых сотрудник не видит, он и не правит: пустые поля его
    -- карточки затёрли бы настоящие номера. 085: люди несут номера — туда же.
    if not public.access_company('clients.contacts', 'read')
       and p_patch ?| array['phone', 'whatsapp_phone', 'email', 'telegram_username',
                            'instagram_username', 'phones', 'phone_e164', 'people'] then
      raise exception 'contacts are hidden for this employee'
        using errcode = '42501', hint = 'block:clients.contacts';
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
     or jsonb_typeof(coalesce(next_row.people, '[]'::jsonb)) <> 'array' then
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
         kind = coalesce(next_row.kind, 'person'),
         legal_name = nullif(btrim(next_row.legal_name), ''),
         vat_number = nullif(btrim(next_row.vat_number), ''),
         reg_number = nullif(btrim(next_row.reg_number), ''),
         billing_address = nullif(btrim(next_row.billing_address), ''),
         people = coalesce(next_row.people, '[]'::jsonb)
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

-- ─── Получатель инвойса: компания печатается с реквизитами ───────────────
-- Добавлены пять ключей; старые инвойсы держат прежний снимок, и разбор на
-- устройстве читает новые ключи как необязательные.
create or replace function public.build_invoice_client_snapshot(p_tenant_id uuid, p_client_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'schema_version', 1,
    'client_id', client.id,
    'kind', client.kind,
    'full_name', nullif(btrim(client.full_name), ''),
    'legal_name', nullif(btrim(client.legal_name), ''),
    'vat_number', nullif(btrim(client.vat_number), ''),
    'reg_number', nullif(btrim(client.reg_number), ''),
    'billing_address', nullif(btrim(client.billing_address), ''),
    'phone', nullif(btrim(client.phone), ''),
    'phone_e164', nullif(btrim(client.phone_e164), ''),
    'whatsapp_phone', nullif(btrim(client.whatsapp_phone), ''),
    'email', nullif(btrim(client.email), ''),
    'address', nullif(btrim(client.address), ''),
    'city', nullif(btrim(client.city), ''),
    'primary_address', coalesce(
      location.address,
      nullif(
        concat_ws(
          ', ',
          nullif(btrim(client.address), ''),
          nullif(btrim(client.city), '')
        ),
        ''
      )
    ),
    'archived', client.deleted_at is not null,
    'deleted_at', client.deleted_at
  )
    from public.clients client
    left join lateral (
      select nullif(btrim(entry.value ->> 'address'), '') as address
        from jsonb_array_elements(
          case
            when jsonb_typeof(client.locations) = 'array' then client.locations
            else '[]'::jsonb
          end
        ) with ordinality as entry(value, position)
       where nullif(btrim(entry.value ->> 'address'), '') is not null
       order by
         case when lower(coalesce(entry.value ->> 'isPrimary', 'false')) = 'true'
           then 0 else 1
         end,
         entry.position
       limit 1
    ) location on true
   where client.id = p_client_id
     and client.tenant_id = p_tenant_id
$function$;

-- ─── Сторож самой миграции ───────────────────────────────────────────────
do $audit$
declare
  masked jsonb;
  stripped jsonb;
begin
  -- Колонки на месте и с правильными умолчаниями.
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'clients'
         and column_name in ('kind','legal_name','vat_number','reg_number','billing_address','people')) <> 6 then
    raise exception '085: не все колонки клиента на месте';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'appointments'
                    and column_name = 'person_id') then
    raise exception '085: у записи нет person_id';
  end if;

  -- Маскировка по поведению: номера людей пустые, имена на месте.
  masked := public.client_without_contacts(
    '{"phone":"+357","people":[{"id":"p1","name":"Екатерина","role":"жена","phone":"+35799"}]}'::jsonb);
  if masked #>> '{people,0,phone}' <> '' or masked #>> '{people,0,name}' <> 'Екатерина' then
    raise exception '085: маскировка людей не работает: %', masked;
  end if;
  stripped := public.client_without_money('{"vat_number":"CY1","legal_name":"Gem Capital Ltd"}'::jsonb);
  if stripped ->> 'vat_number' is not null or stripped ->> 'legal_name' <> 'Gem Capital Ltd' then
    raise exception '085: реквизиты не прячутся от сотрудника: %', stripped;
  end if;

  -- Функции по одной и по-прежнему закрыты от anon.
  if has_function_privilege('anon', 'public.create_client_with_tags(uuid,uuid,jsonb,uuid[])', 'execute')
     or has_function_privilege('anon', 'public.update_client_with_tags(uuid,uuid,jsonb,uuid[])', 'execute') then
    raise exception '085: запись клиента доступна anon';
  end if;
end
$audit$;

commit;
