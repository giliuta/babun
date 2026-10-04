-- «КАРТОЧКА КЛИЕНТА» — ПО БЛОКАМ СТРАНИЦЫ: «КЛИЕНТ», «ИСТОРИЯ», «SMS»
-- (владелец 02.10, поздно вечером).
--
-- «Давай теперь карточку клиентов делаем… первая по блокам — клиент, люди,
-- заметка… важно ещё, чтоб это было, допустим, история клиента — всё точно
-- так же, как блоки, и в конце SMS… чётко дай доступ по блокам: не видит,
-- видит и может редактировать». Про первый блок — выбор владельца: «Скрыт /
-- Видит / Меняет».
--
-- Новые права карточки (на команду, как остальные блоки):
--   • «Клиент» (`clients.client`) — Скрыт: видно только имя, номера и
--     мессенджеров нет (дверь номера закрыта); Видит: номер открывается
--     дверью по одному; Меняет: правит имя, номера, мессенджеры, фото и
--     напоминание (номера — открыв их). «База клиентов: Редактирует» теперь
--     — завести и удалить клиента; имя и номер — этот блок.
--   • «История» (`clients.history`, снова своим правом) — Скрыта / Видит.
--   • «SMS» (`clients.sms`) — Скрыты / Видит (история SMS клиента) /
--     Меняет (отправляет SMS с карточки, «Присылать SMS», «Имя для SMS»).
--     SMS из записи держит своё право календаря — здесь не трогается.
--
-- Кто уже работает, ничего не теряет: партнёру с открытой базой в команде
-- ставятся «Клиент» (Меняет — если база «Редактирует», иначе Видит),
-- «История: Видит» и «SMS: Видит» — ровно то, что он видел до сих пор.
-- Новому партнёру умолчание — «Скрыт», как у остальных блоков карточки.
--
-- Тела сняты с боевой базы 02.10 и изменены только в помеченных местах:
-- `access_client_blocks` (bbabb9e8…), `access_contact_client_ids` (f927800a…),
-- `update_client_with_tags` (66ec7926…; умолчание `p_tag_ids` сохранено),
-- `sms_for_client` (195a5595…; умолчание `p_limit` сохранено),
-- `sms_send_manual` (a5189ffd…; умолчания сохранены),
-- `set_client_sms_opt_out` (aa7362ff…). `create or replace` права исполнения
-- не трогает.

-- ─── 1. Реестр и строки тех, кто уже работает ────────────────────────────────

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  ('clients.client', 'clients', 'calendar', array['off', 'read', 'write'], 'Клиент', false, true,
   array['function:public.access_contact_client_ids()',
         'function:public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'], 230),
  ('clients.history', 'clients', 'calendar', array['off', 'read'], 'История', false, true,
   array['function:public.access_client_blocks()',
         'function:public.member_client_history(uuid)'], 239),
  ('clients.sms', 'clients', 'calendar', array['off', 'read', 'write'], 'SMS', false, true,
   array['function:public.sms_for_client(uuid, integer)',
         'function:public.sms_send_manual(uuid, uuid, text, text, text, text)',
         'function:public.set_client_sms_opt_out(uuid, boolean)'], 242)
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
select ma.tenant_id, ma.user_id, b.block, ma.team_id,
       case when b.block = 'clients.client' and ma.level = 'write' then 'write' else 'read' end
  from public.member_access ma
 cross join (values ('clients.client'), ('clients.history'), ('clients.sms')) as b(block)
 where ma.block = 'clients'
   and ma.team_id is not null
   and ma.level in ('read', 'write')
on conflict (tenant_id, user_id, block, team_id) do nothing;

-- ─── 2. Блоки карточки — «Клиент», «История», «SMS» своими правами ─────────

