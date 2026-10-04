-- ПЕРВЫЙ КАЛЕНДАРЬ ЗАВОДИТСЯ ОДИН РАЗ — РЕШАЕТ БАЗА (03.10, сессия 017).
--
-- Экран календаря сам заводит «Личный», если у владельца нет ни одного
-- календаря. Решение принималось по списку команд НА УСТРОЙСТВЕ — и 03.10 в
-- 19:36 UTC, когда у устройства истёк вход, список ушёл без входа: RLS отдал
-- ему ноль строк ответом 200, экран прочёл «календарей нет», и через секунды,
-- уже с обновлённым входом, у AirFix с тремя живыми календарями появился
-- второй «Личный» со своими счетами (журнал: teams 119, accounts 120–121).
-- Тот же исход у двух устройств владельца, открытых разом на пустом аккаунте.
--
-- Теперь автосоздание идёт через `create_first_calendar`: под замком
-- компании она проверяет, есть ли у неё живой календарь, и если есть —
-- ничего не создаёт и возвращает NULL (экран просто перечитывает список).
-- Вставка — от лица звонящего (SECURITY INVOKER): те же политики владельца,
-- сторож тарифа, сторож партнёра и журнал, что у ручного «Добавить».

create or replace function public.create_first_calendar(p_id text, p_name text, p_color text default null)
returns public.teams
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_row public.teams;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Войдите в приложение, чтобы завести календарь'
      using errcode = '42501', hint = 'calendar:auth';
  end if;
  if public.current_user_role() is distinct from 'owner' then
    raise exception 'Создавать календари может только владелец'
      using errcode = '42501', hint = 'calendar:owner';
  end if;
  if coalesce(btrim(p_id), '') = '' or coalesce(btrim(p_name), '') = '' then
    raise exception 'Нет имени календаря' using errcode = '22023';
  end if;

  -- Два устройства на пустом аккаунте: второе ждёт первое и видит его
  -- календарь, а не заводит свой.
  perform pg_advisory_xact_lock(hashtextextended('first_calendar:' || v_tenant::text, 0));

  -- Живой — как у экрана (`pickLiveTeams`): архив календарём не считается.
  if exists (
    select 1 from public.teams t
     where t.tenant_id = v_tenant and t.is_active
  ) then
    return null;
  end if;

  insert into public.teams (id, tenant_id, name, color, payout_percentage)
  values (btrim(p_id), v_tenant, btrim(p_name), nullif(btrim(coalesce(p_color, '')), ''), 30)
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.create_first_calendar(text, text, text) from public, anon;
grant execute on function public.create_first_calendar(text, text, text) to authenticated;

do $guard$
begin
  if has_function_privilege('anon', 'public.create_first_calendar(text, text, text)', 'execute') then
    raise exception 'first calendar: функция открыта anon';
  end if;
  if not has_function_privilege('authenticated', 'public.create_first_calendar(text, text, text)', 'execute') then
    raise exception 'first calendar: функция закрыта для приложения';
  end if;
  if (select prosecdef from pg_proc
       where oid = 'public.create_first_calendar(text, text, text)'::regprocedure) then
    raise exception 'first calendar: функция должна идти от лица звонящего (invoker)';
  end if;
end;
$guard$;
