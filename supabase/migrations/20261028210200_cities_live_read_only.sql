-- `cities_live` — ТОЛЬКО ЧТЕНИЕ.
--
-- Представление для выбора метки (20261028200100) получило от умолчаний
-- Supabase ещё и вставку, правку и удаление для `authenticated`. Простое
-- представление обновляемо, и писать через него можно было бы ровно туда, куда
-- пускает RLS самих меток, — лишняя дверь без нужды: метки пишут в `cities`.

revoke insert, update, delete, truncate, references, trigger on public.cities_live from authenticated, service_role;

do $guard$
begin
  if has_table_privilege('authenticated', 'public.cities_live', 'insert')
     or has_table_privilege('authenticated', 'public.cities_live', 'update')
     or has_table_privilege('authenticated', 'public.cities_live', 'delete') then
    raise exception 'cities_live снова пишется';
  end if;
  if not has_table_privilege('authenticated', 'public.cities_live', 'select') then
    raise exception 'cities_live закрыт и для чтения';
  end if;
end;
$guard$;
