-- «УДАЛЁННЫЕ ЗАПИСИ»: СНИМОК ЧИТАЕТСЯ ТОЛЬКО ДВЕРЬЮ И С МАСКОЙ ПРАВ.
--
-- Ящик хранит строку записи целиком (`appointment` — to_jsonb строки) и всё,
-- что ушло вместе с ней (`dependents`). Денег на удалённой записи нет — их
-- держит сторож удаления, — но цена в снимке есть: итог, цены услуг, скидка;
-- а ещё клиент, адрес и заметка. Прочитанный напрямую под RLS ящика, снимок
-- отдавал сотруднику всё это мимо его блоков — живую запись он видит только
-- через маску `list_master_appointments_safe`. И `dependents` нёс токены:
-- `appointment_links.token` (ссылка клиента на подтверждение) и
-- `master_rating_tokens.token` (оценка мастера) — их строки приложению не
-- читаются вовсе, а токен ссылки сам по себе даёт клиентский доступ к записи.
--
-- Теперь:
--   1. Колонки `appointment` и `dependents` приложению закрыты (права на
--      колонки). Открытыми остаются служебные поля строки — по ним работают
--      RLS, «Удалить насовсем» и «Вернуть» (`delete … where id`).
--   2. Список ящика — `list_deleted_appointments(p_team_id)`, definer, с теми
--      же условиями видимости, что у RLS ящика (`deleted_appointment_visible`
--      повторяет политику `deleted_appointments_select` дословно):
--        • владелец — снимок как есть;
--        • диспетчер — как есть там, где он видит живые записи календаря
--          (`appointments_select`: без галочек календарей — все, с галочками —
--          календари «Смотреть»); где не видит — строки нет;
--        • сотрудник — снимок через ту же маску блоков, что у его календаря:
--          тело маски берётся из живого `list_master_appointments_safe` при
--          накате (`deleted_appointment_member_view`), а не пишется второй раз.
--      Из `dependents` наружу уходят только пути фото — их стирает «Удалить
--      насовсем». Токены не уходят никому, владельцу тоже: экрану они не нужны.
--   3. «Вернуть» владельца и диспетчера (`restore_deleted_appointment`, от лица
--      звонящего) берёт снимок дверью `deleted_appointment_for_restore` — с
--      теми же условиями и без `dependents`; вставка по-прежнему идёт под
--      политикой создания записи. Дверь сотрудника (`member_appointment_restore`)
--      — definer, права на колонки её не касаются.
--
-- `restore_deleted_appointment` правится точечной заменой в живом теле (якорь
-- обязан встретиться ровно один раз): соседние миграции того же дня могли
-- дописать в неё своё, и полная замена молча откатила бы их правку.

set local lock_timeout = '5s';

-- ─── 1. Видимость ящика — та же, что у RLS ───

create function public.deleted_appointment_visible(d public.deleted_appointments)
returns boolean
language sql
stable
set search_path = public
as $function$
  select d.tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (
        d.deleted_by = (select auth.uid())
        and (d.kind = 'work' or d.created_by = (select auth.uid()))
        and (
          ((select public.current_user_role()) = 'dispatcher'
            and not (select public.current_user_has_calendar_grants()))
          or d.team_id in (select unnest(public.current_user_calendar_ids('edit_all')))
          or ((select public.current_user_role()) = 'master'
            and (
              (d.kind = 'work'
                and d.team_id in (select unnest(public.access_calendars('calendar.cancel', 'write'))))
              or (d.kind <> 'work'
                and d.team_id in (select unnest(public.access_calendars('calendar.events', 'write'))))
            ))
        )
      )
    )
$function$;

-- Снимок без маски — тому, кто видит эту запись живой строкой целиком:
-- владельцу и диспетчеру в календарях, которые ему видны (`appointments_select`).
create function public.deleted_appointment_snapshot_open(d public.deleted_appointments)
returns boolean
language sql
stable
set search_path = public
as $function$
  select (select public.current_user_role()) = 'owner'
      or ((select public.current_user_role()) = 'dispatcher'
        and (
          not (select public.current_user_has_calendar_grants())
          or d.team_id in (select unnest(public.current_user_calendar_ids('view')))
        ))
$function$;

-- ─── 2. Маска сотрудника — тело его календаря ───

-- Проекция строки записи для сотрудника — дословно из живого
-- `list_master_appointments_safe`: от `with me as materialized (` до его
-- `where`. Меняется одно: строка берётся не из таблицы, а из параметра.
-- Права (`me`) считаются от звонящего, как в календаре; отбор строк здесь не
-- нужен — что видно в ящике, решает его видимость.
do $build$
declare
  src text := pg_get_functiondef('public.list_master_appointments_safe(integer, integer)'::regprocedure);
  head constant text := E'  with me as materialized (\n';
  tail constant text := E'\n   where me.role = ''master''\n';
  source_row constant text := E'    from public.appointments a\n    cross join me\n';
  param_row constant text := E'    from (select (p_appointment).*) a\n    cross join me\n';
  body text;
begin
  if (length(src) - length(replace(src, head, ''))) / length(head) <> 1
     or (length(src) - length(replace(src, tail, ''))) / length(tail) <> 1
     or (length(src) - length(replace(src, source_row, ''))) / length(source_row) <> 1 then
    raise exception 'list_master_appointments_safe: якоря маски не найдены ровно один раз — пересоберите миграцию от живого тела';
  end if;
  body := substr(src, position(head in src), position(tail in src) - position(head in src));
  body := replace(body, source_row, param_row);
  execute format(
    'create function public.deleted_appointment_member_view(p_appointment public.appointments) '
    'returns jsonb language sql stable set search_path = public as %L',
    body
  );
end
$build$;

