-- ГОТОВНОСТЬ СНИМКА К «ВЕРНУТЬ» — ТОЛЬКО ДЛЯ СВОЕЙ КОМПАНИИ.
--
-- `deleted_appointment_ready(jsonb)` и `deleted_operation_ready(jsonb)` —
-- definer и исполнимы приложением (их зовут двери «Вернуть»). Снимок они
-- берут из аргумента, и ответ различал «запись с таким id уже есть», «такого
-- календаря нет», «счёт удалён» и молча обнулённые клиента, мастера и
-- категорию. Подставив в снимок чужую компанию и чужие id, можно было узнать,
-- что существует в другой компании.
--
-- Теперь первой строкой: снимок чужой компании — «нет в „Удалённых"», тем же
-- ответом, что у пустого ящика. Звонящие двери — `restore_deleted_appointment`
-- (от лица звонящего), `member_appointment_restore` и `restore_deleted_operation`
-- — передают снимок своей компании: ящик под RLS или с проверкой
-- `current_tenant_id()`; `current_tenant_id()` читает вход и заголовок запроса,
-- и внутри definer он тот же. Без входа (служба, cron) — как раньше.
--
-- Правка — точечная вставка в живые тела, якорь ровно один раз.

set local lock_timeout = '5s';

do $patch$
declare
  fn constant regprocedure := 'public.deleted_appointment_ready(jsonb)'::regprocedure;
  body text := pg_get_functiondef(fn);
  anchor constant text := E'begin\n  if exists (select 1 from public.appointments a where a.id = (p_appointment->>''id'')::uuid) then\n';
  replacement constant text := E'begin\n'
    || E'  -- Снимок чужой компании — как пустой ящик: иначе ответы ниже выдали бы,\n'
    || E'  -- какие id существуют у других.\n'
    || E'  if auth.uid() is not null and tenant is distinct from public.current_tenant_id() then\n'
    || E'    raise exception ''Записи нет в «Удалённых»''\n'
    || E'      using errcode = ''P0002'', hint = ''appointment:not_in_trash'';\n'
    || E'  end if;\n'
    || substr(anchor, length(E'begin\n') + 1);
begin
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'deleted_appointment_ready: якорь не найден ровно один раз';
  end if;
  execute replace(body, anchor, replacement);
end
$patch$;

do $patch$
declare
  fn constant regprocedure := 'public.deleted_operation_ready(jsonb)'::regprocedure;
  body text := pg_get_functiondef(fn);
  anchor constant text := E'begin\n  if account is not null and not exists (\n';
  replacement constant text := E'begin\n'
    || E'  -- Снимок чужой компании — как пустой ящик: иначе ответы ниже выдали бы,\n'
    || E'  -- какие счета и id существуют у других.\n'
    || E'  if auth.uid() is not null\n'
    || E'     and nullif(p_operation->>''tenant_id'', '''')::uuid is distinct from public.current_tenant_id() then\n'
    || E'    raise exception ''Операции нет в «Удалённых»''\n'
    || E'      using errcode = ''P0002'', hint = ''operation:not_in_trash'';\n'
    || E'  end if;\n'
    || substr(anchor, length(E'begin\n') + 1);
begin
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'deleted_operation_ready: якорь не найден ровно один раз';
  end if;
  execute replace(body, anchor, replacement);
end
$patch$;

do $guard$
begin
  if position('current_tenant_id()' in (select prosrc from pg_proc where oid = 'public.deleted_appointment_ready(jsonb)'::regprocedure)) = 0
     or position('current_tenant_id()' in (select prosrc from pg_proc where oid = 'public.deleted_operation_ready(jsonb)'::regprocedure)) = 0 then
    raise exception 'сторож: готовность снимка не сверяет компанию';
  end if;
  -- Ветка «из календаря» у операций осталась на месте.
  if position('from_calendar' in (select prosrc from pg_proc where oid = 'public.deleted_operation_ready(jsonb)'::regprocedure)) = 0 then
    raise exception 'сторож: deleted_operation_ready потеряла from_calendar';
  end if;
end
$guard$;
