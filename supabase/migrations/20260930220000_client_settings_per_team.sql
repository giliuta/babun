-- НАСТРОЙКИ КЛИЕНТОВ — У КОМАНДЫ (владелец 30.09: «типы объектов также
-- закреплены за командой»; «теги, выгрузка, архив, корзина — всё закреплено
-- за командой; люди, связи, реквизиты, файлы — всё закреплено за командой»;
-- «да, накатывай»).
--
-- 1. ТИПЫ ОБЪЕКТОВ (`location_labels.team_id`). Нынешний список компании
--    становится списком первой живой команды, остальные живые команды
--    получают копию (`<id>@<команда>`). В объекте клиента тип хранится
--    ИМЕНЕМ, а не ссылкой, — копии ничего не ломают. Компания без живых
--    команд теряет свои типы (держать их не у кого; на 30.09 таких нет).
--    Правка — `apply_team_location_label_changes(команда, …)`; прежняя
--    `apply_location_label_changes` оставлена обёрткой над первой командой
--    для старых сборок. Страница запроса адреса предлагает типы команды
--    клиента.
-- 2. ФУНКЦИИ КЛИЕНТОВ («Люди и связи», «Реквизиты», «Файлы») — ключи
--    `client_people`, `client_requisites`, `client_files` в
--    `team_design.disabled_blocks`. Сервер эти функции не проверяет, у
--    компаний на 30.09 они не выключены — переносить нечего.
-- 3. ТЕГИ (`client_tags.team_id`). Теги первой живой команды — нынешние,
--    у остальных — копии; тег на клиенте переезжает на копию в команде
--    клиента. Готовые теги компаний без живых команд (64 шт., ни одного на
--    клиенте) удаляются. Регистрация больше не заводит готовых тегов: теги у
--    команды, а команд в момент регистрации ещё нет (как с категориями
--    денег — «готовых нет»).
--
-- Тела `apply_location_label_changes` (fb73b41f…) и `location_request_lookup`
-- (6b70233d…) сняты `pg_get_functiondef`. `handle_new_user` (d1154ef8…) не
-- переписывается текстом: миграция берёт живое тело, вырезает ровно один
-- кусок — заготовку тегов — и падает, если кусок найден не ровно один раз.

set local lock_timeout = '5s';

-- ═══ 1. ТИПЫ ОБЪЕКТОВ ═══
alter table public.location_labels add column if not exists team_id text;

with first_team as (
  select distinct on (t.tenant_id) t.tenant_id, t.id
    from public.teams t
   where t.is_active
   order by t.tenant_id, t.position, t.created_at
)
update public.location_labels l
   set team_id = f.id
  from first_team f
 where f.tenant_id = l.tenant_id
   and l.team_id is null;

-- Имя уникально В КОМАНДЕ, а не в компании: у каждой команды своя «Вилла».
drop index if exists public.ux_location_labels_active_name;
create unique index ux_location_labels_active_name
  on public.location_labels (tenant_id, team_id, lower(btrim(name)))
  where is_active;

insert into public.location_labels (
  tenant_id, id, name, position, is_active, created_at, updated_at,
  created_by, color, icon, team_id
)
select l.tenant_id, l.id || '@' || t.id, l.name, l.position, l.is_active,
       l.created_at, now(), l.created_by, l.color, l.icon, t.id
  from public.location_labels l
  join public.teams t
    on t.tenant_id = l.tenant_id
   and t.is_active
   and t.id <> l.team_id
 where l.team_id is not null
on conflict (tenant_id, id) do nothing;

delete from public.location_labels where team_id is null;

alter table public.location_labels alter column team_id set not null;
alter table public.location_labels drop constraint if exists location_labels_team_fk;
alter table public.location_labels
  add constraint location_labels_team_fk foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id) on delete cascade;
create index if not exists location_labels_team_idx
  on public.location_labels (tenant_id, team_id);

