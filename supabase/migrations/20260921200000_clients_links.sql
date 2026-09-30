-- STORY-085, ВЫБОР ВЛАДЕЛЬЦА 2026-09-21 (вариант 3): «ВСЕ — КЛИЕНТЫ, СВЯЗАНЫ
-- ДРУГ С ДРУГОМ».
--
-- Владелец отверг «людей внутри карточки»: «в одном клиенте несколько
-- клиентов — это неправильно… под компанией могут быть клиенты, которые у нас
-- уже есть в базе». Из трёх показанных вариантов выбран третий: человек —
-- настоящий клиент со своей карточкой, и любая карточка может перечислить
-- другие карточки своими людьми, с ролью своими словами. Человека и компанию
-- продукт не различает.
--
-- 1. СВЯЗЬ ХРАНИТСЯ У ЧЕЛОВЕКА: `clients.memberships` —
--    [{group_id, role, location_id?}] — «в какие карточки я вхожу, кем и на
--    каком их объекте». Третий ключ — STORY-086: без него у вопроса «кто
--    живёт в Вилле 5» нет ответа. Так она едет
--    вместе со строкой клиента через всё, что уже есть: права и видимость
--    сотрудника, офлайн-кэш, очередь выгрузки, реалтайм. Новому человеку со
--    связью хватает ОДНОЙ записи (создание клиента уже несёт поле), и
--    очередь не может отправить связь раньше самого человека. Люди карточки —
--    это клиенты, у которых в `memberships` стоит её id.
--
--    Правило связи держит триггер, а не белый список RPC: офлайн-очередь
--    пишет строку клиента прямо в таблицу. Ссылка на карточку ДРУГОЙ компании
--    или на саму себя — отказ; ссылка на карточку, которой больше нет, —
--    молча уходит при следующей правке (иначе стёртая компания запирала бы
--    правку всех своих людей).
--
-- 2. `clients.people` (люди внутри карточки, утро 2026-09-21) УХОДИТ.
--    Единственный живой человек в нём — Екатерина у Павла Иванова — перед
--    сносом становится своей карточкой со связью «жена». Данные до запуска
--    тестовые (слово владельца), но терять заведённое им самим незачем.
--    `appointments.person_id` уходит тоже: «кто заказал» будет ссылкой на
--    карточку клиента — это следующий шаг, запись.
--
-- 3. ВИДА КЛИЕНТА БОЛЬШЕ НЕТ (`clients.kind`), как и было решено днём.
--    Белые списки создания и правки клиента и снимок получателя инвойса взяты
--    из миграции 20260921151525 и отличаются ровно строками про `kind` и
--    `people` (`people` → `memberships`).

begin;

set local lock_timeout = '5s';

-- ─── 1. Связи: кто в какую карточку входит ───────────────────────────────
alter table public.clients
  add column if not exists memberships jsonb not null default '[]'::jsonb;

alter table public.clients drop constraint if exists clients_memberships_is_array;
alter table public.clients
  add constraint clients_memberships_is_array check (jsonb_typeof(memberships) = 'array');

comment on column public.clients.memberships is
  'В какие карточки входит этот клиент, кем и где: [{group_id, role, location_id?}]. Люди карточки X — клиенты, у которых в memberships есть X; жильцы объекта L — они же с location_id = L.';

create or replace function public.enforce_client_memberships()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  caller_role text;
  kept text[];
  fresh text[];
  seen_ids text[];
