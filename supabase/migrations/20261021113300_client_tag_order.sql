-- ПОРЯДОК ТЕГОВ КЛИЕНТА — ПОРЯДОК ВЫБОРА.
--
-- Теги клиента — набор, и первый выбранный тег главный: плитка карточки
-- показывает его имя и «+N» за остальные. Строка `client_tag_assignments`
-- своего места в наборе не хранила, а сервер и все читатели упорядочивали
-- набор по id тега. Главным выходил тег с меньшим uuid: после «Применить»
-- плитка показывала «B +1», а ответ сервера переставлял её в «A +1».
--
-- 1. `position` — место тега в наборе клиента, с нуля. Умолчание 0 безопасно
--    и для старых строк, и для записи мимо функций (импорт): равные места
--    разводит id тега, то есть порядок остаётся тем же, что сейчас. Старые
--    строки получают места по id тега — ровно тот порядок, который видно
--    сейчас.
-- 2. `normalize_client_tag_ids` сохраняет порядок присланного массива
--    (`with ordinality`); повтор остаётся на месте первого появления.
-- 3. `create_client_with_tags` и `update_client_with_tags` кладут каждому
--    тегу его номер в наборе и отвечают набором в том же порядке.
-- 4. `list_member_clients` и `list_client_members` отдают `tag_ids` по месту.
--
-- Тела функций взяты из живой базы (`pg_get_functiondef`, сверены по md5
-- перед правкой). Изменены только места тегов и комментарии: правила в них
-- записаны без дат. Права повторены как есть: функции записи и списков
-- исполняет только `authenticated`, `normalize_client_tag_ids` — никто
-- снаружи.
--
-- Порядок выкладки: сначала миграция, потом приложение. Приложение сортирует
-- строки по `position` и без колонки получит ошибку чтения списка клиентов.

set local lock_timeout = '5s';

-- ─── Место тега в наборе ────────────────────────────────────────────────────

alter table public.client_tag_assignments
  add column if not exists position integer not null default 0;

comment on column public.client_tag_assignments.position is
  'Место тега в наборе клиента, с нуля: первый — главный, его имя на плитке клиента. Равные места разводит tag_id.';

-- Старые строки — по месту в нынешнем порядке (по id тега). Журнал правку
-- одного места не пишет (`position` у него в списке пропусков), сторожа
-- тарифа и партнёра без вошедшего пропускают, сторож компании смотрит только
-- на tenant_id, client_id и tag_id.
update public.client_tag_assignments assignment
   set position = ranked.place
  from (
    select a.client_id,
           a.tag_id,
           (row_number() over (partition by a.client_id order by a.tag_id) - 1)::integer as place
      from public.client_tag_assignments a
  ) ranked
 where assignment.client_id = ranked.client_id
   and assignment.tag_id = ranked.tag_id
   and assignment.position is distinct from ranked.place;

-- ─── Набор тегов: порядок выбора, повтор — на месте первого ────────────────