create or replace function public.apply_team_location_label_changes(
  p_team_id text,
  p_labels jsonb,
  p_remove_ids jsonb default '[]'::jsonb
)
 returns setof location_labels
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  label_count integer;
begin
  if auth.uid() is null
     or tenant_uuid is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'Настраивать типы объектов может только владелец';
  end if;
  if p_team_id is null
     or not exists (
       select 1 from public.teams team
        where team.tenant_id = tenant_uuid
          and team.id = p_team_id
     ) then
    raise exception 'Команда типов объектов не найдена в компании'
      using errcode = '23503';
  end if;
  if p_labels is null or jsonb_typeof(p_labels) <> 'array' then
    raise exception 'Список типов объектов имеет неверный формат';
  end if;
  if p_remove_ids is null or jsonb_typeof(p_remove_ids) <> 'array' then
    raise exception 'Список удаляемых типов объектов имеет неверный формат';
  end if;

  label_count := jsonb_array_length(p_labels);
  if label_count > 100 then
    raise exception 'Можно сохранить не больше 100 типов объектов';
  end if;
  if jsonb_array_length(p_remove_ids) > 100 then
    raise exception 'Можно удалить не больше 100 типов объектов за один раз';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_labels) item
     where jsonb_typeof(item) is distinct from 'object'
        or jsonb_typeof(item -> 'id') is distinct from 'string'
        or jsonb_typeof(item -> 'name') is distinct from 'string'
        or char_length(btrim(item ->> 'id')) not between 1 and 160
        or char_length(btrim(item ->> 'name')) not between 1 and 80
        or (
          item ? 'position'
          and not (
            jsonb_typeof(item -> 'position') = 'number'
            and (item ->> 'position') ~ '^[0-9]{1,6}$'
          )
        )
  ) then
    raise exception 'Каждый тип объекта должен иметь идентификатор и название';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_labels) item
     where (
             item ? 'color'
             and jsonb_typeof(item -> 'color') = 'string'
             and btrim(item ->> 'color') <> ''
             and btrim(item ->> 'color') !~ '^#[0-9A-Fa-f]{6}$'
           )
        or (
             item ? 'icon'
             and jsonb_typeof(item -> 'icon') = 'string'
             and btrim(item ->> 'icon') <> ''
             and btrim(item ->> 'icon') !~ '^[a-z0-9-]{1,40}$'
           )
  ) then
    raise exception 'Цвет или значок типа объекта имеет неверный формат';
  end if;
  if (
    select count(distinct btrim(item ->> 'id'))
      from jsonb_array_elements(p_labels) item
  ) <> label_count then
    raise exception 'Идентификаторы типов объектов не должны повторяться';
  end if;
  if (
    select count(distinct lower(btrim(item ->> 'name')))
      from jsonb_array_elements(p_labels) item
  ) <> label_count then
    raise exception 'Названия типов объектов не должны повторяться';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_remove_ids) item
     where jsonb_typeof(item) is distinct from 'string'
        or char_length(btrim(item #>> '{}')) not between 1 and 160
  ) then
    raise exception 'Список удаляемых типов объектов повреждён';
  end if;
  if (
    select count(distinct btrim(item #>> '{}'))
      from jsonb_array_elements(p_remove_ids) item
  ) <> jsonb_array_length(p_remove_ids) then
    raise exception 'Удаляемые типы объектов не должны повторяться';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_labels) label_item
      join jsonb_array_elements(p_remove_ids) remove_item
        on btrim(label_item ->> 'id') = btrim(remove_item #>> '{}')
  ) then
    raise exception 'Тип объекта нельзя одновременно сохранить и удалить';
  end if;
  -- Тип другой команды не правится и не отбирается чужим списком.
  if exists (
    select 1
      from public.location_labels l
      join jsonb_array_elements(p_labels) item
        on btrim(item ->> 'id') = l.id
     where l.tenant_id = tenant_uuid
       and l.team_id <> p_team_id
  ) then
    raise exception 'Тип объекта принадлежит другой команде'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':location-labels:' || p_team_id, 0)
  );

  update public.location_labels l
     set is_active = false,
         updated_at = now()
   where l.tenant_id = tenant_uuid
     and l.team_id = p_team_id
     and l.is_active
     and exists (
       select 1
         from jsonb_array_elements(p_remove_ids) item
        where btrim(item #>> '{}') = l.id
     );

  update public.location_labels l
     set is_active = false,
         updated_at = now()
   where l.tenant_id = tenant_uuid
     and l.team_id = p_team_id
     and l.is_active
     and exists (
       select 1
         from jsonb_array_elements(p_labels) item
        where btrim(item ->> 'id') = l.id
     );

  insert into public.location_labels (
    tenant_id, id, name, position, is_active, created_by, color, icon, team_id
  )
  select tenant_uuid,
         btrim(item.value ->> 'id'),
         btrim(item.value ->> 'name'),
         coalesce(
           (item.value ->> 'position')::integer,
           (item.ordinality - 1)::integer
         ),
         true,
         auth.uid(),
         nullif(btrim(coalesce(item.value ->> 'color', '')), ''),
         nullif(btrim(coalesce(item.value ->> 'icon', '')), ''),
         p_team_id
    from jsonb_array_elements(p_labels) with ordinality as item(value, ordinality)
  on conflict (tenant_id, id) do update
    set name = excluded.name,
        position = excluded.position,
        is_active = true,
        color = excluded.color,
        icon = excluded.icon,
        updated_at = now();

  return query
    select l.*
      from public.location_labels l
     where l.tenant_id = tenant_uuid
       and l.team_id = p_team_id
       and l.is_active
     order by l.position, l.created_at, l.id;
end;
$function$;

revoke all on function public.apply_team_location_label_changes(text, jsonb, jsonb) from public, anon;
grant execute on function public.apply_team_location_label_changes(text, jsonb, jsonb) to authenticated;

-- Старые сборки зовут прежнюю дверь без команды — она правит первую живую.
CREATE OR REPLACE FUNCTION public.apply_location_label_changes(p_labels jsonb, p_remove_ids jsonb DEFAULT '[]'::jsonb)
 RETURNS SETOF location_labels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
    select *
      from public.apply_team_location_label_changes(
        (select t.id
           from public.teams t
          where t.tenant_id = public.current_tenant_id()
            and t.is_active
          order by t.position, t.created_at
          limit 1),
        p_labels,
        p_remove_ids
      );
end;
$function$;

CREATE OR REPLACE FUNCTION public.location_request_lookup(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_labels jsonb;
begin
  if p_token is null or length(p_token) not between 32 and 128 then
    return jsonb_build_object('state', 'missing');
  end if;
  select lr.tenant_id, lr.used_at, lr.expires_at,
         t.name as business_name, t.logo_url,
         split_part(coalesce(c.full_name, ''), ' ', 1) as first_name,
         c.team_id as client_team_id
    into r
    from public.location_requests lr
    join public.tenants t on t.id = lr.tenant_id
    join public.clients c on c.id = lr.client_id
   where lr.token = p_token;
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  -- ТИПЫ ОБЪЕКТОВ — КОМАНДЫ КЛИЕНТА (30.09); у клиента без команды — все
  -- имена компании без повторов.
  select coalesce(jsonb_agg(x.name order by x.pos), '[]'::jsonb)
    into v_labels
    from (
      select l.name, min(l.position) as pos
        from public.location_labels l
       where l.tenant_id = r.tenant_id
         and l.is_active
         and (r.client_team_id is null or l.team_id = r.client_team_id)
       group by l.name
    ) x;
  return jsonb_build_object(
    'state', case
      when r.used_at is not null then 'used'
      when r.expires_at < now() then 'expired'
      else 'pending' end,
    'business_name', r.business_name,
    'logo_url', r.logo_url,
    'client_first_name', r.first_name,
    'labels', v_labels,
    'expires_at', r.expires_at
  );
end $function$;

-- ═══ 2. ФУНКЦИИ КЛИЕНТОВ ═══
alter table public.team_design drop constraint if exists team_design_blocks_known;
alter table public.team_design add constraint team_design_blocks_known check (
  disabled_blocks <@ array[
    'record_label', 'record_object', 'record_payment', 'record_note', 'record_files',
    'event_label', 'event_type', 'event_client', 'event_object', 'event_note', 'event_files',
    'client_people', 'client_requisites', 'client_files'
  ]::text[]
);

-- ═══ 3. ТЕГИ ═══
alter table public.client_tags add column if not exists team_id text;

delete from public.client_tags ct
 where not exists (
   select 1 from public.teams t
    where t.tenant_id = ct.tenant_id and t.is_active
 );

with first_team as (
  select distinct on (t.tenant_id) t.tenant_id, t.id
    from public.teams t
   where t.is_active
   order by t.tenant_id, t.position, t.created_at
)
update public.client_tags ct
   set team_id = f.id
  from first_team f
 where f.tenant_id = ct.tenant_id
   and ct.team_id is null;

create temp table _client_tag_copy on commit drop as
  select ct.id as src_id, t.id as team_id, gen_random_uuid() as new_id
    from public.client_tags ct
    join public.teams t
      on t.tenant_id = ct.tenant_id
     and t.is_active
     and t.id <> ct.team_id;

insert into public.client_tags (id, tenant_id, name, color, icon, position, hidden, team_id)
select c.new_id, ct.tenant_id, ct.name, ct.color, ct.icon, ct.position, ct.hidden, c.team_id
  from _client_tag_copy c
  join public.client_tags ct on ct.id = c.src_id;

-- Тег на клиенте — копия в команде клиента.
update public.client_tag_assignments a
   set tag_id = c.new_id
  from _client_tag_copy c, public.clients cl
 where a.tag_id = c.src_id
   and cl.id = a.client_id
   and cl.team_id = c.team_id;

alter table public.client_tags alter column team_id set not null;
alter table public.client_tags drop constraint if exists client_tags_team_fk;
alter table public.client_tags
  add constraint client_tags_team_fk foreign key (tenant_id, team_id)
    references public.teams (tenant_id, id) on delete cascade;
create index if not exists client_tags_team_idx
  on public.client_tags (tenant_id, team_id);

-- Регистрация без готовых тегов: ровно один кусок живого тела.
do $hnu$
declare
  def text := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  hunk text := E'  insert into public.client_tags (id, tenant_id, name, color) values\n'
    || E'    (gen_random_uuid(), v_tenant_id, ''VIP'',         ''#f59e0b''),\n'
    || E'    (gen_random_uuid(), v_tenant_id, ''Новый'',       ''#3b82f6''),\n'
    || E'    (gen_random_uuid(), v_tenant_id, ''Постоянный'',  ''#10b981''),\n'
    || E'    (gen_random_uuid(), v_tenant_id, ''Проблемный'',  ''#ef4444'');\n\n';
begin
  if (length(def) - length(replace(def, hunk, ''))) / length(hunk) <> 1 then
    raise exception 'client_settings_per_team: seed-tags hunk of handle_new_user not found exactly once';
  end if;
  execute replace(
    def,
    hunk,
    E'  -- Готовых тегов нет (владелец 30.09): теги у команды, а команд в\n'
      || E'  -- момент регистрации ещё нет — каждая команда заводит свои.\n\n'
  );
end;
$hnu$;

-- ═══ СТОРОЖА ═══
do $guard$
begin
  if exists (select 1 from public.location_labels where team_id is null) then
    raise exception 'client_settings_per_team: object type without a team';
  end if;
  if exists (select 1 from public.client_tags where team_id is null) then
    raise exception 'client_settings_per_team: client tag without a team';
  end if;
  if pg_get_functiondef('public.handle_new_user()'::regprocedure) ilike '%insert into public.client_tags%' then
    raise exception 'client_settings_per_team: signup still seeds tags';
  end if;
  if has_function_privilege('anon', 'public.apply_team_location_label_changes(text, jsonb, jsonb)', 'execute') then
    raise exception 'client_settings_per_team: anon can edit object types';
  end if;
end;
$guard$;