comment on function public.deleted_appointment_member_view(public.appointments) is
  'Снимок удалённой записи глазами сотрудника: проекция и маска блоков из list_master_appointments_safe на момент наката. Меняешь маску календаря сотрудника — пересобери и эту.';

-- ─── 3. Двери ───

create function public.list_deleted_appointments(p_team_id text default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
    'id', d.id,
    'team_id', d.team_id,
    'kind', d.kind,
    'created_by', d.created_by,
    'deleted_at', d.deleted_at,
    'purge_at', d.purge_at,
    'deleted_by', d.deleted_by,
    -- Пути фото — для «Удалить насовсем»; токены ссылки и оценки не уходят.
    'photo_paths', jsonb_path_query_array(
      d.dependents, '$.photos[*].storage_path ? (@.type() == "string")'
    ),
    'appointment', case
      when public.deleted_appointment_snapshot_open(d) then d.appointment
      else public.deleted_appointment_member_view(
        jsonb_populate_record(null::public.appointments, d.appointment)
      )
    end
  )
    from public.deleted_appointments d
   where public.deleted_appointment_visible(d)
     and (public.deleted_appointment_snapshot_open(d)
          or (select public.current_user_role()) = 'master')
     and (p_team_id is null or d.team_id = p_team_id)
   order by d.deleted_at desc, d.id
$function$;

-- Снимок для «Вернуть» владельца и диспетчера: строка ящика без
-- `dependents` (их возвращает триггер ящика сам), только тому, кто видит
-- запись целиком. Сотрудник возвращает своей дверью.
create function public.deleted_appointment_for_restore(p_id uuid)
returns setof public.deleted_appointments
language sql
stable
security definer
set search_path = public
as $function$
  select d.id, d.tenant_id, d.team_id, d.kind, d.created_by, d.appointment,
         '{}'::jsonb, d.deleted_by, d.deleted_at, d.purge_at
    from public.deleted_appointments d
   where d.id = p_id
     and public.deleted_appointment_visible(d)
     and public.deleted_appointment_snapshot_open(d)
$function$;

do $patch$
declare
  fn constant regprocedure := 'public.restore_deleted_appointment(uuid)'::regprocedure;
  body text := pg_get_functiondef(fn);
  anchor constant text := E'  -- Видит ли звонящий снимок — решает RLS ящика.\n  select * into trashed from public.deleted_appointments where id = p_id;\n';
  replacement constant text := E'  -- Видит ли звонящий снимок — те же условия, что у RLS ящика; колонки\n  -- снимка приложению закрыты, их отдаёт дверь.\n  select * into trashed from public.deleted_appointment_for_restore(p_id);\n';
begin
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'restore_deleted_appointment: якорь чтения снимка не найден ровно один раз';
  end if;
  execute replace(body, anchor, replacement);
end
$patch$;

-- ─── 4. Права ───

revoke select on table public.deleted_appointments from authenticated;
grant select (id, tenant_id, team_id, kind, created_by, deleted_by, deleted_at, purge_at)
  on table public.deleted_appointments to authenticated;

revoke all on function public.deleted_appointment_visible(public.deleted_appointments) from public, anon, authenticated;
revoke all on function public.deleted_appointment_snapshot_open(public.deleted_appointments) from public, anon, authenticated;
revoke all on function public.deleted_appointment_member_view(public.appointments) from public, anon, authenticated;
revoke all on function public.list_deleted_appointments(text) from public, anon;
revoke all on function public.deleted_appointment_for_restore(uuid) from public, anon;
grant execute on function public.list_deleted_appointments(text) to authenticated;
-- «Вернуть» исполняется от лица звонящего и зовёт эту дверь сам.
grant execute on function public.deleted_appointment_for_restore(uuid) to authenticated;

-- ─── 5. Сторож ───

do $guard$
declare
  entry text;
begin
  foreach entry in array array['appointment', 'dependents'] loop
    if has_column_privilege('authenticated', 'public.deleted_appointments', entry, 'select')
       or has_column_privilege('anon', 'public.deleted_appointments', entry, 'select') then
      raise exception 'сторож: колонка % ящика записей читается снаружи', entry;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.deleted_appointments', 'id', 'select')
     or not has_table_privilege('authenticated', 'public.deleted_appointments', 'delete') then
    raise exception 'сторож: «Удалить насовсем» потеряло права на ящик';
  end if;

  foreach entry in array array[
    'public.deleted_appointment_visible(public.deleted_appointments)',
    'public.deleted_appointment_snapshot_open(public.deleted_appointments)',
    'public.deleted_appointment_member_view(public.appointments)'
  ] loop
    if has_function_privilege('anon', entry, 'execute')
       or has_function_privilege('authenticated', entry, 'execute') then
      raise exception 'сторож: служебная % исполнима снаружи', entry;
    end if;
  end loop;
  foreach entry in array array[
    'public.list_deleted_appointments(text)', 'public.deleted_appointment_for_restore(uuid)'
  ] loop
    if has_function_privilege('anon', entry, 'execute') then
      raise exception 'сторож: % исполнима без входа', entry;
    end if;
    if not has_function_privilege('authenticated', entry, 'execute') then
      raise exception 'сторож: % закрыта для приложения', entry;
    end if;
  end loop;

  if position('deleted_appointment_for_restore' in (select prosrc from pg_proc where oid = 'public.restore_deleted_appointment(uuid)'::regprocedure)) = 0
     or position('access_calendars(''record.amount'', ''read'')' in (select prosrc from pg_proc where oid = 'public.deleted_appointment_member_view(public.appointments)'::regprocedure)) = 0 then
    raise exception 'сторож: «Вернуть» или маска сотрудника не на месте';
  end if;
end
$guard$;