begin
  if new.memberships is null or jsonb_typeof(new.memberships) <> 'array' then
    raise exception 'client memberships must be an array'
      using errcode = '22023';
  end if;

  -- Связь — объект с id карточки; на себя и на карточку чужой компании — нет.
  if exists (
    select 1
      from jsonb_array_elements(new.memberships) m
     where jsonb_typeof(m.value) <> 'object'
        or coalesce(m.value ->> 'group_id', '')
           !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or m.value ->> 'group_id' = new.id::text
        or exists (
          select 1 from public.clients other
           where other.id::text = m.value ->> 'group_id'
             and other.tenant_id <> new.tenant_id
        )
  ) then
    raise exception 'client memberships must point to other clients of the same company'
      using errcode = '22023';
  end if;

  -- ЦЕЛЬ СВЯЗИ — ВНУТРИ НАБОРА СОТРУДНИКА (STORY-086, дыра 8 критика).
  -- Право править спрашивается по ПРАВИМОЙ строке, а карточка-группа — строка
  -- чужая: зная uuid, сотрудник привязал бы своего клиента к карточке, которую
  -- ему не показывает уровень «Какие клиенты», и обратный список владельца
  -- пополнился бы чужой рукой. Судим только НОВЫЕ цели: уже стоящую связь
  -- сотрудник обязан уметь пронести через правку имени или заметки, иначе один
  -- запрет запер бы всю карточку. Владельца и внутренние ходы (миграции, чистка
  -- корзины — там `auth.uid()` пуст) правило не касается.
  caller_role := case when auth.uid() is null then null else public.current_user_role() end;
  if caller_role is not null and caller_role <> 'owner'
     and jsonb_array_length(new.memberships) > 0 then
    if tg_op = 'UPDATE' then
      select coalesce(array_agg(distinct m.value ->> 'group_id'), array[]::text[])
        into kept
        from jsonb_array_elements(coalesce(old.memberships, '[]'::jsonb)) m;
    else
      kept := array[]::text[];
    end if;

    select coalesce(array_agg(distinct m.value ->> 'group_id'), array[]::text[])
      into fresh
      from jsonb_array_elements(new.memberships) m
     where not (m.value ->> 'group_id' = any(kept));

    if cardinality(fresh) > 0 then
      select coalesce(array_agg(seen.id::text), array[]::text[])
        into seen_ids
        from unnest(public.access_client_ids()) as seen(id);
      if exists (select 1 from unnest(fresh) f where not (f = any(seen_ids))) then
        raise exception 'client memberships must point to clients this employee can see'
          using errcode = '42501', hint = 'block:clients.scope';
      end if;
    end if;
  end if;

  -- Одна связь на карточку И МЕСТО, роль — обрезанный текст, лишних ключей нет;
  -- карточка, которой больше нет, из списка уходит.
  --
  -- МЕСТО СВЕРЯЕТСЯ С ОБЪЕКТАМИ САМОЙ КАРТОЧКИ-ГРУППЫ: чужое или уже стёртое —
  -- `null`, а САМА СВЯЗЬ ЖИВЁТ: человек не перестал быть жильцом Натальи
  -- оттого, что виллу стёрли. Эта же сверка держит ключ узким — свободного
  -- текста в связи не бывает, и контакт мимо маскировки в ней не провезти.
  -- Дедуп идёт по ПАРЕ (карточка, место): один человек законно жилец двух
  -- вилл одной управляющей, и это не дубль.
  new.memberships := coalesce((
    select jsonb_agg(
             jsonb_strip_nulls(jsonb_build_object(
               'group_id', d.group_id,
               'role', d.role,
               'location_id', d.location_id
             )) order by d.pos)
      from (
        select distinct on (v.group_id, v.location_id)
               v.group_id, v.role, v.location_id, v.pos
          from (
            select m.value ->> 'group_id' as group_id,
                   btrim(coalesce(m.value ->> 'role', '')) as role,
                   (
                     select l.value ->> 'id'
                       from public.clients g
                       cross join lateral jsonb_array_elements(
                         case when jsonb_typeof(g.locations) = 'array'
                              then g.locations else '[]'::jsonb end
                       ) l
                      where g.id::text = m.value ->> 'group_id'
                        and g.tenant_id = new.tenant_id
                        and l.value ->> 'id' = m.value ->> 'location_id'
                      limit 1
                   ) as location_id,
                   m.pos
              from jsonb_array_elements(new.memberships) with ordinality as m(value, pos)
             where exists (
               select 1 from public.clients g
                where g.id::text = m.value ->> 'group_id'
                  and g.tenant_id = new.tenant_id
             )
          ) v
         order by v.group_id, v.location_id, v.pos
      ) d
  ), '[]'::jsonb);
  return new;
end;
$function$;

revoke all on function public.enforce_client_memberships() from public, anon, authenticated;

-- КРУГ СВЯЗЕЙ ЗДЕСЬ НЕ ЗАПРЕЩЁН НАМЕРЕННО (STORY-086, дыра 15 критика):
-- Павел — член Екатерины, Екатерина — член Павла. Круг гасит ДВЕРЬ: пикер не
-- показывает тех, у кого уже есть связь с этой карточкой в обратную сторону.
-- Сервер ради вежливости интерфейса чужие строки не читает: проверка круга
-- заставила бы каждую правку связи ходить в memberships карточки-цели, то есть
-- в строку, которой правящий может и не видеть.
drop trigger if exists clients_enforce_memberships on public.clients;
create trigger clients_enforce_memberships
  before insert or update of memberships on public.clients
  for each row execute function public.enforce_client_memberships();