CREATE OR REPLACE FUNCTION public.normalize_client_tag_ids(p_tenant_id uuid, p_tag_ids uuid[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  normalized_ids uuid[];
begin
  if p_tenant_id is null then
    raise exception 'tenant id is required'
      using errcode = '22023';
  end if;

  if array_position(coalesce(p_tag_ids, array[]::uuid[]), null) is not null then
    raise exception 'client tag ids cannot contain null'
      using errcode = '22023';
  end if;

  -- Порядок набора — порядок выбора: первый тег главный, его имя стоит на
  -- плитке клиента, остальные — «+N». Сортировать по id нельзя: главным стал
  -- бы тег с меньшим uuid, и плитка перескакивала бы после сохранения.
  -- Повтор остаётся на месте первого появления — повторный тап не сдвигает
  -- главный тег.
  select coalesce(
           array_agg(firsts.tag_id order by firsts.first_at),
           array[]::uuid[]
         )
    into normalized_ids
    from (
      select supplied.tag_id, min(supplied.ord) as first_at
        from unnest(coalesce(p_tag_ids, array[]::uuid[]))
               with ordinality supplied(tag_id, ord)
       group by supplied.tag_id
    ) firsts;

  if exists (
    select 1
      from unnest(normalized_ids) supplied(tag_id)
     where not exists (
       select 1
         from public.client_tags tag
        where tag.tenant_id = p_tenant_id
          and tag.id = supplied.tag_id
     )
  ) then
    raise exception 'client tag does not belong to the active tenant'
      using errcode = '23503';
  end if;

  return normalized_ids;
end;
$function$;

revoke all on function public.normalize_client_tag_ids(uuid, uuid[]) from public, anon, authenticated;

-- ─── Новый клиент: теги ложатся в порядке выбора ───────────────────────────

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
  labels_open boolean := true;
begin
  if auth.uid() is null
     or active_tenant_id is null
     or active_role is null
     or not (active_role = 'owner'
             or cardinality(public.access_calendars('clients.create', 'write')) > 0) then
    -- Заводит клиентов право «Создание клиента», а не «База».
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

  -- КОМАНДА КЛИЕНТА. Чужая компании команда — ошибка; команда, где
  -- сотруднику нельзя заводить клиентов («Создание клиента»), —
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

  -- БЛОКИ КАРТОЧКИ: сотрудник заводит только то, что в команде
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
    end if;
    -- Теги — своё право «Тег» (`clients.tags`), отдельно от «Метки».
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.tags', input_row.team_id) is distinct from 'write' then
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

  -- Сотрудник ставит новому клиенту только теги его команды.
  if active_role <> 'owner' and exists (
    select 1
      from unnest(normalized_tag_ids) supplied(tag_id)
      join public.client_tags tag
        on tag.tenant_id = active_tenant_id
       and tag.id = supplied.tag_id
     where tag.team_id is not null
       and tag.team_id is distinct from input_row.team_id
  ) then
    raise exception 'client tag belongs to another team'
      using errcode = '23503', hint = 'client:tag_other_team';
  end if;

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

  -- Место тега — его номер в наборе с нуля: первый выбранный — главный.
  insert into public.client_tag_assignments (
    tenant_id,
    client_id,
    tag_id,
    position
  )
  select active_tenant_id, saved_row.id, supplied.tag_id, (supplied.ord - 1)::integer
    from unnest(normalized_tag_ids) with ordinality supplied(tag_id, ord);

  -- Теги — внутрь маски: закрытые «Метка и тег» сотруднику не вернутся.
  return public.client_seen_by_caller(
    to_jsonb(saved_row) || jsonb_build_object('tag_ids', to_jsonb(normalized_tag_ids))
  );
end;
$function$;

revoke all on function public.create_client_with_tags(uuid, uuid, jsonb, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.create_client_with_tags(uuid, uuid, jsonb, uuid[]) to authenticated;

-- ─── Правка клиента: набор заменяется целиком, с местами ───────────────────

CREATE OR REPLACE FUNCTION public.update_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_patch jsonb, p_tag_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Сотрудник с «Только видит» у базы правит блоки карточки, где у него
  -- «Меняет», поэтому вход — по «Видит», а поля — ниже, по блокам.
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
  -- Сотрудник правит только клиента, которого видит: по «Видит», а не по
  -- «Меняет» базы — «Меняет» у базы нет.
  if active_role <> 'owner'
     and (p_client_id = any(public.access_client_ids_in(public.access_calendars('clients', 'read')))) is not true then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;

  next_row := jsonb_populate_record(current_row, p_patch);

  if active_role <> 'owner' then
    -- Корзина и деньги клиента — дело владельца. Реквизиты — свой блок
    -- карточки (ниже). Удаляет партнёр с «Удаление клиента: Может» своей
    -- дверью (`member_trash_client`); чёрный список — «Меню клиента» (ниже).
    if p_patch ?| array['deleted_at', 'balance', 'discount',
                        'favorite_master_id'] then
      raise exception 'only the owner archives a client, changes its money or company-wide marks'
        using errcode = '42501', hint = 'block:clients';
    end if;
    -- БЛОКИ КАРТОЧКИ: каждое поле — под своим блоком; «Меняет» блока — по
    -- командам, через которые клиент виден (`access_client_blocks`). Связи —
    -- блок «Люди»: он же их и показывает, маска контактов тут ни при чём.
    card_blocks := coalesce((
      select b.blocks
        from public.access_client_blocks() b
       where b.client_id = p_client_id
    ), '{}'::jsonb);
    -- БЛОК «КЛИЕНТ»: имя, номера и мессенджеры, фото — по его
    -- «Меняет». Напоминание и чёрный список — «Меню клиента» (ниже). Судим по значению, а не по ключу: карточка, которая
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
    -- Номера приходят целиком тому, кто видит блок «Клиент»: видит клиента —
    -- видит номер и звонит. Поэтому отдельной двери перед правкой номера нет:
    -- менять номер может тот, у кого блок «Клиент» с «Меняет», а он номер
    -- уже видит.
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
        ('clients.menu', array['reminder_at', 'pinned_at', 'blacklisted'])
      ) as g(block_key, fields)
     where p_patch ?| g.fields
       and coalesce(card_blocks ->> g.block_key, 'off') <> 'write'
     limit 1;
    -- Теги — своё право «Тег» (`clients.tags`); «Метка» — город.
    if denied_block is null
       and p_tag_ids is not null
       and coalesce(card_blocks ->> 'clients.tags', 'off') <> 'write' then
      denied_block := 'clients.tags';
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
    -- Сотрудник ставит только теги команды клиента. Тег другой
    -- команды, который уже стоит на клиенте (ставил владелец), остаётся.
    if active_role <> 'owner' and exists (
      select 1
        from unnest(result_tag_ids) supplied(tag_id)
        join public.client_tags tag
          on tag.tenant_id = active_tenant_id
         and tag.id = supplied.tag_id
       where tag.team_id is not null
         and tag.team_id is distinct from current_row.team_id
         and not exists (
           select 1
             from public.client_tag_assignments assignment
            where assignment.tenant_id = active_tenant_id
              and assignment.client_id = p_client_id
              and assignment.tag_id = supplied.tag_id
         )
    ) then
      raise exception 'client tag belongs to another team'
        using errcode = '23503', hint = 'client:tag_other_team';
    end if;
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

    -- Место тега — его номер в наборе с нуля: читатели сортируют по нему, и
    -- первый выбранный тег остаётся главным.
    insert into public.client_tag_assignments (
      tenant_id,
      client_id,
      tag_id,
      position
    )
    select active_tenant_id, p_client_id, supplied.tag_id, (supplied.ord - 1)::integer
      from unnest(result_tag_ids) with ordinality supplied(tag_id, ord);
  else
    -- Без новых тегов ответ несёт сохранённый порядок; id разводит только
    -- равные места.
    select coalesce(
             array_agg(assignment.tag_id order by assignment.position, assignment.tag_id),
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

revoke all on function public.update_client_with_tags(uuid, uuid, jsonb, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.update_client_with_tags(uuid, uuid, jsonb, uuid[]) to authenticated;

-- ─── Списки клиентов отдают теги по местам ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_member_clients(p_client_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                 select jsonb_agg(ta.tag_id order by ta.position, ta.tag_id)
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

  -- Контактов в списке нет НИКОГДА (номер — дверью), закрытые блоки — пустые.
  return query
    with card_blocks as (
      select * from public.access_client_blocks()
    )
    select public.client_masked_for_member(
             to_jsonb(c) || jsonb_build_object(
               'tag_ids',
               coalesce((
                 select jsonb_agg(ta.tag_id order by ta.position, ta.tag_id)
                   from public.client_tag_assignments ta
                  where ta.tenant_id = c.tenant_id
                    and ta.client_id = c.id
               ), '[]'::jsonb)
             ),
             cb.blocks
           ) || jsonb_build_object(
             'contacts_hidden',
             case
               when c.id = any(open_ids) then null
               when c.id = any(day_ids) then 'day'
               else 'right'
             end
           )
      from public.clients c
      left join card_blocks cb on cb.client_id = c.id
     where c.tenant_id = active_tenant
       and c.deleted_at is null
       and (p_client_id is null or c.id = p_client_id)
       and c.id = any(visible)
     order by c.full_name, c.id;
end;
$function$;

revoke all on function public.list_member_clients(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_member_clients(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.list_client_members(p_group_id uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
  caller_role text := public.current_user_role();
  visible uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or active_tenant is null or caller_role is null
     or p_group_id is null then
    return;
  end if;

  if caller_role <> 'owner' then
    visible := public.access_client_ids();
    if not (p_group_id = any(visible)) then
      return;
    end if;
    if coalesce((
      select b.blocks ->> 'clients.people'
        from public.access_client_blocks() b
       where b.client_id = p_group_id
    ), 'off') = 'off' then
      return;
    end if;
  end if;

  return query
    with card_blocks as (
      select * from public.access_client_blocks()
    )
    select case
             when caller_role = 'owner' then r.row_json
             else public.client_masked_for_member(r.row_json, cb.blocks)
           end
      from (
        select c.id,
               c.full_name,
               to_jsonb(c) || jsonb_build_object(
                 'tag_ids',
                 coalesce((
                   select jsonb_agg(ta.tag_id order by ta.position, ta.tag_id)
                     from public.client_tag_assignments ta
                    where ta.tenant_id = c.tenant_id
                      and ta.client_id = c.id
                 ), '[]'::jsonb)
               ) as row_json
          from public.clients c
         where c.tenant_id = active_tenant
           and c.deleted_at is null
           and c.memberships @> jsonb_build_array(
                 jsonb_build_object('group_id', p_group_id::text))
           and (caller_role = 'owner' or c.id = any(visible))
      ) r
      left join card_blocks cb on cb.client_id = r.id
     order by r.full_name, r.id;
end;
$function$;

-- Дверь людей карточки — как была: только зашедшему, по указателю связей.
revoke all on function public.list_client_members(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_client_members(uuid) to authenticated;
create index if not exists clients_memberships_gin on public.clients using gin (memberships jsonb_path_ops);

-- ─── Сторож наката ──────────────────────────────────────────────────────────
-- Накат останавливается, если колонки нет, у клиента совпали места после
-- переноса, тело функции осталось со старым порядком или права разошлись.

do $guard$
declare
  fn regprocedure;
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'client_tag_assignments'
       and column_name = 'position'
       and is_nullable = 'NO'
  ) then
    raise exception 'client_tag_assignments.position is missing';
  end if;

  if exists (
    select 1
      from public.client_tag_assignments
     group by client_id
    having count(distinct position) <> count(*)
  ) then
    raise exception 'client tag places collide after the backfill';
  end if;

  foreach fn in array array[
    'public.normalize_client_tag_ids(uuid, uuid[])',
    'public.create_client_with_tags(uuid, uuid, jsonb, uuid[])',
    'public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'
  ]::regprocedure[] loop
    if (select p.prosrc not like '%with ordinality%' from pg_proc p where p.oid = fn) then
      raise exception '% does not keep the supplied tag order', fn;
    end if;
  end loop;

  foreach fn in array array[
    'public.list_member_clients(uuid)',
    'public.list_client_members(uuid)'
  ]::regprocedure[] loop
    if (select p.prosrc like '%order by ta.tag_id)%' from pg_proc p where p.oid = fn) then
      raise exception '% still orders tags by id', fn;
    end if;
  end loop;

  foreach fn in array array[
    'public.normalize_client_tag_ids(uuid, uuid[])',
    'public.create_client_with_tags(uuid, uuid, jsonb, uuid[])',
    'public.update_client_with_tags(uuid, uuid, jsonb, uuid[])',
    'public.list_member_clients(uuid)',
    'public.list_client_members(uuid)'
  ]::regprocedure[] loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception '% is executable by anon', fn;
    end if;
    if (fn = 'public.normalize_client_tag_ids(uuid, uuid[])'::regprocedure)
       = has_function_privilege('authenticated', fn, 'execute') then
      raise exception '% has the wrong grant for authenticated', fn;
    end if;
  end loop;
end
$guard$;
