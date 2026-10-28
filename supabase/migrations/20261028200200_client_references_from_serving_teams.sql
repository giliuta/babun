-- У КЛИЕНТА — ТОЛЬКО СВОЁ: ТЕГ, МЕТКА, ИСТОЧНИК, ТИП ОБЪЕКТА, «ЛЮДИ»
-- (P0 «изоляция клиентов»).
--
-- Сервер сверял у клиента только компанию: тег, «Людей», метку, источник и
-- тип объекта другой команды той же компании он пропускал — даже от партнёра
-- в «Людях», а от владельца во всём. Защитой была одна шторка выбора. Теперь
-- значение — из ОБСЛУЖИВАЮЩИХ ЖИВЫХ команд клиента: его команда и команды его
-- записей (`client_serving_teams`; архивный календарь — не обслуживающий),
-- и у владельца тоже.
--   • Тег и «Люди» выбираются из списка — чужое отбивается
--     (`client:tag_other_team`, `client:people_other_team`).
--   • Метка, источник и тип объекта хранятся текстом (метка и тип — именем) и
--     приходят ещё из импорта и со страницы «Пришлите адрес» — чужое не
--     отбивается, а снимается: метка и тип пустые, источник «не указан».
--     Метка — живая строка справочника (скрытая тоже: её переименование
--     переписывает клиентов), тип объекта — активный.
-- Судим только НОВЫЕ значения: давнее, что уже стоит на клиенте, правку не
-- запирает (уже стоящий тег остаётся, как и прежде для сотрудника).
-- Сверку минуют внутренние ходы без пользователя (миграции, cron, функции
-- сервиса) и две доверенные перезаписи: слияние клиентов переносит теги и
-- «Людей» дубля (после переезда записей его команда и так обслуживающая), а
-- переименование типа объектов переписывает объекты раньше, чем новое имя
-- ляжет в справочник (`babun.client_refs_trusted`).
--
-- Тела `update_client_with_tags`, `merge_clients`,
-- `apply_team_location_label_changes` и `enforce_client_memberships` правятся
-- по якорям в живых определениях.

create or replace function public.client_serving_teams(p_tenant uuid, p_client uuid, p_team text)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(t.id order by t.id), array[]::text[])
    from public.teams t
   where t.tenant_id = p_tenant
     and t.is_active
     and (
       t.id = p_team
       or exists (
         select 1 from public.appointments a
          where a.tenant_id = p_tenant
            and a.client_id = p_client
            and a.team_id = t.id
       )
     )
$function$;

create or replace function public.client_checks_apply()
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(auth.role(), '') in ('authenticated', 'anon')
     and coalesce(current_setting('babun.client_refs_trusted', true), '') <> 'on'
$function$;

revoke execute on function public.client_serving_teams(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.client_checks_apply() from public, anon, authenticated;

create or replace function public.enforce_client_tag_assignment_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1
      from public.clients client
     where client.tenant_id = new.tenant_id
       and client.id = new.client_id
  ) then
    raise exception 'assigned client does not belong to the assignment tenant'
      using errcode = '23503';
  end if;

  if not exists (
    select 1
      from public.client_tags tag
     where tag.tenant_id = new.tenant_id
       and tag.id = new.tag_id
  ) then
    raise exception 'assigned tag does not belong to the assignment tenant'
      using errcode = '23503';
  end if;

  -- Тег — из обслуживающей живой команды клиента. Набор из
  -- `update_client_with_tags` уже сверен там (с уже стоящими тегами).
  if public.client_checks_apply()
     and (tg_op = 'INSERT' or new.tag_id is distinct from old.tag_id or new.client_id is distinct from old.client_id)
     and coalesce(current_setting('babun.client_tags_checked', true), '') is distinct from new.client_id::text
     and not exists (
       select 1
         from public.client_tags tag
         join public.clients client
           on client.tenant_id = new.tenant_id
          and client.id = new.client_id
        where tag.tenant_id = new.tenant_id
          and tag.id = new.tag_id
          and tag.team_id = any(public.client_serving_teams(new.tenant_id, new.client_id, client.team_id))
     ) then
    raise exception 'client tag belongs to another team'
      using errcode = '23503', hint = 'client:tag_other_team';
  end if;

  return new;