create or replace function public.access_client_blocks()
 returns table(client_id uuid, blocks jsonb)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid := public.current_tenant_id();
  -- 02.10: «Клиент», «История» и «SMS» — свои права, как остальные блоки.
  block_keys constant text[] := array[
    'clients.client', 'clients.note', 'clients.people', 'clients.history',
    'clients.objects', 'clients.files', 'clients.requisites', 'clients.labels',
    'clients.personal', 'clients.money', 'clients.sms'
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
      -- База — своим ключом: «Редактирует» (write) заводит и удаляет клиентов.
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

-- Номер — по блоку «Клиент» (02.10): «Скрыт» — номера нет.
create or replace function public.access_contact_client_ids()
 returns uuid[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- 02.10: номер открыт у клиента, чей блок «Клиент» он видит.
  select case
    when public.current_user_role() is distinct from 'owner'
      then public.access_block_client_ids('clients.client', 'read')
    else array[]::uuid[]
  end
$function$;

-- ─── 3. Правка клиента: имя и номера — блок «Клиент», имя для SMS — «SMS» ───

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
    -- с 30.09 — свой блок карточки (ниже). В корзину партнёр с
    -- «Редактирует» кладёт клиента своей дверью (`member_trash_client`).
    if p_patch ?| array['deleted_at', 'balance', 'discount', 'blacklisted',
                        'pinned_at', 'favorite_master_id'] then
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
    -- БЛОК «КЛИЕНТ» (02.10): имя, номера и мессенджеры, фото, напоминание —
    -- по его «Меняет». Судим по значению, а не по ключу: карточка, которая
    -- пронесла то же имя рядом с заметкой, ничего в блоке не меняет. Имя для
    -- SMS — блок «SMS» (ниже).
    if coalesce(card_blocks ->> 'clients.client', 'off') <> 'write'
       and exists (
         select 1
           from unnest(array['full_name', 'phone', 'whatsapp_phone', 'email',
                             'telegram_username', 'instagram_username', 'phones',
                             'phone_e164', 'avatar_url', 'reminder_at']) as f(field)
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
        ('clients.sms', array['sms_name'])
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

-- ─── 4. SMS клиента — блок «SMS» ─────────────────────────────────────────────

create or replace function public.sms_for_client(p_client_id uuid, p_limit integer DEFAULT 50)
 returns SETOF jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- Сотрудник — только о клиенте, у которого видит блок «SMS» (02.10).
  if not is_owner and not (p_client_id = any(public.access_block_client_ids('clients.sms', 'read'))) then
    return;
  end if;
  return query
  select public.sms_message_json(m, is_owner)
    from public.sms_messages m
   where m.tenant_id = v_tenant
     and m.client_id = p_client_id
     and (is_owner or (m.team_id is not null and public.sms_can_see_team(m.team_id)))
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$function$;

create or replace function public.sms_send_manual(p_appointment_id uuid, p_client_id uuid, p_body text, p_template_id text DEFAULT NULL::text, p_team_id text DEFAULT NULL::text, p_phone text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
  a record;
  v_client uuid := p_client_id;
  v_team text := nullif(trim(coalesce(p_team_id, '')), '');
  c record;
  phone text;
  v_body text := trim(coalesce(p_body, ''));
  v_balance integer;
  v_id uuid;
  cap_member integer := coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_member_daily_cap'), 100);
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not public.sms_service_on() then
    raise exception 'sms:service_off' using errcode = 'P0001';
  end if;
  if public.sms_frozen(v_tenant) then
    raise exception 'sms:frozen' using errcode = 'P0001';
  end if;
  if length(v_body) = 0 or length(v_body) > 1000 then
    raise exception 'sms:body' using errcode = '22023';
  end if;
  if p_appointment_id is not null then
    select ap.client_id, ap.team_id into a
      from public.appointments ap
     where ap.id = p_appointment_id and ap.tenant_id = v_tenant;
    if not found or a.client_id is null then
      raise exception 'sms:appointment' using errcode = 'P0001';
    end if;
    v_client := a.client_id;
    v_team := a.team_id;
  end if;
  if v_team is null or v_client is null then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if not is_owner and not public.sms_can_see_team(v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- Клиент — только тот, кого сотрудник видит в этой команде (защита базы
  -- 30.09): иначе SMS уходило бы любому клиенту компании по его uuid.
  if not is_owner and not public.member_client_in_team(v_client, v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- С карточки клиента (без записи) — по блоку «SMS: Меняет» (02.10). SMS
  -- из записи держит своё право календаря.
  if not is_owner
     and p_appointment_id is null
     and not (v_client = any(public.access_block_client_ids('clients.sms', 'write'))) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not is_owner and (
    select count(*) from public.sms_messages
     where sent_by = auth.uid() and created_at > now() - interval '1 day'
  ) >= cap_member then
    raise exception 'sms:limit' using errcode = 'P0001';
  end if;
  if public.sms_team_sender(v_tenant, v_team) is null then
    raise exception 'sms:sender' using errcode = 'P0001';
  end if;
  select cl.phone, cl.phone_e164, cl.sms_opt_out, cl.blacklisted, cl.deleted_at
    into c
    from public.clients cl
   where cl.id = v_client and cl.tenant_id = v_tenant;
  if not found or c.deleted_at is not null then
    raise exception 'sms:client' using errcode = 'P0001';
  end if;
  if c.sms_opt_out or coalesce(c.blacklisted, false) then
    raise exception 'sms:opt_out' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_phone, '')), '') is not null then
    -- Выбрать номер может только тот, кому номер открыт (30.09): иначе дверь
    -- служила бы проверкой угаданного номера.
    if not is_owner
       and not (v_client = any(public.access_contact_client_ids())
                or v_client = any(public.access_day_contact_client_ids())) then
      raise exception 'sms:phone' using errcode = 'P0001';
    end if;
    if not public.sms_client_owns_phone(v_client, p_phone) then
      raise exception 'sms:phone' using errcode = 'P0001';
    end if;
    phone := trim(p_phone);
  else
    phone := coalesce(nullif(trim(c.phone_e164), ''), nullif(trim(c.phone), ''));
  end if;
  if phone is null then
    raise exception 'sms:phone' using errcode = 'P0001';
  end if;
  if not public.sms_phone_allowed(phone) then
    raise exception 'sms:country' using errcode = 'P0001';
  end if;
  select balance_cents into v_balance from public.tenant_sms_config where tenant_id = v_tenant;
  if coalesce(v_balance, 0) < public.sms_price_cents() then
    raise exception 'sms:funds' using errcode = 'P0001';
  end if;
  insert into public.sms_messages (
    tenant_id, appointment_id, client_id, team_id, to_phone, message_body,
    trigger_type, template_id, status, mode, sent_by
  ) values (
    v_tenant, p_appointment_id, v_client, v_team, phone, v_body,
    'manual', nullif(p_template_id, ''), 'queued', 'platform', auth.uid()
  )
  returning sms_messages.id into v_id;
  perform public.sms_wake();
  return v_id;
end;
$function$;

create or replace function public.set_client_sms_opt_out(p_client_id uuid, p_value boolean)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- 02.10: партнёру — по блоку «SMS: Меняет»; владельцу — как раньше.
  if auth.uid() is null
     or not (
       (public.current_user_role() = 'owner' and coalesce(public.current_user_can_edit_client(p_client_id), false))
       or p_client_id = any(public.access_block_client_ids('clients.sms', 'write'))
     ) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  update public.clients
     set sms_opt_out = coalesce(p_value, false)
   where id = p_client_id and tenant_id = public.current_tenant_id();
  return coalesce(p_value, false);
end;
$function$;