-- ─── Карточка ушла в архив или стёрта — связи на неё снимаются ───────────
-- STORY-086, дыра 4 критика. Архив — это `update clients set deleted_at`
-- прямо по таблице, а стирание — `delete` (repositories/clients.ts): RPC, к
-- которой можно было бы прицепить definer-функцию, на этих дорогах нет, а
-- корзину чистит ещё и серверная чистка по `purge_at`. Поэтому правило висит
-- ТРИГГЕРОМ у самой таблицы: любая дорога к архиву и стиранию проходит через
-- него, и ни один вызывающий не может его забыть. Иначе у десяти жильцов
-- остаётся связь на карточку, которой нет ни в окне сотрудника, ни в наборе, —
-- и имя для строки взять неоткуда.
create or replace function public.detach_client_memberships()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update public.clients member
     set memberships = coalesce((
           select jsonb_agg(m.value order by m.pos)
             from jsonb_array_elements(member.memberships) with ordinality as m(value, pos)
            where m.value ->> 'group_id' <> old.id::text
         ), '[]'::jsonb)
   where member.tenant_id = old.tenant_id
     and member.id <> old.id
     and member.memberships @> jsonb_build_array(jsonb_build_object('group_id', old.id::text));
  return null;
end;
$function$;

revoke all on function public.detach_client_memberships() from public, anon, authenticated;

drop trigger if exists clients_detach_memberships_archived on public.clients;
create trigger clients_detach_memberships_archived
  after update of deleted_at on public.clients
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.detach_client_memberships();

drop trigger if exists clients_detach_memberships_deleted on public.clients;
create trigger clients_detach_memberships_deleted
  after delete on public.clients
  for each row execute function public.detach_client_memberships();

-- ─── Объект исчез у карточки — место у её людей гаснет ───────────────────
-- STORY-086, дыра 12 критика. Сверка места живёт в `before … update of
-- memberships` У ЧЛЕНА, а виллу удаляют У ГРУППЫ (`clients.locations`): без
-- этого триггера строка «Иван Петров · Вилла 5» висела бы до следующей правки
-- связей, а имени месту взять уже неоткуда. Снимается ТОЛЬКО место — связь
-- остаётся: жильцом Натальи человек быть не перестал.
create or replace function public.clear_gone_membership_places()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update public.clients member
     set memberships = coalesce((
           select jsonb_agg(
                    case
                      when m.value ->> 'group_id' = new.id::text
                       and not exists (
                         select 1
                           from jsonb_array_elements(
                             case when jsonb_typeof(new.locations) = 'array'
                                  then new.locations else '[]'::jsonb end
                           ) l
                          where l.value ->> 'id' = m.value ->> 'location_id'
                       )
                      then m.value - 'location_id'
                      else m.value
                    end order by m.pos)
             from jsonb_array_elements(member.memberships) with ordinality as m(value, pos)
         ), '[]'::jsonb)
   where member.tenant_id = new.tenant_id
     and member.memberships @> jsonb_build_array(jsonb_build_object('group_id', new.id::text))
     -- Правим ровно тех, у кого место И СТОИТ, И ПРОПАЛО: иначе каждая правка
     -- объектов карточки переписывала бы связи всех её людей впустую.
     and exists (
       select 1
         from jsonb_array_elements(member.memberships) m
        where m.value ->> 'group_id' = new.id::text
          and m.value ? 'location_id'
          and not exists (
            select 1
              from jsonb_array_elements(
                case when jsonb_typeof(new.locations) = 'array'
                     then new.locations else '[]'::jsonb end
              ) l
             where l.value ->> 'id' = m.value ->> 'location_id'
          )
     );
  return null;
end;
$function$;

revoke all on function public.clear_gone_membership_places() from public, anon, authenticated;

drop trigger if exists clients_clear_membership_places on public.clients;
create trigger clients_clear_membership_places
  after update of locations on public.clients
  for each row execute function public.clear_gone_membership_places();

-- ─── 2. Люди внутри карточки становятся своими карточками ────────────────
insert into public.clients (
  id, tenant_id, created_by, full_name, phone, phone_e164, phones,
  whatsapp_phone, telegram_username, instagram_username, email, memberships
)
select gen_random_uuid(),
       owner.tenant_id,
       owner.created_by,
       coalesce(nullif(btrim(person.value ->> 'name'), ''), btrim(person.value ->> 'phone')),
       btrim(coalesce(person.value ->> 'phone', '')),
       case
         when btrim(coalesce(person.value ->> 'phone', '')) like '+%'
          and regexp_replace(person.value ->> 'phone', '\D', '', 'g') ~ '^\d{8,15}$'
         then '+' || regexp_replace(person.value ->> 'phone', '\D', '', 'g')
       end,
       case when jsonb_typeof(person.value -> 'phones') = 'array'
            then person.value -> 'phones' else '[]'::jsonb end,
       coalesce(person.value ->> 'whatsapp_phone', ''),
       coalesce(person.value ->> 'telegram_username', ''),
       coalesce(person.value ->> 'instagram_username', ''),
       coalesce(person.value ->> 'email', ''),
       jsonb_build_array(jsonb_build_object(
         'group_id', owner.id::text,
         'role', btrim(coalesce(person.value ->> 'role', ''))
       ))
  from public.clients owner
  cross join lateral jsonb_array_elements(
         case when jsonb_typeof(owner.people) = 'array' then owner.people else '[]'::jsonb end
       ) person
 where nullif(btrim(coalesce(person.value ->> 'name', '')), '') is not null
    or nullif(btrim(coalesce(person.value ->> 'phone', '')), '') is not null;

