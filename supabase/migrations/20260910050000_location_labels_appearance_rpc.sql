-- ТИП ОБЪЕКТА УЧИТСЯ НОСИТЬ ВИД. Колонки `color` и `icon` у `location_labels`
-- появились предыдущей миграцией, но записать их было нечем: справочник пишется
-- только через эту RPC (SECURITY DEFINER, владелец), а она вставляла ровно
-- id/name/position и молча теряла бы всё остальное.
--
-- Добавлены: проверка формата (цвет — #RRGGBB, значок — слаг из словаря) и сами
-- колонки в insert…on conflict. Пустая строка приводится к NULL: «не красить» и
-- «нет значка» — это отсутствие значения, а не пустой текст.
--
-- Остальное тело функции не тронуто: те же права, те же лимиты, тот же
-- advisory-lock и тот же приём с временным is_active=false ради атомарного
-- обмена именами.

create or replace function public.apply_location_label_changes(p_labels jsonb, p_remove_ids jsonb default '[]'::jsonb)
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
  -- ВИД ТИПА ОБЪЕКТА: цвет из палитры и слаг значка. Оба необязательны, но если
  -- пришли — обязаны быть похожи на себя: клиент чинится, а мусор в справочнике
  -- живёт годами и всплывает чужим цветом в чужом месте.
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

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':location-labels', 0)
  );

  update public.location_labels l
     set is_active = false,
         updated_at = now()
   where l.tenant_id = tenant_uuid
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
     and l.is_active
     and exists (
       select 1
         from jsonb_array_elements(p_labels) item
        where btrim(item ->> 'id') = l.id
     );

  insert into public.location_labels (
    tenant_id, id, name, position, is_active, created_by, color, icon
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
         nullif(btrim(coalesce(item.value ->> 'icon', '')), '')
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
       and l.is_active
     order by l.position, l.created_at, l.id;
end;
$function$;
