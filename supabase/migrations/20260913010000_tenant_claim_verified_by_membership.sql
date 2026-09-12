-- CLAIM ИЗ ТОКЕНА ТОЖЕ ПОДТВЕРЖДАЕТСЯ ЧЛЕНСТВОМ.
--
-- Найдено сессией 005 опытом на боевой (в rollback): сняла членство ровно так,
-- как это делает экран увольнения, — и уволенный по токену видел ту же
-- компанию и те же записи. Причина: ветка БЕЗ заголовка читала
-- `app_metadata.tenant_id` напрямую, `coalesce(claim, старейшее членство)`, и
-- членство не проверяла ни разу. Проверяла только заголовочная ветка — та,
-- что появилась в `active_tenant_from_verified_header`. То есть увольнение
-- отзывало доступ у новых сборок и НЕ отзывало у старых и у всего, что ходит
-- мимо PostgREST (realtime, storage, edge), — до истечения токена, час.
--
-- Теперь обе ветки ходят в `tenant_members`. Стоимость — один `exists` по
-- первичному ключу, и он уже был в заголовочной ветке.
--
-- ПРОГНАНО НА БОЕВОЙ В begin/rollback тем же человеком (мастер в Giliuta):
--   • состоит, токен=Giliuta, без заголовка   → Giliuta, 2 записи;
--   • УВОЛЕН, токен всё ещё=Giliuta            → NULL, 0 записей, 0 клиентов;
--   • УВОЛЕН, с заголовком Giliuta             → NULL;
--   • своя AirFix — и по заголовку, и по токену → AirFix;
--   • владелец Giliuta на старой сборке (токен) → Giliuta, 18 записей, как было.

create or replace function public.current_tenant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_header text;
  v_asked  uuid;
begin
  begin
    v_header := nullif(
      current_setting('request.headers', true)::json ->> 'x-babun-tenant',
      ''
    );
  exception when others then
    v_header := null;
  end;

  if v_header is not null then
    begin
      v_asked := v_header::uuid;
    exception when others then
      return null;
    end;
    return (
      select tm.tenant_id
        from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.tenant_id = v_asked
       limit 1
    );
  end if;

  -- БЕЗ ЗАГОЛОВКА: claim из токена ТОЖЕ подтверждается членством.
  v_asked := nullif(((auth.jwt() -> 'app_metadata') ->> 'tenant_id'), '')::uuid;
  if v_asked is not null then
    return (
      select tm.tenant_id
        from public.tenant_members tm
       where tm.user_id = auth.uid()
         and tm.tenant_id = v_asked
       limit 1
    );
  end if;

  return (
    select tenant_id from public.tenant_members
     where user_id = auth.uid()
     order by joined_at asc, tenant_id asc
     limit 1
  );
end;
$$;

revoke all on function public.current_tenant_id() from public;
grant execute on function public.current_tenant_id() to anon, authenticated;

comment on function public.current_tenant_id() is
  'Активная компания. Заголовок x-babun-tenant ИЛИ claim токена — оба '
  'подтверждаются членством в tenant_members; не член, мусор — NULL (fail '
  'closed). Ни заголовка, ни claim — старейшее членство.';

-- СТОРОЖ: обе ветки обязаны ходить в tenant_members. Одна проверка = одна дыра.
do $$
declare v_src text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'current_tenant_id';
  if (length(v_src) - length(replace(v_src, 'public.tenant_members tm', '')))
       / length('public.tenant_members tm') < 2 then
    raise exception 'current_tenant_id: claim токена не подтверждается членством';
  end if;
end $$;
