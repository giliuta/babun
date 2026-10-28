-- КЛИЕНТ — ТОЛЬКО В ЖИВОЙ КОМАНДЕ (страница клиентов, от 035·2).
--
-- `set_client_team` сверял лишь то, что команда — из этой компании: клиента
-- можно было перевести в архивный календарь. Там его не видит ни один партнёр
-- (архив закрыт целиком), а метка, теги и источник оставались бы от
-- прежней команды. Теперь архивная команда отбивается (`client:team_inactive`)
-- — и у функции (её же зовёт массовая правка), и у самой строки клиента:
-- `create_client_with_tags` и прямая правка владельца тоже не заводят и не
-- переводят клиента в архив. Клиенты, которые уже стоят в архивном календаре,
-- остаются как есть: судится только смена команды.
--
-- Тела правятся по якорям в живых определениях.

do $migration$
declare
  d text := pg_get_functiondef('public.set_client_team(uuid, text)'::regprocedure);
  anchor constant text := E'    raise exception ''client team does not belong to the active tenant''\n'
    || E'      using errcode = ''23503'';\n'
    || E'  end if;\n';
  replacement constant text := anchor
    || E'  if not exists (\n'
    || E'    select 1 from public.teams team\n'
    || E'     where team.tenant_id = active_tenant\n'
    || E'       and team.id = p_team_id\n'
    || E'       and team.is_active\n'
    || E'  ) then\n'
    || E'    raise exception ''client team is archived''\n'
    || E'      using errcode = ''22023'', hint = ''client:team_inactive'';\n'
    || E'  end if;\n';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'set_client_team: якорь проверки команды не найден ровно один раз';
  end if;
  execute replace(d, anchor, replacement);
end;
$migration$;

do $migration$
declare
  d text := pg_get_functiondef('public.enforce_client_reference_tenant()'::regprocedure);
  anchor constant text := E'  -- Метка, источник и тип объекта — из справочников обслуживающих живых\n'
    || E'  -- команд; чужое новое значение снимается.\n'
    || E'  if public.client_checks_apply() then\n'
    || E'    serving := public.client_serving_teams(new.tenant_id, new.id, new.team_id);\n';
  replacement constant text := E'  -- В архивную команду клиента не заводят и не переводят.\n'
    || E'  if public.client_checks_apply()\n'
    || E'     and new.team_id is not null\n'
    || E'     and (tg_op = ''INSERT'' or new.team_id is distinct from old.team_id)\n'
    || E'     and not exists (\n'
    || E'       select 1 from public.teams t\n'
    || E'        where t.tenant_id = new.tenant_id\n'
    || E'          and t.id = new.team_id\n'
    || E'          and t.is_active\n'
    || E'     ) then\n'
    || E'    raise exception ''client team is archived''\n'
    || E'      using errcode = ''22023'', hint = ''client:team_inactive'';\n'
    || E'  end if;\n'
    || E'\n'
    || anchor;
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'enforce_client_reference_tenant: якорь сверки не найден ровно один раз';
  end if;
  execute replace(d, anchor, replacement);
end;
$migration$;

drop trigger clients_enforce_reference_tenant on public.clients;
create trigger clients_enforce_reference_tenant
  before insert or update of tenant_id, team_id, referred_by_client_id, favorite_master_id, city, acquisition_source, locations
  on public.clients
  for each row execute function public.enforce_client_reference_tenant();

do $guard$
begin
  if position('client:team_inactive' in pg_get_functiondef('public.set_client_team(uuid, text)'::regprocedure)) = 0
     or position('client:team_inactive' in pg_get_functiondef('public.enforce_client_reference_tenant()'::regprocedure)) = 0 then
    raise exception 'перевод в архивную команду снова не отбивается';
  end if;
  if position('team_id' in (select pg_get_triggerdef(oid) from pg_trigger where tgname = 'clients_enforce_reference_tenant')) = 0 then
    raise exception 'триггер клиента не будится сменой команды';
  end if;
end;
$guard$;
