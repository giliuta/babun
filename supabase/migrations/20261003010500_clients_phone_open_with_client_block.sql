-- НОМЕР — СРАЗУ, БЕЗ ТОЧЕК И ДВЕРИ (владелец 03.10).
--
-- «Или он полностью видит клиента с номером телефона и трубкой „позвонить" —
-- если он видит этого клиента, значит, может связаться, — либо клиент у него
-- вообще не показывается. Точки не надо проставлять».
--
-- • Блок «Клиент» с «Видит» (`clients.client` read/write) — номер, номера и
--   мессенджеры приходят целиком: в списке, на карточке, в выборе клиента
--   записи и в ответах правки (`client_masked_for_member` →
--   `client_seen_by_caller`). «Скрыт» — без контактов, как раньше.
-- • Выбор клиента мастера (`list_master_clients_safe`) — номер у тех же
--   клиентов.
-- • `update_client_with_tags`: снята проверка «сначала открой номер дверью»
--   (`access:contacts_closed`) — номер больше не приходит пустым.
-- • Дверь `member_client_contacts` остаётся для старых сборок; новая её не
--   зовёт: номер уже в строке.
--
-- Тела сняты с боевой базы 03.10: `client_masked_for_member` (6affede0…),
-- `list_master_clients_safe` (3e34801d…), `update_client_with_tags`
-- (e8d3361b… = `20261003004100`); изменены только помеченные места,
-- умолчания параметров сохранены. `create or replace` права исполнения не
-- трогает.

create or replace function public.client_masked_for_member(p_client jsonb, p_blocks jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  with b as (
    select coalesce(p_blocks, '{}'::jsonb) as v
  )
  -- 03.10: блок «Клиент» с «Видит» — номер и мессенджеры целиком; «Скрыт» —
  -- без контактов (точек и двери больше нет).
  select case
           when coalesce(b.v ->> 'clients.client', 'off') = 'off'
             then public.client_without_contacts(p_client)
           else p_client
         end
    || case when coalesce(b.v ->> 'clients.note', 'off') = 'off'
         then jsonb_build_object('comment', '', 'notes', '[]'::jsonb) else '{}'::jsonb end
    -- Связи — блок «Люди»: закрыт — связей нет, открыт — связи строки.
    || case when coalesce(b.v ->> 'clients.people', 'off') = 'off'
         then jsonb_build_object('memberships', '[]'::jsonb)
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

create or replace function public.list_master_clients_safe(p_client_id uuid default null::uuid)
 returns setof jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with client_teams as (
    select public.access_calendars('record.client', 'read') as ids
  ),
  contact_sets as (
    select public.access_contact_client_ids() || public.access_day_contact_client_ids() as open_ids,
           public.access_client_ids_in(public.access_day_contact_teams()) as day_ids,
           public.access_client_ids() as visible_ids,
           public.tenant_business_date(public.current_tenant_id()) as today
  )
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'full_name', c.full_name,
    -- 03.10: номер открыт сразу, когда блок «Клиент» он видит; иначе пусто.
    'phone', case when c.id = any(cs.open_ids) then c.phone else '' end,
    'created_at', c.created_at,
    'contacts_hidden', case
      when c.id = any(cs.open_ids) then null
      when c.id = any(cs.day_ids) then 'day'
      else 'right'
    end
  )
    from public.clients c
   cross join client_teams ct
   cross join contact_sets cs
   where public.current_user_role() = 'master'
     and c.tenant_id = public.current_tenant_id()
     and c.deleted_at is null
     and (p_client_id is null or c.id = p_client_id)
     and public.current_user_can_access_client(c.id)
     -- Клиент записи, которую он видит (02.10: «Карточка из записи» убрано —
     -- из видимой записи карточка открывается всегда).
     and exists (
       select 1
         from public.appointments a
        where a.tenant_id = c.tenant_id
          and a.client_id = c.id
          and a.kind = 'work'
          and a.team_id = any(ct.ids)
     )
     -- «Около записи» (защита базы 30.09): имя клиента мастер видит, пока
     -- клиент в окне записи этой команды, либо если клиент открыт ему правом
     -- «Клиенты» (набор `access_client_ids`), либо он завёл его сам.
     and (
       c.id = any(cs.visible_ids)
       or c.created_by = auth.uid()
       or exists (
         select 1
           from public.appointments a
          where a.tenant_id = c.tenant_id
            and a.client_id = c.id
            and a.kind = 'work'
            and a.team_id = any(ct.ids)
            and a.status is distinct from 'cancelled'
            and a.date between (cs.today - 7)::text and (cs.today + 1)::text
       )
     )
   order by c.full_name, c.id
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
    -- Корзина и деньги клиента — дело владельца. Реквизиты с 30.09 — свой
    -- блок карточки (ниже). Удаляет партнёр с «Удаление клиента: Может» своей
    -- дверью (`member_trash_client`); чёрный список с 03.10 — «Меню клиента»
    -- (ниже).
    if p_patch ?| array['deleted_at', 'balance', 'discount',
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
    -- 03.10: номера больше не приходят пустыми — блок «Клиент» с «Видит»
    -- отдаёт их целиком (владелец: «видит клиента — видит номер и звонит»).
    -- Проверка «сначала открой номер дверью» снята: менять номер может тот,
    -- у кого блок «Клиент» с «Меняет», а он номер уже видит.
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
