-- МЁРТВЫЕ ВЕТКИ ПРАВ КЛИЕНТОВ (аудит 035, №41 / R-11).
--
-- Две ветки проверок прав не срабатывали ни у кого, а читатель принимает их
-- за живые правила:
--   • «Номер — в день записи». Блок «Телефон» (`clients.contacts`) снят из
--     реестра 03.10: клиент на «Видит» отдаётся с номером сразу. Ступень
--     `day` искать не в чем — `access_day_contact_teams` всегда пуста, а с ней
--     и `access_day_contact_client_ids`. Пять дверей номера
--     (`list_master_clients_safe`, `list_member_clients_rows`,
--     `member_find_client_by_phone`, `member_client_contacts`,
--     `sms_send_manual`) теряют ветку «в день записи», обе функции удаляются.
--     Ответ `contacts_hidden = 'day'` сервер не отдавал и раньше.
--   • «Сотрудник меняет клиента целиком». `current_user_can_edit_client` и
--     `set_client_team` спрашивали `access_calendars('clients', 'write')`, а у
--     блока «Клиенты» ступеней только «Скрыт / Видит» — для не-владельца это
--     всегда пусто. Команду клиента меняет только владелец, так и записано;
--     отписка от SMS — по-прежнему владелец или «SMS: Меняет».
-- Ответы для всех людей прежние: ветки удаляются, правила не меняются.
-- Тела дверей правятся по якорям в живых определениях.

create or replace function public.current_user_can_edit_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- У блока «Клиенты» нет ступени «Меняет»: права сотрудника на карточку —
  -- поблочные, а клиента целиком (его команду) меняет только владелец.
  select coalesce(public.current_user_role() = 'owner', false)
     and exists (
       select 1
         from public.clients c
        where c.id = p_client_id
          and c.tenant_id = public.current_tenant_id()
     )
$function$;

do $migration$
declare
  d text := pg_get_functiondef('public.set_client_team(uuid, text)'::regprocedure);
  anchor constant text := E'  -- Сотрудник переводит клиента только в команду, где ему можно менять\n'
    || E'  -- клиентов: иначе он отдал бы клиента туда, где сам его больше не увидит.\n'
    || E'  if active_role <> ''owner''\n'
    || E'     and (p_team_id = any(public.access_calendars(''clients'', ''write''))) is not true then\n'
    || E'    raise exception ''an employee can move a client only into a team where they change clients''\n'
    || E'      using errcode = ''42501'', hint = ''block:clients'';\n'
    || E'  end if;\n'
    || E'\n';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'set_client_team: якорь проверки команды сотрудника не найден ровно один раз';
  end if;
  execute replace(d, anchor, '');
end;
$migration$;

do $migration$
declare
  d text := pg_get_functiondef('public.list_master_clients_safe(uuid)'::regprocedure);
  a1 constant text := E'    select public.access_contact_client_ids() || public.access_day_contact_client_ids() as open_ids,\n'
    || E'           public.access_client_ids_in(public.access_day_contact_teams()) as day_ids,\n';
  r1 constant text := E'    select public.access_contact_client_ids() as open_ids,\n';
  a2 constant text := E'      when c.id = any(cs.day_ids) then ''day''\n';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'list_master_clients_safe: якоря ветки «в день записи» не найдены ровно один раз';
  end if;
  execute replace(replace(d, a1, r1), a2, '');
end;
$migration$;

do $migration$
declare
  d text := pg_get_functiondef('public.list_member_clients_rows(uuid)'::regprocedure);
  a1 constant text := E'  day_ids uuid[] := array[]::uuid[];\n';
  a2 constant text := E'  open_ids := public.access_contact_client_ids() || public.access_day_contact_client_ids();\n'
    || E'  day_ids := public.access_client_ids_in(public.access_day_contact_teams());\n';
  r2 constant text := E'  open_ids := public.access_contact_client_ids();\n';
  a3 constant text := E'               when c.id = any(day_ids) then ''day''\n';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1
     or (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1 then
    raise exception 'list_member_clients_rows: якоря ветки «в день записи» не найдены ровно один раз';
  end if;
  execute replace(replace(replace(d, a1, ''), a2, r2), a3, '');
end;
$migration$;

do $migration$
declare
  d text := pg_get_functiondef('public.member_find_client_by_phone(text, text)'::regprocedure);
  a1 constant text := E'  is_day boolean;\n';
  a2 constant text := E'  -- записи (`list_master_clients_safe`): «Клиент» и «В день записи».\n';
  r2 constant text := E'  -- записи (`list_master_clients_safe`): блок «Клиент».\n';
  a3 constant text := E'    or hit.id = any(public.access_contact_client_ids() || public.access_day_contact_client_ids());\n'
    || E'  is_day := not is_open\n'
    || E'    and hit.id = any(public.access_client_ids_in(public.access_day_contact_teams()));\n';
  r3 constant text := E'    or hit.id = any(public.access_contact_client_ids());\n';
  a4 constant text := E'      when is_day then ''day''\n';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1
     or (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1
     or (length(d) - length(replace(d, a4, ''))) / length(a4) <> 1 then
    raise exception 'member_find_client_by_phone: якоря ветки «в день записи» не найдены ровно один раз';
  end if;
  execute replace(replace(replace(replace(d, a1, ''), a2, r2), a3, r3), a4, '');
end;
$migration$;

do $migration$
declare
  d text := pg_get_functiondef('public.member_client_contacts(uuid)'::regprocedure);
  anchor constant text := E'  if p_client = any(public.access_contact_client_ids())\n'
    || E'     or p_client = any(public.access_day_contact_client_ids()) then\n'
    || E'    state := ''open'';\n'
    || E'  elsif p_client = any(public.access_client_ids_in(public.access_day_contact_teams())) then\n'
    || E'    state := ''day'';\n'
    || E'  else\n';
  replacement constant text := E'  if p_client = any(public.access_contact_client_ids()) then\n'
    || E'    state := ''open'';\n'
    || E'  else\n';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'member_client_contacts: якорь ветки «в день записи» не найден ровно один раз';
  end if;
  execute replace(d, anchor, replacement);
end;
$migration$;

do $migration$
declare
  d text := pg_get_functiondef('public.sms_send_manual(uuid, uuid, text, text, text, text)'::regprocedure);
  anchor constant text := E'       and not (v_client = any(public.access_contact_client_ids())\n'
    || E'                or v_client = any(public.access_day_contact_client_ids())) then\n';
  replacement constant text := E'       and not (v_client = any(public.access_contact_client_ids())) then\n';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'sms_send_manual: якорь ветки «в день записи» не найден ровно один раз';
  end if;
  execute replace(d, anchor, replacement);
end;
$migration$;

drop function public.access_day_contact_client_ids();
drop function public.access_day_contact_teams();

do $guard$
declare
  leftover text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into leftover
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.prosrc like '%access_day_contact%'
      or p.prosrc like '%access_calendars(''clients'', ''write'')%';
  if leftover is not null then
    raise exception 'мёртвые ветки прав клиентов остались в: %', leftover;
  end if;
  if has_function_privilege('anon', 'public.current_user_can_edit_client(uuid)', 'execute') then
    raise exception 'current_user_can_edit_client снова исполним для anon';
  end if;
end;
$guard$;
