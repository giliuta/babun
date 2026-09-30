-- ЗАЩИТА БАЗЫ КЛИЕНТОВ, ПУНКТ 3: ПРАВО НА КАЖДЫЙ БЛОК КАРТОЧКИ КЛИЕНТА.
--
-- Владелец 30.09: «делаем полностью максимум по правам — страницу клиентов по
-- правам». Как «Запись клиента» в «Календаре»: у каждого блока карточки своё
-- право в каждой команде — Скрыт · Только видит · Видит и меняет.
--
--   clients.note       «Заметка»        comment, notes
--   clients.people     «Люди»           memberships, list_client_members
--   clients.objects    «Объекты»        locations, equipment, address, property_type
--   clients.labels     «Метка и тег»    city, city_manual, теги
--   clients.personal   «Личное»         birthday, language, acquisition_source,
--                                       referred_by_client_id, first_contact_date
--   clients.files      «Файлы»          client_attachments и хранилище
--   clients.requisites «Реквизиты»      legal_name, vat_number, reg_number,
--                                       billing_address, requisites
--   clients.history    «История записей» (Скрыта · Видит) — экран
--   clients.money      «Долг и деньги»  (Скрыты · Видит) — balance, discount
--
-- Умолчание — «Скрыт»: новый человек видит у клиента только имя, пока
-- владелец не откроет блок (как у блоков записи). Клиентов сейчас не открыто
-- ни одному сотруднику — никто молча не теряет видимого.
--
-- «Видит и меняет» у блока работает, только если в той же команде у
-- «Карточек клиентов» тоже «Видит и меняет»: блок правится внутри карточки.
--
-- ОДИН ОТВЕТ НА «ЧТО ОТКРЫТО У ЭТОГО КЛИЕНТА» — `access_client_blocks()`:
-- по каждой команде, где клиенты открыты, — её набор клиентов («Какие
-- клиенты») и её положения блоков; у клиента, видного через несколько команд,
-- берётся самое широкое. Строка сотрудника несёт это полем `blocks`, поля
-- закрытых блоков приходят пустыми; правка и создание судят по тем же
-- положениям; файлы — те же положения через `access_block_client_ids`.
--
-- Тела сняты с базы 30.09 перед правкой: list_member_clients 56cad4a4…,
-- client_seen_by_caller 32ea30a5…, member_client_contacts 308ff098…,
-- update_client_with_tags 382fbe68… (все — 20260930233000), list_client_members
-- 624daaa6…, create_client_with_tags bc5ddf06….

-- ─── Реестр ─────────────────────────────────────────────────────────────────

update public.access_blocks
   set scope = 'calendar', live = true, levels = array['off', 'read', 'write'],
       title_ru = 'Файлы', position = 237,
       enforced_by = array[
         'function:public.access_client_blocks()',
         'policy:public.client_attachments.client_attachments_select_block',
         'policy:storage.objects.storage_client_attachments_select_block'
       ]
 where key = 'clients.files';

update public.access_blocks
   set scope = 'calendar', live = true, levels = array['off', 'read'],
       title_ru = 'История записей', position = 239,
       enforced_by = array['function:public.access_client_blocks()']
 where key = 'clients.history';

update public.access_blocks
   set scope = 'calendar', live = true, levels = array['off', 'read'],
       title_ru = 'Долг и деньги', position = 241,
       enforced_by = array[
         'function:public.access_client_blocks()',
         'function:public.client_masked_for_member(jsonb, jsonb)'
       ]
 where key = 'clients.money';

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, position, enforced_by)
values
  ('clients.note', 'clients', 'calendar', array['off', 'read', 'write'], 'Заметка', false, true, 231,
   array['function:public.client_masked_for_member(jsonb, jsonb)', 'function:public.update_client_with_tags(uuid, uuid, jsonb, uuid[])']),
  ('clients.people', 'clients', 'calendar', array['off', 'read', 'write'], 'Люди', false, true, 232,
   array['function:public.client_masked_for_member(jsonb, jsonb)', 'function:public.list_client_members(uuid)', 'function:public.update_client_with_tags(uuid, uuid, jsonb, uuid[])']),
  ('clients.objects', 'clients', 'calendar', array['off', 'read', 'write'], 'Объекты', false, true, 233,
   array['function:public.client_masked_for_member(jsonb, jsonb)', 'function:public.update_client_with_tags(uuid, uuid, jsonb, uuid[])']),
  ('clients.labels', 'clients', 'calendar', array['off', 'read', 'write'], 'Метка и тег', false, true, 234,
   array['function:public.client_masked_for_member(jsonb, jsonb)', 'function:public.update_client_with_tags(uuid, uuid, jsonb, uuid[])']),
  ('clients.personal', 'clients', 'calendar', array['off', 'read', 'write'], 'Личное', false, true, 236,
   array['function:public.client_masked_for_member(jsonb, jsonb)', 'function:public.update_client_with_tags(uuid, uuid, jsonb, uuid[])']),
  ('clients.requisites', 'clients', 'calendar', array['off', 'read', 'write'], 'Реквизиты', false, true, 238,
   array['function:public.client_masked_for_member(jsonb, jsonb)', 'function:public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'])
