-- БАЗА — ТОЛЬКО КЛИЕНТЫ КОМАНДЫ; «ОГРАНИЧЕНИЕ ПО ВРЕМЕНИ»; «ИСТОРИЯ ЗАПИСЕЙ»
-- И «КАРТОЧКА ИЗ ЗАПИСИ» УБРАНЫ (владелец 02.10, поздно вечером, вслед за
-- `20261002235300_clients_base_three_levels`).
--
-- «Если я показываю ему, что он может видеть клиента, значит, он видит
-- историю записей, карточку, и запись он всегда может открывать, если он её
-- видит». «Только база клиентов, которая закреплена за командой, к которой у
-- него есть доступ». «„Какие клиенты" оставляем, только надо переименовать»
-- — «Ограничение по времени».
--
-- 1. Набор партнёра — ТОЛЬКО клиенты, закреплённые за его командой
--    (`clients.team_id`). Клиенты чужих команд с записями в его команде и
--    клиенты, которых он завёл, а потом передали в другую команду, в его
--    базу больше не попадают. «Ограничение по времени» (`clients.scope`,
--    бывшее «Какие клиенты») сужает их: «2 недели» / «Месяц» — у клиента
--    команды есть запись этой команды не дальше двух недель / месяца до или
--    после сегодня (отменённая окна не открывает); «Без ограничения» — все
--    клиенты команды.
-- 2. «История записей» (`clients.history`) убрано: история видна каждому, кто
--    видит клиента (`access_client_blocks` отдаёт её «Видит» всегда;
--    `member_client_history` спрашивает её там же и не меняется).
-- 3. «Карточка из записи» (`clients.from_record`) убрано: из записи, которую
--    он видит, карточка клиента открывается всегда (`list_master_clients_safe`
--    больше не спрашивает дверь команды). Окно записи (день до — неделя
--    после) для клиента вне его базы осталось прежним.
--
-- Тела сняты с боевой базы 02.10 и изменены только в помеченных местах:
-- `access_client_ids_in` (md5 a2496c2d…), `access_client_blocks` (f8f34c62…),
-- `list_master_clients_safe` (adf8da6b…; умолчание `p_client_id` сохранено).
-- `create or replace` права исполнения не трогает.

-- ─── 1. База — клиенты команды, «Ограничение по времени» ─────────────────────

create or replace function public.access_client_ids_in(p_teams text[])
 returns uuid[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid := public.current_tenant_id();
  team_wide text[];
  month_teams text[];
  near_teams text[];
  today date;
begin
  if caller is null or active_tenant is null or coalesce(cardinality(p_teams), 0) = 0 then
    return array[]::uuid[];
  end if;

  -- «Без ограничения» — все клиенты команды; «Месяц» и «2 недели» — клиенты
  -- команды с записью этой команды в окне; неизвестное — «2 недели».
  select coalesce(array_agg(s.team_id) filter (where s.level in ('own', 'all')), array[]::text[]),
         coalesce(array_agg(s.team_id) filter (where s.level = 'month'), array[]::text[]),
         coalesce(array_agg(s.team_id) filter (where s.level not in ('own', 'all', 'month')), array[]::text[])
    into team_wide, month_teams, near_teams
    from (
      select t.team_id,
             coalesce(public.access_team_level(active_tenant, caller, 'clients.scope', t.team_id), 'near') as level
        from unnest(p_teams) as t(team_id)
    ) s;

  today := public.tenant_business_date(active_tenant);

  -- 02.10: «только база клиентов, которая закреплена за командой, к которой
  -- у него есть доступ» — клиент с командой из открытых ему, и только так.
  return coalesce((
    select array_agg(c.id order by c.id)
      from public.clients c
     where c.tenant_id = active_tenant
       and c.deleted_at is null
       and (
         c.team_id = any(team_wide)
         or (
           c.team_id = any(month_teams)
           and exists (
             select 1
               from public.appointments a
              where a.tenant_id = active_tenant
                and a.client_id = c.id
                and a.team_id = c.team_id
                and a.status is distinct from 'cancelled'
                and a.date between (today - interval '1 month')::date::text
                               and (today + interval '1 month')::date::text
           )
         )
         or (
           c.team_id = any(near_teams)
           and exists (
             select 1
               from public.appointments a
              where a.tenant_id = active_tenant
                and a.client_id = c.id
                and a.team_id = c.team_id
                and a.status is distinct from 'cancelled'
                and a.date between (today - 14)::text and (today + 14)::text
           )
         )
       )
  ), array[]::uuid[]);
end;
$function$;

update public.access_blocks
   set title_ru = 'Ограничение по времени'
 where key = 'clients.scope';

-- ─── 2. История записей — вместе с клиентом ─────────────────────────────────

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
    'clients.money'
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
      -- История записей видна каждому, кто видит клиента (02.10: «История
      -- записей» убрано).
      select tm.team_id, 'clients.history'::text, 1
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
 where block = 'clients.history';

delete from public.access_blocks
 where key = 'clients.history';

-- ─── 3. Карточка из записи — всегда ─────────────────────────────────────────

create or replace function public.list_master_clients_safe(p_client_id uuid DEFAULT NULL::uuid)
 returns SETOF jsonb
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

delete from public.member_access
 where block = 'clients.from_record';

delete from public.access_blocks
 where key = 'clients.from_record';
