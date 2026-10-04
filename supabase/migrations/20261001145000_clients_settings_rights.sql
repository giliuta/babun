-- «НАСТРОЙКИ КЛИЕНТОВ» ПО ПРАВАМ (владелец 01.10: «в настройках он может
-- редактировать или не может редактировать… поблочно, что можно и что
-- нельзя»). Как «Настройки команды» в «Календаре»: строка на каждую строку
-- шестерёнки клиентов, ступени «Скрыты · Только видит · Видит и меняет», по
-- команде, по умолчанию у партнёра «Скрыты».
--
--   • «Карточка клиента» — `clients.settings_card`: что видно в строке списка
--     (`team_design.client_list_off`) и какие блоки есть у карточки
--     (`client_*` в `team_design.disabled_blocks`);
--   • «Способы связи» — `clients.settings_ways`: `team_design.contact_ways`;
--   • «Карты для маршрута» — `clients.settings_maps`: `team_design.map_services`;
--   • «Типы объектов» — `clients.settings_objects`: справочник
--     `location_labels` команды (`apply_team_location_label_changes`) и срок
--     обслуживания `team_design.service_every_months`;
--   • «Теги клиентов» — `clients.settings_tags`: `client_tags` команды.
--
-- ДЫРА, КОТОРУЮ ЭТО ЗАКРЫВАЕТ. `team_design` — одна строка на команду, и в ней
-- лежат и настройки формы записи, и настройки клиентов. Правило
-- `team_design_write_access` пускало партнёра с «Записи: Видит и меняет»
-- писать строку целиком — то есть менять и клиентские колонки. Теперь пускают
-- любые из этих прав, а СТОРОЖ КОЛОНОК проверяет, что поменялось только то,
-- на что у него есть право: часть `disabled_blocks` с `client_*` — карточка,
-- остальная часть и цвета записи — «Записи».

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  ('clients.settings_card', 'clients', 'calendar', array['off', 'read', 'write'], 'Карточка клиента', false, true,
   array['function:public.team_design_guard_columns()'], 245),
  ('clients.settings_ways', 'clients', 'calendar', array['off', 'read', 'write'], 'Способы связи', false, true,
   array['function:public.team_design_guard_columns()'], 246),
  ('clients.settings_maps', 'clients', 'calendar', array['off', 'read', 'write'], 'Карты для маршрута', false, true,
   array['function:public.team_design_guard_columns()'], 247),
  ('clients.settings_objects', 'clients', 'calendar', array['off', 'read', 'write'], 'Типы объектов', false, true,
   array[
     'function:public.apply_team_location_label_changes(text, jsonb, jsonb)',
     'function:public.team_design_guard_columns()'
   ], 248),
  ('clients.settings_tags', 'clients', 'calendar', array['off', 'read', 'write'], 'Теги клиентов', false, true,
   array['policy:public.client_tags.client_tags_write_settings'], 249)
on conflict (key) do update
  set area = excluded.area,
      scope = excluded.scope,
      levels = excluded.levels,
      title_ru = excluded.title_ru,
      owner_only = excluded.owner_only,
      live = excluded.live,
      enforced_by = excluded.enforced_by,
      position = excluded.position;

