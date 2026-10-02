-- «БАЗА КЛИЕНТОВ» — ТРИ СТУПЕНИ; «ОТКРЫВАЕТ КАРТОЧКУ» И «ТЕЛЕФОН» УБРАНЫ
-- (владелец 02.10, вслед за `20261002233700_clients_base_read_window`).
--
-- «Если он видит клиента — значит, карточку в любом случае может открывать…
-- блок „Открывает карточку" мы убираем». «То же самое — телефон, по сути он
-- может открывать. База клиентов: первое — он вообще не видит; второе — видит,
-- может переходить, видит номер телефона, но с ограничением по времени, как мы
-- говорили; третий вариант — может редактировать: удалять клиентов, менять и
-- так далее».
--
-- 1. «Открывает карточку» (`clients.open`) убрано: страницу открывает каждый,
--    кому клиент виден. `access_client_blocks` его не спрашивает и ключа в
--    `blocks` не кладёт — приложение без ключа открывает страницу.
-- 2. «Телефон» (`clients.contacts`) убрано: номер открыт у каждого клиента,
--    которого партнёр видит (`access_contact_client_ids` = его набор). Дверь
--    номера прежняя — по одному, с журналом и пределом в сутки
--    (`member_client_contacts`); ограничение по времени — окно «Какие
--    клиенты» (2 недели / месяц / своей команды).
-- 3. «База клиентов» (`clients`) снова «Скрыта · Только видит · Редактирует».
--    «Редактирует» — заводит клиентов, правит имя, номера, мессенджеры,
--    команду и убирает клиента из базы (новая `member_trash_client`: без
--    записей — в корзину на 30 дней, с записями — в архив, потому что
--    клиента с историей база не сотрёт и он застрял бы в корзине; вернуть
--    и стереть насовсем может по-прежнему владелец). Номера правятся
--    только открытыми дверью — пустые номера маски поверх настоящих не лягут.
--    Блоки карточки правятся своими правами, как с 02.10.
--
-- Тела функций сняты с боевой базы 02.10 и изменены только в помеченных
-- местах: `access_client_blocks` (da0b5272…), `update_client_with_tags`
-- (0e688777…; умолчание `p_tag_ids` сохранено), `access_contact_client_ids`
-- (e28e259a…). `create or replace` права исполнения не трогает.

-- ─── 1. «Открывает карточку» ─────────────────────────────────────────────────

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
      -- База — своим ключом: «Редактирует» (write) правит имя и номера.
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

delete from public.member_access
 where block = 'clients.open';

delete from public.access_blocks
 where key = 'clients.open';

-- ─── 2. «Телефон» ────────────────────────────────────────────────────────────

create or replace function public.access_contact_client_ids()
 returns uuid[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- 02.10: номер открыт у каждого клиента, которого он видит.
  select case
    when public.current_user_role() is distinct from 'owner'
      then public.access_client_ids_in(public.access_calendars('clients', 'read'))
    else array[]::uuid[]
  end
$function$;

delete from public.member_access
 where block = 'clients.contacts';

delete from public.access_blocks
 where key = 'clients.contacts';

-- ─── 3. «База клиентов»: «Редактирует» ───────────────────────────────────────

update public.access_blocks
   set levels = array['off', 'read', 'write']
 where key = 'clients';

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
    -- БАЗА — ПО «РЕДАКТИРУЕТ» (02.10): имя, номера и мессенджеры, имя для
    -- SMS, фото, напоминание. Судим по значению, а не по ключу: карточка,
    -- которая пронесла то же имя рядом с заметкой, ничего в базе не меняет.
    if coalesce(card_blocks ->> 'clients', 'off') <> 'write'
       and exists (
         select 1
           from unnest(array['full_name', 'phone', 'whatsapp_phone', 'email', 'sms_name',
                             'telegram_username', 'instagram_username', 'phones',
                             'phone_e164', 'avatar_url', 'reminder_at']) as f(field)
          where (to_jsonb(next_row) -> f.field) is distinct from (to_jsonb(current_row) -> f.field)
       ) then
      raise exception 'only the owner or an employee who edits the client base changes it'
        using errcode = '42501', hint = 'block:clients';
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

-- Партнёр с «Редактирует» убирает клиента из базы. Без записей — в корзину:
-- через 30 дней сервер его сотрёт (`TRASH_DAYS` приложения). С записями — в
-- архив: за ним история и деньги, стереть его база не даст
-- (`guard_client_hard_delete_history`), и в корзине он завис бы навсегда.
-- Вернуть из корзины и архива может владелец.
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
    select b.blocks ->> 'clients' into base_level
      from public.access_client_blocks() b
     where b.client_id = p_client_id;
    if base_level is distinct from 'write' then
      raise exception 'only the owner or an employee who edits the client base deletes a client'
        using errcode = '42501', hint = 'block:clients';
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

revoke all on function public.member_trash_client(uuid) from public, anon;
grant execute on function public.member_trash_client(uuid) to authenticated;