on conflict (key) do update
  set area = excluded.area, scope = excluded.scope, levels = excluded.levels,
      title_ru = excluded.title_ru, owner_only = excluded.owner_only,
      live = excluded.live, position = excluded.position,
      enforced_by = excluded.enforced_by;

-- ─── Что открыто у каждого клиента ──────────────────────────────────────────

-- Положения блоков карточки для каждого клиента, видного сотруднику. Ключ
-- «clients» — сама карточка (read/write). У владельца — пусто: ему открыто всё.
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
      -- Карточка — своим ключом; блок «Меняет» — только при «Меняет» карточки.
      select tm.team_id, 'clients'::text as block_key,
             case when tm.card_level = 'write' then 2 else 1 end as rank
        from teams tm
      union all
      select tm.team_id, k.block_key,
             case
               when l.level = 'write' and tm.card_level = 'write' then 2
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

-- Клиенты, у которых блок открыт не ниже `p_min`. Для политик файлов: в
-- политике звать как `in (select unnest(…))` — один раз на запрос.
create or replace function public.access_block_client_ids(p_block text, p_min text)
 returns uuid[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(array_agg(b.client_id), array[]::uuid[])
    from public.access_client_blocks() b
   where case
           when p_min = 'write' then b.blocks ->> p_block = 'write'
           else b.blocks ->> p_block in ('read', 'write')
         end
$function$;

-- Строка клиента глазами сотрудника: контактов нет никогда (номер — дверью),
-- поля закрытых блоков пустые, `blocks` — что открыто. Нет положений — всё
-- закрыто, кроме имени.
create or replace function public.client_masked_for_member(p_client jsonb, p_blocks jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  with b as (
    select coalesce(p_blocks, '{}'::jsonb) as v
  )
  select public.client_without_contacts(p_client)
    || case when coalesce(b.v ->> 'clients.note', 'off') = 'off'
         then jsonb_build_object('comment', '', 'notes', '[]'::jsonb) else '{}'::jsonb end
    -- Связи гасит маска контактов; открытые «Люди» возвращают их.
    || case when coalesce(b.v ->> 'clients.people', 'off') = 'off'
         then '{}'::jsonb
         else jsonb_build_object('memberships', coalesce(p_client -> 'memberships', '[]'::jsonb)) end
    || case when coalesce(b.v ->> 'clients.objects', 'off') = 'off'
         then jsonb_build_object('locations', '[]'::jsonb, 'equipment', '[]'::jsonb,
                                 'address', '', 'property_type', '')
         else '{}'::jsonb end
    || case when coalesce(b.v ->> 'clients.labels', 'off') = 'off'
         then jsonb_build_object('city', '', 'city_manual', false, 'tag_ids', '[]'::jsonb)
         else '{}'::jsonb end
    || case when coalesce(b.v ->> 'clients.personal', 'off') = 'off'
         then jsonb_build_object('birthday', '', 'language', null, 'acquisition_source', 'unknown',
                                 'referred_by_client_id', null, 'first_contact_date', null)
         else '{}'::jsonb end
    || case when coalesce(b.v ->> 'clients.requisites', 'off') = 'off'
         then jsonb_build_object('legal_name', null, 'vat_number', null, 'reg_number', null,
                                 'billing_address', null, 'requisites', '[]'::jsonb)
         else '{}'::jsonb end
    || case when coalesce(b.v ->> 'clients.money', 'off') = 'off'
         then jsonb_build_object('balance', 0, 'discount', 0)
         else '{}'::jsonb end
    || jsonb_build_object('blocks', b.v)
  from b
$function$;

-- ─── Чтение ─────────────────────────────────────────────────────────────────

create or replace function public.client_seen_by_caller(p_client jsonb)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when public.current_user_role() = 'owner' then p_client
    else public.client_masked_for_member(
      p_client,
      (select b.blocks from public.access_client_blocks() b
        where b.client_id = (p_client ->> 'id')::uuid)
    )
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

  -- Контактов в списке нет НИКОГДА (номер — дверью), закрытые блоки — пустые.
  return query
    with card_blocks as (
      select * from public.access_client_blocks()
    )
    select public.client_masked_for_member(
             to_jsonb(c) || jsonb_build_object(
               'tag_ids',
               coalesce((
                 select jsonb_agg(ta.tag_id order by ta.tag_id)
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

-- Люди карточки: у сотрудника — только при открытых «Людях» у карточки-группы
-- и только те, кто сам виден; строки — той же маской.
create or replace function public.list_client_members(p_group_id uuid)
 returns setof jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
                   select jsonb_agg(ta.tag_id order by ta.tag_id)
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

-- ─── Дверь номера: связи — по «Людям» ───────────────────────────────────────

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
  -- Связи — блок «Люди» (30.09): закрыт — связей нет и в открытом номере.
  return jsonb_build_object('status', 'open') || public.client_contacts_of(to_jsonb(row_client))
    || case
         when coalesce((
           select b.blocks ->> 'clients.people'
             from public.access_client_blocks() b
            where b.client_id = p_client
         ), 'off') = 'off'
           then jsonb_build_object('memberships', '[]'::jsonb)
         else '{}'::jsonb
       end;
end;
$function$;

-- ─── Правка и создание: каждое поле — под своим блоком ──────────────────────

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
  card_blocks jsonb;
  denied_block text;
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
    -- Корзина, деньги клиента и общие пометки — дело владельца. Реквизиты
    -- с 30.09 — свой блок карточки (ниже).
    if p_patch ?| array['deleted_at', 'balance', 'discount', 'blacklisted',
                        'pinned_at', 'favorite_master_id'] then
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
    --
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
    if p_patch ?| array['phone', 'whatsapp_phone', 'email', 'telegram_username',
                        'instagram_username', 'phones', 'phone_e164'] then
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

  -- Теги — внутрь маски: закрытые «Метка и тег» сотруднику не вернутся.
  return public.client_seen_by_caller(
    to_jsonb(saved_row) || jsonb_build_object('tag_ids', to_jsonb(result_tag_ids))
  );
end;
$function$;

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
  labels_open boolean := true;
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

-- ─── Файлы клиента по праву блока ───────────────────────────────────────────

-- Прежние правила владельца и диспетчера не трогаются; сотрудник получает
-- файлы отдельными разрешающими правилами по «Файлам» карточки. Набор
-- клиентов считается один раз на запрос (`in (select unnest(…))`).
drop policy if exists client_attachments_select_block on public.client_attachments;
create policy client_attachments_select_block
  on public.client_attachments
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and client_id in (select unnest(public.access_block_client_ids('clients.files', 'read')))
  );

drop policy if exists client_attachments_insert_block on public.client_attachments;
create policy client_attachments_insert_block
  on public.client_attachments
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and client_id in (select unnest(public.access_block_client_ids('clients.files', 'write')))
    and (created_by is null or created_by = auth.uid())
  );

drop policy if exists client_attachments_update_block on public.client_attachments;
create policy client_attachments_update_block
  on public.client_attachments
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and client_id in (select unnest(public.access_block_client_ids('clients.files', 'write')))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and client_id in (select unnest(public.access_block_client_ids('clients.files', 'write')))
  );

drop policy if exists client_attachments_delete_block on public.client_attachments;
create policy client_attachments_delete_block
  on public.client_attachments
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and client_id in (select unnest(public.access_block_client_ids('clients.files', 'write')))
  );

drop policy if exists storage_client_attachments_select_block on storage.objects;
create policy storage_client_attachments_select_block
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'client-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and public.try_uuid((storage.foldername(name))[2])
        in (select unnest(public.access_block_client_ids('clients.files', 'read')))
  );

drop policy if exists storage_client_attachments_insert_block on storage.objects;
create policy storage_client_attachments_insert_block
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'client-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and public.try_uuid((storage.foldername(name))[2])
        in (select unnest(public.access_block_client_ids('clients.files', 'write')))
  );

