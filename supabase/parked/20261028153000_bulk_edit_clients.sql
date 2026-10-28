-- МАССОВАЯ ПРАВКА КЛИЕНТОВ — ТЕГИ, КОМАНДА, ИСТОЧНИК ОДНИМ ВЫЗОВОМ.
--
-- Режим выбора во вкладке «Клиенты» ставит выбранным тег, команду или
-- источник. Одна функция на пачку: цикл вызовов с телефона на двести
-- клиентов оборвался бы посреди, и половина базы осталась бы с новым тегом,
-- половина — без.
--
-- ПРАВА НЕ ПЕРЕПИСАНЫ, А ВЗЯТЫ ГОТОВЫМИ. Каждый клиент правится теми же
-- дверьми, что карточка: теги и источник — `update_client_with_tags`
-- (блоки «Тег» и «Личное», теги только команды клиента у сотрудника),
-- команда — `set_client_team`. Функции определителя зовут друг друга под тем
-- же токеном и заголовком компании (`auth.uid()`, `current_tenant_id()`), так
-- что решают ровно то же, что решили бы с карточки. Отказ двери по клиенту
-- (нет права, клиент не виден, тег чужой команды) не роняет пачку: клиент
-- пропускается и считается в `skipped`.
--
-- ВХОД — СПИСОК ПРАВОК, А НЕ ОДНА ПРАВКА НА ВСЕХ. Источник — строка
-- справочника СВОЕЙ команды у каждого клиента (`src:<id>`), и экран
-- подбирает её по имени для каждого; отмена возвращает каждому его прежнее.
-- Поля правки:
--   id                  — клиент;
--   add_tags/remove_tags — добавить в конец набора / снять из набора;
--   tag_ids             — набор целиком (отмена);
--   team_id             — команда клиента;
--   acquisition_source  — источник.
--
-- ОТВЕТ: `changed` — кого изменили и что у них было до (`before` несёт только
-- изменённые поля — ровно то, что вернёт отмена), `skipped` — сколько отказано
-- или не найдено, `unchanged` — у скольких уже стояло то же.

create or replace function public.bulk_edit_clients(p_edits jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  active_role text := public.current_user_role();
  edit jsonb;
  edit_client uuid;
  current_row public.clients%rowtype;
  before_tags uuid[];
  next_tags uuid[];
  patch jsonb;
  team_moves boolean;
  before_fields jsonb;
  changed jsonb := '[]'::jsonb;
  skipped integer := 0;
  unchanged integer := 0;
begin
  if auth.uid() is null or active_tenant is null or active_role is null then
    raise exception 'sign in to change clients'
      using errcode = '42501';
  end if;

  if p_edits is null or jsonb_typeof(p_edits) <> 'array' then
    raise exception 'client edits must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_edits) > 500 then
    raise exception 'too many clients in one edit'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_edits) item
     where jsonb_typeof(item) <> 'object'
        or not (item ? 'id')
        or exists (
          select 1
            from jsonb_object_keys(item) key
           where key not in ('id', 'add_tags', 'remove_tags', 'tag_ids',
                             'team_id', 'acquisition_source')
        )
        or exists (
          select 1
            from unnest(array['add_tags', 'remove_tags', 'tag_ids']) f(field)
           where item ? f.field
             and jsonb_typeof(item -> f.field) <> 'array'
        )
  ) then
    raise exception 'client edit contains an unknown field'
      using errcode = '22023';
  end if;

  for edit in select value from jsonb_array_elements(p_edits) loop
    edit_client := (edit ->> 'id')::uuid;

    select client.*
      into current_row
      from public.clients client
     where client.id = edit_client
       and client.tenant_id = active_tenant
       and client.deleted_at is null;

    if not found then
      skipped := skipped + 1;
      continue;
    end if;

    -- Набор тегов в его порядке: первый — главный, добавленные встают в конец.
    select coalesce(
             array_agg(assignment.tag_id order by assignment.position, assignment.tag_id),
             array[]::uuid[]
           )
      into before_tags
      from public.client_tag_assignments assignment
     where assignment.tenant_id = active_tenant
       and assignment.client_id = edit_client;

    next_tags := null;
    if edit ? 'tag_ids' then
      select coalesce(array_agg(value::uuid order by ord), array[]::uuid[])
        into next_tags
        from jsonb_array_elements_text(edit -> 'tag_ids') with ordinality supplied(value, ord);
    elsif edit ? 'add_tags' or edit ? 'remove_tags' then
      next_tags := before_tags || coalesce((
        select array_agg(value::uuid order by ord)
          from jsonb_array_elements_text(coalesce(edit -> 'add_tags', '[]'::jsonb))
                 with ordinality supplied(value, ord)
         where not (value::uuid = any(before_tags))
      ), array[]::uuid[]);
      next_tags := coalesce((
        select array_agg(kept.tag_id order by kept.ord)
          from unnest(next_tags) with ordinality kept(tag_id, ord)
         where not exists (
           select 1
             from jsonb_array_elements_text(coalesce(edit -> 'remove_tags', '[]'::jsonb)) gone(value)
            where gone.value::uuid = kept.tag_id
         )
      ), array[]::uuid[]);
    end if;
    if next_tags is not null and next_tags = before_tags then
      next_tags := null;
    end if;

    patch := '{}'::jsonb;
    if edit ? 'acquisition_source'
       and (edit ->> 'acquisition_source') is distinct from current_row.acquisition_source then
      patch := jsonb_build_object('acquisition_source', edit -> 'acquisition_source');
    end if;

    team_moves := edit ? 'team_id'
      and (edit ->> 'team_id') is distinct from current_row.team_id;

    if next_tags is null and patch = '{}'::jsonb and not team_moves then
      unchanged := unchanged + 1;
      continue;
    end if;

    before_fields := '{}'::jsonb;
    if next_tags is not null then
      before_fields := before_fields || jsonb_build_object('tag_ids', to_jsonb(before_tags));
    end if;
    if patch ? 'acquisition_source' then
      before_fields := before_fields
        || jsonb_build_object('acquisition_source', current_row.acquisition_source);
    end if;
    if team_moves then
      before_fields := before_fields || jsonb_build_object('team_id', current_row.team_id);
    end if;

    -- Клиент — отдельной точкой отката: отказ двери снимает только его правку.
    begin
      if team_moves then
        perform public.set_client_team(edit_client, edit ->> 'team_id');
      end if;
      if next_tags is not null or patch <> '{}'::jsonb then
        perform public.update_client_with_tags(active_tenant, edit_client, patch, next_tags);
      end if;
      changed := changed || jsonb_build_array(
        jsonb_build_object('id', edit_client, 'before', before_fields)
      );
    exception
      when sqlstate '42501' or sqlstate 'P0002' or sqlstate '23503' then
        skipped := skipped + 1;
    end;
  end loop;

  return jsonb_build_object(
    'changed', changed,
    'skipped', skipped,
    'unchanged', unchanged
  );
end;
$function$;

revoke all on function public.bulk_edit_clients(jsonb) from public, anon;
grant execute on function public.bulk_edit_clients(jsonb) to authenticated;

do $guard$
begin
  if has_function_privilege('anon', 'public.bulk_edit_clients(jsonb)', 'execute') then
    raise exception 'bulk_edit_clients must not be callable without sign-in';
  end if;
end;
$guard$;
