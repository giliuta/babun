-- ФУНКЦИИ В ОБХОД RLS ТЕПЕРЬ СЛУШАЮТСЯ ТЕХ ЖЕ ПРАВ, ЧТО И ТАБЛИЦЫ.
--
-- 13.09 приглашение в один календарь начало сужать доступ: политики записей и
-- клиентов гасят ветку роли, как только у человека появляется хоть одна строка
-- прав (`grants_narrow_role_in_policies`). Но часть записей идёт НЕ через
-- таблицу, а через SECURITY DEFINER-функции — они RLS не видят вовсе и
-- проверяли только РОЛЬ. Нашла проверка кода 14.09, подтверждено на боевой:
--
--   update_client_with_tags      диспетчер в ОДИН календарь правил ЛЮБОГО
--                                клиента компании по id и получал в ответ всю
--                                его строку — политика таблицы его не пустила бы;
--   set_appointment_prepayment   тот же диспетчер менял предоплату,
--   reset_appointment_payment    отменял оплату
--   undo_appointment_payment     и откатывал её по записи ЛЮБОГО календаря;
--   current_user_can_pay_appointment
--                                отвечала «можно» владельцу И диспетчеру не
--                                глядя на календарь — через неё записывали и
--                                снимали оплату (`record_…`, `cancel_…`).
--
-- Не выстрелило только потому, что диспетчеров в боевой базе пока нет.
--
-- ЧТО ДЕЛАЕМ. Правило ОДНО — то, что уже стоит в политике таблицы, — и
-- вызывается функцией, а не переписывается в каждом теле:
--   • запись: владелец | диспетчер без строк прав | календарь записи в
--     `current_user_calendar_ids('edit_all')` — ровно `appointments_update`;
--   • клиент: владелец | диспетчер без строк прав | у клиента есть запись в
--     календаре с правом `clients` — ровно `clients_update_owner_or_dispatcher`;
--   • деньги по записи: владелец | диспетчер без строк прав | календарь записи
--     с правом `finance` (то же право, что `finance_transactions_*_calendar`);
--     ветка мастера не тронута.
--
-- ТЕЛА ФУНКЦИЙ НЕ ПЕРЕПИСЫВАЮТСЯ РУКАМИ. Проверка вставляется сразу после
-- строки «не найдено» живого тела (`pg_get_functiondef`), с сторожем «якорь
-- встречается ровно один раз» — чужая правка тела уронит накат, а не
-- проглотится молча. Отказ говорит тем же «не найдено», что и отсутствие
-- строки: иначе функция стала бы оракулом «такой id существует».

create or replace function public.current_user_can_edit_work_appointment(p_team_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when auth.uid() is null then false
    when public.current_user_role() = 'owner' then true
    when public.current_user_role() = 'dispatcher'
         and not public.current_user_has_calendar_grants() then true
    else p_team_id is not null
         and p_team_id = any(public.current_user_calendar_ids('edit_all'))
  end
$function$;

comment on function public.current_user_can_edit_work_appointment(text) is
  'Может ли человек менять рабочую запись этого календаря. Та же логика, что '
  'в политике appointments_update; зовут SECURITY DEFINER-функции записей.';

create or replace function public.current_user_can_edit_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when auth.uid() is null then false
    when public.current_user_role() = 'owner' then true
    when public.current_user_role() = 'dispatcher'
         and not public.current_user_has_calendar_grants() then true
    else exists (
      select 1
        from public.appointments a
       where a.tenant_id = public.current_tenant_id()
         and a.client_id = p_client_id
         and a.team_id = any(public.current_user_calendar_ids('clients'))
    )
  end
$function$;

comment on function public.current_user_can_edit_client(uuid) is
  'Может ли человек менять этого клиента. Та же логика, что в политике '
  'clients_update_owner_or_dispatcher; зовут SECURITY DEFINER-функции клиентов.';

create or replace function public.current_user_can_pay_appointment(p_team_id text, p_master_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  role_name text := coalesce(public.current_user_role(), '');
begin
  if auth.uid() is null then
    return false;
  end if;
  if role_name = 'owner' then
    return true;
  end if;
  if role_name = 'dispatcher' then
    -- Диспетчер без строк прав видит всю компанию, как и раньше. Появилась
    -- хоть одна — деньги только по календарям с правом `finance`.
    if not public.current_user_has_calendar_grants() then
      return true;
    end if;
    return p_team_id is not null
       and p_team_id = any(public.current_user_calendar_ids('finance'));
  end if;
  if role_name = 'master' then
    return (p_team_id is not null and p_team_id = any(public.current_user_team_ids()))
        or (p_master_id is not null and p_master_id = public.current_user_master_id());
  end if;
  return false;
end;
$function$;

do $migration$
declare
  target record;
  source_text text;
  hits integer;
begin
  for target in
    select *
      from (values
        (
          'update_client_with_tags',
          E'  if not found then\n    raise exception ''client not found''\n      using errcode = ''P0002'';\n  end if;\n',
          E'  if not public.current_user_can_edit_client(p_client_id) then\n    raise exception ''client not found''\n      using errcode = ''P0002'';\n  end if;\n'
        ),
        (
          'set_appointment_prepayment',
          E'  if not found then raise exception ''Заявка не найдена''; end if;\n',
          E'  if not public.current_user_can_edit_work_appointment(appointment_row.team_id) then\n    raise exception ''Заявка не найдена'';\n  end if;\n'
        ),
        (
          'reset_appointment_payment',
          E'  if not found then raise exception ''Заявка не найдена''; end if;\n',
          E'  if not public.current_user_can_edit_work_appointment(appointment_row.team_id) then\n    raise exception ''Заявка не найдена'';\n  end if;\n'
        ),
        (
          'undo_appointment_payment',
          E'  if not found then raise exception ''Заявка не найдена''; end if;\n',
          E'  if not public.current_user_can_edit_work_appointment(appointment_row.team_id) then\n    raise exception ''Заявка не найдена'';\n  end if;\n'
        )
      ) as t(fn, anchor, guard)
  loop
    select pg_get_functiondef(p.oid)
      into source_text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = target.fn;

    if source_text is null then
      raise exception 'миграция: функции % нет', target.fn;
    end if;

    -- Повторный накат ничего не удваивает.
    if position(target.guard in source_text) > 0 then
      continue;
    end if;

    hits := (length(source_text) - length(replace(source_text, target.anchor, '')))
            / length(target.anchor);
    if hits <> 1 then
      raise exception 'миграция: в % якорь «не найдено» встретился % раз, ждали 1 — тело менялось, правка вручную',
        target.fn, hits;
    end if;

    execute replace(source_text, target.anchor, target.anchor || target.guard);
  end loop;
end
$migration$;

-- СТОРОЖ: каждая функция теперь зовёт своё правило, проверка денег знает о
-- строках прав. Не так — накат падает целиком.
do $guard$
declare
  missing text;
begin
  select string_agg(fn, ', ')
    into missing
    from (values
      ('update_client_with_tags', 'current_user_can_edit_client('),
      ('set_appointment_prepayment', 'current_user_can_edit_work_appointment('),
      ('reset_appointment_payment', 'current_user_can_edit_work_appointment('),
      ('undo_appointment_payment', 'current_user_can_edit_work_appointment('),
      ('current_user_can_pay_appointment', 'current_user_has_calendar_grants(')
    ) as t(fn, needle)
   where not exists (
     select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = t.fn
        and position(t.needle in pg_get_functiondef(p.oid)) > 0
   );
  if missing is not null then
    raise exception 'миграция: без проверки прав остались: %', missing;
  end if;
end
$guard$;
