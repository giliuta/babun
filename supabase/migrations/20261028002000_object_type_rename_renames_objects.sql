-- ПЕРЕИМЕНОВАНИЕ ТИПА ОБЪЕКТА ПЕРЕИМЕНОВЫВАЕТ ЕГО И У ОБЪЕКТОВ.
--
-- Объект хранит тип строкой (`clients.locations[].label`), а показ ищет её по
-- имени в справочнике (`findObjectType`). Переименование меняло только
-- справочник: у всех объектов этого типа тип пропадал — домик без слова, а в
-- листе правки снова «Выбрать тип объекта» (QA2-14, смета 035 №205).
--
-- Теперь та же операция, что сохраняет справочник команды, переписывает
-- метку у объектов клиентов ЭТОЙ команды: старое имя (без регистра и
-- пробелов, как `objectTypeKey`) → новое. Тело функции снято с боевой
-- 27.10; добавлен только блок «Переименованные типы — и у объектов».
--
-- Правка `clients` идёт под их триггерами. Партнёра они отбивают только при
-- замороженном или бесплатном тарифе (`clients_partner_writes_guard`,
-- `clients_free_readonly`) — так же, как саму запись справочника; права на
-- клиентов не спрашивают: функция — определителя, а «Типы объектов: Меняет»
-- проверено выше.

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
  renamed record;
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

  -- Переименованные типы — и у объектов. Прежнее имя берётся из живой строки
  -- справочника (до upsert ниже); сравнение — как `objectTypeKey` в
  -- приложении: без регистра и крайних пробелов. Смена одного регистра тоже
  -- переписывается: объект показывает тип так, как он назван в справочнике.
  for renamed in
    select l.name as old_name, btrim(item ->> 'name') as new_name
      from public.location_labels l
      join jsonb_array_elements(p_labels) item
        on btrim(item ->> 'id') = l.id
     where l.tenant_id = tenant_uuid
       and l.team_id = p_team_id
       and l.is_active
       and l.name is distinct from btrim(item ->> 'name')
  loop
    update public.clients c
       set locations = (
             select jsonb_agg(
                      case
                        when lower(btrim(coalesce(loc.value ->> 'label', ''))) = lower(btrim(renamed.old_name))
                          then jsonb_set(loc.value, '{label}', to_jsonb(renamed.new_name))
                        else loc.value
                      end
                      order by loc.ordinality
                    )
               from jsonb_array_elements(c.locations) with ordinality as loc(value, ordinality)
           )
     where c.tenant_id = tenant_uuid
       and c.team_id = p_team_id
       and jsonb_typeof(c.locations) = 'array'
       and exists (
         select 1
           from jsonb_array_elements(c.locations) loc
          where lower(btrim(coalesce(loc ->> 'label', ''))) = lower(btrim(renamed.old_name))
       );
  end loop;

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

do $guard$
begin
  if position('-- Переименованные типы — и у объектов.' in pg_get_functiondef('public.apply_team_location_label_changes(text, jsonb, jsonb)'::regprocedure)) = 0 then
    raise exception 'apply_team_location_label_changes: переименование у объектов не встало';
  end if;
  if has_function_privilege('anon', 'public.apply_team_location_label_changes(text, jsonb, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.apply_team_location_label_changes(text, jsonb, jsonb)', 'execute') then
    raise exception 'apply_team_location_label_changes: права изменились';
  end if;
end;
$guard$;