alter table public.clients drop constraint if exists clients_people_is_array;
alter table public.clients drop column if exists people;
alter table public.appointments drop column if exists person_id;

-- ─── 3. Вида клиента больше нет ──────────────────────────────────────────
alter table public.clients drop constraint if exists clients_kind_check;
alter table public.clients drop column if exists kind;

-- ─── Маскировка для сотрудника — без людей внутри карточки ───────────────
-- Люди теперь — клиенты, и каждая их строка маскируется сама, как любая.
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
    'phone_e164', null
  )
$function$;

-- ─── Создание клиента — связи вместо людей, без `kind` ───────────────────
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
       'legal_name',
       'vat_number',
       'reg_number',
       'billing_address',
       'memberships'
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
    memberships
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
    coalesce(input_row.memberships, '[]'::jsonb)
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

-- ─── Правка клиента — связи вместо людей, без `kind` ─────────────────────
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
       'memberships'
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
    -- карточки затёрли бы настоящие номера.
    if not public.access_company('clients.contacts', 'read')
       and p_patch ?| array['phone', 'whatsapp_phone', 'email', 'telegram_username',
                            'instagram_username', 'phones', 'phone_e164'] then
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
         memberships = coalesce(next_row.memberships, '[]'::jsonb)
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

-- ─── Получатель инвойса — без `kind` ─────────────────────────────────────
create or replace function public.build_invoice_client_snapshot(p_tenant_id uuid, p_client_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'schema_version', 1,
    'client_id', client.id,
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
  missing text;
  v_def text;
  v_name text;
  v_events text;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and ((table_name = 'clients' and column_name in ('kind', 'people'))
         or (table_name = 'appointments' and column_name = 'person_id'))
  ) then
    raise exception 'STORY-085 links: kind / people / person_id still exist';
  end if;

  select string_agg(p.proname, ', ') into missing
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('create_client_with_tags', 'update_client_with_tags',
                       'build_invoice_client_snapshot', 'client_without_contacts')
     and (p.prosrc ~ '\mkind\M' or p.prosrc ~ '\mpeople\M');
  if missing is not null then
    raise exception 'STORY-085 links: functions still read kind or people: %', missing;
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgname = 'clients_enforce_memberships' and not t.tgisinternal
  ) then
    raise exception 'STORY-085 links: memberships are not guarded';
  end if;

  if exists (select 1 from public.clients where jsonb_typeof(memberships) <> 'array') then
    raise exception 'STORY-085 links: a client has broken memberships';
  end if;

  -- STORY-086: три ключа, сверка места, дедуп по паре и цель внутри набора —
  -- каждое правило стоит в теле, а не в намерении.
  v_def := pg_get_functiondef('public.enforce_client_memberships()'::regprocedure);
  if position('''location_id'', d.location_id' in v_def) = 0 then
    raise exception 'STORY-086 links: связь пересобирается без третьего ключа';
  end if;
  if position('and l.value ->> ''id'' = m.value ->> ''location_id''' in v_def) = 0 then
    raise exception 'STORY-086 links: место не сверяется с объектами карточки-группы';
  end if;
  if position('distinct on (v.group_id, v.location_id)' in v_def) = 0 then
    raise exception 'STORY-086 links: дедуп связей идёт не по паре «карточка + место»';
  end if;
  if position('public.access_client_ids()' in v_def) = 0 then
    raise exception 'STORY-086 links: цель связи не сверяется с набором сотрудника';
  end if;

  -- STORY-086, дыры 4 и 12: снятие связей при архиве и стирании группы и
  -- гашение места, когда объект у группы исчез.
  for v_name, v_events in
    select * from (values
      ('clients_detach_memberships_archived', 'AFTER UPDATE OF deleted_at'),
      ('clients_detach_memberships_deleted', 'AFTER DELETE'),
      ('clients_clear_membership_places', 'AFTER UPDATE OF locations')
    ) as want(name, events)
  loop
    select pg_get_triggerdef(t.oid) into v_def
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relname = 'clients'
       and c.relnamespace = 'public'::regnamespace
       and t.tgname = v_name
       and not t.tgisinternal;
    if v_def is null then
      raise exception 'STORY-086 links: нет сторожа %', v_name;
    end if;
    if position(v_events in v_def) = 0 then
      raise exception 'STORY-086 links: % слушает не % (%)', v_name, v_events, v_def;
    end if;
  end loop;
end;
$audit$;

commit;