-- ── Строка команды: пускают «Записи» и любые настройки клиентов ────────────
drop policy if exists team_design_write_access on public.team_design;
create policy team_design_write_access on public.team_design
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (
      select unnest(
        public.access_calendars('calendar.booking_form', 'write')
        || public.access_calendars('clients.settings_card', 'write')
        || public.access_calendars('clients.settings_ways', 'write')
        || public.access_calendars('clients.settings_maps', 'write')
        || public.access_calendars('clients.settings_objects', 'write')
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (
      select unnest(
        public.access_calendars('calendar.booking_form', 'write')
        || public.access_calendars('clients.settings_card', 'write')
        || public.access_calendars('clients.settings_ways', 'write')
        || public.access_calendars('clients.settings_maps', 'write')
        || public.access_calendars('clients.settings_objects', 'write')
      )
    )
  );

-- ── Сторож колонок ─────────────────────────────────────────────────────────
-- Владелец и служебные вызовы (без входа) — как раньше. Партнёр: каждая
-- поменявшаяся часть строки — только при своём праве в этой команде. Новая
-- строка сравнивается с умолчаниями таблицы. Удалять строку команды партнёр
-- не может вовсе: удаление стёрло бы и чужие настройки.
create or replace function public.team_design_guard_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  old_blocks text[] := array[]::text[];
  new_blocks text[];
  old_rule text := 'team';
  old_palette jsonb;
  old_fallback text;
  old_list text[];
  old_ways jsonb;
  old_maps jsonb;
  old_months integer;
  team text;
begin
  if auth.uid() is null or public.current_user_role() is not distinct from 'owner' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'удалять настройки команды может только владелец'
      using errcode = '42501', hint = 'access:owner';
  end if;

  -- Приложение пишет «вставить или обновить» (`upsert`): строка команды уже
  -- есть — вставка уйдёт в обновление, и сверять надо с ней, а не с
  -- умолчаниями. Это сделает тот же сторож на шаге обновления.
  if tg_op = 'INSERT' and exists (
    select 1 from public.team_design d
     where d.tenant_id = new.tenant_id and d.team_id = new.team_id
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    old_blocks := coalesce(old.disabled_blocks, array[]::text[]);
    old_rule := old.record_color_rule;
    old_palette := old.record_color_palette;
    old_fallback := old.record_color_fallback;
    old_list := old.client_list_off;
    old_ways := old.contact_ways;
    old_maps := old.map_services;
    old_months := old.service_every_months;
    if new.team_id is distinct from old.team_id or new.tenant_id is distinct from old.tenant_id then
      raise exception 'строку настроек нельзя перенести в другую команду'
        using errcode = '42501', hint = 'access:owner';
    end if;
  end if;

  team := new.team_id;
  new_blocks := coalesce(new.disabled_blocks, array[]::text[]);

  -- «Записи»: цвет записи и блоки формы (всё, что не `client_*`).
  if new.record_color_rule is distinct from old_rule
     or new.record_color_palette is distinct from old_palette
     or new.record_color_fallback is distinct from old_fallback
     or array(select b from unnest(new_blocks) b where b not like 'client\_%' order by b)
        is distinct from array(select b from unnest(old_blocks) b where b not like 'client\_%' order by b)
  then
    if not team = any(public.access_calendars('calendar.booking_form', 'write')) then
      raise exception 'нет права менять «Записи» этой команды'
        using errcode = '42501', hint = 'block:calendar.booking_form';
    end if;
  end if;

  -- «Карточка клиента»: строка списка и блоки карточки.
  if new.client_list_off is distinct from old_list
     or array(select b from unnest(new_blocks) b where b like 'client\_%' order by b)
        is distinct from array(select b from unnest(old_blocks) b where b like 'client\_%' order by b)
  then
    if not team = any(public.access_calendars('clients.settings_card', 'write')) then
      raise exception 'нет права менять «Карточку клиента» этой команды'
        using errcode = '42501', hint = 'block:clients.settings_card';
    end if;
  end if;

  if new.contact_ways is distinct from old_ways
     and not team = any(public.access_calendars('clients.settings_ways', 'write')) then
    raise exception 'нет права менять «Способы связи» этой команды'
      using errcode = '42501', hint = 'block:clients.settings_ways';
  end if;

  if new.map_services is distinct from old_maps
     and not team = any(public.access_calendars('clients.settings_maps', 'write')) then
    raise exception 'нет права менять «Карты для маршрута» этой команды'
      using errcode = '42501', hint = 'block:clients.settings_maps';
  end if;

  if new.service_every_months is distinct from old_months
     and not team = any(public.access_calendars('clients.settings_objects', 'write')) then
    raise exception 'нет права менять «Типы объектов» этой команды'
      using errcode = '42501', hint = 'block:clients.settings_objects';
  end if;

  return new;
end;
$function$;

revoke execute on function public.team_design_guard_columns() from public, anon;

drop trigger if exists team_design_guard_columns on public.team_design;
create trigger team_design_guard_columns
  before insert or update or delete on public.team_design
  for each row execute function public.team_design_guard_columns();

-- ── «Теги клиентов» ────────────────────────────────────────────────────────
-- Только теги своей команды: общие теги компании (без команды) и теги чужих
-- команд правит владелец.
drop policy if exists client_tags_write_settings on public.client_tags;
create policy client_tags_write_settings on public.client_tags
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('clients.settings_tags', 'write')))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('clients.settings_tags', 'write')))
  );

-- ── «Типы объектов» — владелец или партнёр с правом в этой команде ─────────
-- Тело — живое (md5 5fbdab43), заменена только проверка владельца.
create or replace function public.apply_team_location_label_changes(p_team_id text, p_labels jsonb, p_remove_ids jsonb default '[]'::jsonb)
 returns setof public.location_labels
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
     or (
       public.current_user_role() is distinct from 'owner'
       and not coalesce(p_team_id = any(public.access_calendars('clients.settings_objects', 'write')), false)
     ) then
    raise exception 'Нет права настраивать типы объектов этой команды'
      using errcode = '42501', hint = 'block:clients.settings_objects';
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