drop policy if exists storage_client_attachments_update_block on storage.objects;
create policy storage_client_attachments_update_block
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'client-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and public.try_uuid((storage.foldername(name))[2])
        in (select unnest(public.access_block_client_ids('clients.files', 'write')))
  )
  with check (
    bucket_id = 'client-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and public.try_uuid((storage.foldername(name))[2])
        in (select unnest(public.access_block_client_ids('clients.files', 'write')))
  );

drop policy if exists storage_client_attachments_delete_block on storage.objects;
create policy storage_client_attachments_delete_block
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'client-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and public.try_uuid((storage.foldername(name))[2])
        in (select unnest(public.access_block_client_ids('clients.files', 'write')))
  );

-- ─── Доступ к функциям ──────────────────────────────────────────────────────

-- Помощники — только изнутри definer-функций; набор для политик файлов зовёт
-- сам сотрудник (правило считается от его лица).
revoke all on function public.access_client_blocks() from public, anon, authenticated;
-- Дверь людей карточки — как была: только зашедшему, по указателю связей.
revoke all on function public.list_client_members(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_client_members(uuid) to authenticated;
create index if not exists clients_memberships_gin on public.clients using gin (memberships jsonb_path_ops);
revoke all on function public.client_masked_for_member(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.access_block_client_ids(text, text) from public, anon;
grant execute on function public.access_block_client_ids(text, text) to authenticated;