end;
$function$;

create or replace function public.enforce_client_reference_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  serving text[];
begin
  if new.referred_by_client_id is not null then
    if new.referred_by_client_id = new.id then
      raise exception 'client cannot refer itself'
        using errcode = '23514';
    end if;
    if not exists (
      select 1
        from public.clients referrer
       where referrer.tenant_id = new.tenant_id
         and referrer.id = new.referred_by_client_id
    ) then
      raise exception 'referring client does not belong to the client tenant'
        using errcode = '23503';
    end if;
  end if;

  if new.favorite_master_id is not null and not exists (
    select 1
      from public.masters master
     where master.tenant_id = new.tenant_id
       and master.id = new.favorite_master_id
  ) then
    raise exception 'favorite master does not belong to the client tenant'
      using errcode = '23503';
  end if;

  -- Метка, источник и тип объекта — из справочников обслуживающих живых
  -- команд; чужое новое значение снимается.
  if public.client_checks_apply() then
    serving := public.client_serving_teams(new.tenant_id, new.id, new.team_id);

    if new.city <> ''
       and (tg_op = 'INSERT' or new.city is distinct from old.city)
       and not exists (
         select 1 from public.cities c
          where c.tenant_id = new.tenant_id
            and c.name = new.city
            and c.deleted_at is null
            and c.team_id = any(serving)
       ) then
      new.city := '';
      new.city_manual := false;
    end if;

    if new.acquisition_source like 'src:%'
       and (tg_op = 'INSERT' or new.acquisition_source is distinct from old.acquisition_source)
       and not exists (
         select 1 from public.client_sources s
          where s.tenant_id = new.tenant_id
            and 'src:' || s.id::text = new.acquisition_source
            and s.team_id = any(serving)
       ) then
      new.acquisition_source := 'unknown';
    end if;

    if jsonb_typeof(new.locations) = 'array'
       and (tg_op = 'INSERT' or new.locations is distinct from old.locations) then
      new.locations := coalesce((
        select jsonb_agg(
                 case
                   when coalesce(l.value ->> 'label', '') = '' then l.value
                   -- Тот же тип у того же объекта — давнее, не судим.
                   when tg_op = 'UPDATE' and exists (
                     select 1
                       from jsonb_array_elements(
                              case when jsonb_typeof(old.locations) = 'array' then old.locations else '[]'::jsonb end
                            ) o
                      where o.value ->> 'id' = l.value ->> 'id'
                        and o.value ->> 'label' = l.value ->> 'label'
                   ) then l.value
                   when exists (
                     select 1 from public.location_labels ll
                      where ll.tenant_id = new.tenant_id
                        and ll.is_active
                        and lower(btrim(ll.name)) = lower(btrim(l.value ->> 'label'))
                        and ll.team_id = any(serving)
                   ) then l.value
                   else l.value || jsonb_build_object('label', '')
                 end
                 order by l.ordinality)
          from jsonb_array_elements(new.locations) with ordinality as l(value, ordinality)
      ), '[]'::jsonb);
    end if;
  end if;

  return new;
end;
$function$;

-- Триггер стоял только на «Кто привёл», мастера и компанию: правка одних
-- объектов (страница «Пришлите адрес») его не будила.
drop trigger clients_enforce_reference_tenant on public.clients;
create trigger clients_enforce_reference_tenant
  before insert or update of tenant_id, referred_by_client_id, favorite_master_id, city, acquisition_source, locations
  on public.clients
  for each row execute function public.enforce_client_reference_tenant();

