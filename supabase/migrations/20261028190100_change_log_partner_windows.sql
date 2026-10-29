-- ИСТОРИЯ ИЗМЕНЕНИЙ — В ТЕХ ЖЕ ОКНАХ, ЧТО И САМИ ТАБЛИЦЫ (пачка 7, С1).
--
-- `list_change_log` открывал партнёру строки записей по «Записям клиентов», а
-- строки клиентов — по блоку «Клиенты» команды, мимо двух окон:
--   • «Окно календаря» (`calendar.window`): запись старше его начала партнёр
--     в календаре не видит (`member_record_hidden`), а в истории видел её
--     дату, время и имя клиента;
--   • «Ограничения» клиентов (`clients.scope`): клиент вне окна не входит в
--     его базу (`access_client_ids`), а в истории было имя каждого
--     изменённого клиента команды — и его тегов и файлов.
-- Теперь строка записи и её фото прячется по тому же началу окна, а строки
-- клиента, его тегов и файлов — если клиента нет в его базе (команда «Без
-- ограничения» открыта целиком, как и в таблице). Владелец и чтение по другим
-- блокам не меняются.
--
-- Тело правится по якорям в живом определении.

do $migration$
declare
  d text := pg_get_functiondef(
    'public.list_change_log(timestamp with time zone, timestamp with time zone, bigint, uuid, integer)'::regprocedure);
  a1 constant text := E'  v_team text;\n';
  r1 constant text := E'  v_team text;\n'
    || E'  v_rec_from jsonb := ''{}''::jsonb;\n'
    || E'  v_scope_all text[] := array[]::text[];\n'
    || E'  v_clients jsonb := ''{}''::jsonb;\n';
  a2 constant text := E'  return query\n'
    || E'    select c.id, c.team_id, c.actor_id, c.actor_name, c.entity, c.entity_id, c.action,\n'
    || E'           case when v_mask then v.shown ->> ''label'' else c.label end,\n';
  r2 constant text := E'  -- Окна те же, что у таблиц: начало «Окна календаря» по команде, команды\n'
    || E'  -- «Без ограничения» и клиенты его базы (ключами — поиск, а не перебор).\n'
    || E'  v_rec_from := public.member_record_window_starts();\n'
    || E'  select coalesce(array_agg(t.team_id), array[]::text[]) into v_scope_all\n'
    || E'    from unnest(public.access_calendars(''clients'', ''read'')) as t(team_id)\n'
    || E'   where coalesce(public.access_team_level(v_tenant, auth.uid(), ''clients.scope'', t.team_id), ''week'') in (''own'', ''all'');\n'
    || E'  select coalesce(jsonb_object_agg(x.id::text, true), ''{}''::jsonb) into v_clients\n'
    || E'    from unnest(public.access_client_ids()) as x(id);\n'
    || E'\n'
    || a2;
  a3 constant text := E'         when ''appointments'' then (c.team_id in (select unnest(public.access_calendars(''calendar.records'', ''read''))))\n';
  r3 constant text := E'         when ''appointments'' then (c.team_id in (select unnest(public.access_calendars(''calendar.records'', ''read''))))\n'
    || E'           and not coalesce(coalesce(c.meta ->> ''kind'', ''work'') = ''work'' and (c.meta ->> ''date'') < (v_rec_from ->> c.team_id), false)\n';
  a4 constant text := E'         when ''appointment_photos'' then (c.team_id in (select unnest(public.access_calendars(''record.files'', ''read''))))\n';
  r4 constant text := E'         when ''appointment_photos'' then (c.team_id in (select unnest(public.access_calendars(''record.files'', ''read''))))\n'
    || E'           and not coalesce(coalesce(c.meta ->> ''kind'', ''work'') = ''work'' and (c.meta ->> ''date'') < (v_rec_from ->> c.team_id), false)\n';
  a5 constant text := E'         when ''clients'' then (c.team_id in (select unnest(public.access_calendars(''clients'', ''read''))))\n';
  r5 constant text := E'         when ''clients'' then (c.team_id in (select unnest(public.access_calendars(''clients'', ''read''))))\n'
    || E'           and (c.team_id = any(v_scope_all) or v_clients ? c.entity_id)\n';
  a6 constant text := E'         when ''client_attachments'' then (c.team_id in (select unnest(public.access_calendars(''clients.files'', ''read''))))\n';
  r6 constant text := E'         when ''client_attachments'' then (c.team_id in (select unnest(public.access_calendars(''clients.files'', ''read''))))\n'
    || E'           and (c.team_id = any(v_scope_all) or v_clients ? (c.meta ->> ''client_id''))\n';
  a7 constant text := E'         when ''client_tag_assignments'' then (c.team_id in (select unnest(public.access_calendars(''clients.tags'', ''read''))))\n';
  r7 constant text := E'         when ''client_tag_assignments'' then (c.team_id in (select unnest(public.access_calendars(''clients.tags'', ''read''))))\n'
    || E'           and (c.team_id = any(v_scope_all) or v_clients ? c.entity_id)\n';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1
     or (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1
     or (length(d) - length(replace(d, a4, ''))) / length(a4) <> 1
     or (length(d) - length(replace(d, a5, ''))) / length(a5) <> 1
     or (length(d) - length(replace(d, a6, ''))) / length(a6) <> 1
     or (length(d) - length(replace(d, a7, ''))) / length(a7) <> 1 then
    raise exception 'list_change_log: якоря окон партнёра не найдены ровно один раз';
  end if;
  execute replace(replace(replace(replace(replace(replace(replace(d,
    a1, r1), a2, r2), a3, r3), a4, r4), a5, r5), a6, r6), a7, r7);
end;
$migration$;

do $guard$
declare
  src text := pg_get_functiondef(
    'public.list_change_log(timestamp with time zone, timestamp with time zone, bigint, uuid, integer)'::regprocedure);
begin
  if (length(src) - length(replace(src, '< (v_rec_from ->> c.team_id)', ''))) / length('< (v_rec_from ->> c.team_id)') <> 2
     or (length(src) - length(replace(src, 'c.team_id = any(v_scope_all) or v_clients ?', ''))) / length('c.team_id = any(v_scope_all) or v_clients ?') <> 3 then
    raise exception 'list_change_log: окна партнёра не записаны';
  end if;
end;
$guard$;
