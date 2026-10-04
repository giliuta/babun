-- «ГЛАВНОЕ» В «КЛИЕНТАХ»: ОТКРЫВАЕТ ЛИ ПАРТНЁР КАРТОЧКУ (владелец 01.10).
--
-- «Главное — это если я захожу в „Клиенты“: что он может видеть, что может
-- менять… может ли он переходить в это»; «отдельный заход — переход с
-- записи в клиента: разрешение добавляем или нет». Две новые строки права
-- у каждой команды:
--
--   • `clients.open` — «Открывает карточку». «Не может» — партнёр видит
--     строки списка (имя, номер, последняя запись — по своим правам), но на
--     страницу клиента не проходит: блоки, которые есть только на странице
--     (заметка, люди, объекты, личное, файлы, реквизиты, долг и деньги,
--     метка и теги — в строке их нет с 01.10),
--     сервер отдаёт пустыми (`access_client_blocks` → `client_masked_for_member`,
--     файлы — политиками по тем же блокам). Ключ `clients.open` едет в
--     `blocks` строки — по нему приложение гасит переход.
--   • `clients.from_record` — «Карточка из записи». «Не может» — у клиента
--     в записи нет двери на его страницу, и окно клиента записи
--     (`list_master_clients_safe`) не отдаёт клиента, пока у партнёра нет
--     этого права в команде, где его запись.
--
-- Новые строки по умолчанию «Не может» (первое положение — умолчание
-- `access_team_level`). Чтобы у тех, кто уже работает, ничего не пропало,
-- им ставится «Может» там, где карточку они открывали и до этого: «Открывает
-- карточку» — в командах, где «База клиентов» не скрыта; «Карточка из
-- записи» — во всех прикреплённых командах (до 01.10 дверь была у всех).

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  ('clients.open', 'clients', 'calendar', array['off', 'write'], 'Открывает карточку', false, true,
   array[
     'function:public.access_client_blocks()',
     'function:public.client_masked_for_member(jsonb, jsonb)'
   ], 212),
  ('clients.from_record', 'clients', 'calendar', array['off', 'write'], 'Карточка из записи', false, true,
   array['function:public.list_master_clients_safe(uuid)'], 213)
on conflict (key) do update
  set area = excluded.area,
      scope = excluded.scope,
      levels = excluded.levels,
      title_ru = excluded.title_ru,
      owner_only = excluded.owner_only,
      live = excluded.live,
      enforced_by = excluded.enforced_by,
      position = excluded.position;

-- ── У тех, кто уже работает, ничего не пропадает ───────────────────────────
insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by)
select mc.tenant_id, mc.user_id, 'clients.open', mc.team_id, 'write', owner.user_id
  from public.member_calendars mc
  join public.tenant_members tm
    on tm.tenant_id = mc.tenant_id and tm.user_id = mc.user_id and tm.role <> 'owner'
  join lateral (
    select o.user_id from public.tenant_members o
     where o.tenant_id = mc.tenant_id and o.role = 'owner'
     order by o.joined_at nulls last
     limit 1
  ) owner on true
 where public.access_team_level(mc.tenant_id, mc.user_id, 'clients', mc.team_id) in ('read', 'write')
on conflict (tenant_id, user_id, block, team_id) do nothing;

insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by)
select mc.tenant_id, mc.user_id, 'clients.from_record', mc.team_id, 'write', owner.user_id
  from public.member_calendars mc
  join public.tenant_members tm
    on tm.tenant_id = mc.tenant_id and tm.user_id = mc.user_id and tm.role <> 'owner'
  join lateral (
    select o.user_id from public.tenant_members o
     where o.tenant_id = mc.tenant_id and o.role = 'owner'
     order by o.joined_at nulls last
     limit 1
  ) owner on true
on conflict (tenant_id, user_id, block, team_id) do nothing;

-- ── Блоки страницы клиента — только при «Открывает карточку» ───────────────
-- Тело — живое (md5 cd7680ba), добавлено: положение `clients.open` команды и
-- его ключ в `blocks`; блоки, которых нет в строке списка, без него гаснут.
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
      -- Карточка — своим ключом; блок «Меняет» — только при «Меняет» карточки.
      select tm.team_id, 'clients'::text as block_key,
             case when tm.card_level = 'write' then 2 else 1 end as rank
        from teams tm
      union all
      -- «Открывает карточку» — своим ключом: по нему приложение гасит переход.
      select tm.team_id, 'clients.open'::text,
             case when tm.open_level = 'write' then 2 else 0 end
        from teams tm
      union all
      select tm.team_id, k.block_key,
             case
               when k.block_key = any(page_only) and tm.open_level is distinct from 'write' then 0
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

-- ── Клиент записи — только при «Карточке из записи» ────────────────────────
-- Тело — живое (md5 17214e29), добавлено одно условие: запись клиента — в
-- команде, где партнёру открыт переход из записи.
create or replace function public.list_master_clients_safe(p_client_id uuid default null::uuid)
 returns setof jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with client_teams as (
    select public.access_calendars('record.client', 'read') as ids,
           public.access_calendars('clients.from_record', 'write') as door_ids
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
    -- Номер — только дверью `member_client_contacts`.
    'phone', '',
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
     and exists (
       select 1
         from public.appointments a
        where a.tenant_id = c.tenant_id
          and a.client_id = c.id
          and a.kind = 'work'
          and a.team_id = any(ct.ids)
          -- «Карточка из записи» (01.10): без права в команде записи —
          -- клиента записи окно не отдаёт.
          and a.team_id = any(ct.door_ids)
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