do $migration$
declare
  d text := pg_get_functiondef('public.enforce_client_memberships()'::regprocedure);
  anchor constant text := E'  -- Одна связь на карточку И МЕСТО, роль — обрезанный текст, лишних ключей нет;\n';
  replacement constant text := E'  -- «Люди» — из обслуживающих живых команд клиента, и у владельца тоже: связь\n'
    || E'  -- с человеком чужого календаря открыла бы его имя людям этой команды.\n'
    || E'  -- Судим только новые связи.\n'
    || E'  if public.client_checks_apply() and jsonb_array_length(new.memberships) > 0 then\n'
    || E'    if tg_op = ''UPDATE'' then\n'
    || E'      select coalesce(array_agg(distinct m.value ->> ''group_id''), array[]::text[])\n'
    || E'        into kept\n'
    || E'        from jsonb_array_elements(coalesce(old.memberships, ''[]''::jsonb)) m;\n'
    || E'    else\n'
    || E'      kept := array[]::text[];\n'
    || E'    end if;\n'
    || E'    if exists (\n'
    || E'      select 1\n'
    || E'        from jsonb_array_elements(new.memberships) m\n'
    || E'        join public.clients g\n'
    || E'          on g.id::text = m.value ->> ''group_id''\n'
    || E'         and g.tenant_id = new.tenant_id\n'
    || E'       where not (m.value ->> ''group_id'' = any(kept))\n'
    || E'         and not (g.team_id = any(public.client_serving_teams(new.tenant_id, new.id, new.team_id)))\n'
    || E'    ) then\n'
    || E'      raise exception ''client memberships must point to clients of the serving teams''\n'
    || E'        using errcode = ''42501'', hint = ''client:people_other_team'';\n'
    || E'    end if;\n'
    || E'  end if;\n'
    || E'\n'
    || anchor;
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'enforce_client_memberships: якорь не найден ровно один раз';
  end if;
  execute replace(d, anchor, replacement);
end;
$migration$;

do $migration$
declare
  d text := pg_get_functiondef('public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'::regprocedure);
  a1 constant text := E'      raise exception ''client tag belongs to another team''\n'
    || E'        using errcode = ''23503'', hint = ''client:tag_other_team'';\n'
    || E'    end if;\n'
    || E'  end if;\n';
  r1 constant text := E'      raise exception ''client tag belongs to another team''\n'
    || E'        using errcode = ''23503'', hint = ''client:tag_other_team'';\n'
    || E'    end if;\n'
    || E'    -- И у владельца: только теги обслуживающих живых команд клиента (его\n'
    || E'    -- команда и команды его записей). Тег, который уже стоит, остаётся.\n'
    || E'    if public.client_checks_apply() and exists (\n'
    || E'      select 1\n'
    || E'        from unnest(result_tag_ids) supplied(tag_id)\n'
    || E'        join public.client_tags tag\n'
    || E'          on tag.tenant_id = active_tenant_id\n'
    || E'         and tag.id = supplied.tag_id\n'
    || E'       where not (tag.team_id = any(public.client_serving_teams(active_tenant_id, p_client_id, current_row.team_id)))\n'
    || E'         and not exists (\n'
    || E'           select 1\n'
    || E'             from public.client_tag_assignments assignment\n'
    || E'            where assignment.tenant_id = active_tenant_id\n'
    || E'              and assignment.client_id = p_client_id\n'
    || E'              and assignment.tag_id = supplied.tag_id\n'
    || E'         )\n'
    || E'    ) then\n'
    || E'      raise exception ''client tag belongs to another team''\n'
    || E'        using errcode = ''23503'', hint = ''client:tag_other_team'';\n'
    || E'    end if;\n'
    || E'  end if;\n';
  a2 constant text := E'  if p_tag_ids is not null then\n'
    || E'    delete from public.client_tag_assignments assignment\n';
  r2 constant text := E'  if p_tag_ids is not null then\n'
    || E'    -- Набор сверен выше — триггер привязки его не перепроверяет.\n'
    || E'    perform set_config(''babun.client_tags_checked'', p_client_id::text, true);\n'
    || E'    delete from public.client_tag_assignments assignment\n';
  a3 constant text := E'      from unnest(result_tag_ids) with ordinality supplied(tag_id, ord);\n'
    || E'  else\n';
  r3 constant text := E'      from unnest(result_tag_ids) with ordinality supplied(tag_id, ord);\n'
    || E'    perform set_config(''babun.client_tags_checked'', '''', true);\n'
    || E'  else\n';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1
     or (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1 then
    raise exception 'update_client_with_tags: якоря сверки тегов не найдены ровно один раз';
  end if;
  execute replace(replace(replace(d, a1, r1), a2, r2), a3, r3);
end;
$migration$;

do $migration$
declare
  d text := pg_get_functiondef('public.merge_clients(uuid, uuid, jsonb, uuid[], jsonb)'::regprocedure);
  a1 constant text := E'  -- 1. Основная карточка: те же поля и проверки, что у обычной правки.\n';
  r1 constant text := E'  -- Слияние переносит теги, метку и «Людей» дубля; после переезда записей\n'
    || E'  -- его команда — обслуживающая, сверка справочников здесь не нужна.\n'
    || E'  perform set_config(''babun.client_refs_trusted'', ''on'', true);\n'
    || E'\n'
    || a1;
  a2 constant text := E'  return jsonb_build_object(\n'
    || E'    ''visits'', moved_visits,\n';
  r2 constant text := E'  perform set_config(''babun.client_refs_trusted'', '''', true);\n'
    || a2;
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'merge_clients: якоря доверенной перезаписи не найдены ровно один раз';
  end if;
  execute replace(replace(d, a1, r1), a2, r2);
end;
$migration$;

do $migration$
declare
  d text := pg_get_functiondef('public.apply_team_location_label_changes(text, jsonb, jsonb)'::regprocedure);
  a1 constant text := E'  for renamed in\n';
  r1 constant text := E'  -- Объекты переписываются раньше, чем новое имя ляжет в справочник ниже.\n'
    || E'  perform set_config(''babun.client_refs_trusted'', ''on'', true);\n'
    || a1;
  a2 constant text := E'  end loop;\n'
    || E'\n'
    || E'  update public.location_labels l\n';
  r2 constant text := E'  end loop;\n'
    || E'  perform set_config(''babun.client_refs_trusted'', '''', true);\n'
    || E'\n'
    || E'  update public.location_labels l\n';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'apply_team_location_label_changes: якоря переименования не найдены ровно один раз';
  end if;
  execute replace(replace(d, a1, r1), a2, r2);
end;
$migration$;

do $guard$
begin
  if position('client_serving_teams' in pg_get_functiondef('public.enforce_client_tag_assignment_tenant()'::regprocedure)) = 0
     or position('client_serving_teams' in pg_get_functiondef('public.enforce_client_reference_tenant()'::regprocedure)) = 0
     or position('client_serving_teams' in pg_get_functiondef('public.enforce_client_memberships()'::regprocedure)) = 0
     or position('client_serving_teams' in pg_get_functiondef('public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'::regprocedure)) = 0 then
    raise exception 'сверка обслуживающих команд записана не везде';
  end if;
  if position('babun.client_refs_trusted' in pg_get_functiondef('public.merge_clients(uuid, uuid, jsonb, uuid[], jsonb)'::regprocedure)) = 0
     or position('babun.client_refs_trusted' in pg_get_functiondef('public.apply_team_location_label_changes(text, jsonb, jsonb)'::regprocedure)) = 0 then
    raise exception 'доверенные перезаписи не помечены';
  end if;
  if position('locations' in (select pg_get_triggerdef(oid) from pg_trigger where tgname = 'clients_enforce_reference_tenant')) = 0 then
    raise exception 'триггер справочников клиента не будится правкой объектов';
  end if;
  if has_function_privilege('authenticated', 'public.client_serving_teams(uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.client_checks_apply()', 'execute') then
    raise exception 'помощники сверки исполнимы снаружи';
  end if;
end;
$guard$;
